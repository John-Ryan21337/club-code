import type { OrchestrationThreadActivity } from "@cafecode/contracts";
import type { FallingEffectActivityLinkColorMode } from "@cafecode/contracts/settings";

import type { AppState } from "./store";
import {
  resolveMatrixStreamColor,
  type AtmosphereScene,
  type MatrixColorFrame,
} from "./windowAtmosphere";

export const MAX_MATRIX_ACTIVITY_EVENTS = 24;
export const MAX_MATRIX_ACTIVITY_LINKS = 8;
export const MATRIX_ACTIVITY_TTL_MS = 2_200;
export const MATRIX_ACTIVITY_PACKET_TRAVEL_MS = 720;
export const MATRIX_ACTIVITY_LINK_PULSE_MS = 180;
const MAX_ACTIVITY_RELATIONS = 4;
const MAX_FUTURE_CLOCK_SKEW_MS = 250;
const SAFE_RELATION_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;

export type MatrixActivityCategory = "network" | "database" | "build";

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
  readonly relationAnchorByHash: Map<number, number>;
  readonly relationPulseIndexByHash: Map<number, number>;
  readonly linkPairs: Set<number>;
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

function hashSafeIdentity(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

function safeRelationHash(namespace: string, value: unknown): number | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!SAFE_RELATION_VALUE.test(normalized)) return null;
  return hashSafeIdentity(`${namespace}:${normalized}`);
}

function activityCategory(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
): MatrixActivityCategory | null {
  const observed = isRecord(payload.observed) ? payload.observed : null;
  const explicitlyObserved = observed?.providerObserved === true;
  const providerLifecycle = /^tool\.(?:started|updated|completed)$/u.test(activity.kind);
  if (!explicitlyObserved && !providerLifecycle) return null;

  const values = [
    payload.itemType,
    payload.requestKind,
    payload.requestType,
    // Only structured provider fields participate. Free-form title/detail can
    // contain prompts, commands, URLs, SQL, or output and are never inspected.
    observed?.operation,
    observed?.activityType,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.slice(0, 192))
    .join(" ");
  if (/\b(?:network|web[_ -]?search|browser|fetch|download|http|curl)\b/iu.test(values)) {
    return "network";
  }
  if (/\b(?:database|sqlite|sql|query)\b/iu.test(values)) {
    return "database";
  }
  if (/\b(?:build|bundle|compile|compiler|transpile)\b/iu.test(values)) {
    return "build";
  }
  return null;
}

