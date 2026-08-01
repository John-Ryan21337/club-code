import {
  AUTO_NUDGE_BUILT_IN_PROMPTS,
  normalizeAutoNudgeBuiltInPrompt,
  type AutoNudgeMode,
} from "@cafecode/contracts";

export type { AutoNudgeMode } from "@cafecode/contracts";

export const AUTO_NUDGE_PROMPTS = AUTO_NUDGE_BUILT_IN_PROMPTS;

export function autoNudgePromptForMode(mode: AutoNudgeMode): string | null {
  return mode === "off" ? null : AUTO_NUDGE_PROMPTS[mode];
}

export { normalizeAutoNudgeBuiltInPrompt };

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

/** The completion-event handoff repeats the complete gate before transport. */
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
 * Per-thread authority is durable server state. This client-side ledger is
 * deliberately session storage: it survives route remounts and renderer
 * reloads, fails closed after an uncertain transport result, and never grants
 * authority on its own.
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

  forget(key: string): void {
    if (!this.keySet.delete(key)) return;
    const index = this.keyList.indexOf(key);
    if (index >= 0) this.keyList.splice(index, 1);
    this.onChange?.(this.keyList);
  }
}

/**
 * A real operator action consumes the currently settled turn even if React
 * has not yet dispatched its continuation. This keeps a cleared draft from
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
