import type { OrchestrationThreadActivity, ScopedThreadRef } from "@cafecode/contracts";
import {
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  MAX_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
  MIN_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
  type FallingEffectActivityLinkColorMode,
  type FallingEffectMatrixMotionMode,
} from "@cafecode/contracts/settings";

import type { AppState } from "./store";
import {
  resolveAtmosphereProjectedPointInPlace,
  resolveMatrixWalkLifecycleOpacity,
  resolveMatrixStreamColor,
  type AtmosphereProjectedPoint,
  type AtmosphereScene,
  type MatrixColorFrame,
} from "./windowAtmosphere";

export const MAX_MATRIX_ACTIVITY_EVENTS = 24;
export const MAX_MATRIX_ACTIVITY_ENCODED_CHARS = 8_192;
export const MAX_MATRIX_ACTIVITY_LINKS = 12;
/** Standalone activity pulses retain the original short, non-configurable lifetime. */
export const MATRIX_ACTIVITY_TTL_MS = 8_000;
/** Default visibility for an already verified route; callers may supply the persisted bounded TTL. */
export const DEFAULT_MATRIX_ACTIVITY_ROUTE_TTL_MS =
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS * 1_000;
const MIN_MATRIX_ACTIVITY_TTL_MS = MIN_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS * 1_000;
const MAX_MATRIX_ACTIVITY_TTL_MS = MAX_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS * 1_000;
/** Keep links fully legible until this short terminal fade begins. */
export const MATRIX_ACTIVITY_TERMINAL_FADE_MS = 400;
// Keep this aligned with the per-thread activity retention cap in store.ts.
// Derivation remains bounded while still seeing every activity the store can
// retain for the selected thread.
const MAX_MATRIX_ACTIVITY_SOURCE_ACTIVITIES = 500;
/** A single provider turn may legitimately contain a full-day build or migration. */
export const MATRIX_ACTIVITY_MAX_CORRELATION_MS = 24 * 60 * 60 * 1_000;
export const MATRIX_ACTIVITY_PACKET_TRAVEL_MS = 720;
/** Repeated packets make each real correlated route easy to see without inventing extra traffic. */
export const MATRIX_ACTIVITY_PACKET_COUNT = 3;
/**
 * Bound decorative packet instances per frame for Pi-class GPUs. A packet
 * paints one circle and one trail, with at most one extra trail stroke when
 * that trail wraps over the route boundary.
 */
export const MAX_MATRIX_ACTIVITY_PACKET_DRAWS = 30;
export const MATRIX_ACTIVITY_MIN_PACKETS_PER_LINK = 2;
export const MATRIX_ACTIVITY_PACKET_TRAIL_PROGRESS = 0.12;
export const MATRIX_ACTIVITY_LINK_PULSE_MS = 180;
/** Circular lettering is intentionally limited because Canvas text is rendered one glyph at a time. */
export const MAX_MATRIX_ACTIVITY_TELEMETRY_RINGS = 6;
export const MAX_MATRIX_ACTIVITY_TELEMETRY_GLYPHS = 28;
/** Fixed subdivision keeps tapered depth routes smooth without unbounded per-frame strokes. */
export const MATRIX_ACTIVITY_DEPTH_ROUTE_SEGMENTS = 8;
export const MIN_MATRIX_ACTIVITY_DEPTH_SCALE = 0.4;
export const MAX_MATRIX_ACTIVITY_DEPTH_SCALE = 4;
export const MIN_MATRIX_ACTIVITY_DEPTH_LINE_WIDTH = 0.5;
export const MAX_MATRIX_ACTIVITY_DEPTH_LINE_WIDTH = 8;
export const MAX_MATRIX_ACTIVITY_DEPTH_PACKET_RADIUS = 6;
const MATRIX_ACTIVITY_WALK_GLYPH_ATTACHMENT_RATIO = 0.45;
const MATRIX_ACTIVITY_WALK_MAX_ROUTE_INSET_RATIO = 0.35;
const MAX_ACTIVITY_RELATIONS = 4;
const MAX_FUTURE_CLOCK_SKEW_MS = 250;
const SAFE_RELATION_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export type MatrixActivityCategory = "network" | "database" | "build" | "agent" | "work";

export interface MatrixActivityInputSelection {
  readonly network: boolean;
  readonly database: boolean;
  readonly build: boolean;
  readonly agent: boolean;
  readonly work?: boolean;
}

export const ALL_MATRIX_ACTIVITY_INPUTS: MatrixActivityInputSelection = {
  network: true,
  database: true,
  build: true,
  agent: true,
  work: true,
};

function hasSelectedMatrixActivityInput(selection: MatrixActivityInputSelection): boolean {
  return (
    selection.network === true ||
    selection.database === true ||
    selection.build === true ||
    selection.agent === true ||
    selection.work === true
  );
}

export interface MatrixActivityEvent {
  readonly anchorSeed: number;
  readonly category: MatrixActivityCategory;
  readonly observedAtMs: number;
  /** Hashes only: raw provider IDs and operation names never reach the canvas. */
  readonly relationHashes: readonly number[];
  /**
   * One canonical provider-observed agent dispatch can be visualized as a
   * category -> operation route even when that provider emits no separate
   * lifecycle start. This is one verified event with two decorative anchors,
   * not a second provider event or a throughput measurement.
   */
  readonly verifiedAgentDispatch?: {
    readonly operationAnchorSeed: number;
    readonly relationHash: number;
  };
}

/**
 * A deterministic retention window for deciding which provider observations
 * may consume the bounded Matrix activity payload. Supplying `nowMs` avoids
 * letting routes already expired at the caller's configured TTL crowd newer
 * pulses out of the 24-event budget.
 */
export interface MatrixActivityRetentionWindow {
  readonly nowMs?: number;
  readonly requestedTtlMs?: number;
}

export interface MatrixActivityPulse {
  anchorIndex: number;
  category: MatrixActivityCategory;
  intensity: number;
  /** The newest linked route owns a shared endpoint's deterministic random hue. */
  linkColorHue: number | null;
  semanticRole: "category" | "operation";
}

export interface MatrixActivityLink {
  fromAnchorIndex: number;
  toAnchorIndex: number;
  /** Only this endpoint may receive linked-operation telemetry lettering. */
  operationAnchorIndex: number;
  category: MatrixActivityCategory;
  intensity: number;
  linePulse: number;
  colorHue: number;
  packetProgress: number;
}

export interface MatrixActivityAnimationState {
  readonly pulses: MatrixActivityPulse[];
  readonly links: MatrixActivityLink[];
  pulseCount: number;
  linkCount: number;
  readonly relationEventOffsetByHash: Map<string, number>;
  readonly resolvedRelationHashes: Set<string>;
  readonly pulseIndexByAnchor: Map<number, number>;
  readonly linkPairs: Set<string>;
  reducedMotion: boolean;
}

export interface MatrixHexPoint {
  readonly x: number;
  readonly y: number;
}

interface MutableMatrixHexPoint {
  x: number;
  y: number;
}

export interface MatrixHexRoute {
  readonly points: readonly MatrixHexPoint[];
  readonly segmentLengths: readonly number[];
  readonly totalLength: number;
}

export interface MatrixActivityProgressInterval {
  readonly startProgress: number;
  readonly endProgress: number;
}

const CATEGORY_COLOR: Record<MatrixActivityCategory, string> = {
  network: "#38bdf8",
  database: "#a78bfa",
  build: "#fbbf24",
  agent: "#f472b6",
  work: "#34d399",
};

const CATEGORY_CODE: Record<MatrixActivityCategory, number> = {
  network: 0,
  database: 1,
  build: 2,
  agent: 3,
  work: 4,
};

const CODE_CATEGORY = ["network", "database", "build", "agent", "work"] as const;
const CATEGORY_TERM: Record<
  MatrixActivityCategory,
  Record<"english" | "japanese", readonly [category: string, operation: string]>
