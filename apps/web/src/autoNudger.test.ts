import { describe, expect, it } from "vitest";
import {
  AUTO_NUDGE_PROMPTS,
  AutoNudgeTurnLedger,
  autoNudgePromptForMode,
  canDispatchAutoNudge,
  canScheduleAutoNudge,
  consumeAutoNudgeTerminalForManualActivity,
  createAutoNudgeTurnLedger,
  normalizeAutoNudgeBuiltInPrompt,
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

  it("upgrades recognized defaults across modes without touching custom prompts", () => {
    expect(normalizeAutoNudgeBuiltInPrompt("hardcore-fanout", "")).toBe(
      AUTO_NUDGE_PROMPTS["hardcore-fanout"],
    );
    expect(normalizeAutoNudgeBuiltInPrompt("steady-progress", "Fan out and keep going")).toBe(
      AUTO_NUDGE_PROMPTS["steady-progress"],
    );
    expect(
      normalizeAutoNudgeBuiltInPrompt("hardcore-fanout", AUTO_NUDGE_PROMPTS["steady-progress"]),
    ).toBe(AUTO_NUDGE_PROMPTS["hardcore-fanout"]);
    expect(normalizeAutoNudgeBuiltInPrompt("steady-progress", "My custom continuation")).toBe(
      "My custom continuation",
    );
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

  it("bounds observed terminal memory and can forget an observation", () => {
    const ledger = new AutoNudgeTurnLedger();
    for (let index = 0; index <= 256; index += 1) {
      ledger.mark(`environment:thread:turn-${index}`);
    }

    expect(ledger.has("environment:thread:turn-0")).toBe(false);
    expect(ledger.has("environment:thread:turn-256")).toBe(true);
    ledger.forget("environment:thread:turn-256");
    expect(ledger.has("environment:thread:turn-256")).toBe(false);
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
