import type { AutoNudgeMode } from "@cafecode/contracts";

export const AUTO_NUDGE_DELAY_MS = 5_000;

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

export interface AutoNudgeTerminalObservation {
  readonly contextKey: string;
  readonly terminalTurnKey: string | null;
}

/**
 * Only a changed provider-confirmed terminal identity in the same mounted
 * thread context grants one-shot scheduling authority. Initial hydration,
 * remount, navigation, and policy changes merely establish a baseline.
 */
export function isNewAutoNudgeTerminalEdge(
  previous: AutoNudgeTerminalObservation | null,
  current: AutoNudgeTerminalObservation,
): boolean {
  return (
    previous !== null &&
    previous.contextKey === current.contextKey &&
    current.terminalTurnKey !== null &&
    current.terminalTurnKey !== previous.terminalTurnKey
  );
}

export function resolveArmedAutoNudgeTerminal(input: {
  readonly previousObservation: AutoNudgeTerminalObservation;
  readonly currentObservation: AutoNudgeTerminalObservation;
  readonly currentlyArmedTerminalTurnKey: string | null;
  readonly invalidatedByOperatorState: boolean;
  readonly alreadyConsumed: boolean;
}): string | null {
  if (
    input.invalidatedByOperatorState ||
    input.alreadyConsumed ||
    input.currentObservation.terminalTurnKey === null
  ) {
    return null;
  }
  if (isNewAutoNudgeTerminalEdge(input.previousObservation, input.currentObservation)) {
    return input.currentObservation.terminalTurnKey;
  }
  return input.currentlyArmedTerminalTurnKey === input.currentObservation.terminalTurnKey
    ? input.currentlyArmedTerminalTurnKey
    : null;
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

/** The timer handoff repeats the complete gate; it must never trust its schedule-time view. */
export function canDispatchAutoNudge(input: {
  readonly scheduledTurnKey: string | null;
  readonly current: AutoNudgeEligibility;
  readonly alreadyConsumed: boolean;
}): boolean {
  return (
    input.scheduledTurnKey !== null &&
    input.scheduledTurnKey === input.current.terminalTurnKey &&
    canScheduleAutoNudge(input.current) &&
    !input.alreadyConsumed
  );
}

export interface AutoNudgeTimerScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timer: number): void;
  setInterval(callback: () => void, intervalMs: number): number;
  clearInterval(timer: number): void;
}

/**
 * Owns one visible chat's countdown. Cancellation invalidates callbacks before
 * clearing native handles, so even an already-queued stale callback fails
 * closed during a route/unmount race.
 */
export class AutoNudgeTimerController {
  private dispatchTimer: number | null = null;
  private countdownTimer: number | null = null;
  private turnKey: string | null = null;
  private revision = 0;

  constructor(private readonly scheduler: AutoNudgeTimerScheduler) {}

  get scheduledTurnKey(): string | null {
    return this.turnKey;
  }

  cancel(): string | null {
    const canceledTurnKey = this.turnKey;
    this.revision += 1;
    this.turnKey = null;
    if (this.dispatchTimer !== null) {
      this.scheduler.clearTimeout(this.dispatchTimer);
      this.dispatchTimer = null;
    }
    if (this.countdownTimer !== null) {
      this.scheduler.clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    return canceledTurnKey;
  }

  schedule(input: {
    turnKey: string;
    delayMs: number;
    onCountdown: (seconds: number) => void;
    onDispatch: (turnKey: string) => void;
  }): void {
    this.cancel();
    const revision = this.revision;
    const dispatchAt = this.scheduler.now() + input.delayMs;
    this.turnKey = input.turnKey;
    input.onCountdown(Math.ceil(input.delayMs / 1_000));
    this.countdownTimer = this.scheduler.setInterval(() => {
      if (this.revision !== revision || this.turnKey !== input.turnKey) return;
      input.onCountdown(Math.max(0, Math.ceil((dispatchAt - this.scheduler.now()) / 1_000)));
    }, 250);
    this.dispatchTimer = this.scheduler.setTimeout(() => {
      if (this.revision !== revision || this.turnKey !== input.turnKey) return;
      const scheduledTurnKey = this.cancel();
      if (scheduledTurnKey) input.onDispatch(scheduledTurnKey);
    }, input.delayMs);
  }
}

const MAX_AUTO_NUDGE_LEDGER_ENTRIES = 256;
const MAX_AUTO_NUDGE_TURN_KEY_LENGTH = 512;
const MAX_AUTO_NUDGE_LEDGER_STORAGE_CHARACTERS =
  MAX_AUTO_NUDGE_LEDGER_ENTRIES * (MAX_AUTO_NUDGE_TURN_KEY_LENGTH + 8);
export const AUTO_NUDGE_SESSION_LEDGER_STORAGE_KEY = "cafe-code.auto-nudge.consumed-turns.v1";
export const AUTO_NUDGE_LEDGER_STORAGE_KEY = "cafe-code.auto-nudge.consumed-turns.v2";

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

function readLedgerKeys(
  storage: AutoNudgeLedgerStorage | null,
  key = AUTO_NUDGE_LEDGER_STORAGE_KEY,
): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key) ?? "[]";
    if (raw.length > MAX_AUTO_NUDGE_LEDGER_STORAGE_CHARACTERS) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSafeTurnKey).slice(-MAX_AUTO_NUDGE_LEDGER_ENTRIES);
  } catch {
    return [];
  }
}

