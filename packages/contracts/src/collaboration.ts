import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  CommandId,
  EventId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const COLLABORATION_PROTOCOL_VERSION = 1 as const;
export const COLLABORATION_PROJECT_MEMBER_LIMIT = 128;
export const COLLABORATION_MEMBERSHIP_EPOCH_MAX = 2_147_483_647;
export const COLLABORATION_EVENT_SEQUENCE_MAX = Number.MAX_SAFE_INTEGER;
export const COLLABORATION_EVENT_TYPE_MAX_CHARS = 128;
export const COLLABORATION_EVENT_SIGNATURE_MAX_CHARS = 4_096;
export const COLLABORATION_SESSION_ID_MAX_CHARS = 128;
export const COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS = 60 * 60 * 1_000;

export const SharedProjectId = TrimmedNonEmptyString.pipe(Schema.brand("SharedProjectId"));
export type SharedProjectId = typeof SharedProjectId.Type;

export const UserId = TrimmedNonEmptyString.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const DeviceId = TrimmedNonEmptyString.pipe(Schema.brand("DeviceId"));
export type DeviceId = typeof DeviceId.Type;

export const CollaborationAgentId = TrimmedNonEmptyString.pipe(
  Schema.brand("CollaborationAgentId"),
);
export type CollaborationAgentId = typeof CollaborationAgentId.Type;

/**
 * Project roles are deliberately separate from server-wide auth roles.
 * Authorization must resolve one of these roles from the current project
 * membership epoch instead of trusting a role asserted by a client event.
 */
export const CollaborationProjectRole = Schema.Literals([
  "owner",
  "admin",
  "operator",
  "contributor",
  "viewer",
]);
export type CollaborationProjectRole = typeof CollaborationProjectRole.Type;

export const CollaborationPermission = Schema.Literals([
  "project.manage-members",
  "project.manage-settings",
  "transcript.read",
  "transcript.append",
  "chat.read",
  "chat.append",
  "task.read",
  "task.manage",
  "agent.dispatch",
  "approval.review",
  "file.read",
  "file.publish",
  "file.apply",
  "file.tombstone",
  "audit.read",
]);
export type CollaborationPermission = typeof CollaborationPermission.Type;

const ALL_COLLABORATION_PERMISSIONS = [
  "project.manage-members",
  "project.manage-settings",
  "transcript.read",
  "transcript.append",
  "chat.read",
  "chat.append",
  "task.read",
  "task.manage",
  "agent.dispatch",
  "approval.review",
  "file.read",
  "file.publish",
  "file.apply",
  "file.tombstone",
  "audit.read",
] as const satisfies ReadonlyArray<CollaborationPermission>;

export const COLLABORATION_ROLE_PERMISSIONS = {
  owner: ALL_COLLABORATION_PERMISSIONS,
  admin: ALL_COLLABORATION_PERMISSIONS,
  operator: [
    "transcript.read",
    "transcript.append",
    "chat.read",
    "chat.append",
    "task.read",
    "task.manage",
    "agent.dispatch",
    "approval.review",
    "file.read",
    "file.publish",
    "file.apply",
    "file.tombstone",
    "audit.read",
  ],
  contributor: [
    "transcript.read",
    "transcript.append",
    "chat.read",
    "chat.append",
    "task.read",
    "task.manage",
    "file.read",
    "file.publish",
  ],
  viewer: ["transcript.read", "chat.read", "task.read", "file.read"],
} as const satisfies Readonly<
  Record<CollaborationProjectRole, ReadonlyArray<CollaborationPermission>>
>;

export const CollaborationPermissions = Schema.Array(CollaborationPermission).check(
  Schema.isMaxLength(ALL_COLLABORATION_PERMISSIONS.length),
  Schema.makeFilter((permissions) =>
    new Set(permissions).size === permissions.length
      ? undefined
      : "must not contain duplicate collaboration permissions",
  ),
);
export type CollaborationPermissions = typeof CollaborationPermissions.Type;

export function collaborationRoleAllowsPermission(
  role: CollaborationProjectRole,
  permission: CollaborationPermission,
): boolean {
  const allowed: ReadonlyArray<CollaborationPermission> = COLLABORATION_ROLE_PERMISSIONS[role];
  return allowed.includes(permission);
}

export const CollaborationMembershipEpoch = NonNegativeInt.check(
  Schema.isLessThanOrEqualTo(COLLABORATION_MEMBERSHIP_EPOCH_MAX),
);
export type CollaborationMembershipEpoch = typeof CollaborationMembershipEpoch.Type;

export const CollaborationSessionId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(COLLABORATION_SESSION_ID_MAX_CHARS),
).pipe(Schema.brand("CollaborationSessionId"));
export type CollaborationSessionId = typeof CollaborationSessionId.Type;

/**
 * Server-authenticated project principal passed into collaboration handlers.
 *
 * Role and permission claims are intentionally absent. Handlers must resolve
 * both from the current membership snapshot so a client cannot retain elevated
 * authority by replaying an older token or asserting its own role.
 */
