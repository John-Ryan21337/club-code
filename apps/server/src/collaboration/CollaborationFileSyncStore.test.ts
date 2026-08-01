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

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import { runMigrations } from "../persistence/Migrations.ts";
import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import { CollaborationMembershipAuthority } from "./CollaborationAuthorization.ts";
import {
  CollaborationDatabaseStore,
  CollaborationDatabaseStoreLive,
} from "./CollaborationDatabaseStore.ts";
import { CollaborationDeviceKeyAuthority } from "./CollaborationEventAdmission.ts";
import {
  CollaborationFileSyncStore,
  CollaborationFileSyncStoreError,
  CollaborationFileSyncStoreLive,
} from "./CollaborationFileSyncStore.ts";
import { CollaborationSandboxPathAuthorityLive } from "./CollaborationSandboxPathAuthority.ts";

const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const projectId = decodeProjectId("project-file-sync");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

const principal = decodePrincipal({
  sessionId: "session-file-1",
  sharedProjectId: projectId,
  userId: "user-1",
  deviceId: "device-1",
  membershipEpoch: 1,
  issuedAt: "2026-08-01T11:30:00.000Z",
  expiresAt: "2026-08-01T12:30:00.000Z",
});
const secondPrincipal = decodePrincipal({
  sessionId: "session-file-2",
  sharedProjectId: projectId,
  userId: "user-2",
  deviceId: "device-2",
  membershipEpoch: 1,
  issuedAt: "2026-08-01T11:30:00.000Z",
  expiresAt: "2026-08-01T12:30:00.000Z",
});

function manifest(value: string) {
  const byteSize = Buffer.byteLength(value);
  return {
    contentSha256: hash(value),
    byteSize,
    chunks: [{ index: 0, offset: 0, byteSize, contentSha256: hash(value) }],
  };
}

function publishCommand(input: {
  readonly commandId: string;
  readonly value: string;
  readonly expectedHeadRevisionId?: string | null;
  readonly deviceKeyId?: string;
  readonly relativePath?: string;
}) {
  return {
    commandId: input.commandId,
    sharedProjectId: projectId,
    relativePath: input.relativePath ?? "src/shared.txt",
    deviceKeyId: input.deviceKeyId ?? "key-1",
    expectedHeadRevisionId: input.expectedHeadRevisionId ?? null,
    manifest: manifest(input.value),
    contentKind: { kind: "regular-file" as const },
  };
}

function expectFailure(error: unknown, reason: CollaborationFileSyncStoreError["reason"]) {
  assert.instanceOf(error, CollaborationFileSyncStoreError);
  assert.equal((error as CollaborationFileSyncStoreError).reason, reason);
}

function makeAuthorityLayers(root: string, activeUsers: Set<string>, activeDevices: Set<string>) {
  const membershipLayer = Layer.succeed(CollaborationMembershipAuthority, {
    getCurrent: () =>
      Effect.sync(() =>
        decodeMembership({
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
          ].filter((member) => activeUsers.has(member.userId)),
          updatedAt: "2026-08-01T11:00:00.000Z",
        }),
      ),
  });
  const deviceLayer = Layer.succeed(CollaborationDeviceKeyAuthority, {
    getActiveEd25519PublicKey: (lookup) =>
      Effect.succeed(
        activeDevices.has(`${lookup.deviceId}:${lookup.deviceKeyId}`)
          ? { ...lookup, publicKeySpkiDer: new Uint8Array(44) }
          : null,
      ),
  });
  return Layer.mergeAll(membershipLayer, deviceLayer, CollaborationSandboxPathAuthorityLive(root));
}

function fileLayer(
  filename: string,
  root: string,
  activeUsers: Set<string>,
  activeDevices: Set<string>,
) {
  const database = NodeSqliteClient.layer({ filename, busyTimeoutMs: 15_000 });
  return Layer.merge(
    CollaborationFileSyncStoreLive.pipe(Layer.provideMerge(database)),
    makeAuthorityLayers(root, activeUsers, activeDevices),
  );
}

function databaseAndFileLayer(
  filename: string,
  root: string,
  activeUsers: Set<string>,
  activeDevices: Set<string>,
) {
  const database = NodeSqliteClient.layer({ filename, busyTimeoutMs: 15_000 });
  return Layer.mergeAll(
    CollaborationFileSyncStoreLive.pipe(Layer.provideMerge(database)),
    CollaborationDatabaseStoreLive.pipe(Layer.provideMerge(database)),
    makeAuthorityLayers(root, activeUsers, activeDevices),
  );
}

