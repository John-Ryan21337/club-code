import * as Schema from "effect/Schema";

export const AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY = "cafe-code:ambient-media-geometry";
export const AMBIENT_MEDIA_GEOMETRY_STORAGE_VERSION = 1 as const;

export type AmbientMediaSlot = "video" | "image";

export interface NormalizedAmbientMediaGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface AmbientMediaGeometryDocument {
  readonly version: typeof AMBIENT_MEDIA_GEOMETRY_STORAGE_VERSION;
  readonly slots: {
    readonly video?: NormalizedAmbientMediaGeometry;
    readonly image?: NormalizedAmbientMediaGeometry;
  };
}

const AmbientMediaGeometryCandidateSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
});
type AmbientMediaGeometryCandidate = typeof AmbientMediaGeometryCandidateSchema.Type;

const AmbientMediaGeometrySlotInputSchema = Schema.Struct({
  video: Schema.optionalKey(Schema.Unknown),
  image: Schema.optionalKey(Schema.Unknown),
});

const AmbientMediaGeometryDocumentV1InputSchema = Schema.Struct({
  version: Schema.Literal(AMBIENT_MEDIA_GEOMETRY_STORAGE_VERSION),
  slots: AmbientMediaGeometrySlotInputSchema,
});

/**
 * Version zero was an unwrapped map keyed directly by media slot. Keeping its
 * decoder here makes the local persistence boundary explicitly migratable
 * without ever adding device geometry to backend-authoritative settings.
 */
const AmbientMediaGeometryDocumentV0InputSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Literal(0)),
  video: Schema.optionalKey(Schema.Unknown),
  image: Schema.optionalKey(Schema.Unknown),
});

const decodeGeometryCandidate = Schema.decodeUnknownSync(AmbientMediaGeometryCandidateSchema);
const decodeDocumentV1Input = Schema.decodeUnknownSync(AmbientMediaGeometryDocumentV1InputSchema);
const decodeDocumentV0Input = Schema.decodeUnknownSync(AmbientMediaGeometryDocumentV0InputSchema);

const EMPTY_AMBIENT_MEDIA_GEOMETRY_DOCUMENT: AmbientMediaGeometryDocument = {
  version: AMBIENT_MEDIA_GEOMETRY_STORAGE_VERSION,
  slots: {},
};

