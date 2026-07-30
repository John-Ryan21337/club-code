import type {
  CollaborationPermission,
  CollaborationPrincipal,
  CollaborationProjectMember,
  SharedProjectId,
} from "@cafecode/contracts";
import {
  COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS,
  CollaborationProjectMembershipSnapshot,
  collaborationRoleAllowsPermission,
  type CollaborationProjectMembershipSnapshot as CollaborationProjectMembershipSnapshotType,
} from "@cafecode/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type CollaborationAuthorizationFailureReason =
  | "project-mismatch"
  | "session-not-yet-valid"
  | "session-expired"
  | "session-lifetime-invalid"
  | "membership-unavailable"
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
  readonly targetProjectId: SharedProjectId;
  readonly permission: CollaborationPermission;
}

/**
 * Server-side source of current membership truth.
 *
 * Collaboration transports must provide this service from authenticated
 * server persistence. Keeping the snapshot out of authorization input makes
 * it structurally difficult for a handler to authorize against client-sent or
 * previously cached membership data.
 */
export interface CollaborationMembershipAuthorityShape {
  readonly getCurrent: (
    sharedProjectId: SharedProjectId,
  ) => Effect.Effect<CollaborationProjectMembershipSnapshotType, unknown>;
}

export class CollaborationMembershipAuthority extends Context.Service<
  CollaborationMembershipAuthority,
  CollaborationMembershipAuthorityShape
>()("cafecode/collaboration/CollaborationMembershipAuthority") {}

const decodeMembershipSnapshot = Schema.decodeUnknownEffect(CollaborationProjectMembershipSnapshot);

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
): Effect.Effect<
  CollaborationAuthorizationGrant,
  CollaborationAuthorizationError,
  CollaborationMembershipAuthority
> {
  return Effect.gen(function* () {
    const { permission, principal, targetProjectId } = input;

    // Reject a cross-project principal before consulting project persistence.
    // Besides preventing IDOR, this avoids turning membership lookup timing
    // into a project-existence oracle.
    if (principal.sharedProjectId !== targetProjectId) {
      return yield* deny("project-mismatch");
    }

    const issuedAtEpochMillis = DateTime.toEpochMillis(principal.issuedAt);
    const expiresAtEpochMillis = DateTime.toEpochMillis(principal.expiresAt);
    const lifetimeMillis = expiresAtEpochMillis - issuedAtEpochMillis;
    if (lifetimeMillis <= 0 || lifetimeMillis > COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS) {
      return yield* deny("session-lifetime-invalid");
    }

    // Server time is intentionally obtained here. A collaboration request may
    // contain timestamps for auditing, but it never chooses the clock used to
    // authorize itself.
    const nowEpochMillis = DateTime.toEpochMillis(yield* DateTime.now);
    if (nowEpochMillis < issuedAtEpochMillis) {
      return yield* deny("session-not-yet-valid");
    }

    if (nowEpochMillis >= expiresAtEpochMillis) {
      return yield* deny("session-expired");
    }

    const membershipAuthority = yield* CollaborationMembershipAuthority;
    const rawMembership = yield* membershipAuthority
      .getCurrent(targetProjectId)
      .pipe(Effect.catch(() => deny("membership-unavailable")));
    const membership = yield* decodeMembershipSnapshot(rawMembership, {
      onExcessProperty: "error",
    }).pipe(Effect.catch(() => deny("membership-unavailable")));

    // A resolver returning another project's snapshot is a server-side
    // integrity failure. Treat it exactly like any other project mismatch and
    // never continue with the returned members.
    if (membership.sharedProjectId !== targetProjectId) {
      return yield* deny("project-mismatch");
    }

    if (principal.membershipEpoch !== membership.epoch) {
      return yield* deny("membership-epoch-mismatch");
    }

    const member = membership.members.find((candidate) => candidate.userId === principal.userId);
    if (!member) {
      return yield* deny("member-not-found");
    }

    if (
      !member.permissions.includes(permission) ||
      !collaborationRoleAllowsPermission(member.role, permission)
    ) {
      return yield* deny("permission-denied");
    }

    return {
      principal,
      member,
      permission,
    };
  });
}
