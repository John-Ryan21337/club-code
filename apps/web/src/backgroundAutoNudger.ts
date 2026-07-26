import {
  MAX_AUTO_NUDGE_MAX_MINUTES,
  MAX_AUTO_NUDGE_MAX_ROUNDS,
  MIN_AUTO_NUDGE_MAX_MINUTES,
  MIN_AUTO_NUDGE_MAX_ROUNDS,
  type AutoNudgeMode,
} from "@cafecode/contracts";
import { useSyncExternalStore } from "react";

import {
  AUTO_NUDGE_DELAY_MS,
  autoNudgeDispatchIdentityForTurn,
  autoNudgePromptForMode,
  normalizeAutoNudgeTerminalTurnKey,
} from "./autoNudger";

export const AUTO_NUDGE_BACKGROUND_STORAGE_KEY = "cafe-code.auto-nudge.background.v1";
const AUTO_NUDGE_BACKGROUND_STORAGE_PROBE_KEY = "cafe-code.auto-nudge.background.probe.v1";
const MAX_BACKGROUND_LEDGER_ENTRIES = 40;
const MAX_BACKGROUND_STORAGE_CHARACTERS = 192_000;
// Transport identities include a short namespace plus the bounded 512-byte
// terminal key. Keep enough room to rehydrate those sent-ledger entries.
const MAX_SAFE_ID_LENGTH = 640;
export const AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS = 60_000;
const MAX_AUTO_NUDGE_PROJECTION_WINDOW_MS =
  MAX_AUTO_NUDGE_MAX_MINUTES * 60_000 + AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS;

export interface BackgroundAutoNudgeThreadRef {
  readonly environmentId: string;
  readonly threadId: string;
}

export type BackgroundAutoNudgeStatus = "active" | "paused" | "stopped" | "exhausted";

export interface BackgroundAutoNudgeLedgerEntry {
  readonly id: string;
  readonly at: string;
  readonly kind: "started" | "scheduled" | "sent" | "paused" | "resumed" | "stopped";
  readonly detail: string;
  readonly owner?: BackgroundAutoNudgeThreadRef;
  readonly terminalTurnKey?: string;
  readonly messageId?: string;
}

export interface BackgroundAutoNudgeState {
  readonly owner: BackgroundAutoNudgeThreadRef | null;
  readonly lastOwner: BackgroundAutoNudgeThreadRef | null;
  readonly status: BackgroundAutoNudgeStatus;
  readonly startedAt: string | null;
  readonly sentRounds: number;
  readonly baselineUserMessageAt: string | null;
  readonly expectedAutomatedUserMessageAt: string | null;
  readonly expectedAutomatedUserMessageDeadlineAt: string | null;
  readonly scheduled: {
    readonly terminalTurnKey: string;
    readonly dueAt: string;
  } | null;
  readonly reason: string | null;
  readonly ledger: readonly BackgroundAutoNudgeLedgerEntry[];
}

export interface BackgroundAutoNudgeSettings {
  readonly mode: AutoNudgeMode;
  readonly enabled: boolean;
  readonly maxRounds: number;
  readonly maxMinutes: number;
}

export interface BackgroundAutoNudgeObservation {
  readonly nowMs: number;
  readonly settings: BackgroundAutoNudgeSettings;
  readonly thread:
    | {
        readonly exists: true;
        readonly archived: boolean;
        readonly terminalTurnKey: string | null;
        readonly latestUserMessageAt: string | null;
        readonly sessionReady: boolean;
        readonly sessionStarting: boolean;
        readonly isRunning: boolean;
        readonly hasPendingWork: boolean;
        readonly providerAvailable: boolean;
      }
    | { readonly exists: false };
  readonly alreadyConsumed: (turnKey: string) => boolean;
}

export interface BackgroundAutoNudgeDispatch {
  readonly owner: BackgroundAutoNudgeThreadRef;
  readonly terminalTurnKey: string;
  readonly prompt: string;
  readonly messageId: string;
  readonly createdAt: string;
  readonly round: number;
}

export interface BackgroundAutoNudgeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const EMPTY_STATE: BackgroundAutoNudgeState = {
  owner: null,
  lastOwner: null,
  status: "stopped",
  startedAt: null,
  sentRounds: 0,
  baselineUserMessageAt: null,
  expectedAutomatedUserMessageAt: null,
  expectedAutomatedUserMessageDeadlineAt: null,
  scheduled: null,
  reason: null,
  ledger: [],
};

function safeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SAFE_ID_LENGTH &&
    value === value.trim()
  );
}

function safeIso(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

/**
 * Keep consumed terminal identities durable even if an operator repeatedly
 * pauses and resumes the run. A visible ledger is intentionally capped, but
 * ordinary status rows must never evict the at-most-20 bounded send records
 * that make a renderer reload fail closed.
 */
function trimLedger(
  entries: readonly BackgroundAutoNudgeLedgerEntry[],
): readonly BackgroundAutoNudgeLedgerEntry[] {
  const sent = entries.filter((entry) => entry.kind === "sent");
  const remaining = entries.filter((entry) => entry.kind !== "sent");
  if (sent.length >= MAX_BACKGROUND_LEDGER_ENTRIES) {
    return sent.slice(-MAX_BACKGROUND_LEDGER_ENTRIES);
  }
  const retained = new Set([
    ...sent,
    ...remaining.slice(-(MAX_BACKGROUND_LEDGER_ENTRIES - sent.length)),
  ]);
  return entries.filter((entry) => retained.has(entry));
}

function validSettings(settings: BackgroundAutoNudgeSettings): boolean {
  return (
    settings.enabled &&
    settings.mode !== "off" &&
    Number.isInteger(settings.maxRounds) &&
    settings.maxRounds >= MIN_AUTO_NUDGE_MAX_ROUNDS &&
    settings.maxRounds <= MAX_AUTO_NUDGE_MAX_ROUNDS &&
    Number.isInteger(settings.maxMinutes) &&
    settings.maxMinutes >= MIN_AUTO_NUDGE_MAX_MINUTES &&
    settings.maxMinutes <= MAX_AUTO_NUDGE_MAX_MINUTES
  );
}

function readState(storage: BackgroundAutoNudgeStorage | null): BackgroundAutoNudgeState {
  if (!storage) return EMPTY_STATE;
  try {
    const raw = storage.getItem(AUTO_NUDGE_BACKGROUND_STORAGE_KEY);
    if (!raw || raw.length > MAX_BACKGROUND_STORAGE_CHARACTERS) return EMPTY_STATE;
    const parsed = JSON.parse(raw) as Partial<BackgroundAutoNudgeState>;
    const owner =
      parsed.owner && safeId(parsed.owner.environmentId) && safeId(parsed.owner.threadId)
        ? parsed.owner
        : null;
    const lastOwner =
      parsed.lastOwner &&
      safeId(parsed.lastOwner.environmentId) &&
      safeId(parsed.lastOwner.threadId)
        ? parsed.lastOwner
        : owner;
    const status =
      parsed.status === "active" ||
      parsed.status === "paused" ||
      parsed.status === "stopped" ||
      parsed.status === "exhausted"
        ? parsed.status
        : "stopped";
    const ledger = Array.isArray(parsed.ledger)
      ? trimLedger(
          parsed.ledger.filter((entry): entry is BackgroundAutoNudgeLedgerEntry =>
            Boolean(
              entry &&
              safeId(entry.id) &&
              safeIso(entry.at) &&
              (entry.kind === "started" ||
                entry.kind === "scheduled" ||
                entry.kind === "sent" ||
                entry.kind === "paused" ||
                entry.kind === "resumed" ||
                entry.kind === "stopped") &&
              typeof entry.detail === "string" &&
              entry.detail.length <= 300 &&
              (entry.owner === undefined ||
                (entry.owner !== null &&
                  safeId(entry.owner.environmentId) &&
                  safeId(entry.owner.threadId))) &&
              (entry.terminalTurnKey === undefined || safeId(entry.terminalTurnKey)) &&
              (entry.messageId === undefined || safeId(entry.messageId)),
            ),
          ),
        )
      : [];
    const scheduled =
      parsed.scheduled &&
      safeId(parsed.scheduled.terminalTurnKey) &&
      safeIso(parsed.scheduled.dueAt)
        ? parsed.scheduled
        : null;
    const expectedAutomatedUserMessageAt = safeIso(parsed.expectedAutomatedUserMessageAt)
      ? parsed.expectedAutomatedUserMessageAt
      : null;
    const expectedAutomatedUserMessageDeadlineAt = safeIso(
      parsed.expectedAutomatedUserMessageDeadlineAt,
    )
      ? parsed.expectedAutomatedUserMessageDeadlineAt
      : null;
    const projectionWindowMs =
      expectedAutomatedUserMessageAt !== null && expectedAutomatedUserMessageDeadlineAt !== null
        ? Date.parse(expectedAutomatedUserMessageDeadlineAt) -
          Date.parse(expectedAutomatedUserMessageAt)
        : Number.NaN;
    const expectedProjectionIsValid =
      expectedAutomatedUserMessageAt !== null &&
      expectedAutomatedUserMessageDeadlineAt !== null &&
      projectionWindowMs >= AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS &&
      projectionWindowMs <= MAX_AUTO_NUDGE_PROJECTION_WINDOW_MS;
    return {
      owner,
      lastOwner,
      status: owner ? status : "stopped",
      startedAt: safeIso(parsed.startedAt) ? parsed.startedAt : null,
      sentRounds:
        Number.isInteger(parsed.sentRounds) && (parsed.sentRounds ?? -1) >= 0
          ? Math.min(parsed.sentRounds ?? 0, 10_000)
          : 0,
      baselineUserMessageAt: safeIso(parsed.baselineUserMessageAt)
        ? parsed.baselineUserMessageAt
        : null,
      expectedAutomatedUserMessageAt: expectedProjectionIsValid
        ? expectedAutomatedUserMessageAt
        : null,
      expectedAutomatedUserMessageDeadlineAt: expectedProjectionIsValid
        ? expectedAutomatedUserMessageDeadlineAt
        : null,
      scheduled,
      reason:
        typeof parsed.reason === "string" && parsed.reason.length <= 300 ? parsed.reason : null,
      ledger,
    };
  } catch {
    return EMPTY_STATE;
  }
}

function resolveStorage(): BackgroundAutoNudgeStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sameOwner(
  left: BackgroundAutoNudgeThreadRef | null,
  right: BackgroundAutoNudgeThreadRef,
): boolean {
  return left?.environmentId === right.environmentId && left.threadId === right.threadId;
}

export class BackgroundAutoNudgeController {
  private state: BackgroundAutoNudgeState;
  private readonly listeners = new Set<() => void>();
  private sequence = 0;
  private storageWriteFailed = false;

  constructor(private readonly storage: BackgroundAutoNudgeStorage | null) {
    this.state = readState(storage);
    this.sequence = this.state.ledger.length;
  }

  getSnapshot = (): BackgroundAutoNudgeState => this.state;

  /**
   * A cross-tab dispatch lock reloads the durable state immediately before it
   * evaluates a terminal turn. If persistence is unavailable or corrupt this
   * becomes an empty, stopped state, which is safer than reusing stale memory.
   */
  reloadFromStorage(): void {
    this.state = readState(this.storage);
    this.sequence = Math.max(this.sequence, this.state.ledger.length);
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private write(next: BackgroundAutoNudgeState): boolean {
    this.state = next;
    try {
      this.storage?.setItem(AUTO_NUDGE_BACKGROUND_STORAGE_KEY, JSON.stringify(next));
      this.storageWriteFailed = false;
    } catch {
      // Never dispatch from an in-memory-only claim: another renderer could
      // still observe the older durable state and submit the same turn.
      this.storageWriteFailed = true;
    }
    for (const listener of this.listeners) listener();
    return !this.storageWriteFailed;
  }

  private entry(
    kind: BackgroundAutoNudgeLedgerEntry["kind"],
    detail: string,
    nowMs: number,
    extra?: Pick<BackgroundAutoNudgeLedgerEntry, "terminalTurnKey" | "messageId">,
  ): BackgroundAutoNudgeLedgerEntry {
    this.sequence += 1;
    return {
      id: `${nowMs}-${this.sequence}`,
      at: new Date(nowMs).toISOString(),
      kind,
      detail: detail.slice(0, 300),
      ...extra,
    };
  }

  private withEntry(
    state: BackgroundAutoNudgeState,
    entry: BackgroundAutoNudgeLedgerEntry,
  ): BackgroundAutoNudgeState {
    const entryOwner = state.owner ?? state.lastOwner;
    const attributedEntry = entryOwner ? { ...entry, owner: entryOwner } : entry;
    return {
      ...state,
      ledger: trimLedger([...state.ledger, attributedEntry]),
    };
  }

  start(
    owner: BackgroundAutoNudgeThreadRef,
    latestUserMessageAt: string | null,
    nowMs = Date.now(),
  ): void {
    const next: BackgroundAutoNudgeState = {
      owner,
      lastOwner: owner,
      status: "active",
      startedAt: new Date(nowMs).toISOString(),
      sentRounds: 0,
      baselineUserMessageAt: latestUserMessageAt,
      expectedAutomatedUserMessageAt: null,
      expectedAutomatedUserMessageDeadlineAt: null,
      scheduled: null,
      reason: null,
      ledger: this.state.ledger,
    };
    this.write(
      this.withEntry(next, this.entry("started", "Background continuation started.", nowMs)),
    );
  }

  pause(reason: string, nowMs = Date.now()): void {
    if (this.state.status !== "active") return;
    this.write(
      this.withEntry(
        { ...this.state, status: "paused", scheduled: null, reason },
        this.entry("paused", reason, nowMs),
      ),
    );
  }

  resume(nowMs = Date.now()): void {
    if (!this.state.owner || this.state.status !== "paused") return;
    this.write(
      this.withEntry(
        {
          ...this.state,
          status: "active",
          scheduled: null,
          reason: null,
          expectedAutomatedUserMessageDeadlineAt: this.state.expectedAutomatedUserMessageAt
            ? new Date(nowMs + AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS).toISOString()
            : null,
        },
        this.entry("resumed", "Background continuation resumed.", nowMs),
      ),
    );
  }

  stop(reason = "Stopped by the operator.", nowMs = Date.now()): void {
    if (!this.state.owner && this.state.status === "stopped") return;
    this.write(
      this.withEntry(
        {
          ...this.state,
          owner: null,
          status: "stopped",
          startedAt: null,
          scheduled: null,
          reason,
          expectedAutomatedUserMessageAt: null,
          expectedAutomatedUserMessageDeadlineAt: null,
        },
        this.entry("stopped", reason, nowMs),
      ),
    );
  }

  markDispatchFailed(messageId: string, reason: string, nowMs = Date.now()): void {
    // An async transport rejection can arrive after Stop, a new run, or an
    // ownership transfer. Only the still-pending dispatch may change state.
    if (this.state.expectedAutomatedUserMessageAt === null) return;
    const pendingEntry = this.state.ledger.findLast(
      (entry) => entry.kind === "sent" && entry.messageId === messageId,
    );
    if (!pendingEntry || pendingEntry.at !== this.state.expectedAutomatedUserMessageAt) return;
    this.write(
      this.withEntry(
        {
          ...this.state,
          status: "paused",
          scheduled: null,
          reason,
          expectedAutomatedUserMessageAt: null,
          expectedAutomatedUserMessageDeadlineAt: null,
        },
        this.entry("paused", reason, nowMs, { messageId }),
      ),
    );
  }

  observe(input: BackgroundAutoNudgeObservation): BackgroundAutoNudgeDispatch | null {
    const owner = this.state.owner;
    if (!owner || this.state.status !== "active") return null;

    if (this.storageWriteFailed) {
      this.pause("Durable background state could not be saved.", input.nowMs);
      return null;
    }
    if (!validSettings(input.settings)) {
      this.stop("Background continuation was disabled.", input.nowMs);
      return null;
    }
    if (!input.thread.exists || input.thread.archived) {
      this.stop("The owned thread is missing, deleted, or archived.", input.nowMs);
      return null;
    }
    if (!this.state.startedAt) {
      this.pause("The continuation start time is unavailable.", input.nowMs);
      return null;
    }
    const startedAtMs = Date.parse(this.state.startedAt);
    const elapsedMs = input.nowMs - startedAtMs;
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      this.pause("The system clock moved before the continuation start time.", input.nowMs);
      return null;
    }
    if (elapsedMs >= input.settings.maxMinutes * 60_000) {
      const reason = `Time cap reached (${input.settings.maxMinutes} minutes).`;
      this.write({
        ...this.withEntry(
          { ...this.state, status: "exhausted", scheduled: null, reason },
          this.entry("paused", reason, input.nowMs),
        ),
      });
      return null;
    }
    if (this.state.sentRounds >= input.settings.maxRounds) {
      const reason = `Round cap reached (${input.settings.maxRounds}).`;
      this.write(
        this.withEntry(
          { ...this.state, status: "exhausted", scheduled: null, reason },
          this.entry("paused", reason, input.nowMs),
        ),
      );
      return null;
    }

    const latestUserMessageAt = input.thread.latestUserMessageAt;
    if (
      latestUserMessageAt &&
      latestUserMessageAt !== this.state.baselineUserMessageAt &&
      latestUserMessageAt !== this.state.expectedAutomatedUserMessageAt
    ) {
      this.pause("Manual thread activity detected.", input.nowMs);
      return null;
    }
    if (
      this.state.expectedAutomatedUserMessageAt &&
      this.state.expectedAutomatedUserMessageDeadlineAt &&
      input.nowMs >= Date.parse(this.state.expectedAutomatedUserMessageDeadlineAt)
    ) {
      this.pause(
        "The automated prompt was not projected within 60 seconds; continuation paused.",
        input.nowMs,
      );
      return null;
    }
    if (
      this.state.expectedAutomatedUserMessageAt &&
      latestUserMessageAt === this.state.expectedAutomatedUserMessageAt
    ) {
      this.write({
        ...this.state,
        baselineUserMessageAt: latestUserMessageAt,
        expectedAutomatedUserMessageAt: null,
        expectedAutomatedUserMessageDeadlineAt: null,
      });
    }
    if (input.thread.hasPendingWork) {
      this.pause("Queued work or operator attention is pending.", input.nowMs);
      return null;
    }
    if (input.thread.isRunning || input.thread.sessionStarting) {
      if (this.state.scheduled) this.write({ ...this.state, scheduled: null });
      return null;
    }
    if (!input.thread.providerAvailable || !input.thread.sessionReady) {
      this.pause("Provider or transport is not ready.", input.nowMs);
      return null;
    }

    const turnKey = normalizeAutoNudgeTerminalTurnKey(input.thread.terminalTurnKey);
    if (!turnKey) {
      if (this.state.scheduled) this.write({ ...this.state, scheduled: null });
      return null;
    }
    const consumed =
      input.alreadyConsumed(turnKey) ||
      this.state.ledger.some((entry) => entry.kind === "sent" && entry.terminalTurnKey === turnKey);
    if (consumed) {
      if (
        this.state.expectedAutomatedUserMessageAt &&
        latestUserMessageAt !== this.state.expectedAutomatedUserMessageAt
      ) {
        // The command is consumed before transport handoff. Keep the expected
        // timestamp through the ACK/projection gap (including a reload), or
        // the eventual automated user row would look like manual activity.
        if (this.state.scheduled) this.write({ ...this.state, scheduled: null });
        return null;
      }
      if (this.state.scheduled || latestUserMessageAt !== this.state.baselineUserMessageAt) {
        this.write({
          ...this.state,
          baselineUserMessageAt: latestUserMessageAt,
          expectedAutomatedUserMessageAt: null,
          scheduled: null,
        });
      }
      return null;
    }

    if (this.state.scheduled?.terminalTurnKey !== turnKey) {
      const dueAt = new Date(input.nowMs + AUTO_NUDGE_DELAY_MS).toISOString();
      this.write(
        this.withEntry(
          { ...this.state, scheduled: { terminalTurnKey: turnKey, dueAt } },
          this.entry("scheduled", "Next bounded nudge scheduled.", input.nowMs, {
            terminalTurnKey: turnKey,
          }),
        ),
      );
      return null;
    }
    const dueAtMs = Date.parse(this.state.scheduled.dueAt);
    if (!Number.isFinite(dueAtMs) || dueAtMs - input.nowMs > AUTO_NUDGE_DELAY_MS) {
      this.pause(
        "The scheduled nudge deadline is invalid or the system clock moved backwards.",
        input.nowMs,
      );
      return null;
    }
    if (dueAtMs > input.nowMs) return null;

    const prompt = autoNudgePromptForMode(input.settings.mode);
    if (!prompt) return null;
    const messageId = String(autoNudgeDispatchIdentityForTurn(turnKey).messageId);
    const createdAt = new Date(input.nowMs).toISOString();
    const round = this.state.sentRounds + 1;
    const dispatchClaimPersisted = this.write(
      this.withEntry(
        {
          ...this.state,
          sentRounds: round,
          baselineUserMessageAt: latestUserMessageAt,
          expectedAutomatedUserMessageAt: createdAt,
          expectedAutomatedUserMessageDeadlineAt: new Date(
            input.nowMs + AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS,
          ).toISOString(),
          scheduled: null,
        },
        this.entry("sent", `Automated nudge ${round} dispatched.`, input.nowMs, {
          terminalTurnKey: turnKey,
          messageId,
        }),
      ),
    );
    if (!dispatchClaimPersisted) {
      this.pause("Durable background state could not be saved.", input.nowMs);
      return null;
    }
    return { owner, terminalTurnKey: turnKey, prompt, messageId, createdAt, round };
  }
}

let sharedController: BackgroundAutoNudgeController | null = null;
let removeSharedStorageListener: (() => void) | null = null;
let backgroundDispatchSupport: boolean | null = null;

function makeSharedBackgroundAutoNudgeController(): BackgroundAutoNudgeController {
  removeSharedStorageListener?.();
  removeSharedStorageListener = null;
  const controller = new BackgroundAutoNudgeController(resolveStorage());
  if (typeof window !== "undefined") {
    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTO_NUDGE_BACKGROUND_STORAGE_KEY || event.key === null) {
        controller.reloadFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    removeSharedStorageListener = () => window.removeEventListener("storage", onStorage);
  }
  return controller;
}

export function getBackgroundAutoNudgeController(): BackgroundAutoNudgeController {
  sharedController ??= makeSharedBackgroundAutoNudgeController();
  return sharedController;
}

/** Background dispatch is intentionally unavailable without a cross-tab lock. */
export function supportsBackgroundAutoNudgeDispatchLock(): boolean {
  if (backgroundDispatchSupport !== null) return backgroundDispatchSupport;
  if (typeof navigator === "undefined" || typeof navigator.locks?.request !== "function") {
    backgroundDispatchSupport = false;
    return backgroundDispatchSupport;
  }
  const storage = resolveStorage();
  if (!storage) {
    backgroundDispatchSupport = false;
    return backgroundDispatchSupport;
  }
  try {
    const previous = storage.getItem(AUTO_NUDGE_BACKGROUND_STORAGE_PROBE_KEY);
    storage.setItem(AUTO_NUDGE_BACKGROUND_STORAGE_PROBE_KEY, "1");
    if (previous === null) {
      storage.removeItem(AUTO_NUDGE_BACKGROUND_STORAGE_PROBE_KEY);
    } else {
      storage.setItem(AUTO_NUDGE_BACKGROUND_STORAGE_PROBE_KEY, previous);
    }
    backgroundDispatchSupport = true;
  } catch {
    backgroundDispatchSupport = false;
  }
  return backgroundDispatchSupport;
}

export function useBackgroundAutoNudgeState(): BackgroundAutoNudgeState {
  const controller = getBackgroundAutoNudgeController();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

export function __resetBackgroundAutoNudgeControllerForTests(options?: {
  readonly clearStorage?: boolean;
}): void {
  removeSharedStorageListener?.();
  removeSharedStorageListener = null;
  sharedController = null;
  backgroundDispatchSupport = null;
  if (!options?.clearStorage) return;
  try {
    resolveStorage()?.removeItem(AUTO_NUDGE_BACKGROUND_STORAGE_KEY);
  } catch {
    // Best-effort test isolation.
  }
}

export function isBackgroundAutoNudgeOwner(
  state: BackgroundAutoNudgeState,
  owner: BackgroundAutoNudgeThreadRef,
): boolean {
  return sameOwner(state.owner, owner);
}

export function isLastBackgroundAutoNudgeOwner(
  state: BackgroundAutoNudgeState,
  owner: BackgroundAutoNudgeThreadRef,
): boolean {
  return sameOwner(state.lastOwner, owner);
}

export function backgroundAutoNudgeLedgerForOwner(
  state: BackgroundAutoNudgeState,
  owner: BackgroundAutoNudgeThreadRef,
): readonly BackgroundAutoNudgeLedgerEntry[] {
  return state.ledger.filter((entry) => sameOwner(entry.owner ?? null, owner));
}
