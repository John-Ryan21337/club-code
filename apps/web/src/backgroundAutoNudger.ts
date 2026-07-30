import {
  MAX_AUTO_NUDGE_MAX_ROUNDS,
  MIN_AUTO_NUDGE_MAX_ROUNDS,
  type AutoNudgeMode,
} from "@cafecode/contracts";
import { useSyncExternalStore } from "react";

import { autoNudgePromptForMode } from "./autoNudger";

export const AUTO_NUDGE_BACKGROUND_STORAGE_KEY = "club-code.auto-nudge.background.v1";
const MAX_BACKGROUND_LEDGER_ENTRIES = 40;
const MAX_BACKGROUND_STORAGE_CHARACTERS = 64_000;
const MAX_SAFE_ID_LENGTH = 512;
export const AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS = 60_000;

export interface BackgroundAutoNudgeThreadRef {
  readonly environmentId: string;
  readonly threadId: string;
}

export type BackgroundAutoNudgeStatus = "active" | "paused" | "stopped" | "exhausted";

export interface BackgroundAutoNudgeLedgerEntry {
  readonly id: string;
  readonly at: string;
  readonly kind: "started" | "sent" | "paused" | "resumed" | "stopped";
  readonly detail: string;
  readonly terminalTurnKey?: string;
  readonly messageId?: string;
}

export interface BackgroundAutoNudgeState {
  readonly owner: BackgroundAutoNudgeThreadRef | null;
  readonly lastOwner: BackgroundAutoNudgeThreadRef | null;
  readonly status: BackgroundAutoNudgeStatus;
  readonly sentRounds: number;
  readonly baselineUserMessageAt: string | null;
  readonly completionBaselineTurnKey: string | null;
  readonly completionBaselineInitialized: boolean;
  readonly expectedAutomatedUserMessageAt: string | null;
  readonly expectedAutomatedUserMessageDeadlineAt: string | null;
  readonly reason: string | null;
  readonly ledger: readonly BackgroundAutoNudgeLedgerEntry[];
}

