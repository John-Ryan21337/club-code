import type {
  CollaborationPermission,
  CollaborationPrincipal,
  CollaborationProjectMember,
  CollaborationProjectMembershipSnapshot,
} from "@cafecode/contracts";
import { collaborationRoleAllowsPermission } from "@cafecode/contracts";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

export type CollaborationAuthorizationFailureReason =
  | "project-mismatch"
  | "session-not-yet-valid"
  | "session-expired"
  | "membership-epoch-mismatch"
  | "member-not-found"
  | "permission-denied";

/**
 * Internal denial details are intentionally metadata-only. Transport handlers
 * should map every instance to the same generic forbidden response so callers
 * cannot use authorization failures to enumerate projects or memberships.
 */
export class CollaborationAuthorizationError extends Data.TaggedError(
  "CollaborationAuthorizationError",
)<{
  readonly reason: CollaborationAuthorizationFailureReason;
}> {}

export interface CollaborationAuthorizationGrant {
  readonly principal: CollaborationPrincipal;
  readonly member: CollaborationProjectMember;
  readonly permission: CollaborationPermission;
}

export interface CollaborationAuthorizationInput {
  /**
   * This principal must come from the server authentication boundary after its
   * device session and signature have been validated. Client payloads must
   * never be decoded directly into this trusted input.
   */
  readonly principal: CollaborationPrincipal;
  readonly membership: CollaborationProjectMembershipSnapshot;
  readonly targetProjectId: CollaborationProjectMembershipSnapshot["sharedProjectId"];
  readonly permission: CollaborationPermission;
  readonly now: DateTime.Utc;
}

function deny(
  reason: CollaborationAuthorizationFailureReason,
): Effect.Effect<never, CollaborationAuthorizationError> {
  return Effect.fail(new CollaborationAuthorizationError({ reason }));
}

/**
 * Central project authorization boundary for future collaboration commands,
 * subscriptions, snapshots, events, and blobs.
 *
 * Authorization is resolved from the latest server-owned membership snapshot.
 * No role or permission asserted by the principal or command is trusted.
 */
export function authorizeCollaborationPermission(
  input: CollaborationAuthorizationInput,
): Effect.Effect<CollaborationAuthorizationGrant, CollaborationAuthorizationError> {
  const { membership, now, permission, principal, targetProjectId } = input;

  if (
    principal.sharedProjectId !== targetProjectId ||
    membership.sharedProjectId !== targetProjectId
  ) {
    return deny("project-mismatch");
  }

  if (principal.membershipEpoch !== membership.epoch) {
    return deny("membership-epoch-mismatch");
  }

  const nowEpochMillis = DateTime.toEpochMillis(now);
  if (nowEpochMillis < DateTime.toEpochMillis(principal.issuedAt)) {
    return deny("session-not-yet-valid");
  }

  if (nowEpochMillis >= DateTime.toEpochMillis(principal.expiresAt)) {
    return deny("session-expired");
  }

  const member = membership.members.find((candidate) => candidate.userId === principal.userId);
  if (!member) {
    return deny("member-not-found");
  }

  if (
    !member.permissions.includes(permission) ||
    !collaborationRoleAllowsPermission(member.role, permission)
  ) {
    return deny("permission-denied");
  }

  return Effect.succeed({
    principal,
    member,
    permission,
  });
}
