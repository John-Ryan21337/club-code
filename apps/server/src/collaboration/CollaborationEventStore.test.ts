import {
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationDeviceKeyId,
  CollaborationEventProposal,
  CollaborationPrincipal,
  CollaborationProjectMembershipSnapshot,
  SharedProjectId,
} from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Buffer } from "node:buffer";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
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
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import {
  admitCollaborationEventProposal,
  type CollaborationActiveDevicePublicKey,
  CollaborationDeviceKeyAuthority,
  collaborationEventProposalSignatureBytes,
} from "./CollaborationEventAdmission.ts";
import { CollaborationMembershipAuthority } from "./CollaborationAuthorization.ts";
import {
  CollaborationEventStore,
  CollaborationEventStoreError,
  CollaborationEventStoreLive,
} from "./CollaborationEventStore.ts";

const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const decodeProposal = Schema.decodeUnknownSync(CollaborationEventProposal);
const decodeDeviceKeyId = Schema.decodeUnknownSync(CollaborationDeviceKeyId);
const isStoreError = (value: unknown): value is CollaborationEventStoreError =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "CollaborationEventStoreError";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const PUBLIC_KEY_DER = publicKey.export({ format: "der", type: "spki" });
const NOW_EPOCH_MILLIS = Date.parse("2026-07-30T12:00:30.000Z");

function projectPrincipal(sharedProjectId: ReturnType<typeof decodeProjectId>) {
  return decodePrincipal({
    sessionId: "session-1",
    sharedProjectId,
    userId: "user-1",
    deviceId: "device-1",
    membershipEpoch: 1,
    issuedAt: "2026-07-30T11:30:00.000Z",
    expiresAt: "2026-07-30T12:30:00.000Z",
  });
}

function projectMembership(sharedProjectId: ReturnType<typeof decodeProjectId>) {
  return decodeMembership({
    sharedProjectId,
    epoch: 1,
    members: [
      {
        userId: "user-1",
        displayName: "Operator One",
        role: "operator",
        permissions: [...COLLABORATION_ROLE_PERMISSIONS.operator],
        joinedAt: "2026-07-30T11:00:00.000Z",
      },
    ],
    updatedAt: "2026-07-30T11:00:00.000Z",
  });
}

function withProjectAuthorities<A, E, R>(
  sharedProjectId: ReturnType<typeof decodeProjectId>,
  effect: Effect.Effect<
    A,
    E,
    R | CollaborationDeviceKeyAuthority | CollaborationMembershipAuthority
  >,
) {
  const activeKey: CollaborationActiveDevicePublicKey = {
    sharedProjectId,
    userId: projectPrincipal(sharedProjectId).userId,
    deviceId: projectPrincipal(sharedProjectId).deviceId,
    deviceKeyId: decodeDeviceKeyId("device-key-1"),
    membershipEpoch: 1,
    publicKeySpkiDer: PUBLIC_KEY_DER,
  };
  return effect.pipe(
    Effect.provideService(CollaborationMembershipAuthority, {
      getCurrent: () => Effect.succeed(projectMembership(sharedProjectId)),
    }),
    Effect.provideService(CollaborationDeviceKeyAuthority, {
      getActiveEd25519PublicKey: () => Effect.succeed(activeKey),
    }),
  );
}

function admittedEvent(
  projectName: string,
  eventNumber: number,
  overrides: {
    readonly eventId?: string;
    readonly commandId?: string;
    readonly body?: string;
  } = {},
) {
  const sharedProjectId = decodeProjectId(projectName);
  const body = overrides.body ?? `message ${eventNumber}`;
  const payloadJson = JSON.stringify({ body });
  const unsignedProposal = decodeProposal({
    version: 1,
    sharedProjectId,
    eventId: overrides.eventId ?? `event-${eventNumber}`,
    commandId: overrides.commandId ?? `command-${eventNumber}`,
    membershipEpoch: 1,
    actor: {
      kind: "operator",
      userId: "user-1",
      deviceId: "device-1",
    },
    deviceKeyId: "device-key-1",
    type: "operator-chat.message",
    payloadJson,
    payloadSha256: createHash("sha256").update(payloadJson).digest("hex"),
    authorSignature: "A".repeat(86),
    causationEventId: eventNumber === 1 ? null : `event-${eventNumber - 1}`,
    correlationId: null,
    occurredAt: new Date(Date.parse("2026-07-30T12:00:00.000Z") + eventNumber).toISOString(),
  });
  const proposal = decodeProposal({
    ...unsignedProposal,
    authorSignature: sign(
      null,
      collaborationEventProposalSignatureBytes(unsignedProposal),
      privateKey,
    ).toString("base64url"),
  });
  return withProjectAuthorities(
    sharedProjectId,
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW_EPOCH_MILLIS);
      return yield* admitCollaborationEventProposal({
        principal: projectPrincipal(sharedProjectId),
        targetProjectId: sharedProjectId,
        proposal,
      });
    }),
  );
}

