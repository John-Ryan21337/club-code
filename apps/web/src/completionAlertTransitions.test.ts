import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createCompletionBurstCoalescer,
  isRunningToCompletedTransition,
} from "./completionAlertTransitions";

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
