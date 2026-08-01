import * as Schema from "effect/Schema";

import {
  CollaborationTransportErrorCode,
  CollaborationTransportOperation,
  CollaborationTransportPage,
} from "./collaborationTransport.ts";

export const COLLABORATION_NETWORK_PROTOCOL_VERSION = 1;
export const COLLABORATION_NETWORK_REQUEST_ID_MAX_CHARS = 64;
export const COLLABORATION_NETWORK_INBOUND_FRAME_MAX_UTF8_BYTES = 100 * 1_024;
export const COLLABORATION_NETWORK_OUTBOUND_FRAME_MAX_UTF8_BYTES = 700 * 1_024;
export const COLLABORATION_NETWORK_MAX_CONNECTIONS = 64;
export const COLLABORATION_NETWORK_MAX_SUBSCRIPTIONS_PER_CONNECTION = 4;
export const COLLABORATION_NETWORK_MAX_OUTBOUND_QUEUE_MESSAGES = 16;
export const COLLABORATION_NETWORK_MAX_OUTBOUND_QUEUE_UTF8_BYTES = 2 * 1_024 * 1_024;
export const COLLABORATION_NETWORK_REQUESTS_PER_MINUTE = 120;
export const COLLABORATION_NETWORK_HEARTBEAT_INTERVAL_MS = 30_000;
export const COLLABORATION_NETWORK_LIVENESS_TIMEOUT_MS = 90_000;
export const COLLABORATION_NETWORK_SHUTDOWN_GRACE_MS = 10_000;

export const CollaborationNetworkRequestId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(COLLABORATION_NETWORK_REQUEST_ID_MAX_CHARS),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
).pipe(Schema.brand("CollaborationNetworkRequestId"));
export type CollaborationNetworkRequestId = typeof CollaborationNetworkRequestId.Type;

export const CollaborationNetworkDeviceProof = Schema.Struct({
  deviceId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
  deviceKeyId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128)),
  issuedAtMs: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  nonce: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(96),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  ),
  signature: Schema.String.check(
    Schema.isNonEmpty(),
    Schema.isMaxLength(256),
    Schema.isPattern(/^[A-Za-z0-9_-]+$/),
  ),
});
export type CollaborationNetworkDeviceProof = typeof CollaborationNetworkDeviceProof.Type;

export const CollaborationNetworkRequestFrame = Schema.Struct({
  version: Schema.Literal(COLLABORATION_NETWORK_PROTOCOL_VERSION),
  type: Schema.Literal("request"),
  requestId: CollaborationNetworkRequestId,
  operation: CollaborationTransportOperation,
  proof: CollaborationNetworkDeviceProof,
  request: Schema.Unknown,
});
export type CollaborationNetworkRequestFrame = typeof CollaborationNetworkRequestFrame.Type;

export const CollaborationNetworkCancelFrame = Schema.Struct({
  version: Schema.Literal(COLLABORATION_NETWORK_PROTOCOL_VERSION),
  type: Schema.Literal("cancel"),
  requestId: CollaborationNetworkRequestId,
});
export type CollaborationNetworkCancelFrame = typeof CollaborationNetworkCancelFrame.Type;

export const CollaborationNetworkClientFrame = Schema.Union([
  CollaborationNetworkRequestFrame,
  CollaborationNetworkCancelFrame,
]);
export type CollaborationNetworkClientFrame = typeof CollaborationNetworkClientFrame.Type;

export const CollaborationNetworkPublicErrorCode = Schema.Union([
  CollaborationTransportErrorCode,
  Schema.Literal("rate-limited"),
]);
export type CollaborationNetworkPublicErrorCode = typeof CollaborationNetworkPublicErrorCode.Type;

export const CollaborationNetworkResultFrame = Schema.Struct({
  version: Schema.Literal(COLLABORATION_NETWORK_PROTOCOL_VERSION),
  type: Schema.Literal("result"),
  requestId: CollaborationNetworkRequestId,
  operation: CollaborationTransportOperation,
  payload: Schema.Unknown,
});
export type CollaborationNetworkResultFrame = typeof CollaborationNetworkResultFrame.Type;

export const CollaborationNetworkReplayPageFrame = Schema.Struct({
  version: Schema.Literal(COLLABORATION_NETWORK_PROTOCOL_VERSION),
  type: Schema.Literal("replay-page"),
  requestId: CollaborationNetworkRequestId,
  page: CollaborationTransportPage,
});
export type CollaborationNetworkReplayPageFrame = typeof CollaborationNetworkReplayPageFrame.Type;

export const CollaborationNetworkErrorFrame = Schema.Struct({
  version: Schema.Literal(COLLABORATION_NETWORK_PROTOCOL_VERSION),
  type: Schema.Literal("error"),
  requestId: Schema.NullOr(CollaborationNetworkRequestId),
  code: CollaborationNetworkPublicErrorCode,
});
export type CollaborationNetworkErrorFrame = typeof CollaborationNetworkErrorFrame.Type;

export const CollaborationNetworkServerFrame = Schema.Union([
  CollaborationNetworkResultFrame,
  CollaborationNetworkReplayPageFrame,
  CollaborationNetworkErrorFrame,
]);
export type CollaborationNetworkServerFrame = typeof CollaborationNetworkServerFrame.Type;
