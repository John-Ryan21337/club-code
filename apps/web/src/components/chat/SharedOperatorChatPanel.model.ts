import {
  COLLABORATION_AUTHORED_MESSAGE_PAGE_DEFAULT_LIMIT,
  COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT,
  COLLABORATION_PROJECT_MEMBER_LIMIT,
  type CollaborationAppendAuthoredMessageRequest,
  type CollaborationAuthoredMessage,
  type CollaborationAuthoredMessagePage,
  type CollaborationAuthoredMessagePageRequest,
  type CollaborationContextPacket,
  type CollaborationProjectMember,
  type SharedProjectId,
} from "@cafecode/contracts";

export const SHARED_OPERATOR_CHAT_PAGE_LIMIT = COLLABORATION_AUTHORED_MESSAGE_PAGE_DEFAULT_LIMIT;
export const SHARED_OPERATOR_CHAT_RETAINED_MESSAGE_LIMIT = 2_048;
export const SHARED_OPERATOR_CHAT_PENDING_SEND_LIMIT = 20;
export const SHARED_OPERATOR_CHAT_VISIBLE_PARTICIPANT_LIMIT = 20;
export const SHARED_OPERATOR_CHAT_VISIBLE_PACKET_LIMIT = 8;
export const SHARED_OPERATOR_CHAT_VISIBLE_POINTER_LIMIT = 20;

export type SharedOperatorChatConnectionState = "online" | "offline" | "reconnecting";

export type SharedOperatorChatAppendResult =
  | {
      readonly disposition: "accepted" | "already-accepted";
      readonly message: CollaborationAuthoredMessage;
    }
  | {
      readonly disposition: "conflict";
      readonly safeCode: string;
    };

export interface SharedOperatorChatClient {
  readonly readAuthoredMessages: (
    request: CollaborationAuthoredMessagePageRequest & { readonly signal: AbortSignal },
  ) => Promise<CollaborationAuthoredMessagePage>;
  readonly appendAuthoredMessage: (
    request: CollaborationAppendAuthoredMessageRequest & { readonly signal: AbortSignal },
  ) => Promise<SharedOperatorChatAppendResult>;
}

export interface SharedOperatorTimelineState {
  readonly messages: readonly CollaborationAuthoredMessage[];
  readonly nextCursor: number;
  readonly hasMore: boolean;
  readonly saturated: boolean;
}

export const EMPTY_SHARED_OPERATOR_TIMELINE: SharedOperatorTimelineState = Object.freeze({
  messages: [],
  nextCursor: 0,
  hasMore: true,
  saturated: false,
});

export function collaborationParticipantsAreValid(
  participants: readonly CollaborationProjectMember[],
): boolean {
  return (
    participants.length <= COLLABORATION_PROJECT_MEMBER_LIMIT &&
    new Set(participants.map((participant) => participant.userId)).size === participants.length
  );
}

function pageOrderIsValid(page: CollaborationAuthoredMessagePage): boolean {
  if (page.messages.length !== page.mergedOrder.length) return false;
  const byId = new Map(page.messages.map((message) => [message.messageId, message]));
  if (byId.size !== page.messages.length) return false;
  const orderedIds = new Set(page.mergedOrder);
  return (
    orderedIds.size === page.mergedOrder.length &&
    [...byId.keys()].every((id) => orderedIds.has(id))
  );
}