> = {
  network: {
    english: ["NETWORK", "FETCH"],
    japanese: ["通信", "取得"],
  },
  database: {
    english: ["DATABASE", "QUERY"],
    japanese: ["データベース", "照会"],
  },
  build: {
    english: ["BUILD", "COMPILE"],
    japanese: ["構築", "コンパイル"],
  },
  agent: {
    english: ["AGENT", "DISPATCH"],
    japanese: ["エージェント", "委任"],
  },
  work: {
    english: ["WORK", "TOOL"],
    japanese: ["作業", "道具"],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const UNSAFE_RECORD_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isSafeOwnRecordKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !UNSAFE_RECORD_KEYS.has(value);
}

function ownDataProperty(record: unknown, key: string): unknown {
  if (!isRecord(record)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function isMatrixThreadActivity(value: unknown): value is OrchestrationThreadActivity {
  if (!isRecord(value)) return false;
  const id = ownDataProperty(value, "id");
  const kind = ownDataProperty(value, "kind");
  const createdAt = ownDataProperty(value, "createdAt");
  const turnId = ownDataProperty(value, "turnId");
  return (
    typeof id === "string" &&
    typeof kind === "string" &&
    typeof createdAt === "string" &&
    (turnId === null || typeof turnId === "string")
  );
}

function hashSafeIdentity(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

function hashSafeRelationIdentity(value: string): number {
  const low = hashSafeIdentity(value);
  let high = 0x9e3779b9;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    high = Math.imul(high ^ value.charCodeAt(index), 0x85ebca6b);
  }
  // A 53-bit fingerprint remains exactly representable in JSON/JavaScript
  // while making unrelated provider identities far less likely to correlate
  // than the 32-bit visual-placement hash.
  return ((high >>> 0) & 0x1fffff) * 0x1_0000_0000 + low;
}

function safeRelationHash(parts: readonly string[], value: unknown): number | null {
  if (typeof value !== "string") return null;
  // Provider identities are exact. Do not normalize whitespace into a
  // different valid identity, and use a tuple encoding so delimiters inside
  // turn/item IDs cannot create the same hash preimage.
  if (!SAFE_RELATION_VALUE.test(value)) return null;
  return hashSafeRelationIdentity(JSON.stringify([...parts, value]));
}

const STRUCTURED_ACTIVITY_CATEGORIES = new Map<string, MatrixActivityCategory>([
  ["network", "network"],
  ["websearch", "network"],
  ["web_search", "network"],
  ["browser", "network"],
  ["fetch", "network"],
  ["download", "network"],
  ["http", "network"],
  ["curl", "network"],
  ["database", "database"],
  ["sqlite", "database"],
  ["sql", "database"],
  ["query", "database"],
  ["build", "build"],
  ["bundle", "build"],
  ["compile", "build"],
  ["compiler", "build"],
  ["transpile", "build"],
  ["agent", "agent"],
]);

function collectActivityCategory(value: unknown, categories: Set<MatrixActivityCategory>): void {
  if (typeof value !== "string" || value.length > 192) return;
  const normalized = value.trim().toLowerCase().replace(/[ -]+/gu, "_");
  const category = STRUCTURED_ACTIVITY_CATEGORIES.get(normalized);
  if (category) categories.add(category);
}

function activityCategory(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
): MatrixActivityCategory | null {
  const observed = isRecord(payload.observed) ? payload.observed : null;
  const explicitlyObserved = observed?.providerObserved === true;
  const providerLifecycle = /^tool\.(?:started|updated|completed)$/u.test(activity.kind);
  if (!explicitlyObserved && !providerLifecycle) return null;

  const categories = new Set<MatrixActivityCategory>();
  collectActivityCategory(payload.itemType, categories);
  collectActivityCategory(payload.requestKind, categories);
  collectActivityCategory(payload.requestType, categories);
  // These normalized fields are evidence only when the server explicitly
  // attests that they came from provider-observed activity. Free-form
  // title/detail remains deliberately excluded.
  if (explicitlyObserved) {
    collectActivityCategory(observed.operation, categories);
    collectActivityCategory(observed.activityType, categories);
  }
  return categories.size === 1 ? (categories.values().next().value ?? null) : null;
}

function activityRelationHashes(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
): readonly number[] {
  if (activity.turnId === null) return [];
  const turnId = String(activity.turnId);
  if (!SAFE_RELATION_VALUE.test(turnId)) return [];
  // Scope identities to one provider turn before hashing. Tool IDs may be
  // reused after a provider restart, but a tool lifecycle cannot cross turns.
  const namespace = ["turn", turnId, "tool"] as const;
  const hashes: number[] = [];
  const itemId = safeRelationHash(namespace, payload.itemId);
  if (itemId !== null) hashes.push(itemId);

  const observed = isRecord(payload.observed) ? payload.observed : null;
  if (observed?.providerObserved === true) {
    for (const value of [observed.toolId]) {
      const hash = safeRelationHash(namespace, value);
      if (hash !== null && !hashes.includes(hash)) hashes.push(hash);
      if (hashes.length >= MAX_ACTIVITY_RELATIONS) break;
    }
  }
  return hashes;
}

const PROVIDER_TOOL_LIFECYCLE_KIND = /^tool\.(?:started|updated|completed)$/u;

function isExplicitlyProviderObserved(payload: Record<string, unknown>): boolean {
  const observed = isRecord(payload.observed) ? payload.observed : null;
  return observed?.providerObserved === true;
}

/**
 * Raw lifecycle identities exist only in this bounded renderer derivation.
 * They are never encoded or retained by the canvas.
 */
function exactLifecycleRelationIdentity(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
): string | null {
  if (!PROVIDER_TOOL_LIFECYCLE_KIND.test(activity.kind) || activity.turnId === null) {
    return null;
  }
  const turnId = String(activity.turnId);
  const itemType = ownDataProperty(payload, "itemType");
  const itemId = ownDataProperty(payload, "itemId");
  if (
    !SAFE_RELATION_VALUE.test(turnId) ||
    typeof itemType !== "string" ||
    !SAFE_RELATION_VALUE.test(itemType) ||
    typeof itemId !== "string" ||
    !SAFE_RELATION_VALUE.test(itemId)
  ) {
    return null;
  }
  return JSON.stringify(["turn", turnId, "type", itemType, "item", itemId]);
}

function genericProviderWorkCategory(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
): "work" | null {
  // Do not reinterpret an explicit-but-invalid category attestation as generic
  // work. The fallback is only for a canonical provider lifecycle carrying no
  // category claim at all, and exactLifecycleRelationIdentity supplies the
  // same bounded turn/type/item proof used by correlation.
  return ownDataProperty(payload, "observed") === undefined &&
    exactLifecycleRelationIdentity(activity, payload) !== null
    ? "work"
    : null;
}

interface LifecycleCategoryAttestation {
  category: MatrixActivityCategory | null;
  completionCategory: MatrixActivityCategory | null;
  completionObservedAtMs: number | null;
  completionSourceOffset: number | null;
  completionAttestationCount: number;
  conflicted: boolean;
  lifecycleEventCount: number;
}

function collectLifecycleCategoryAttestations(
  activities: readonly OrchestrationThreadActivity[],
): ReadonlyMap<string, LifecycleCategoryAttestation> {
  const attestations = new Map<string, LifecycleCategoryAttestation>();
  for (let sourceOffset = 0; sourceOffset < activities.length; sourceOffset += 1) {
    const activity = activities[sourceOffset]!;
    const payload = isRecord(activity.payload) ? activity.payload : null;
    if (!payload) continue;
    const relationIdentity = exactLifecycleRelationIdentity(activity, payload);
    if (relationIdentity === null) continue;

    const existing = attestations.get(relationIdentity) ?? {
      category: null,
      completionCategory: null,
      completionObservedAtMs: null,
      completionSourceOffset: null,
      completionAttestationCount: 0,
      conflicted: false,
      lifecycleEventCount: 0,
    };
    existing.lifecycleEventCount += 1;
    if (isExplicitlyProviderObserved(payload)) {
      const category = activityCategory(activity, payload);
      if (category === null) {
        // An explicit but malformed or internally conflicting attestation
        // invalidates propagation for this exact lifecycle identity.
        existing.conflicted = true;
      } else if (existing.category !== null && existing.category !== category) {
        existing.conflicted = true;
      } else {
        existing.category = category;
      }
      if (activity.kind === "tool.completed") {
        existing.completionAttestationCount += 1;
        const observedAtMs = Date.parse(activity.createdAt);
        if (
          category === null ||
          !Number.isFinite(observedAtMs) ||
          (existing.completionCategory !== null && existing.completionCategory !== category)
        ) {
          existing.conflicted = true;
        } else {
          existing.completionCategory = category;
          existing.completionObservedAtMs = observedAtMs;
          existing.completionSourceOffset = sourceOffset;
        }
      }
    }
    attestations.set(relationIdentity, existing);
  }
  return attestations;
}

function propagatedLifecycleCategory(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
  attestations: ReadonlyMap<string, LifecycleCategoryAttestation>,
  sourceOffset: number,
): MatrixActivityCategory | null {
  const directCategory = activityCategory(activity, payload);
  if (directCategory !== null || isExplicitlyProviderObserved(payload)) {
    return directCategory;
  }
  if (activity.kind !== "tool.started") return null;
  const relationIdentity = exactLifecycleRelationIdentity(activity, payload);
  if (relationIdentity === null) return null;
  const attestation = attestations.get(relationIdentity);
  const startedAtMs = Date.parse(activity.createdAt);
  if (
    !attestation ||
    attestation.conflicted ||
    attestation.completionAttestationCount !== 1 ||
    attestation.category === null ||
    attestation.completionCategory !== attestation.category ||
    attestation.completionObservedAtMs === null ||
    attestation.completionSourceOffset === null ||
    sourceOffset >= attestation.completionSourceOffset ||
    !Number.isFinite(startedAtMs)
  ) {
    return null;
  }
  const durationMs = attestation.completionObservedAtMs - startedAtMs;
  return durationMs >= 0 && durationMs <= MATRIX_ACTIVITY_MAX_CORRELATION_MS
    ? attestation.category
    : null;
}

function deriveVerifiedAgentDispatch(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
  category: MatrixActivityCategory,
  attestations: ReadonlyMap<string, LifecycleCategoryAttestation>,
  anchorSeed: number,
  relationHashes: readonly number[],
): MatrixActivityEvent["verifiedAgentDispatch"] {
  const observed = isRecord(payload.observed) ? payload.observed : null;
  const providerToolLifecycle =
    (activity.kind === "tool.started" || activity.kind === "tool.completed") &&
    ownDataProperty(payload, "itemType") === "collab_agent_tool_call";
  const providerTaskLifecycle =
    (activity.kind === "task.started" || activity.kind === "task.completed") &&
    typeof ownDataProperty(payload, "taskId") === "string" &&
    ownDataProperty(payload, "taskId") === ownDataProperty(observed, "toolId");
  if (
    category !== "agent" ||
    (!providerToolLifecycle && !providerTaskLifecycle) ||
    !isExplicitlyProviderObserved(payload)
  ) {
    return undefined;
  }
  if (providerToolLifecycle) {
    const relationIdentity = exactLifecycleRelationIdentity(activity, payload);
    const attestation = relationIdentity === null ? undefined : attestations.get(relationIdentity);
    if (
      relationIdentity === null ||
      !attestation ||
      attestation.conflicted ||
      attestation.category !== "agent"
    ) {
      return undefined;
    }
  }
  const relationHash = relationHashes[0];
  if (!Number.isSafeInteger(relationHash) || relationHash === undefined || relationHash < 0) {
    return undefined;
  }
  return {
    operationAnchorSeed: hashSafeIdentity(
      JSON.stringify(["verified-agent-dispatch-operation", anchorSeed]),
    ),
    relationHash: hashSafeRelationIdentity(
      JSON.stringify(["verified-agent-dispatch", relationHash]),
    ),
  };
}

function isValidVerifiedAgentDispatch(event: MatrixActivityEvent): event is MatrixActivityEvent & {
  readonly verifiedAgentDispatch: NonNullable<MatrixActivityEvent["verifiedAgentDispatch"]>;
} {
  const route = event.verifiedAgentDispatch;
  return (
    event.category === "agent" &&
    route !== undefined &&
    Number.isInteger(route.operationAnchorSeed) &&
    route.operationAnchorSeed >= 0 &&
    route.operationAnchorSeed <= 0xffffffff &&
    Number.isSafeInteger(route.relationHash) &&
    route.relationHash >= 0
  );
}

/**
 * Preserve the newest bounded set of exact lifecycle pairs before filling the
 * remaining visual budget with standalone activity. A verified route must not
 * disappear merely because newer, unrelated provider observations arrived.
 */
function resolveMatrixActivityRouteTtlMs(requestedTtlMs: number | undefined): number {
  return typeof requestedTtlMs === "number" && Number.isFinite(requestedTtlMs)
    ? Math.min(
        MAX_MATRIX_ACTIVITY_TTL_MS,
        Math.max(MIN_MATRIX_ACTIVITY_TTL_MS, Math.round(requestedTtlMs)),
      )
    : DEFAULT_MATRIX_ACTIVITY_ROUTE_TTL_MS;
}

function resolveMatrixActivityRetentionReferenceMs(
  events: readonly MatrixActivityEvent[],
  requestedNowMs: number | undefined,
): number {
  if (typeof requestedNowMs === "number" && Number.isFinite(requestedNowMs)) {
    return requestedNowMs;
  }
  let newestObservedAtMs = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (Number.isFinite(event.observedAtMs)) {
      newestObservedAtMs = Math.max(newestObservedAtMs, event.observedAtMs);
    }
  }
  return Number.isFinite(newestObservedAtMs) ? newestObservedAtMs : 0;
}

function selectBoundedMatrixActivityEvents(
  events: readonly MatrixActivityEvent[],
  retentionWindow: MatrixActivityRetentionWindow = {},
): readonly MatrixActivityEvent[] {
  if (events.length <= MAX_MATRIX_ACTIVITY_EVENTS) return events;

  const referenceNowMs = resolveMatrixActivityRetentionReferenceMs(events, retentionWindow.nowMs);
  const routeTtlMs = resolveMatrixActivityRouteTtlMs(retentionWindow.requestedTtlMs);

  const selectedOffsets = new Set<number>();
  const selectedSingleEventRelations = new Set<string>();
  let selectedSingleEventRoutes = 0;
  for (
    let offset = events.length - 1;
    offset >= 0 && selectedSingleEventRoutes < MAX_MATRIX_ACTIVITY_LINKS;
    offset -= 1
  ) {
    const event = events[offset]!;
    if (!isValidVerifiedAgentDispatch(event)) continue;
    const relationKey = `agent-dispatch:${event.verifiedAgentDispatch.relationHash}`;
    if (selectedSingleEventRelations.has(relationKey)) continue;
    if (
      event.observedAtMs <= referenceNowMs - routeTtlMs ||
      event.observedAtMs > referenceNowMs + MAX_FUTURE_CLOCK_SKEW_MS
    ) {
      continue;
    }
    selectedSingleEventRelations.add(relationKey);
    selectedOffsets.add(offset);
    selectedSingleEventRoutes += 1;
  }
  const newestOffsetByRelation = new Map<string, number>();
  const resolvedRelations = new Set<string>();
  for (let offset = events.length - 1; offset >= 0; offset -= 1) {
    const event = events[offset]!;
    for (const relationHash of event.relationHashes.slice(0, MAX_ACTIVITY_RELATIONS)) {
      if (!Number.isSafeInteger(relationHash) || relationHash < 0) continue;
      const relationKey = `${event.category}:${relationHash}`;
      if (resolvedRelations.has(relationKey)) continue;
      const newestOffset = newestOffsetByRelation.get(relationKey);
      if (newestOffset === undefined) {
        newestOffsetByRelation.set(relationKey, offset);
        continue;
      }

      resolvedRelations.add(relationKey);
      const newest = events[newestOffset]!;
      const correlationDurationMs = newest.observedAtMs - event.observedAtMs;
      if (
        !Number.isFinite(correlationDurationMs) ||
        correlationDurationMs < 0 ||
        correlationDurationMs > MATRIX_ACTIVITY_MAX_CORRELATION_MS
      ) {
        continue;
      }
      if (
        newest.observedAtMs <= referenceNowMs - routeTtlMs ||
        newest.observedAtMs > referenceNowMs + MAX_FUTURE_CLOCK_SKEW_MS
      ) {
        continue;
      }
      const additionalEvents =
        Number(!selectedOffsets.has(offset)) + Number(!selectedOffsets.has(newestOffset));
      if (selectedOffsets.size + additionalEvents > MAX_MATRIX_ACTIVITY_EVENTS) continue;
      selectedOffsets.add(offset);
      selectedOffsets.add(newestOffset);
    }
  }

  for (
    let offset = events.length - 1;
    offset >= 0 && selectedOffsets.size < MAX_MATRIX_ACTIVITY_EVENTS;
    offset -= 1
  ) {
    selectedOffsets.add(offset);
  }
  return [...selectedOffsets]
    .toSorted((left, right) => left - right)
    .map((offset) => events[offset]!);
}

/**
 * Converts provider projection activity into category/timing/hash-only events.
 * Summary, prompt, command output, SQL values, URLs, paths, and raw relation
 * identifiers are never retained.
 */
export function deriveMatrixActivityEvents(
  activities: readonly OrchestrationThreadActivity[],
  inputSelection: MatrixActivityInputSelection = ALL_MATRIX_ACTIVITY_INPUTS,
  retentionWindow: MatrixActivityRetentionWindow = {},
): readonly MatrixActivityEvent[] {
  if (!hasSelectedMatrixActivityInput(inputSelection)) return [];

  const sourceActivities = activities.slice(-MAX_MATRIX_ACTIVITY_SOURCE_ACTIVITIES);
  const attestations = collectLifecycleCategoryAttestations(sourceActivities);
  const events: MatrixActivityEvent[] = [];
  for (let sourceOffset = 0; sourceOffset < sourceActivities.length; sourceOffset += 1) {
    const activity = sourceActivities[sourceOffset]!;
    const payload = isRecord(activity.payload) ? activity.payload : null;
    if (!payload) continue;
    const category =
      propagatedLifecycleCategory(activity, payload, attestations, sourceOffset) ??
      genericProviderWorkCategory(activity, payload);
    const observedAtMs = Date.parse(activity.createdAt);
    if (category === null || inputSelection[category] !== true || !Number.isFinite(observedAtMs)) {
      continue;
    }
    const anchorSeed = hashSafeIdentity(String(activity.id));
    const relationHashes = activityRelationHashes(activity, payload);
    const verifiedAgentDispatch = deriveVerifiedAgentDispatch(
      activity,
      payload,
      category,
      attestations,
      anchorSeed,
      relationHashes,
    );
    events.push({
      anchorSeed,
      category,
      observedAtMs,
      relationHashes,
      ...(verifiedAgentDispatch !== undefined ? { verifiedAgentDispatch } : {}),
    });
  }
  return selectBoundedMatrixActivityEvents(events, retentionWindow);
}

export function encodeMatrixActivityEvents(
  events: readonly MatrixActivityEvent[],
  retentionWindow: MatrixActivityRetentionWindow = {},
): string {
  return JSON.stringify(
    selectBoundedMatrixActivityEvents(events, retentionWindow).map((event) => {
      const encoded: Array<number | readonly number[]> = [
        event.anchorSeed,
        CATEGORY_CODE[event.category],
        event.observedAtMs,
        event.relationHashes.slice(0, MAX_ACTIVITY_RELATIONS),
      ];
      if (isValidVerifiedAgentDispatch(event)) {
        encoded.push([
          event.verifiedAgentDispatch.operationAnchorSeed,
          event.verifiedAgentDispatch.relationHash,
        ]);
      }
      return encoded;
    }),
  );
}

export function decodeMatrixActivityEvents(value: string): readonly MatrixActivityEvent[] {
  if (!value || value.length > MAX_MATRIX_ACTIVITY_ENCODED_CHARS) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const events = parsed.flatMap((entry) => {
      if (
        !Array.isArray(entry) ||
        (entry.length !== 4 && entry.length !== 5) ||
        !Number.isInteger(entry[0]) ||
        entry[0] < 0 ||
        entry[0] > 0xffffffff ||
        !Number.isInteger(entry[1]) ||
        !Number.isFinite(entry[2]) ||
        !Array.isArray(entry[3])
      ) {
        return [];
      }
      const category = CODE_CATEGORY[entry[1]];
      if (category === undefined) return [];
      const encodedAgentDispatch = entry[4];
      if (
        encodedAgentDispatch !== undefined &&
        (category !== "agent" ||
          !Array.isArray(encodedAgentDispatch) ||
          encodedAgentDispatch.length !== 2 ||
          !Number.isInteger(encodedAgentDispatch[0]) ||
          encodedAgentDispatch[0] < 0 ||
          encodedAgentDispatch[0] > 0xffffffff ||
          !Number.isSafeInteger(encodedAgentDispatch[1]) ||
          encodedAgentDispatch[1] < 0)
      ) {
        return [];
      }
      const relationHashes = entry[3]
        .filter((hash): hash is number => Number.isSafeInteger(hash) && hash >= 0)
        .slice(0, MAX_ACTIVITY_RELATIONS);
      return [
        {
          anchorSeed: entry[0],
          category,
          observedAtMs: entry[2],
          relationHashes,
          ...(encodedAgentDispatch !== undefined
            ? {
                verifiedAgentDispatch: {
                  operationAnchorSeed: encodedAgentDispatch[0] as number,
                  relationHash: encodedAgentDispatch[1] as number,
                },
              }
            : {}),
        },
      ];
    });
    return selectBoundedMatrixActivityEvents(events);
  } catch {
    return [];
  }
}

/**
 * Projects only the explicitly routed thread. A missing route fails closed,
 * and the routed environment is authoritative over global active selection.
 */
export function selectMatrixActivityEventsKey(
  state: AppState,
  selectedThreadRef: ScopedThreadRef | null = null,
  inputSelection: MatrixActivityInputSelection = ALL_MATRIX_ACTIVITY_INPUTS,
  retentionWindow: MatrixActivityRetentionWindow = {},
): string {
  if (!isRecord(state) || !isRecord(selectedThreadRef)) return "";
  const environmentId = ownDataProperty(selectedThreadRef, "environmentId");
  const threadId = ownDataProperty(selectedThreadRef, "threadId");
  if (!isSafeOwnRecordKey(environmentId) || !isSafeOwnRecordKey(threadId)) return "";
  if (!hasSelectedMatrixActivityInput(inputSelection)) return "[]";

  const environmentStateById = ownDataProperty(state, "environmentStateById");
  const environment = ownDataProperty(environmentStateById, environmentId);
  if (!isRecord(environment)) return "";
  const activityIdsByThreadId = ownDataProperty(environment, "activityIdsByThreadId");
  const activityByThreadId = ownDataProperty(environment, "activityByThreadId");
  const ids = ownDataProperty(activityIdsByThreadId, threadId);
  const byId = ownDataProperty(activityByThreadId, threadId);
  if (!Array.isArray(ids) || !isRecord(byId)) return "";

  const activities = ids.slice(-MAX_MATRIX_ACTIVITY_SOURCE_ACTIVITIES).flatMap((id) => {
    if (!isSafeOwnRecordKey(id)) return [];
    const activity = ownDataProperty(byId, id);
    return isMatrixThreadActivity(activity) ? [activity] : [];
  });
  return encodeMatrixActivityEvents(
    deriveMatrixActivityEvents(activities, inputSelection, retentionWindow),
    retentionWindow,
  );
}

export function createMatrixActivityAnimationState(): MatrixActivityAnimationState {
  return {
    pulses: [],
    links: [],
    pulseCount: 0,
    linkCount: 0,
    relationEventOffsetByHash: new Map(),
    resolvedRelationHashes: new Set(),
    pulseIndexByAnchor: new Map(),
    linkPairs: new Set(),
    reducedMotion: false,
  };
}

export function resolveMatrixActivityTerm(
  category: MatrixActivityCategory,
  semanticRole: MatrixActivityPulse["semanticRole"],
  language: "english" | "japanese" | null,
): string {
  const terms = CATEGORY_TERM[category][language === "japanese" ? "japanese" : "english"];
  return terms[semanticRole === "category" ? 0 : 1];
}

/**
 * This label describes an exact provider-reported lifecycle correlation. It
 * deliberately does not claim a byte rate: activity events contain no
 * provider-observed byte count or measurement interval.
 */
export function resolveMatrixActivityTelemetryLabel(
  category: MatrixActivityCategory,
  language: "english" | "japanese" | null,
): string {
  const operation = resolveMatrixActivityTerm(category, "operation", language);
  return `${operation} • VERIFIED •`.slice(0, MAX_MATRIX_ACTIVITY_TELEMETRY_GLYPHS);
}

function writePulse(
  state: MatrixActivityAnimationState,
  index: number,
  value: MatrixActivityPulse,
): void {
  const target = state.pulses[index];
  if (target) Object.assign(target, value);
  else state.pulses.push(value);
}

function writeLink(
  state: MatrixActivityAnimationState,
  index: number,
  value: MatrixActivityLink,
): void {
  const target = state.links[index];
  if (target) Object.assign(target, value);
  else state.links.push(value);
}

/**
 * Reuses its arrays/maps on every frame. Reduced motion keeps a static route
 * while disabling the traveling packet. The requested TTL changes only exact
 * correlated routes and their endpoints; standalone pulses keep their fixed
 * short lifetime.
 */
export function updateMatrixActivityAnimationInPlace(
  state: MatrixActivityAnimationState,
  events: readonly MatrixActivityEvent[],
  nowMs: number,
  particleCount: number,
  reducedMotion: boolean,
  requestedTtlMs = DEFAULT_MATRIX_ACTIVITY_ROUTE_TTL_MS,
): MatrixActivityAnimationState {
  state.pulseCount = 0;
  state.linkCount = 0;
  state.relationEventOffsetByHash.clear();
  state.resolvedRelationHashes.clear();
  state.pulseIndexByAnchor.clear();
  state.linkPairs.clear();
  state.reducedMotion = reducedMotion;
  if (!Number.isSafeInteger(particleCount) || particleCount <= 0 || !Number.isFinite(nowMs)) {
    return state;
  }
  const ttlMs = resolveMatrixActivityRouteTtlMs(requestedTtlMs);

  const boundedEvents = selectBoundedMatrixActivityEvents(events, {
    nowMs,
    requestedTtlMs: ttlMs,
  });
  interface PreparedEvent {
    readonly event: MatrixActivityEvent;
    readonly eventOffset: number;
    readonly ageMs: number;
    readonly anchorIndex: number;
    readonly pulseIntensity: number;
    readonly pulseLive: boolean;
    readonly routeIntensity: number;
    readonly routeLive: boolean;
  }
  interface LinkCandidate {
    readonly previous: PreparedEvent;
    readonly current: PreparedEvent;
    readonly relationHash: number;
  }
  const preparedEvents: Array<PreparedEvent | undefined> = Array.from({
    length: boundedEvents.length,
  });
  for (let eventOffset = 0; eventOffset < boundedEvents.length; eventOffset += 1) {
    const event = boundedEvents[eventOffset]!;
    if (
      !Number.isInteger(event.anchorSeed) ||
      event.anchorSeed < 0 ||
      event.anchorSeed > 0xffffffff ||
      !Number.isFinite(event.observedAtMs)
    ) {
      continue;
    }
    const ageMs = nowMs - event.observedAtMs;
    if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS) continue;
    const pulseLive = ageMs < MATRIX_ACTIVITY_TTL_MS;
    const routeLive = ageMs < ttlMs;
    preparedEvents[eventOffset] = {
      event,
      eventOffset,
      ageMs,
      anchorIndex: event.anchorSeed % particleCount,
      pulseIntensity: pulseLive
        ? Math.min(
            1,
            Math.max(0, MATRIX_ACTIVITY_TTL_MS - Math.max(0, ageMs)) /
              MATRIX_ACTIVITY_TERMINAL_FADE_MS,
          )
        : 0,
      pulseLive,
      routeIntensity: routeLive
        ? Math.min(1, Math.max(0, ttlMs - Math.max(0, ageMs)) / MATRIX_ACTIVITY_TERMINAL_FADE_MS)
        : 0,
      routeLive,
    };
  }

  const ensurePulse = (
    prepared: PreparedEvent,
    intensity: number,
    semanticRole: MatrixActivityPulse["semanticRole"],
    linkColorHue: number | null,
  ): number | undefined => {
    const existingIndex = state.pulseIndexByAnchor.get(prepared.anchorIndex);
    if (existingIndex !== undefined) {
      const existing = state.pulses[existingIndex];
      if (
        !existing ||
        existing.category !== prepared.event.category ||
        existing.semanticRole !== semanticRole
      ) {
        return undefined;
      }
      existing.intensity = Math.max(existing.intensity, intensity);
      existing.linkColorHue ??= linkColorHue;
      return existingIndex;
    }
    if (state.pulseCount >= MAX_MATRIX_ACTIVITY_EVENTS) return undefined;

    const pulseIndex = state.pulseCount;
    writePulse(state, pulseIndex, {
      anchorIndex: prepared.anchorIndex,
      category: prepared.event.category,
      intensity,
      linkColorHue,
      semanticRole,
    });
    state.pulseIndexByAnchor.set(prepared.anchorIndex, pulseIndex);
    state.pulseCount += 1;
    return pulseIndex;
  };
  const canAssignPulse = (
    prepared: PreparedEvent,
    semanticRole: MatrixActivityPulse["semanticRole"],
  ): boolean => {
    const existingIndex = state.pulseIndexByAnchor.get(prepared.anchorIndex);
    if (existingIndex === undefined) return state.pulseCount < MAX_MATRIX_ACTIVITY_EVENTS;
    const existing = state.pulses[existingIndex];
    return existing?.category === prepared.event.category && existing.semanticRole === semanticRole;
  };

  // Walk newest-to-oldest so each exact relation contributes at most its
  // newest lifecycle pair. Older links in a start/update/completed chain would
  // otherwise share a string whose semantic role cannot be both operation and
  // category at once.
  const candidates: LinkCandidate[] = [];
  // Some providers report an agent delegation as one completed canonical
  // tool event. Others report a launch before the delegated work completes.
  // Give either exact provider-confirmed dispatch two deterministic decorative
  // anchors immediately. A stable relation hash keeps its later completion
  // from creating a duplicate route.
  const verifiedDispatchRelations = new Set<string>();
  const verifiedDispatchSourceRelations = new Set<string>();
  for (let eventOffset = preparedEvents.length - 1; eventOffset >= 0; eventOffset -= 1) {
    const prepared = preparedEvents[eventOffset];
    if (!prepared?.routeLive || !isValidVerifiedAgentDispatch(prepared.event)) continue;
    const verifiedRelationKey = `${prepared.event.category}:${prepared.event.verifiedAgentDispatch.relationHash}`;
    if (verifiedDispatchRelations.has(verifiedRelationKey)) continue;
    verifiedDispatchRelations.add(verifiedRelationKey);
    for (const relationHash of prepared.event.relationHashes) {
      verifiedDispatchSourceRelations.add(`${prepared.event.category}:${relationHash}`);
    }
    let operationAnchorIndex =
      prepared.event.verifiedAgentDispatch.operationAnchorSeed % particleCount;
    if (operationAnchorIndex === prepared.anchorIndex) {
      if (particleCount < 2) continue;
      operationAnchorIndex = (operationAnchorIndex + 1) % particleCount;
    }
    candidates.push({
      previous: prepared,
      current: {
        ...prepared,
        event: {
          anchorSeed: prepared.event.verifiedAgentDispatch.operationAnchorSeed,
          category: prepared.event.category,
          observedAtMs: prepared.event.observedAtMs,
          relationHashes: [],
        },
        anchorIndex: operationAnchorIndex,
      },
      relationHash: prepared.event.verifiedAgentDispatch.relationHash,
    });
  }
  for (let eventOffset = preparedEvents.length - 1; eventOffset >= 0; eventOffset -= 1) {
    const prepared = preparedEvents[eventOffset];
    if (!prepared) continue;
    for (const relationHash of prepared.event.relationHashes.slice(0, MAX_ACTIVITY_RELATIONS)) {
      if (!Number.isSafeInteger(relationHash) || relationHash < 0) continue;
      const relationKey = `${prepared.event.category}:${relationHash}`;
      if (verifiedDispatchSourceRelations.has(relationKey)) continue;
      if (state.resolvedRelationHashes.has(relationKey)) continue;
      const currentEventOffset = state.relationEventOffsetByHash.get(relationKey);
      if (currentEventOffset === undefined) {
        state.relationEventOffsetByHash.set(relationKey, eventOffset);
        continue;
      }
      state.resolvedRelationHashes.add(relationKey);
      const current = preparedEvents[currentEventOffset];
      if (!current?.routeLive || current.anchorIndex === prepared.anchorIndex) continue;
      const correlationDurationMs = current.event.observedAtMs - prepared.event.observedAtMs;
      if (
        !Number.isFinite(correlationDurationMs) ||
        correlationDurationMs < 0 ||
        correlationDurationMs > MATRIX_ACTIVITY_MAX_CORRELATION_MS
      ) {
        continue;
      }
      candidates.push({ previous: prepared, current, relationHash });
    }
  }

  candidates.sort(
    (left, right) =>
      right.current.eventOffset - left.current.eventOffset ||
      right.previous.eventOffset - left.previous.eventOffset,
  );
  for (const candidate of candidates) {
    if (state.linkCount >= MAX_MATRIX_ACTIVITY_LINKS) break;
    const { previous, current, relationHash } = candidate;
    const fromAnchorIndex = Math.min(previous.anchorIndex, current.anchorIndex);
    const toAnchorIndex = Math.max(previous.anchorIndex, current.anchorIndex);
    const pair = `${current.event.category}:${fromAnchorIndex}:${toAnchorIndex}`;
    if (state.linkPairs.has(pair)) continue;
    const colorHue = ((relationHash ^ current.event.anchorSeed) >>> 0) % 360;
    if (!canAssignPulse(previous, "category") || !canAssignPulse(current, "operation")) continue;
    const missingPulseCount =
      Number(!state.pulseIndexByAnchor.has(previous.anchorIndex)) +
      Number(!state.pulseIndexByAnchor.has(current.anchorIndex));
    if (state.pulseCount + missingPulseCount > MAX_MATRIX_ACTIVITY_EVENTS) continue;
    const previousPulseIndex = ensurePulse(previous, current.routeIntensity, "category", colorHue);
    if (previousPulseIndex === undefined) continue;
    const currentPulseIndex = ensurePulse(current, current.routeIntensity, "operation", colorHue);
    if (currentPulseIndex === undefined) continue;

    state.linkPairs.add(pair);
    const linePulsePhase =
      ((Math.max(0, current.ageMs) +
        (((relationHash ^ current.event.anchorSeed) >>> 0) % MATRIX_ACTIVITY_LINK_PULSE_MS)) %
        MATRIX_ACTIVITY_LINK_PULSE_MS) /
      MATRIX_ACTIVITY_LINK_PULSE_MS;
    const trianglePulse = 1 - Math.abs(linePulsePhase * 2 - 1);
    const indicatorFlash = linePulsePhase < 0.12 ? 1 - linePulsePhase / 0.12 : 0;
    writeLink(state, state.linkCount, {
      fromAnchorIndex: previous.anchorIndex,
      toAnchorIndex: current.anchorIndex,
      operationAnchorIndex: current.anchorIndex,
      category: current.event.category,
      // The newest exact lifecycle event owns the visual TTL. The older
      // endpoint remains only as bounded correlation evidence.
      intensity: current.routeIntensity,
      linePulse: reducedMotion
        ? 1
        : Math.min(1, 0.22 + trianglePulse * 0.28 + indicatorFlash * 0.78),
      colorHue,
      packetProgress: reducedMotion
        ? 0
        : (Math.max(0, current.ageMs) % MATRIX_ACTIVITY_PACKET_TRAVEL_MS) /
          MATRIX_ACTIVITY_PACKET_TRAVEL_MS,
    });
    state.linkCount += 1;
  }

  // Add standalone live pulses after route endpoints so no later event can
  // overwrite a connected string's fixed category -> operation role.
  for (let eventOffset = preparedEvents.length - 1; eventOffset >= 0; eventOffset -= 1) {
    const prepared = preparedEvents[eventOffset];
    if (!prepared?.pulseLive) continue;
    if (
      prepared.event.relationHashes.some((relationHash) =>
        verifiedDispatchSourceRelations.has(`${prepared.event.category}:${relationHash}`),
      )
    ) {
      continue;
    }
    ensurePulse(prepared, prepared.pulseIntensity, "category", null);
  }
  return state;
}

