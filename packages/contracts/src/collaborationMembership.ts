import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS,
  COLLABORATION_IDENTIFIER_MAX_CHARS,
  CollaborationPermission,
  CollaborationPermissions,
  CollaborationProjectMember,
  CollaborationProjectRole,
  CollaborationSessionId,
  COLLABORATION_ROLE_PERMISSIONS,
  DeviceId,
  SharedProjectId,
  UserId,
} from "./collaboration.ts";

export const COLLABORATION_INVITE_SECRET_BYTES = 32;
export const COLLABORATION_INVITE_SECRET_BASE64URL_CHARS = 43;
export const COLLABORATION_INVITE_MIN_LIFETIME_MILLIS = 60_000;
export const COLLABORATION_INVITE_MAX_LIFETIME_MILLIS = 30 * 24 * 60 * 60_000;
export const COLLABORATION_INVITE_MAX_NOT_BEFORE_DELAY_MILLIS = 7 * 24 * 60 * 60_000;

const CollaborationMembershipIdentifier = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(COLLABORATION_IDENTIFIER_MAX_CHARS),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
);

export const CollaborationMembershipCommandId = CollaborationMembershipIdentifier.pipe(
  Schema.brand("CollaborationMembershipCommandId"),
);
export type CollaborationMembershipCommandId = typeof CollaborationMembershipCommandId.Type;

export const CollaborationInvitationId = CollaborationMembershipIdentifier.pipe(
  Schema.brand("CollaborationInvitationId"),
);
export type CollaborationInvitationId = typeof CollaborationInvitationId.Type;

export const CollaborationInvitationSecret = Schema.String.check(
  Schema.isMinLength(COLLABORATION_INVITE_SECRET_BASE64URL_CHARS),
  Schema.isMaxLength(COLLABORATION_INVITE_SECRET_BASE64URL_CHARS),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/),
).pipe(Schema.brand("CollaborationInvitationSecret"));
export type CollaborationInvitationSecret = typeof CollaborationInvitationSecret.Type;

export const CollaborationInviteDelayMillis = NonNegativeInt.check(
  Schema.isLessThanOrEqualTo(COLLABORATION_INVITE_MAX_NOT_BEFORE_DELAY_MILLIS),
);
export type CollaborationInviteDelayMillis = typeof CollaborationInviteDelayMillis.Type;

export const CollaborationInviteLifetimeMillis = PositiveInt.check(
  Schema.isGreaterThanOrEqualTo(COLLABORATION_INVITE_MIN_LIFETIME_MILLIS),
  Schema.isLessThanOrEqualTo(COLLABORATION_INVITE_MAX_LIFETIME_MILLIS),
);
export type CollaborationInviteLifetimeMillis = typeof CollaborationInviteLifetimeMillis.Type;

/**
 * A server-authenticated identity which may redeem an invitation before it has
 * project membership. Role, project and permission claims are intentionally
 * absent and must come only from the stored invitation.
 */
export const CollaborationAuthenticatedIdentity = Schema.Struct({
  sessionId: CollaborationSessionId,
  userId: UserId,
  deviceId: DeviceId,
  issuedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
}).check(
  Schema.makeFilter((identity) => {
    const issuedAt =
      typeof identity.issuedAt === "string"
        ? Date.parse(identity.issuedAt)
        : DateTime.toEpochMillis(identity.issuedAt);
    const expiresAt =
      typeof identity.expiresAt === "string"
        ? Date.parse(identity.expiresAt)
        : DateTime.toEpochMillis(identity.expiresAt);
    const lifetime = expiresAt - issuedAt;
    return lifetime > 0 && lifetime <= COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS
      ? undefined
      : "collaboration authenticated identity lifetime is invalid";
  }),
);
export type CollaborationAuthenticatedIdentity = typeof CollaborationAuthenticatedIdentity.Type;

export const CollaborationInvitationGrant = Schema.Struct({
  invitationId: CollaborationInvitationId,
  sharedProjectId: SharedProjectId,
  role: CollaborationProjectRole,
  permissions: CollaborationPermissions,
  createdByUserId: UserId,
  notBefore: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
});
export type CollaborationInvitationGrant = typeof CollaborationInvitationGrant.Type;

export const CollaborationCreateInvitationRequest = Schema.Struct({
  commandId: CollaborationMembershipCommandId,
  sharedProjectId: SharedProjectId,
  role: CollaborationProjectRole,
  permissions: CollaborationPermissions,
  notBeforeDelayMillis: CollaborationInviteDelayMillis,
  lifetimeMillis: CollaborationInviteLifetimeMillis,
});
export type CollaborationCreateInvitationRequest = typeof CollaborationCreateInvitationRequest.Type;

export const CollaborationCreateInvitationResult = Schema.Struct({
  disposition: Schema.Literals(["created", "already-applied"]),
  invitation: CollaborationInvitationGrant,
  // A replayed command cannot recover a secret which is deliberately never
  // persisted. The caller must retain the first successful response.
  secret: Schema.NullOr(CollaborationInvitationSecret),
});
export type CollaborationCreateInvitationResult = typeof CollaborationCreateInvitationResult.Type;

export const CollaborationRedeemInvitationRequest = Schema.Struct({
  commandId: CollaborationMembershipCommandId,
  sharedProjectId: SharedProjectId,
  secret: CollaborationInvitationSecret,
  displayName: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
});
export type CollaborationRedeemInvitationRequest = typeof CollaborationRedeemInvitationRequest.Type;

export const CollaborationMembershipMutationResult = Schema.Struct({
  disposition: Schema.Literals(["applied", "already-applied"]),
  member: Schema.NullOr(CollaborationProjectMember),
  membershipEpoch: NonNegativeInt,
});
export type CollaborationMembershipMutationResult =
  typeof CollaborationMembershipMutationResult.Type;

export const CollaborationRevokeInvitationRequest = Schema.Struct({
  commandId: CollaborationMembershipCommandId,
  sharedProjectId: SharedProjectId,
  invitationId: CollaborationInvitationId,
});
export type CollaborationRevokeInvitationRequest = typeof CollaborationRevokeInvitationRequest.Type;

export const CollaborationChangeMemberRoleRequest = Schema.Struct({
  commandId: CollaborationMembershipCommandId,
  sharedProjectId: SharedProjectId,
  userId: UserId,
  role: CollaborationProjectRole,
  permissions: CollaborationPermissions,
});
export type CollaborationChangeMemberRoleRequest = typeof CollaborationChangeMemberRoleRequest.Type;

export const CollaborationRemoveMemberRequest = Schema.Struct({
  commandId: CollaborationMembershipCommandId,
  sharedProjectId: SharedProjectId,
  userId: UserId,
});
export type CollaborationRemoveMemberRequest = typeof CollaborationRemoveMemberRequest.Type;

export function collaborationPermissionsFitRole(
  role: CollaborationProjectRole,
  permissions: ReadonlyArray<CollaborationPermission>,
): boolean {
  const allowed = new Set<CollaborationPermission>(COLLABORATION_ROLE_PERMISSIONS[role]);
  return permissions.every((permission) => allowed.has(permission));
}
