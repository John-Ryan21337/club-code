import {
  CollaborationMembershipAuthority,
  authorizeCollaborationPermission,
} from "./CollaborationAuthorization.ts";
import {
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationAuthenticatedIdentity,
  CollaborationPrincipal,
  SharedProjectId,
} from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  CollaborationMembershipStore,
  CollaborationMembershipStoreError,
  CollaborationMembershipStoreLive,
} from "./CollaborationMembershipStore.ts";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeIdentity = Schema.decodeUnknownSync(CollaborationAuthenticatedIdentity);

const layer = CollaborationMembershipStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));

function isStoreError(
  value: unknown,
  reason: CollaborationMembershipStoreError["reason"],
): boolean {
  return value instanceof CollaborationMembershipStoreError && value.reason === reason;
}

function principal(project: string, userId = "owner-1", epoch = 1) {
  return decodePrincipal({
    sessionId: `session-${userId}`,
    sharedProjectId: project,
    userId,
    deviceId: `device-${userId}`,
    membershipEpoch: epoch,
    issuedAt: "2026-08-01T11:30:00.000Z",
    expiresAt: "2026-08-01T12:30:00.000Z",
  });
}

function identity(userId: string) {
  return decodeIdentity({
    sessionId: `session-${userId}`,
    userId,
    deviceId: `device-${userId}`,
    issuedAt: "2026-08-01T11:30:00.000Z",
    expiresAt: "2026-08-01T12:30:00.000Z",
  });
}