function decodeCandidate(value: unknown): AmbientMediaGeometryCandidate | null {
  try {
    const candidate = decodeGeometryCandidate(value);
    if (
      !Number.isFinite(candidate.x) ||
      !Number.isFinite(candidate.y) ||
      !Number.isFinite(candidate.width)
    ) {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Converts persisted finite values into a reachable viewport-independent
 * rectangle. Viewport- and aspect-ratio-aware limits are applied by the
 * renderer in the next layer of the stack.
 */
export function clampAmbientMediaGeometry(value: unknown): NormalizedAmbientMediaGeometry | null {
  const candidate = decodeCandidate(value);
  if (candidate === null || candidate.width <= 0) {
    return null;
  }

  const width = clamp(candidate.width, 0, 1);
  if (width <= 0) {
    return null;
  }

  return {
    x: clamp(candidate.x, 0, Math.max(0, 1 - width)),
    y: clamp(candidate.y, 0, 1),
    width,
  };
}

export function isNormalizedAmbientMediaGeometry(
  value: unknown,
): value is NormalizedAmbientMediaGeometry {
  const candidate = decodeCandidate(value);
  return (
    candidate !== null &&
    candidate.width > 0 &&
    candidate.width <= 1 &&
    candidate.x >= 0 &&
    candidate.x <= 1 - candidate.width &&
    candidate.y >= 0 &&
    candidate.y <= 1
  );
}

function migrateSlots(input: {
  readonly video?: unknown;
  readonly image?: unknown;
}): AmbientMediaGeometryDocument["slots"] {
  const video = input.video === undefined ? null : clampAmbientMediaGeometry(input.video);
  const image = input.image === undefined ? null : clampAmbientMediaGeometry(input.image);

  return {
    ...(video === null ? {} : { video }),
    ...(image === null ? {} : { image }),
  };
}

/**
 * Decodes the current envelope and the legacy unwrapped slot map. Invalid slot
 * values are reset independently so one corrupt panel never sacrifices the
 * other panel's usable geometry.
 */
export function migrateAmbientMediaGeometryDocument(
  value: unknown,
): AmbientMediaGeometryDocument | null {
  try {
    const input = decodeDocumentV1Input(value);
    return {
      version: AMBIENT_MEDIA_GEOMETRY_STORAGE_VERSION,
      slots: migrateSlots(input.slots),
    };
  } catch {
    // Try the only supported legacy shape.
  }

  try {
    const input = decodeDocumentV0Input(value);
    return {
      version: AMBIENT_MEDIA_GEOMETRY_STORAGE_VERSION,
      slots: migrateSlots(input),
    };
  } catch {
    return null;
  }
}

function resolveBrowserStorage(storage: Storage | null | undefined): Storage | null {
  if (storage !== undefined) {
    return storage;
  }
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function hasStoredGeometry(document: AmbientMediaGeometryDocument): boolean {
  return document.slots.video !== undefined || document.slots.image !== undefined;
}

function removeDocument(storage: Storage): boolean {
  try {
    storage.removeItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function persistDocument(storage: Storage, document: AmbientMediaGeometryDocument): boolean {
  if (!hasStoredGeometry(document)) {
    return removeDocument(storage);
  }

  try {
    storage.setItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY, JSON.stringify(document));
    return true;
  } catch {
    return false;
  }
}

type AmbientMediaGeometryDocumentRead =
  | {
      readonly status: "available";
      readonly document: AmbientMediaGeometryDocument;
    }
  | {
      readonly status: "unavailable";
    };

function readDocument(storage: Storage): AmbientMediaGeometryDocumentRead {
  let raw: string | null;
  try {
    raw = storage.getItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (raw === null) {
    return {
      status: "available",
      document: EMPTY_AMBIENT_MEDIA_GEOMETRY_DOCUMENT,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeDocument(storage);
    return {
      status: "available",
      document: EMPTY_AMBIENT_MEDIA_GEOMETRY_DOCUMENT,
    };
  }

  const document = migrateAmbientMediaGeometryDocument(parsed);
  if (document === null) {
    removeDocument(storage);
    return {
      status: "available",
      document: EMPTY_AMBIENT_MEDIA_GEOMETRY_DOCUMENT,
    };
  }

  const canonical = JSON.stringify(document);
  if (canonical !== raw) {
    persistDocument(storage, document);
  }
  return {
    status: "available",
    document,
  };
}

export function readAmbientMediaGeometry(
  slot: AmbientMediaSlot,
  storage?: Storage | null,
): NormalizedAmbientMediaGeometry | null {
  const resolvedStorage = resolveBrowserStorage(storage);
  if (resolvedStorage === null) {
    return null;
  }
  const result = readDocument(resolvedStorage);
  return result.status === "available" ? (result.document.slots[slot] ?? null) : null;
}

export function writeAmbientMediaGeometry(
  slot: AmbientMediaSlot,
  value: unknown,
  storage?: Storage | null,
): boolean {
  const geometry = clampAmbientMediaGeometry(value);
  const resolvedStorage = resolveBrowserStorage(storage);
  if (geometry === null || resolvedStorage === null) {
    return false;
  }

  const result = readDocument(resolvedStorage);
  if (result.status === "unavailable") {
    return false;
  }
  return persistDocument(resolvedStorage, {
    version: AMBIENT_MEDIA_GEOMETRY_STORAGE_VERSION,
    slots: {
      ...result.document.slots,
      [slot]: geometry,
    },
  });
}

export function resetAmbientMediaGeometry(
  slot: AmbientMediaSlot,
  storage?: Storage | null,
): boolean {
  const resolvedStorage = resolveBrowserStorage(storage);
  if (resolvedStorage === null) {
    return false;
  }

  const result = readDocument(resolvedStorage);
  if (result.status === "unavailable") {
    return false;
  }
  const { [slot]: _removed, ...remainingSlots } = result.document.slots;
  return persistDocument(resolvedStorage, {
    version: AMBIENT_MEDIA_GEOMETRY_STORAGE_VERSION,
    slots: remainingSlots,
  });
}

export function resetAllAmbientMediaGeometry(storage?: Storage | null): boolean {
  const resolvedStorage = resolveBrowserStorage(storage);
  return resolvedStorage === null ? false : removeDocument(resolvedStorage);
}