function replayRequest(projectName: string, afterSequence: number, limit?: number) {
  const sharedProjectId = decodeProjectId(projectName);
  return Effect.gen(function* () {
    yield* TestClock.setTime(NOW_EPOCH_MILLIS);
    return {
      principal: projectPrincipal(sharedProjectId),
      request: {
        sharedProjectId,
        afterSequence,
        ...(limit === undefined ? {} : { limit }),
      },
    };
  });
}

const membershipLayer = Layer.succeed(CollaborationMembershipAuthority, {
  getCurrent: (sharedProjectId) => Effect.succeed(projectMembership(sharedProjectId)),
});
const memoryLayer = Layer.merge(
  CollaborationEventStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  membershipLayer,
);

describe("CollaborationEventStore", () => {
  it.effect("assigns project-local sequences and replays bounded monotonic pages", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      const first = yield* store.append(yield* admittedEvent("project-pages", 1));
      const second = yield* store.append(yield* admittedEvent("project-pages", 2));

      assert.equal(first.sequence, 1);
      assert.equal(first.previousEventSha256, null);
      assert.equal(first.deviceKeyId, "device-key-1");
      assert.equal(second.sequence, 2);
      assert.match(second.previousEventSha256 ?? "", /^[a-f0-9]{64}$/);

      const pageOne = yield* store.replay(yield* replayRequest("project-pages", 0, 1));
      assert.deepStrictEqual(
        pageOne.events.map((event) => event.eventId),
        ["event-1"],
      );
      assert.equal(pageOne.nextCursor, 1);
      assert.equal(pageOne.hasMore, true);

      const pageTwo = yield* store.replay(
        yield* replayRequest("project-pages", pageOne.nextCursor, 1),
      );
      assert.deepStrictEqual(
        pageTwo.events.map((event) => event.eventId),
        ["event-2"],
      );
      assert.equal(pageTwo.nextCursor, 2);
      assert.equal(pageTwo.hasMore, false);
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("serializes concurrent same-project appends without sequence gaps", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      const admitted = [];
      for (let eventNumber = 1; eventNumber <= 8; eventNumber += 1) {
        admitted.push(yield* admittedEvent("project-concurrent", eventNumber));
      }
      const appended = yield* Effect.all(
        admitted.map((event) => store.append(event)),
        { concurrency: "unbounded" },
      );
      assert.deepStrictEqual(
        appended.map((event) => event.sequence).toSorted((left, right) => left - right),
        [1, 2, 3, 4, 5, 6, 7, 8],
      );
      const replay = yield* store.replay(yield* replayRequest("project-concurrent", 0));
      assert.deepStrictEqual(
        replay.events.map((event) => event.sequence),
        [1, 2, 3, 4, 5, 6, 7, 8],
      );
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("bounds replay by encoded bytes as well as event count", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      for (let eventNumber = 1; eventNumber <= 40; eventNumber += 1) {
        yield* store.append(
          yield* admittedEvent("project-byte-budget", eventNumber, {
            body: `${eventNumber}:`.padEnd(32_000, "x"),
          }),
        );
      }
      const page = yield* store.replay(yield* replayRequest("project-byte-budget", 0));
      assert.equal(page.hasMore, true);
      assert.isAbove(page.events.length, 0);
      assert.isBelow(page.events.length, 40);
      assert.isAtMost(Buffer.byteLength(JSON.stringify(page), "utf8"), 1_048_576);
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("returns an exact retry once and rejects conflicting idempotency keys", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      const original = yield* admittedEvent("project-idempotency", 1);
      const first = yield* store.append(original);
      const retry = yield* store.append(original);
      assert.deepStrictEqual(retry, first);

      const conflict = yield* Effect.result(
        store.append(
          yield* admittedEvent("project-idempotency", 2, {
            commandId: "command-1",
          }),
        ),
      );
      assert.equal(conflict._tag, "Failure");
      if (conflict._tag === "Failure") {
        assert.ok(isStoreError(conflict.failure));
        assert.equal(conflict.failure.reason, "idempotency-conflict");
      }
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("rejects forged or post-admission-mutated append capabilities", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      const admitted = yield* admittedEvent("project-admission-proof", 1);
      const forged = { ...admitted };
      const forgedResult = yield* Effect.result(store.append(forged));
      assert.equal(forgedResult._tag, "Failure");
      if (forgedResult._tag === "Failure") {
        assert.ok(isStoreError(forgedResult.failure));
        assert.equal(forgedResult.failure.reason, "invalid-admitted-event");
      }

      (admitted.proposal as { eventId: string }).eventId = "mutated-after-admission";
      const mutatedResult = yield* Effect.result(store.append(admitted));
      assert.equal(mutatedResult._tag, "Failure");
      if (mutatedResult._tag === "Failure") {
        assert.ok(isStoreError(mutatedResult.failure));
        assert.equal(mutatedResult.failure.reason, "invalid-admitted-event");
      }
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("isolates identical event and command IDs by project", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      yield* store.append(yield* admittedEvent("project-alpha", 1));
      yield* store.append(yield* admittedEvent("project-beta", 1));

      const alpha = yield* store.replay(yield* replayRequest("project-alpha", 0));
      const beta = yield* store.replay(yield* replayRequest("project-beta", 0));
      assert.equal(alpha.events.length, 1);
      assert.equal(beta.events.length, 1);
      assert.equal(alpha.events[0]?.sharedProjectId, "project-alpha");
      assert.equal(beta.events[0]?.sharedProjectId, "project-beta");
      assert.equal(alpha.events[0]?.sequence, 1);
      assert.equal(beta.events[0]?.sequence, 1);
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("rejects a cross-project replay before membership lookup", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      yield* store.append(yield* admittedEvent("project-replay-alpha", 1));
      yield* store.append(yield* admittedEvent("project-replay-beta", 1));
      const alphaInput = yield* replayRequest("project-replay-alpha", 0);
      let membershipLookups = 0;
      const result = yield* Effect.result(
        store
          .replay({
            principal: alphaInput.principal,
            request: {
              ...alphaInput.request,
              sharedProjectId: decodeProjectId("project-replay-beta"),
            },
          })
          .pipe(
            Effect.provideService(CollaborationMembershipAuthority, {
              getCurrent: (sharedProjectId) => {
                membershipLookups += 1;
                return Effect.succeed(projectMembership(sharedProjectId));
              },
            }),
          ),
      );
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.ok(isStoreError(result.failure));
        assert.equal(result.failure.reason, "invalid-replay-request");
      }
      assert.equal(membershipLookups, 0);
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("rechecks current membership authority for every replay", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      yield* store.append(yield* admittedEvent("project-replay-revocation", 1));
      const input = yield* replayRequest("project-replay-revocation", 0);
      let lookups = 0;
      const authority = {
        getCurrent: (sharedProjectId: ReturnType<typeof decodeProjectId>) =>
          Effect.sync(() => {
            lookups += 1;
            return lookups === 1
              ? projectMembership(sharedProjectId)
              : decodeMembership({
                  ...projectMembership(sharedProjectId),
                  epoch: 2,
                  updatedAt: "2026-07-30T12:00:20.000Z",
                });
          }),
      };
      const first = yield* store
        .replay(input)
        .pipe(Effect.provideService(CollaborationMembershipAuthority, authority));
      assert.equal(first.events.length, 1);

      const revoked = yield* Effect.result(
        store
          .replay(input)
          .pipe(Effect.provideService(CollaborationMembershipAuthority, authority)),
      );
      assert.equal(revoked._tag, "Failure");
      if (revoked._tag === "Failure") {
        assert.ok(isStoreError(revoked.failure));
        assert.equal(revoked.failure.reason, "invalid-replay-request");
      }
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("fails closed when payload bytes or the chain link are corrupted", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      const sql = yield* SqlClient.SqlClient;
      yield* store.append(yield* admittedEvent("project-corrupt", 1));
      yield* store.append(yield* admittedEvent("project-corrupt", 2));

      yield* sql`
        UPDATE collaboration_events
        SET payload_json = ${'{"body":"tampered"}'}
        WHERE shared_project_id = ${"project-corrupt"} AND sequence = 1
      `;
      const corruptedPayload = yield* Effect.result(
        store.replay(yield* replayRequest("project-corrupt", 0)),
      );
      assert.equal(corruptedPayload._tag, "Failure");
      if (corruptedPayload._tag === "Failure") {
        assert.ok(isStoreError(corruptedPayload.failure));
        assert.equal(corruptedPayload.failure.reason, "integrity-failure");
      }

      yield* sql`
        UPDATE collaboration_events
        SET payload_json = ${'{"body":"message 1"}'}
        WHERE shared_project_id = ${"project-corrupt"} AND sequence = 1
      `;
      yield* sql`
        UPDATE collaboration_events
        SET previous_event_sha256 = ${"0".repeat(64)}
        WHERE shared_project_id = ${"project-corrupt"} AND sequence = 2
      `;
      const corruptedChain = yield* Effect.result(
        store.replay(yield* replayRequest("project-corrupt", 0)),
      );
      assert.equal(corruptedChain._tag, "Failure");
      if (corruptedChain._tag === "Failure") {
        assert.ok(isStoreError(corruptedChain.failure));
        assert.equal(corruptedChain.failure.reason, "integrity-failure");
      }

      yield* sql`
        UPDATE collaboration_events
        SET previous_event_sha256 = NULL,
            proposal_sha256 = ${"0".repeat(64)}
        WHERE shared_project_id = ${"project-corrupt"} AND sequence = 1
      `;
      const corruptedProposal = yield* Effect.result(
        store.replay(yield* replayRequest("project-corrupt", 0)),
      );
      assert.equal(corruptedProposal._tag, "Failure");
      if (corruptedProposal._tag === "Failure") {
        assert.ok(isStoreError(corruptedProposal.failure));
        assert.equal(corruptedProposal.failure.reason, "integrity-failure");
      }
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("rejects invalid cursors and limits instead of issuing unbounded reads", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      yield* store.append(yield* admittedEvent("project-bounds", 1));
      const authorized = yield* replayRequest("project-bounds", 0);

      for (const request of [
        {
          sharedProjectId: decodeProjectId("project-bounds"),
          afterSequence: -1,
          limit: 1,
        },
        {
          sharedProjectId: decodeProjectId("project-bounds"),
          afterSequence: 0,
          limit: 501,
        },
        {
          sharedProjectId: decodeProjectId("project-bounds"),
          afterSequence: 2,
          limit: 1,
        },
      ]) {
        const result = yield* Effect.result(
          store.replay({
            principal: authorized.principal,
            request: request as Parameters<typeof store.replay>[0]["request"],
          }),
        );
        assert.equal(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.ok(isStoreError(result.failure));
          assert.equal(result.failure.reason, "invalid-replay-request");
        }
      }
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("survives coordinator restart without duplicating an admitted retry", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-cowork-store-"))),
      (directory) => {
        const dbPath = join(directory, "state.sqlite");
        const layer = Layer.merge(
          CollaborationEventStoreLive.pipe(
            Layer.provideMerge(NodeSqliteClient.layer({ filename: dbPath })),
          ),
          membershipLayer,
        );
        return Effect.gen(function* () {
          const original = yield* admittedEvent("project-restart", 1);
          const first = yield* Effect.gen(function* () {
            yield* runMigrations();
            const store = yield* CollaborationEventStore;
            return yield* store.append(original);
          }).pipe(Effect.provide(layer));

          const afterRestart = yield* Effect.gen(function* () {
            yield* runMigrations();
            const store = yield* CollaborationEventStore;
            const retry = yield* store.append(original);
            const replay = yield* store.replay(yield* replayRequest("project-restart", 0));
            return { retry, replay };
          }).pipe(Effect.provide(layer));

          assert.deepStrictEqual(afterRestart.retry, first);
          assert.equal(afterRestart.replay.events.length, 1);
          assert.equal(afterRestart.replay.nextCursor, 1);
        });
      },
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    ),
  );
});