function appendDistinctPoint(points: MatrixHexPoint[], point: MatrixHexPoint): void {
  const previous = points.at(-1);
  if (
    previous &&
    Math.abs(previous.x - point.x) < 0.001 &&
    Math.abs(previous.y - point.y) < 0.001
  ) {
    return;
  }
  points.push(point);
}

/**
 * Route using only horizontal and ±60° axial segments. Horizontal-dominant
 * routes use one diagonal with balanced horizontal shoulders. Vertical-
 * dominant routes use two opposing diagonals.
 */
export function createMatrixHexRoute(from: MatrixHexPoint, to: MatrixHexPoint): MatrixHexRoute {
  const points: MatrixHexPoint[] = [{ x: from.x, y: from.y }];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const absoluteY = Math.abs(dy);
  const yDirection = dy < 0 ? -1 : 1;
  const diagonalHorizontal = absoluteY / Math.sqrt(3);

  if (absoluteY < 0.001) {
    appendDistinctPoint(points, { x: to.x, y: to.y });
  } else if (Math.abs(dx) >= diagonalHorizontal) {
    const diagonalX = (dx < 0 ? -1 : 1) * diagonalHorizontal;
    const horizontalRemainder = dx - diagonalX;
    appendDistinctPoint(points, {
      x: from.x + horizontalRemainder / 2,
      y: from.y,
    });
    appendDistinctPoint(points, {
      x: from.x + horizontalRemainder / 2 + diagonalX,
      y: to.y,
    });
    appendDistinctPoint(points, { x: to.x, y: to.y });
  } else {
    const rightHorizontal = (diagonalHorizontal + dx) / 2;
    const leftHorizontal = (diagonalHorizontal - dx) / 2;
    const rightFirstX = from.x + rightHorizontal;
    const leftFirstX = from.x - leftHorizontal;
    const useRightFirst =
      rightFirstX >= 0 && leftFirstX < 0
        ? true
        : leftFirstX >= 0 && rightFirstX < 0
          ? false
          : Math.abs(rightFirstX - to.x) <= Math.abs(leftFirstX - to.x);
    const firstHorizontal = useRightFirst ? rightHorizontal : -leftHorizontal;
    appendDistinctPoint(points, {
      x: from.x + firstHorizontal,
      y: from.y + yDirection * Math.sqrt(3) * Math.abs(firstHorizontal),
    });
    appendDistinctPoint(points, { x: to.x, y: to.y });
  }

  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const length = Math.hypot(current.x - previous.x, current.y - previous.y);
    segmentLengths.push(length);
    totalLength += length;
  }
  return { points, segmentLengths, totalLength };
}

