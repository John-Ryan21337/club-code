import { describe, expect, it } from "vitest";
import {
  AUTO_NUDGE_PROMPTS,
  AutoNudgeTurnLedger,
  autoNudgePromptForMode,
  canDispatchAutoNudge,
  canScheduleAutoNudge,
  consumeAutoNudgeTerminalForManualActivity,
  createAutoNudgeTurnLedger,
  isNewAutoNudgeTerminalEdge,
  resolveArmedAutoNudgeTerminal,
} from "./autoNudger";

const eligible = {
  terminalTurnKey: "environment:thread:turn:2026-07-23T00:00:00.000Z",
  mode: "hardcore-fanout" as const,
  hasManualActivity: false,
  hasPendingWork: false,
  providerAvailable: true,
};

describe("auto nudger safety gates", () => {
  it("authorizes only a later exact terminal edge in the same mounted thread", () => {
    const completed = {
      contextKey: "local:thread-a:project-a",
      terminalTurnKey: "local:thread-a:turn-1",
    };
    expect(isNewAutoNudgeTerminalEdge(null, completed)).toBe(false);
    expect(isNewAutoNudgeTerminalEdge(completed, completed)).toBe(false);
    expect(
      isNewAutoNudgeTerminalEdge(completed, {
        contextKey: "local:thread-b:project-a",
        terminalTurnKey: "local:thread-b:turn-1",
      }),
    ).toBe(false);
    expect(isNewAutoNudgeTerminalEdge({ ...completed, terminalTurnKey: null }, completed)).toBe(
      true,
    );
    expect(
      isNewAutoNudgeTerminalEdge(completed, {
        ...completed,
        terminalTurnKey: "local:thread-a:turn-2",
      }),
    ).toBe(true);
  });

  it("retains a new terminal authorization through temporary provider unavailability", () => {
    const previousObservation = {
      contextKey: "local:thread-a:project-a",
      terminalTurnKey: null,
    };
    const currentObservation = {
      contextKey: "local:thread-a:project-a",
      terminalTurnKey: "local:thread-a:turn-1",
    };
    const armedWhileUnavailable = resolveArmedAutoNudgeTerminal({
      previousObservation,
      currentObservation,
      currentlyArmedTerminalTurnKey: null,
      invalidatedByOperatorState: false,
      alreadyConsumed: false,
    });
    expect(armedWhileUnavailable).toBe(currentObservation.terminalTurnKey);
    expect(
      resolveArmedAutoNudgeTerminal({
        previousObservation: currentObservation,
        currentObservation,
        currentlyArmedTerminalTurnKey: armedWhileUnavailable,
        invalidatedByOperatorState: false,
        alreadyConsumed: false,
      }),
    ).toBe(currentObservation.terminalTurnKey);
    expect(
      resolveArmedAutoNudgeTerminal({
        previousObservation: currentObservation,
        currentObservation,
        currentlyArmedTerminalTurnKey: armedWhileUnavailable,
        invalidatedByOperatorState: true,
        alreadyConsumed: false,
      }),
    ).toBeNull();
  });

  it("uses the operator-approved prompts exactly", () => {
    expect(AUTO_NUDGE_PROMPTS["steady-progress"]).toBe(
      "Continue from the current thread context; do not restart discovery or reread settled material. Re-anchor to unresolved operator requests and the project's applicable handoff, plan, canon, and current PR/backlog state. Reuse a compact progress packet when present; refresh external state only after a relevant change or when stale. Select the highest-priority unblocked operator ask, keep at most two coherent lanes, implement the next verifiable slice, and update canon only when evidence or operator intent requires it. Linear owns actionable status and dependencies; Notion owns durable decisions and research; link rather than duplicate. Stop and report when the plan is complete, progress is blocked, or new authority is required.",
    );
    expect(AUTO_NUDGE_PROMPTS["hardcore-fanout"]).toBe(
      "Continue from the current thread context; do not restart discovery. Re-anchor to unresolved operator requests and the project's applicable handoff, plan, canon, and current PR/backlog state. Reconcile external state once per bounded run, then refresh only after a relevant change or when stale. Drive the highest-priority unblocked asks through bounded, non-overlapping parallel lanes with one owner per lane; never fan out duplicate investigation or implementation. Give each lane a compact context packet, converge through repository gates and required independent audits, and update canon only when evidence or operator intent requires it. Linear owns actionable status and dependencies; Notion owns durable decisions and research; link rather than duplicate. Stop fan-out when lanes contend, context cost exceeds its value, work is complete or blocked, or new authority is required.",
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

  it("deduplicates a terminal turn, including repeated completion observations", () => {
    const ledger = new AutoNudgeTurnLedger();
    expect(ledger.has(eligible.terminalTurnKey)).toBe(false);
    ledger.mark(eligible.terminalTurnKey);
    ledger.mark(eligible.terminalTurnKey);
    expect(ledger.has(eligible.terminalTurnKey)).toBe(true);
    expect(ledger.has("environment:thread:new-turn:2026-07-23T00:01:00.000Z")).toBe(false);
  });

  it("consumes a manual action before completion-event dispatch", () => {
    const ledger = new AutoNudgeTurnLedger();

    consumeAutoNudgeTerminalForManualActivity(ledger, eligible.terminalTurnKey);

    expect(
      canDispatchAutoNudge({
        terminalTurnKey: eligible.terminalTurnKey,
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

  it("reloads a durable claim made by another renderer before dispatch", () => {
    const storageValues = new Map<string, string>();
    const storage = {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => storageValues.set(key, value),
      removeItem: (key: string) => storageValues.delete(key),
    };
    const firstWindow = createAutoNudgeTurnLedger(storage);
    const secondWindow = createAutoNudgeTurnLedger(storage);

    firstWindow.mark(eligible.terminalTurnKey);
    expect(secondWindow.has(eligible.terminalTurnKey)).toBe(false);
    secondWindow.reloadFromStorage();

    expect(secondWindow.has(eligible.terminalTurnKey)).toBe(true);
  });

  it("merges stale renderer claims instead of overwriting another thread's ledger", () => {
    const storageValues = new Map<string, string>();
    const storage = {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => storageValues.set(key, value),
      removeItem: (key: string) => storageValues.delete(key),
    };
    const firstWindow = createAutoNudgeTurnLedger(storage);
    const secondWindow = createAutoNudgeTurnLedger(storage);

    firstWindow.mark("environment:thread-a:turn-1");
    secondWindow.mark("environment:thread-b:turn-1");
    firstWindow.reloadFromStorage();

    expect(firstWindow.has("environment:thread-a:turn-1")).toBe(true);
    expect(firstWindow.has("environment:thread-b:turn-1")).toBe(true);
  });

  it("fails closed before parsing an oversized persisted ledger", () => {
    const storage = {
      getItem: () => `["${eligible.terminalTurnKey}"]${" ".repeat(200_000)}`,
      setItem: () => undefined,
      removeItem: () => undefined,
    };

    expect(createAutoNudgeTurnLedger(storage).has(eligible.terminalTurnKey)).toBe(false);
  });

  it("re-checks disable/manual-input races before completion-event dispatch", () => {
    const terminalTurnKey = eligible.terminalTurnKey;
    expect(
      canDispatchAutoNudge({ terminalTurnKey, current: eligible, alreadyConsumed: false }),
    ).toBe(true);
    expect(
      canDispatchAutoNudge({
        terminalTurnKey,
        current: { ...eligible, mode: "off" },
        alreadyConsumed: false,
      }),
    ).toBe(false);
    expect(
      canDispatchAutoNudge({
        terminalTurnKey,
        current: { ...eligible, hasManualActivity: true },
        alreadyConsumed: false,
      }),
    ).toBe(false);
    expect(
      canDispatchAutoNudge({ terminalTurnKey, current: eligible, alreadyConsumed: true }),
    ).toBe(false);
  });
});
