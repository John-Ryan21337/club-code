import {
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationPrincipal,
  SharedProjectId,
} from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { runMigrations } from "../persistence/Migrations.ts";
import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import {
  CollaborationDeviceKeyStore,
  CollaborationDeviceKeyStoreError,
  CollaborationDeviceKeyStoreLive,
  collaborationDeviceEnrollmentProofBytes,
  type CollaborationDeviceKeyStoreShape,
} from "./CollaborationDeviceKeyStore.ts";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const memoryLayer = CollaborationDeviceKeyStoreLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

function fileLayer(filename: string) {
  return CollaborationDeviceKeyStoreLive.pipe(
    Layer.provideMerge(NodeSqliteClient.layer({ filename, busyTimeoutMs: 15_000 })),
  );
}

function principal(project: string, userId = "owner-1", deviceId = `device-${userId}`, epoch = 1) {
  return decodePrincipal({
    sessionId: `session-${userId}-${deviceId}`,
    sharedProjectId: project,
    userId,
    deviceId,
    membershipEpoch: epoch,
    issuedAt: "2026-08-01T11:30:00.000Z",
    expiresAt: "2026-08-01T12:30:00.000Z",
  });
}

function seedProject(project: string, users: ReadonlyArray<string> = ["owner-1"]) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO collaboration_projects(shared_project_id, membership_epoch, updated_at)
      VALUES (${project}, 1, ${"2026-08-01T11:00:00.000Z"})
    `;
    for (const userId of users) {
      yield* sql`
        INSERT INTO collaboration_project_members(
          shared_project_id, user_id, display_name, role, permissions_json, joined_at
        ) VALUES (
          ${project}, ${userId}, ${userId}, ${"owner"},
          ${JSON.stringify(COLLABORATION_ROLE_PERMISSIONS.owner)},
          ${"2026-08-01T11:00:00.000Z"}
        )
      `;
    }
  });
}

function keyPair() {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey,
    publicKeySpkiDer: pair.publicKey.export({ format: "der", type: "spki" }).toString("base64url"),
  };
}

function expectFailure(error: unknown, reason: CollaborationDeviceKeyStoreError["reason"]) {
  assert.instanceOf(error, CollaborationDeviceKeyStoreError);
  assert.equal((error as CollaborationDeviceKeyStoreError).reason, reason);
}

function enroll(
  store: CollaborationDeviceKeyStoreShape,
  actor: ReturnType<typeof principal>,
  commandSuffix: string,
  keys = keyPair(),
) {
  return Effect.gen(function* () {
    const begun = yield* store.beginEnrollment({
      principal: actor,
      request: {
        commandId: `begin-${commandSuffix}`,
        sharedProjectId: actor.sharedProjectId,
        publicKeySpkiDer: keys.publicKeySpkiDer,
      },
    });
    assert.isNotNull(begun.nonce);
    const nonce = begun.nonce!;
    const proofSignature = sign(
      null,
      collaborationDeviceEnrollmentProofBytes({ challenge: begun.challenge, nonce }),
      keys.privateKey,
    ).toString("base64url");
    const completed = yield* store.completeEnrollment({
      principal: actor,
      request: {
        commandId: `complete-${commandSuffix}`,
        sharedProjectId: actor.sharedProjectId,
        challengeId: begun.challenge.challengeId,
        nonce,
        proofSignature,
      },
    });
    return { begun, completed, keys, proofSignature };
  });
}

describe("CollaborationDeviceKeyStore", () => {
  it.effect("enrolls by proof of possession and stores neither nonce nor private key", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-enroll");
      const store = yield* CollaborationDeviceKeyStore;
      const actor = principal("project-enroll");
      const first = yield* enroll(store, actor, "one");

      assert.equal(first.completed.disposition, "activated");
      const active = yield* store.getActiveEd25519PublicKey({
        sharedProjectId: decodeProjectId("project-enroll"),
        userId: actor.userId,
        deviceId: actor.deviceId,
        deviceKeyId: first.completed.key.deviceKeyId,
        membershipEpoch: actor.membershipEpoch,
      });
      assert.deepEqual(
        Buffer.from(active!.publicKeySpkiDer).toString("base64url"),
        first.keys.publicKeySpkiDer,
      );

      const replayBegin = yield* store.beginEnrollment({
        principal: actor,
        request: {
          commandId: "begin-one",
          sharedProjectId: actor.sharedProjectId,
          publicKeySpkiDer: first.keys.publicKeySpkiDer,
        },
      });
      assert.equal(replayBegin.disposition, "already-applied");
      assert.equal(replayBegin.nonce, null);

      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{
        readonly nonceSha256: string;
        readonly keyBytes: number;
      }>`
        SELECT c.nonce_sha256 AS "nonceSha256", length(k.public_key_spki_der) AS "keyBytes"
        FROM collaboration_device_enrollment_challenges c
        JOIN collaboration_device_keys k ON k.device_key_id = c.device_key_id
      `;
      assert.match(rows[0]!.nonceSha256, /^[a-f0-9]{64}$/);
      assert.notEqual(rows[0]!.nonceSha256, first.begun.nonce);
      assert.equal(rows[0]!.keyBytes, 44);
      const columns = yield* sql<{
        readonly name: string;
      }>`PRAGMA table_info(collaboration_device_keys)`;
      assert.equal(
        columns.some((column) => /private|secret|nonce/i.test(column.name)),
        false,
      );
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("rotates by revoking the old key before exposing the new authority", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-rotate");
      const store = yield* CollaborationDeviceKeyStore;
      const actor = principal("project-rotate");
      const first = yield* enroll(store, actor, "first");
      yield* TestClock.adjust("1 second");
      const second = yield* enroll(store, actor, "second");

      const lookup = (deviceKeyId: typeof first.completed.key.deviceKeyId) =>
        store.getActiveEd25519PublicKey({
          sharedProjectId: decodeProjectId("project-rotate"),
          userId: actor.userId,
          deviceId: actor.deviceId,
          deviceKeyId,
          membershipEpoch: actor.membershipEpoch,
        });
      assert.isNull(yield* lookup(first.completed.key.deviceKeyId));
      assert.isNotNull(yield* lookup(second.completed.key.deviceKeyId));

      const sql = yield* SqlClient.SqlClient;
      const count = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM collaboration_device_keys
        WHERE shared_project_id = ${"project-rotate"} AND device_id = ${actor.deviceId}
          AND revoked_at IS NULL
      `;
      assert.equal(count[0]!.count, 1);
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("revokes immediately, replays idempotently, and rejects cross-project lookup", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-revoke");
      const store = yield* CollaborationDeviceKeyStore;
      const actor = principal("project-revoke");
      const enrolled = yield* enroll(store, actor, "revoke");
      const request = {
        commandId: "revoke-one",
        sharedProjectId: actor.sharedProjectId,
        deviceKeyId: enrolled.completed.key.deviceKeyId,
      };
      const revoked = yield* store.revokeKey({ principal: actor, request });
      const replay = yield* store.revokeKey({ principal: actor, request });
      assert.equal(revoked.disposition, "revoked");
      assert.equal(replay.disposition, "already-applied");
      assert.isNotNull(revoked.key.revokedAt);
      assert.isNull(
        yield* store.getActiveEd25519PublicKey({
          sharedProjectId: decodeProjectId("project-revoke"),
          userId: actor.userId,
          deviceId: actor.deviceId,
          deviceKeyId: enrolled.completed.key.deviceKeyId,
          membershipEpoch: actor.membershipEpoch,
        }),
      );
      assert.isNull(
        yield* store.getActiveEd25519PublicKey({
          sharedProjectId: decodeProjectId("other-project"),
          userId: actor.userId,
          deviceId: actor.deviceId,
          deviceKeyId: enrolled.completed.key.deviceKeyId,
          membershipEpoch: actor.membershipEpoch,
        }),
      );
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("uses server time and rejects expired challenges and stale membership epochs", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-expiry");
      const store = yield* CollaborationDeviceKeyStore;
      const actor = principal("project-expiry");
      const keys = keyPair();
      const begun = yield* store.beginEnrollment({
        principal: actor,
        request: {
          commandId: "begin-expiry",
          sharedProjectId: actor.sharedProjectId,
          publicKeySpkiDer: keys.publicKeySpkiDer,
        },
      });
      yield* TestClock.adjust("6 minutes");
      const signature = sign(
        null,
        collaborationDeviceEnrollmentProofBytes({
          challenge: begun.challenge,
          nonce: begun.nonce!,
        }),
        keys.privateKey,
      ).toString("base64url");
      const expired = yield* store
        .completeEnrollment({
          principal: actor,
          request: {
            commandId: "complete-expiry",
            sharedProjectId: actor.sharedProjectId,
            challengeId: begun.challenge.challengeId,
            nonce: begun.nonce!,
            proofSignature: signature,
          },
        })
        .pipe(Effect.flip);
      expectFailure(expired, "challenge-expired");

      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE collaboration_projects SET membership_epoch = 2
        WHERE shared_project_id = ${"project-expiry"}
      `;
      const stale = yield* store
        .beginEnrollment({
          principal: actor,
          request: {
            commandId: "begin-stale",
            sharedProjectId: actor.sharedProjectId,
            publicKeySpkiDer: keys.publicKeySpkiDer,
          },
        })
        .pipe(Effect.flip);
      expectFailure(stale, "membership-epoch-mismatch");
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("does not consume a challenge when proof of possession is invalid", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-proof");
      const store = yield* CollaborationDeviceKeyStore;
      const actor = principal("project-proof");
      const keys = keyPair();
      const begun = yield* store.beginEnrollment({
        principal: actor,
        request: {
          commandId: "begin-proof",
          sharedProjectId: actor.sharedProjectId,
          publicKeySpkiDer: keys.publicKeySpkiDer,
        },
      });
      const wrong = keyPair();
      const request = {
        commandId: "complete-proof",
        sharedProjectId: actor.sharedProjectId,
        challengeId: begun.challenge.challengeId,
        nonce: begun.nonce!,
        proofSignature: sign(
          null,
          collaborationDeviceEnrollmentProofBytes({
            challenge: begun.challenge,
            nonce: begun.nonce!,
          }),
          wrong.privateKey,
        ).toString("base64url"),
      };
      const invalid = yield* store
        .completeEnrollment({ principal: actor, request })
        .pipe(Effect.flip);
      expectFailure(invalid, "proof-invalid");
      const completed = yield* store.completeEnrollment({
        principal: actor,
        request: {
          ...request,
          proofSignature: sign(
            null,
            collaborationDeviceEnrollmentProofBytes({
              challenge: begun.challenge,
              nonce: begun.nonce!,
            }),
            keys.privateKey,
          ).toString("base64url"),
        },
      });
      assert.equal(completed.disposition, "activated");
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("never resurrects a key after the project membership epoch changes", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-key-epoch");
      const store = yield* CollaborationDeviceKeyStore;
      const actor = principal("project-key-epoch");
      const enrolled = yield* enroll(store, actor, "epoch");
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE collaboration_projects SET membership_epoch = 2
        WHERE shared_project_id = ${"project-key-epoch"}
      `;
      assert.isNull(
        yield* store.getActiveEd25519PublicKey({
          sharedProjectId: decodeProjectId("project-key-epoch"),
          userId: actor.userId,
          deviceId: actor.deviceId,
          deviceKeyId: enrolled.completed.key.deviceKeyId,
          membershipEpoch: 2,
        }),
      );
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("binds one project device identity to exactly one user", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-device-binding", ["owner-1", "owner-2"]);
      const store = yield* CollaborationDeviceKeyStore;
      const firstActor = principal("project-device-binding", "owner-1", "shared-device");
      const secondActor = principal("project-device-binding", "owner-2", "shared-device");
      yield* enroll(store, firstActor, "binding-first");
      const keys = keyPair();
      const begun = yield* store.beginEnrollment({
        principal: secondActor,
        request: {
          commandId: "begin-binding-second",
          sharedProjectId: secondActor.sharedProjectId,
          publicKeySpkiDer: keys.publicKeySpkiDer,
        },
      });
      const conflict = yield* store
        .completeEnrollment({
          principal: secondActor,
          request: {
            commandId: "complete-binding-second",
            sharedProjectId: secondActor.sharedProjectId,
            challengeId: begun.challenge.challengeId,
            nonce: begun.nonce!,
            proofSignature: sign(
              null,
              collaborationDeviceEnrollmentProofBytes({
                challenge: begun.challenge,
                nonce: begun.nonce!,
              }),
              keys.privateKey,
            ).toString("base64url"),
          },
        })
        .pipe(Effect.flip);
      expectFailure(conflict, "device-identity-conflict");
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("binds idempotency to user, device, and membership epoch", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-receipt", ["owner-1", "owner-2"]);
      const store = yield* CollaborationDeviceKeyStore;
      const firstActor = principal("project-receipt");
      const secondActor = principal("project-receipt", "owner-2");
      const keys = keyPair();
      const request = {
        commandId: "same-command",
        sharedProjectId: firstActor.sharedProjectId,
        publicKeySpkiDer: keys.publicKeySpkiDer,
      };
      yield* store.beginEnrollment({ principal: firstActor, request });
      const conflict = yield* store
        .beginEnrollment({ principal: secondActor, request })
        .pipe(Effect.flip);
      expectFailure(conflict, "command-conflict");
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("fails closed when persisted key bytes are not canonical Ed25519", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* seedProject("project-corruption");
      const store = yield* CollaborationDeviceKeyStore;
      const actor = principal("project-corruption");
      const enrolled = yield* enroll(store, actor, "corruption");
      const sql = yield* SqlClient.SqlClient;
      yield* sql`
        UPDATE collaboration_device_keys
        SET public_key_spki_der = ${Buffer.alloc(44)}
        WHERE device_key_id = ${enrolled.completed.key.deviceKeyId}
      `;
      const error = yield* store
        .getActiveEd25519PublicKey({
          sharedProjectId: decodeProjectId("project-corruption"),
          userId: actor.userId,
          deviceId: actor.deviceId,
          deviceKeyId: enrolled.completed.key.deviceKeyId,
          membershipEpoch: actor.membershipEpoch,
        })
        .pipe(Effect.flip);
      expectFailure(error, "stored-corruption");
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("serializes two-client rotation races with exactly one active key", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-device-keys-"))),
      (directory) => {
        const filename = join(directory, "state.sqlite");
        const setup = fileLayer(filename);
        const firstClient = fileLayer(filename);
        const secondClient = fileLayer(filename);
        const actor = principal("project-race");
        return Effect.gen(function* () {
          yield* TestClock.setTime(NOW);
          const prepared = yield* Effect.gen(function* () {
            yield* runMigrations();
            yield* seedProject("project-race");
            const store = yield* CollaborationDeviceKeyStore;
            const prepare = (suffix: string) => {
              const keys = keyPair();
              return store
                .beginEnrollment({
                  principal: actor,
                  request: {
                    commandId: `begin-race-${suffix}`,
                    sharedProjectId: actor.sharedProjectId,
                    publicKeySpkiDer: keys.publicKeySpkiDer,
                  },
                })
                .pipe(Effect.map((begun) => ({ begun, keys, suffix })));
            };
            return yield* Effect.all([prepare("one"), prepare("two")]);
          }).pipe(Effect.provide(setup));

          const complete = (
            preparedKey: (typeof prepared)[number],
            layer: ReturnType<typeof fileLayer>,
          ) =>
            Effect.gen(function* () {
              const store = yield* CollaborationDeviceKeyStore;
              const { begun, keys, suffix } = preparedKey;
              const nonce = begun.nonce!;
              return yield* store.completeEnrollment({
                principal: actor,
                request: {
                  commandId: `complete-race-${suffix}`,
                  sharedProjectId: actor.sharedProjectId,
                  challengeId: begun.challenge.challengeId,
                  nonce,
                  proofSignature: sign(
                    null,
                    collaborationDeviceEnrollmentProofBytes({ challenge: begun.challenge, nonce }),
                    keys.privateKey,
                  ).toString("base64url"),
                },
              });
            }).pipe(Effect.provide(layer));

          const completed = yield* Effect.all(
            [complete(prepared[0]!, firstClient), complete(prepared[1]!, secondClient)],
            { concurrency: "unbounded" },
          );
          assert.equal(completed.length, 2);
          const counts = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{ readonly active: number; readonly total: number }>`
              SELECT COUNT(*) FILTER (WHERE revoked_at IS NULL) AS active,
                COUNT(*) AS total
              FROM collaboration_device_keys
              WHERE shared_project_id = ${"project-race"} AND device_id = ${actor.deviceId}
            `;
          }).pipe(Effect.provide(fileLayer(filename)));
          assert.equal(counts[0]!.active, 1);
          assert.equal(counts[0]!.total, 2);
        });
      },
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    ),
  );
});