export function createMatrixTunnelRoute(
  from: MatrixHexPoint,
  to: MatrixHexPoint,
  center: MatrixHexPoint,
): MatrixHexRoute {
  const safeFrom = {
    x: Number.isFinite(from.x) ? from.x : 0,
    y: Number.isFinite(from.y) ? from.y : 0,
  };
  const safeTo = {
    x: Number.isFinite(to.x) ? to.x : safeFrom.x,
    y: Number.isFinite(to.y) ? to.y : safeFrom.y,
  };
  const safeCenter = {
    x: Number.isFinite(center.x) ? center.x : (safeFrom.x + safeTo.x) * 0.5,
    y: Number.isFinite(center.y) ? center.y : (safeFrom.y + safeTo.y) * 0.5,
  };
  const points: MatrixHexPoint[] = [{ ...safeFrom }];
  appendDistinctPoint(points, safeCenter);
  appendDistinctPoint(points, safeTo);
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    const length = Math.hypot(current.x - previous.x, current.y - previous.y);
    segmentLengths.push(length);
    totalLength += length;
  }
  return { points, segmentLengths, totalLength };
}

function createMatrixRouteFromPoints(points: readonly MatrixHexPoint[]): MatrixHexRoute {
  const distinctPoints: MatrixHexPoint[] = [];
  for (const point of points) {
    appendDistinctPoint(distinctPoints, {
      x: Number.isFinite(point.x) ? point.x : 0,
      y: Number.isFinite(point.y) ? point.y : 0,
    });
  }
  const segmentLengths: number[] = [];
  let totalLength = 0;
  for (let index = 1; index < distinctPoints.length; index += 1) {
    const previous = distinctPoints[index - 1]!;
    const current = distinctPoints[index]!;
    const length = Math.hypot(current.x - previous.x, current.y - previous.y);
    segmentLengths.push(length);
    totalLength += length;
  }
  return { points: distinctPoints, segmentLengths, totalLength };
}

