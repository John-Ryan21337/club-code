import { describe, expect, it } from "vitest";

import { DrainFirstPacingController } from "./drainFirstPacingPolicy.ts";

const WEEK = 7 * 24 * 60 * 60 * 1_000;
const RESET = WEEK;
let nextObservationSequence = 0;

function observation(patch: Partial<Parameters<DrainFirstPacingController["observe"]>[0]> = {}) {
  return {
    providerFamily: "codex" as const,
    usedPercent: 0,
    resetsAtMs: RESET,
    windowDurationMs: WEEK,
    observedAtMs: 0,
    observationSequence: nextObservationSequence++,
    stale: false,
    activeLaunchCount: 0,
    enabled: true,
    minimumPauseMs: 0,
    ...patch,
  };
}

describe("DrainFirstPacingController", () => {
  it("closes only new starts while active work drains, then resumes by clock", () => {
    const pacing = new DrainFirstPacingController();
    expect(
      pacing.observe(
        observation({ usedPercent: 20, observedAtMs: WEEK * 0.1, activeLaunchCount: 3 }),
      ).phase,
    ).toBe("draining");
    expect(pacing.canStartNewWork()).toBe(false);

    const drained = pacing.observe(
      observation({ usedPercent: 20, observedAtMs: WEEK * 0.11, activeLaunchCount: 0 }),
    );
    expect(drained.phase).toBe("paused");
    expect(drained.resumeAtMs).toBe(WEEK * 0.2);
    expect(pacing.observe(observation({ usedPercent: 20, observedAtMs: WEEK * 0.2 })).phase).toBe(
      "running",
    );
  });

  it("has no lifecycle operation capable of preempting active provider work", () => {
    const methodNames = Object.getOwnPropertyNames(DrainFirstPacingController.prototype);
    expect(methodNames).toEqual(
      expect.arrayContaining(["constructor", "getSnapshot", "canStartNewWork", "observe"]),
    );
    expect(methodNames.join(" ")).not.toMatch(/abort|interrupt|kill|stop|terminate/i);
  });

  it("does not pause Codex when weekly usage is not ahead of elapsed time", () => {
    const pacing = new DrainFirstPacingController();
    expect(pacing.observe(observation({ usedPercent: 20, observedAtMs: WEEK * 0.25 })).phase).toBe(
      "running",
    );
    expect(pacing.observe(observation({ usedPercent: 40, observedAtMs: WEEK * 0.45 })).phase).toBe(
      "running",
    );
  });

  it("uses each 20% Codex checkpoint and waits for reset at 100%", () => {
    const pacing = new DrainFirstPacingController();
    const expected = [
      { usedPercent: 21, observedAtMs: WEEK * 0.1, checkpoint: 20, phase: "paused" },
      { usedPercent: 41, observedAtMs: WEEK * 0.21, checkpoint: 40, phase: "paused" },
      { usedPercent: 61, observedAtMs: WEEK * 0.41, checkpoint: 60, phase: "paused" },
      { usedPercent: 81, observedAtMs: WEEK * 0.61, checkpoint: 80, phase: "paused" },
      { usedPercent: 100, observedAtMs: WEEK * 0.81, checkpoint: 100, phase: "waiting-reset" },
    ] as const;

    for (const item of expected) {
      const snapshot = pacing.observe(
        observation({ usedPercent: item.usedPercent, observedAtMs: item.observedAtMs }),
      );
      expect(snapshot.phase).toBe(item.phase);
      expect(snapshot.checkpointPercent).toBe(item.checkpoint);
    }
  });

  it("honors an explicit minimum pause without extending beyond reset", () => {
    const pacing = new DrainFirstPacingController();
    const paused = pacing.observe(
      observation({
        usedPercent: 20,
        observedAtMs: WEEK * 0.1,
        minimumPauseMs: WEEK * 0.15,
      }),
    );
    expect(paused.phase).toBe("paused");
    expect(paused.resumeAtMs).toBe(WEEK * 0.25);

    const nearReset = new DrainFirstPacingController().observe(
      observation({
        usedPercent: 80,
        observedAtMs: WEEK * 0.79,
        minimumPauseMs: WEEK,
      }),
    );
    expect(nearReset.resumeAtMs).toBe(RESET);

    const infiniteFloor = new DrainFirstPacingController().observe(
      observation({
        usedPercent: 20,
        observedAtMs: WEEK * 0.1,
        minimumPauseMs: Number.POSITIVE_INFINITY,
      }),
    );
    expect(infiniteFloor.resumeAtMs).toBe(RESET);
  });

  it("clamps provider overage above 100% instead of failing open", () => {
    const pacing = new DrainFirstPacingController();
    expect(pacing.observe(observation({ usedPercent: 137, observedAtMs: WEEK * 0.9 })).phase).toBe(
      "waiting-reset",
    );
    expect(pacing.getSnapshot().checkpointPercent).toBe(100);
    expect(pacing.canStartNewWork()).toBe(false);
  });

  it("stops new Claude launches at 90%, drains, and waits for the four-hour reset", () => {
    const pacing = new DrainFirstPacingController();
    const fourHours = 4 * 60 * 60 * 1_000;
    expect(
      pacing.observe(
        observation({
          providerFamily: "claude",
          usedPercent: 89,
          windowDurationMs: fourHours,
        }),
      ).phase,
    ).toBe("running");

    const draining = pacing.observe(
      observation({
        providerFamily: "claude",
        usedPercent: 90,
        windowDurationMs: fourHours,
        activeLaunchCount: 4,
      }),
    );
    expect(draining.phase).toBe("draining");
    expect(draining.resumeAtMs).toBeNull();
    expect(pacing.canStartNewWork()).toBe(false);

    const drained = pacing.observe(
      observation({
        providerFamily: "claude",
        usedPercent: 94,
        windowDurationMs: fourHours,
        observedAtMs: 1,
        activeLaunchCount: 0,
      }),
    );
    expect(drained.phase).toBe("waiting-reset");
    expect(drained.resumeAtMs).toBe(RESET);
  });

  it("does not reopen at a deadline while any provider work is still active", () => {
    const pacing = new DrainFirstPacingController();
    const fourHours = 4 * 60 * 60 * 1_000;
    pacing.observe(
      observation({
        providerFamily: "claude",
        usedPercent: 94,
        windowDurationMs: fourHours,
      }),
    );

    expect(
      pacing.observe(
        observation({
          providerFamily: "claude",
          usedPercent: 94,
          windowDurationMs: fourHours,
          observedAtMs: RESET,
          activeLaunchCount: 1,
        }),
      ).phase,
    ).toBe("draining");
    expect(pacing.canStartNewWork()).toBe(false);

    expect(
      pacing.observe(
        observation({
          providerFamily: "claude",
          usedPercent: 94,
          windowDurationMs: fourHours,
          observedAtMs: RESET + 1,
          activeLaunchCount: 0,
        }),
      ).phase,
    ).toBe("running");
  });

  it("keeps a concrete pause closed when its telemetry becomes stale", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(observation({ usedPercent: 20, observedAtMs: WEEK * 0.1 }));

    expect(
      pacing.observe(observation({ usedPercent: 20, observedAtMs: WEEK * 0.15, stale: true }))
        .phase,
    ).toBe("paused");
    expect(
      pacing.observe(observation({ usedPercent: 20, observedAtMs: WEEK * 0.2, stale: true })).phase,
    ).toBe("running");
  });

  it("does not treat a same-window usage correction as a quota reset", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(observation({ usedPercent: 20, observedAtMs: WEEK * 0.1 }));

    const corrected = pacing.observe(observation({ usedPercent: 4, observedAtMs: WEEK * 0.11 }));
    expect(corrected.phase).toBe("paused");
    expect(corrected.resumeAtMs).toBe(WEEK * 0.2);
    expect(pacing.canStartNewWork()).toBe(false);
  });

  it("does not let stale quota data replace the trusted drain schedule", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(
      observation({ usedPercent: 20, observedAtMs: WEEK * 0.1, activeLaunchCount: 1 }),
    );

    expect(
      pacing.observe(
        observation({
          usedPercent: 20,
          resetsAtMs: WEEK * 0.18,
          observedAtMs: WEEK * 0.15,
          stale: true,
          activeLaunchCount: 1,
        }),
      ).phase,
    ).toBe("draining");

    const drained = pacing.observe(
      observation({
        usedPercent: null,
        observedAtMs: WEEK * 0.19,
        activeLaunchCount: 0,
      }),
    );
    expect(drained.phase).toBe("paused");
    expect(drained.resumeAtMs).toBe(WEEK * 0.2);
  });

  it("ignores an older quota generation delivered after newer closed-gate evidence", () => {
    const pacing = new DrainFirstPacingController();
    const currentWindow = {
      usedPercent: 20,
      resetsAtMs: RESET + WEEK,
      observedAtMs: RESET + WEEK * 0.1,
      observationSequence: 10_000,
    };
    pacing.observe(observation(currentWindow));

    const delayedPreviousWindow = pacing.observe(
      observation({
        usedPercent: 0,
        resetsAtMs: RESET,
        observedAtMs: WEEK * 0.9,
        observationSequence: 9_999,
      }),
    );
    expect(delayedPreviousWindow.phase).toBe("paused");
    expect(delayedPreviousWindow.resumeAtMs).toBe(RESET + WEEK * 0.2);
    expect(pacing.canStartNewWork()).toBe(false);
  });

  it("does not treat a pre-deadline reset estimate correction as a completed reset", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(observation({ usedPercent: 20, observedAtMs: WEEK * 0.1 }));

    const correctedWindow = pacing.observe(
      observation({
        usedPercent: 0,
        resetsAtMs: WEEK * 1.1,
        observedAtMs: WEEK * 0.11,
      }),
    );
    expect(correctedWindow.phase).toBe("paused");
    expect(correctedWindow.resumeAtMs).toBe(WEEK * 0.2);
    expect(pacing.canStartNewWork()).toBe(false);
  });

  it("keeps draining through unavailable telemetry and uses the last valid schedule", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(
      observation({ usedPercent: 20, observedAtMs: WEEK * 0.1, activeLaunchCount: 1 }),
    );

    expect(
      pacing.observe(
        observation({
          usedPercent: null,
          observedAtMs: WEEK * 0.15,
          activeLaunchCount: 1,
        }),
      ).phase,
    ).toBe("draining");
    const drained = pacing.observe(
      observation({
        usedPercent: null,
        observedAtMs: WEEK * 0.16,
        activeLaunchCount: 0,
      }),
    );
    expect(drained.phase).toBe("paused");
    expect(drained.resumeAtMs).toBe(WEEK * 0.2);
  });

  it("treats an invalid active count conservatively and returns snapshot copies", () => {
    const pacing = new DrainFirstPacingController();
    const returned = pacing.observe(
      observation({
        providerFamily: "claude",
        usedPercent: 90,
        windowDurationMs: 4 * 60 * 60 * 1_000,
        activeLaunchCount: 0.25,
      }),
    );
    expect(returned.phase).toBe("draining");
    (returned as { phase: string }).phase = "running";
    expect(pacing.getSnapshot().phase).toBe("draining");
    expect(pacing.canStartNewWork()).toBe(false);

    expect(
      pacing.observe(
        observation({
          providerFamily: "claude",
          usedPercent: 90,
          windowDurationMs: 4 * 60 * 60 * 1_000,
          observedAtMs: 1,
          activeLaunchCount: 0,
        }),
      ).phase,
    ).toBe("waiting-reset");
  });

  it("does not open a concrete gate on malformed quota or clock data", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(observation({ usedPercent: 20, observedAtMs: WEEK * 0.1 }));

    expect(pacing.observe(observation({ usedPercent: null })).phase).toBe("paused");
    expect(pacing.observe(observation({ usedPercent: 20, observedAtMs: Number.NaN })).phase).toBe(
      "paused",
    );
  });

  it("keeps old work draining across a quota generation change", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(
      observation({ usedPercent: 100, observedAtMs: WEEK * 0.9, activeLaunchCount: 1 }),
    );

    const nextWindow = {
      usedPercent: 2,
      resetsAtMs: RESET + WEEK,
      observedAtMs: RESET + 1,
    };
    expect(pacing.observe(observation({ ...nextWindow, activeLaunchCount: 1 })).phase).toBe(
      "draining",
    );
    expect(pacing.canStartNewWork()).toBe(false);
    expect(pacing.observe(observation({ ...nextWindow, activeLaunchCount: 0 })).phase).toBe(
      "running",
    );
  });

  it("keeps the gate closed if the new generation is already ahead of budget", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(
      observation({ usedPercent: 100, observedAtMs: WEEK * 0.9, activeLaunchCount: 1 }),
    );

    const nextWindow = {
      usedPercent: 25,
      resetsAtMs: RESET + WEEK,
      observedAtMs: RESET + WEEK * 0.05,
    };
    expect(pacing.observe(observation({ ...nextWindow, activeLaunchCount: 1 })).phase).toBe(
      "draining",
    );
    const drained = pacing.observe(observation({ ...nextWindow, activeLaunchCount: 0 }));
    expect(drained.phase).toBe("paused");
    expect(drained.checkpointPercent).toBe(20);
  });

  it("releases a completed old-generation drain even when the next quota read is unavailable", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(
      observation({ usedPercent: 100, observedAtMs: WEEK * 0.9, activeLaunchCount: 1 }),
    );
    pacing.observe(
      observation({
        usedPercent: 2,
        resetsAtMs: RESET + WEEK,
        observedAtMs: RESET + 1,
        activeLaunchCount: 1,
      }),
    );
    expect(
      pacing.observe(
        observation({
          usedPercent: null,
          resetsAtMs: RESET + WEEK,
          observedAtMs: RESET + 2,
          activeLaunchCount: 0,
        }),
      ).phase,
    ).toBe("running");
  });

  it("rebases a wall-clock rollback even when quota is unavailable", () => {
    const farFuture = WEEK * 100;
    for (const quotaState of [
      { usedPercent: 20, stale: false },
      { usedPercent: null, stale: false },
      { usedPercent: 20, stale: true },
    ] as const) {
      const pacing = new DrainFirstPacingController();
      pacing.observe(
        observation({
          usedPercent: 20,
          resetsAtMs: farFuture + WEEK,
          observedAtMs: farFuture + WEEK * 0.1,
          observationSequence: 20_000,
        }),
      );
      const recovered = pacing.observe(
        observation({
          ...quotaState,
          resetsAtMs: WEEK,
          observedAtMs: WEEK * 0.1,
          observationSequence: 20_001,
        }),
      );
      expect(recovered.phase).toBe("paused");
      expect(recovered.resumeAtMs).toBe(WEEK * 0.2);
    }
  });

  it("rebases from the latest local clock observation across a telemetry gap", () => {
    const pacing = new DrainFirstPacingController();
    const farFuture = WEEK * 100;
    pacing.observe(
      observation({
        usedPercent: 20,
        resetsAtMs: farFuture + WEEK,
        observedAtMs: farFuture + WEEK * 0.1,
        observationSequence: 25_000,
      }),
    );
    pacing.observe(
      observation({
        usedPercent: 20,
        observedAtMs: farFuture + WEEK * 0.15,
        observationSequence: 25_001,
        stale: true,
      }),
    );
    const recovered = pacing.observe(
      observation({
        usedPercent: null,
        observedAtMs: farFuture + WEEK * 0.12,
        observationSequence: 25_002,
      }),
    );
    expect(recovered.phase).toBe("paused");
    expect(recovered.resumeAtMs).toBe(farFuture + WEEK * 0.17);
  });

  it("keeps one generation across small provider window-estimate jitter", () => {
    const pacing = new DrainFirstPacingController();
    const initial = pacing.observe(
      observation({ usedPercent: 10, observedAtMs: WEEK * 0.1, observationSequence: 30_000 }),
    );
    const corrected = pacing.observe(
      observation({
        usedPercent: 11,
        resetsAtMs: RESET + 5_000,
        windowDurationMs: WEEK + 5_000,
        observedAtMs: WEEK * 0.11,
        observationSequence: 30_001,
      }),
    );
    expect(corrected.phase).toBe("running");
    expect(corrected.generation).toBe(initial.generation);
  });

  it("orders disable and re-enable independently of provider timestamps", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(
      observation({ usedPercent: 20, observedAtMs: WEEK * 0.1, observationSequence: 50 }),
    );
    expect(pacing.observe(observation({ enabled: false, observationSequence: 49 })).phase).toBe(
      "paused",
    );
    expect(pacing.observe(observation({ enabled: false, observationSequence: 51 })).phase).toBe(
      "running",
    );
    expect(
      pacing.observe(
        observation({
          usedPercent: 20,
          observedAtMs: WEEK * 0.1,
          observationSequence: 50,
        }),
      ).phase,
    ).toBe("running");
    expect(
      pacing.observe(
        observation({
          usedPercent: 20,
          observedAtMs: WEEK * 0.1,
          observationSequence: 52,
        }),
      ).phase,
    ).toBe("paused");
  });

  it("honors explicit disable when its local sequence is malformed", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(
      observation({ usedPercent: 20, observedAtMs: WEEK * 0.1, observationSequence: 60 }),
    );
    expect(pacing.observe(observation({ enabled: false, observationSequence: 59 })).phase).toBe(
      "paused",
    );
    expect(
      pacing.observe(observation({ enabled: false, observationSequence: Number.NaN })).phase,
    ).toBe("running");
    expect(
      pacing.observe(
        observation({
          usedPercent: 20,
          observedAtMs: WEEK * 0.1,
          observationSequence: 61,
        }),
      ).phase,
    ).toBe("paused");
  });

  it("uses the local active count at a trusted deadline even when quota data is stale", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(observation({ usedPercent: 20, observedAtMs: WEEK * 0.1 }));
    expect(
      pacing.observe(
        observation({
          usedPercent: 20,
          observedAtMs: WEEK * 0.2,
          stale: true,
          activeLaunchCount: 1,
        }),
      ).phase,
    ).toBe("draining");
    expect(
      pacing.observe(
        observation({
          usedPercent: 20,
          observedAtMs: WEEK * 0.21,
          stale: true,
          activeLaunchCount: 0,
        }),
      ).phase,
    ).toBe("running");
  });

  it("uses the current pause floor when telemetry disappears during a normal drain", () => {
    const pacing = new DrainFirstPacingController();
    pacing.observe(
      observation({ usedPercent: 20, observedAtMs: WEEK * 0.1, activeLaunchCount: 1 }),
    );
    const paused = pacing.observe(
      observation({
        usedPercent: null,
        observedAtMs: WEEK * 0.11,
        activeLaunchCount: 0,
        minimumPauseMs: WEEK * 0.15,
      }),
    );
    expect(paused.phase).toBe("paused");
    expect(paused.resumeAtMs).toBe(WEEK * 0.26);
  });

  it("keeps one generation across a checkpoint deadline and extends an active pause", () => {
    const pacing = new DrainFirstPacingController();
    const initial = pacing.observe(observation({ usedPercent: 20, observedAtMs: WEEK * 0.1 }));
    const extended = pacing.observe(observation({ usedPercent: 61, observedAtMs: WEEK * 0.15 }));
    expect(extended.checkpointPercent).toBe(60);
    expect(extended.resumeAtMs).toBe(WEEK * 0.6);
    const generation = extended.generation;
    const resumed = pacing.observe(observation({ usedPercent: 61, observedAtMs: WEEK * 0.6 }));
    expect(resumed.phase).toBe("running");
    expect(resumed.generation).toBe(generation);
    expect(initial.generation).toBe(generation);
  });

  it("fails open only before a concrete boundary or after explicit disable", () => {
    const pacing = new DrainFirstPacingController();
    const unavailable = pacing.observe(observation({ usedPercent: null }));
    expect(unavailable.phase).toBe("running");
    expect(unavailable.reason).toBe("Quota data is unavailable; pacing fails open.");
    expect(pacing.observe(observation({ observedAtMs: 1 })).reason).toBeNull();

    pacing.observe(observation({ usedPercent: 20, observedAtMs: WEEK * 0.1 }));
    expect(pacing.observe(observation({ usedPercent: null })).phase).toBe("paused");
    expect(pacing.observe(observation({ enabled: false })).phase).toBe("running");
    expect(pacing.observe(observation({ usedPercent: 20, observedAtMs: WEEK * 0.05 })).phase).toBe(
      "paused",
    );
  });
});
