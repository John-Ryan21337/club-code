/**
 * Per-device geometry for the floating ambient image panel.
 *
 * Where the user dragged a decorative overlay is a property of one screen, not
 * of the account, so this value never enters `ClientSettings`. It stays in
 * browser storage behind a versioned envelope, and every read passes through
 * `clampAmbientImageGeometry`, so a corrupt, stale or hostile record can only
 * produce a rectangle that is still reachable on the current viewport.
 *
 * Coordinates are normalized against the pane (the full-window ambient layer):
 * `x` and `y` are the top-left corner as a fraction of pane width and height,
 * and `width` is a fraction of pane width. Height is never stored. Height comes
 * from the clamped width and the image aspect ratio, so a width change cannot
 * leave the panel taller than the window.
 */
export const AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY = "cafe-code:ambient-image-geometry";
export const AMBIENT_IMAGE_GEOMETRY_STORAGE_VERSION = 1 as const;

/**
 * The only slot in use today. The envelope keeps a slot map so a later ambient
 * media panel can be added without a storage migration.
 */
export type AmbientImageGeometrySlot = "image";

export interface AmbientImageGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface AmbientImageGeometryBounds {
  /** Image width divided by image height. Supply with `paneAspectRatio`. */
  readonly mediaAspectRatio?: number;
  /** Pane width divided by pane height. Supply with `mediaAspectRatio`. */
  readonly paneAspectRatio?: number;
  readonly minimumWidth?: number;
  readonly maximumWidth?: number;
}

export interface AmbientImageGeometryDocument {
  readonly version: typeof AMBIENT_IMAGE_GEOMETRY_STORAGE_VERSION;
  readonly slots: { readonly image?: AmbientImageGeometry };
}

const EMPTY_DOCUMENT: AmbientImageGeometryDocument = {
  version: AMBIENT_IMAGE_GEOMETRY_STORAGE_VERSION,
  slots: {},
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function readCandidate(value: unknown): AmbientImageGeometry | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<Record<keyof AmbientImageGeometry, unknown>>;
  const { x, y, width } = candidate;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width)) return null;
  return { x, y, width };
}

function resolveBounds(bounds: AmbientImageGeometryBounds): {
  readonly heightPerWidth: number | null;
  readonly minimumWidth: number;
  readonly maximumWidth: number;
} | null {
  const hasMedia = bounds.mediaAspectRatio !== undefined;
  const hasPane = bounds.paneAspectRatio !== undefined;
  const minimumWidth = bounds.minimumWidth ?? 0;
  const maximumWidth = bounds.maximumWidth ?? 1;
  // Supply both aspect ratios or neither: one ratio cannot describe a rectangle.
  if (hasMedia !== hasPane) return null;
  if (!Number.isFinite(minimumWidth) || !Number.isFinite(maximumWidth)) return null;
  if (minimumWidth < 0 || minimumWidth > 1) return null;
  if (maximumWidth <= 0 || maximumWidth > 1) return null;
  if (minimumWidth > maximumWidth) return null;

  if (!hasMedia || !hasPane) return { heightPerWidth: null, minimumWidth, maximumWidth };
  const mediaAspectRatio = bounds.mediaAspectRatio ?? 0;
  const paneAspectRatio = bounds.paneAspectRatio ?? 0;
  if (!Number.isFinite(mediaAspectRatio) || mediaAspectRatio <= 0) return null;
  if (!Number.isFinite(paneAspectRatio) || paneAspectRatio <= 0) return null;
  const heightPerWidth = paneAspectRatio / mediaAspectRatio;
  if (!Number.isFinite(heightPerWidth) || heightPerWidth <= 0) return null;
  return { heightPerWidth, minimumWidth, maximumWidth };
}

/**
 * Converts an untrusted value into a rectangle that is completely inside the
 * pane. Returns `null` when the value is not geometry, or when the supplied
 * bounds describe no reachable rectangle.
 */
export function clampAmbientImageGeometry(
  value: unknown,
  bounds: AmbientImageGeometryBounds = {},
): AmbientImageGeometry | null {
  const candidate = readCandidate(value);
  const resolved = resolveBounds(bounds);
  if (candidate === null || resolved === null || candidate.width <= 0) return null;

  // A panel wider than the pane is also taller than the pane after the aspect
  // ratio applies, so the reachable maximum is the stricter of the two limits.
  const reachableMaximum =
    resolved.heightPerWidth === null
      ? resolved.maximumWidth
      : Math.min(resolved.maximumWidth, 1 / resolved.heightPerWidth);
  if (resolved.minimumWidth > reachableMaximum) return null;

  const width = clamp(candidate.width, resolved.minimumWidth, reachableMaximum);
  if (width <= 0) return null;
  const height = resolved.heightPerWidth === null ? 0 : width * resolved.heightPerWidth;
  return {
    x: clamp(candidate.x, 0, Math.max(0, 1 - width)),
    y: clamp(candidate.y, 0, Math.max(0, 1 - height)),
    width,
  };
}