export function mergeSharedOperatorMessagePage(input: {
  readonly state: SharedOperatorTimelineState;
  readonly page: CollaborationAuthoredMessagePage;
  readonly projectId: SharedProjectId;
  readonly requestedAfterSequence: number;
  readonly retainedLimit?: number;
}): SharedOperatorTimelineState {
  const { state, page, projectId, requestedAfterSequence } = input;
  const requestedRetainedLimit = input.retainedLimit ?? SHARED_OPERATOR_CHAT_RETAINED_MESSAGE_LIMIT;
  const retainedLimit = Number.isFinite(requestedRetainedLimit)
    ? Math.max(
        1,
        Math.min(SHARED_OPERATOR_CHAT_RETAINED_MESSAGE_LIMIT, Math.trunc(requestedRetainedLimit)),
      )
    : SHARED_OPERATOR_CHAT_RETAINED_MESSAGE_LIMIT;
  const pageSequences = page.messages.map((message) => message.projectSequence);
  const expectedNextCursor =
    pageSequences.length === 0 ? requestedAfterSequence : Math.max(...pageSequences);
  if (
    page.sharedProjectId !== projectId ||
    requestedAfterSequence !== state.nextCursor ||
    page.nextCursor < requestedAfterSequence ||
    page.messages.length > COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT ||
    !pageOrderIsValid(page) ||
    new Set(pageSequences).size !== pageSequences.length ||
    page.nextCursor !== expectedNextCursor ||
    page.messages.some(
      (message) =>
        message.sharedProjectId !== projectId ||
        message.projectSequence <= requestedAfterSequence ||
        message.projectSequence > page.nextCursor,
    )
  ) {
    return state;
  }

  const pageById = new Map(page.messages.map((message) => [message.messageId, message]));
  const mergedById = new Map(state.messages.map((message) => [message.messageId, message]));
  for (const message of page.messages) {
    const prior = mergedById.get(message.messageId);
    if (
      prior !== undefined &&
      (prior.projectSequence !== message.projectSequence ||
        prior.messageSha256 !== message.messageSha256)
    ) {
      return state;
    }
    if (
      state.messages.some(
        (entry) =>
          entry.messageId !== message.messageId &&
          entry.projectSequence === message.projectSequence,
      )
    ) {
      return state;
    }
  }
  for (const messageId of page.mergedOrder) {
    const message = pageById.get(messageId);
    if (message !== undefined) mergedById.set(messageId, message);
  }
  const ordered = [...mergedById.values()].toSorted(
    (left, right) =>
      left.projectSequence - right.projectSequence ||
      String(left.messageId).localeCompare(String(right.messageId)),
  );
  const saturated = ordered.length > retainedLimit || state.saturated;
  return {
    messages: ordered.slice(-retainedLimit),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
    saturated,
  };
}

export function appendConfirmedSharedOperatorMessage(input: {
  readonly state: SharedOperatorTimelineState;
  readonly message: CollaborationAuthoredMessage;
  readonly expectedMessageId: CollaborationAuthoredMessage["messageId"];
  readonly projectId: SharedProjectId;
}): SharedOperatorTimelineState | null {
  const { state, message, expectedMessageId, projectId } = input;
  if (message.sharedProjectId !== projectId || message.messageId !== expectedMessageId) return null;
  const existing = state.messages.find((entry) => entry.messageId === message.messageId);
  if (
    (existing !== undefined &&
      (existing.projectSequence !== message.projectSequence ||
        existing.messageSha256 !== message.messageSha256)) ||
    state.messages.some(
      (entry) =>
        entry.messageId !== message.messageId && entry.projectSequence === message.projectSequence,
    )
  ) {
    return null;
  }
  const byId = new Map(state.messages.map((entry) => [entry.messageId, entry]));
  byId.set(message.messageId, message);
  const ordered = [...byId.values()].toSorted(
    (left, right) =>
      left.projectSequence - right.projectSequence ||
      String(left.messageId).localeCompare(String(right.messageId)),
  );
  const saturated = ordered.length > SHARED_OPERATOR_CHAT_RETAINED_MESSAGE_LIMIT || state.saturated;
  return {
    messages: ordered.slice(-SHARED_OPERATOR_CHAT_RETAINED_MESSAGE_LIMIT),
    // An append acknowledgement can arrive ahead of unread project events.
    // Only a contiguous page is allowed to advance the replay cursor.
    nextCursor: state.nextCursor,
    hasMore: state.hasMore,
    saturated,
  };
}

export function visibleSharedOperatorContextPackets(
  packets: readonly CollaborationContextPacket[],
  projectId: SharedProjectId,
): readonly CollaborationContextPacket[] {
  return packets
    .filter((packet) => packet.sharedProjectId === projectId)
    .toSorted((left, right) => right.throughSequence - left.throughSequence)
    .slice(0, SHARED_OPERATOR_CHAT_VISIBLE_PACKET_LIMIT);
}

export function safeCollaborationFailureCode(value: unknown): string {
  const candidate = typeof value === "string" ? value : value instanceof Error ? value.name : "";
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(candidate)
    ? candidate
    : "CollaborationRequestFailure";
}
