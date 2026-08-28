/**
 * Bounded budget for provider process stderr diagnostics.
 *
 * Codex and Claude both write free-form text to stderr. A single failed
 * command can dump thousands of copied output lines there, and each line used
 * to become one durable `runtime.warning` activity plus one WebSocket fanout.
 * One thread accumulated close to a million such rows, which bloated the
 * SQLite state store and slowed every projection read. The budget keeps the
 * first `maxPerWindow` lines per window as real diagnostics and collapses the
 * rest into a single summary line when the next window opens. Native provider
 * logs still receive the complete stderr stream; only work-log activity is
 * bounded here.
 */
export interface StderrWarningBudgetOptions {
  readonly windowMs: number;
  readonly maxPerWindow: number;
}

export interface StderrWarningBudgetState {
  windowStartedAtMs: number;
  emittedInWindow: number;
  suppressedInWindow: number;
}

export interface StderrWarningBudgetResult {
  readonly messages: ReadonlyArray<string>;
  readonly suppressedCount: number;
}

export const DEFAULT_STDERR_WARNING_BUDGET: StderrWarningBudgetOptions = {
  windowMs: 60_000,
  maxPerWindow: 40,
};

export function makeStderrWarningBudgetState(nowMs = 0): StderrWarningBudgetState {
  return {
    windowStartedAtMs: nowMs,
    emittedInWindow: 0,
    suppressedInWindow: 0,
  };
}

export function formatSuppressedStderrSummary(suppressedCount: number, windowMs: number): string {
  const windowSeconds = Math.max(1, Math.round(windowMs / 1000));
  return `Suppressed ${suppressedCount} additional provider stderr line${
    suppressedCount === 1 ? "" : "s"
  } during the previous ${windowSeconds}s window. The complete stream remains in the native provider log.`;
}

export function applyStderrWarningBudget(
  state: StderrWarningBudgetState,
  nowMs: number,
  candidateMessages: ReadonlyArray<string>,
  options: StderrWarningBudgetOptions = DEFAULT_STDERR_WARNING_BUDGET,
): StderrWarningBudgetResult {
  const windowMs = Math.max(1, options.windowMs);
  const maxPerWindow = Math.max(0, options.maxPerWindow);
  const messages: Array<string> = [];

  if (nowMs - state.windowStartedAtMs >= windowMs || nowMs < state.windowStartedAtMs) {
    if (state.suppressedInWindow > 0) {
      messages.push(formatSuppressedStderrSummary(state.suppressedInWindow, windowMs));
    }
    state.windowStartedAtMs = nowMs;
    state.emittedInWindow = 0;
    state.suppressedInWindow = 0;
  }

  let suppressedCount = 0;
  for (const message of candidateMessages) {
    if (state.emittedInWindow < maxPerWindow) {
      state.emittedInWindow += 1;
      messages.push(message);
    } else {
      state.suppressedInWindow += 1;
      suppressedCount += 1;
    }
  }

  return { messages, suppressedCount };
}