/**
 * Resolve into caller-owned storage. Tapered routes sample this helper many
 * times per frame, so allocating a fresh point for every subdivision would
 * create avoidable renderer GC pressure at the bounded 12-link maximum.
 */
function resolveMatrixHexRoutePointInPlace(
  output: MutableMatrixHexPoint,
  route: MatrixHexRoute,
  requestedProgress: number,
): void {
  if (route.points.length === 0) {
    output.x = 0;
    output.y = 0;
    return;
  }
  if (route.totalLength <= 0) {
    output.x = route.points[0]!.x;
    output.y = route.points[0]!.y;
    return;
  }
  const progress = Number.isFinite(requestedProgress)
    ? Math.min(1, Math.max(0, requestedProgress))
    : 0;
  if (progress === 0) {
    output.x = route.points[0]!.x;
    output.y = route.points[0]!.y;
    return;
  }
  if (progress === 1) {
    const last = route.points.at(-1)!;
    output.x = last.x;
    output.y = last.y;
    return;
  }
  let remaining = route.totalLength * progress;
  for (let index = 0; index < route.segmentLengths.length; index += 1) {
    const length = route.segmentLengths[index]!;
    const from = route.points[index]!;
    const to = route.points[index + 1]!;
    if (remaining <= length || index === route.segmentLengths.length - 1) {
      const ratio = length <= 0 ? 0 : Math.min(1, remaining / length);
      output.x = from.x + (to.x - from.x) * ratio;
      output.y = from.y + (to.y - from.y) * ratio;
      return;
    }
    remaining -= length;
  }
  const last = route.points.at(-1)!;
  output.x = last.x;
  output.y = last.y;
}

