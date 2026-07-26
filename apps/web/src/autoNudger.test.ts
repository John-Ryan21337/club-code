import { describe, expect, it } from "vitest";
import {
  AUTO_NUDGE_DELAY_MS,
  AUTO_NUDGE_PROMPTS,
  AutoNudgeTimerController,
  AutoNudgeTurnLedger,
  autoNudgeDispatchIdentityForTurn,
  autoNudgePromptForMode,
  canDispatchAutoNudge,
  canScheduleAutoNudge,
  consumeAutoNudgeTerminalForManualActivity,
  createAutoNudgeTurnLedger,
  normalizeAutoNudgeTerminalTurnKey,
  providerCanAcceptAutoNudgeTurn,
} from "./autoNudger";

const eligible = {
  terminalTurnKey: "environment:thread:turn:2026-07-23T00:00:00.000Z",
  mode: "hardcore-fanout" as const,
  hasManualActivity: false,
  hasPendingWork: false,
  providerAvailable: true,
};

function providerWithRateLimits(rateLimits: {
  readonly rateLimitReachedType?: string | null;
  readonly spendControlReached?: boolean | null;
  readonly primary?: { readonly usedPercent?: number | null } | null;
  readonly secondary?: { readonly usedPercent?: number | null } | null;
  readonly credits?: {
    readonly hasCredits: boolean;
    readonly unlimited: boolean;
  } | null;
}) {
  return { accountRateLimits: { rateLimits } };
}

describe("auto nudger safety gates", () => {
  it("uses the exact, intentionally short prompts", () => {
    expect(AUTO_NUDGE_PROMPTS["hardcore-fanout"]).toBe("Fan out and keep going");
    expect(AUTO_NUDGE_PROMPTS["steady-progress"]).toBe(
      "Keep a few lanes going, make steady progress",
    );
    expect(autoNudgePromptForMode("off")).toBeNull();
  });

  it("fails closed for disable, manual input, pending work, and an unavailable provider", () => {
    expect(canScheduleAutoNudge(eligible)).toBe(true);
    expect(canScheduleAutoNudge({ ...eligible, mode: "off" })).toBe(false);
    expect(canScheduleAutoNudge({ ...eligible, hasManualActivity: true })).toBe(false);
    expect(canScheduleAutoNudge({ ...eligible, hasPendingWork: true })).toBe(false);
    expect(canScheduleAutoNudge({ ...eligible, providerAvailable: false })).toBe(false);
  });

  it("fails closed for exhausted provider windows, spend controls, and credits", () => {
    expect(providerCanAcceptAutoNudgeTurn(null)).toBe(true);
    expect(
      providerCanAcceptAutoNudgeTurn(providerWithRateLimits({ primary: { usedPercent: 99.9 } })),
    ).toBe(true);
    expect(
      providerCanAcceptAutoNudgeTurn(providerWithRateLimits({ primary: { usedPercent: 100 } })),
    ).toBe(false);
    expect(
      providerCanAcceptAutoNudgeTurn(providerWithRateLimits({ secondary: { usedPercent: 100 } })),
    ).toBe(false);
    expect(
      providerCanAcceptAutoNudgeTurn(providerWithRateLimits({ rateLimitReachedType: "primary" })),
    ).toBe(false);
    expect(
      providerCanAcceptAutoNudgeTurn(providerWithRateLimits({ spendControlReached: true })),
    ).toBe(false);
    expect(
      providerCanAcceptAutoNudgeTurn(
        providerWithRateLimits({ credits: { hasCredits: false, unlimited: false } }),
      ),
    ).toBe(false);
    expect(
      providerCanAcceptAutoNudgeTurn(
        providerWithRateLimits({ credits: { hasCredits: false, unlimited: true } }),
      ),
    ).toBe(true);
  });

  it("deduplicates a terminal turn, including repeated completion observations", () => {
    const ledger = new AutoNudgeTurnLedger();
    expect(ledger.has(eligible.terminalTurnKey)).toBe(false);
    ledger.mark(eligible.terminalTurnKey);
    ledger.mark(eligible.terminalTurnKey);
    expect(ledger.has(eligible.terminalTurnKey)).toBe(true);
    expect(ledger.has("environment:thread:new-turn:2026-07-23T00:01:00.000Z")).toBe(false);
  });

  it("derives stable transport identities from the terminal turn boundary", () => {
    const first = autoNudgeDispatchIdentityForTurn(eligible.terminalTurnKey);
    const replay = autoNudgeDispatchIdentityForTurn(eligible.terminalTurnKey);
    const next = autoNudgeDispatchIdentityForTurn("environment:thread:next-turn");

    expect(replay).toEqual(first);
    expect(next).not.toEqual(first);
    expect(String(first.commandId)).toContain(eligible.terminalTurnKey);
    expect(first.commandId).not.toBe(first.messageId);
    expect(() => autoNudgeDispatchIdentityForTurn("x".repeat(513))).toThrow(
      "bounded provider-confirmed terminal turn key",
    );
    expect(normalizeAutoNudgeTerminalTurnKey("x".repeat(512))).toBe("x".repeat(512));
    expect(normalizeAutoNudgeTerminalTurnKey("x".repeat(513))).toBeNull();
    expect(normalizeAutoNudgeTerminalTurnKey(" unsafe ")).toBeNull();
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
