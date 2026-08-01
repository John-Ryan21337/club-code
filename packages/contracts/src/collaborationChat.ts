import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt } from "./baseSchemas.ts";
import {
  COLLABORATION_EVENT_SEQUENCE_MAX,
  COLLABORATION_IDENTIFIER_MAX_CHARS,
  CollaborationMembershipEpoch,
  CollaborationSha256,
  DeviceId,
  SharedProjectId,
  UserId,
} from "./collaboration.ts";

export const COLLABORATION_AUTHORED_MESSAGE_MAX_CHARS = 32_768;
export const COLLABORATION_AUTHORED_MESSAGE_MAX_UTF8_BYTES = 65_536;
export const COLLABORATION_AUTHORED_MESSAGE_PAGE_DEFAULT_LIMIT = 100;
export const COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT = 256;
export const COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_UTF8_BYTES = 524_288;
export const COLLABORATION_CONTEXT_SOURCE_MAX_COUNT = 128;
export const COLLABORATION_CONTEXT_PACKET_MAX_UTF8_BYTES = 262_144;
export const COLLABORATION_CONTEXT_PACKET_MAX_TOKEN_BUDGET = 65_536;

const Identifier = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(COLLABORATION_IDENTIFIER_MAX_CHARS),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
);

export const CollaborationAuthoredMessageId = Identifier.pipe(
  Schema.brand("CollaborationAuthoredMessageId"),
);
export type CollaborationAuthoredMessageId = typeof CollaborationAuthoredMessageId.Type;

export const CollaborationAuthoredMessageCommandId = Identifier.pipe(
  Schema.brand("CollaborationAuthoredMessageCommandId"),
);
export type CollaborationAuthoredMessageCommandId =
  typeof CollaborationAuthoredMessageCommandId.Type;

export const CollaborationContextPacketId = Identifier.pipe(
  Schema.brand("CollaborationContextPacketId"),
);
export type CollaborationContextPacketId = typeof CollaborationContextPacketId.Type;

export const CollaborationAuthoredMessageKind = Schema.Literals([
  "operator-chat",
  "authored-prompt",
]);
export type CollaborationAuthoredMessageKind = typeof CollaborationAuthoredMessageKind.Type;

export const CollaborationContextInclusion = Schema.Literals(["eligible", "excluded-sensitive"]);
export type CollaborationContextInclusion = typeof CollaborationContextInclusion.Type;

export const CollaborationAuthoredMessageSequence = PositiveInt.check(
  Schema.isLessThanOrEqualTo(COLLABORATION_EVENT_SEQUENCE_MAX),
);
export type CollaborationAuthoredMessageSequence = typeof CollaborationAuthoredMessageSequence.Type;

export const CollaborationAuthoredMessageCursor = NonNegativeInt.check(
  Schema.isLessThanOrEqualTo(COLLABORATION_EVENT_SEQUENCE_MAX),
);
export type CollaborationAuthoredMessageCursor = typeof CollaborationAuthoredMessageCursor.Type;

export const CollaborationAuthoredMessageBody = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(COLLABORATION_AUTHORED_MESSAGE_MAX_CHARS),
  Schema.makeFilter((value) =>
    value.trim().length === 0 ? "authored collaboration message must not be blank" : undefined,
  ),
  Schema.makeFilter((value) =>
    new TextEncoder().encode(value).byteLength <= COLLABORATION_AUTHORED_MESSAGE_MAX_UTF8_BYTES
      ? undefined
      : "authored collaboration message exceeds the UTF-8 byte limit",
  ),
  Schema.makeFilter((value) =>
    /[\uD800-\uDFFF]/u.test(value)
      ? "authored collaboration message must contain only Unicode scalar values"
      : undefined,
  ),
);
export type CollaborationAuthoredMessageBody = typeof CollaborationAuthoredMessageBody.Type;