export function matrixHexRoutePointAt(
  route: MatrixHexRoute,
  requestedProgress: number,
): MatrixHexPoint {
  const output: MutableMatrixHexPoint = { x: 0, y: 0 };
  resolveMatrixHexRoutePointInPlace(output, route, requestedProgress);
  return output;
}

/**
 * Attach a Walk connector to each glyph's visible edge instead of drawing
 * through the center of differently scaled text. The reviewed hex bends are
 * retained, and each inset is bounded independently so very large endpoints
 * cannot invert or erase the route.
 */
export function createMatrixActivityWalkAttachmentRoute(
  route: MatrixHexRoute,
  requestedFromFontSize: number,
  requestedToFontSize: number,
): MatrixHexRoute {
  if (route.totalLength <= 0 || route.points.length < 2) return route;
  const maximumInset = route.totalLength * MATRIX_ACTIVITY_WALK_MAX_ROUTE_INSET_RATIO;
  const fromInset = Math.min(
    maximumInset,
    Math.max(
      0,
      (Number.isFinite(requestedFromFontSize) ? requestedFromFontSize : 0) *
        MATRIX_ACTIVITY_WALK_GLYPH_ATTACHMENT_RATIO,
    ),
  );
  const toInset = Math.min(
    maximumInset,
    Math.max(
      0,
      (Number.isFinite(requestedToFontSize) ? requestedToFontSize : 0) *
        MATRIX_ACTIVITY_WALK_GLYPH_ATTACHMENT_RATIO,
    ),
  );
  const startDistance = fromInset;
  const endDistance = route.totalLength - toInset;
  const startPoint: MutableMatrixHexPoint = { x: 0, y: 0 };
  const endPoint: MutableMatrixHexPoint = { x: 0, y: 0 };
  resolveMatrixHexRoutePointInPlace(startPoint, route, startDistance / route.totalLength);
  resolveMatrixHexRoutePointInPlace(endPoint, route, endDistance / route.totalLength);
  const points: MatrixHexPoint[] = [{ ...startPoint }];
  let traversed = 0;
  for (let index = 0; index < route.segmentLengths.length; index += 1) {
    traversed += route.segmentLengths[index]!;
    if (traversed > startDistance && traversed < endDistance) {
      points.push(route.points[index + 1]!);
    }
  }
  points.push({ ...endPoint });
  return createMatrixRouteFromPoints(points);
}

function normalizeMatrixActivityCycleProgress(requestedProgress: number): number {
  if (!Number.isFinite(requestedProgress)) return 0;
  const normalized = requestedProgress % 1;
  return normalized < 0 ? normalized + 1 : normalized;
}

/**
 * Resolve the packet density from the number of routes that can actually be
 * drawn. The route count is capped independently so corrupted renderer state
 * cannot bypass the frame budget.
 */
export function resolveMatrixActivityPacketCount(requestedLinkCount: number): number {
  if (!Number.isFinite(requestedLinkCount)) return 0;
  const linkCount = Math.min(
    MAX_MATRIX_ACTIVITY_LINKS,
    Math.max(0, Math.floor(requestedLinkCount)),
  );
  if (linkCount === 0) return 0;
  return Math.min(
    MATRIX_ACTIVITY_PACKET_COUNT,
    Math.max(
      MATRIX_ACTIVITY_MIN_PACKETS_PER_LINK,
      Math.floor(MAX_MATRIX_ACTIVITY_PACKET_DRAWS / linkCount),
    ),
  );
}

/** Return one deterministic, evenly staggered packet position on a cyclic route. */
export function resolveMatrixActivityPacketProgress(
  baseProgress: number,
  requestedPacketIndex: number,
  requestedPacketCount: number,
): number {
  if (!Number.isFinite(requestedPacketCount)) {
    return normalizeMatrixActivityCycleProgress(baseProgress);
  }
  const packetCount = Math.min(
    MATRIX_ACTIVITY_PACKET_COUNT,
    Math.max(1, Math.floor(requestedPacketCount)),
  );
  const packetIndex = Number.isFinite(requestedPacketIndex)
    ? Math.min(packetCount - 1, Math.max(0, Math.floor(requestedPacketIndex)))
    : 0;
  return normalizeMatrixActivityCycleProgress(baseProgress + packetIndex / packetCount);
}

/**
 * Split a fixed-length cyclic packet trail into one or two bounded route
 * intervals. Returning the tail-end interval first preserves travel order when
 * the trail crosses progress zero.
 */
export function resolveMatrixActivityTrailIntervals(
  packetProgress: number,
  requestedTrailProgress = MATRIX_ACTIVITY_PACKET_TRAIL_PROGRESS,
): readonly MatrixActivityProgressInterval[] {
  const endProgress = normalizeMatrixActivityCycleProgress(packetProgress);
  const trailProgress = Number.isFinite(requestedTrailProgress)
    ? Math.min(1, Math.max(0, requestedTrailProgress))
    : MATRIX_ACTIVITY_PACKET_TRAIL_PROGRESS;
  if (trailProgress === 0) return [];
  if (endProgress >= trailProgress) {
    return [{ startProgress: endProgress - trailProgress, endProgress }];
  }

  const wrappedStartProgress = 1 - (trailProgress - endProgress);
  if (endProgress === 0) {
    return [{ startProgress: wrappedStartProgress, endProgress: 1 }];
  }
  return [
    { startProgress: wrappedStartProgress, endProgress: 1 },
    { startProgress: 0, endProgress },
  ];
}

function traceMatrixHexRoute(context: CanvasRenderingContext2D, route: MatrixHexRoute): void {
  const first = route.points[0];
  if (!first) return;
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < route.points.length; index += 1) {
    const point = route.points[index]!;
    context.lineTo(point.x, point.y);
  }
}

