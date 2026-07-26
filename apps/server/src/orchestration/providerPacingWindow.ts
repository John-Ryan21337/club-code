import type {
  ProviderDriverKind,
  ServerProviderAccountRateLimitSnapshot,
  ServerProviderAccountRateLimitWindow,
  ServerProviderAccountRateLimits,
} from "@cafecode/contracts";

import type { PacingWindowObservation } from "./drainFirstPacingPolicy.ts";

export interface ProviderPacingWindowInput {
  readonly driver: ProviderDriverKind;
  readonly accountRateLimits?: ServerProviderAccountRateLimits;
}

export interface ProviderPacingWindowSelection {
  readonly providerFamily: PacingWindowObservation["providerFamily"];
  readonly usedPercent: number | null;
  readonly resetsAtMs: number | null;
  readonly windowDurationMs: number | null;
  /** Provider timestamp for freshness checks. It is never used as local observation time. */
  readonly sourceCheckedAtMs: number | null;
  /**
   * Stable evidence identity. A registry replay or health refresh with the
   * same quota payload yields the same fingerprint.
   */
  readonly usageFingerprint: string | null;
  readonly rateLimitReachedType: string | null;
  readonly spendControlReached: boolean | null;
}

interface WindowCandidate {
  readonly snapshotIdentity: string;
  readonly snapshot: ServerProviderAccountRateLimitSnapshot;
  readonly slot: "primary" | "secondary";
  readonly window: ServerProviderAccountRateLimitWindow;
  readonly sourcePriority: number;
}

const MINUTES_TO_MS = 60_000;
const SECONDS_TO_MS = 1_000;
const CLAUDE_CANONICAL_WINDOW_MINUTES = 300;
const CODEX_CANONICAL_WINDOW_MINUTES = 10_080;
const CLAUDE_MIN_WINDOW_MINUTES = 3 * 60;
const CLAUDE_MAX_WINDOW_MINUTES = 6 * 60;
const CODEX_MIN_WINDOW_MINUTES = 6 * 24 * 60;
const CODEX_MAX_WINDOW_MINUTES = 8 * 24 * 60;

export function providerPacingFamily(
  driver: ProviderDriverKind,
): PacingWindowObservation["providerFamily"] {
  if (driver === "claudeAgent") return "claude";
  if (driver === "codex") return "codex";
  return "other";
}

function finitePercent(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function safePositiveUnitConversion(
  value: number | null | undefined,
  multiplier: number,
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > Number.MAX_SAFE_INTEGER / multiplier
  ) {
    return null;
  }
  return value * multiplier;
}

