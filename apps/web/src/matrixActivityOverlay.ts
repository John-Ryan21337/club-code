import type { OrchestrationThreadActivity, ScopedThreadRef } from "@cafecode/contracts";
import type { FallingEffectActivityLinkColorMode } from "@cafecode/contracts/settings";

import type { AppState } from "./store";
import {
  resolveMatrixStreamColor,
  type AtmosphereScene,
  type MatrixColorFrame,
} from "./windowAtmosphere";

export const MAX_MATRIX_ACTIVITY_EVENTS = 24;
export const MAX_MATRIX_ACTIVITY_ENCODED_CHARS = 8_192;
export const MAX_MATRIX_ACTIVITY_LINKS = 8;
export const MATRIX_ACTIVITY_TTL_MS = 2_200;
/** Keep links fully legible until this short terminal fade begins. */
export const MATRIX_ACTIVITY_TERMINAL_FADE_MS = 400;
// Keep this aligned with the per-thread activity retention cap in store.ts.
// Derivation remains bounded while still seeing every activity the store can
// retain for the selected thread.
const MAX_MATRIX_ACTIVITY_SOURCE_ACTIVITIES = 500;
/** A single provider turn may legitimately contain a full-day build or migration. */
export const MATRIX_ACTIVITY_MAX_CORRELATION_MS = 24 * 60 * 60 * 1_000;
export const MATRIX_ACTIVITY_PACKET_TRAVEL_MS = 720;
export const MATRIX_ACTIVITY_LINK_PULSE_MS = 180;
const MAX_ACTIVITY_RELATIONS = 4;
const MAX_FUTURE_CLOCK_SKEW_MS = 250;
const SAFE_RELATION_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export type MatrixActivityCategory = "network" | "database" | "build";

export interface MatrixActivityInputSelection {
  readonly network: boolean;
  readonly database: boolean;
  readonly build: boolean;
}

export const ALL_MATRIX_ACTIVITY_INPUTS: MatrixActivityInputSelection = {
  network: true,
  database: true,
  build: true,
};

function hasSelectedMatrixActivityInput(selection: MatrixActivityInputSelection): boolean {
  return selection.network === true || selection.database === true || selection.build === true;
}

