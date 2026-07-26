import { describe, expect, it, vi } from "vitest";

import {
  BoundedPacingAdmissionCoordinator,
  PacingAdmissionCancelledError,
  PacingAdmissionCapacityError,
  PacingAdmissionDisposedError,
  PacingAdmissionRetiredError,
  type PacingAdmissionClock,
  type PacingAdmissionKey,
} from "./boundedPacingAdmission.ts";

const HOUR = 60 * 60 * 1_000;
const WINDOW = 4 * HOUR;
const RESET = WINDOW;
let nextProviderObservationSequence = 0;

class FakeClock implements PacingAdmissionClock {
  private time = 0;
  private nextId = 0;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, delayMs), callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advanceTo(time: number): void {
    if (time < this.time) throw new RangeError("Fake time cannot move backwards.");
    this.time = time;
    while (true) {
      const due = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= time)
        .toSorted(([leftId, left], [rightId, right]) => left.at - right.at || leftId - rightId)[0];
      if (due === undefined) return;
      this.timers.delete(due[0]);
      due[1].callback();
    }
  }
}

const keyA: PacingAdmissionKey = {
  environmentId: "environment-a",
  providerInstanceId: "claude-primary",
  providerAccountId: "account-a",
};
const keyB: PacingAdmissionKey = {
  environmentId: "environment-b",
  providerInstanceId: "claude-primary",
  providerAccountId: "account-a",
};

function setup(
  options: Partial<ConstructorParameters<typeof BoundedPacingAdmissionCoordinator>[0]> = {},
) {
  const clock = new FakeClock();
  const coordinator = new BoundedPacingAdmissionCoordinator({
    maxWaitingGlobal: 8,
    maxWaitingPerKey: 4,
    maxTrackedKeys: 4,
    clock,
    ...options,
  });
  return { clock, coordinator };
}

function claudeObservation(
  observedAtMs: number,
  patch: Partial<Parameters<BoundedPacingAdmissionCoordinator["observe"]>[1]> = {},
) {
  return {
    providerFamily: "claude" as const,
    usedPercent: 95,
    resetsAtMs: RESET,
    windowDurationMs: WINDOW,
    observedAtMs,
    stale: false,
    enabled: true,
    minimumPauseMs: 0,
    providerObservationSequence: nextProviderObservationSequence++,
    ...patch,
  };
}

function codexPauseObservation(observedAtMs: number) {
  return {
    providerFamily: "codex" as const,
    usedPercent: 20,
    resetsAtMs: WINDOW,
    windowDurationMs: WINDOW,
    observedAtMs,
    stale: false,
    enabled: true,
    minimumPauseMs: 0,
    providerObservationSequence: nextProviderObservationSequence++,
  };
}

function requiredProviderSequence(observation: ReturnType<typeof claudeObservation>): number {
  const sequence = observation.providerObservationSequence;
  if (sequence === null) throw new Error("The test observation must have a source sequence.");
  return sequence;
}