function checkedAtMs(checkedAt: string): number | null {
  const parsed = Date.parse(checkedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

function snapshotCandidates(
  rateLimits: ServerProviderAccountRateLimits,
  driver: ProviderDriverKind,
): ReadonlyArray<{
  readonly identity: string;
  readonly snapshot: ServerProviderAccountRateLimitSnapshot;
  readonly priority: number;
}> {
  const candidates: Array<{
    readonly identity: string;
    readonly snapshot: ServerProviderAccountRateLimitSnapshot;
    readonly priority: number;
  }> = [];
  const byLimitId = rateLimits.rateLimitsByLimitId ?? {};
  const exactDriverSnapshot = byLimitId[String(driver)];
  if (exactDriverSnapshot !== undefined) {
    candidates.push({
      identity: `limit:${String(driver)}`,
      snapshot: exactDriverSnapshot,
      priority: 0,
    });
  }
  candidates.push({ identity: "default", snapshot: rateLimits.rateLimits, priority: 1 });
  for (const identity of Object.keys(byLimitId).toSorted()) {
    if (identity === String(driver)) continue;
    const snapshot = byLimitId[identity];
    if (snapshot !== undefined) {
      candidates.push({ identity: `limit:${identity}`, snapshot, priority: 2 });
    }
  }
  return candidates;
}

function durationIsInFamilyRange(
  providerFamily: PacingWindowObservation["providerFamily"],
  durationMinutes: number | null | undefined,
): durationMinutes is number {
  if (typeof durationMinutes !== "number" || !Number.isSafeInteger(durationMinutes)) return false;
  if (providerFamily === "claude") {
    return (
      durationMinutes >= CLAUDE_MIN_WINDOW_MINUTES && durationMinutes <= CLAUDE_MAX_WINDOW_MINUTES
    );
  }
  if (providerFamily === "codex") {
    return (
      durationMinutes >= CODEX_MIN_WINDOW_MINUTES && durationMinutes <= CODEX_MAX_WINDOW_MINUTES
    );
  }
  return false;
}

function selectWindowCandidate(
  rateLimits: ServerProviderAccountRateLimits,
  driver: ProviderDriverKind,
  providerFamily: PacingWindowObservation["providerFamily"],
): WindowCandidate | null {
  const candidates: WindowCandidate[] = [];
  for (const source of snapshotCandidates(rateLimits, driver)) {
    for (const slot of ["primary", "secondary"] as const) {
      const window = source.snapshot[slot];
      if (
        window !== null &&
        window !== undefined &&
        durationIsInFamilyRange(providerFamily, window.windowDurationMins)
      ) {
        candidates.push({
          snapshotIdentity: source.identity,
          snapshot: source.snapshot,
          slot,
          window,
          sourcePriority: source.priority,
        });
      }
    }
  }
  const canonicalDuration =
    providerFamily === "claude" ? CLAUDE_CANONICAL_WINDOW_MINUTES : CODEX_CANONICAL_WINDOW_MINUTES;
  return (
    candidates.toSorted((left, right) => {
      if (left.sourcePriority !== right.sourcePriority) {
        return left.sourcePriority - right.sourcePriority;
      }
      const durationDelta =
        Math.abs(left.window.windowDurationMins! - canonicalDuration) -
        Math.abs(right.window.windowDurationMins! - canonicalDuration);
      if (durationDelta !== 0) return durationDelta;
      return left.slot.localeCompare(right.slot);
    })[0] ?? null
  );
}

export function selectProviderPacingWindow(
  input: ProviderPacingWindowInput,
): ProviderPacingWindowSelection {
  const providerFamily = providerPacingFamily(input.driver);
  const rateLimits = input.accountRateLimits;
  if (providerFamily === "other" || rateLimits === undefined) {
    return {
      providerFamily,
      usedPercent: null,
      resetsAtMs: null,
      windowDurationMs: null,
      sourceCheckedAtMs: null,
      usageFingerprint: null,
      rateLimitReachedType: null,
      spendControlReached: null,
    };
  }

  const selected = selectWindowCandidate(rateLimits, input.driver, providerFamily);
  if (selected === null) {
    return {
      providerFamily,
      usedPercent: null,
      resetsAtMs: null,
      windowDurationMs: null,
      sourceCheckedAtMs: checkedAtMs(rateLimits.checkedAt),
      usageFingerprint: null,
      rateLimitReachedType: null,
      spendControlReached: null,
    };
  }

  const usedPercent = finitePercent(selected.window.usedPercent);
  const resetsAtMs = safePositiveUnitConversion(selected.window.resetsAt, SECONDS_TO_MS);
  const windowDurationMs = safePositiveUnitConversion(
    selected.window.windowDurationMins,
    MINUTES_TO_MS,
  );
  const rateLimitReachedType = selected.snapshot.rateLimitReachedType ?? null;
  const spendControlReached = selected.snapshot.spendControlReached ?? null;
  const sourceCheckedAtMs = checkedAtMs(rateLimits.checkedAt);
  const usageFingerprint = JSON.stringify([
    providerFamily,
    selected.snapshotIdentity,
    selected.slot,
    usedPercent,
    resetsAtMs,
    windowDurationMs,
    rateLimitReachedType,
    spendControlReached,
    sourceCheckedAtMs,
  ]);

  return {
    providerFamily,
    usedPercent,
    resetsAtMs,
    windowDurationMs,
    sourceCheckedAtMs,
    usageFingerprint,
    rateLimitReachedType,
    spendControlReached,
  };
}
