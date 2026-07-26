import { describe, expect, it, vi } from "vitest";

import {
  BoundedPacingAdmissionCoordinator,
  PacingAdmissionCancelledError,
  PacingAdmissionCapacityError,
  PacingAdmissionDisposedError,
  type PacingAdmissionClock,
  type PacingAdmissionKey,
} from "./boundedPacingAdmission.ts";

const HOUR = 60 * 60 * 1_000;
const WINDOW = 4 * HOUR;
const RESET = WINDOW;

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
  };
}

describe("BoundedPacingAdmissionCoordinator", () => {
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
    const active = coordinator.submitNewLaunch({
      kind: "new-launch",
      key: keyA,
      launch: () => new Promise<string>((resolve) => (release = () => resolve("natural"))),
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
});
