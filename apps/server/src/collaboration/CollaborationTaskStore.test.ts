import {
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationCreateTaskCommand,
  CollaborationPrincipal,
  CollaborationProjectMembershipSnapshot,
  CollaborationTaskMutationCommand,
  CollaborationTaskHistoryRequest,
  CollaborationTaskReadRequest,
  SharedProjectId,
} from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import { CollaborationMembershipAuthority } from "./CollaborationAuthorization.ts";
import { CollaborationDeviceKeyAuthority } from "./CollaborationEventAdmission.ts";
import {
  CollaborationTaskStore,
  CollaborationTaskStoreError,
  CollaborationTaskStoreLive,
} from "./CollaborationTaskStore.ts";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const projectId = Schema.decodeUnknownSync(SharedProjectId)("project-task-store");
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeCreate = Schema.decodeUnknownSync(CollaborationCreateTaskCommand);
const encodeCreate = Schema.encodeUnknownSync(CollaborationCreateTaskCommand);
const decodeMutation = Schema.decodeUnknownSync(CollaborationTaskMutationCommand);
const decodeRead = Schema.decodeUnknownSync(CollaborationTaskReadRequest);
const decodeHistory = Schema.decodeUnknownSync(CollaborationTaskHistoryRequest);
const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const first = decodePrincipal({
  sessionId: "session-task-1",
  sharedProjectId: projectId,
  userId: "user-1",
  deviceId: "device-1",
  membershipEpoch: 1,
  issuedAt: "2026-08-01T11:30:00.000Z",
  expiresAt: "2026-08-01T12:30:00.000Z",
});
const second = decodePrincipal({
  sessionId: "session-task-2",
  sharedProjectId: projectId,
  userId: "user-2",
  deviceId: "device-2",
  membershipEpoch: 1,
  issuedAt: "2026-08-01T11:30:00.000Z",
  expiresAt: "2026-08-01T12:30:00.000Z",
});
const membership = decodeMembership({
  sharedProjectId: projectId,
  epoch: 1,
  members: [
    {
      userId: "user-1",
      displayName: "One",
      role: "owner",
      permissions: [...COLLABORATION_ROLE_PERMISSIONS.owner],
      joinedAt: "2026-08-01T11:00:00.000Z",
    },
    {
      userId: "user-2",
      displayName: "Two",
      role: "operator",
      permissions: [...COLLABORATION_ROLE_PERMISSIONS.operator],
      joinedAt: "2026-08-01T11:00:00.000Z",
    },
  ],
  updatedAt: "2026-08-01T11:00:00.000Z",
});
const authorities = Layer.merge(
  Layer.succeed(CollaborationMembershipAuthority, { getCurrent: () => Effect.succeed(membership) }),
  Layer.succeed(CollaborationDeviceKeyAuthority, {
    getActiveEd25519PublicKey: (lookup) =>
      Effect.succeed({ ...lookup, publicKeySpkiDer: new Uint8Array(44) }),
  }),
);
const layer = Layer.merge(
  CollaborationTaskStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  authorities,
);
const create = (taskId: string, commandId: string, dependencies: ReadonlyArray<string> = []) =>
  decodeCreate({
    sharedProjectId: projectId,
    commandId,
    deviceKeyId: "key-1",
    kind: "create",
    taskId,
    provenance: "operator-authored",
    title: `Task ${taskId}`,
    body: "Operator-authored bounded work.",
    dependencies,
  });
const mutate = (value: Record<string, unknown>) =>
  decodeMutation({ sharedProjectId: projectId, deviceKeyId: "key-1", ...value });
const expectFailure = (value: unknown, reason: CollaborationTaskStoreError["reason"]) => {
  assert.instanceOf(value, CollaborationTaskStoreError);
  assert.equal((value as CollaborationTaskStoreError).reason, reason);
};
const seed = Effect.gen(function* () {
  yield* runMigrations();
  const sql = yield* SqlClient.SqlClient;
  yield* sql`INSERT INTO collaboration_projects(shared_project_id,membership_epoch,updated_at) VALUES(${projectId},1,'2026-08-01T11:00:00.000Z')`;
  for (const [userId, role, permissions] of [
    ["user-1", "owner", COLLABORATION_ROLE_PERMISSIONS.owner],
    ["user-2", "operator", COLLABORATION_ROLE_PERMISSIONS.operator],
  ] as const) {
    yield* sql`INSERT INTO collaboration_project_members(shared_project_id,user_id,display_name,role,permissions_json,joined_at)
      VALUES(${projectId},${userId},${userId},${role},${JSON.stringify(permissions)},'2026-08-01T11:00:00.000Z')`;
  }
});

