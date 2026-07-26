import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderAccountRateLimits,
} from "@cafecode/contracts";
import { describe, expect, it, vi } from "vitest";

import type { PacingAdmissionKey, PacingAdmissionObservation } from "./boundedPacingAdmission.ts";
import { ProviderPacingAccountIdentity } from "./providerPacingAccountIdentity.ts";
import {
  ProviderPacingObservationTracker,
  type ProviderPacingObservationSink,
} from "./providerPacingObservationTracker.ts";

const CHECKED_AT = "2026-07-26T17:00:00.000Z";
const CHECKED_AT_MS = Date.parse(CHECKED_AT);
const RESET_SECONDS = 1_800_000_000;
const FIVE_MINUTES = 5 * 60_000;
const environmentId = EnvironmentId.make("environment-a");

function provider(
  input: {
    readonly instanceId?: string;
    readonly driver?: string;
    readonly email?: string;
    readonly accountRateLimits?: ServerProviderAccountRateLimits;
  } = {},
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId ?? "claude-primary"),
    driver: ProviderDriverKind.make(input.driver ?? "claudeAgent"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: {
      status: "authenticated",
      type: "oauth",
      email: input.email ?? "user@example.com",
    },
    checkedAt: CHECKED_AT,
    models: [],
    slashCommands: [],
    skills: [],
    ...(input.accountRateLimits ? { accountRateLimits: input.accountRateLimits } : {}),
  };
}

function claudeRateLimits(
  checkedAt = CHECKED_AT,
  usedPercent: number | undefined = 50,
): ServerProviderAccountRateLimits {
  return {
    rateLimits: {
      primary: {
        ...(usedPercent === undefined ? {} : { usedPercent }),
        windowDurationMins: 300,
        resetsAt: RESET_SECONDS,
      },
    },
    checkedAt,
  };
}

function codexRateLimits(checkedAt = CHECKED_AT): ServerProviderAccountRateLimits {
  return {
    rateLimits: {
      secondary: {
        usedPercent: 50,
        windowDurationMins: 10_080,
        resetsAt: RESET_SECONDS,
      },
    },
    checkedAt,
  };
}

function setup() {
  const observations: Array<{ key: PacingAdmissionKey; value: PacingAdmissionObservation }> = [];
  const invalidations: Array<{ key: PacingAdmissionKey; observedAtMs: number }> = [];
  const retirements: PacingAdmissionKey[] = [];
  const sink: ProviderPacingObservationSink = {
    observe: vi.fn((key, value) => observations.push({ key, value })),
    invalidateQuotaEvidence: vi.fn((key, observedAtMs) =>
      invalidations.push({ key, observedAtMs }),
    ),
    retireKey: vi.fn((key) => {
      retirements.push(key);
      return true;
    }),
  };
  const tracker = new ProviderPacingObservationTracker(
    sink,
    new ProviderPacingAccountIdentity(new Uint8Array(32).fill(3)),
    { staleAfterMs: FIVE_MINUTES, futureClockToleranceMs: 60_000 },
  );
  return { invalidations, observations, retirements, sink, tracker };
}

function apply(
  tracker: ProviderPacingObservationTracker,
  providers: ReadonlyArray<ServerProvider>,
  patch: {
    readonly enabled?: boolean;
    readonly minimumPauseMinutes?: number;
    readonly observedAtMs?: number;
  } = {},
) {
  tracker.applyProviderSnapshots({
    environmentId,
    providers,
    settings: {
      enabled: patch.enabled ?? true,
      minimumPauseMinutes: patch.minimumPauseMinutes ?? 0,
    },
    observedAtMs: patch.observedAtMs ?? CHECKED_AT_MS,
  });
}