/**
 * A bounded, durable once-per-terminal-turn ledger.
 *
 * Thread policies independently decide whether execution is enabled. Durable
 * consumption only prevents a completed provider turn from being submitted
 * again after navigation, another renderer window, or an app restart.
 */
export class AutoNudgeTurnLedger {
  private readonly keyList: string[];
  private readonly keySet = new Set<string>();

  constructor(
    initialKeys: Iterable<string> = [],
    private readonly onChange?: (keys: readonly string[]) => void,
    private readonly onReload?: () => readonly string[],
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

  reloadFromStorage(): void {
    if (!this.onReload) return;
    this.keyList.splice(0, this.keyList.length);
    this.keySet.clear();
    for (const key of this.onReload()) {
      if (!isSafeTurnKey(key) || this.keySet.has(key)) continue;
      this.keyList.push(key);
      this.keySet.add(key);
    }
    while (this.keyList.length > MAX_AUTO_NUDGE_LEDGER_ENTRIES) {
      const removed = this.keyList.shift();
      if (removed) this.keySet.delete(removed);
    }
  }

  mark(key: string): void {
    if (!isSafeTurnKey(key)) return;
    if (this.keySet.has(key)) {
      // Re-persisting a duplicate merges any claims written by another
      // renderer since this instance last reloaded.
      this.onChange?.(this.keyList);
      return;
    }
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
 * has not yet scheduled its countdown. This keeps a cleared draft from
 * reviving an old completion into an unsolicited provider request.
 */
export function consumeAutoNudgeTerminalForManualActivity(
  ledger: Pick<AutoNudgeTurnLedger, "mark">,
  terminalTurnKey: string | null,
): void {
  if (terminalTurnKey) ledger.mark(terminalTurnKey);
}

function resolveLocalStorage(): AutoNudgeLedgerStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let sharedAutoNudgeTurnLedger: AutoNudgeTurnLedger | null = null;
let removeLedgerStorageListener: (() => void) | null = null;

export function createAutoNudgeTurnLedger(
  storage: AutoNudgeLedgerStorage | null,
): AutoNudgeTurnLedger {
  return new AutoNudgeTurnLedger(
    readLedgerKeys(storage),
    (keys) => {
      try {
        const merged = [...readLedgerKeys(storage), ...keys];
        const unique = [...new Set(merged)].slice(-MAX_AUTO_NUDGE_LEDGER_ENTRIES);
        storage?.setItem(AUTO_NUDGE_LEDGER_STORAGE_KEY, JSON.stringify(unique));
      } catch {
        // Storage can be disabled or exhausted; in-memory deduplication remains.
      }
    },
    () => readLedgerKeys(storage),
  );
}

export function getAutoNudgeTurnLedger(): AutoNudgeTurnLedger {
  if (sharedAutoNudgeTurnLedger) return sharedAutoNudgeTurnLedger;
  const storage = resolveLocalStorage();
  if (storage && readLedgerKeys(storage).length === 0 && typeof window !== "undefined") {
    try {
      const legacyKeys = readLedgerKeys(
        window.sessionStorage,
        AUTO_NUDGE_SESSION_LEDGER_STORAGE_KEY,
      );
      if (legacyKeys.length > 0) {
        storage.setItem(AUTO_NUDGE_LEDGER_STORAGE_KEY, JSON.stringify(legacyKeys));
        window.sessionStorage.removeItem(AUTO_NUDGE_SESSION_LEDGER_STORAGE_KEY);
      }
    } catch {
      // A denied legacy session store does not weaken the new durable ledger.
    }
  }
  sharedAutoNudgeTurnLedger = createAutoNudgeTurnLedger(storage);
  if (typeof window !== "undefined") {
    const onStorage = (event: StorageEvent) => {
      if (
        event.storageArea === window.localStorage &&
        event.key === AUTO_NUDGE_LEDGER_STORAGE_KEY
      ) {
        sharedAutoNudgeTurnLedger?.reloadFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    removeLedgerStorageListener = () => window.removeEventListener("storage", onStorage);
  }
  return sharedAutoNudgeTurnLedger;
}

export function __resetAutoNudgeTurnLedgerForTests(options?: {
  clearSessionStorage?: boolean;
  clearStorage?: boolean;
}): void {
  removeLedgerStorageListener?.();
  removeLedgerStorageListener = null;
  sharedAutoNudgeTurnLedger = null;
  if (!options?.clearSessionStorage && !options?.clearStorage) return;
  try {
    resolveLocalStorage()?.removeItem(AUTO_NUDGE_LEDGER_STORAGE_KEY);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(AUTO_NUDGE_SESSION_LEDGER_STORAGE_KEY);
    }
  } catch {
    // Best-effort test isolation for storage-denied browser contexts.
  }
}
