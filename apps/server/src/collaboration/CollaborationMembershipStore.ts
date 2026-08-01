import {
  COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS,
  COLLABORATION_MEMBERSHIP_EPOCH_MAX,
  COLLABORATION_PROJECT_MEMBER_LIMIT,
  CollaborationAuthenticatedIdentity,
  CollaborationChangeMemberRoleRequest,
  CollaborationCreateInvitationRequest,
  CollaborationInvitationGrant,
  CollaborationInvitationSecret,
  CollaborationMembershipMutationResult,
  CollaborationProjectMembershipSnapshot,
  CollaborationRedeemInvitationRequest,
  CollaborationRemoveMemberRequest,
  CollaborationRevokeInvitationRequest,
  collaborationPermissionsFitRole,
  collaborationRoleAllowsPermission,
  type CollaborationCreateInvitationResult,
  type CollaborationMembershipMutationResult as CollaborationMembershipMutationResultType,
  type CollaborationProjectMember,
  type CollaborationProjectRole,
  type SharedProjectId,
} from "@cafecode/contracts";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { CollaborationMembershipAuthorityShape } from "./CollaborationAuthorization.ts";
import {
  CollaborationMembershipAuthority,
  validateCollaborationPrincipal,
} from "./CollaborationAuthorization.ts";

export type CollaborationMembershipStoreFailureReason =
  | "invalid-input"
  | "unauthenticated"
  | "project-mismatch"
  | "membership-unavailable"
  | "membership-epoch-mismatch"
  | "permission-denied"
  | "role-ceiling-exceeded"
  | "command-conflict"
  | "invitation-not-found"
  | "invitation-not-yet-valid"
  | "invitation-expired"
  | "invitation-consumed"
  | "invitation-revoked"
  | "member-already-exists"
  | "member-not-found"
  | "member-limit-reached"
  | "epoch-exhausted"
  | "stored-corruption"
  | "storage-failure";

export class CollaborationMembershipStoreError extends Data.TaggedError(
  "CollaborationMembershipStoreError",
)<{
  readonly operation: string;
  readonly reason: CollaborationMembershipStoreFailureReason;
}> {}

export interface CollaborationMembershipStoreShape {
  readonly createInvitation: (input: {
    readonly principal: unknown;
    readonly request: unknown;
  }) => Effect.Effect<CollaborationCreateInvitationResult, CollaborationMembershipStoreError>;
  readonly redeemInvitation: (input: {
    readonly identity: unknown;
    readonly request: unknown;
  }) => Effect.Effect<CollaborationMembershipMutationResultType, CollaborationMembershipStoreError>;
  readonly revokeInvitation: (input: {
    readonly principal: unknown;
    readonly request: unknown;
  }) => Effect.Effect<CollaborationMembershipMutationResultType, CollaborationMembershipStoreError>;
  readonly changeMemberRole: (input: {
    readonly principal: unknown;
    readonly request: unknown;
  }) => Effect.Effect<CollaborationMembershipMutationResultType, CollaborationMembershipStoreError>;
  readonly removeMember: (input: {
    readonly principal: unknown;
    readonly request: unknown;
  }) => Effect.Effect<CollaborationMembershipMutationResultType, CollaborationMembershipStoreError>;
  readonly getCurrent: CollaborationMembershipAuthorityShape["getCurrent"];
}

export class CollaborationMembershipStore extends Context.Service<
  CollaborationMembershipStore,
  CollaborationMembershipStoreShape
>()("cafecode/collaboration/CollaborationMembershipStore") {}

type ProjectRow = {
  readonly sharedProjectId: string;
  readonly membershipEpoch: number;
  readonly updatedAt: string;
};

type MemberRow = {
  readonly userId: string;
  readonly displayName: string;
  readonly role: string;
  readonly permissionsJson: string;
  readonly joinedAt: string;
};

type InvitationRow = {
  readonly invitationId: string;
  readonly sharedProjectId: string;
  readonly role: string;
  readonly permissionsJson: string;
  readonly createdByUserId: string;
  readonly notBefore: string;
  readonly expiresAt: string;
  readonly redeemedAt: string | null;
  readonly redeemedByUserId: string | null;
  readonly revokedAt: string | null;
};

