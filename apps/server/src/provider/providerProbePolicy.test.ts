import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_PROVIDER_INCONCLUSIVE_FAILURE_THRESHOLD,
  deterministicProviderProbePhaseOffsetMs,
  hasConclusiveProviderAuthState,
  reconcileInconclusiveProviderProbeStreak,
  retainConclusiveProviderState,
} from "./providerProbePolicy.ts";

const conclusiveProvider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "0.133.0",
  status: "ready",
  auth: { status: "authenticated", type: "chatgpt", email: "safe@example.com" },
  checkedAt: "2026-04-14T00:00:00.000Z",
  message: "Signed in as safe@example.com.",
  models: [],
  slashCommands: [],
  skills: [],
  accountRateLimits: {
    rateLimits: { primary: { usedPercent: 12 } },
    checkedAt: "2026-04-14T00:00:00.000Z",
  },
} as const satisfies ServerProvider;

const inconclusiveProvider = {
  ...conclusiveProvider,
  version: "0.134.0",
  status: "warning",
  auth: { status: "unknown" },
  checkedAt: "2026-04-14T00:05:00.000Z",
  message: "Codex CLI login status check timed out. Provider sessions may still work.",
  accountRateLimits: undefined,
  probeDiagnostics: {
    attemptCount: 1,
    consecutiveInconclusiveCount: 1,
    lastOutcome: "inconclusive",
    lastStartedAt: "2026-04-14T00:04:56.000Z",
    lastFinishedAt: "2026-04-14T00:05:00.000Z",
    lastDurationMs: 4_000,
    periodicIntervalMs: 300_000,
    periodicPhaseOffsetMs: 42_000,
    nextScheduledAt: "2026-04-14T00:10:42.000Z",
  },
} as unknown as ServerProvider;

const withDiagnostics = (
  provider: ServerProvider,
  diagnostics: Partial<NonNullable<ServerProvider["probeDiagnostics"]>>,
): ServerProvider => ({
  ...provider,
  probeDiagnostics: {
    ...(provider.probeDiagnostics ?? {
      attemptCount: 0,
      consecutiveInconclusiveCount: 0,
      lastOutcome: "pending" as const,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastDurationMs: null,
      periodicIntervalMs: null,
      periodicPhaseOffsetMs: null,
      nextScheduledAt: null,
    }),
    ...diagnostics,
  },
});

describe("DEFAULT_PROVIDER_INCONCLUSIVE_FAILURE_THRESHOLD", () => {
  it("keeps the bounded two-retain / third-visible policy in one place", () => {
    expect(DEFAULT_PROVIDER_INCONCLUSIVE_FAILURE_THRESHOLD).toBe(3);
  });
});

