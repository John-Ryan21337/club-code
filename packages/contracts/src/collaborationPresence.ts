import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt } from "./baseSchemas.ts";
import {
  CollaborationMembershipEpoch,
  DeviceId,
  SharedProjectId,
  UserId,
} from "./collaboration.ts";

/** The normal roster is intentionally small; protocol consumers may request at most this many. */
export const COLLABORATION_PRESENCE_INITIAL_ROSTER_LIMIT = 20;
export const COLLABORATION_PRESENCE_ROSTER_MAX = 128;
export const COLLABORATION_PRESENCE_MAX_SESSIONS_PER_DEVICE = 4;
export const COLLABORATION_PRESENCE_HEARTBEAT_INTERVAL_MILLIS = 15_000;
export const COLLABORATION_PRESENCE_SESSION_TTL_MILLIS = 45_000;
export const COLLABORATION_PRESENCE_DELTA_REPLAY_MAX = 128;
export const COLLABORATION_PRESENCE_REQUEST_ID_MAX_CHARS = 128;
export const COLLABORATION_PRESENCE_SESSION_ID_BYTES = 32;
export const COLLABORATION_PRESENCE_SESSION_ID_CHARS = 43;

const PresenceIdentifier = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(COLLABORATION_PRESENCE_REQUEST_ID_MAX_CHARS),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
);

/** A random server-issued capability, never a user, device, or database identifier. */
export const CollaborationPresenceSessionId = Schema.String.check(
  Schema.isMinLength(COLLABORATION_PRESENCE_SESSION_ID_CHARS),
  Schema.isMaxLength(COLLABORATION_PRESENCE_SESSION_ID_CHARS),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
).pipe(Schema.brand("CollaborationPresenceSessionId"));
export type CollaborationPresenceSessionId = typeof CollaborationPresenceSessionId.Type;

export const CollaborationPresenceRequestId = PresenceIdentifier.pipe(
  Schema.brand("CollaborationPresenceRequestId"),
);
export type CollaborationPresenceRequestId = typeof CollaborationPresenceRequestId.Type;

/** Presence communicates availability only. It is not a task, provider, or activity feed. */
export const CollaborationPresenceState = Schema.Literals(["online", "away", "offline"]);
export type CollaborationPresenceState = typeof CollaborationPresenceState.Type;

/**
 * Fixed, coarse capabilities are safe to show to project members. Paths,
 * prompts, provider names, model names, task state, and activity text are not
 * representable in this contract.
 */
export const CollaborationPresenceCapability = Schema.Literals(["operator-chat", "shared-context"]);
export type CollaborationPresenceCapability = typeof CollaborationPresenceCapability.Type;
export const CollaborationPresenceCapabilities = Schema.Array(
  CollaborationPresenceCapability,
).check(
  Schema.isMaxLength(2),
  Schema.makeFilter((value) =>
    new Set(value).size === value.length ? undefined : "presence capabilities must be unique",
  ),
);
export type CollaborationPresenceCapabilities = typeof CollaborationPresenceCapabilities.Type;

export const CollaborationPresenceRosterEntry = Schema.Struct({
  sessionId: CollaborationPresenceSessionId,
  userId: UserId,
  deviceId: DeviceId,
  membershipEpoch: CollaborationMembershipEpoch,
  state: CollaborationPresenceState,
  capabilities: CollaborationPresenceCapabilities,
  expiresAt: Schema.DateTimeUtcFromString,
});
export type CollaborationPresenceRosterEntry = typeof CollaborationPresenceRosterEntry.Type;

export const CollaborationPresenceSnapshot = Schema.Struct({
  sharedProjectId: SharedProjectId,
  version: NonNegativeInt,
  entries: Schema.Array(CollaborationPresenceRosterEntry).check(
    Schema.isMaxLength(COLLABORATION_PRESENCE_ROSTER_MAX),
  ),
});
export type CollaborationPresenceSnapshot = typeof CollaborationPresenceSnapshot.Type;

export const CollaborationPresenceDelta = Schema.Struct({
  sharedProjectId: SharedProjectId,
  version: PositiveInt,
  upserts: Schema.Array(CollaborationPresenceRosterEntry).check(
    Schema.isMaxLength(COLLABORATION_PRESENCE_ROSTER_MAX),
  ),
  removedSessionIds: Schema.Array(CollaborationPresenceSessionId).check(
    Schema.isMaxLength(COLLABORATION_PRESENCE_ROSTER_MAX),
  ),
});
export type CollaborationPresenceDelta = typeof CollaborationPresenceDelta.Type;

/** A subscriber gets deltas when retained, otherwise an authoritative resync snapshot. */
export const CollaborationPresenceUpdate = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), snapshot: CollaborationPresenceSnapshot }),
  Schema.Struct({ kind: Schema.Literal("delta"), delta: CollaborationPresenceDelta }),
]);
export type CollaborationPresenceUpdate = typeof CollaborationPresenceUpdate.Type;

export const CollaborationPresenceOpenRequest = Schema.Struct({
  requestId: CollaborationPresenceRequestId,
  sharedProjectId: SharedProjectId,
  state: CollaborationPresenceState,
  capabilities: CollaborationPresenceCapabilities,
  supersedesSessionId: Schema.NullOr(CollaborationPresenceSessionId),
});
export type CollaborationPresenceOpenRequest = typeof CollaborationPresenceOpenRequest.Type;

export const CollaborationPresenceHeartbeatRequest = Schema.Struct({
  requestId: CollaborationPresenceRequestId,
  sharedProjectId: SharedProjectId,
  sessionId: CollaborationPresenceSessionId,
  state: CollaborationPresenceState,
  capabilities: CollaborationPresenceCapabilities,
});
export type CollaborationPresenceHeartbeatRequest =
  typeof CollaborationPresenceHeartbeatRequest.Type;

export const CollaborationPresenceCloseRequest = Schema.Struct({
  requestId: CollaborationPresenceRequestId,
  sharedProjectId: SharedProjectId,
  sessionId: CollaborationPresenceSessionId,
});
export type CollaborationPresenceCloseRequest = typeof CollaborationPresenceCloseRequest.Type;

export const CollaborationPresenceSubscribeRequest = Schema.Struct({
  sharedProjectId: SharedProjectId,
  sessionId: CollaborationPresenceSessionId,
  afterVersion: NonNegativeInt,
  rosterLimit: Schema.optional(
    PositiveInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_PRESENCE_ROSTER_MAX)),
  ),
});
export type CollaborationPresenceSubscribeRequest =
  typeof CollaborationPresenceSubscribeRequest.Type;