describe("ProviderPacingObservationTracker", () => {
  it("increments evidence only for a completed usage fingerprint change", () => {
    const { observations, tracker } = setup();
    const snapshot = provider({ accountRateLimits: claudeRateLimits() });
    apply(tracker, [snapshot]);
    apply(tracker, [snapshot], { observedAtMs: CHECKED_AT_MS + 1_000 });
    apply(
      tracker,
      [
        provider({
          accountRateLimits: claudeRateLimits("2026-07-26T17:01:00.000Z"),
        }),
      ],
      { observedAtMs: CHECKED_AT_MS + 60_000 },
    );

    expect(observations.map(({ value }) => value.providerObservationSequence)).toEqual([0, 0, 1]);
    expect(observations[1]?.value.observedAtMs).toBe(CHECKED_AT_MS + 1_000);
  });

  it("pushes settings changes without inventing provider evidence", () => {
    const { observations, tracker } = setup();
    const snapshot = provider({ accountRateLimits: claudeRateLimits() });
    apply(tracker, [snapshot]);
    apply(tracker, [snapshot], { enabled: false, minimumPauseMinutes: 37 });

    expect(observations[1]?.value).toMatchObject({
      enabled: false,
      minimumPauseMs: 37 * 60_000,
      providerObservationSequence: 0,
    });
  });

  it("invalidates stale, missing, and implausibly future evidence", () => {
    const { invalidations, observations, tracker } = setup();
    apply(tracker, [provider({ accountRateLimits: claudeRateLimits() })], {
      observedAtMs: CHECKED_AT_MS + FIVE_MINUTES,
    });
    apply(tracker, [provider()], { observedAtMs: CHECKED_AT_MS + FIVE_MINUTES + 1 });
    apply(
      tracker,
      [
        provider({
          accountRateLimits: claudeRateLimits("2026-07-26T17:10:00.000Z"),
        }),
      ],
      { observedAtMs: CHECKED_AT_MS },
    );

    expect(observations.map(({ value }) => value.stale)).toEqual([true, true, true]);
    expect(invalidations).toHaveLength(2);
    expect(invalidations[0]?.observedAtMs).toBe(CHECKED_AT_MS + FIVE_MINUTES);
  });

  it("schedules and applies local stale-evidence expiry", () => {
    const { invalidations, tracker } = setup();
    apply(tracker, [provider({ accountRateLimits: claudeRateLimits() })]);

    expect(tracker.nextStaleAtMs(CHECKED_AT_MS)).toBe(CHECKED_AT_MS + FIVE_MINUTES);
    tracker.invalidateStaleEvidence(CHECKED_AT_MS + FIVE_MINUTES - 1);
    expect(invalidations).toHaveLength(0);
    tracker.invalidateStaleEvidence(CHECKED_AT_MS + FIVE_MINUTES);
    expect(invalidations).toHaveLength(1);
    expect(tracker.nextStaleAtMs(CHECKED_AT_MS + FIVE_MINUTES)).toBeNull();
  });

  it("retires the old exact key on account change or provider removal", () => {
    const { observations, retirements, tracker } = setup();
    apply(tracker, [
      provider({ email: "first@example.com", accountRateLimits: claudeRateLimits() }),
    ]);
    const firstKey = observations[0]!.key;
    apply(tracker, [
      provider({ email: "second@example.com", accountRateLimits: claudeRateLimits() }),
    ]);
    const secondKey = observations[1]!.key;

    expect(retirements).toEqual([firstKey]);
    expect(secondKey.providerAccountId).not.toBe(firstKey.providerAccountId);
    expect(JSON.stringify(secondKey)).not.toContain("second@example.com");

    apply(tracker, []);
    expect(retirements).toEqual([firstKey, secondKey]);
  });

  it("tracks environment, instance, and opaque account as exact key parts", () => {
    const { observations, tracker } = setup();
    apply(tracker, [
      provider({
        instanceId: "codex-work",
        driver: "codex",
        accountRateLimits: codexRateLimits(),
      }),
    ]);

    expect(observations[0]?.key).toMatchObject({
      environmentId: "environment-a",
      providerInstanceId: "codex-work",
      providerAccountId: expect.stringMatching(/^account:[a-f0-9]{64}$/),
    });
    expect(observations[0]?.value).toMatchObject({
      providerFamily: "codex",
      windowDurationMs: 10_080 * 60_000,
    });
  });

  it("ignores unsupported providers without allocating pacing authority", () => {
    const { observations, retirements, tracker } = setup();
    apply(tracker, [
      provider({
        instanceId: "ollama-local",
        driver: "ollama",
        accountRateLimits: claudeRateLimits(),
      }),
    ]);

    expect(observations).toHaveLength(0);
    expect(retirements).toHaveLength(0);
    expect(tracker.nextStaleAtMs(CHECKED_AT_MS)).toBeNull();
  });
});
