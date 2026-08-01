import {
  COLLABORATION_ROLE_PERMISSIONS,
  COLLABORATION_TASK_HISTORY_PAGE_MAX_UTF8_BYTES,
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
const ownerOnlyMembership = decodeMembership({
  ...Schema.encodeUnknownSync(CollaborationProjectMembershipSnapshot)(membership),
  members: [
    {
      userId: "user-1",
      displayName: "One",
      role: "owner",
      permissions: [...COLLABORATION_ROLE_PERMISSIONS.owner],
      joinedAt: "2026-08-01T11:00:00.000Z",
    },
  ],
});
const operatorOnlyMembership = decodeMembership({
  ...Schema.encodeUnknownSync(CollaborationProjectMembershipSnapshot)(membership),
  members: [
    {
      userId: "user-2",
      displayName: "Two",
      role: "operator",
      permissions: [...COLLABORATION_ROLE_PERMISSIONS.operator],
      joinedAt: "2026-08-01T11:00:00.000Z",
    },
  ],
});
const epochTwoMembership = decodeMembership({
  ...Schema.encodeUnknownSync(CollaborationProjectMembershipSnapshot)(ownerOnlyMembership),
  epoch: 2,
});
const firstEpochTwo = decodePrincipal({
  sessionId: "session-task-epoch-2",
  sharedProjectId: projectId,
  userId: "user-1",
  deviceId: "device-1",
  membershipEpoch: 2,
  issuedAt: "2026-08-01T11:30:00.000Z",
  expiresAt: "2026-08-01T12:30:00.000Z",
});
const taskLayer = (getMembership: () => typeof membership = () => membership) => {
  const authorities = Layer.merge(
    Layer.succeed(CollaborationMembershipAuthority, {
      getCurrent: () => Effect.sync(getMembership),
    }),
    Layer.succeed(CollaborationDeviceKeyAuthority, {
      getActiveEd25519PublicKey: (lookup) =>
        Effect.succeed({ ...lookup, publicKeySpkiDer: new Uint8Array(44) }),
    }),
  );
  return Layer.merge(
    CollaborationTaskStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
    authorities,
  );
};
const layer = taskLayer();
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

  it.effect("uses current membership for reassignment and rechecks revocation after reads", () => {
    let currentMembership = membership;
    let revokeAfterFirstRead = false;
    let authorizationReads = 0;
    const dynamicLayer = taskLayer(() => {
      if (revokeAfterFirstRead && authorizationReads++ >= 1) return operatorOnlyMembership;
      return currentMembership;
    });
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seed;
      const store = yield* CollaborationTaskStore;
      yield* store.create({ principal: first, command: create("task-owner", "create-owner") });

      currentMembership = ownerOnlyMembership;
      const staleTarget = yield* store
        .mutate({
          principal: first,
          command: mutate({
            kind: "reassign",
            commandId: "stale-target",
            taskId: "task-owner",
            expectedRevision: 1,
            ownerUserId: "user-2",
          }),
        })
        .pipe(Effect.flip);
      expectFailure(staleTarget, "not-authorized");

      currentMembership = membership;
      authorizationReads = 0;
      revokeAfterFirstRead = true;
      const revokedRead = yield* store
        .read({
          principal: first,
          request: decodeRead({
            sharedProjectId: projectId,
            taskId: "task-owner",
            deviceKeyId: "key-1",
          }),
        })
        .pipe(Effect.flip);
      expectFailure(revokedRead, "not-authorized");
    }).pipe(Effect.provide(dynamicLayer));
  });

  it.effect("rolls back writes when authority is revoked at the pre-commit check", () => {
    let authorizationReads = 0;
    const dynamicLayer = taskLayer(() =>
      authorizationReads++ < 2 ? membership : operatorOnlyMembership,
    );
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seed;
      const store = yield* CollaborationTaskStore;
      const sql = yield* SqlClient.SqlClient;
      const revoked = yield* store
        .create({ principal: first, command: create("revoked-write", "create-revoked-write") })
        .pipe(Effect.flip);
      expectFailure(revoked, "not-authorized");
      const tasks = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM collaboration_tasks
        WHERE shared_project_id=${projectId} AND task_id='revoked-write'
      `;
      const events = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM collaboration_task_audit_events
        WHERE shared_project_id=${projectId} AND command_id='create-revoked-write'
      `;
      assert.equal(tasks[0]?.count, 0);
      assert.equal(events[0]?.count, 0);
    }).pipe(Effect.provide(dynamicLayer));
  });

  it.effect("binds lease renewal and release to the membership epoch", () => {
    let currentMembership = membership;
    const dynamicLayer = taskLayer(() => currentMembership);
    return Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seed;
      const store = yield* CollaborationTaskStore;
      yield* store.create({ principal: first, command: create("task-lease", "create-lease") });
      const claim = yield* store.mutate({
        principal: first,
        command: mutate({
          kind: "claim",
          commandId: "claim-lease",
          taskId: "task-lease",
          expectedRevision: 1,
        }),
      });
      const acquired = yield* store.mutate({
        principal: first,
        command: mutate({
          kind: "agent.acquire",
          commandId: "acquire-lease",
          taskId: "task-lease",
          expectedRevision: claim.task.revision,
          leaseId: "lease-epoch",
          agentId: "agent-epoch",
          leaseMillis: 60_000,
        }),
      });
      currentMembership = epochTwoMembership;
      const staleEpoch = yield* store
        .mutate({
          principal: firstEpochTwo,
          command: mutate({
            kind: "agent.release",
            commandId: "release-old-epoch",
            taskId: "task-lease",
            expectedRevision: acquired.task.revision,
            leaseId: "lease-epoch",
          }),
        })
        .pipe(Effect.flip);
      expectFailure(staleEpoch, "lease-mismatch");
    }).pipe(Effect.provide(dynamicLayer));
  });

  it.effect(
    "fails closed on dependency projection tampering and completed-dependent reopening",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW);
        yield* seed;
        const store = yield* CollaborationTaskStore;
        const sql = yield* SqlClient.SqlClient;

        yield* store.create({
          principal: first,
          command: create("dep-corrupt", "create-dep-corrupt"),
        });
        yield* store.create({
          principal: first,
          command: create("blocked-corrupt", "create-blocked-corrupt", ["dep-corrupt"]),
        });
        const blockedClaim = yield* store.mutate({
          principal: first,
          command: mutate({
            kind: "claim",
            commandId: "claim-blocked-corrupt",
            taskId: "blocked-corrupt",
            expectedRevision: 1,
          }),
        });
        yield* sql`DELETE FROM collaboration_task_dependencies WHERE shared_project_id=${projectId} AND task_id='blocked-corrupt'`;
        const projectionTamper = yield* store
          .mutate({
            principal: first,
            command: mutate({
              kind: "complete",
              commandId: "complete-corrupt",
              taskId: "blocked-corrupt",
              expectedRevision: blockedClaim.task.revision,
            }),
          })
          .pipe(Effect.flip);
        expectFailure(projectionTamper, "integrity-failure");

        yield* store.create({ principal: first, command: create("dep", "create-dep") });
        const depClaim = yield* store.mutate({
          principal: first,
          command: mutate({
            kind: "claim",
            commandId: "claim-dep",
            taskId: "dep",
            expectedRevision: 1,
          }),
        });
        const depComplete = yield* store.mutate({
          principal: first,
          command: mutate({
            kind: "complete",
            commandId: "complete-dep",
            taskId: "dep",
            expectedRevision: depClaim.task.revision,
          }),
        });
        yield* store.create({
          principal: first,
          command: create("dependent", "create-dependent", ["dep"]),
        });
        const dependentClaim = yield* store.mutate({
          principal: first,
          command: mutate({
            kind: "claim",
            commandId: "claim-dependent",
            taskId: "dependent",
            expectedRevision: 1,
          }),
        });
        yield* store.mutate({
          principal: first,
          command: mutate({
            kind: "complete",
            commandId: "complete-dependent",
            taskId: "dependent",
            expectedRevision: dependentClaim.task.revision,
          }),
        });
        const invalidatingReopen = yield* store
          .mutate({
            principal: first,
            command: mutate({
              kind: "reopen",
              commandId: "reopen-dep",
              taskId: "dep",
              expectedRevision: depComplete.task.revision,
            }),
          })
          .pipe(Effect.flip);
        expectFailure(invalidatingReopen, "dependency-blocked");
      }).pipe(Effect.provide(layer)),
  );

  it.effect("detects audit task substitution and server clock rollback", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seed;
      const store = yield* CollaborationTaskStore;
      const sql = yield* SqlClient.SqlClient;
      yield* store.create({ principal: first, command: create("audit-a", "create-audit-a") });
      yield* store.create({ principal: first, command: create("audit-b", "create-audit-b") });
      yield* sql`UPDATE collaboration_task_audit_events SET task_id='audit-b' WHERE shared_project_id=${projectId} AND command_id='create-audit-a'`;
      const substituted = yield* store
        .history({
          principal: first,
          request: decodeHistory({
            sharedProjectId: projectId,
            taskId: "audit-b",
            deviceKeyId: "key-1",
            afterSequence: 0,
            limit: 20,
          }),
        })
        .pipe(Effect.flip);
      expectFailure(substituted, "integrity-failure");

      yield* TestClock.setTime(NOW - 1);
      const rollback = yield* store
        .mutate({
          principal: first,
          command: mutate({
            kind: "claim",
            commandId: "clock-rollback",
            taskId: "audit-b",
            expectedRevision: 1,
          }),
        })
        .pipe(Effect.flip);
      expectFailure(rollback, "integrity-failure");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("binds the idempotency input digest into the audit event hash", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seed;
      const store = yield* CollaborationTaskStore;
      const sql = yield* SqlClient.SqlClient;
      yield* store.create({
        principal: first,
        command: create("audit-input", "create-audit-input"),
      });
      yield* sql`UPDATE collaboration_task_audit_events SET input_sha256=${"0".repeat(64)} WHERE shared_project_id=${projectId} AND command_id='create-audit-input'`;
      const tampered = yield* store
        .history({
          principal: first,
          request: decodeHistory({
            sharedProjectId: projectId,
            taskId: "audit-input",
            deviceKeyId: "key-1",
            afterSequence: 0,
            limit: 20,
          }),
        })
        .pipe(Effect.flip);
      expectFailure(tampered, "integrity-failure");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("enforces the per-project task capacity before accepting more content", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seed;
      const sql = yield* SqlClient.SqlClient;
      const store = yield* CollaborationTaskStore;
      yield* sql`
        WITH RECURSIVE seq(value) AS (
          SELECT 1 UNION ALL SELECT value + 1 FROM seq WHERE value < 10000
        )
        INSERT INTO collaboration_tasks(
          shared_project_id,task_id,provenance,title,body,status,owner_user_id,
          dependencies_json,revision,fencing_token,created_by_user_id,created_at,updated_at,record_sha256
        )
        SELECT ${projectId},printf('capacity-%05d',value),'operator-authored','Task','Body','open',NULL,
          '[]',1,0,'user-1','2026-08-01T12:00:00.000Z','2026-08-01T12:00:00.000Z',${"0".repeat(64)}
        FROM seq
      `;
      const capacity = yield* store
        .create({ principal: first, command: create("over-capacity", "over-capacity") })
        .pipe(Effect.flip);
      expectFailure(capacity, "task-capacity");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("serializes competing lease acquisition and enforces the eight-agent cap", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seed;
      const store = yield* CollaborationTaskStore;
      yield* store.create({ principal: first, command: create("race-lease", "create-race-lease") });
      const claimed = yield* store.mutate({
        principal: first,
        command: mutate({
          kind: "claim",
          commandId: "claim-race-lease",
          taskId: "race-lease",
          expectedRevision: 1,
        }),
      });
      const attempt = (suffix: string) =>
        store
          .mutate({
            principal: first,
            command: mutate({
              kind: "agent.acquire",
              commandId: `acquire-race-${suffix}`,
              taskId: "race-lease",
              expectedRevision: claimed.task.revision,
              leaseId: `lease-race-${suffix}`,
              agentId: `agent-race-${suffix}`,
              leaseMillis: 60_000,
            }),
          })
          .pipe(
            Effect.match({
              onFailure: (error) => ({ kind: "failure" as const, error }),
              onSuccess: (event) => ({ kind: "success" as const, event }),
            }),
          );
      const raced = yield* Effect.all([attempt("a"), attempt("b")], {
        concurrency: "unbounded",
      });
      assert.equal(raced.filter((result) => result.kind === "success").length, 1);
      const raceFailure = raced.find((result) => result.kind === "failure");
      assert.isDefined(raceFailure);
      if (raceFailure?.kind === "failure") expectFailure(raceFailure.error, "revision-conflict");

      for (let index = 2; index <= 8; index += 1) {
        const taskId = `lease-cap-${index}`;
        yield* store.create({
          principal: first,
          command: create(taskId, `create-${taskId}`),
        });
        const claim = yield* store.mutate({
          principal: first,
          command: mutate({
            kind: "claim",
            commandId: `claim-${taskId}`,
            taskId,
            expectedRevision: 1,
          }),
        });
        yield* store.mutate({
          principal: first,
          command: mutate({
            kind: "agent.acquire",
            commandId: `acquire-${taskId}`,
            taskId,
            expectedRevision: claim.task.revision,
            leaseId: `lease-${taskId}`,
            agentId: `agent-${taskId}`,
            leaseMillis: 60_000,
          }),
        });
      }
      yield* store.create({
        principal: first,
        command: create("lease-cap-9", "create-lease-cap-9"),
      });
      const ninthClaim = yield* store.mutate({
        principal: first,
        command: mutate({
          kind: "claim",
          commandId: "claim-lease-cap-9",
          taskId: "lease-cap-9",
          expectedRevision: 1,
        }),
      });
      const ninth = yield* store
        .mutate({
          principal: first,
          command: mutate({
            kind: "agent.acquire",
            commandId: "acquire-lease-cap-9",
            taskId: "lease-cap-9",
            expectedRevision: ninthClaim.task.revision,
            leaseId: "lease-cap-9",
            agentId: "agent-cap-9",
            leaseMillis: 60_000,
          }),
        })
        .pipe(Effect.flip);
      expectFailure(ninth, "agent-capacity");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("bounds history pages by encoded bytes as well as event count", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seed;
      const store = yield* CollaborationTaskStore;
      const large = decodeCreate({
        ...encodeCreate(create("large-history", "create-large-history")),
        body: "x".repeat(32_000),
      });
      let event = yield* store.create({ principal: first, command: large });
      for (let index = 0; index < 12; index += 1) {
        event = yield* store.mutate({
          principal: first,
          command: mutate({
            kind: "claim",
            commandId: `large-claim-${index}`,
            taskId: "large-history",
            expectedRevision: event.task.revision,
          }),
        });
        event = yield* store.mutate({
          principal: first,
          command: mutate({
            kind: "cancel",
            commandId: `large-cancel-${index}`,
            taskId: "large-history",
            expectedRevision: event.task.revision,
          }),
        });
        event = yield* store.mutate({
          principal: first,
          command: mutate({
            kind: "reopen",
            commandId: `large-reopen-${index}`,
            taskId: "large-history",
            expectedRevision: event.task.revision,
          }),
        });
      }
      const history = yield* store.history({
        principal: first,
        request: decodeHistory({
          sharedProjectId: projectId,
          taskId: "large-history",
          deviceKeyId: "key-1",
          afterSequence: 0,
          limit: 256,
        }),
      });
      const encodedBytes = Buffer.byteLength(JSON.stringify(history), "utf8");
      assert.isBelow(history.length, 37);
      assert.isAtMost(encodedBytes, COLLABORATION_TASK_HISTORY_PAGE_MAX_UTF8_BYTES);
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
