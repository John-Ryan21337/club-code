import type { SessionPhase } from "../../types";

export type FollowUpDeliveryAction = "send" | "queue" | "steer";

export interface FollowUpDeliveryInput {
  phase: SessionPhase;
  requestedSteer: boolean;
  liveSteerSupported: boolean;
}

export function decideFollowUpDelivery(input: FollowUpDeliveryInput): FollowUpDeliveryAction {
  if (input.phase !== "running") {
    return "send";
  }
  if (!input.requestedSteer) {
    return "queue";
  }
  return input.liveSteerSupported ? "steer" : "queue";
}

export interface LiveSteerAvailabilityInput {
  liveSteerSupported: boolean;
  provider: string | null | undefined;
  activeTurnId: string | null | undefined;
  latestTurn: {
    readonly turnId: string;
    readonly state: string;
  } | null;
}

export function isLiveSteerAvailableForThread(input: LiveSteerAvailabilityInput): boolean {
  if (!input.liveSteerSupported) {
    return false;
  }

  // Upstream Codex app-server defines `turn/steer` against the active
  // in-flight turn with an `expectedTurnId`; it is not tied to whether Cafe has
  // a currently streaming assistant text row. The generated Codex schema names
  // the protocol-specific rejection cases (`review` and `compact`) as
  // `activeTurnNotSteerable`, so let upstream make that decision instead of
  // guessing from renderer projection timing.
  const activeTurnId = input.activeTurnId ?? null;
  if (activeTurnId === null) {
    return false;
  }
  return input.latestTurn?.turnId === activeTurnId && input.latestTurn.state === "running";
}

export interface QueuedFollowUpStartInput {
  queueLength: number;
  firstItemBlocked: boolean;
  isWorking: boolean;
  isConnecting: boolean;
  isEnvironmentUnavailable: boolean;
  isDispatchInFlight: boolean;
}

export function canStartQueuedFollowUpTurn(input: QueuedFollowUpStartInput): boolean {
  return (
    input.queueLength > 0 &&
    !input.firstItemBlocked &&
    !input.isWorking &&
    !input.isConnecting &&
    !input.isEnvironmentUnavailable &&
    !input.isDispatchInFlight
  );
}

export interface AutomaticQueuedFollowUpStartInput extends QueuedFollowUpStartInput {
  manualStopBarrierActive: boolean;
}

/**
 * A normal queued follow-up may auto-dispatch when a provider becomes idle,
 * but the main Stop button is an explicit cancellation barrier. This mirrors
 * upstream Codex TUI's distinction between ordinary interrupt (restore input)
 * and its dedicated interrupt-and-submit pending-steer path.
 */
export function canAutoStartQueuedFollowUpTurn(input: AutomaticQueuedFollowUpStartInput): boolean {
  return !input.manualStopBarrierActive && canStartQueuedFollowUpTurn(input);
}

export interface QueuedFollowUpDispatchCandidateInput<
  ThreadKey extends string,
  Item extends { readonly blockedReason: string | null },
> {
  queuesByThreadId: Record<string, readonly Item[]>;
  preferredThreadId: ThreadKey | null;
  canStart: (input: { threadId: ThreadKey; item: Item; queueLength: number }) => boolean;
}

export function selectQueuedFollowUpDispatchCandidate<
  ThreadKey extends string,
  Item extends { readonly blockedReason: string | null },
>(
  input: QueuedFollowUpDispatchCandidateInput<ThreadKey, Item>,
): {
  threadId: ThreadKey;
  item: Item;
  queueLength: number;
} | null {
  const orderedThreadIds: ThreadKey[] = [];
  const seen = new Set<string>();
  const pushThreadId = (threadId: string | null | undefined) => {
    if (!threadId || seen.has(threadId)) return;
    seen.add(threadId);
    orderedThreadIds.push(threadId as ThreadKey);
  };

  pushThreadId(input.preferredThreadId);
  for (const [threadId, items] of Object.entries(input.queuesByThreadId)) {
    if (items.length > 0) {
      pushThreadId(threadId);
    }
  }

  for (const threadId of orderedThreadIds) {
    const items = input.queuesByThreadId[threadId] ?? [];
    const item = items[0];
    if (!item) continue;
    if (input.canStart({ threadId, item, queueLength: items.length })) {
      return { threadId, item, queueLength: items.length };
    }
  }

  return null;
}