export const CollaborationPrincipal = Schema.Struct({
  sessionId: CollaborationSessionId,
  sharedProjectId: SharedProjectId,
  userId: UserId,
  deviceId: DeviceId,
  membershipEpoch: CollaborationMembershipEpoch,
  issuedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
}).check(
  Schema.makeFilter((principal) => {
    // Schema checks also run on the encoded representation during encode, so
    // accept the already-validated ISO string shape as well as decoded
    // DateTime values.
    const issuedAtEpochMillis =
      typeof principal.issuedAt === "string"
        ? Date.parse(principal.issuedAt)
        : DateTime.toEpochMillis(principal.issuedAt);
    const expiresAtEpochMillis =
      typeof principal.expiresAt === "string"
        ? Date.parse(principal.expiresAt)
        : DateTime.toEpochMillis(principal.expiresAt);
    const lifetimeMillis = expiresAtEpochMillis - issuedAtEpochMillis;
    return lifetimeMillis > 0 && lifetimeMillis <= COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS
      ? undefined
      : `collaboration access session lifetime must be greater than zero and at most ${COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS} milliseconds`;
  }),
);
export type CollaborationPrincipal = typeof CollaborationPrincipal.Type;

export const CollaborationProjectMember = Schema.Struct({
  userId: UserId,
  displayName: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  role: CollaborationProjectRole,
  permissions: CollaborationPermissions,
  joinedAt: IsoDateTime,
}).check(
  Schema.makeFilter((member) =>
    member.permissions.every((permission) =>
      collaborationRoleAllowsPermission(member.role, permission),
    )
      ? undefined
      : "permissions must not exceed the collaboration project role",
  ),
);
export type CollaborationProjectMember = typeof CollaborationProjectMember.Type;

export const CollaborationProjectMembers = Schema.Array(CollaborationProjectMember).check(
  Schema.isMaxLength(COLLABORATION_PROJECT_MEMBER_LIMIT),
  Schema.makeFilter((members) =>
    new Set(members.map((member) => member.userId)).size === members.length
      ? undefined
      : "must not contain duplicate collaboration project members",
  ),
);
export type CollaborationProjectMembers = typeof CollaborationProjectMembers.Type;

export const CollaborationProjectMembershipSnapshot = Schema.Struct({
  sharedProjectId: SharedProjectId,
  epoch: CollaborationMembershipEpoch,
  members: CollaborationProjectMembers,
  updatedAt: IsoDateTime,
});
export type CollaborationProjectMembershipSnapshot =
  typeof CollaborationProjectMembershipSnapshot.Type;

export const CollaborationEventSequence = PositiveInt.check(
  Schema.isLessThanOrEqualTo(COLLABORATION_EVENT_SEQUENCE_MAX),
);
export type CollaborationEventSequence = typeof CollaborationEventSequence.Type;

const CollaborationEventServiceId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));

export const CollaborationEventActor = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("operator"),
    userId: UserId,
    deviceId: DeviceId,
  }),
  Schema.Struct({
    kind: Schema.Literal("agent"),
    userId: UserId,
    deviceId: DeviceId,
    agentId: CollaborationAgentId,
  }),
  Schema.Struct({
    kind: Schema.Literal("system"),
    serviceId: CollaborationEventServiceId,
  }),
]);
export type CollaborationEventActor = typeof CollaborationEventActor.Type;

export const CollaborationEventType = TrimmedNonEmptyString.check(
  Schema.isMaxLength(COLLABORATION_EVENT_TYPE_MAX_CHARS),
);
export type CollaborationEventType = typeof CollaborationEventType.Type;

export const CollaborationSha256 = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export type CollaborationSha256 = typeof CollaborationSha256.Type;

export const CollaborationEventSignature = TrimmedNonEmptyString.check(
  Schema.isMaxLength(COLLABORATION_EVENT_SIGNATURE_MAX_CHARS),
);
export type CollaborationEventSignature = typeof CollaborationEventSignature.Type;

/**
 * Durable, append-only project event envelope.
 *
 * The payload remains extensible while its hash, actor, membership epoch,
 * idempotent command, ordering, and causation fields provide the immutable
 * authorization/audit boundary needed by a later collaboration event store.
 */
export const CollaborationEventEnvelope = Schema.Struct({
  version: Schema.Literal(COLLABORATION_PROTOCOL_VERSION),
  sharedProjectId: SharedProjectId,
  sequence: CollaborationEventSequence,
  eventId: EventId,
  commandId: CommandId,
  membershipEpoch: CollaborationMembershipEpoch,
  actor: CollaborationEventActor,
  type: CollaborationEventType,
  payload: Schema.Unknown,
  payloadSha256: CollaborationSha256,
  previousEventSha256: Schema.NullOr(CollaborationSha256),
  authorSignature: CollaborationEventSignature,
  causationEventId: Schema.NullOr(EventId),
  correlationId: Schema.NullOr(CommandId),
  occurredAt: IsoDateTime,
  receivedAt: IsoDateTime,
});
export type CollaborationEventEnvelope = typeof CollaborationEventEnvelope.Type;