export const CollaborationAppendAuthoredMessageRequest = Schema.Struct({
  commandId: CollaborationAuthoredMessageCommandId,
  sharedProjectId: SharedProjectId,
  messageId: CollaborationAuthoredMessageId,
  kind: CollaborationAuthoredMessageKind,
  body: CollaborationAuthoredMessageBody,
  contextInclusion: CollaborationContextInclusion,
  occurredAt: Schema.DateTimeUtcFromString,
});
export type CollaborationAppendAuthoredMessageRequest =
  typeof CollaborationAppendAuthoredMessageRequest.Type;

export const CollaborationAuthoredMessageTombstone = Schema.Struct({
  commandId: CollaborationAuthoredMessageCommandId,
  targetMessageId: CollaborationAuthoredMessageId,
  actorUserId: UserId,
  actorDeviceId: DeviceId,
  membershipEpoch: CollaborationMembershipEpoch,
  reason: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(512)),
  createdAt: Schema.DateTimeUtcFromString,
  recoverable: Schema.Literal(true),
});
export type CollaborationAuthoredMessageTombstone =
  typeof CollaborationAuthoredMessageTombstone.Type;

export const CollaborationAuthoredMessage = Schema.Struct({
  sharedProjectId: SharedProjectId,
  projectSequence: CollaborationAuthoredMessageSequence,
  operatorSequence: CollaborationAuthoredMessageSequence,
  messageId: CollaborationAuthoredMessageId,
  kind: CollaborationAuthoredMessageKind,
  body: CollaborationAuthoredMessageBody,
  contextInclusion: CollaborationContextInclusion,
  authorUserId: UserId,
  authorDeviceId: DeviceId,
  membershipEpoch: CollaborationMembershipEpoch,
  previousMessageSha256: Schema.NullOr(CollaborationSha256),
  messageSha256: CollaborationSha256,
  occurredAt: Schema.DateTimeUtcFromString,
  receivedAt: Schema.DateTimeUtcFromString,
  tombstone: Schema.NullOr(CollaborationAuthoredMessageTombstone),
});
export type CollaborationAuthoredMessage = typeof CollaborationAuthoredMessage.Type;

export const CollaborationTombstoneAuthoredMessageRequest = Schema.Struct({
  commandId: CollaborationAuthoredMessageCommandId,
  sharedProjectId: SharedProjectId,
  targetMessageId: CollaborationAuthoredMessageId,
  targetKind: CollaborationAuthoredMessageKind,
  reason: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(512)),
});
export type CollaborationTombstoneAuthoredMessageRequest =
  typeof CollaborationTombstoneAuthoredMessageRequest.Type;

export const CollaborationAuthoredMessageKinds = Schema.Array(
  CollaborationAuthoredMessageKind,
).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(2),
  Schema.makeFilter((kinds) =>
    new Set(kinds).size === kinds.length ? undefined : "message kinds must be unique",
  ),
);

export const CollaborationAuthoredMessagePageRequest = Schema.Struct({
  sharedProjectId: SharedProjectId,
  afterSequence: CollaborationAuthoredMessageCursor,
  limit: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT)),
  ),
  kinds: CollaborationAuthoredMessageKinds,
});
export type CollaborationAuthoredMessagePageRequest =
  typeof CollaborationAuthoredMessagePageRequest.Type;

export const CollaborationOperatorLanePosition = Schema.Struct({
  messageId: CollaborationAuthoredMessageId,
  userId: UserId,
  projectSequence: CollaborationAuthoredMessageSequence,
  operatorSequence: CollaborationAuthoredMessageSequence,
});
export type CollaborationOperatorLanePosition = typeof CollaborationOperatorLanePosition.Type;

