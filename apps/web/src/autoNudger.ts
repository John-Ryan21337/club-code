import {
  CommandId,
  MessageId,
  type AutoNudgeMode,
  type ClientOrchestrationCommand,
  type ServerProviderAccountRateLimitSnapshot,
  type TurnDispatchSource,
} from "@cafecode/contracts";

export const AUTO_NUDGE_DELAY_MS = 5_000;

export type { AutoNudgeMode } from "@cafecode/contracts";

export const AUTO_NUDGE_PROMPTS: Readonly<Record<Exclude<AutoNudgeMode, "off">, string>> = {
  "hardcore-fanout": "Fan out and keep going",
  "steady-progress": "Keep a few lanes going, make steady progress",
};

export function autoNudgePromptForMode(mode: AutoNudgeMode): string | null {
  return mode === "off" ? null : AUTO_NUDGE_PROMPTS[mode];
}

export const AUTO_NUDGE_DISPATCH_SOURCE = "auto-nudge" as const satisfies TurnDispatchSource;

export interface AutoNudgeDispatchIdentity {
  readonly commandId: CommandId;
  readonly messageId: MessageId;
  readonly dispatchSource: typeof AUTO_NUDGE_DISPATCH_SOURCE;
}

type ClientTurnDispatchCommand = Extract<
  ClientOrchestrationCommand,
  { readonly type: "thread.turn.start" | "thread.turn.steer" }
>;

export function withAutoNudgeDispatchSource<const Command extends ClientTurnDispatchCommand>(
  command: Command,
  identity: AutoNudgeDispatchIdentity,
): Command & { readonly dispatchSource: typeof AUTO_NUDGE_DISPATCH_SOURCE };
export function withAutoNudgeDispatchSource<const Command extends ClientTurnDispatchCommand>(
  command: Command,
  identity: undefined,
): Command;
export function withAutoNudgeDispatchSource<const Command extends ClientTurnDispatchCommand>(
  command: Command,
  identity: AutoNudgeDispatchIdentity | undefined,
): Command | (Command & { readonly dispatchSource: typeof AUTO_NUDGE_DISPATCH_SOURCE });
export function withAutoNudgeDispatchSource<const Command extends ClientTurnDispatchCommand>(
  command: Command,
  identity: AutoNudgeDispatchIdentity | undefined,
): Command | (Command & { readonly dispatchSource: typeof AUTO_NUDGE_DISPATCH_SOURCE }) {
  return identity === undefined
    ? command
    : {
        ...command,
        dispatchSource: identity.dispatchSource,
      };
}

export function normalizeAutoNudgeTerminalTurnKey(value: unknown): string | null {
  return isSafeTurnKey(value) ? value : null;
}

/**
 * The terminal turn is the idempotency boundary, not a renderer timer. Stable
 * transport identities let the orchestration command receipt collapse races
 * between foreground tabs, background ownership, reloads, and lost ACKs.
 */
export function autoNudgeDispatchIdentityForTurn(
  terminalTurnKey: string,
): AutoNudgeDispatchIdentity {
  const normalizedTurnKey = normalizeAutoNudgeTerminalTurnKey(terminalTurnKey);
  if (!normalizedTurnKey) {
    throw new Error("Auto Nudge requires a bounded provider-confirmed terminal turn key.");
  }
  return {
    commandId: CommandId.make(`auto-nudge-command:${normalizedTurnKey}`),
    messageId: MessageId.make(`auto-nudge-message:${normalizedTurnKey}`),
    dispatchSource: AUTO_NUDGE_DISPATCH_SOURCE,
  };
}

export function providerCanAcceptAutoNudgeTurn(
  provider: {
    readonly accountRateLimits?: {
      readonly rateLimits: ServerProviderAccountRateLimitSnapshot;
    };
  } | null,
): boolean {
  const snapshot = provider?.accountRateLimits?.rateLimits;
  if (!snapshot) return true;
  if (snapshot.rateLimitReachedType || snapshot.spendControlReached) return false;
  if (
    (snapshot.primary?.usedPercent ?? 0) >= 100 ||
    (snapshot.secondary?.usedPercent ?? 0) >= 100
  ) {
    return false;
  }
  const credits = snapshot.credits;
  return credits === undefined || credits === null || credits.unlimited || credits.hasCredits;
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

export interface AutoNudgeLedgerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function isSafeTurnKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_AUTO_NUDGE_TURN_KEY_LENGTH &&
    value === value.trim()
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
 * has not yet scheduled its countdown. This keeps a cleared draft from
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
