import {
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationDatabaseBinding,
  CollaborationPrincipal,
  CollaborationProjectMembershipSnapshot,
  SharedProjectId,
} from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";

import {
  CollaborationSqliteManagedSnapshotError,
  makeCollaborationSqliteManagedSnapshot,
} from "./CollaborationSqliteManagedSnapshot.ts";

const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const decodeBinding = Schema.decodeUnknownSync(CollaborationDatabaseBinding);
const encodeBinding = Schema.encodeUnknownSync(CollaborationDatabaseBinding);
const projectId = decodeProjectId("project-sqlite-snapshot");

const sha256File = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");

function time(offsetMillis: number) {
  return new Date(Date.now() + offsetMillis).toISOString();
}

function makeFixture(
  root: string,
  limits: { readonly snapshotMaxBytes?: number; readonly snapshotStorageMaxBytes?: number } = {},
) {
  const principal = decodePrincipal({
    sessionId: "session-sqlite-1",
    sharedProjectId: projectId,
    userId: "user-1",
    deviceId: "device-1",
    membershipEpoch: 1,
    issuedAt: time(-60_000),
    expiresAt: time(600_000),
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
        joinedAt: time(-3_600_000),
      },
    ],
    updatedAt: time(-60_000),
  });
  let binding = decodeBinding({
    sharedProjectId: projectId,
    databaseId: "database-1",
    relativePath: "data/project.sqlite",
    engine: "sqlite",
    policy: {
      kind: "serialized-head",
      fileReplication: "immutable-snapshots-only",
      leaseLifetimeMillis: 900_000,
    },
    headSnapshot: null,
    lastFencingToken: 7,
    activeLease: {
      sharedProjectId: projectId,
      databaseId: "database-1",
      leaseId: "lease-1",
      holderUserId: "user-1",
      holderDeviceId: "device-1",
      membershipEpoch: 1,
      fencingToken: 7,
      grantedAt: time(-60_000),
      expiresAt: time(600_000),
    },
  });
  let exclusiveCalls = 0;
  let deviceKeyBytes = new Uint8Array(44);
  let deviceKeyCalls = 0;
  let swapDeviceKeyAtCall: number | null = null;
  const makeService = makeCollaborationSqliteManagedSnapshot({
    replicaRoot: root,
    membershipAuthority: { getCurrent: () => Effect.succeed(membership) },
    deviceKeyAuthority: {
      getActiveEd25519PublicKey: (lookup) =>
        Effect.sync(() => {
          deviceKeyCalls += 1;
          if (deviceKeyCalls === swapDeviceKeyAtCall) {
            const replacement = new Uint8Array(deviceKeyBytes);
            replacement[0] = replacement[0] === 0 ? 1 : 0;
            deviceKeyBytes = replacement;
          }
          return { ...lookup, publicKeySpkiDer: new Uint8Array(deviceKeyBytes) };
        }),
    },
    databaseAuthority: { getCurrent: () => Effect.sync(() => encodeBinding(binding)) },
    sandboxPathAuthority: { assertContained: () => Effect.void },
    quiescenceAuthority: {
      withExclusive: (_input, effect) =>
        Effect.sync(() => {
          exclusiveCalls += 1;
        }).pipe(Effect.andThen(effect)),
    },
    ...limits,
  });
  const request = {
    operationId: "snapshot-operation-1",
    sharedProjectId: projectId,
    databaseId: "database-1",
    deviceKeyId: "key-1",
    leaseId: "lease-1",
    fencingToken: 7,
    membershipEpoch: 1,
    expectedAuthorityHeadContentSha256: null,
  } as const;
  return {
    principal,
    request,
    makeService,
    getBinding: () => binding,
    setBinding: (next: typeof binding) => {
      binding = next;
    },
    getExclusiveCalls: () => exclusiveCalls,
    swapDeviceKeyAtNextRecheck: () => {
      swapDeviceKeyAtCall = deviceKeyCalls + 2;
    },
  };
}

function expectFailure(error: unknown, reason: CollaborationSqliteManagedSnapshotError["reason"]) {
  assert.instanceOf(error, CollaborationSqliteManagedSnapshotError);
  assert.equal((error as CollaborationSqliteManagedSnapshotError).reason, reason);
}

