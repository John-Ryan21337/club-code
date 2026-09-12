import { afterEach, describe, expect, it, vi } from "vitest";

import {
  collectCompletionTransitionKeys,
  createCompletionBurstCoalescer,
  isRunningToCompletedTransition,
  type CompletionTurnSnapshot,
} from "./completionAlertTransitions";

function snapshots(
  entries: readonly (readonly [string, string | null, string | null])[],
): Map<string, CompletionTurnSnapshot> {
  return new Map(entries.map(([key, turnId, state]) => [key, { turnId, state }]));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("completion alert transitions", () => {
  it("alerts only when the same observed running turn becomes completed", () => {
    expect(
      isRunningToCompletedTransition(
        { turnId: "turn-1", state: "running" },
        { turnId: "turn-1", state: "completed" },
      ),
    ).toBe(true);
    expect(
      isRunningToCompletedTransition(undefined, {
        turnId: "turn-1",
        state: "completed",
      }),
    ).toBe(false);
    expect(
      isRunningToCompletedTransition(
        { turnId: "turn-1", state: "running" },
        { turnId: "turn-1", state: "interrupted" },
      ),
    ).toBe(false);
    expect(
      isRunningToCompletedTransition(
        { turnId: "turn-1", state: "running" },
        { turnId: "turn-2", state: "completed" },
      ),
    ).toBe(false);
  });

  it("coalesces a burst and enforces a quiet cooldown", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const onBurst = vi.fn();
    const coalescer = createCompletionBurstCoalescer(onBurst, {
      settleMs: 100,
      cooldownMs: 1_000,
    });
    coalescer.notify();
    coalescer.notify();
    coalescer.notify();
    vi.advanceTimersByTime(99);
    expect(onBurst).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onBurst).toHaveBeenCalledOnce();

    vi.setSystemTime(10_200);
    coalescer.notify();
    vi.advanceTimersByTime(899);
    expect(onBurst).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1);
    expect(onBurst).toHaveBeenCalledTimes(2);
    coalescer.dispose();
  });
});

describe("completion transition collection", () => {
  it("stays silent with no baseline, which covers hydration, reconnect, and remount", () => {
    expect(
      collectCompletionTransitionKeys(
        null,
        snapshots([
          ["env-1:thread-a", "turn-1", "completed"],
          ["env-1:thread-b", "turn-2", "completed"],
        ]),
      ),
    ).toEqual([]);
  });

  it("reports every thread whose observed running turn completed in one tick", () => {
    const previous = snapshots([
      ["env-1:thread-a", "turn-1", "running"],
      ["env-1:thread-b", "turn-2", "running"],
      ["env-1:thread-c", "turn-3", "running"],
    ]);
    const next = snapshots([
      ["env-1:thread-a", "turn-1", "completed"],
      ["env-1:thread-b", "turn-2", "completed"],
      ["env-1:thread-c", "turn-3", "interrupted"],
    ]);
    expect(collectCompletionTransitionKeys(previous, next)).toEqual([
      "env-1:thread-a",
      "env-1:thread-b",
    ]);
  });

  it("does not re-report an already completed turn on a later store refill", () => {
    const completed = snapshots([["env-1:thread-a", "turn-1", "completed"]]);
    expect(collectCompletionTransitionKeys(completed, completed)).toEqual([]);
    // A newly appearing thread that is already completed was never observed
    // running here, so it must not alert either.
    expect(
      collectCompletionTransitionKeys(
        snapshots([["env-1:thread-a", "turn-1", "completed"]]),
        snapshots([
          ["env-1:thread-a", "turn-1", "completed"],
          ["env-2:thread-z", "turn-9", "completed"],
        ]),
      ),
    ).toEqual([]);
  });

  it("ignores a thread that vanished from the next snapshot", () => {
    expect(
      collectCompletionTransitionKeys(
        snapshots([["env-1:thread-a", "turn-1", "running"]]),
        snapshots([]),
      ),
    ).toEqual([]);
  });
});

describe("completion burst coalescer async bursts", () => {
  it("does not start a second alert while one is still playing", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const onBurst = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const coalescer = createCompletionBurstCoalescer(onBurst, { settleMs: 10, cooldownMs: 20 });
    coalescer.notify();
    await vi.advanceTimersByTimeAsync(10);
    expect(onBurst).toHaveBeenCalledTimes(1);
    expect(coalescer.isRunning()).toBe(true);

    // A long native dual alert can outlast the cooldown; a burst arriving in
    // that window must be dropped instead of stacking a second AudioContext.
    await vi.advanceTimersByTimeAsync(100);
    coalescer.notify();
    await vi.advanceTimersByTimeAsync(100);
    expect(onBurst).toHaveBeenCalledTimes(1);

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(coalescer.isRunning()).toBe(false);
    // The cooldown is measured from the end of playback.
    coalescer.notify();
    await vi.advanceTimersByTimeAsync(19);
    expect(onBurst).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5);
    expect(onBurst).toHaveBeenCalledTimes(2);
    coalescer.dispose();
  });

  it("swallows a rejected burst and stays usable", async () => {
    vi.useFakeTimers();
    const onBurst = vi.fn(() => Promise.reject(new Error("playback failed")));
    const coalescer = createCompletionBurstCoalescer(onBurst, { settleMs: 1, cooldownMs: 1 });
    coalescer.notify();
    await vi.advanceTimersByTimeAsync(2);
    expect(coalescer.isRunning()).toBe(false);
    coalescer.notify();
    await vi.advanceTimersByTimeAsync(5);
    expect(onBurst).toHaveBeenCalledTimes(2);
    coalescer.dispose();
  });
});