const setupDatabase = Effect.gen(function* () {
  yield* runMigrations();
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO collaboration_projects(shared_project_id, membership_epoch, updated_at)
    VALUES (${projectId}, ${1}, ${"2026-08-01T11:00:00.000Z"})
  `;
  for (const [deviceId, userId] of [
    ["device-1", "user-1"],
    ["device-2", "user-2"],
  ] as const) {
    yield* sql`
      INSERT INTO collaboration_project_devices(
        shared_project_id, device_id, user_id, first_enrolled_at
      ) VALUES (${projectId}, ${deviceId}, ${userId}, ${"2026-08-01T11:00:00.000Z"})
    `;
  }
});

describe("CollaborationFileSyncStore", () => {
  it.effect("preserves both concurrent edits and records one deterministic CAS fork", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-file-race-"))),
      (root) => {
        const filename = join(root, "authority.sqlite");
        const activeUsers = new Set(["user-1", "user-2"]);
        const activeDevices = new Set(["device-1:key-1", "device-2:key-2"]);
        const setupLayer = fileLayer(filename, root, activeUsers, activeDevices);
        const firstLayer = fileLayer(filename, root, activeUsers, activeDevices);
        const secondLayer = fileLayer(filename, root, activeUsers, activeDevices);
        return Effect.scoped(
          Effect.gen(function* () {
            yield* TestClock.setTime(NOW);
            yield* setupDatabase.pipe(Effect.provide(setupLayer));
            const firstContext = yield* Layer.build(firstLayer);
            const secondContext = yield* Layer.build(secondLayer);
            const publish = (
              holder: typeof principal,
              command: ReturnType<typeof publishCommand>,
              context: typeof firstContext,
            ) =>
              Effect.gen(function* () {
                const store = yield* CollaborationFileSyncStore;
                return yield* store.publish({ principal: holder, command });
              }).pipe(
                Effect.provide(context),
                Effect.map((value) => ({ _tag: "Success" as const, value })),
                Effect.catch((error) => Effect.succeed({ _tag: "Failure" as const, error })),
              );
            const outcomes = yield* Effect.all(
              [
                publish(
                  principal,
                  publishCommand({ commandId: "race-1", value: "first" }),
                  firstContext,
                ),
                publish(
                  secondPrincipal,
                  publishCommand({
                    commandId: "race-2",
                    value: "second",
                    deviceKeyId: "key-2",
                  }),
                  secondContext,
                ),
              ],
              { concurrency: "unbounded" },
            );
            const failures = outcomes.filter((outcome) => outcome._tag === "Failure");
            assert.equal(failures.length, 0, JSON.stringify(failures));
            const successes = outcomes.filter((outcome) => outcome._tag === "Success");
            assert.deepEqual(successes.map((outcome) => outcome.value.disposition).toSorted(), [
              "fork-preserved",
              "head-advanced",
            ]);
            const persisted = yield* Effect.gen(function* () {
              const sql = yield* SqlClient.SqlClient;
              return yield* sql<{
                readonly versionCount: number;
                readonly contentCount: number;
                readonly conflictCount: number;
                readonly headVersionId: string;
              }>`
              SELECT
                (SELECT COUNT(*) FROM collaboration_file_versions
                  WHERE shared_project_id = ${projectId}
                    AND relative_path = ${"src/shared.txt"}) AS "versionCount",
                (SELECT COUNT(*) FROM collaboration_file_contents
                  WHERE shared_project_id = ${projectId}) AS "contentCount",
                (SELECT COUNT(*) FROM collaboration_file_conflicts
                  WHERE shared_project_id = ${projectId}
                    AND relative_path = ${"src/shared.txt"}) AS "conflictCount",
                version_id AS "headVersionId"
              FROM collaboration_file_heads
              WHERE shared_project_id = ${projectId} AND relative_path = ${"src/shared.txt"}
            `;
            }).pipe(Effect.provide(NodeSqliteClient.layer({ filename })));
            assert.equal(persisted[0]?.versionCount, 2);
            assert.equal(persisted[0]?.contentCount, 2);
            assert.equal(persisted[0]?.conflictCount, 1);
            assert.isTrue(
              successes.some(
                (outcome) => outcome.value.version.versionId === persisted[0]?.headVersionId,
              ),
            );
          }),
        );
      },
      (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
    ),
  );

  it.effect("uses append-only tombstones without deleting immutable content or forks", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-file-tombstone-"))),
      (root) => {
        const filename = join(root, "authority.sqlite");
        const activeUsers = new Set(["user-1", "user-2"]);
        const activeDevices = new Set(["device-1:key-1", "device-2:key-2"]);
        const layer = fileLayer(filename, root, activeUsers, activeDevices);
        return Effect.gen(function* () {
          yield* TestClock.setTime(NOW);
          yield* setupDatabase.pipe(Effect.provide(layer));
          const first = yield* Effect.gen(function* () {
            const store = yield* CollaborationFileSyncStore;
            return yield* store.publish({
              principal,
              command: publishCommand({ commandId: "tomb-publish", value: "keep me" }),
            });
          }).pipe(Effect.provide(layer));
          const stale = yield* Effect.gen(function* () {
            const store = yield* CollaborationFileSyncStore;
            return yield* store.tombstone({
              principal: secondPrincipal,
              command: {
                commandId: "tomb-stale",
                sharedProjectId: projectId,
                relativePath: "src/shared.txt",
                deviceKeyId: "key-2",
                expectedHeadRevisionId: null,
              },
            });
          }).pipe(Effect.provide(layer));
          assert.equal(stale.disposition, "tombstone-preserved");
          assert.equal(stale.head?.revisionId, first.version.versionId);
          const accepted = yield* Effect.gen(function* () {
            const store = yield* CollaborationFileSyncStore;
            return yield* store.tombstone({
              principal: secondPrincipal,
              command: {
                commandId: "tomb-current",
                sharedProjectId: projectId,
                relativePath: "src/shared.txt",
                deviceKeyId: "key-2",
                expectedHeadRevisionId: first.version.versionId,
              },
            });
          }).pipe(Effect.provide(layer));
          assert.equal(accepted.disposition, "head-advanced");
          const counts = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{
              readonly contents: number;
              readonly versions: number;
              readonly tombstones: number;
            }>`
              SELECT
                (SELECT COUNT(*) FROM collaboration_file_contents) AS contents,
                (SELECT COUNT(*) FROM collaboration_file_versions) AS versions,
                (SELECT COUNT(*) FROM collaboration_file_tombstones) AS tombstones
            `;
          }).pipe(Effect.provide(layer));
          assert.deepEqual(counts[0], { contents: 1, versions: 1, tombstones: 2 });
        });
      },
      (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
    ),
  );

  it.effect("fails closed after membership or device revocation", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-file-revoke-"))),
      (root) => {
        const filename = join(root, "authority.sqlite");
        const activeUsers = new Set(["user-1", "user-2"]);
        const activeDevices = new Set(["device-1:key-1", "device-2:key-2"]);
        const layer = fileLayer(filename, root, activeUsers, activeDevices);
        return Effect.gen(function* () {
          yield* TestClock.setTime(NOW);
          yield* setupDatabase.pipe(Effect.provide(layer));
          activeDevices.delete("device-1:key-1");
          const deviceError = yield* Effect.gen(function* () {
            const store = yield* CollaborationFileSyncStore;
            return yield* store.publish({
              principal,
              command: publishCommand({ commandId: "revoked-device", value: "no" }),
            });
          }).pipe(Effect.provide(layer), Effect.flip);
          expectFailure(deviceError, "not-authorized");
          activeDevices.add("device-1:key-1");
          activeUsers.delete("user-1");
          const membershipError = yield* Effect.gen(function* () {
            const store = yield* CollaborationFileSyncStore;
            return yield* store.publish({
              principal,
              command: publishCommand({ commandId: "revoked-member", value: "no" }),
            });
          }).pipe(Effect.provide(layer), Effect.flip);
          expectFailure(membershipError, "not-authorized");
        });
      },
      (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
    ),
  );

  it.effect("binds idempotency receipts to the exact command and actor", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-file-receipt-"))),
      (root) => {
        const filename = join(root, "authority.sqlite");
        const activeUsers = new Set(["user-1", "user-2"]);
        const activeDevices = new Set(["device-1:key-1", "device-2:key-2"]);
        const layer = fileLayer(filename, root, activeUsers, activeDevices);
        return Effect.gen(function* () {
          yield* TestClock.setTime(NOW);
          yield* setupDatabase.pipe(Effect.provide(layer));
          const command = publishCommand({ commandId: "receipt-1", value: "one" });
          const first = yield* Effect.gen(function* () {
            const store = yield* CollaborationFileSyncStore;
            return yield* store.publish({ principal, command });
          }).pipe(Effect.provide(layer));
          const replay = yield* Effect.gen(function* () {
            const store = yield* CollaborationFileSyncStore;
            return yield* store.publish({ principal, command });
          }).pipe(Effect.provide(layer));
          assert.equal(replay.disposition, "already-applied");
          assert.equal(replay.version.versionId, first.version.versionId);
          const collision = yield* Effect.gen(function* () {
            const store = yield* CollaborationFileSyncStore;
            return yield* store.publish({
              principal,
              command: publishCommand({ commandId: "receipt-1", value: "different" }),
            });
          }).pipe(Effect.provide(layer), Effect.flip);
          expectFailure(collision, "idempotency-conflict");
        });
      },
      (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
    ),
  );

  it.effect(
    "preserves stale database snapshots as forks while only the fenced current DB head advances",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-file-database-"))),
        (root) => {
          const filename = join(root, "authority.sqlite");
          const activeUsers = new Set(["user-1", "user-2"]);
          const activeDevices = new Set(["device-1:key-1", "device-2:key-2"]);
          const layer = databaseAndFileLayer(filename, root, activeUsers, activeDevices);
          return Effect.gen(function* () {
            yield* TestClock.setTime(NOW);
            yield* setupDatabase.pipe(Effect.provide(layer));
            const { lease, firstSnapshot, secondSnapshot } = yield* Effect.gen(function* () {
              const store = yield* CollaborationDatabaseStore;
              yield* store.configure({
                principal,
                command: {
                  commandId: "db-configure",
                  sharedProjectId: projectId,
                  databaseId: "database-1",
                  relativePath: "data/shared.sqlite",
                  engine: "sqlite",
                  policy: {
                    kind: "serialized-head",
                    fileReplication: "immutable-snapshots-only",
                    leaseLifetimeMillis: 60_000,
                  },
                },
              });
              const lease = yield* store.acquireLease({
                principal,
                command: {
                  commandId: "db-acquire",
                  sharedProjectId: projectId,
                  databaseId: "database-1",
                },
              });
              const makeSnapshot = (value: string, baseContentSha256: string | null) => ({
                sharedProjectId: projectId,
                databaseId: "database-1",
                relativePath: "data/shared.sqlite",
                engine: "sqlite" as const,
                contentSha256: hash(value),
                baseContentSha256,
                schemaSha256: null,
                byteSize: Buffer.byteLength(value),
                consistency: "offline-copy" as const,
                sidecarsExcluded: true as const,
                createdByUserId: "user-1",
                createdByDeviceId: "device-1",
                createdAt: "2026-08-01T12:00:00.000Z",
              });
              const firstSnapshot = makeSnapshot("database-v1", null);
              yield* store.publishHead({
                principal,
                command: {
                  commandId: "db-head-1",
                  update: {
                    sharedProjectId: projectId,
                    databaseId: "database-1",
                    snapshot: firstSnapshot,
                    expectedHeadContentSha256: null,
                    authorUserId: "user-1",
                    authorDeviceId: "device-1",
                    leaseId: lease.leaseId,
                    fencingToken: lease.fencingToken,
                    membershipEpoch: 1,
                  },
                },
              });
              const secondSnapshot = makeSnapshot("database-v2", firstSnapshot.contentSha256);
              yield* store.publishHead({
                principal,
                command: {
                  commandId: "db-head-2",
                  update: {
                    sharedProjectId: projectId,
                    databaseId: "database-1",
                    snapshot: secondSnapshot,
                    expectedHeadContentSha256: firstSnapshot.contentSha256,
                    authorUserId: "user-1",
                    authorDeviceId: "device-1",
                    leaseId: lease.leaseId,
                    fencingToken: lease.fencingToken,
                    membershipEpoch: 1,
                  },
                },
              });
              return { lease, firstSnapshot, secondSnapshot };
            }).pipe(Effect.provide(layer));

            const publishDatabase = (commandId: string, value: string) =>
              Effect.gen(function* () {
                const store = yield* CollaborationFileSyncStore;
                return yield* store.publish({
                  principal,
                  command: {
                    commandId,
                    sharedProjectId: projectId,
                    relativePath: "data/shared.sqlite",
                    deviceKeyId: "key-1",
                    expectedHeadRevisionId: null,
                    manifest: manifest(value),
                    contentKind: {
                      kind: "database",
                      databaseId: "database-1",
                      engine: "sqlite",
                      coordination: "serialized-head",
                      leaseId: lease.leaseId,
                      fencingToken: lease.fencingToken,
                    },
                  },
                });
              }).pipe(Effect.provide(layer));
            assert.equal(firstSnapshot.contentSha256, manifest("database-v1").contentSha256);
            assert.equal(secondSnapshot.contentSha256, manifest("database-v2").contentSha256);
            const stale = yield* publishDatabase("file-db-1", "database-v1");
            assert.equal(stale.disposition, "fork-preserved");
            const current = yield* publishDatabase("file-db-2", "database-v2");
            assert.equal(current.disposition, "head-advanced");

            const badFence = yield* Effect.gen(function* () {
              const store = yield* CollaborationFileSyncStore;
              return yield* store.publish({
                principal,
                command: {
                  commandId: "file-db-bad-fence",
                  sharedProjectId: projectId,
                  relativePath: "data/shared.sqlite",
                  deviceKeyId: "key-1",
                  expectedHeadRevisionId: current.version.versionId,
                  manifest: manifest("database-v3"),
                  contentKind: {
                    kind: "database",
                    databaseId: "database-1",
                    engine: "sqlite",
                    coordination: "serialized-head",
                    leaseId: lease.leaseId,
                    fencingToken: lease.fencingToken + 1,
                  },
                },
              });
            }).pipe(Effect.provide(layer), Effect.flip);
            expectFailure(badFence, "database-authority-invalid");

            const sidecar = yield* Effect.gen(function* () {
              const store = yield* CollaborationFileSyncStore;
              return yield* store.publish({
                principal,
                command: {
                  commandId: "file-db-sidecar",
                  sharedProjectId: projectId,
                  relativePath: "data/shared.sqlite-wal",
                  deviceKeyId: "key-1",
                  expectedHeadRevisionId: null,
                  manifest: manifest("wal"),
                  contentKind: {
                    kind: "database",
                    databaseId: "database-1",
                    engine: "sqlite",
                    coordination: "serialized-head",
                    leaseId: lease.leaseId,
                    fencingToken: lease.fencingToken,
                  },
                },
              });
            }).pipe(Effect.provide(layer), Effect.flip);
            expectFailure(sidecar, "database-sidecar-forbidden");
          });
        },
        (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
      ),
  );

  it.effect("fails closed on stored manifest corruption", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-file-corruption-"))),
      (root) => {
        const filename = join(root, "authority.sqlite");
        const activeUsers = new Set(["user-1", "user-2"]);
        const activeDevices = new Set(["device-1:key-1", "device-2:key-2"]);
        const layer = fileLayer(filename, root, activeUsers, activeDevices);
        return Effect.gen(function* () {
          yield* TestClock.setTime(NOW);
          yield* setupDatabase.pipe(Effect.provide(layer));
          yield* Effect.gen(function* () {
            const store = yield* CollaborationFileSyncStore;
            yield* store.publish({
              principal,
              command: publishCommand({ commandId: "corrupt-1", value: "before" }),
            });
            const sql = yield* SqlClient.SqlClient;
            yield* sql`
              UPDATE collaboration_file_contents SET
                chunk_manifest_json = ${"{}"}, chunk_manifest_sha256 = ${hash("{}")}
              WHERE shared_project_id = ${projectId}
            `;
          }).pipe(Effect.provide(layer));
          const error = yield* Effect.gen(function* () {
            const store = yield* CollaborationFileSyncStore;
            return yield* store.read({
              principal,
              request: {
                sharedProjectId: projectId,
                relativePath: "src/shared.txt",
                deviceKeyId: "key-1",
              },
            });
          }).pipe(Effect.provide(layer), Effect.flip);
          expectFailure(error, "integrity-failure");
        });
      },
      (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
    ),
  );
});