describe("CollaborationSqliteManagedSnapshot", () => {
  it.effect(
    "captures a transactionally consistent WAL database into one immutable SQLite file",
    () =>
      Effect.acquireUseRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-sqlite-capture-"))),
        (root) =>
          Effect.gen(function* () {
            yield* TestClock.setTime(Date.now());
            yield* Effect.promise(() => mkdir(join(root, "data"), { recursive: true }));
            const path = join(root, "data", "project.sqlite");
            const writer = new DatabaseSync(path);
            writer.exec(
              "PRAGMA journal_mode=WAL; CREATE TABLE notes(value TEXT NOT NULL); INSERT INTO notes VALUES ('from-wal');",
            );
            const fixture = makeFixture(root);
            const service = yield* fixture.makeService;
            const captured = yield* service.capture({
              principal: fixture.principal,
              request: fixture.request,
            });
            writer.close();
            assert.equal(captured.disposition, "head-candidate");
            assert.equal(captured.artifact.sourceJournalMode, "wal");
            assert.equal(captured.artifact.sidecarsCopied, false);
            assert.equal(captured.artifact.snapshot.consistency, "online-backup");
            assert.isAbove(captured.artifact.pageCount, 0);
            assert.equal(
              captured.artifact.pageSize * captured.artifact.pageCount,
              captured.artifact.snapshot.byteSize,
            );
          }),
        (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
      ),
  );

  it.effect("restores only through exclusive quiescence and retains the replaced replica", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-sqlite-restore-"))),
      (root) =>
        Effect.gen(function* () {
          yield* TestClock.setTime(Date.now());
          yield* Effect.promise(() => mkdir(join(root, "data"), { recursive: true }));
          const path = join(root, "data", "project.sqlite");
          const database = new DatabaseSync(path);
          database.exec(
            "CREATE TABLE notes(value TEXT NOT NULL); INSERT INTO notes VALUES ('head');",
          );
          database.close();
          const fixture = makeFixture(root);
          const service = yield* fixture.makeService;
          const captured = yield* service.capture({
            principal: fixture.principal,
            request: fixture.request,
          });
          const local = new DatabaseSync(path);
          local.exec("UPDATE notes SET value='local-change'");
          local.close();
          const localHash = yield* Effect.promise(() => sha256File(path));
          fixture.setBinding({
            ...fixture.getBinding(),
            headSnapshot: captured.artifact.snapshot,
          });
          const restored = yield* service.restore({
            principal: fixture.principal,
            request: {
              ...fixture.request,
              operationId: "restore-operation-1",
              expectedAuthorityHeadContentSha256: captured.artifact.snapshot.contentSha256,
              expectedReplicaContentSha256: localHash,
              sourceDisposition: "canonical-head",
              artifact: captured.artifact,
            },
          });
          assert.equal(restored.status, "restored");
          if (restored.status !== "restored") return;
          assert.equal(restored.replacedContentSha256, localHash);
          assert.equal(restored.recoveryRetained, true);
          assert.equal(fixture.getExclusiveCalls(), 1);
          const installed = new DatabaseSync(path, { readOnly: true });
          assert.deepEqual(installed.prepare("SELECT value FROM notes").get(), { value: "head" });
          installed.close();
        }),
      (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
    ),
  );

  it.effect("returns an explicit fork conflict instead of overwriting a changed replica", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-sqlite-conflict-"))),
      (root) =>
        Effect.gen(function* () {
          yield* TestClock.setTime(Date.now());
          yield* Effect.promise(() => mkdir(join(root, "data"), { recursive: true }));
          const path = join(root, "data", "project.sqlite");
          const database = new DatabaseSync(path);
          database.exec(
            "CREATE TABLE notes(value TEXT NOT NULL); INSERT INTO notes VALUES ('head');",
          );
          database.close();
          const fixture = makeFixture(root);
          const service = yield* fixture.makeService;
          const captured = yield* service.capture({
            principal: fixture.principal,
            request: fixture.request,
          });
          fixture.setBinding({
            ...fixture.getBinding(),
            headSnapshot: captured.artifact.snapshot,
          });
          const result = yield* service.restore({
            principal: fixture.principal,
            request: {
              ...fixture.request,
              operationId: "restore-operation-conflict",
              expectedAuthorityHeadContentSha256: captured.artifact.snapshot.contentSha256,
              expectedReplicaContentSha256: "0".repeat(64),
              sourceDisposition: "canonical-head",
              artifact: captured.artifact,
            },
          });
          assert.equal(result.status, "conflict");
          if (result.status !== "conflict") return;
          assert.equal(result.reason, "replica-content-changed");
          assert.equal(result.forkRetained, true);
        }),
      (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
    ),
  );

  it.effect("fails closed when an active SQLite sidecar exists", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-sqlite-sidecar-"))),
      (root) =>
        Effect.gen(function* () {
          yield* TestClock.setTime(Date.now());
          yield* Effect.promise(() => mkdir(join(root, "data"), { recursive: true }));
          const path = join(root, "data", "project.sqlite");
          const database = new DatabaseSync(path);
          database.exec(
            "CREATE TABLE notes(value TEXT NOT NULL); INSERT INTO notes VALUES ('head');",
          );
          database.close();
          const fixture = makeFixture(root);
          const service = yield* fixture.makeService;
          const captured = yield* service.capture({
            principal: fixture.principal,
            request: fixture.request,
          });
          fixture.setBinding({
            ...fixture.getBinding(),
            headSnapshot: captured.artifact.snapshot,
          });
          yield* Effect.promise(() => writeFile(`${path}-WAL`, "not-a-live-wal"));
          const replicaHash = yield* Effect.promise(() => sha256File(path));
          const error = yield* service
            .restore({
              principal: fixture.principal,
              request: {
                ...fixture.request,
                operationId: "restore-operation-sidecar",
                expectedAuthorityHeadContentSha256: captured.artifact.snapshot.contentSha256,
                expectedReplicaContentSha256: replicaHash,
                sourceDisposition: "canonical-head",
                artifact: captured.artifact,
              },
            })
            .pipe(Effect.flip);
          expectFailure(error, "sidecar-active");
        }),
      (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
    ),
  );

  it.effect("rejects same-ID device-key replacement across capture authority rechecks", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-sqlite-key-swap-"))),
      (root) =>
        Effect.gen(function* () {
          yield* TestClock.setTime(Date.now());
          yield* Effect.promise(() => mkdir(join(root, "data"), { recursive: true }));
          const path = join(root, "data", "project.sqlite");
          const database = new DatabaseSync(path);
          database.exec("CREATE TABLE notes(value TEXT NOT NULL)");
          database.close();
          const fixture = makeFixture(root);
          const service = yield* fixture.makeService;
          fixture.swapDeviceKeyAtNextRecheck();
          const error = yield* service
            .capture({ principal: fixture.principal, request: fixture.request })
            .pipe(Effect.flip);
          expectFailure(error, "authority-changed");
        }),
      (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
    ),
  );

  it.effect("fails closed after a server-clock rollback", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-sqlite-clock-"))),
      (root) =>
        Effect.gen(function* () {
          const now = Date.now();
          yield* TestClock.setTime(now);
          yield* Effect.promise(() => mkdir(join(root, "data"), { recursive: true }));
          const path = join(root, "data", "project.sqlite");
          const database = new DatabaseSync(path);
          database.exec("CREATE TABLE notes(value TEXT NOT NULL)");
          database.close();
          const fixture = makeFixture(root);
          const service = yield* fixture.makeService;
          yield* service.capture({ principal: fixture.principal, request: fixture.request });
          yield* TestClock.setTime(now - 1);
          const error = yield* service
            .capture({
              principal: fixture.principal,
              request: { ...fixture.request, operationId: "clock-rollback-capture" },
            })
            .pipe(Effect.flip);
          expectFailure(error, "lease-invalid");
        }),
      (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
    ),
  );

  it.effect("bounds retained artifact, staging, and recovery storage per database", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-sqlite-storage-"))),
      (root) =>
        Effect.gen(function* () {
          yield* TestClock.setTime(Date.now());
          yield* Effect.promise(() => mkdir(join(root, "data"), { recursive: true }));
          const path = join(root, "data", "project.sqlite");
          const database = new DatabaseSync(path);
          database.exec(
            "PRAGMA page_size=4096; CREATE TABLE notes(value TEXT NOT NULL); INSERT INTO notes VALUES ('first')",
          );
          database.close();
          const fixture = makeFixture(root, {
            snapshotMaxBytes: 16_384,
            snapshotStorageMaxBytes: 16_384,
          });
          const service = yield* fixture.makeService;
          yield* service.capture({ principal: fixture.principal, request: fixture.request });
          const changed = new DatabaseSync(path);
          changed.exec("UPDATE notes SET value='second'");
          changed.close();
          const error = yield* service
            .capture({
              principal: fixture.principal,
              request: { ...fixture.request, operationId: "storage-quota-capture" },
            })
            .pipe(Effect.flip);
          expectFailure(error, "quota-exceeded");
        }),
      (root) => Effect.promise(() => rm(root, { recursive: true, force: true })),
    ),
  );
});