export interface MatrixActivityEvent {
  readonly anchorSeed: number;
  readonly category: MatrixActivityCategory;
  readonly observedAtMs: number;
  /** Hashes only: raw provider IDs and operation names never reach the canvas. */
  readonly relationHashes: readonly number[];
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

export interface MatrixHexRoute {
  readonly points: readonly MatrixHexPoint[];
  readonly segmentLengths: readonly number[];
  readonly totalLength: number;
}

const CATEGORY_COLOR: Record<MatrixActivityCategory, string> = {
  network: "#38bdf8",
  database: "#a78bfa",
  build: "#fbbf24",
};

const CATEGORY_CODE: Record<MatrixActivityCategory, number> = {
  network: 0,
  database: 1,
  build: 2,
};

const CODE_CATEGORY = ["network", "database", "build"] as const;
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

/**
 * Converts provider projection activity into category/timing/hash-only events.
 * Summary, prompt, command output, SQL values, URLs, paths, and raw relation
 * identifiers are never retained.
 */
export function deriveMatrixActivityEvents(
  activities: readonly OrchestrationThreadActivity[],
  inputSelection: MatrixActivityInputSelection = ALL_MATRIX_ACTIVITY_INPUTS,
): readonly MatrixActivityEvent[] {
  if (!hasSelectedMatrixActivityInput(inputSelection)) return [];

  const events: MatrixActivityEvent[] = [];
  for (const activity of activities.slice(-MAX_MATRIX_ACTIVITY_SOURCE_ACTIVITIES)) {
    const payload = isRecord(activity.payload) ? activity.payload : null;
    if (!payload) continue;
    const category = activityCategory(activity, payload);
    const observedAtMs = Date.parse(activity.createdAt);
    if (category === null || inputSelection[category] !== true || !Number.isFinite(observedAtMs)) {
      continue;
    }
    events.push({
      anchorSeed: hashSafeIdentity(String(activity.id)),
      category,
      observedAtMs,
      relationHashes: activityRelationHashes(activity, payload),
    });
  }
  return events.slice(-MAX_MATRIX_ACTIVITY_EVENTS);
}

export function encodeMatrixActivityEvents(events: readonly MatrixActivityEvent[]): string {
  return JSON.stringify(
    events
      .slice(-MAX_MATRIX_ACTIVITY_EVENTS)
      .map((event) => [
        event.anchorSeed,
        CATEGORY_CODE[event.category],
        event.observedAtMs,
        event.relationHashes.slice(0, MAX_ACTIVITY_RELATIONS),
      ]),
  );
}

export function decodeMatrixActivityEvents(value: string): readonly MatrixActivityEvent[] {
  if (!value || value.length > MAX_MATRIX_ACTIVITY_ENCODED_CHARS) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-MAX_MATRIX_ACTIVITY_EVENTS).flatMap((entry) => {
      if (
        !Array.isArray(entry) ||
        entry.length !== 4 ||
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
      const relationHashes = entry[3]
        .filter((hash): hash is number => Number.isSafeInteger(hash) && hash >= 0)
        .slice(0, MAX_ACTIVITY_RELATIONS);
      return [
        {
          anchorSeed: entry[0],
          category,
          observedAtMs: entry[2],
          relationHashes,
        },
      ];
    });
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
  return encodeMatrixActivityEvents(deriveMatrixActivityEvents(activities, inputSelection));
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
 * while disabling the traveling packet.
 */
export function updateMatrixActivityAnimationInPlace(
  state: MatrixActivityAnimationState,
  events: readonly MatrixActivityEvent[],
  nowMs: number,
  particleCount: number,
  reducedMotion: boolean,
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

  const boundedEvents = events.slice(-MAX_MATRIX_ACTIVITY_EVENTS);
  interface PreparedEvent {
    readonly event: MatrixActivityEvent;
    readonly eventOffset: number;
    readonly ageMs: number;
    readonly anchorIndex: number;
    readonly intensity: number;
    readonly live: boolean;
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
    const live = ageMs < MATRIX_ACTIVITY_TTL_MS;
    preparedEvents[eventOffset] = {
      event,
      eventOffset,
      ageMs,
      anchorIndex: event.anchorSeed % particleCount,
      intensity: live
        ? Math.min(
            1,
            Math.max(0, MATRIX_ACTIVITY_TTL_MS - Math.max(0, ageMs)) /
              MATRIX_ACTIVITY_TERMINAL_FADE_MS,
          )
        : 0,
      live,
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
  for (let eventOffset = preparedEvents.length - 1; eventOffset >= 0; eventOffset -= 1) {
    const prepared = preparedEvents[eventOffset];
    if (!prepared) continue;
    for (const relationHash of prepared.event.relationHashes.slice(0, MAX_ACTIVITY_RELATIONS)) {
      if (!Number.isSafeInteger(relationHash) || relationHash < 0) continue;
      const relationKey = `${prepared.event.category}:${relationHash}`;
      if (state.resolvedRelationHashes.has(relationKey)) continue;
      const currentEventOffset = state.relationEventOffsetByHash.get(relationKey);
      if (currentEventOffset === undefined) {
        state.relationEventOffsetByHash.set(relationKey, eventOffset);
        continue;
      }
      state.resolvedRelationHashes.add(relationKey);
      const current = preparedEvents[currentEventOffset];
      if (!current?.live || current.anchorIndex === prepared.anchorIndex) continue;
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
    const previousPulseIndex = ensurePulse(previous, current.intensity, "category", colorHue);
    if (previousPulseIndex === undefined) continue;
    const currentPulseIndex = ensurePulse(current, current.intensity, "operation", colorHue);
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
      category: current.event.category,
      // The newest exact lifecycle event owns the visual TTL. The older
      // endpoint remains only as bounded correlation evidence.
      intensity: current.intensity,
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
    if (!prepared?.live) continue;
    ensurePulse(prepared, prepared.intensity, "category", null);
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

export function matrixHexRoutePointAt(
  route: MatrixHexRoute,
  requestedProgress: number,
): MatrixHexPoint {
  if (route.points.length === 0) return { x: 0, y: 0 };
  if (route.totalLength <= 0) return route.points[0]!;
  const progress = Number.isFinite(requestedProgress)
    ? Math.min(1, Math.max(0, requestedProgress))
    : 0;
  if (progress === 0) return route.points[0]!;
  if (progress === 1) return route.points.at(-1)!;
  let remaining = route.totalLength * progress;
  for (let index = 0; index < route.segmentLengths.length; index += 1) {
    const length = route.segmentLengths[index]!;
    const from = route.points[index]!;
    const to = route.points[index + 1]!;
    if (remaining <= length || index === route.segmentLengths.length - 1) {
      const ratio = length <= 0 ? 0 : Math.min(1, remaining / length);
      return {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio,
      };
    }
    remaining -= length;
  }
  return route.points.at(-1)!;
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
): void {
  const start = Math.min(startProgress, endProgress);
  const end = Math.max(startProgress, endProgress);
  const startPoint = matrixHexRoutePointAt(route, start);
  const endPoint = matrixHexRoutePointAt(route, end);
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

function randomMatrixActivityColor(hue: number): string {
  return `hsl(${hue.toFixed(1)} 86% 62%)`;
}

function resolveMatrixActivityLinkPaint(
  context: CanvasRenderingContext2D,
  colorMode: FallingEffectActivityLinkColorMode,
  matrixColorFrame: MatrixColorFrame,
  from: AtmosphereScene["particles"][number],
  to: AtmosphereScene["particles"][number],
  colorHue: number,
): string | CanvasGradient {
  if (colorMode === "random") return randomMatrixActivityColor(colorHue);

  const fromColor = resolveMatrixStreamColor(matrixColorFrame, from);
  const toColor = resolveMatrixStreamColor(matrixColorFrame, to);
  if (fromColor === toColor) return fromColor;

  const gradient = context.createLinearGradient(from.x, from.y, to.x, to.y);
  gradient.addColorStop(0, fromColor);
  gradient.addColorStop(1, toColor);
  return gradient;
}

function drawMatrixActivityPulse(
  context: CanvasRenderingContext2D,
  particle: AtmosphereScene["particles"][number],
  category: MatrixActivityCategory,
  semanticRole: MatrixActivityPulse["semanticRole"],
  paint: string,
  safeOpacity: number,
  intensity: number,
): void {
  context.strokeStyle = paint;
  context.globalAlpha = safeOpacity * intensity;
  context.lineWidth = 0.75 + intensity;
  context.beginPath();
  context.arc(
    particle.x,
    particle.y,
    particle.size * (0.75 + (1 - intensity) * 0.9),
    0,
    Math.PI * 2,
  );
  context.stroke();
  context.fillStyle = paint;
  context.globalAlpha = safeOpacity * intensity;
  context.font = `${Math.min(15, Math.max(10, particle.size))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    resolveMatrixActivityTerm(category, semanticRole, particle.matrixLanguage),
    particle.x,
    particle.y,
    144,
  );
}

export function drawMatrixActivityAnimation(
  context: CanvasRenderingContext2D,
  scene: AtmosphereScene,
  state: MatrixActivityAnimationState,
  atmosphereOpacity: number,
  colorMode: FallingEffectActivityLinkColorMode,
  matrixColorFrame: MatrixColorFrame,
): void {
  if (scene.kind !== "matrix" || (state.pulseCount === 0 && state.linkCount === 0)) return;
  const safeOpacity = Math.min(1, Math.max(0, atmosphereOpacity));
  if (safeOpacity === 0) return;

  context.save();
  context.beginPath();
  context.rect(0, 0, scene.width, scene.height);
  context.clip();
  context.lineCap = "round";
  for (let index = 0; index < state.linkCount; index += 1) {
    const link = state.links[index]!;
    const from = scene.particles[link.fromAnchorIndex];
    const to = scene.particles[link.toAnchorIndex];
    if (!from || !to) continue;
    const route = createMatrixHexRoute(
      {
        x: Math.min(scene.width, Math.max(0, from.x)),
        y: Math.min(scene.height, Math.max(0, from.y)),
      },
      {
        x: Math.min(scene.width, Math.max(0, to.x)),
        y: Math.min(scene.height, Math.max(0, to.y)),
      },
    );
    const linkPaint = resolveMatrixActivityLinkPaint(
      context,
      colorMode,
      matrixColorFrame,
      from,
      to,
      link.colorHue,
    );
    context.strokeStyle = linkPaint;
    context.globalAlpha = safeOpacity * link.intensity;
    context.lineWidth = 0.75 + link.intensity * (0.35 + link.linePulse * 0.4);
    traceMatrixHexRoute(context, route);
    context.stroke();

    if (!state.reducedMotion) {
      const packet = matrixHexRoutePointAt(route, link.packetProgress);
      const trailProgress = Math.max(0, link.packetProgress - 0.12);
      context.strokeStyle = linkPaint;
      context.globalAlpha = safeOpacity * link.intensity;
      context.lineWidth = 1.25 + link.linePulse;
      traceMatrixHexRouteInterval(context, route, trailProgress, link.packetProgress);
      context.stroke();
      context.fillStyle = linkPaint;
      context.globalAlpha = safeOpacity * link.intensity;
      context.beginPath();
      context.arc(packet.x, packet.y, 1 + link.intensity * 1.4, 0, Math.PI * 2);
      context.fill();
    }
  }
  for (let index = 0; index < state.pulseCount; index += 1) {
    const pulse = state.pulses[index]!;
    const particle = scene.particles[pulse.anchorIndex];
    if (!particle) continue;
    drawMatrixActivityPulse(
      context,
      particle,
      pulse.category,
      pulse.semanticRole,
      colorMode === "matrix"
        ? resolveMatrixStreamColor(matrixColorFrame, particle)
        : pulse.linkColorHue === null
          ? CATEGORY_COLOR[pulse.category]
          : randomMatrixActivityColor(pulse.linkColorHue),
      safeOpacity,
      pulse.intensity,
    );
  }
  context.restore();
}
