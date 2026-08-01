import {
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationPrincipal,
  CollaborationProjectMembershipSnapshot,
  SharedProjectId,
} from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import { CollaborationMembershipAuthority } from "./CollaborationAuthorization.ts";
import {
  CollaborationDatabaseStore,
  CollaborationDatabaseStoreError,
  CollaborationDatabaseStoreLive,
} from "./CollaborationDatabaseStore.ts";

const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const projectId = decodeProjectId("project-database-store");

const principal = decodePrincipal({
  sessionId: "session-1",
  sharedProjectId: projectId,
  userId: "user-1",
  deviceId: "device-1",
  membershipEpoch: 1,
  issuedAt: "2026-08-01T11:30:00.000Z",
  expiresAt: "2026-08-01T12:30:00.000Z",
});
const secondPrincipal = decodePrincipal({
  sessionId: "session-2",
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
      displayName: "Operator One",
      role: "owner",
      permissions: [...COLLABORATION_ROLE_PERMISSIONS.owner],
      joinedAt: "2026-08-01T11:00:00.000Z",
    },
    {
      userId: "user-2",
      displayName: "Operator Two",
      role: "owner",
      permissions: [...COLLABORATION_ROLE_PERMISSIONS.owner],
      joinedAt: "2026-08-01T11:00:00.000Z",
    },
  ],
  updatedAt: "2026-08-01T11:00:00.000Z",
});

const membershipLayer = Layer.succeed(CollaborationMembershipAuthority, {
  getCurrent: () => Effect.succeed(membership),
});
const testLayer = Layer.merge(
  CollaborationDatabaseStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  membershipLayer,
);

function fileBackedStoreLayer(filename: string) {
  return Layer.merge(
    CollaborationDatabaseStoreLive.pipe(
      Layer.provideMerge(
        NodeSqliteClient.layer({
          filename,
          busyTimeoutMs: 15_000,
        }),
      ),
    ),
    membershipLayer,
  );
}

const configureCommand = {
  commandId: "configure-1",
  sharedProjectId: projectId,
  databaseId: "database-1",
  relativePath: "data/project.sqlite",
  engine: "sqlite" as const,
  policy: {
    kind: "serialized-head" as const,
    fileReplication: "immutable-snapshots-only" as const,
    leaseLifetimeMillis: 60_000,
  },
};

function expectStoreFailure(error: unknown, reason: CollaborationDatabaseStoreError["reason"]) {
  assert.instanceOf(error, CollaborationDatabaseStoreError);
  assert.equal((error as CollaborationDatabaseStoreError).reason, reason);
}