export const CollaborationAuthoredMessagePage = Schema.Struct({
  sharedProjectId: SharedProjectId,
  messages: Schema.Array(CollaborationAuthoredMessage).check(
    Schema.isMaxLength(COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT),
  ),
  mergedOrder: Schema.Array(CollaborationAuthoredMessageId).check(
    Schema.isMaxLength(COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT),
  ),
  lanePositions: Schema.Array(CollaborationOperatorLanePosition).check(
    Schema.isMaxLength(COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT),
  ),
  nextCursor: CollaborationAuthoredMessageCursor,
  hasMore: Schema.Boolean,
}).check(
  Schema.makeFilter((page) =>
    new TextEncoder().encode(JSON.stringify(page)).byteLength <=
    COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_UTF8_BYTES
      ? undefined
      : "authored message page exceeds the UTF-8 byte limit",
  ),
);
export type CollaborationAuthoredMessagePage = typeof CollaborationAuthoredMessagePage.Type;

export const CollaborationContextSourceSelection = Schema.Struct({
  messageIds: Schema.Array(CollaborationAuthoredMessageId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(COLLABORATION_CONTEXT_SOURCE_MAX_COUNT),
    Schema.makeFilter((ids) =>
      new Set(ids).size === ids.length ? undefined : "context source message ids must be unique",
    ),
  ),
  sourceKinds: CollaborationAuthoredMessageKinds,
});
export type CollaborationContextSourceSelection = typeof CollaborationContextSourceSelection.Type;

export const CollaborationCreateContextPacketRequest = Schema.Struct({
  commandId: CollaborationAuthoredMessageCommandId,
  sharedProjectId: SharedProjectId,
  packetId: CollaborationContextPacketId,
  basePacketId: Schema.NullOr(CollaborationContextPacketId),
  selection: CollaborationContextSourceSelection,
  tokenBudget: PositiveInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_CONTEXT_PACKET_MAX_TOKEN_BUDGET),
  ),
  encodedByteBudget: PositiveInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_CONTEXT_PACKET_MAX_UTF8_BYTES),
  ),
});
export type CollaborationCreateContextPacketRequest =
  typeof CollaborationCreateContextPacketRequest.Type;

export const CollaborationContextSourcePointer = Schema.Struct({
  messageId: CollaborationAuthoredMessageId,
  projectSequence: CollaborationAuthoredMessageSequence,
  operatorSequence: CollaborationAuthoredMessageSequence,
  authorUserId: UserId,
  kind: CollaborationAuthoredMessageKind,
  bodySha256: CollaborationSha256,
});
export type CollaborationContextSourcePointer = typeof CollaborationContextSourcePointer.Type;

export const CollaborationContextExcludedSource = Schema.Struct({
  messageId: CollaborationAuthoredMessageId,
  reason: Schema.Literals(["sensitive", "tombstoned", "base-packet-covered"]),
});
export type CollaborationContextExcludedSource = typeof CollaborationContextExcludedSource.Type;

/**
 * Compact packets intentionally contain only integrity-checked pointers into
 * shared authored messages. They never duplicate bodies, raw paths, private
 * messages, system prompts, provider output, or secrets into another store.
 */
export const CollaborationContextPacket = Schema.Struct({
  sharedProjectId: SharedProjectId,
  packetId: CollaborationContextPacketId,
  basePacketId: Schema.NullOr(CollaborationContextPacketId),
  sources: Schema.Array(CollaborationContextSourcePointer).check(
    Schema.isMaxLength(COLLABORATION_CONTEXT_SOURCE_MAX_COUNT),
  ),
  excludedSources: Schema.Array(CollaborationContextExcludedSource).check(
    Schema.isMaxLength(COLLABORATION_CONTEXT_SOURCE_MAX_COUNT),
  ),
  tokenBudget: PositiveInt,
  estimatedTokens: NonNegativeInt,
  encodedBytes: NonNegativeInt,
  throughSequence: CollaborationAuthoredMessageCursor,
  packetSha256: CollaborationSha256,
  createdByUserId: UserId,
  createdByDeviceId: DeviceId,
  membershipEpoch: CollaborationMembershipEpoch,
  createdAt: Schema.DateTimeUtcFromString,
});
export type CollaborationContextPacket = typeof CollaborationContextPacket.Type;