type ReceiptRow = {
  readonly operation: string;
  readonly inputSha256: string;
  readonly resultJson: string;
};

const roleRank: Readonly<Record<CollaborationProjectRole, number>> = {
  owner: 4,
  admin: 3,
  operator: 2,
  contributor: 1,
  viewer: 0,
};

const fail = (
  operation: string,
  reason: CollaborationMembershipStoreFailureReason,
): Effect.Effect<never, CollaborationMembershipStoreError> =>
  Effect.fail(new CollaborationMembershipStoreError({ operation, reason }));

const isoNow = (epochMillis: number): string => new Date(epochMillis).toISOString();
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const inputSha256 = (operation: string, request: unknown): string =>
  sha256(JSON.stringify([operation, request]));
const secretSha256 = (secret: string): string => sha256(`club-code/cowork-invite/v1\0${secret}`);

function isStoreError(cause: unknown): cause is CollaborationMembershipStoreError {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "CollaborationMembershipStoreError"
  );
}

const mapStorageFailure =
  (operation: string) =>
  (cause: unknown): CollaborationMembershipStoreError =>
    isStoreError(cause)
      ? cause
      : new CollaborationMembershipStoreError({ operation, reason: "storage-failure" });

const encodeAuthenticatedIdentity = Schema.encodeUnknownEffect(CollaborationAuthenticatedIdentity);
const decodeAuthenticatedIdentity = Schema.decodeUnknownEffect(CollaborationAuthenticatedIdentity);
const decodeInvitationSecret = Schema.decodeUnknownSync(CollaborationInvitationSecret);

function validateAuthenticatedIdentity(operation: string, value: unknown) {
  return encodeAuthenticatedIdentity(value, { onExcessProperty: "error" }).pipe(
    Effect.flatMap((encoded) =>
      decodeAuthenticatedIdentity(encoded, { onExcessProperty: "error" }),
    ),
    Effect.mapError(
      () => new CollaborationMembershipStoreError({ operation, reason: "invalid-input" }),
    ),
  );
}

function strictDecode<S extends Schema.Top>(
  operation: string,
  schema: S,
  value: unknown,
  reason: CollaborationMembershipStoreFailureReason = "invalid-input",
): Effect.Effect<Schema.Schema.Type<S>, CollaborationMembershipStoreError> {
  return (
    Schema.decodeUnknownEffect(schema as never)(value, {
      onExcessProperty: "error",
    }) as Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError>
  ).pipe(Effect.mapError(() => new CollaborationMembershipStoreError({ operation, reason })));
}

function parseJson(
  operation: string,
  value: string,
): Effect.Effect<unknown, CollaborationMembershipStoreError> {
  return Effect.try({
    try: () => JSON.parse(value) as unknown,
    catch: () => new CollaborationMembershipStoreError({ operation, reason: "stored-corruption" }),
  });
}