describe("CollaborationDatabaseStore", () => {
  it.effect("serializes competing leases across two file-backed SQLite clients", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-database-store-acquire-"))),
      (directory) => {
        const dbPath = join(directory, "state.sqlite");
        const setupLayer = fileBackedStoreLayer(dbPath);
        const firstLayer = fileBackedStoreLayer(dbPath);
        const secondLayer = fileBackedStoreLayer(dbPath);
        return Effect.gen(function* () {
          yield* TestClock.setTime(NOW);
          yield* Effect.gen(function* () {
            yield* runMigrations();
            const store = yield* CollaborationDatabaseStore;
            yield* store.configure({ principal, command: configureCommand });
          }).pipe(Effect.provide(setupLayer));

          const acquire = (
            commandId: string,
            holder: typeof principal,
            layer: ReturnType<typeof fileBackedStoreLayer>,
          ) =>
            Effect.gen(function* () {
              const store = yield* CollaborationDatabaseStore;
              return yield* store.acquireLease({
                principal: holder,
                command: {
                  commandId,
                  sharedProjectId: projectId,
                  databaseId: "database-1",
                },
              });
            }).pipe(
              Effect.provide(layer),
              Effect.map((value) => ({ _tag: "Success" as const, value })),
              Effect.catch((error) => Effect.succeed({ _tag: "Failure" as const, error })),
            );

          const outcomes = yield* Effect.all(
            [
              acquire("acquire-file-1", principal, firstLayer),
              acquire("acquire-file-2", secondPrincipal, secondLayer),
            ],
            { concurrency: "unbounded" },
          );
          const successes = outcomes.filter((outcome) => outcome._tag === "Success");
          const failures = outcomes.filter((outcome) => outcome._tag === "Failure");
          assert.equal(successes.length, 1);
          assert.equal(failures.length, 1);
          assert.equal(successes[0]!.value.fencingToken, 1);
          expectStoreFailure(failures[0]!.error, "lease-unavailable");
          const persisted = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{
              readonly activeLeaseId: string | null;
              readonly lastFencingToken: number;
              readonly receiptCount: number;
            }>`
              SELECT active_lease_id AS "activeLeaseId",
                last_fencing_token AS "lastFencingToken",
                (SELECT COUNT(*) FROM collaboration_database_command_receipts
                  WHERE shared_project_id = ${projectId}
                    AND database_id = ${"database-1"}
                    AND operation = ${"acquire"}) AS "receiptCount"
              FROM collaboration_database_states
              WHERE shared_project_id = ${projectId} AND database_id = ${"database-1"}
            `;
          }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath })));
          assert.equal(persisted[0]?.activeLeaseId, successes[0]!.value.leaseId);
          assert.equal(persisted[0]?.lastFencingToken, 1);
          assert.equal(persisted[0]?.receiptCount, 1);
        });
      },
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("allows only one same-base publish across two file-backed SQLite clients", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-database-store-cas-"))),
      (directory) => {
        const dbPath = join(directory, "state.sqlite");
        const setupLayer = fileBackedStoreLayer(dbPath);
        const firstLayer = fileBackedStoreLayer(dbPath);
        const secondLayer = fileBackedStoreLayer(dbPath);
        return Effect.gen(function* () {
          yield* TestClock.setTime(NOW);
          const lease = yield* Effect.gen(function* () {
            yield* runMigrations();
            const store = yield* CollaborationDatabaseStore;
            yield* store.configure({ principal, command: configureCommand });
            return yield* store.acquireLease({
              principal,
              command: {
                commandId: "acquire-cas",
                sharedProjectId: projectId,
                databaseId: "database-1",
              },
            });
          }).pipe(Effect.provide(setupLayer));

          const publish = (
            commandId: string,
            contentSha256: string,
            layer: ReturnType<typeof fileBackedStoreLayer>,
          ) =>
            Effect.gen(function* () {
              const store = yield* CollaborationDatabaseStore;
              return yield* store.publishHead({
                principal,
                command: {
                  commandId,
                  update: {
                    sharedProjectId: projectId,
                    databaseId: "database-1",
                    snapshot: {
                      sharedProjectId: projectId,
                      databaseId: "database-1",
                      relativePath: "data/project.sqlite",
                      engine: "sqlite",
                      contentSha256,
                      baseContentSha256: null,
                      schemaSha256: "f".repeat(64),
                      byteSize: 4_096,
                      consistency: "online-backup",
                      sidecarsExcluded: true,
                      createdByUserId: "user-1",
                      createdByDeviceId: "device-1",
                      createdAt: "2026-08-01T12:00:00.000Z",
                    },
                    expectedHeadContentSha256: null,
                    authorUserId: "user-1",
                    authorDeviceId: "device-1",
                    leaseId: lease.leaseId,
                    fencingToken: lease.fencingToken,
                    membershipEpoch: 1,
                  },
                },
              });
            }).pipe(
              Effect.provide(layer),
              Effect.map((value) => ({ _tag: "Success" as const, value })),
              Effect.catch((error) => Effect.succeed({ _tag: "Failure" as const, error })),
            );

          const outcomes = yield* Effect.all(
            [
              publish("publish-file-1", "a".repeat(64), firstLayer),
              publish("publish-file-2", "b".repeat(64), secondLayer),
            ],
            { concurrency: "unbounded" },
          );
          const successes = outcomes.filter((outcome) => outcome._tag === "Success");
          const failures = outcomes.filter((outcome) => outcome._tag === "Failure");
          assert.equal(successes.length, 1);
          assert.equal(failures.length, 1);
          expectStoreFailure(failures[0]!.error, "head-conflict");
          assert.include(["a".repeat(64), "b".repeat(64)], successes[0]!.value.contentSha256);
          const persisted = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{
              readonly headContentSha256: string | null;
              readonly receiptCount: number;
            }>`
              SELECT head_content_sha256 AS "headContentSha256",
                (SELECT COUNT(*) FROM collaboration_database_command_receipts
                  WHERE shared_project_id = ${projectId}
                    AND database_id = ${"database-1"}
                    AND operation = ${"publish"}) AS "receiptCount"
              FROM collaboration_database_states
              WHERE shared_project_id = ${projectId} AND database_id = ${"database-1"}
            `;
          }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: dbPath })));
          assert.equal(persisted[0]?.headContentSha256, successes[0]!.value.contentSha256);
          assert.equal(persisted[0]?.receiptCount, 1);
        });
      },
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("binds one canonical project path and returns idempotent configure receipts", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const store = yield* CollaborationDatabaseStore;
      const first = yield* store.configure({ principal, command: configureCommand });
      const retry = yield* store.configure({ principal, command: configureCommand });

      assert.equal(first.relativePath, "data/project.sqlite");
      assert.deepStrictEqual(retry, first);

      const pathConflict = yield* store
        .configure({
          principal,
          command: {
            ...configureCommand,
            commandId: "configure-2",
            databaseId: "database-2",
          },
        })
        .pipe(Effect.catch((error) => Effect.succeed(error)));
      expectStoreFailure(pathConflict, "binding-conflict");

      const changedRetry = yield* store
        .configure({
          principal,
          command: { ...configureCommand, engine: "duckdb" as const },
        })
        .pipe(Effect.catch((error) => Effect.succeed(error)));
      expectStoreFailure(changedRetry, "idempotency-conflict");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("acquires a fenced lease and atomically publishes the expected head", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const store = yield* CollaborationDatabaseStore;
      yield* store.configure({ principal, command: configureCommand });
      const lease = yield* store.acquireLease({
        principal,
        command: {
          commandId: "acquire-1",
          sharedProjectId: projectId,
          databaseId: "database-1",
        },
      });
      assert.equal(lease.fencingToken, 1);
      assert.equal(DateTime.toEpochMillis(lease.expiresAt), NOW + 60_000);

      const snapshot = {
        sharedProjectId: projectId,
        databaseId: "database-1",
        relativePath: "data/project.sqlite",
        engine: "sqlite" as const,
        contentSha256: "a".repeat(64),
        baseContentSha256: null,
        schemaSha256: "b".repeat(64),
        byteSize: 4_096,
        consistency: "online-backup" as const,
        sidecarsExcluded: true as const,
        createdByUserId: "user-1",
        createdByDeviceId: "device-1",
        createdAt: "2026-08-01T12:00:00.000Z",
      };
      const published = yield* store.publishHead({
        principal,
        command: {
          commandId: "publish-1",
          update: {
            sharedProjectId: projectId,
            databaseId: "database-1",
            snapshot,
            expectedHeadContentSha256: null,
            authorUserId: "user-1",
            authorDeviceId: "device-1",
            leaseId: lease.leaseId,
            fencingToken: lease.fencingToken,
            membershipEpoch: 1,
          },
        },
      });
      assert.equal(published.contentSha256, "a".repeat(64));

      yield* TestClock.adjust("10 seconds");
      const renewed = yield* store.renewLease({
        principal,
        command: {
          commandId: "renew-1",
          sharedProjectId: projectId,
          databaseId: "database-1",
          leaseId: lease.leaseId,
          fencingToken: lease.fencingToken,
        },
      });
      assert.equal(renewed.leaseId, lease.leaseId);
      assert.equal(renewed.fencingToken, lease.fencingToken);
      assert.equal(DateTime.toEpochMillis(renewed.expiresAt), NOW + 70_000);

      const staleCas = yield* store
        .publishHead({
          principal,
          command: {
            commandId: "publish-2",
            update: {
              sharedProjectId: projectId,
              databaseId: "database-1",
              snapshot: {
                ...snapshot,
                contentSha256: "c".repeat(64),
              },
              expectedHeadContentSha256: null,
              authorUserId: "user-1",
              authorDeviceId: "device-1",
              leaseId: lease.leaseId,
              fencingToken: lease.fencingToken,
              membershipEpoch: 1,
            },
          },
        })
        .pipe(Effect.catch((error) => Effect.succeed(error)));
      expectStoreFailure(staleCas, "head-conflict");

      const released = yield* store.releaseLease({
        principal,
        command: {
          commandId: "release-1",
          sharedProjectId: projectId,
          databaseId: "database-1",
          leaseId: renewed.leaseId,
          fencingToken: renewed.fencingToken,
        },
      });
      assert.isTrue(released.released);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("never reuses a fence after expiry and rejects stale holder commands", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const store = yield* CollaborationDatabaseStore;
      yield* store.configure({ principal, command: configureCommand });
      const first = yield* store.acquireLease({
        principal,
        command: {
          commandId: "acquire-1",
          sharedProjectId: projectId,
          databaseId: "database-1",
        },
      });
      yield* TestClock.adjust("61 seconds");
      const second = yield* store.acquireLease({
        principal,
        command: {
          commandId: "acquire-2",
          sharedProjectId: projectId,
          databaseId: "database-1",
        },
      });
      assert.equal(second.fencingToken, 2);

      const staleRelease = yield* store
        .releaseLease({
          principal,
          command: {
            commandId: "release-stale",
            sharedProjectId: projectId,
            databaseId: "database-1",
            leaseId: first.leaseId,
            fencingToken: first.fencingToken,
          },
        })
        .pipe(Effect.catch((error) => Effect.succeed(error)));
      expectStoreFailure(staleRelease, "lease-invalid");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("fails closed when a persisted receipt is corrupted", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const store = yield* CollaborationDatabaseStore;
      const sql = yield* SqlClient.SqlClient;
      yield* store.configure({ principal, command: configureCommand });
      yield* sql`
        UPDATE collaboration_database_command_receipts
        SET response_json = ${JSON.stringify({ corrupted: true })}
        WHERE shared_project_id = ${projectId} AND database_id = ${"database-1"}
          AND command_id = ${"configure-1"}
      `;
      const retry = yield* store
        .configure({ principal, command: configureCommand })
        .pipe(Effect.catch((error) => Effect.succeed(error)));
      expectStoreFailure(retry, "integrity-failure");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects a validly hashed receipt whose response crosses database identity", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const store = yield* CollaborationDatabaseStore;
      const sql = yield* SqlClient.SqlClient;
      const binding = yield* store.configure({ principal, command: configureCommand });
      const crossedJson = JSON.stringify({ ...binding, databaseId: "database-other" });
      const crossedHash = createHash("sha256").update(crossedJson, "utf8").digest("hex");
      yield* sql`
        UPDATE collaboration_database_command_receipts
        SET response_json = ${crossedJson}, response_sha256 = ${crossedHash}
        WHERE shared_project_id = ${projectId} AND database_id = ${"database-1"}
          AND command_id = ${"configure-1"}
      `;
      const retry = yield* store
        .configure({ principal, command: configureCommand })
        .pipe(Effect.catch((error) => Effect.succeed(error)));
      expectStoreFailure(retry, "integrity-failure");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects a validly hashed lease receipt whose holder differs from its request", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const store = yield* CollaborationDatabaseStore;
      const sql = yield* SqlClient.SqlClient;
      yield* store.configure({ principal, command: configureCommand });
      const command = {
        commandId: "acquire-holder-receipt",
        sharedProjectId: projectId,
        databaseId: "database-1",
      };
      yield* store.acquireLease({ principal, command });
      const rows = yield* sql<{ readonly responseJson: string }>`
        SELECT response_json AS "responseJson"
        FROM collaboration_database_command_receipts
        WHERE shared_project_id = ${projectId} AND database_id = ${"database-1"}
          AND command_id = ${command.commandId}
      `;
      const crossedJson = JSON.stringify({
        ...(JSON.parse(rows[0]!.responseJson) as Record<string, unknown>),
        holderUserId: "user-2",
        holderDeviceId: "device-2",
      });
      const crossedHash = createHash("sha256").update(crossedJson, "utf8").digest("hex");
      yield* sql`
        UPDATE collaboration_database_command_receipts
        SET response_json = ${crossedJson}, response_sha256 = ${crossedHash}
        WHERE shared_project_id = ${projectId} AND database_id = ${"database-1"}
          AND command_id = ${command.commandId}
      `;

      const retry = yield* store
        .acquireLease({ principal, command })
        .pipe(Effect.catch((error) => Effect.succeed(error)));
      expectStoreFailure(retry, "integrity-failure");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("disallows canonical leases for non-serialized policies", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const store = yield* CollaborationDatabaseStore;
      yield* store.configure({
        principal,
        command: {
          ...configureCommand,
          policy: {
            kind: "private-forks",
            fileReplication: "immutable-snapshots-only",
            mergeStrategy: "manual-export-import",
          },
        },
      });
      const acquire = yield* store
        .acquireLease({
          principal,
          command: {
            commandId: "acquire-private",
            sharedProjectId: projectId,
            databaseId: "database-1",
          },
        })
        .pipe(Effect.catch((error) => Effect.succeed(error)));
      expectStoreFailure(acquire, "policy-disallows-lease");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("binds idempotency to the authenticated user, device, and membership epoch", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const store = yield* CollaborationDatabaseStore;
      yield* store.configure({ principal, command: configureCommand });
      const command = {
        commandId: "acquire-1",
        sharedProjectId: projectId,
        databaseId: "database-1",
      };
      yield* store.acquireLease({ principal, command });
      const reused = yield* store
        .acquireLease({ principal: secondPrincipal, command })
        .pipe(Effect.catch((error) => Effect.succeed(error)));
      expectStoreFailure(reused, "idempotency-conflict");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("denies an exact retry after the principal membership epoch is revoked", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const store = yield* CollaborationDatabaseStore;
      yield* store.configure({ principal, command: configureCommand });
      const revokedMembership = decodeMembership({
        ...membership,
        epoch: 2,
        updatedAt: "2026-08-01T12:00:00.000Z",
      });
      const retry = yield* store.configure({ principal, command: configureCommand }).pipe(
        Effect.provideService(CollaborationMembershipAuthority, {
          getCurrent: () => Effect.succeed(revokedMembership),
        }),
        Effect.catch((error) => Effect.succeed(error)),
      );
      expectStoreFailure(retry, "not-authorized");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("rejects fencing overflow without granting a lease or writing a receipt", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const store = yield* CollaborationDatabaseStore;
      const sql = yield* SqlClient.SqlClient;
      yield* store.configure({ principal, command: configureCommand });
      yield* sql`
        UPDATE collaboration_database_states SET last_fencing_token = ${Number.MAX_SAFE_INTEGER}
        WHERE shared_project_id = ${projectId} AND database_id = ${"database-1"}
      `;
      const overflow = yield* store
        .acquireLease({
          principal,
          command: {
            commandId: "acquire-overflow",
            sharedProjectId: projectId,
            databaseId: "database-1",
          },
        })
        .pipe(Effect.catch((error) => Effect.succeed(error)));
      expectStoreFailure(overflow, "lease-invalid");
      const rows = yield* sql<{
        readonly receiptCount: number;
        readonly activeLeaseId: string | null;
      }>`
        SELECT
          (SELECT COUNT(*) FROM collaboration_database_command_receipts
            WHERE command_id = ${"acquire-overflow"}) AS "receiptCount",
          active_lease_id AS "activeLeaseId"
        FROM collaboration_database_states
        WHERE shared_project_id = ${projectId} AND database_id = ${"database-1"}
      `;
      assert.equal(rows[0]?.receiptCount, 0);
      assert.equal(rows[0]?.activeLeaseId, null);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("validates current state before returning an exact receipt retry", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      const store = yield* CollaborationDatabaseStore;
      const sql = yield* SqlClient.SqlClient;
      yield* store.configure({ principal, command: configureCommand });
      yield* sql`
        UPDATE collaboration_database_states SET coordination_kind = ${"private-forks"}
        WHERE shared_project_id = ${projectId} AND database_id = ${"database-1"}
      `;
      const retry = yield* store
        .configure({ principal, command: configureCommand })
        .pipe(Effect.catch((error) => Effect.succeed(error)));
      expectStoreFailure(retry, "integrity-failure");
    }).pipe(Effect.provide(testLayer)),
  );
});