function traceMatrixHexRouteInterval(
  context: CanvasRenderingContext2D,
  route: MatrixHexRoute,
  startProgress: number,
  endProgress: number,
  startPoint: MutableMatrixHexPoint,
  endPoint: MutableMatrixHexPoint,
): void {
  const start = Math.min(startProgress, endProgress);
  const end = Math.max(startProgress, endProgress);
  resolveMatrixHexRoutePointInPlace(startPoint, route, start);
  resolveMatrixHexRoutePointInPlace(endPoint, route, end);
  const startDistance = route.totalLength * start;
  const endDistance = route.totalLength * end;
  context.beginPath();
  context.moveTo(startPoint.x, startPoint.y);
  let traversed = 0;
  for (let index = 0; index < route.segmentLengths.length; index += 1) {
    traversed += route.segmentLengths[index]!;
    if (traversed > startDistance && traversed < endDistance) {
      const bend = route.points[index + 1]!;
      context.lineTo(bend.x, bend.y);
    }
  }
  context.lineTo(endPoint.x, endPoint.y);
}

function clampMatrixActivityDepthScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(
    MAX_MATRIX_ACTIVITY_DEPTH_SCALE,
    Math.max(MIN_MATRIX_ACTIVITY_DEPTH_SCALE, scale),
  );
}