function makeStore() {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const loadSnapshot = (sharedProjectId: SharedProjectId, operation = "membership.get-current") =>
      Effect.gen(function* () {
        const projects = yield* sql<ProjectRow>`
          SELECT
            shared_project_id AS "sharedProjectId",
            membership_epoch AS "membershipEpoch",
            updated_at AS "updatedAt"
          FROM collaboration_projects
          WHERE shared_project_id = ${sharedProjectId}
        `;
        const project = projects[0];
        if (!project) {
          return yield* fail(operation, "membership-unavailable");
        }
        const rows = yield* sql<MemberRow>`
          SELECT
            user_id AS "userId",
            display_name AS "displayName",
            role,
            permissions_json AS "permissionsJson",
            joined_at AS "joinedAt"
          FROM collaboration_project_members
          WHERE shared_project_id = ${sharedProjectId}
          ORDER BY joined_at, user_id
          LIMIT ${COLLABORATION_PROJECT_MEMBER_LIMIT + 1}
        `;
        if (rows.length > COLLABORATION_PROJECT_MEMBER_LIMIT) {
          return yield* fail(operation, "stored-corruption");
        }
        const members: Array<unknown> = [];
        for (const row of rows) {
          members.push({
            userId: row.userId,
            displayName: row.displayName,
            role: row.role,
            permissions: yield* parseJson(operation, row.permissionsJson),
            joinedAt: row.joinedAt,
          });
        }
        return yield* strictDecode(
          operation,
          CollaborationProjectMembershipSnapshot,
          {
            sharedProjectId: project.sharedProjectId,
            epoch: project.membershipEpoch,
            members,
            updatedAt: project.updatedAt,
          },
          "stored-corruption",
        );
      });

    const authorizeManager = (
      operation: string,
      principalInput: unknown,
      sharedProjectId: SharedProjectId,
      now: number,
    ) =>
      Effect.gen(function* () {
        const principal = yield* validateCollaborationPrincipal(principalInput).pipe(
          Effect.mapError(
            () => new CollaborationMembershipStoreError({ operation, reason: "invalid-input" }),
          ),
        );
        if (principal.sharedProjectId !== sharedProjectId) {
          return yield* fail(operation, "project-mismatch");
        }
        const issuedAt = DateTime.toEpochMillis(principal.issuedAt);
        const expiresAt = DateTime.toEpochMillis(principal.expiresAt);
        if (
          now < issuedAt ||
          now >= expiresAt ||
          expiresAt - issuedAt > COLLABORATION_ACCESS_SESSION_MAX_LIFETIME_MILLIS
        ) {
          return yield* fail(operation, "unauthenticated");
        }
        const snapshot = yield* loadSnapshot(sharedProjectId, operation);
        if (principal.membershipEpoch !== snapshot.epoch) {
          return yield* fail(operation, "membership-epoch-mismatch");
        }
        const member = snapshot.members.find((candidate) => candidate.userId === principal.userId);
        if (
          !member ||
          (member.role !== "owner" && member.role !== "admin") ||
          !member.permissions.includes("project.manage-members") ||
          !collaborationRoleAllowsPermission(member.role, "project.manage-members")
        ) {
          return yield* fail(operation, "permission-denied");
        }
        return { principal, member, snapshot };
      });

    const validateGrantCeiling = (
      operation: string,
      manager: CollaborationProjectMember,
      role: CollaborationProjectRole,
      permissions: ReadonlyArray<(typeof manager.permissions)[number]>,
    ) => {
      if (
        role === "owner" ||
        roleRank[role] >= roleRank[manager.role] ||
        !collaborationPermissionsFitRole(role, permissions) ||
        !permissions.every((permission) => manager.permissions.includes(permission))
      ) {
        return fail(operation, "role-ceiling-exceeded");
      }
      return Effect.void;
    };

    const getReceipt = (sharedProjectId: SharedProjectId, commandId: string) =>
      sql<ReceiptRow>`
        SELECT operation, input_sha256 AS "inputSha256", result_json AS "resultJson"
        FROM collaboration_membership_command_receipts
        WHERE shared_project_id = ${sharedProjectId} AND command_id = ${commandId}
      `.pipe(Effect.map((rows) => rows[0]));

    const requireMatchingReceipt = (operation: string, receipt: ReceiptRow, expectedHash: string) =>
      receipt.operation === operation && receipt.inputSha256 === expectedHash
        ? Effect.void
        : fail(operation, "command-conflict");

    const requireOneChangedRow = (operation: string) =>
      Effect.gen(function* () {
        const rows = yield* sql<{ readonly count: number }>`SELECT changes() AS count`;
        if (rows[0]?.count !== 1) {
          return yield* fail(operation, "stored-corruption");
        }
      });

    const storeReceipt = (
      sharedProjectId: SharedProjectId,
      commandId: string,
      operation: string,
      hash: string,
      result: unknown,
      nowIso: string,
    ) =>
      sql`
        INSERT INTO collaboration_membership_command_receipts(
          shared_project_id, command_id, operation, input_sha256, result_json, created_at
        ) VALUES (
          ${sharedProjectId}, ${commandId}, ${operation}, ${hash}, ${JSON.stringify(result)}, ${nowIso}
        )
      `;

    const decodeStoredMutation = (operation: string, receipt: ReceiptRow) =>
      Effect.gen(function* () {
        const parsed = yield* parseJson(operation, receipt.resultJson);
        const result = yield* strictDecode(
          operation,
          CollaborationMembershipMutationResult,
          { ...(parsed as object), disposition: "already-applied" },
          "stored-corruption",
        );
        return result;
      });

    const createInvitation: CollaborationMembershipStoreShape["createInvitation"] = (input) => {
      const operation = "invitation.create";
      return Effect.gen(function* () {
        const request = yield* strictDecode(
          operation,
          CollaborationCreateInvitationRequest,
          input.request,
        );
        const hash = inputSha256(operation, request);
        const secret = decodeInvitationSecret(randomBytes(32).toString("base64url"));
        const digest = secretSha256(secret);
        const invitationId = `invite-${randomUUID()}`;
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const nowIso = isoNow(now);
        const notBefore = isoNow(now + request.notBeforeDelayMillis);
        const expiresAt = isoNow(now + request.notBeforeDelayMillis + request.lifetimeMillis);

        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const manager = yield* authorizeManager(
              operation,
              input.principal,
              request.sharedProjectId,
              now,
            );
            const receipt = yield* getReceipt(request.sharedProjectId, request.commandId);
            if (receipt) {
              yield* requireMatchingReceipt(operation, receipt, hash);
              const stored = yield* parseJson(operation, receipt.resultJson);
              const invitation = yield* strictDecode(
                operation,
                CollaborationInvitationGrant,
                stored,
                "stored-corruption",
              );
              return { disposition: "already-applied", invitation, secret: null } as const;
            }
            yield* validateGrantCeiling(
              operation,
              manager.member,
              request.role,
              request.permissions,
            );
            const encodedInvitation = {
              invitationId,
              sharedProjectId: request.sharedProjectId,
              role: request.role,
              permissions: request.permissions,
              createdByUserId: manager.principal.userId,
              notBefore,
              expiresAt,
            };
            const invitation = yield* strictDecode(
              operation,
              CollaborationInvitationGrant,
              encodedInvitation,
            );
            yield* sql`
              INSERT INTO collaboration_project_invitations(
                invitation_id, shared_project_id, secret_sha256, role, permissions_json,
                created_by_user_id, created_at, not_before, expires_at
              ) VALUES (
                ${invitationId}, ${request.sharedProjectId}, ${digest}, ${request.role},
                ${JSON.stringify(request.permissions)}, ${manager.principal.userId}, ${nowIso},
                ${notBefore}, ${expiresAt}
              )
            `;
            yield* storeReceipt(
              request.sharedProjectId,
              request.commandId,
              operation,
              hash,
              encodedInvitation,
              nowIso,
            );
            return { disposition: "created", invitation, secret } as const;
          }),
        );
      }).pipe(Effect.mapError(mapStorageFailure(operation)));
    };

    const redeemInvitation: CollaborationMembershipStoreShape["redeemInvitation"] = (input) => {
      const operation = "invitation.redeem";
      return Effect.gen(function* () {
        const request = yield* strictDecode(
          operation,
          CollaborationRedeemInvitationRequest,
          input.request,
        );
        const identity = yield* validateAuthenticatedIdentity(operation, input.identity);
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const issuedAt = DateTime.toEpochMillis(identity.issuedAt);
        const identityExpiresAt = DateTime.toEpochMillis(identity.expiresAt);
        if (now < issuedAt || now >= identityExpiresAt) {
          return yield* fail(operation, "unauthenticated");
        }
        const hash = inputSha256(operation, {
          ...request,
          // Bind idempotency to the authenticated redeemer without persisting
          // the invitation capability in a command receipt.
          secret: secretSha256(request.secret),
          userId: identity.userId,
          deviceId: identity.deviceId,
        });
        const digest = secretSha256(request.secret);
        const nowIso = isoNow(now);

        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const receipt = yield* getReceipt(request.sharedProjectId, request.commandId);
            if (receipt) {
              yield* requireMatchingReceipt(operation, receipt, hash);
              return yield* decodeStoredMutation(operation, receipt);
            }
            const invites = yield* sql<InvitationRow>`
              SELECT invitation_id AS "invitationId", shared_project_id AS "sharedProjectId",
                role, permissions_json AS "permissionsJson",
                created_by_user_id AS "createdByUserId", not_before AS "notBefore",
                expires_at AS "expiresAt", redeemed_at AS "redeemedAt",
                redeemed_by_user_id AS "redeemedByUserId", revoked_at AS "revokedAt"
              FROM collaboration_project_invitations
              WHERE secret_sha256 = ${digest}
            `;
            const row = invites[0];
            if (!row) return yield* fail(operation, "invitation-not-found");
            if (row.sharedProjectId !== request.sharedProjectId) {
              return yield* fail(operation, "project-mismatch");
            }
            const permissions = yield* parseJson(operation, row.permissionsJson);
            const invitation = yield* strictDecode(
              operation,
              CollaborationInvitationGrant,
              {
                invitationId: row.invitationId,
                sharedProjectId: row.sharedProjectId,
                role: row.role,
                permissions,
                createdByUserId: row.createdByUserId,
                notBefore: row.notBefore,
                expiresAt: row.expiresAt,
              },
              "stored-corruption",
            );
            if (
              invitation.role === "owner" ||
              !collaborationPermissionsFitRole(invitation.role, invitation.permissions)
            ) {
              return yield* fail(operation, "stored-corruption");
            }
            if (row.revokedAt !== null) return yield* fail(operation, "invitation-revoked");
            if (row.redeemedAt !== null) return yield* fail(operation, "invitation-consumed");
            const notBeforeMillis = DateTime.toEpochMillis(invitation.notBefore);
            const expiresAtMillis = DateTime.toEpochMillis(invitation.expiresAt);
            if (now < notBeforeMillis) return yield* fail(operation, "invitation-not-yet-valid");
            if (now >= expiresAtMillis) return yield* fail(operation, "invitation-expired");
            const snapshot = yield* loadSnapshot(request.sharedProjectId, operation);
            if (snapshot.members.length >= COLLABORATION_PROJECT_MEMBER_LIMIT) {
              return yield* fail(operation, "member-limit-reached");
            }
            if (snapshot.epoch >= COLLABORATION_MEMBERSHIP_EPOCH_MAX) {
              return yield* fail(operation, "epoch-exhausted");
            }
            if (snapshot.members.some((member) => member.userId === identity.userId)) {
              return yield* fail(operation, "member-already-exists");
            }
            yield* sql`
              UPDATE collaboration_project_invitations
              SET redeemed_at = ${nowIso}, redeemed_by_user_id = ${identity.userId}
              WHERE invitation_id = ${invitation.invitationId}
                AND redeemed_at IS NULL AND revoked_at IS NULL
            `;
            const changes = yield* sql<{ readonly count: number }>`
              SELECT changes() AS count
            `;
            if (changes[0]?.count !== 1) return yield* fail(operation, "invitation-consumed");
            yield* sql`
              INSERT INTO collaboration_project_members(
                shared_project_id, user_id, display_name, role, permissions_json, joined_at
              ) VALUES (
                ${request.sharedProjectId}, ${identity.userId}, ${request.displayName},
                ${invitation.role}, ${JSON.stringify(invitation.permissions)}, ${nowIso}
              )
            `;
            const nextEpoch = snapshot.epoch + 1;
            yield* sql`
              UPDATE collaboration_projects
              SET membership_epoch = ${nextEpoch}, updated_at = ${nowIso}
              WHERE shared_project_id = ${request.sharedProjectId}
                AND membership_epoch = ${snapshot.epoch}
            `;
            yield* requireOneChangedRow(operation);
            const member = {
              userId: identity.userId,
              displayName: request.displayName,
              role: invitation.role,
              permissions: invitation.permissions,
              joinedAt: nowIso,
            } satisfies CollaborationProjectMember;
            const storedResult = { member, membershipEpoch: nextEpoch };
            yield* storeReceipt(
              request.sharedProjectId,
              request.commandId,
              operation,
              hash,
              storedResult,
              nowIso,
            );
            return yield* strictDecode(operation, CollaborationMembershipMutationResult, {
              disposition: "applied",
              ...storedResult,
            });
          }),
        );
      }).pipe(Effect.mapError(mapStorageFailure(operation)));
    };

    const revokeInvitation: CollaborationMembershipStoreShape["revokeInvitation"] = (input) => {
      const operation = "invitation.revoke";
      return Effect.gen(function* () {
        const request = yield* strictDecode(
          operation,
          CollaborationRevokeInvitationRequest,
          input.request,
        );
        const hash = inputSha256(operation, request);
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const nowIso = isoNow(now);
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const manager = yield* authorizeManager(
              operation,
              input.principal,
              request.sharedProjectId,
              now,
            );
            const receipt = yield* getReceipt(request.sharedProjectId, request.commandId);
            if (receipt) {
              yield* requireMatchingReceipt(operation, receipt, hash);
              return yield* decodeStoredMutation(operation, receipt);
            }
            const rows = yield* sql<InvitationRow>`
              SELECT invitation_id AS "invitationId", shared_project_id AS "sharedProjectId",
                role, permissions_json AS "permissionsJson",
                created_by_user_id AS "createdByUserId", not_before AS "notBefore",
                expires_at AS "expiresAt", redeemed_at AS "redeemedAt",
                redeemed_by_user_id AS "redeemedByUserId", revoked_at AS "revokedAt"
              FROM collaboration_project_invitations
              WHERE invitation_id = ${request.invitationId}
            `;
            const invite = rows[0];
            if (!invite || invite.sharedProjectId !== request.sharedProjectId) {
              return yield* fail(operation, "invitation-not-found");
            }
            const invitePermissions = yield* parseJson(operation, invite.permissionsJson);
            const storedInvitation = yield* strictDecode(
              operation,
              CollaborationInvitationGrant,
              {
                invitationId: invite.invitationId,
                sharedProjectId: invite.sharedProjectId,
                role: invite.role,
                permissions: invitePermissions,
                createdByUserId: invite.createdByUserId,
                notBefore: invite.notBefore,
                expiresAt: invite.expiresAt,
              },
              "stored-corruption",
            );
            if (
              storedInvitation.role === "owner" ||
              !collaborationPermissionsFitRole(
                storedInvitation.role,
                storedInvitation.permissions,
              ) ||
              roleRank[storedInvitation.role] >= roleRank[manager.member.role]
            ) {
              return yield* fail(operation, "role-ceiling-exceeded");
            }
            if (invite.redeemedAt !== null) return yield* fail(operation, "invitation-consumed");
            yield* sql`
              UPDATE collaboration_project_invitations
              SET revoked_at = COALESCE(revoked_at, ${nowIso})
              WHERE invitation_id = ${request.invitationId}
            `;
            const storedResult = {
              member: null,
              membershipEpoch: manager.snapshot.epoch,
            };
            yield* storeReceipt(
              request.sharedProjectId,
              request.commandId,
              operation,
              hash,
              storedResult,
              nowIso,
            );
            return yield* strictDecode(operation, CollaborationMembershipMutationResult, {
              disposition: "applied",
              ...storedResult,
            });
          }),
        );
      }).pipe(Effect.mapError(mapStorageFailure(operation)));
    };

    const changeMemberRole: CollaborationMembershipStoreShape["changeMemberRole"] = (input) => {
      const operation = "member.change-role";
      return Effect.gen(function* () {
        const request = yield* strictDecode(
          operation,
          CollaborationChangeMemberRoleRequest,
          input.request,
        );
        const hash = inputSha256(operation, request);
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const nowIso = isoNow(now);
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const manager = yield* authorizeManager(
              operation,
              input.principal,
              request.sharedProjectId,
              now,
            );
            const receipt = yield* getReceipt(request.sharedProjectId, request.commandId);
            if (receipt) {
              yield* requireMatchingReceipt(operation, receipt, hash);
              return yield* decodeStoredMutation(operation, receipt);
            }
            const target = manager.snapshot.members.find(
              (member) => member.userId === request.userId,
            );
            if (!target) return yield* fail(operation, "member-not-found");
            if (
              target.userId === manager.principal.userId ||
              roleRank[target.role] >= roleRank[manager.member.role]
            ) {
              return yield* fail(operation, "role-ceiling-exceeded");
            }
            yield* validateGrantCeiling(
              operation,
              manager.member,
              request.role,
              request.permissions,
            );
            if (manager.snapshot.epoch >= COLLABORATION_MEMBERSHIP_EPOCH_MAX) {
              return yield* fail(operation, "epoch-exhausted");
            }
            yield* sql`
              UPDATE collaboration_project_members
              SET role = ${request.role}, permissions_json = ${JSON.stringify(request.permissions)}
              WHERE shared_project_id = ${request.sharedProjectId} AND user_id = ${request.userId}
            `;
            yield* requireOneChangedRow(operation);
            const nextEpoch = manager.snapshot.epoch + 1;
            yield* sql`
              UPDATE collaboration_projects
              SET membership_epoch = ${nextEpoch}, updated_at = ${nowIso}
              WHERE shared_project_id = ${request.sharedProjectId}
                AND membership_epoch = ${manager.snapshot.epoch}
            `;
            yield* requireOneChangedRow(operation);
            const member = { ...target, role: request.role, permissions: request.permissions };
            const storedResult = { member, membershipEpoch: nextEpoch };
            yield* storeReceipt(
              request.sharedProjectId,
              request.commandId,
              operation,
              hash,
              storedResult,
              nowIso,
            );
            return yield* strictDecode(operation, CollaborationMembershipMutationResult, {
              disposition: "applied",
              ...storedResult,
            });
          }),
        );
      }).pipe(Effect.mapError(mapStorageFailure(operation)));
    };

    const removeMember: CollaborationMembershipStoreShape["removeMember"] = (input) => {
      const operation = "member.remove";
      return Effect.gen(function* () {
        const request = yield* strictDecode(
          operation,
          CollaborationRemoveMemberRequest,
          input.request,
        );
        const hash = inputSha256(operation, request);
        const now = DateTime.toEpochMillis(yield* DateTime.now);
        const nowIso = isoNow(now);
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const manager = yield* authorizeManager(
              operation,
              input.principal,
              request.sharedProjectId,
              now,
            );
            const receipt = yield* getReceipt(request.sharedProjectId, request.commandId);
            if (receipt) {
              yield* requireMatchingReceipt(operation, receipt, hash);
              return yield* decodeStoredMutation(operation, receipt);
            }
            const target = manager.snapshot.members.find(
              (member) => member.userId === request.userId,
            );
            if (!target) return yield* fail(operation, "member-not-found");
            if (
              target.userId === manager.principal.userId ||
              roleRank[target.role] >= roleRank[manager.member.role]
            ) {
              return yield* fail(operation, "role-ceiling-exceeded");
            }
            if (manager.snapshot.epoch >= COLLABORATION_MEMBERSHIP_EPOCH_MAX) {
              return yield* fail(operation, "epoch-exhausted");
            }
            yield* sql`
              DELETE FROM collaboration_project_members
              WHERE shared_project_id = ${request.sharedProjectId} AND user_id = ${request.userId}
            `;
            yield* requireOneChangedRow(operation);
            const nextEpoch = manager.snapshot.epoch + 1;
            yield* sql`
              UPDATE collaboration_projects
              SET membership_epoch = ${nextEpoch}, updated_at = ${nowIso}
              WHERE shared_project_id = ${request.sharedProjectId}
                AND membership_epoch = ${manager.snapshot.epoch}
            `;
            yield* requireOneChangedRow(operation);
            const storedResult = { member: null, membershipEpoch: nextEpoch };
            yield* storeReceipt(
              request.sharedProjectId,
              request.commandId,
              operation,
              hash,
              storedResult,
              nowIso,
            );
            return yield* strictDecode(operation, CollaborationMembershipMutationResult, {
              disposition: "applied",
              ...storedResult,
            });
          }),
        );
      }).pipe(Effect.mapError(mapStorageFailure(operation)));
    };

    const getCurrent: CollaborationMembershipStoreShape["getCurrent"] = (sharedProjectId) =>
      sql
        .withTransaction(loadSnapshot(sharedProjectId))
        .pipe(Effect.mapError(mapStorageFailure("membership.get-current")));

    return {
      createInvitation,
      redeemInvitation,
      revokeInvitation,
      changeMemberRole,
      removeMember,
      getCurrent,
    } satisfies CollaborationMembershipStoreShape;
  });
}

export const CollaborationMembershipStoreLive = Layer.effect(
  CollaborationMembershipStore,
  makeStore(),
);

/** Provides the existing event/command authorization boundary from this store. */
export const CollaborationMembershipAuthorityFromStore = Layer.effect(
  CollaborationMembershipAuthority,
  Effect.map(Effect.service(CollaborationMembershipStore), (store) => ({
    getCurrent: store.getCurrent,
  })),
);