export interface QueuedFollowUpDispatchObservationInput {
  messageId: string;
  dispatchedAt: string;
  thread: {
    messages: readonly { readonly id: string }[];
    latestTurn: { readonly requestedAt: string } | null;
    session: {
      readonly activeTurnId?: string | null | undefined;
      readonly updatedAt: string;
    } | null;
  };
}

function isoAtOrAfter(value: string | null | undefined, minimum: string): boolean {
  if (!value) return false;
  const valueTime = Date.parse(value);
  const minimumTime = Date.parse(minimum);
  return Number.isFinite(valueTime) && Number.isFinite(minimumTime) && valueTime >= minimumTime;
}

export function hasQueuedFollowUpDispatchBeenObserved(
  input: QueuedFollowUpDispatchObservationInput,
): boolean {
  if (input.thread.messages.some((message) => message.id === input.messageId)) {
    return true;
  }
  if (isoAtOrAfter(input.thread.latestTurn?.requestedAt, input.dispatchedAt)) {
    return true;
  }
  return (
    input.thread.session?.activeTurnId != null &&
    isoAtOrAfter(input.thread.session.updatedAt, input.dispatchedAt)
  );
}

export function previewQueuedFollowUpText(text: string, fallback = "Image-only follow-up"): string {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : fallback;
}

export function canExpandQueuedFollowUpText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (/\r?\n/.test(trimmed)) {
    return true;
  }
  return previewQueuedFollowUpText(trimmed).length > 88;
}

export type QueuedFollowUpAction = "steer" | "send" | "wait";

export interface QueuedFollowUpActionInput {
  phase: SessionPhase;
  liveSteerAvailable: boolean;
  canDispatchNow: boolean;
}

export function decideQueuedFollowUpAction(input: QueuedFollowUpActionInput): QueuedFollowUpAction {
  if (input.phase === "running") {
    if (!input.canDispatchNow || !input.liveSteerAvailable) {
      return "wait";
    }
    return "steer";
  }

  return input.canDispatchNow ? "send" : "wait";
}

export function queuedFollowUpActionLabel(
  action: QueuedFollowUpAction,
): "Send" | "Steer" | "Waiting" {
  switch (action) {
    case "steer":
      return "Steer";
    case "send":
      return "Send";
    case "wait":
      return "Waiting";
  }
}

export function queuedFollowUpActionTitle(action: QueuedFollowUpAction): string {
  switch (action) {
    case "steer":
      return "Steer this queued follow-up into the active turn without interrupting it.";
    case "send":
      return "Send this queued follow-up now.";
    case "wait":
      return "Club Code will send this follow-up as soon as the active turn can accept it.";
  }
}

export type RetryableSteerFailureTurnKind = "review" | "compact";

export interface RetryableSteerFailurePayload {
  messageId: string;
  nonSteerableTurnKind: RetryableSteerFailureTurnKind | null;
}

export function readRetryableSteerFailurePayload(
  payload: unknown,
): RetryableSteerFailurePayload | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (record.retryableFollowUp !== true || typeof record.messageId !== "string") {
    return null;
  }

  const messageId = record.messageId.trim();
  if (messageId.length === 0) {
    return null;
  }

  const turnKind = record.codexNonSteerableTurnKind;
  return {
    messageId,
    nonSteerableTurnKind: turnKind === "review" || turnKind === "compact" ? turnKind : null,
  };
}

export interface FollowUpThreadTarget<
  EnvironmentKey extends string = string,
  ThreadKey extends string = string,
> {
  readonly environmentId: EnvironmentKey;
  readonly threadId: ThreadKey;
}

export function collectRetainedFollowUpThreadTargets<
  EnvironmentKey extends string,
  ThreadKey extends string,