function seedProject(
  project: string,
  members: ReadonlyArray<{
    readonly userId: string;
    readonly role: "owner" | "admin" | "operator" | "contributor" | "viewer";
  }> = [{ userId: "owner-1", role: "owner" }],
) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO collaboration_projects(shared_project_id, membership_epoch, updated_at)
      VALUES (${project}, 1, ${"2026-08-01T11:00:00.000Z"})
    `;
    for (const member of members) {
      yield* sql`
        INSERT INTO collaboration_project_members(
          shared_project_id, user_id, display_name, role, permissions_json, joined_at
        ) VALUES (
          ${project}, ${member.userId}, ${member.userId}, ${member.role},
          ${JSON.stringify(COLLABORATION_ROLE_PERMISSIONS[member.role])},
          ${"2026-08-01T11:00:00.000Z"}
        )
      `;
    }
  });
}

function createRequest(project: string, commandId = "command-create-1") {
  return {
    commandId,
    sharedProjectId: project,
    role: "contributor" as const,
    permissions: [...COLLABORATION_ROLE_PERMISSIONS.contributor],
    notBeforeDelayMillis: 0,
    lifetimeMillis: 60_000,
  };
}

describe("CollaborationMembershipStore", () => {
  it.effect("stores only an invite digest and replays creation without recovering the secret", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-replay");
      const store = yield* CollaborationMembershipStore;
      const request = createRequest("project-replay");
      const first = yield* store.createInvitation({
        principal: principal("project-replay"),
        request,
      });
      const replay = yield* store.createInvitation({
        principal: principal("project-replay"),
        request,
      });

      assert.equal(first.disposition, "created");
      assert.equal(first.secret?.length, 43);
      assert.equal(replay.disposition, "already-applied");
      assert.equal(replay.secret, null);
      assert.equal(replay.invitation.invitationId, first.invitation.invitationId);

      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly secretSha256: string }>`
        SELECT secret_sha256 AS "secretSha256" FROM collaboration_project_invitations
      `;
      assert.match(rows[0]!.secretSha256, /^[a-f0-9]{64}$/);
      assert.notEqual(rows[0]!.secretSha256, first.secret);
      const count = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM collaboration_project_invitations
      `;
      assert.equal(count[0]!.count, 1);

      const conflict = yield* store
        .createInvitation({
          principal: principal("project-replay"),
          request: {
            ...request,
            permissions: [...COLLABORATION_ROLE_PERMISSIONS.viewer],
          },
        })
        .pipe(Effect.flip);
      assert.equal(isStoreError(conflict, "command-conflict"), true);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects expired and not-yet-valid invitations using the server clock", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-time");
      const store = yield* CollaborationMembershipStore;
      const delayed = yield* store.createInvitation({
        principal: principal("project-time"),
        request: { ...createRequest("project-time"), notBeforeDelayMillis: 60_000 },
      });
      const tooEarly = yield* store
        .redeemInvitation({
          identity: identity("user-early"),
          request: {
            commandId: "redeem-early",
            sharedProjectId: "project-time",
            secret: delayed.secret,
            displayName: "Early",
          },
        })
        .pipe(Effect.flip);
      assert.equal(isStoreError(tooEarly, "invitation-not-yet-valid"), true);

      const immediate = yield* store.createInvitation({
        principal: principal("project-time"),
        request: createRequest("project-time", "command-create-expiry"),
      });
      yield* TestClock.adjust("60 seconds");
      const expired = yield* store
        .redeemInvitation({
          identity: identity("user-expired"),
          request: {
            commandId: "redeem-expired",
            sharedProjectId: "project-time",
            secret: immediate.secret,
            displayName: "Expired",
          },
        })
        .pipe(Effect.flip);
      assert.equal(isStoreError(expired, "invitation-expired"), true);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects project mismatch and privilege escalation", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-a", [
        { userId: "owner-1", role: "owner" },
        { userId: "admin-1", role: "admin" },
      ]);
      yield* seedProject("project-b");
      const store = yield* CollaborationMembershipStore;
      const invitation = yield* store.createInvitation({
        principal: principal("project-a"),
        request: createRequest("project-a"),
      });
      const mismatch = yield* store
        .redeemInvitation({
          identity: identity("user-1"),
          request: {
            commandId: "redeem-mismatch",
            sharedProjectId: "project-b",
            secret: invitation.secret,
            displayName: "User",
          },
        })
        .pipe(Effect.flip);
      assert.equal(isStoreError(mismatch, "project-mismatch"), true);

      const escalation = yield* store
        .createInvitation({
          principal: principal("project-a", "admin-1"),
          request: {
            ...createRequest("project-a", "create-admin"),
            role: "admin",
            permissions: [...COLLABORATION_ROLE_PERMISSIONS.admin],
          },
        })
        .pipe(Effect.flip);
      assert.equal(isStoreError(escalation, "role-ceiling-exceeded"), true);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("atomically permits only one concurrent redemption", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-race");
      const store = yield* CollaborationMembershipStore;
      const invitation = yield* store.createInvitation({
        principal: principal("project-race"),
        request: createRequest("project-race"),
      });
      const attempts = yield* Effect.all(
        ["racer-1", "racer-2"].map((userId) =>
          Effect.exit(
            store.redeemInvitation({
              identity: identity(userId),
              request: {
                commandId: `redeem-${userId}`,
                sharedProjectId: "project-race",
                secret: invitation.secret,
                displayName: userId,
              },
            }),
          ),
        ),
        { concurrency: "unbounded" },
      );
      assert.equal(attempts.filter((attempt) => attempt._tag === "Success").length, 1);
      assert.equal(attempts.filter((attempt) => attempt._tag === "Failure").length, 1);
      const snapshot = yield* store.getCurrent(decodeProjectId("project-race"));
      assert.equal(snapshot.epoch, 2);
      assert.equal(snapshot.members.length, 2);
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "revokes invitations and increments the membership epoch on add, role change and removal",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        yield* seedProject("project-revoke");
        const store = yield* CollaborationMembershipStore;
        const revoked = yield* store.createInvitation({
          principal: principal("project-revoke"),
          request: createRequest("project-revoke", "create-revoked"),
        });
        yield* store.revokeInvitation({
          principal: principal("project-revoke"),
          request: {
            commandId: "revoke-invite",
            sharedProjectId: "project-revoke",
            invitationId: revoked.invitation.invitationId,
          },
        });
        const denied = yield* store
          .redeemInvitation({
            identity: identity("revoked-user"),
            request: {
              commandId: "redeem-revoked",
              sharedProjectId: "project-revoke",
              secret: revoked.secret,
              displayName: "Revoked",
            },
          })
          .pipe(Effect.flip);
        assert.equal(isStoreError(denied, "invitation-revoked"), true);

        const active = yield* store.createInvitation({
          principal: principal("project-revoke"),
          request: createRequest("project-revoke", "create-active"),
        });
        const added = yield* store.redeemInvitation({
          identity: identity("member-1"),
          request: {
            commandId: "redeem-active",
            sharedProjectId: "project-revoke",
            secret: active.secret,
            displayName: "Member One",
          },
        });
        assert.equal(added.membershipEpoch, 2);
        const memberPrincipalAtEpochTwo = principal("project-revoke", "member-1", 2);
        const authorizedBeforeRoleChange = yield* authorizeCollaborationPermission({
          principal: memberPrincipalAtEpochTwo,
          targetProjectId: decodeProjectId("project-revoke"),
          permission: "transcript.append",
        }).pipe(
          Effect.provideService(CollaborationMembershipAuthority, {
            getCurrent: store.getCurrent,
          }),
        );
        assert.equal(authorizedBeforeRoleChange.member.userId, "member-1");
        const changed = yield* store.changeMemberRole({
          principal: principal("project-revoke", "owner-1", 2),
          request: {
            commandId: "change-member",
            sharedProjectId: "project-revoke",
            userId: "member-1",
            role: "viewer",
            permissions: [...COLLABORATION_ROLE_PERMISSIONS.viewer],
          },
        });
        assert.equal(changed.membershipEpoch, 3);
        const staleAfterRoleChange = yield* authorizeCollaborationPermission({
          principal: memberPrincipalAtEpochTwo,
          targetProjectId: decodeProjectId("project-revoke"),
          permission: "transcript.append",
        }).pipe(
          Effect.provideService(CollaborationMembershipAuthority, {
            getCurrent: store.getCurrent,
          }),
          Effect.flip,
        );
        assert.equal(staleAfterRoleChange.reason, "membership-epoch-mismatch");
        const removed = yield* store.removeMember({
          principal: principal("project-revoke", "owner-1", 3),
          request: {
            commandId: "remove-member",
            sharedProjectId: "project-revoke",
            userId: "member-1",
          },
        });
        assert.equal(removed.membershipEpoch, 4);
        const replay = yield* store.removeMember({
          principal: principal("project-revoke", "owner-1", 4),
          request: {
            commandId: "remove-member",
            sharedProjectId: "project-revoke",
            userId: "member-1",
          },
        });
        assert.equal(replay.disposition, "already-applied");
        assert.equal(replay.membershipEpoch, 4);
      }).pipe(Effect.provide(layer)),
  );

  it.effect("fails closed when persisted membership or invitation data is corrupt", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-corrupt");
      const store = yield* CollaborationMembershipStore;
      const invitation = yield* store.createInvitation({
        principal: principal("project-corrupt"),
        request: createRequest("project-corrupt"),
      });
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE collaboration_project_invitations
        SET permissions_json = ${"not-json"}
        WHERE invitation_id = ${invitation.invitation.invitationId}
      `;
      const corruptInvite = yield* store
        .redeemInvitation({
          identity: identity("user-corrupt"),
          request: {
            commandId: "redeem-corrupt",
            sharedProjectId: "project-corrupt",
            secret: invitation.secret,
            displayName: "Corrupt",
          },
        })
        .pipe(Effect.flip);
      assert.equal(isStoreError(corruptInvite, "stored-corruption"), true);

      yield* sql`
        UPDATE collaboration_project_members
        SET permissions_json = ${"{}"}
        WHERE shared_project_id = ${"project-corrupt"} AND user_id = ${"owner-1"}
      `;
      const corruptSnapshot = yield* store
        .getCurrent(decodeProjectId("project-corrupt"))
        .pipe(Effect.flip);
      assert.equal(isStoreError(corruptSnapshot, "stored-corruption"), true);
    }).pipe(Effect.provide(layer)),
  );
});