export interface BackgroundAutoNudgeSettings {
  readonly mode: AutoNudgeMode;
  readonly enabled: boolean;
  readonly maxRounds: number;
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
        readonly isRunning: boolean;
        readonly hasPendingWork: boolean;
        readonly providerAvailable: boolean;
      }
    | { readonly exists: false };
  readonly alreadyConsumed: (turnKey: string) => boolean;
  readonly newMessageId: () => string;
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
  sentRounds: 0,
  baselineUserMessageAt: null,
  completionBaselineTurnKey: null,
  completionBaselineInitialized: false,
  expectedAutomatedUserMessageAt: null,
  expectedAutomatedUserMessageDeadlineAt: null,
  reason: null,
  ledger: [],
};

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SAFE_ID_LENGTH;
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
    settings.maxRounds <= MAX_AUTO_NUDGE_MAX_ROUNDS
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
                entry.kind === "sent" ||
                entry.kind === "paused" ||
                entry.kind === "resumed" ||
                entry.kind === "stopped") &&
              typeof entry.detail === "string" &&
              entry.detail.length <= 300 &&
              (entry.terminalTurnKey === undefined || safeId(entry.terminalTurnKey)) &&
              (entry.messageId === undefined || safeId(entry.messageId)),
            ),
          ),
        )
      : [];
    const expectedAutomatedUserMessageAt = safeIso(parsed.expectedAutomatedUserMessageAt)
      ? parsed.expectedAutomatedUserMessageAt
      : null;
    const expectedAutomatedUserMessageDeadlineAt = safeIso(
      parsed.expectedAutomatedUserMessageDeadlineAt,
    )
      ? parsed.expectedAutomatedUserMessageDeadlineAt
      : null;
    const expectedProjectionIsValid =
      expectedAutomatedUserMessageAt !== null &&
      expectedAutomatedUserMessageDeadlineAt !== null &&
      Date.parse(expectedAutomatedUserMessageDeadlineAt) -
        Date.parse(expectedAutomatedUserMessageAt) ===
        AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS;
    const lastSentTurnKey = ledger.findLast((entry) => entry.kind === "sent")?.terminalTurnKey;
    const persistedCompletionBaseline = safeId(parsed.completionBaselineTurnKey)
      ? parsed.completionBaselineTurnKey
      : null;
    return {
      owner,
      lastOwner,
      status: owner ? status : "stopped",
      sentRounds:
        Number.isInteger(parsed.sentRounds) && (parsed.sentRounds ?? -1) >= 0
          ? Math.min(parsed.sentRounds ?? 0, 10_000)
          : 0,
      baselineUserMessageAt: safeIso(parsed.baselineUserMessageAt)
        ? parsed.baselineUserMessageAt
        : null,
      completionBaselineTurnKey: persistedCompletionBaseline ?? lastSentTurnKey ?? null,
      completionBaselineInitialized:
        parsed.completionBaselineInitialized === true || lastSentTurnKey !== undefined,
      expectedAutomatedUserMessageAt: expectedProjectionIsValid
        ? expectedAutomatedUserMessageAt
        : null,
      expectedAutomatedUserMessageDeadlineAt: expectedProjectionIsValid
        ? expectedAutomatedUserMessageDeadlineAt
        : null,
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
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private write(next: BackgroundAutoNudgeState): void {
    this.state = next;
    try {
      this.storage?.setItem(AUTO_NUDGE_BACKGROUND_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The in-memory safety state remains authoritative for this renderer.
    }
    for (const listener of this.listeners) listener();
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
    return {
      ...state,
      ledger: trimLedger([...state.ledger, entry]),
    };
  }

  start(
    owner: BackgroundAutoNudgeThreadRef,
    latestUserMessageAt: string | null,
    terminalTurnKey: string | null,
    nowMs = Date.now(),
  ): void {
    const next: BackgroundAutoNudgeState = {
      owner,
      lastOwner: owner,
      status: "active",
      sentRounds: 0,
      baselineUserMessageAt: latestUserMessageAt,
      completionBaselineTurnKey: terminalTurnKey,
      completionBaselineInitialized: true,
      expectedAutomatedUserMessageAt: null,
      expectedAutomatedUserMessageDeadlineAt: null,
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
        { ...this.state, status: "paused", reason },
        this.entry("paused", reason, nowMs),
      ),
    );
  }

  resume(nowMs = Date.now()): void {
    if (!this.state.owner || this.state.status !== "paused") return;
    this.write(
      this.withEntry(
        { ...this.state, status: "active", reason: null },
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

    if (!validSettings(input.settings)) {
      this.stop("Background continuation was disabled.", input.nowMs);
      return null;
    }
    if (!input.thread.exists || input.thread.archived) {
      this.stop("The owned thread is missing, deleted, or archived.", input.nowMs);
      return null;
    }
    if (this.state.sentRounds >= input.settings.maxRounds) {
      const reason = `Round cap reached (${input.settings.maxRounds}).`;
      this.write(
        this.withEntry(
          { ...this.state, status: "exhausted", reason },
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
    if (
      !input.thread.providerAvailable ||
      (!input.thread.sessionReady && !input.thread.isRunning)
    ) {
      this.pause("Provider or transport is not ready.", input.nowMs);
      return null;
    }
    if (input.thread.hasPendingWork) {
      this.pause("Queued work or operator attention is pending.", input.nowMs);
      return null;
    }
    if (input.thread.isRunning) {
      return null;
    }

    const turnKey = input.thread.terminalTurnKey;
    if (!this.state.completionBaselineInitialized) {
      this.write({
        ...this.state,
        completionBaselineTurnKey: turnKey,
        completionBaselineInitialized: true,
      });
      return null;
    }
    if (!turnKey) {
      return null;
    }
    if (turnKey === this.state.completionBaselineTurnKey) {
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
        return null;
      }
      if (latestUserMessageAt !== this.state.baselineUserMessageAt) {
        this.write({
          ...this.state,
          baselineUserMessageAt: latestUserMessageAt,
          expectedAutomatedUserMessageAt: null,
        });
      }
      return null;
    }

    const prompt = autoNudgePromptForMode(input.settings.mode);
    if (!prompt) return null;
    const messageId = input.newMessageId();
    const createdAt = new Date(input.nowMs).toISOString();
    const round = this.state.sentRounds + 1;
    this.write(
      this.withEntry(
        {
          ...this.state,
          sentRounds: round,
          baselineUserMessageAt: latestUserMessageAt,
          completionBaselineTurnKey: turnKey,
          expectedAutomatedUserMessageAt: createdAt,
          expectedAutomatedUserMessageDeadlineAt: new Date(
            input.nowMs + AUTO_NUDGE_PROJECTION_ACK_TIMEOUT_MS,
          ).toISOString(),
        },
        this.entry("sent", `Automated nudge ${round} dispatched.`, input.nowMs, {
          terminalTurnKey: turnKey,
          messageId,
        }),
      ),
    );
    return { owner, terminalTurnKey: turnKey, prompt, messageId, createdAt, round };
  }
}

let sharedController: BackgroundAutoNudgeController | null = null;

export function getBackgroundAutoNudgeController(): BackgroundAutoNudgeController {
  sharedController ??= new BackgroundAutoNudgeController(resolveStorage());
  return sharedController;
}

/** Background dispatch is intentionally unavailable without a cross-tab lock. */
export function supportsBackgroundAutoNudgeDispatchLock(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.locks?.request === "function";
}

export function useBackgroundAutoNudgeState(): BackgroundAutoNudgeState {
  const controller = getBackgroundAutoNudgeController();
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}

export function __resetBackgroundAutoNudgeControllerForTests(options?: {
  readonly clearStorage?: boolean;
}): void {
  sharedController = null;
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