function interpolateMatrixActivityDepthScale(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

/**
 * Resolve the bounded perspective scale at one point along a verified route.
 * Ordinary depth routes interpolate between their projected endpoints. Warp
 * routes narrow to the reviewed center-plane scale before flaring back out.
 */
export function resolveMatrixActivityRouteDepthScale(
  motionMode: FallingEffectMatrixMotionMode,
  requestedProgress: number,
  fromScale: number,
  toScale: number,
  requestedTunnelCenterProgress = 0.5,
): number {
  if (motionMode === "flat") return 1;
  const progress = Number.isFinite(requestedProgress)
    ? Math.min(1, Math.max(0, requestedProgress))
    : 0;
  const safeFromScale = clampMatrixActivityDepthScale(fromScale);
  const safeToScale = clampMatrixActivityDepthScale(toScale);
  if (motionMode !== "tunnel") {
    if (progress === 0) return safeFromScale;
    if (progress === 1) return safeToScale;
    return interpolateMatrixActivityDepthScale(safeFromScale, safeToScale, progress);
  }

  const centerProgress = Number.isFinite(requestedTunnelCenterProgress)
    ? Math.min(1, Math.max(0, requestedTunnelCenterProgress))
    : 0.5;
  if (progress === centerProgress) return MIN_MATRIX_ACTIVITY_DEPTH_SCALE;
  if (progress === 0) return safeFromScale;
  if (progress === 1) return safeToScale;
  if (centerProgress <= 0) {
    return interpolateMatrixActivityDepthScale(
      MIN_MATRIX_ACTIVITY_DEPTH_SCALE,
      safeToScale,
      progress,
    );
  }
  if (centerProgress >= 1) {
    return interpolateMatrixActivityDepthScale(
      safeFromScale,
      MIN_MATRIX_ACTIVITY_DEPTH_SCALE,
      progress,
    );
  }
  return progress <= centerProgress
    ? interpolateMatrixActivityDepthScale(
        safeFromScale,
        MIN_MATRIX_ACTIVITY_DEPTH_SCALE,
        progress / centerProgress,
      )
    : interpolateMatrixActivityDepthScale(
        MIN_MATRIX_ACTIVITY_DEPTH_SCALE,
        safeToScale,
        (progress - centerProgress) / (1 - centerProgress),
      );
}

function resolveMatrixActivityDepthLineWidth(baseWidth: number, depthScale: number): number {
  return Math.min(
    MAX_MATRIX_ACTIVITY_DEPTH_LINE_WIDTH,
    Math.max(MIN_MATRIX_ACTIVITY_DEPTH_LINE_WIDTH, baseWidth * depthScale),
  );
}

function strokeMatrixActivityDepthRoute(
  context: CanvasRenderingContext2D,
  route: MatrixHexRoute,
  baseWidth: number,
  motionMode: FallingEffectMatrixMotionMode,
  fromScale: number,
  toScale: number,
  tunnelCenterProgress: number,
  intervalStartPoint: MutableMatrixHexPoint,
  intervalEndPoint: MutableMatrixHexPoint,
): void {
  if (motionMode === "flat" || route.totalLength <= 0) {
    context.lineWidth =
      motionMode === "flat"
        ? baseWidth
        : resolveMatrixActivityDepthLineWidth(
            baseWidth,
            resolveMatrixActivityRouteDepthScale(
              motionMode,
              0.5,
              fromScale,
              toScale,
              tunnelCenterProgress,
            ),
          );
    traceMatrixHexRoute(context, route);
    context.stroke();
    return;
  }

  for (let index = 0; index < MATRIX_ACTIVITY_DEPTH_ROUTE_SEGMENTS; index += 1) {
    const startProgress = index / MATRIX_ACTIVITY_DEPTH_ROUTE_SEGMENTS;
    const endProgress = (index + 1) / MATRIX_ACTIVITY_DEPTH_ROUTE_SEGMENTS;
    const depthScale = resolveMatrixActivityRouteDepthScale(
      motionMode,
      (startProgress + endProgress) * 0.5,
      fromScale,
      toScale,
      tunnelCenterProgress,
    );
    context.lineWidth = resolveMatrixActivityDepthLineWidth(baseWidth, depthScale);
    traceMatrixHexRouteInterval(
      context,
      route,
      startProgress,
      endProgress,
      intervalStartPoint,
      intervalEndPoint,
    );
    context.stroke();
  }
}

function randomMatrixActivityColor(hue: number): string {
  return `hsl(${hue.toFixed(1)} 86% 62%)`;
}

function resolveMatrixActivityLinkPaint(
  context: CanvasRenderingContext2D,
  colorMode: FallingEffectActivityLinkColorMode,
  matrixColorFrame: MatrixColorFrame,
  from: AtmosphereScene["particles"][number],
  to: AtmosphereScene["particles"][number],
  fromPoint: AtmosphereProjectedPoint,
  toPoint: AtmosphereProjectedPoint,
  colorHue: number,
): string | CanvasGradient {
  if (colorMode === "random") return randomMatrixActivityColor(colorHue);

  const fromColor = resolveMatrixStreamColor(matrixColorFrame, from);
  const toColor = resolveMatrixStreamColor(matrixColorFrame, to);
  if (fromColor === toColor) return fromColor;

  const gradient = context.createLinearGradient(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y);
  gradient.addColorStop(0, fromColor);
  gradient.addColorStop(1, toColor);
  return gradient;
}

function drawMatrixActivityPulse(
  context: CanvasRenderingContext2D,
  particle: AtmosphereScene["particles"][number],
  projectedPoint: AtmosphereProjectedPoint,
  category: MatrixActivityCategory,
  semanticRole: MatrixActivityPulse["semanticRole"],
  paint: string,
  safeOpacity: number,
  intensity: number,
): void {
  const boundedScale = clampMatrixActivityDepthScale(projectedPoint.depthScale);
  context.strokeStyle = paint;
  context.globalAlpha = safeOpacity * intensity;
  context.lineWidth = 0.75 + intensity;
  context.beginPath();
  context.arc(
    projectedPoint.x,
    projectedPoint.y,
    particle.size * boundedScale * (0.75 + (1 - intensity) * 0.9),
    0,
    Math.PI * 2,
  );
  context.stroke();
  context.fillStyle = paint;
  context.globalAlpha = safeOpacity * intensity;
  context.font = `${Math.min(15, Math.max(10, particle.size * boundedScale))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    resolveMatrixActivityTerm(category, semanticRole, particle.matrixLanguage),
    projectedPoint.x,
    projectedPoint.y,
    144 * boundedScale,
  );
}

/**
 * `linkColorHue` is retained on a pulse so shared endpoints have stable
 * paint, but a hue alone is not correlation evidence. Recheck the bounded
 * link list before putting VERIFIED text on an endpoint.
 */
function isVerifiedMatrixActivityOperationEndpoint(
  state: MatrixActivityAnimationState,
  pulse: MatrixActivityPulse,
  renderedLinkCount: number,
): boolean {
  if (pulse.semanticRole !== "operation" || pulse.linkColorHue === null) return false;
  for (let index = 0; index < renderedLinkCount; index += 1) {
    const link = state.links[index];
    if (
      link &&
      link.category === pulse.category &&
      link.operationAnchorIndex === pulse.anchorIndex &&
      link.colorHue === pulse.linkColorHue
    ) {
      return true;
    }
  }
  return false;
}

function resolveRenderedMatrixActivityCount(
  requestedCount: number,
  availableCount: number,
  maximumCount: number,
): number {
  if (!Number.isFinite(requestedCount) || !Number.isFinite(availableCount)) return 0;
  return Math.min(
    maximumCount,
    Math.max(0, Math.floor(requestedCount)),
    Math.max(0, Math.floor(availableCount)),
  );
}

function drawMatrixActivityTelemetryRing(
  context: CanvasRenderingContext2D,
  particle: AtmosphereScene["particles"][number],
  projectedPoint: AtmosphereProjectedPoint,
  category: MatrixActivityCategory,
  paint: string,
  safeOpacity: number,
  intensity: number,
): void {
  const label = resolveMatrixActivityTelemetryLabel(category, particle.matrixLanguage);
  const glyphCount = Math.min(MAX_MATRIX_ACTIVITY_TELEMETRY_GLYPHS, label.length);
  if (glyphCount === 0) return;

  const radius =
    Math.min(30, Math.max(20, particle.size * 1.65)) *
    clampMatrixActivityDepthScale(projectedPoint.depthScale);
  const glyphAngle = (Math.PI * 2) / glyphCount;
  context.save();
  context.translate(projectedPoint.x, projectedPoint.y);
  context.fillStyle = paint;
  context.globalAlpha = safeOpacity * intensity;
  context.font = "7px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  for (let index = 0; index < glyphCount; index += 1) {
    // The outer restore resets the accumulated turn after the final glyph.
    // This avoids one save/restore pair per glyph while retaining the same
    // center-relative transform for every bounded ring.
    if (index > 0) context.rotate(glyphAngle);
    context.fillText(label[index]!, 0, -radius);
  }
  context.restore();
}

export function drawMatrixActivityAnimation(
  context: CanvasRenderingContext2D,
  scene: AtmosphereScene,
  state: MatrixActivityAnimationState,
  atmosphereOpacity: number,
  colorMode: FallingEffectActivityLinkColorMode,
  matrixColorFrame: MatrixColorFrame,
  motionMode: FallingEffectMatrixMotionMode = "flat",
  walkStartFontSize = DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  walkEndFontSize = DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
): void {
  if (scene.kind !== "matrix") return;
  const renderedLinkCount = resolveRenderedMatrixActivityCount(
    state.linkCount,
    state.links.length,
    MAX_MATRIX_ACTIVITY_LINKS,
  );
  const renderedPulseCount = resolveRenderedMatrixActivityCount(
    state.pulseCount,
    state.pulses.length,
    MAX_MATRIX_ACTIVITY_EVENTS,
  );
  if (renderedPulseCount === 0 && renderedLinkCount === 0) return;
  const safeOpacity = Math.min(1, Math.max(0, atmosphereOpacity));
  if (safeOpacity === 0) return;

  context.save();
  context.beginPath();
  context.rect(0, 0, scene.width, scene.height);
  context.clip();
  context.lineCap = "round";
  const projectedFrom: AtmosphereProjectedPoint = { x: 0, y: 0, scale: 1, depthScale: 1 };
  const projectedTo: AtmosphereProjectedPoint = { x: 0, y: 0, scale: 1, depthScale: 1 };
  const fromPoint: MutableMatrixHexPoint = { x: 0, y: 0 };
  const toPoint: MutableMatrixHexPoint = { x: 0, y: 0 };
  const intervalStartPoint: MutableMatrixHexPoint = { x: 0, y: 0 };
  const intervalEndPoint: MutableMatrixHexPoint = { x: 0, y: 0 };
  const packetPoint: MutableMatrixHexPoint = { x: 0, y: 0 };
  const tunnelCenter: MatrixHexPoint = {
    x: scene.width * 0.5,
    y: scene.height * 0.5,
  };
  const packetCount = resolveMatrixActivityPacketCount(renderedLinkCount);
  for (let index = 0; index < renderedLinkCount; index += 1) {
    const link = state.links[index]!;
    const from = scene.particles[link.fromAnchorIndex];
    const to = scene.particles[link.toAnchorIndex];
    if (!from || !to) continue;
    const linkLifecycleOpacity = Math.min(
      resolveMatrixWalkLifecycleOpacity(from, motionMode),
      resolveMatrixWalkLifecycleOpacity(to, motionMode),
    );
    if (linkLifecycleOpacity <= 0.01) continue;
    resolveAtmosphereProjectedPointInPlace(
      projectedFrom,
      scene,
      from,
      from.x,
      from.y,
      motionMode,
      walkStartFontSize,
      walkEndFontSize,
    );
    resolveAtmosphereProjectedPointInPlace(
      projectedTo,
      scene,
      to,
      to.x,
      to.y,
      motionMode,
      walkStartFontSize,
      walkEndFontSize,
    );
    fromPoint.x = Math.min(scene.width, Math.max(0, projectedFrom.x));
    fromPoint.y = Math.min(scene.height, Math.max(0, projectedFrom.y));
    toPoint.x = Math.min(scene.width, Math.max(0, projectedTo.x));
    toPoint.y = Math.min(scene.height, Math.max(0, projectedTo.y));
    const centerRoute =
      motionMode === "tunnel"
        ? createMatrixTunnelRoute(fromPoint, toPoint, tunnelCenter)
        : createMatrixHexRoute(fromPoint, toPoint);
    const walkMode = motionMode === "walk-forward" || motionMode === "walk-reverse";
    const route = walkMode
      ? createMatrixActivityWalkAttachmentRoute(
          centerRoute,
          Math.abs(from.size * projectedFrom.scale),
          Math.abs(to.size * projectedTo.scale),
        )
      : centerRoute;
    const tunnelCenterProgress =
      motionMode === "tunnel" && route.totalLength > 0
        ? Math.min(
            1,
            Math.max(
              0,
              Math.hypot(tunnelCenter.x - fromPoint.x, tunnelCenter.y - fromPoint.y) /
                route.totalLength,
            ),
          )
        : 0.5;
    const linkPaint = resolveMatrixActivityLinkPaint(
      context,
      colorMode,
      matrixColorFrame,
      from,
      to,
      projectedFrom,
      projectedTo,
      link.colorHue,
    );
    context.strokeStyle = linkPaint;
    context.globalAlpha = safeOpacity * link.intensity * linkLifecycleOpacity;
    strokeMatrixActivityDepthRoute(
      context,
      route,
      0.75 + link.intensity * (0.35 + link.linePulse * 0.4),
      motionMode,
      projectedFrom.depthScale,
      projectedTo.depthScale,
      tunnelCenterProgress,
      intervalStartPoint,
      intervalEndPoint,
    );

    if (!state.reducedMotion) {
      // These repeated packets are decorative replay of one verified link,
      // never evidence of event multiplicity, throughput, or transfer rate.
      for (let packetIndex = 0; packetIndex < packetCount; packetIndex += 1) {
        const packetProgress = resolveMatrixActivityPacketProgress(
          link.packetProgress,
          packetIndex,
          packetCount,
        );
        resolveMatrixHexRoutePointInPlace(packetPoint, route, packetProgress);
        context.strokeStyle = linkPaint;
        context.globalAlpha = safeOpacity * link.intensity * linkLifecycleOpacity;
        for (const interval of resolveMatrixActivityTrailIntervals(packetProgress)) {
          const intervalDepthScale = resolveMatrixActivityRouteDepthScale(
            motionMode,
            (interval.startProgress + interval.endProgress) * 0.5,
            projectedFrom.depthScale,
            projectedTo.depthScale,
            tunnelCenterProgress,
          );
          context.lineWidth = resolveMatrixActivityDepthLineWidth(
            1.25 + link.linePulse,
            intervalDepthScale,
          );
          traceMatrixHexRouteInterval(
            context,
            route,
            interval.startProgress,
            interval.endProgress,
            intervalStartPoint,
            intervalEndPoint,
          );
          context.stroke();
        }
        context.fillStyle = linkPaint;
        context.globalAlpha = safeOpacity * link.intensity * linkLifecycleOpacity;
        const packetDepthScale = resolveMatrixActivityRouteDepthScale(
          motionMode,
          packetProgress,
          projectedFrom.depthScale,
          projectedTo.depthScale,
          tunnelCenterProgress,
        );
        context.beginPath();
        context.arc(
          packetPoint.x,
          packetPoint.y,
          Math.min(
            MAX_MATRIX_ACTIVITY_DEPTH_PACKET_RADIUS,
            (1 + link.intensity * 1.4) * packetDepthScale,
          ),
          0,
          Math.PI * 2,
        );
        context.fill();
      }
    }
  }
  let telemetryRingCount = 0;
  for (let index = 0; index < renderedPulseCount; index += 1) {
    const pulse = state.pulses[index]!;
    const particle = scene.particles[pulse.anchorIndex];
    if (!particle) continue;
    const pulseLifecycleOpacity = resolveMatrixWalkLifecycleOpacity(particle, motionMode);
    if (pulseLifecycleOpacity <= 0.01) continue;
    resolveAtmosphereProjectedPointInPlace(
      projectedFrom,
      scene,
      particle,
      particle.x,
      particle.y,
      motionMode,
      walkStartFontSize,
      walkEndFontSize,
    );
    // Matrix routes may interpolate their two endpoint colors. Keep endpoint
    // lettering on its own existing glyph paint; random routes already share
    // that exact hue with both endpoint glyphs and the route.
    const pulsePaint =
      colorMode === "matrix"
        ? resolveMatrixStreamColor(matrixColorFrame, particle)
        : pulse.linkColorHue === null
          ? CATEGORY_COLOR[pulse.category]
          : randomMatrixActivityColor(pulse.linkColorHue);
    drawMatrixActivityPulse(
      context,
      particle,
      projectedFrom,
      pulse.category,
      pulse.semanticRole,
      pulsePaint,
      safeOpacity * pulseLifecycleOpacity,
      pulse.intensity,
    );
    if (
      telemetryRingCount < MAX_MATRIX_ACTIVITY_TELEMETRY_RINGS &&
      isVerifiedMatrixActivityOperationEndpoint(state, pulse, renderedLinkCount)
    ) {
      drawMatrixActivityTelemetryRing(
        context,
        particle,
        projectedFrom,
        pulse.category,
        pulsePaint,
        safeOpacity * pulseLifecycleOpacity,
        pulse.intensity,
      );
      telemetryRingCount += 1;
    }
  }
  context.restore();
}