export function isAmbientImageGeometry(value: unknown): value is AmbientImageGeometry {
  const candidate = readCandidate(value);
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

/**
 * Decodes the stored envelope. An unreadable slot is dropped, not repaired with
 * a guess, so the panel returns to its preset instead of appearing at an
 * arbitrary place.
 */
export function readAmbientImageGeometryDocument(
  value: unknown,
): AmbientImageGeometryDocument | null {
  if (!value || typeof value !== "object") return null;
  const input = value as { version?: unknown; slots?: unknown };
  if (input.version !== AMBIENT_IMAGE_GEOMETRY_STORAGE_VERSION) return null;
  if (!input.slots || typeof input.slots !== "object") return null;
  const image = clampAmbientImageGeometry((input.slots as { image?: unknown }).image);
  return {
    version: AMBIENT_IMAGE_GEOMETRY_STORAGE_VERSION,
    slots: image === null ? {} : { image },
  };
}

function resolveStorage(storage: Storage | null | undefined): Storage | null {
  if (storage !== undefined) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Private modes and blocked storage throw on access, not only on use.
    return null;
  }
}

function removeDocument(storage: Storage): boolean {
  try {
    storage.removeItem(AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function persistDocument(storage: Storage, document: AmbientImageGeometryDocument): boolean {
  if (document.slots.image === undefined) return removeDocument(storage);
  try {
    storage.setItem(AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY, JSON.stringify(document));
    return true;
  } catch {
    // A quota or privacy failure must not stop the panel that is already drawn.
    return false;
  }
}

type DocumentRead =
  | { readonly status: "available"; readonly document: AmbientImageGeometryDocument }
  | { readonly status: "unavailable" };

function loadDocument(storage: Storage): DocumentRead {
  let raw: string | null;
  try {
    raw = storage.getItem(AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (raw === null) return { status: "available", document: EMPTY_DOCUMENT };
  if (raw.length > 4096) {
    removeDocument(storage);
    return { status: "available", document: EMPTY_DOCUMENT };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    removeDocument(storage);
    return { status: "available", document: EMPTY_DOCUMENT };
  }

  const document = readAmbientImageGeometryDocument(parsed);
  if (document === null) {
    removeDocument(storage);
    return { status: "available", document: EMPTY_DOCUMENT };
  }
  if (JSON.stringify(document) !== raw) persistDocument(storage, document);
  return { status: "available", document };
}

export function readAmbientImageGeometry(
  slot: AmbientImageGeometrySlot = "image",
  storage?: Storage | null,
): AmbientImageGeometry | null {
  const resolved = resolveStorage(storage);
  if (resolved === null) return null;
  const result = loadDocument(resolved);
  return result.status === "available" ? (result.document.slots[slot] ?? null) : null;
}

export function writeAmbientImageGeometry(
  value: unknown,
  slot: AmbientImageGeometrySlot = "image",
  storage?: Storage | null,
): boolean {
  const geometry = clampAmbientImageGeometry(value);
  const resolved = resolveStorage(storage);
  if (geometry === null || resolved === null) return false;
  const result = loadDocument(resolved);
  if (result.status === "unavailable") return false;
  return persistDocument(resolved, {
    version: AMBIENT_IMAGE_GEOMETRY_STORAGE_VERSION,
    slots: { ...result.document.slots, [slot]: geometry },
  });
}

/** Forgets the dragged position. The next render returns to the preset. */
export function resetAmbientImageGeometry(
  slot: AmbientImageGeometrySlot = "image",
  storage?: Storage | null,
): boolean {
  const resolved = resolveStorage(storage);
  if (resolved === null) return false;
  const result = loadDocument(resolved);
  if (result.status === "unavailable") return false;
  const { [slot]: _removed, ...remaining } = result.document.slots;
  return persistDocument(resolved, {
    version: AMBIENT_IMAGE_GEOMETRY_STORAGE_VERSION,
    slots: remaining,
  });
}

/**
 * Returns stored geometry, or stores and returns the preset seed of the caller.
 * The first switch to custom layout then starts exactly where the preset put
 * the panel. A storage failure returns `null`; the caller keeps its preset and
 * does not report that a position was saved.
 */
export function readOrSeedAmbientImageGeometry(
  createSeed: () => unknown,
  slot: AmbientImageGeometrySlot = "image",
  storage?: Storage | null,
): AmbientImageGeometry | null {
  const resolved = resolveStorage(storage);
  if (resolved === null) return null;
  const result = loadDocument(resolved);
  if (result.status === "unavailable") return null;
  const current = result.document.slots[slot] ?? null;
  if (current !== null) return current;
  const seed = clampAmbientImageGeometry(createSeed());
  if (seed === null) return null;
  return persistDocument(resolved, {
    version: AMBIENT_IMAGE_GEOMETRY_STORAGE_VERSION,
    slots: { ...result.document.slots, [slot]: seed },
  })
    ? seed
    : null;
}
