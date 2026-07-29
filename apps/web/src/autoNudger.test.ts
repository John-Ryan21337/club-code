import { describe, expect, it } from "vitest";
import {
  AUTO_NUDGE_DELAY_MS,
  AUTO_NUDGE_PROMPTS,
  AutoNudgeTimerController,
  AutoNudgeTurnLedger,
  autoNudgePromptForMode,
  canDispatchAutoNudge,
  canScheduleAutoNudge,
  consumeAutoNudgeTerminalForManualActivity,
  createAutoNudgeTurnLedger,
  isAutoNudgeWithinTimeCap,
} from "./autoNudger";

const eligible = {
  terminalTurnKey: "environment:thread:turn:2026-07-23T00:00:00.000Z",
  mode: "hardcore-fanout" as const,
  hasManualActivity: false,
  hasPendingWork: false,
  providerAvailable: true,
};

describe("auto nudger safety gates", () => {
  it("uses the exact reviewed plan-driven prompts", () => {
    expect(AUTO_NUDGE_PROMPTS["steady-progress"]).toBe(
      "Continue from the current thread context; do not restart discovery or reread settled material. Re-anchor to unresolved operator requests and the project's applicable handoff, plan, canon, and current PR/backlog state. Reuse a compact progress packet when present; refresh external state only after a relevant change or when stale. Select the highest-priority unblocked operator ask, keep at most two coherent lanes, implement the next verifiable slice, and update canon only when evidence or operator intent requires it. Linear owns actionable status and dependencies; Notion owns durable decisions and research; link rather than duplicate. Stop and report when the plan is complete, progress is blocked, or new authority is required.",
    );
    expect(AUTO_NUDGE_PROMPTS["hardcore-fanout"]).toBe(
      "Continue from the current thread context; do not restart discovery. Re-anchor to unresolved operator requests and the project's applicable handoff, plan, canon, and current PR/backlog state. Reconcile external state once per bounded run, then refresh only after a relevant change or when stale. Drive the highest-priority unblocked asks through bounded, non-overlapping parallel lanes with one owner per lane; never fan out duplicate investigation or implementation. Give each lane a compact context packet, converge through repository gates and required independent audits, and update canon only when evidence or operator intent requires it. Linear owns actionable status and dependencies; Notion owns durable decisions and research; link rather than duplicate. Stop fan-out when lanes contend, context cost exceeds its value, work is complete or blocked, or new authority is required.",
    );
    for (const prompt of Object.values(AUTO_NUDGE_PROMPTS)) {
      expect(prompt.length).toBeLessThan(1_200);
    }
    expect(autoNudgePromptForMode("off")).toBeNull();
  });

  it("fails closed for disable, manual input, pending work, and an unavailable provider", () => {
    expect(canScheduleAutoNudge(eligible)).toBe(true);
    expect(canScheduleAutoNudge({ ...eligible, mode: "off" })).toBe(false);
    expect(canScheduleAutoNudge({ ...eligible, hasManualActivity: true })).toBe(false);
    expect(canScheduleAutoNudge({ ...eligible, hasPendingWork: true })).toBe(false);
    expect(canScheduleAutoNudge({ ...eligible, providerAvailable: false })).toBe(false);
  });

  it("deduplicates a terminal turn, including repeated completion observations", () => {
    const ledger = new AutoNudgeTurnLedger();
    expect(ledger.has(eligible.terminalTurnKey)).toBe(false);
    ledger.mark(eligible.terminalTurnKey);
    ledger.mark(eligible.terminalTurnKey);
    expect(ledger.has(eligible.terminalTurnKey)).toBe(true);
    expect(ledger.has("environment:thread:new-turn:2026-07-23T00:01:00.000Z")).toBe(false);
  });

  it("bounds observed terminal memory and can forget a canceled debounce", () => {
    const ledger = new AutoNudgeTurnLedger();
    for (let index = 0; index <= 256; index += 1) {
      ledger.mark(`environment:thread:turn-${index}`);
    }

    expect(ledger.has("environment:thread:turn-0")).toBe(false);
    expect(ledger.has("environment:thread:turn-256")).toBe(true);
    ledger.forget("environment:thread:turn-256");
    expect(ledger.has("environment:thread:turn-256")).toBe(false);
  });

  it("enforces the armed server-time window at both schedule and dispatch boundaries", () => {
    const armedAt = "2026-07-23T00:00:00.000Z";
    const config = { armedAt, maxMinutes: 5 };
    const armedAtMs = Date.parse(armedAt);

    expect(isAutoNudgeWithinTimeCap(config, armedAtMs)).toBe(true);
    expect(isAutoNudgeWithinTimeCap(config, armedAtMs + 5 * 60_000 - 1)).toBe(true);
    expect(isAutoNudgeWithinTimeCap(config, armedAtMs + 5 * 60_000)).toBe(false);
    expect(isAutoNudgeWithinTimeCap(config, armedAtMs - 1)).toBe(false);
    expect(isAutoNudgeWithinTimeCap({ ...config, armedAt: "invalid" }, armedAtMs)).toBe(false);
    expect(isAutoNudgeWithinTimeCap({ ...config, armedAt: null }, armedAtMs)).toBe(false);
  });

  it("consumes a manual action before a countdown has been scheduled", () => {
    const ledger = new AutoNudgeTurnLedger();

    consumeAutoNudgeTerminalForManualActivity(ledger, eligible.terminalTurnKey);

    expect(
      canDispatchAutoNudge({
        scheduledTurnKey: eligible.terminalTurnKey,
        current: eligible,
        alreadyConsumed: ledger.has(eligible.terminalTurnKey),
      }),
    ).toBe(false);
    expect(() => consumeAutoNudgeTerminalForManualActivity(ledger, null)).not.toThrow();
  });

  it("rehydrates a consumed-turn ledger across renderer reloads", () => {
    const storageValues = new Map<string, string>();
    const storage = {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => storageValues.set(key, value),
      removeItem: (key: string) => storageValues.delete(key),
    };
    const beforeReload = createAutoNudgeTurnLedger(storage);
    beforeReload.mark(eligible.terminalTurnKey);

    const afterReload = createAutoNudgeTurnLedger(storage);
    expect(afterReload.has(eligible.terminalTurnKey)).toBe(true);
  });

  it("fails closed before parsing an oversized persisted ledger", () => {
    const storage = {
      getItem: () => `["${eligible.terminalTurnKey}"]${" ".repeat(200_000)}`,
      setItem: () => undefined,
      removeItem: () => undefined,
    };

    expect(createAutoNudgeTurnLedger(storage).has(eligible.terminalTurnKey)).toBe(false);
  });

  it("re-checks disable/manual-input races before a scheduled send", () => {
    const scheduledTurnKey = eligible.terminalTurnKey;
    expect(
      canDispatchAutoNudge({ scheduledTurnKey, current: eligible, alreadyConsumed: false }),
    ).toBe(true);
    expect(
      canDispatchAutoNudge({
        scheduledTurnKey,
        current: { ...eligible, mode: "off" },
        alreadyConsumed: false,
      }),
    ).toBe(false);
    expect(
      canDispatchAutoNudge({
        scheduledTurnKey,
        current: { ...eligible, hasManualActivity: true },
        alreadyConsumed: false,
      }),
    ).toBe(false);
    expect(
      canDispatchAutoNudge({ scheduledTurnKey, current: eligible, alreadyConsumed: true }),
    ).toBe(false);
  });

  it("invalidates a hidden-chat timer and safely re-arms a new visible turn", () => {
    let nextTimer = 1;
    let now = 1_000;
    const timeoutCallbacks = new Map<number, () => void>();
    const intervalCallbacks = new Map<number, () => void>();
    const clearedTimeouts: number[] = [];
    const clearedIntervals: number[] = [];
    const controller = new AutoNudgeTimerController({
      now: () => now,
      setTimeout: (callback) => {
        const timer = nextTimer++;
        timeoutCallbacks.set(timer, callback);
        return timer;
      },
      clearTimeout: (timer) => {
        clearedTimeouts.push(timer);
      },
      setInterval: (callback) => {
        const timer = nextTimer++;
        intervalCallbacks.set(timer, callback);
        return timer;
      },
      clearInterval: (timer) => {
        clearedIntervals.push(timer);
      },
    });
    const dispatched: string[] = [];
    const countdowns: number[] = [];

    controller.schedule({
      turnKey: "environment:thread-a:turn-a",
      delayMs: AUTO_NUDGE_DELAY_MS,
      onCountdown: (seconds) => countdowns.push(seconds),
      onDispatch: (turnKey) => dispatched.push(turnKey),
    });
    const staleDispatch = timeoutCallbacks.get(2);
    expect(controller.scheduledTurnKey).toBe("environment:thread-a:turn-a");
    expect(countdowns).toEqual([5]);

    expect(controller.cancel()).toBe("environment:thread-a:turn-a");
    expect(clearedTimeouts).toEqual([2]);
    expect(clearedIntervals).toEqual([1]);
    staleDispatch?.();
    expect(dispatched).toEqual([]);

    controller.schedule({
      turnKey: "environment:thread-b:turn-b",
      delayMs: AUTO_NUDGE_DELAY_MS,
      onCountdown: (seconds) => countdowns.push(seconds),
      onDispatch: (turnKey) => dispatched.push(turnKey),
    });
    expect(controller.scheduledTurnKey).toBe("environment:thread-b:turn-b");
    now += AUTO_NUDGE_DELAY_MS;
    timeoutCallbacks.get(4)?.();
    expect(dispatched).toEqual(["environment:thread-b:turn-b"]);
    expect(controller.scheduledTurnKey).toBeNull();
  });
});