function activityRelationHashes(payload: Record<string, unknown>): readonly number[] {
  const hashes: number[] = [];
  const itemId = safeRelationHash("tool", payload.itemId);
  if (itemId !== null) hashes.push(itemId);

  const observed = isRecord(payload.observed) ? payload.observed : null;
  if (observed?.providerObserved === true) {
    for (const [namespace, value] of [["tool", observed.toolId]] as const) {
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
): readonly MatrixActivityEvent[] {
  const events: MatrixActivityEvent[] = [];
  for (const activity of activities.slice(-160)) {
    const payload = isRecord(activity.payload) ? activity.payload : null;
    if (!payload) continue;
    const category = activityCategory(activity, payload);
    const observedAtMs = Date.parse(activity.createdAt);
    if (category === null || !Number.isFinite(observedAtMs)) continue;
    events.push({
      anchorSeed: hashSafeIdentity(String(activity.id)),
      category,
      observedAtMs,
      relationHashes: activityRelationHashes(payload),
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
  if (!value) return [];
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
        .filter((hash): hash is number => Number.isInteger(hash) && hash >= 0 && hash <= 0xffffffff)
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

export function selectMatrixActivityEventsKey(state: AppState): string {
  const environmentId = state.activeEnvironmentId;
  if (!environmentId) return "";
  const environment = state.environmentStateById[environmentId];
  if (!environment) return "";
  const activities = environment.threadIds
    .filter((threadId) => environment.threadSessionById[threadId]?.status === "running")
    .flatMap((threadId) => {
      const ids = environment.activityIdsByThreadId[threadId] ?? [];
      const byId = environment.activityByThreadId[threadId] ?? {};
      return ids.slice(-80).flatMap((id) => {
        const activity = byId[id];
        return activity ? [activity] : [];
      });
    })
    .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-160);
  return encodeMatrixActivityEvents(deriveMatrixActivityEvents(activities));
}

export function createMatrixActivityAnimationState(): MatrixActivityAnimationState {
  return {
    pulses: [],
    links: [],
    pulseCount: 0,
    linkCount: 0,
    relationAnchorByHash: new Map(),
    relationPulseIndexByHash: new Map(),
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
 * Reuses its arrays/maps on every frame. Reduced motion keeps a dim static
 * route while disabling the traveling white packet.
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
  state.relationAnchorByHash.clear();
  state.relationPulseIndexByHash.clear();
  state.linkPairs.clear();
  state.reducedMotion = reducedMotion;
  if (particleCount <= 0 || !Number.isFinite(nowMs)) return state;

  for (const event of events.slice(-MAX_MATRIX_ACTIVITY_EVENTS)) {
    const ageMs = nowMs - event.observedAtMs;
    if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS || ageMs >= MATRIX_ACTIVITY_TTL_MS) continue;
    const intensity =
      Math.pow(1 - Math.max(0, ageMs) / MATRIX_ACTIVITY_TTL_MS, 2) * (reducedMotion ? 0.18 : 1);
    const anchorIndex = event.anchorSeed % particleCount;
    writePulse(state, state.pulseCount, {
      anchorIndex,
      category: event.category,
      intensity,
      semanticRole: "category",
    });
    const currentPulseIndex = state.pulseCount;
    state.pulseCount += 1;

    for (const relationHash of event.relationHashes) {
      const previousAnchor = state.relationAnchorByHash.get(relationHash);
      const previousPulseIndex = state.relationPulseIndexByHash.get(relationHash);
      if (
        previousAnchor !== undefined &&
        previousPulseIndex !== undefined &&
        previousAnchor !== anchorIndex &&
        state.pulses[previousPulseIndex]?.category === event.category &&
        state.linkCount < MAX_MATRIX_ACTIVITY_LINKS
      ) {
        const fromAnchorIndex = Math.min(previousAnchor, anchorIndex);
        const toAnchorIndex = Math.max(previousAnchor, anchorIndex);
        const pair = fromAnchorIndex * 256 + toAnchorIndex;
        if (!state.linkPairs.has(pair)) {
          state.linkPairs.add(pair);
          // A concrete provider item/tool identity and matching category are
          // both required before two strings carry a category -> operation
          // pair. Agent identity, repeated operation names, and cross-category
          // events are deliberately too weak to imply a route.
          const previousPulse = state.pulses[previousPulseIndex];
          const currentPulse = state.pulses[currentPulseIndex];
          if (previousPulse) previousPulse.semanticRole = "category";
          if (currentPulse) currentPulse.semanticRole = "operation";
          const linePulsePhase =
            ((Math.max(0, ageMs) +
              (((relationHash ^ event.anchorSeed) >>> 0) % MATRIX_ACTIVITY_LINK_PULSE_MS)) %
              MATRIX_ACTIVITY_LINK_PULSE_MS) /
            MATRIX_ACTIVITY_LINK_PULSE_MS;
          const trianglePulse = 1 - Math.abs(linePulsePhase * 2 - 1);
          const indicatorFlash = linePulsePhase < 0.12 ? 1 - linePulsePhase / 0.12 : 0;
          writeLink(state, state.linkCount, {
            fromAnchorIndex: previousAnchor,
            toAnchorIndex: anchorIndex,
            category: event.category,
            intensity: Math.min(
              intensity,
              state.pulses[previousPulseIndex]?.intensity ?? intensity,
            ),
            // A short hash-phased indicator flash rides a softer triangular
            // pulse. Both derive from event age, so no timer or retained
            // animation state is required.
            linePulse: reducedMotion
              ? 1
              : Math.min(1, 0.22 + trianglePulse * 0.28 + indicatorFlash * 0.78),
            colorHue: ((relationHash ^ event.anchorSeed) >>> 0) % 360,
            packetProgress: reducedMotion
              ? 0
              : (Math.max(0, ageMs) % MATRIX_ACTIVITY_PACKET_TRAVEL_MS) /
                MATRIX_ACTIVITY_PACKET_TRAVEL_MS,
          });
          state.linkCount += 1;
        }
      }
      state.relationAnchorByHash.set(relationHash, anchorIndex);
      state.relationPulseIndexByHash.set(relationHash, currentPulseIndex);
    }
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
    context.strokeStyle =
      colorMode === "matrix"
        ? resolveMatrixStreamColor(matrixColorFrame, from)
        : `hsl(${link.colorHue.toFixed(1)} 86% 62%)`;
    context.globalAlpha = Math.min(0.28, safeOpacity * 0.38) * link.intensity * link.linePulse;
    context.lineWidth = 0.75 + link.intensity * (0.35 + link.linePulse * 0.4);
    traceMatrixHexRoute(context, route);
    context.stroke();

    if (state.reducedMotion) continue;
    const packet = matrixHexRoutePointAt(route, link.packetProgress);
    const trailProgress = Math.max(0, link.packetProgress - 0.12);
    context.strokeStyle = "#ffffff";
    context.globalAlpha = Math.min(0.22, safeOpacity * 0.3) * link.intensity;
    context.lineWidth = 1;
    traceMatrixHexRouteInterval(context, route, trailProgress, link.packetProgress);
    context.stroke();
    context.fillStyle = "#ffffff";
    context.globalAlpha = Math.min(0.62, safeOpacity * 0.7) * link.intensity;
    context.beginPath();
    context.arc(packet.x, packet.y, 1 + link.intensity * 1.4, 0, Math.PI * 2);
    context.fill();
  }
  for (let index = 0; index < state.pulseCount; index += 1) {
    const pulse = state.pulses[index]!;
    const particle = scene.particles[pulse.anchorIndex];
    if (!particle) continue;
    context.strokeStyle =
      colorMode === "matrix"
        ? resolveMatrixStreamColor(matrixColorFrame, particle)
        : CATEGORY_COLOR[pulse.category];
    context.globalAlpha = Math.min(0.38, safeOpacity * 0.5) * pulse.intensity;
    context.lineWidth = 0.75 + pulse.intensity;
    context.beginPath();
    context.arc(
      particle.x,
      particle.y,
      particle.size * (0.75 + (1 - pulse.intensity) * 0.9),
      0,
      Math.PI * 2,
    );
    context.stroke();
    context.fillStyle = context.strokeStyle;
    context.globalAlpha = Math.min(0.62, safeOpacity * 0.78) * pulse.intensity;
    context.font = `${Math.min(15, Math.max(10, particle.size))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      resolveMatrixActivityTerm(pulse.category, pulse.semanticRole, particle.matrixLanguage),
      particle.x,
      particle.y,
      144,
    );
  }
  context.restore();
}