describe("CollaborationTaskStore", () => {
  it.effect("enforces CAS, cycles, fenced leases, audit replay, and corruption checks", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seed;
      const store = yield* CollaborationTaskStore;
      const created = yield* store.create({
        principal: first,
        command: create("task-a", "create-a"),
      });
      const replay = yield* store.create({
        principal: first,
        command: create("task-a", "create-a"),
      });
      assert.equal(replay.eventSha256, created.eventSha256);
      yield* store.create({ principal: first, command: create("task-b", "create-b", ["task-a"]) });
      const cycle = yield* store
        .mutate({
          principal: first,
          command: mutate({
            kind: "set-dependencies",
            commandId: "cycle-a",
            taskId: "task-a",
            expectedRevision: 1,
            dependencies: ["task-b"],
          }),
        })
        .pipe(
          Effect.match({
            onFailure: (error) => ({ kind: "failure" as const, error }),
            onSuccess: (result) => ({ kind: "success" as const, result }),
          }),
        );
      assert.equal(cycle.kind, "failure");
      if (cycle.kind === "failure") expectFailure(cycle.error, "dependency-cycle");
      const firstClaim = yield* store
        .mutate({
          principal: first,
          command: mutate({
            kind: "claim",
            commandId: "claim-a-1",
            taskId: "task-a",
            expectedRevision: 1,
          }),
        })
        .pipe(
          Effect.match({
            onFailure: (error) => ({ kind: "failure" as const, error }),
            onSuccess: (result) => ({ kind: "success" as const, result }),
          }),
        );
      const secondClaim = yield* store
        .mutate({
          principal: second,
          command: decodeMutation({
            sharedProjectId: projectId,
            deviceKeyId: "key-2",
            kind: "claim",
            commandId: "claim-a-2",
            taskId: "task-a",
            expectedRevision: 1,
          }),
        })
        .pipe(
          Effect.match({
            onFailure: (error) => ({ kind: "failure" as const, error }),
            onSuccess: (result) => ({ kind: "success" as const, result }),
          }),
        );
      const claims = [firstClaim, secondClaim];
      assert.equal(claims.filter((claim) => claim.kind === "success").length, 1);
      assert.equal(claims.filter((claim) => claim.kind === "failure").length, 1);
      for (const claim of claims)
        if (claim.kind === "failure") expectFailure(claim.error, "revision-conflict");
      const claimed = yield* store.read({
        principal: first,
        request: decodeRead({ sharedProjectId: projectId, taskId: "task-a", deviceKeyId: "key-1" }),
      });
      const owner = claimed.ownerUserId === "user-1" ? first : second;
      const key = claimed.ownerUserId === "user-1" ? "key-1" : "key-2";
      const lease = yield* store.mutate({
        principal: owner,
        command: decodeMutation({
          sharedProjectId: projectId,
          deviceKeyId: key,
          kind: "agent.acquire",
          commandId: "lease-a",
          taskId: "task-a",
          expectedRevision: claimed.revision,
          leaseId: "lease-a",
          agentId: "agent-a",
          leaseMillis: 60_000,
        }),
      });
      assert.equal(lease.task.activeAgentLease?.fencingToken, lease.task.fencingToken);
      const history = yield* store.history({
        principal: first,
        request: decodeHistory({
          sharedProjectId: projectId,
          taskId: "task-a",
          deviceKeyId: "key-1",
          afterSequence: 0,
          limit: 20,
        }),
      });
      assert.isAtLeast(history.length, 3);
      const sql = yield* SqlClient.SqlClient;
      yield* sql`UPDATE collaboration_tasks SET record_sha256=${"0".repeat(64)} WHERE shared_project_id=${projectId} AND task_id='task-a'`;
      const corrupt = yield* store
        .read({
          principal: first,
          request: decodeRead({
            sharedProjectId: projectId,
            taskId: "task-a",
            deviceKeyId: "key-1",
          }),
        })
        .pipe(
          Effect.match({
            onFailure: (error) => ({ kind: "failure" as const, error }),
            onSuccess: (result) => ({ kind: "success" as const, result }),
          }),
        );
      assert.equal(corrupt.kind, "failure");
      if (corrupt.kind === "failure") expectFailure(corrupt.error, "integrity-failure");
    }).pipe(Effect.provide(layer)),
  );

  it("rejects provider fields, secrets, private paths, and excessive dependencies", () => {
    assert.throws(() =>
      decodeCreate(
        {
          ...encodeCreate(create("safe", "safe")),
          providerOutput: "not allowed",
        },
        { onExcessProperty: "error" },
      ),
    );
    assert.throws(() =>
      decodeCreate({
        ...encodeCreate(create("safe2", "safe2")),
        body: "-----BEGIN PRIVATE KEY-----",
      }),
    );
    assert.throws(() =>
      decodeCreate({
        ...encodeCreate(create("safe3", "safe3")),
        body: "Open C:\\Users\\Alice\\secret.txt",
      }),
    );
    assert.throws(() =>
      create(
        "too-many",
        "too-many",
        Array.from({ length: 33 }, (_, i) => `dep-${i}`),
      ),
    );
  });
});