>(input: {
  readonly queueGroups: readonly (readonly FollowUpThreadTarget<EnvironmentKey, ThreadKey>[])[];
  readonly pendingTurnStarts: readonly FollowUpThreadTarget<EnvironmentKey, ThreadKey>[];
  readonly pendingSteers: readonly FollowUpThreadTarget<EnvironmentKey, ThreadKey>[];
}): FollowUpThreadTarget<EnvironmentKey, ThreadKey>[] {
  const targets: FollowUpThreadTarget<EnvironmentKey, ThreadKey>[] = [];
  const seen = new Set<string>();
  const push = (target: FollowUpThreadTarget<EnvironmentKey, ThreadKey> | undefined) => {
    if (target === undefined) {
      return;
    }
    const key = JSON.stringify([target.environmentId, target.threadId]);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    targets.push({
      environmentId: target.environmentId,
      threadId: target.threadId,
    });
  };

  for (const queue of input.queueGroups) {
    push(queue[0]);
  }
  for (const pending of input.pendingTurnStarts) {
    push(pending);
  }
  for (const pending of input.pendingSteers) {
    push(pending);
  }

  return targets;
}

export interface RekeyQueuedFollowUpsInput<
  ThreadKey extends string,
  Item extends { readonly threadId: ThreadKey; readonly blockedReason: string | null },
> {
  queuesByThreadId: Record<string, readonly Item[]>;
  activeThreadId: ThreadKey | null;
  previousActiveThreadId: ThreadKey | null;
  knownThreadIds: ReadonlySet<string>;
}

/**
 * A queued follow-up can be created while a first-turn draft is still using a
 * temporary local thread id. Once the server-backed thread id becomes active,
 * the queue must follow that handoff; otherwise the watchdog sees an empty
 * queue for the visible chat and never dispatches.
 */
export function rekeyQueuedFollowUpsForActiveThread<
  ThreadKey extends string,
  Item extends { readonly threadId: ThreadKey; readonly blockedReason: string | null },
>(input: RekeyQueuedFollowUpsInput<ThreadKey, Item>): Record<string, Item[]> {
  const { activeThreadId, knownThreadIds, previousActiveThreadId, queuesByThreadId } = input;
  if (activeThreadId === null) {
    return queuesByThreadId as Record<string, Item[]>;
  }

  const activeItems = queuesByThreadId[activeThreadId] ?? [];
  if (activeItems.length > 0) {
    return queuesByThreadId as Record<string, Item[]>;
  }

  const isOrphanQueue = (threadId: string): boolean =>
    threadId !== activeThreadId && !knownThreadIds.has(threadId);

  const previousItems =
    previousActiveThreadId && isOrphanQueue(previousActiveThreadId)
      ? (queuesByThreadId[previousActiveThreadId] ?? [])
      : [];
  let orphanQueueCount = 0;
  let firstOrphanEntry: readonly [string, readonly Item[]] | undefined;
  for (const entry of Object.entries(queuesByThreadId)) {
    const [threadId, items] = entry;
    if (!isOrphanQueue(threadId) || items.length === 0) {
      continue;
    }
    orphanQueueCount += 1;
    firstOrphanEntry ??= entry;
  }

  const sourceEntry =
    previousActiveThreadId && previousItems.length > 0
      ? ([previousActiveThreadId, previousItems] as const)
      : firstOrphanEntry;

  if (!sourceEntry) {
    return queuesByThreadId as Record<string, Item[]>;
  }

  if (sourceEntry[0] !== previousActiveThreadId && orphanQueueCount !== 1) {
    return queuesByThreadId as Record<string, Item[]>;
  }

  const [sourceThreadId, sourceItems] = sourceEntry;
  const next: Record<string, Item[]> = { ...(queuesByThreadId as Record<string, Item[]>) };
  delete next[sourceThreadId];
  next[activeThreadId] = sourceItems.map(
    (item) =>
      Object.assign({}, item, {
        threadId: activeThreadId,
        blockedReason: null,
      }) as Item,
  );
  return next;
}