describe("deterministicProviderProbePhaseOffsetMs", () => {
  it("derives a stable in-range phase from the public instance id", () => {
    const intervalMs = 300_000;
    const codex = deterministicProviderProbePhaseOffsetMs(
      ProviderInstanceId.make("codex"),
      intervalMs,
    );

    expect(codex).toBe(
      deterministicProviderProbePhaseOffsetMs(ProviderInstanceId.make("codex"), intervalMs),
    );
    expect(codex).toBeGreaterThanOrEqual(0);
    expect(codex).toBeLessThan(intervalMs);
    expect(Number.isInteger(codex)).toBe(true);
  });

  it("spreads sibling instances across the interval", () => {
    const intervalMs = 300_000;
    const offsets = ["codex", "codex_work", "codex_personal", "claudeAgent", "opencode"].map(
      (instanceId) =>
        deterministicProviderProbePhaseOffsetMs(ProviderInstanceId.make(instanceId), intervalMs),
    );

    expect(new Set(offsets).size).toBe(offsets.length);
  });

  it("clamps a degenerate interval instead of producing NaN", () => {
    for (const intervalMs of [0, -1, 0.4, Number.NaN]) {
      const offset = deterministicProviderProbePhaseOffsetMs(
        ProviderInstanceId.make("codex"),
        intervalMs,
      );
      expect(Number.isFinite(offset)).toBe(true);
      expect(offset).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("hasConclusiveProviderAuthState", () => {
  it("accepts a probed auth state and rejects unknown or disabled providers", () => {
    expect(hasConclusiveProviderAuthState(conclusiveProvider)).toBe(true);
    expect(
      hasConclusiveProviderAuthState({
        ...conclusiveProvider,
        auth: { status: "unauthenticated" },
      }),
    ).toBe(true);
    expect(
      hasConclusiveProviderAuthState({ ...conclusiveProvider, auth: { status: "unknown" } }),
    ).toBe(false);
    expect(hasConclusiveProviderAuthState({ ...conclusiveProvider, status: "disabled" })).toBe(
      false,
    );
  });
});

describe("retainConclusiveProviderState", () => {
  it("keeps the known-good presentation while landing fresh install metadata", () => {
    const retained = retainConclusiveProviderState(conclusiveProvider, inconclusiveProvider);

    expect(retained.status).toBe("ready");
    expect(retained.auth).toEqual(conclusiveProvider.auth);
    expect(retained.checkedAt).toBe(conclusiveProvider.checkedAt);
    expect(retained.message).toBe(conclusiveProvider.message);
    expect(retained.accountRateLimits).toEqual(conclusiveProvider.accountRateLimits);
    // Installation/version/model facts are not auth assertions, so the
    // inconclusive probe's fresh values still land.
    expect(retained.version).toBe("0.134.0");
    expect(retained.probeDiagnostics).toEqual(inconclusiveProvider.probeDiagnostics);
  });

  it("drops the transient warning instead of inheriting an unrelated message", () => {
    const { message: _message, ...previousWithoutMessage } = conclusiveProvider;
    const retained = retainConclusiveProviderState(
      previousWithoutMessage as ServerProvider,
      inconclusiveProvider,
    );

    expect(retained.message).toBeUndefined();
  });

  it("does not resurrect account usage the previous state never had", () => {
    const { accountRateLimits: _limits, ...previousWithoutUsage } = conclusiveProvider;
    const retained = retainConclusiveProviderState(
      previousWithoutUsage as ServerProvider,
      inconclusiveProvider,
    );

    expect(retained.accountRateLimits).toBeUndefined();
  });
});

describe("reconcileInconclusiveProviderProbeStreak", () => {
  const previousInconclusive = withDiagnostics(inconclusiveProvider, {
    attemptCount: 1,
    consecutiveInconclusiveCount: 1,
  });

  it("passes through when either side lacks probe diagnostics", () => {
    const next = { ...inconclusiveProvider };
    expect(reconcileInconclusiveProviderProbeStreak(conclusiveProvider, next)).toBe(next);
    expect(reconcileInconclusiveProviderProbeStreak(previousInconclusive, conclusiveProvider)).toBe(
      conclusiveProvider,
    );
  });

  it("treats an identical observation as a duplicate delivery, not a new failure", () => {
    const reconciled = reconcileInconclusiveProviderProbeStreak(
      previousInconclusive,
      previousInconclusive,
    );

    expect(reconciled.probeDiagnostics?.consecutiveInconclusiveCount).toBe(1);
  });

  it("keeps the newest schedule when a duplicate arrives with an older target", () => {
    const schedulelessDuplicate = withDiagnostics(previousInconclusive, {
      nextScheduledAt: null,
    });

    const reconciled = reconcileInconclusiveProviderProbeStreak(
      previousInconclusive,
      schedulelessDuplicate,
    );

    expect(reconciled.probeDiagnostics?.nextScheduledAt).toBe("2026-04-14T00:10:42.000Z");
  });

  it("does not revive a stale schedule across a different scheduler configuration", () => {
    const rescheduledDuplicate = withDiagnostics(previousInconclusive, {
      periodicIntervalMs: 600_000,
      nextScheduledAt: null,
    });

    const reconciled = reconcileInconclusiveProviderProbeStreak(
      previousInconclusive,
      rescheduledDuplicate,
    );

    expect(reconciled.probeDiagnostics?.nextScheduledAt).toBeNull();
  });

  it("rejects an out-of-order observation delivered after a newer one", () => {
    const newerObservation = withDiagnostics(previousInconclusive, {
      attemptCount: 2,
      consecutiveInconclusiveCount: 2,
      lastStartedAt: "2026-04-14T00:09:56.000Z",
      lastFinishedAt: "2026-04-14T00:10:00.000Z",
    });

    expect(reconcileInconclusiveProviderProbeStreak(newerObservation, previousInconclusive)).toBe(
      newerObservation,
    );
  });

  it("carries a saturating streak across a provider scope rebuild", () => {
    // The rebuilt scope restarts its own attempt counter at 1 while the cached
    // presentation already recorded two consecutive inconclusive probes.
    const rebuiltScopeFirstAttempt = withDiagnostics(previousInconclusive, {
      attemptCount: 1,
      consecutiveInconclusiveCount: 1,
      lastStartedAt: "2026-04-14T00:14:56.000Z",
      lastFinishedAt: "2026-04-14T00:15:00.000Z",
    });
    const cachedTwoFailures = withDiagnostics(previousInconclusive, {
      attemptCount: 2,
      consecutiveInconclusiveCount: 2,
      lastStartedAt: "2026-04-14T00:09:56.000Z",
      lastFinishedAt: "2026-04-14T00:10:00.000Z",
    });

    const reconciled = reconcileInconclusiveProviderProbeStreak(
      cachedTwoFailures,
      rebuiltScopeFirstAttempt,
    );

    expect(reconciled.probeDiagnostics?.consecutiveInconclusiveCount).toBe(3);
    expect(reconciled.probeDiagnostics?.attemptCount).toBe(1);
  });

  it("adds only the newly observed delta when a carried prefix is already merged", () => {
    // Same rebuilt scope, second attempt: the cached streak (3) already
    // includes attempt 1, so attempt 2 must add exactly one more failure.
    const carriedPrefix = withDiagnostics(previousInconclusive, {
      attemptCount: 1,
      consecutiveInconclusiveCount: 3,
      lastStartedAt: "2026-04-14T00:14:56.000Z",
      lastFinishedAt: "2026-04-14T00:15:00.000Z",
    });
    const secondAttemptInRebuiltScope = withDiagnostics(previousInconclusive, {
      attemptCount: 2,
      consecutiveInconclusiveCount: 2,
      lastStartedAt: "2026-04-14T00:19:56.000Z",
      lastFinishedAt: "2026-04-14T00:20:00.000Z",
    });

    const reconciled = reconcileInconclusiveProviderProbeStreak(
      carriedPrefix,
      secondAttemptInRebuiltScope,
    );

    expect(reconciled.probeDiagnostics?.consecutiveInconclusiveCount).toBe(4);
  });

  it("lets a conclusive observation reset the streak", () => {
    const recovered = withDiagnostics(conclusiveProvider, {
      attemptCount: 2,
      consecutiveInconclusiveCount: 0,
      lastOutcome: "ready",
      lastStartedAt: "2026-04-14T00:19:59.000Z",
      lastFinishedAt: "2026-04-14T00:20:00.000Z",
    });

    const reconciled = reconcileInconclusiveProviderProbeStreak(previousInconclusive, recovered);

    expect(reconciled.probeDiagnostics?.consecutiveInconclusiveCount).toBe(0);
    expect(reconciled.probeDiagnostics?.lastOutcome).toBe("ready");
  });
});
