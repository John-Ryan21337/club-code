import type { AutoNudgeMode } from "@cafecode/contracts";

export type { AutoNudgeMode } from "@cafecode/contracts";

export const AUTO_NUDGE_PROMPTS: Readonly<Record<Exclude<AutoNudgeMode, "off">, string>> = {
  "hardcore-fanout": [
    "Continue from the current thread context; do not restart discovery.",
    "Re-anchor to unresolved operator requests and the project's applicable handoff, plan, canon, and current PR/backlog state.",
    "Reconcile external state once per bounded run, then refresh only after a relevant change or when stale.",
    "Drive the highest-priority unblocked asks through bounded, non-overlapping parallel lanes with one owner per lane; never fan out duplicate investigation or implementation.",
    "Give each lane a compact context packet, converge through repository gates and required independent audits, and update canon only when evidence or operator intent requires it.",
    "Linear owns actionable status and dependencies; Notion owns durable decisions and research; link rather than duplicate.",
    "Stop fan-out when lanes contend, context cost exceeds its value, work is complete or blocked, or new authority is required.",
  ].join(" "),
  "steady-progress": [
    "Continue from the current thread context; do not restart discovery or reread settled material.",
    "Re-anchor to unresolved operator requests and the project's applicable handoff, plan, canon, and current PR/backlog state.",
    "Reuse a compact progress packet when present; refresh external state only after a relevant change or when stale.",
    "Select the highest-priority unblocked operator ask, keep at most two coherent lanes, implement the next verifiable slice, and update canon only when evidence or operator intent requires it.",
    "Linear owns actionable status and dependencies; Notion owns durable decisions and research; link rather than duplicate.",
    "Stop and report when the plan is complete, progress is blocked, or new authority is required.",
  ].join(" "),
};

export function autoNudgePromptForMode(mode: AutoNudgeMode): string | null {
  return mode === "off" ? null : AUTO_NUDGE_PROMPTS[mode];
}

export interface AutoNudgeEligibility {
  /**
   * A stable, provider-confirmed terminal turn identity. It must be based on
   * the opaque turn id, not a mutable completion timestamp, so replay/correction
   * events cannot receive a second nudge.
   */
  terminalTurnKey: string | null;
  mode: AutoNudgeMode;
  hasManualActivity: boolean;
  hasPendingWork: boolean;
  providerAvailable: boolean;
}

export function canScheduleAutoNudge(input: AutoNudgeEligibility): boolean {
  return (
    input.mode !== "off" &&
    input.terminalTurnKey !== null &&
    !input.hasManualActivity &&
    !input.hasPendingWork &&
    input.providerAvailable
  );
}

/** Repeat every safety gate immediately before consuming a completion event. */
export function canDispatchAutoNudge(input: {
  readonly terminalTurnKey: string | null;
  readonly current: AutoNudgeEligibility;
  readonly alreadyConsumed: boolean;
}): boolean {
  return (
    input.terminalTurnKey !== null &&
    input.terminalTurnKey === input.current.terminalTurnKey &&
    canScheduleAutoNudge(input.current) &&
    !input.alreadyConsumed
  );
}

const MAX_AUTO_NUDGE_LEDGER_ENTRIES = 256;
const MAX_AUTO_NUDGE_TURN_KEY_LENGTH = 512;
const MAX_AUTO_NUDGE_LEDGER_STORAGE_CHARACTERS =
  MAX_AUTO_NUDGE_LEDGER_ENTRIES * (MAX_AUTO_NUDGE_TURN_KEY_LENGTH + 8);
export const AUTO_NUDGE_SESSION_LEDGER_STORAGE_KEY = "club-code.auto-nudge.consumed-turns.v1";

export interface AutoNudgeLedgerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isSafeTurnKey(value: unknown): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= MAX_AUTO_NUDGE_TURN_KEY_LENGTH
  );
}

function readLedgerKeys(storage: AutoNudgeLedgerStorage | null): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(AUTO_NUDGE_SESSION_LEDGER_STORAGE_KEY) ?? "[]";
    if (raw.length > MAX_AUTO_NUDGE_LEDGER_STORAGE_CHARACTERS) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSafeTurnKey).slice(-MAX_AUTO_NUDGE_LEDGER_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * A bounded, session-scoped once-per-terminal-turn ledger.
 *
 * The global mode is durable client settings. The consumed-turn ledger is
 * deliberately session storage: it survives route remounts and renderer
 * reloads without turning Auto Nudge into an immortal background worker.
 */
export class AutoNudgeTurnLedger {
  private readonly keyList: string[];
  private readonly keySet = new Set<string>();

  constructor(
    initialKeys: Iterable<string> = [],
    private readonly onChange?: (keys: readonly string[]) => void,
  ) {
    this.keyList = [];
    for (const key of initialKeys) {
      if (!isSafeTurnKey(key) || this.keySet.has(key)) continue;
      this.keyList.push(key);
      this.keySet.add(key);
    }
    while (this.keyList.length > MAX_AUTO_NUDGE_LEDGER_ENTRIES) {
      const removed = this.keyList.shift();
      if (removed) this.keySet.delete(removed);
    }
  }

  has(key: string): boolean {
    return this.keySet.has(key);
  }

  mark(key: string): void {
    if (!isSafeTurnKey(key) || this.keySet.has(key)) return;
    this.keyList.push(key);
    this.keySet.add(key);
    while (this.keyList.length > MAX_AUTO_NUDGE_LEDGER_ENTRIES) {
      const removed = this.keyList.shift();
      if (removed) this.keySet.delete(removed);
    }
    this.onChange?.(this.keyList);
  }
}

/**
 * A real operator action consumes the currently settled turn even if React
 * has not yet handled its completion event. This keeps a cleared draft from
 * reviving an old completion into an unsolicited provider request.
 */
export function consumeAutoNudgeTerminalForManualActivity(
  ledger: Pick<AutoNudgeTurnLedger, "mark">,
  terminalTurnKey: string | null,
): void {
  if (terminalTurnKey) ledger.mark(terminalTurnKey);
}

function resolveSessionStorage(): AutoNudgeLedgerStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

let sharedAutoNudgeTurnLedger: AutoNudgeTurnLedger | null = null;

export function createAutoNudgeTurnLedger(
  storage: AutoNudgeLedgerStorage | null,
): AutoNudgeTurnLedger {
  return new AutoNudgeTurnLedger(readLedgerKeys(storage), (keys) => {
    try {
      storage?.setItem(AUTO_NUDGE_SESSION_LEDGER_STORAGE_KEY, JSON.stringify(keys));
    } catch {
      // Storage can be disabled or exhausted; in-memory deduplication remains.
    }
  });
}

export function getAutoNudgeTurnLedger(): AutoNudgeTurnLedger {
  if (sharedAutoNudgeTurnLedger) return sharedAutoNudgeTurnLedger;
  sharedAutoNudgeTurnLedger = createAutoNudgeTurnLedger(resolveSessionStorage());
  return sharedAutoNudgeTurnLedger;
}

export function __resetAutoNudgeTurnLedgerForTests(options?: {
  clearSessionStorage?: boolean;
}): void {
  sharedAutoNudgeTurnLedger = null;
  if (!options?.clearSessionStorage) return;
  try {
    resolveSessionStorage()?.removeItem(AUTO_NUDGE_SESSION_LEDGER_STORAGE_KEY);
  } catch {
    // Best-effort test isolation for storage-denied browser contexts.
  }
}
