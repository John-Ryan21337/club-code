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

export function shouldQueueOperatorFollowUp(input: {
  readonly delivery: FollowUpDeliveryAction;
  readonly hasEarlierManualFollowUp: boolean;
}): boolean {
  return input.delivery === "queue" || input.hasEarlierManualFollowUp;
}

/**
 * Automatic queue draining may start the next turn only from a confirmed
 * ready session. It must never steer an active turn or use a disconnected
 * snapshot as settlement evidence. A running queue head stays visible until
 * the operator explicitly chooses Steer; this preserves the review/chaining
 * window after Enter.
 */
export function canAutomaticallyActivateQueuedFollowUp(
  phase: SessionPhase,
  options: { readonly manualStopBarrierActive?: boolean } = {},
): boolean {
  return phase === "ready" && options.manualStopBarrierActive !== true;
}

export function appendOperatorFollowUp<Item>(items: readonly Item[], item: Item): Item[] {
  return [...items, item];
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

export function isQueuedFollowUpHead(
  items: readonly { readonly id: string }[],
  itemId: string,
): boolean {
  return items[0]?.id === itemId;
}

export function tryClaimQueuedFollowUpDispatch(
  claimedItemIds: Set<string>,
  itemId: string,
): boolean {
  if (claimedItemIds.has(itemId)) {
    return false;
  }
  claimedItemIds.add(itemId);
  return true;
}

export function releaseQueuedFollowUpDispatchClaim(
  claimedItemIds: Set<string>,
  itemId: string,
): void {
  claimedItemIds.delete(itemId);
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

export function followUpQueueStateKey(target: FollowUpThreadTarget<string, string>): string {
  return JSON.stringify([target.environmentId, target.threadId]);
}

export function collectRetainedFollowUpThreadTargets<
  EnvironmentKey extends string,
  ThreadKey extends string,
>(input: {
  readonly queueGroups: readonly (readonly FollowUpThreadTarget<EnvironmentKey, ThreadKey>[])[];
  readonly pendingTurnStarts: readonly FollowUpThreadTarget<EnvironmentKey, ThreadKey>[];
  readonly pendingDirectDispatches: readonly FollowUpThreadTarget<EnvironmentKey, ThreadKey>[];
  readonly pendingSteers: readonly FollowUpThreadTarget<EnvironmentKey, ThreadKey>[];
  readonly pendingInterruptRecoveries: readonly FollowUpThreadTarget<EnvironmentKey, ThreadKey>[];
  readonly projectedManualFollowUps?: readonly FollowUpThreadTarget<EnvironmentKey, ThreadKey>[];
}): FollowUpThreadTarget<EnvironmentKey, ThreadKey>[] {
  const targets: FollowUpThreadTarget<EnvironmentKey, ThreadKey>[] = [];
  const seen = new Set<string>();
  const push = (target: FollowUpThreadTarget<EnvironmentKey, ThreadKey> | undefined) => {
    if (target === undefined) {
      return;
    }
    const key = followUpQueueStateKey(target);
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
  for (const pending of input.pendingDirectDispatches) {
    push(pending);
  }
  for (const pending of input.pendingSteers) {
    push(pending);
  }
  for (const pending of input.pendingInterruptRecoveries) {
    push(pending);
  }
  for (const projected of input.projectedManualFollowUps ?? []) {
    push(projected);
  }

  return targets;
}

export interface RekeyQueuedFollowUpsInput<
  EnvironmentKey extends string,
  ThreadKey extends string,
  Item extends FollowUpThreadTarget<EnvironmentKey, ThreadKey> & {
    readonly blockedReason: string | null;
    readonly serverHandoffTarget: FollowUpThreadTarget<EnvironmentKey, ThreadKey> | null;
  },
> {
  queuesByThreadKey: Record<string, readonly Item[]>;
  activeTarget: FollowUpThreadTarget<EnvironmentKey, ThreadKey>;
  activeThreadIsServerBacked: boolean;
  previousActiveTarget: FollowUpThreadTarget<EnvironmentKey, ThreadKey> | null;
  knownThreadKeys: ReadonlySet<string>;
}

/**
 * A queued follow-up can be created while a first-turn draft is still using a
 * temporary local thread id. Once the server-backed thread id becomes active,
 * a draft queue carrying that exact server handoff target must follow it;
 * otherwise the watchdog sees an empty queue for the visible chat and never
 * dispatches. A different server route, an ordinary server-thread queue, or a
 * removed projection is never treated as an implicit handoff.
 */
export function rekeyQueuedFollowUpsForActiveThread<
  EnvironmentKey extends string,
  ThreadKey extends string,
  Item extends FollowUpThreadTarget<EnvironmentKey, ThreadKey> & {
    readonly blockedReason: string | null;
    readonly serverHandoffTarget: FollowUpThreadTarget<EnvironmentKey, ThreadKey> | null;
  },
>(input: RekeyQueuedFollowUpsInput<EnvironmentKey, ThreadKey, Item>): Record<string, Item[]> {
  const {
    activeTarget,
    activeThreadIsServerBacked,
    knownThreadKeys,
    previousActiveTarget,
    queuesByThreadKey,
  } = input;
  if (!activeThreadIsServerBacked) {
    return queuesByThreadKey as Record<string, Item[]>;
  }
  const activeKey = followUpQueueStateKey(activeTarget);
  const activeItems = queuesByThreadKey[activeKey] ?? [];
  const targetsActiveServerThread = (item: Item): boolean => {
    const handoff = item.serverHandoffTarget;
    return (
      item.environmentId === activeTarget.environmentId &&
      handoff !== null &&
      handoff.environmentId === activeTarget.environmentId &&
      handoff.threadId === activeTarget.threadId
    );
  };
  if (activeItems.length > 0) {
    if (!activeItems.some(targetsActiveServerThread)) {
      return queuesByThreadKey as Record<string, Item[]>;
    }
    return {
      ...(queuesByThreadKey as Record<string, Item[]>),
      [activeKey]: activeItems.map((item) =>
        targetsActiveServerThread(item)
          ? (Object.assign({}, item, {
              blockedReason: null,
              serverHandoffTarget: null,
            }) as Item)
          : item,
      ),
    };
  }

  const isEligibleDraftQueue = (key: string, items: readonly Item[]): boolean =>
    key !== activeKey &&
    !knownThreadKeys.has(key) &&
    items.length > 0 &&
    items.every(targetsActiveServerThread);

  const previousKey =
    previousActiveTarget?.environmentId === activeTarget.environmentId
      ? followUpQueueStateKey(previousActiveTarget)
      : null;
  const previousItems = previousKey === null ? [] : (queuesByThreadKey[previousKey] ?? []);
  let orphanQueueCount = 0;
  let firstOrphanEntry: readonly [string, readonly Item[]] | undefined;
  for (const entry of Object.entries(queuesByThreadKey)) {
    const [key, items] = entry;
    if (!isEligibleDraftQueue(key, items)) {
      continue;
    }
    orphanQueueCount += 1;
    firstOrphanEntry ??= entry;
  }

  const sourceEntry =
    previousKey !== null && isEligibleDraftQueue(previousKey, previousItems)
      ? ([previousKey, previousItems] as const)
      : firstOrphanEntry;

  if (!sourceEntry) {
    return queuesByThreadKey as Record<string, Item[]>;
  }

  if (sourceEntry[0] !== previousKey && orphanQueueCount !== 1) {
    return queuesByThreadKey as Record<string, Item[]>;
  }

  const [sourceKey, sourceItems] = sourceEntry;
  const next: Record<string, Item[]> = { ...(queuesByThreadKey as Record<string, Item[]>) };
  delete next[sourceKey];
  next[activeKey] = sourceItems.map(
    (item) =>
      Object.assign({}, item, {
        environmentId: activeTarget.environmentId,
        threadId: activeTarget.threadId,
        blockedReason: null,
        serverHandoffTarget: null,
      }) as Item,
  );
  return next;
}
