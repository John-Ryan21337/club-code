import { describe, expect, it } from "vitest";

import {
  applyStderrWarningBudget,
  formatSuppressedStderrSummary,
  makeStderrWarningBudgetState,
} from "./stderrWarningBudget.ts";

const options = { windowMs: 1_000, maxPerWindow: 3 };

describe("applyStderrWarningBudget", () => {
  it("passes lines through until the per-window budget is exhausted", () => {
    const state = makeStderrWarningBudgetState(0);
    const first = applyStderrWarningBudget(state, 10, ["a", "b"], options);
    expect(first.messages).toEqual(["a", "b"]);
    expect(first.suppressedCount).toBe(0);

    const second = applyStderrWarningBudget(state, 20, ["c", "d", "e"], options);
    expect(second.messages).toEqual(["c"]);
    expect(second.suppressedCount).toBe(2);
    expect(state.suppressedInWindow).toBe(2);
  });

  it("emits one summary line when the next window opens and resets the budget", () => {
    const state = makeStderrWarningBudgetState(0);
    applyStderrWarningBudget(state, 10, ["a", "b", "c", "d", "e", "f"], options);
    expect(state.suppressedInWindow).toBe(3);

    const next = applyStderrWarningBudget(state, 1_500, ["g"], options);
    expect(next.messages).toEqual([formatSuppressedStderrSummary(3, options.windowMs), "g"]);
    expect(next.suppressedCount).toBe(0);
    expect(state.windowStartedAtMs).toBe(1_500);
    expect(state.emittedInWindow).toBe(1);
    expect(state.suppressedInWindow).toBe(0);
  });

  it("does not emit a summary when nothing was suppressed", () => {
    const state = makeStderrWarningBudgetState(0);
    applyStderrWarningBudget(state, 10, ["a"], options);
    const next = applyStderrWarningBudget(state, 5_000, ["b"], options);
    expect(next.messages).toEqual(["b"]);
  });

  it("treats a clock that moved backwards as a fresh window", () => {
    const state = makeStderrWarningBudgetState(10_000);
    applyStderrWarningBudget(state, 10_000, ["a", "b", "c", "d"], options);
    const next = applyStderrWarningBudget(state, 9_000, ["e"], options);
    expect(next.messages).toEqual([formatSuppressedStderrSummary(1, options.windowMs), "e"]);
  });

  it("bounds a flood of thousands of copied output lines to the budget", () => {
    const state = makeStderrWarningBudgetState(0);
    const flood = Array.from({ length: 5_000 }, (_, index) => `line ${index}`);
    const result = applyStderrWarningBudget(state, 1, flood, options);
    expect(result.messages).toHaveLength(3);
    expect(result.suppressedCount).toBe(4_997);
  });
});
