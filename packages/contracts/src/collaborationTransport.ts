import * as Schema from "effect/Schema";

import { PositiveInt } from "./baseSchemas.ts";
import {
  CollaborationAppendAuthoredMessageRequest,
  CollaborationAuthoredMessage,
  CollaborationAuthoredMessageKinds,
  CollaborationContextPacket,
  CollaborationCreateContextPacketRequest,
  CollaborationTombstoneAuthoredMessageRequest,
} from "./collaborationChat.ts";
import { SharedProjectId } from "./collaboration.ts";
import {
  CollaborationCurrentDeviceKeyStatus,
  CollaborationCurrentDeviceKeyStatusRequest,
  CollaborationDeviceKeyMutationResult,
  CollaborationRevokeDeviceKeyRequest,
} from "./collaborationDevice.ts";

export const COLLABORATION_TRANSPORT_REQUEST_MAX_UTF8_BYTES = 96 * 1_024;
export const COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES = 640 * 1_024;
export const COLLABORATION_TRANSPORT_PROJECT_MAX_CONCURRENCY = 8;
export const COLLABORATION_TRANSPORT_REPLAY_MAX_BATCHES = 32;
export const COLLABORATION_TRANSPORT_REPLAY_MAX_MESSAGES = 512;
export const COLLABORATION_TRANSPORT_CURSOR_MAX_CHARS = 512;

/**
 * A server-authenticated cursor. Its payload is deliberately opaque to clients
 * and must be integrity-bound to one shared project by the server facade.
 */
export const CollaborationTransportCursor = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(COLLABORATION_TRANSPORT_CURSOR_MAX_CHARS),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
).pipe(Schema.brand("CollaborationTransportCursor"));
export type CollaborationTransportCursor = typeof CollaborationTransportCursor.Type;

export const CollaborationTransportPageRequest = Schema.Struct({
  sharedProjectId: SharedProjectId,
  cursor: Schema.NullOr(CollaborationTransportCursor),
  limit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(256))),
  kinds: CollaborationAuthoredMessageKinds,
});
export type CollaborationTransportPageRequest = typeof CollaborationTransportPageRequest.Type;

export const CollaborationTransportPage = Schema.Struct({
  sharedProjectId: SharedProjectId,
  messages: Schema.Array(CollaborationAuthoredMessage).check(Schema.isMaxLength(256)),
  mergedOrder: Schema.Array(CollaborationAuthoredMessage.fields.messageId).check(
    Schema.isMaxLength(256),
  ),
  lanePositions: Schema.Array(
    Schema.Struct({
      messageId: CollaborationAuthoredMessage.fields.messageId,
      userId: CollaborationAuthoredMessage.fields.authorUserId,
      projectSequence: CollaborationAuthoredMessage.fields.projectSequence,
      operatorSequence: CollaborationAuthoredMessage.fields.operatorSequence,
    }),
  ).check(Schema.isMaxLength(256)),
  nextCursor: CollaborationTransportCursor,
  hasMore: Schema.Boolean,
});
export type CollaborationTransportPage = typeof CollaborationTransportPage.Type;

export const CollaborationTransportReplayRequest = Schema.Struct({
  sharedProjectId: SharedProjectId,
  cursor: Schema.NullOr(CollaborationTransportCursor),
  kinds: CollaborationAuthoredMessageKinds,
  batchLimit: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(256))),
  maxBatches: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_TRANSPORT_REPLAY_MAX_BATCHES)),
  ),
});
export type CollaborationTransportReplayRequest = typeof CollaborationTransportReplayRequest.Type;

export const CollaborationTransportReplayResult = Schema.Struct({
  sharedProjectId: SharedProjectId,
  deliveredBatches: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  deliveredMessages: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  nextCursor: CollaborationTransportCursor,
  caughtUp: Schema.Boolean,
});
export type CollaborationTransportReplayResult = typeof CollaborationTransportReplayResult.Type;

export const CollaborationTransportOperation = Schema.Literals([
  "message.append",
  "message.tombstone",
  "message.page",
  "context.create",
  "device-key.status",
  "device-key.revoke",
  "message.subscribe-replay",
]);
export type CollaborationTransportOperation = typeof CollaborationTransportOperation.Type;

export const CollaborationTransportErrorCode = Schema.Literals([
  "invalid-request",
  "not-found",
  "conflict",
  "resource-exhausted",
  "cancelled",
  "slow-consumer",
  "unavailable",
]);
export type CollaborationTransportErrorCode = typeof CollaborationTransportErrorCode.Type;

// Re-exporting these schemas here documents the complete listener-facing
// command surface without inventing a second representation of message data.
export const CollaborationTransportAppendRequest = CollaborationAppendAuthoredMessageRequest;
export const CollaborationTransportTombstoneRequest = CollaborationTombstoneAuthoredMessageRequest;
export const CollaborationTransportCreateContextRequest = CollaborationCreateContextPacketRequest;
export const CollaborationTransportAppendResponse = CollaborationAuthoredMessage;
export const CollaborationTransportTombstoneResponse = CollaborationAuthoredMessage;
export const CollaborationTransportCreateContextResponse = CollaborationContextPacket;
export const CollaborationTransportDeviceKeyStatusRequest =
  CollaborationCurrentDeviceKeyStatusRequest;
export const CollaborationTransportDeviceKeyStatusResponse = CollaborationCurrentDeviceKeyStatus;
export const CollaborationTransportDeviceKeyRevokeRequest = CollaborationRevokeDeviceKeyRequest;
export const CollaborationTransportDeviceKeyRevokeResponse = CollaborationDeviceKeyMutationResult;