describe("BoundedPacingAdmissionCoordinator", () => {
  it("spends one fresh caution-band observation on only one simultaneous launch", async () => {
    const { coordinator } = setup();
    const observed = claudeObservation(0, {
      usedPercent: 89,
      providerObservationSequence: 10_000,
    });
    const sequence = requiredProviderSequence(observed);
    coordinator.observe(keyA, observed);
    const order: string[] = [];
    const admissions = ["first", "second", "third"].map((name) =>
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: keyA,
        launch: () => order.push(name),
      }),
    );

    await admissions[0]!.promise;
    expect(order).toEqual(["first"]);
    expect(coordinator.waitingCount).toBe(2);

    // Replaying or mutating the same provider read cannot mint another grant.
    (observed as { usedPercent: number }).usedPercent = 1;
    coordinator.observe(keyA, observed);
    coordinator.observe(keyA, {
      ...observed,
      usedPercent: 88,
      providerObservationSequence: sequence,
    });
    coordinator.observe(keyA, {
      ...observed,
      usedPercent: 1,
      providerObservationSequence: sequence - 1,
    });
    expect(order).toEqual(["first"]);

    coordinator.observe(
      keyA,
      claudeObservation(1, {
        usedPercent: 88,
        providerObservationSequence: sequence + 1,
      }),
    );
    await admissions[1]!.promise;
    expect(order).toEqual(["first", "second"]);
    expect(coordinator.waitingCount).toBe(1);

    coordinator.observe(
      keyA,
      claudeObservation(2, {
        usedPercent: 87,
        providerObservationSequence: sequence + 2,
      }),
    );
    await expect(admissions[2]!.promise).resolves.toBe(3);
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("consumes a caution authorization before invoking reentrant launch code", async () => {
    const { coordinator } = setup();
    const observed = claudeObservation(0, { usedPercent: 85 });
    coordinator.observe(keyA, observed);
    const order: string[] = [];
    let nested!: ReturnType<BoundedPacingAdmissionCoordinator["submitNewLaunch"]>;
    const outer = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => {
        order.push("outer");
        nested = coordinator.submitNewLaunch({
          kind: "new-launch",
          key: keyA,
          launch: () => order.push("nested"),
        });
      },
    });

    await outer.promise;
    expect(order).toEqual(["outer"]);
    expect(coordinator.waitingCount).toBe(1);

    coordinator.observe(
      keyA,
      claudeObservation(1, {
        usedPercent: 86,
        providerObservationSequence: requiredProviderSequence(observed) + 1,
      }),
    );
    await nested.promise;
    expect(order).toEqual(["outer", "nested"]);
  });

  it("retains useful fan-out below the configured caution band", async () => {
    const { coordinator } = setup();
    coordinator.observe(keyA, claudeObservation(0, { usedPercent: 79 }));
    const launches = Array.from({ length: 8 }, (_, index) =>
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: keyA,
        launch: () => index,
      }),
    );

    await expect(Promise.all(launches.map(({ promise }) => promise))).resolves.toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(coordinator.waitingCount).toBe(0);
  });

  it("supports an explicit bounded multi-launch grant without making it unbounded", async () => {
    const { coordinator } = setup({ maxCautionBandLaunchesPerObservation: 2 });
    const observed = claudeObservation(0, { usedPercent: 80 });
    coordinator.observe(keyA, observed);
    const order: number[] = [];
    const admissions = [0, 1, 2].map((index) =>
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: keyA,
        launch: () => order.push(index),
      }),
    );

    await Promise.all([admissions[0]!.promise, admissions[1]!.promise]);
    expect(order).toEqual([0, 1]);
    expect(coordinator.waitingCount).toBe(1);

    coordinator.observe(
      keyA,
      claudeObservation(1, {
        usedPercent: 81,
        providerObservationSequence: requiredProviderSequence(observed) + 1,
      }),
    );
    await admissions[2]!.promise;
    expect(order).toEqual([0, 1, 2]);
  });

  it("bounds reservation configuration", () => {
    const common = { maxWaitingGlobal: 8, maxWaitingPerKey: 4, maxTrackedKeys: 4 };
    expect(
      () =>
        new BoundedPacingAdmissionCoordinator({
          ...common,
          cautionBandStartPercent: 90,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new BoundedPacingAdmissionCoordinator({
          ...common,
          cautionBandStartPercent: Number.NaN,
        }),
    ).toThrow(RangeError);
    expect(
      () =>
        new BoundedPacingAdmissionCoordinator({
          ...common,
          maxCautionBandLaunchesPerObservation: 65,
        }),
    ).toThrow(RangeError);
  });

  it("admits nothing at the 90% drain boundary", async () => {
    const { coordinator } = setup();
    const observed = claudeObservation(0, { usedPercent: 90 });
    coordinator.observe(keyA, observed);
    const launch = vi.fn(() => "must-wait");
    const waiting = coordinator.submitNewLaunch({ kind: "new-launch", key: keyA, launch });

    expect(launch).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot(keyA)?.phase).toBe("waiting-reset");

    // Even a lower mutation of the same source read is not reset evidence.
    coordinator.observe(keyA, { ...observed, usedPercent: 1 });
    expect(launch).not.toHaveBeenCalled();
    expect(waiting.cancel()).toBe(true);
    await expect(waiting.promise).rejects.toBeInstanceOf(PacingAdmissionCancelledError);
  });

  it("requires a newer complete observation after stale or unknown quota evidence", async () => {
    const { coordinator } = setup();
    const initial = claudeObservation(0, { usedPercent: 85 });
    coordinator.observe(keyA, initial);
    const first = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => "first",
    });
    const launch = vi.fn(() => "second");
    const second = coordinator.submitNewLaunch({ kind: "new-launch", key: keyA, launch });
    await first.promise;

    coordinator.observe(
      keyA,
      claudeObservation(1, {
        usedPercent: 86,
        stale: true,
        providerObservationSequence: requiredProviderSequence(initial) + 1,
      }),
    );
    const unknownSequence = requiredProviderSequence(initial) + 2;
    coordinator.observe(
      keyA,
      claudeObservation(2, {
        usedPercent: null,
        providerObservationSequence: unknownSequence,
      }),
    );
    coordinator.observe(
      keyA,
      claudeObservation(3, {
        usedPercent: 1,
        providerObservationSequence: unknownSequence,
      }),
    );
    coordinator.observe(
      keyA,
      claudeObservation(4, {
        usedPercent: 1,
        providerObservationSequence: null,
      }),
    );
    expect(launch).not.toHaveBeenCalled();

    coordinator.observe(
      keyA,
      claudeObservation(5, {
        usedPercent: 84,
        providerObservationSequence: unknownSequence + 1,
      }),
    );
    await expect(second.promise).resolves.toBe("second");
  });

  it("invalidates stale admission authority without minting provider evidence", async () => {
    const { coordinator } = setup();
    const initial = claudeObservation(0, {
      usedPercent: 50,
      providerObservationSequence: 90_000,
    });
    coordinator.observe(keyA, initial);
    await coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => "before-stale",
    }).promise;

    coordinator.invalidateQuotaEvidence(keyA, 1);
    const launch = vi.fn(() => "after-fresh");
    const waiting = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch,
    });
    expect(launch).not.toHaveBeenCalled();

    coordinator.observe(keyA, {
      ...initial,
      observedAtMs: 1,
    });
    expect(launch).not.toHaveBeenCalled();

    coordinator.observe(keyA, {
      ...initial,
      observedAtMs: 2,
      providerObservationSequence: 90_001,
    });
    await expect(waiting.promise).resolves.toBe("after-fresh");
  });

  it("does not let stale invalidation override explicit disable", async () => {
    const { coordinator } = setup();
    const initial = claudeObservation(0, {
      usedPercent: 95,
      providerObservationSequence: 95_000,
    });
    coordinator.observe(keyA, initial);
    coordinator.observe(keyA, {
      ...initial,
      enabled: false,
      providerObservationSequence: 95_001,
    });

    expect(coordinator.invalidateQuotaEvidence(keyA, 1)?.phase).toBe("running");
    await expect(
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: keyA,
        launch: () => "disabled",
      }).promise,
    ).resolves.toBe("disabled");
  });

  it("admits only manual Claude bootstrap probes with bounded rearming", async () => {
    const { clock, coordinator } = setup();
    coordinator.observe(
      keyA,
      claudeObservation(0, {
        usedPercent: null,
        providerObservationSequence: null,
      }),
    );
    const order: string[] = [];
    const automatic = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      dispatchSource: "auto-nudge",
      launch: () => order.push("automatic"),
    });
    const first = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      dispatchSource: "user",
      launch: () => order.push("first"),
    });
    const second = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      dispatchSource: "user",
      launch: () => order.push("second"),
    });

    await first.promise;
    expect(order).toEqual(["first"]);
    expect(coordinator.waitingCount).toBe(2);

    clock.advanceTo(5 * 60_000 - 1);
    expect(order).toEqual(["first"]);
    clock.advanceTo(5 * 60_000);
    await second.promise;
    expect(order).toEqual(["first", "second"]);

    clock.advanceTo(20 * 60_000);
    expect(order).toEqual(["first", "second"]);
    expect(automatic.cancel()).toBe(true);
    await expect(automatic.promise).rejects.toBeInstanceOf(PacingAdmissionCancelledError);
  });

  it("burns a Claude probe before invoking reentrant launch code", async () => {
    const { coordinator } = setup();
    coordinator.observe(
      keyA,
      claudeObservation(0, {
        usedPercent: null,
        providerObservationSequence: null,
      }),
    );
    const order: string[] = [];
    let nested!: ReturnType<BoundedPacingAdmissionCoordinator["submitNewLaunch"]>;
    const outer = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      dispatchSource: "user",
      launch: () => {
        order.push("outer");
        nested = coordinator.submitNewLaunch({
          kind: "new-launch",
          key: keyA,
          dispatchSource: "user",
          launch: () => order.push("nested"),
        });
      },
    });

    await outer.promise;
    expect(order).toEqual(["outer"]);
    expect(coordinator.waitingCount).toBe(1);
    expect(nested.cancel()).toBe(true);
    await expect(nested.promise).rejects.toBeInstanceOf(PacingAdmissionCancelledError);
  });

  it("burns an armed Claude probe on newer evidence and applies the next backoff", async () => {
    const { clock, coordinator } = setup();
    coordinator.observe(
      keyA,
      claudeObservation(0, {
        usedPercent: null,
        providerObservationSequence: null,
      }),
    );
    await coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      dispatchSource: "user",
      launch: () => "first",
    }).promise;
    const launch = vi.fn(() => "second");
    const second = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      dispatchSource: "user",
      launch,
    });

    clock.advanceTo(1);
    coordinator.observe(
      keyA,
      claudeObservation(1, {
        usedPercent: null,
        providerObservationSequence: 100_000,
      }),
    );
    clock.advanceTo(5 * 60_000);
    expect(launch).not.toHaveBeenCalled();
    clock.advanceTo(1 + 15 * 60_000);
    await expect(second.promise).resolves.toBe("second");
  });

  it("arms one manual probe at a Claude reset deadline without opening the policy", async () => {
    const { clock, coordinator } = setup();
    coordinator.observe(keyA, claudeObservation(0));
    const order: string[] = [];
    const manual = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      dispatchSource: "user",
      launch: () => order.push("manual"),
    });
    const automatic = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      dispatchSource: "auto-nudge",
      launch: () => order.push("automatic"),
    });

    clock.advanceTo(RESET - 1);
    expect(order).toEqual([]);
    clock.advanceTo(RESET);
    await manual.promise;
    expect(order).toEqual(["manual"]);
    expect(coordinator.getSnapshot(keyA)?.phase).toBe("waiting-reset");

    clock.advanceTo(RESET + 5 * 60_000);
    expect(order).toEqual(["manual"]);
    expect(automatic.cancel()).toBe(true);
    await expect(automatic.promise).rejects.toBeInstanceOf(PacingAdmissionCancelledError);
  });

  it("does not release authorization on completion, cancellation, or clock advance", async () => {
    const { clock, coordinator } = setup();
    const observed = claudeObservation(0, { usedPercent: 85 });
    coordinator.observe(keyA, observed);
    const first = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => "first",
    });
    const cancelled = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => "cancelled",
    });
    const finalLaunch = vi.fn(() => "final");
    const final = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: finalLaunch,
    });

    await first.promise;
    expect(cancelled.cancel()).toBe(true);
    await expect(cancelled.promise).rejects.toBeInstanceOf(PacingAdmissionCancelledError);
    clock.advanceTo(RESET - 1);
    expect(finalLaunch).not.toHaveBeenCalled();

    coordinator.observe(
      keyA,
      claudeObservation(RESET - 1, {
        usedPercent: 86,
        resetsAtMs: RESET + WINDOW,
        providerObservationSequence: requiredProviderSequence(observed) + 1,
      }),
    );
    await expect(final.promise).resolves.toBe("final");
  });

  it("spends grants permanently when launches throw or reject", async () => {
    const { coordinator } = setup();
    const initial = claudeObservation(0, { usedPercent: 85 });
    coordinator.observe(keyA, initial);
    const thrown = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => {
        throw new Error("sync");
      },
    });
    await expect(thrown.promise).rejects.toThrow("sync");

    const asyncLaunch = vi.fn(() => Promise.reject(new Error("async")));
    const rejected = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: asyncLaunch,
    });
    expect(asyncLaunch).not.toHaveBeenCalled();

    coordinator.observe(
      keyA,
      claudeObservation(1, {
        usedPercent: 86,
        providerObservationSequence: requiredProviderSequence(initial) + 1,
      }),
    );
    await expect(rejected.promise).rejects.toThrow("async");

    const finalLaunch = vi.fn(() => "final");
    const final = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: finalLaunch,
    });
    expect(finalLaunch).not.toHaveBeenCalled();
    coordinator.observe(
      keyA,
      claudeObservation(2, {
        usedPercent: 87,
        providerObservationSequence: requiredProviderSequence(initial) + 2,
      }),
    );
    await expect(final.promise).resolves.toBe("final");
  });

  it("keeps caution reservations isolated by every exact key part", async () => {
    const { coordinator } = setup();
    const accountB = { ...keyA, providerAccountId: "account-b" };
    const instanceB = { ...keyA, providerInstanceId: "claude-secondary" };
    const environmentB = { ...keyA, environmentId: "environment-b" };
    for (const key of [keyA, accountB, instanceB, environmentB]) {
      coordinator.observe(key, claudeObservation(0, { usedPercent: 85 }));
    }

    const values = await Promise.all(
      [keyA, accountB, instanceB, environmentB].map(
        (key, index) =>
          coordinator.submitNewLaunch({
            kind: "new-launch",
            key,
            launch: () => index,
          }).promise,
      ),
    );
    expect(values).toEqual([0, 1, 2, 3]);

    const blocked = [keyA, accountB, instanceB, environmentB].map((key) =>
      coordinator.submitNewLaunch({ kind: "new-launch", key, launch: () => "blocked" }),
    );
    expect(coordinator.waitingCount).toBe(4);
    for (const admission of blocked) admission.cancel();
    await Promise.allSettled(blocked.map(({ promise }) => promise));
  });

  it("opens ordinary fan-out after a strictly newer provider reset", async () => {
    const { coordinator } = setup();
    const initial = claudeObservation(0, { usedPercent: 89 });
    coordinator.observe(keyA, initial);
    const first = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => "first",
    });
    const queued = [0, 1, 2].map((index) =>
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: keyA,
        launch: () => index,
      }),
    );
    await first.promise;
    expect(coordinator.waitingCount).toBe(3);

    coordinator.observe(
      keyA,
      claudeObservation(RESET, {
        usedPercent: 1,
        resetsAtMs: RESET + WINDOW,
        providerObservationSequence: requiredProviderSequence(initial) + 1,
      }),
    );
    await expect(Promise.all(queued.map(({ promise }) => promise))).resolves.toEqual([0, 1, 2]);
  });

  it("grants one cautious launch for an advanced reset window without utilization", async () => {
    const { coordinator } = setup();
    let finishActive!: () => void;
    const active = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => new Promise<void>((resolve) => (finishActive = resolve)),
    });
    const initial = claudeObservation(0);
    const initialSequence = requiredProviderSequence(initial);
    coordinator.observe(keyA, initial);
    const order: string[] = [];
    const first = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => order.push("first"),
    });
    const second = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => order.push("second"),
    });

    coordinator.observe(
      keyA,
      claudeObservation(RESET - 1, {
        usedPercent: null,
        resetsAtMs: RESET + WINDOW,
        providerObservationSequence: initialSequence + 1,
      }),
    );
    expect(order).toEqual([]);

    const resetEvidence = claudeObservation(RESET, {
      usedPercent: null,
      resetsAtMs: RESET + WINDOW,
      providerObservationSequence: initialSequence + 2,
    });
    coordinator.observe(keyA, resetEvidence);
    expect(coordinator.getSnapshot(keyA)?.phase).toBe("draining");
    expect(order).toEqual([]);

    finishActive();
    await active.promise;
    await first.promise;
    expect(order).toEqual(["first"]);
    expect(coordinator.waitingCount).toBe(1);

    coordinator.observe(keyA, resetEvidence);
    expect(order).toEqual(["first"]);
    expect(second.cancel()).toBe(true);
    await expect(second.promise).rejects.toBeInstanceOf(PacingAdmissionCancelledError);
  });

  it("requires fresh evidence after pacing is disabled and re-enabled", async () => {
    const { coordinator } = setup();
    const initial = claudeObservation(0, { usedPercent: 85 });
    const initialSequence = requiredProviderSequence(initial);
    coordinator.observe(keyA, initial);
    await coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => "initial",
    }).promise;

    coordinator.observe(keyA, {
      ...initial,
      enabled: false,
      providerObservationSequence: initialSequence + 1,
    });
    await expect(
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: keyA,
        launch: () => "disabled",
      }).promise,
    ).resolves.toBe("disabled");

    coordinator.observe(keyA, {
      ...initial,
      providerObservationSequence: initialSequence + 1,
    });
    const launch = vi.fn(() => "fresh");
    const waiting = coordinator.submitNewLaunch({ kind: "new-launch", key: keyA, launch });
    expect(launch).not.toHaveBeenCalled();

    coordinator.observe(keyA, {
      ...initial,
      usedPercent: 84,
      observedAtMs: 1,
      providerObservationSequence: initialSequence + 2,
    });
    await expect(waiting.promise).resolves.toBe("fresh");
  });

  it("applies a same-evidence minimum pause update after active work drains", async () => {
    const { clock, coordinator } = setup();
    let release!: () => void;
    const active = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => new Promise<void>((resolve) => (release = resolve)),
    });
    clock.advanceTo(WINDOW * 0.1);
    const observation = codexPauseObservation(clock.now());
    coordinator.observe(keyA, observation);
    expect(coordinator.getSnapshot(keyA)?.phase).toBe("draining");

    coordinator.observe(keyA, {
      ...observation,
      minimumPauseMs: WINDOW * 0.4,
    });
    release();
    await active.promise;

    expect(coordinator.getSnapshot(keyA)).toMatchObject({
      phase: "paused",
      resumeAtMs: WINDOW * 0.5,
    });
  });

  it("does not mint a caution authorization from a settings-only replay", async () => {
    const { coordinator } = setup();
    const observation = claudeObservation(0, { usedPercent: 85 });
    coordinator.observe(keyA, observation);
    await expect(
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: keyA,
        launch: () => "authorized",
      }).promise,
    ).resolves.toBe("authorized");

    const launch = vi.fn(() => "must-wait");
    const waiting = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch,
    });
    coordinator.observe(keyA, {
      ...observation,
      minimumPauseMs: 10 * 60_000,
    });

    expect(launch).not.toHaveBeenCalled();
    expect(waiting.cancel()).toBe(true);
    await expect(waiting.promise).rejects.toBeInstanceOf(PacingAdmissionCancelledError);
  });

  it("closes before the next queued launch when a launch synchronously closes its gate", async () => {
    const { coordinator } = setup();
    const order: string[] = [];
    const first = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => {
        order.push("first");
        coordinator.observe(keyA, claudeObservation(0));
      },
    });
    const second = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => order.push("second"),
    });

    await first.promise;
    expect(order).toEqual(["first"]);
    expect(coordinator.waitingCount).toBe(1);
    expect(coordinator.getSnapshot(keyA)?.phase).toBe("waiting-reset");
    expect(second.cancel()).toBe(true);
    await expect(second.promise).rejects.toBeInstanceOf(PacingAdmissionCancelledError);
  });

  it("lets active work drain and starts waiting work only after policy reopens", async () => {
    const { coordinator } = setup();
    let release!: () => void;
    const active = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => new Promise<void>((resolve) => (release = resolve)),
    });
    coordinator.observe(keyA, claudeObservation(0));
    const waitingLaunch = vi.fn(() => "started");
    const waiting = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: waitingLaunch,
    });

    release();
    await active.promise;
    expect(waitingLaunch).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot(keyA)?.phase).toBe("waiting-reset");

    coordinator.observe(
      keyA,
      claudeObservation(RESET, {
        usedPercent: 1,
        resetsAtMs: RESET + WINDOW,
      }),
    );
    await expect(waiting.promise).resolves.toBe("started");
  });

  it("adopts already-active work idempotently and waits for its natural release", async () => {
    const { coordinator } = setup();
    coordinator.observe(
      keyA,
      claudeObservation(0, {
        usedPercent: null,
        providerObservationSequence: null,
      }),
    );
    const adopted = coordinator.adoptActiveWork(keyA, "thread-a");
    const duplicate = coordinator.adoptActiveWork(keyA, "thread-a");
    expect(duplicate).toBe(adopted);
    expect(coordinator.activeCount).toBe(1);

    const launch = vi.fn(() => "started");
    const waiting = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      dispatchSource: "user",
      launch,
    });
    expect(launch).not.toHaveBeenCalled();

    expect(adopted.release()).toBe(true);
    expect(adopted.release()).toBe(false);
    expect(coordinator.activeCount).toBe(1);
    await expect(waiting.promise).resolves.toBe("started");
    expect(coordinator.activeCount).toBe(0);
  });

  it("does not release adopted provider work when the coordinator is disposed", () => {
    const { coordinator } = setup();
    const adopted = coordinator.adoptActiveWork(keyA, "thread-a");
    coordinator.dispose();

    expect(coordinator.activeCount).toBe(1);
    expect(adopted.release()).toBe(true);
    expect(coordinator.activeCount).toBe(0);
  });

  it("retires only the exact provider key and rejects its queued launches", async () => {
    const { coordinator } = setup();
    coordinator.observe(keyA, claudeObservation(0));
    coordinator.observe(keyB, claudeObservation(0));
    const waitingA = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => "must-not-start",
    });
    const waitingB = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyB,
      launch: () => "other-key",
    });

    expect(coordinator.retireKey(keyA)).toBe(true);
    expect(coordinator.retireKey(keyA)).toBe(false);
    await expect(waitingA.promise).rejects.toBeInstanceOf(PacingAdmissionRetiredError);
    expect(waitingA.cancel()).toBe(false);
    expect(coordinator.waitingCount).toBe(1);

    coordinator.observe(
      keyB,
      claudeObservation(RESET, {
        usedPercent: 1,
        resetsAtMs: RESET + WINDOW,
      }),
    );
    await expect(waitingB.promise).resolves.toBe("other-key");
  });

  it("never interrupts active work when its provider key is retired", async () => {
    const { coordinator } = setup();
    let release!: () => void;
    const active = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => new Promise<string>((resolve) => (release = () => resolve("natural"))),
    });

    expect(coordinator.activeCount).toBe(1);
    expect(coordinator.retireKey(keyA)).toBe(true);
    expect(coordinator.activeCount).toBe(1);
    await expect(
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: keyA,
        launch: () => "must-not-start",
      }).promise,
    ).rejects.toBeInstanceOf(PacingAdmissionRetiredError);
    expect(() => coordinator.adoptActiveWork(keyA, "late-active")).toThrow(
      PacingAdmissionRetiredError,
    );

    release();
    await expect(active.promise).resolves.toBe("natural");
    expect(coordinator.activeCount).toBe(0);
  });

  it("requires provider evidence before a retired key can launch again", async () => {
    const { coordinator } = setup();
    const observed = claudeObservation(0, { usedPercent: 1 });
    coordinator.observe(keyA, observed);
    expect(coordinator.retireKey(keyA)).toBe(true);

    const beforeEvidence = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => "before-evidence",
    });
    await expect(beforeEvidence.promise).rejects.toBeInstanceOf(PacingAdmissionRetiredError);

    coordinator.observe(keyA, observed);
    const replayedEvidence = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => "replayed-evidence",
    });
    expect(coordinator.waitingCount).toBe(1);

    coordinator.observe(
      keyA,
      claudeObservation(1, {
        usedPercent: 1,
        providerObservationSequence: requiredProviderSequence(observed) + 1,
      }),
    );
    await expect(replayedEvidence.promise).resolves.toBe("replayed-evidence");
  });

  it("captures observations so caller mutation cannot reopen a draining gate", async () => {
    const { coordinator } = setup();
    let release!: () => void;
    const active = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => new Promise<void>((resolve) => (release = resolve)),
    });
    const observation = claudeObservation(0);
    coordinator.observe(keyA, observation);
    const launch = vi.fn(() => "must-wait");
    const waiting = coordinator.submitNewLaunch({ kind: "new-launch", key: keyA, launch });

    Object.assign(observation, {
      enabled: false,
      providerFamily: "other",
      usedPercent: 0,
    });
    release();
    await active.promise;

    expect(launch).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot(keyA)?.phase).toBe("waiting-reset");
    expect(waiting.cancel()).toBe(true);
    await expect(waiting.promise).rejects.toBeInstanceOf(PacingAdmissionCancelledError);
  });

  it("makes cancellation atomic with launch start", async () => {
    const { coordinator } = setup();
    coordinator.observe(keyA, claudeObservation(0));
    const launch = vi.fn(() => 42);
    const admission = coordinator.submitNewLaunch({ kind: "new-launch", key: keyA, launch });

    expect(admission.cancel()).toBe(true);
    expect(admission.cancel()).toBe(false);
    expect(launch).not.toHaveBeenCalled();
    await expect(admission.promise).rejects.toBeInstanceOf(PacingAdmissionCancelledError);

    coordinator.observe(keyB, claudeObservation(0, { usedPercent: 1 }));
    const started = coordinator.submitNewLaunch({ kind: "new-launch", key: keyB, launch });
    expect(started.cancel()).toBe(false);
    await expect(started.promise).resolves.toBe(42);
  });

  it("enforces per-key, global, and tracked-key caps without evicting closed policy state", async () => {
    const { coordinator } = setup({
      maxWaitingGlobal: 2,
      maxWaitingPerKey: 1,
      maxTrackedKeys: 2,
    });
    coordinator.observe(keyA, claudeObservation(0));
    coordinator.observe(keyB, claudeObservation(0));

    const first = coordinator.submitNewLaunch({ kind: "new-launch", key: keyA, launch: () => 1 });
    const perKeyOverflow = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => 2,
    });
    await expect(perKeyOverflow.promise).rejects.toBeInstanceOf(PacingAdmissionCapacityError);

    const second = coordinator.submitNewLaunch({ kind: "new-launch", key: keyB, launch: () => 3 });
    const thirdKey = { ...keyA, environmentId: "environment-c" };
    const keyOverflow = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: thirdKey,
      launch: () => 4,
    });
    await expect(keyOverflow.promise).rejects.toBeInstanceOf(PacingAdmissionCapacityError);

    const globalOverflow = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyB,
      launch: () => 5,
    });
    await expect(globalOverflow.promise).rejects.toBeInstanceOf(PacingAdmissionCapacityError);

    first.cancel();
    second.cancel();
    await Promise.allSettled([first.promise, second.promise]);
  });

  it("does not apply waiting capacity to an open key that starts synchronously", async () => {
    const { coordinator } = setup({ maxWaitingGlobal: 1 });
    coordinator.observe(keyA, claudeObservation(0));
    const waiting = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => "waiting",
    });

    await expect(
      coordinator.submitNewLaunch({ kind: "new-launch", key: keyB, launch: () => "open" }).promise,
    ).resolves.toBe("open");
    waiting.cancel();
    await expect(waiting.promise).rejects.toBeInstanceOf(PacingAdmissionCancelledError);
  });

  it("treats environment, provider instance, and provider account as exact key parts", async () => {
    const { coordinator } = setup();
    coordinator.observe(keyA, claudeObservation(0));
    const otherAccount = { ...keyA, providerAccountId: "account-b" };
    const otherInstance = { ...keyA, providerInstanceId: "claude-secondary" };

    await expect(
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: otherAccount,
        launch: () => "other-account",
      }).promise,
    ).resolves.toBe("other-account");
    await expect(
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: otherInstance,
        launch: () => "other-instance",
      }).promise,
    ).resolves.toBe("other-instance");
  });

  it("preserves global FIFO across keys and skips a closed key without head-of-line blocking", async () => {
    const { coordinator } = setup();
    coordinator.observe(keyA, claudeObservation(0));
    coordinator.observe(keyB, claudeObservation(0));
    const order: string[] = [];
    const a1 = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => order.push("a1"),
    });
    const b1 = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyB,
      launch: () => order.push("b1"),
    });
    const a2 = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => order.push("a2"),
    });

    coordinator.observe(keyB, claudeObservation(1, { providerFamily: "other", usedPercent: null }));
    expect(order).toEqual(["b1"]);
    await b1.promise;

    coordinator.observe(
      keyA,
      claudeObservation(RESET, { usedPercent: 1, resetsAtMs: RESET + WINDOW }),
    );
    expect(order).toEqual(["b1", "a1", "a2"]);
    await Promise.all([a1.promise, a2.promise]);
  });

  it("starts simultaneous multi-key deadline releases in global FIFO order", async () => {
    const { clock, coordinator } = setup();
    coordinator.observe(keyA, codexPauseObservation(WINDOW * 0.1));
    coordinator.observe(keyB, codexPauseObservation(WINDOW * 0.1));
    const order: string[] = [];
    const admissions = [
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: keyA,
        launch: () => order.push("a1"),
      }),
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: keyB,
        launch: () => order.push("b1"),
      }),
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: keyA,
        launch: () => order.push("a2"),
      }),
      coordinator.submitNewLaunch({
        kind: "new-launch",
        key: keyB,
        launch: () => order.push("b2"),
      }),
    ];

    clock.advanceTo(WINDOW * 0.2);
    await Promise.all(admissions.map(({ promise }) => promise));
    expect(order).toEqual(["a1", "b1", "a2", "b2"]);
  });

  it("automatically wakes a timed pause but never timer-opens a reset wait", async () => {
    const { clock, coordinator } = setup();
    coordinator.observe(keyA, codexPauseObservation(WINDOW * 0.1));
    const timedLaunch = vi.fn(() => "timed");
    const timed = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: timedLaunch,
    });

    clock.advanceTo(WINDOW * 0.2 - 1);
    expect(timedLaunch).not.toHaveBeenCalled();
    clock.advanceTo(WINDOW * 0.2);
    await expect(timed.promise).resolves.toBe("timed");

    coordinator.observe(keyB, claudeObservation(WINDOW * 0.2));
    const resetLaunch = vi.fn(() => "reset");
    const reset = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyB,
      launch: resetLaunch,
    });
    clock.advanceTo(RESET + WINDOW);
    expect(resetLaunch).not.toHaveBeenCalled();
    reset.cancel();
    await expect(reset.promise).rejects.toBeInstanceOf(PacingAdmissionCancelledError);
  });

  it("keeps reset waits closed for stale or malformed observations", async () => {
    const { coordinator } = setup();
    coordinator.observe(keyA, claudeObservation(0));
    const launch = vi.fn(() => "started");
    const waiting = coordinator.submitNewLaunch({ kind: "new-launch", key: keyA, launch });

    coordinator.observe(keyA, claudeObservation(RESET, { stale: true }));
    coordinator.observe(keyA, claudeObservation(RESET + 1, { usedPercent: null }));
    expect(launch).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot(keyA)?.phase).toBe("waiting-reset");

    coordinator.observe(
      keyA,
      claudeObservation(RESET + 2, {
        usedPercent: 1,
        resetsAtMs: RESET + WINDOW,
      }),
    );
    await expect(waiting.promise).resolves.toBe("started");
  });

  it("disposes waiters without signalling active work", async () => {
    const { coordinator } = setup();
    let release!: () => void;
    const launch = vi.fn(
      () => new Promise<string>((resolve) => (release = () => resolve("natural"))),
    );
    const active = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch,
    });
    coordinator.observe(keyA, claudeObservation(0));
    const waiting = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => "must-not-start",
    });

    coordinator.dispose();
    await expect(waiting.promise).rejects.toBeInstanceOf(PacingAdmissionDisposedError);
    expect(waiting.cancel()).toBe(false);
    expect(coordinator.activeCount).toBe(1);
    expect(launch).toHaveBeenCalledWith();
    expect(
      Object.getOwnPropertyNames(BoundedPacingAdmissionCoordinator.prototype).join(" "),
    ).not.toMatch(/abort|interrupt|kill|stop|terminate/i);
    release();
    await expect(active.promise).resolves.toBe("natural");
    expect(coordinator.activeCount).toBe(0);
  });

  it("cleans active accounting after synchronous throws and rejected launches", async () => {
    const { coordinator } = setup();
    const thrown = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => {
        throw new Error("sync");
      },
    });
    await expect(thrown.promise).rejects.toThrow("sync");
    expect(coordinator.activeCount).toBe(0);

    const rejected = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => Promise.reject(new Error("async")),
    });
    await expect(rejected.promise).rejects.toThrow("async");
    expect(coordinator.activeCount).toBe(0);

    await expect(
      coordinator.submitNewLaunch({ kind: "new-launch", key: keyA, launch: () => "next" }).promise,
    ).resolves.toBe("next");
  });

  it("drains the hard queue bound without recursive synchronous-failure overflow", async () => {
    const { clock, coordinator } = setup({
      maxWaitingGlobal: 4_096,
      maxWaitingPerKey: 512,
      maxTrackedKeys: 8,
    });
    const promises: Promise<unknown>[] = [];
    for (let keyIndex = 0; keyIndex < 8; keyIndex += 1) {
      const key = { ...keyA, environmentId: `environment-${keyIndex}` };
      coordinator.observe(key, codexPauseObservation(WINDOW * 0.1));
      for (let entryIndex = 0; entryIndex < 512; entryIndex += 1) {
        const promise = coordinator.submitNewLaunch({
          kind: "new-launch",
          key,
          launch: () => {
            throw new Error("expected launch failure");
          },
        }).promise;
        void promise.catch(() => undefined);
        promises.push(promise);
      }
    }

    expect(() => clock.advanceTo(WINDOW * 0.2)).not.toThrow();
    expect((await Promise.allSettled(promises)).every(({ status }) => status === "rejected")).toBe(
      true,
    );
    expect(coordinator.activeCount).toBe(0);
    expect(coordinator.waitingCount).toBe(0);
  });
});
