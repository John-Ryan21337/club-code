import {
  CollaborationEventProposal,
  CollaborationPrincipal,
  CollaborationProjectMember,
  SharedProjectId,
} from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../persistence/Migrations.ts";
import * as NodeSqliteClient from "../persistence/NodeSqliteClient.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import type { CollaborationAdmittedEventProposal } from "./CollaborationEventAdmission.ts";
import {
  CollaborationEventStore,
  CollaborationEventStoreError,
  CollaborationEventStoreLive,
} from "./CollaborationEventStore.ts";

const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeMember = Schema.decodeUnknownSync(CollaborationProjectMember);
const decodeProposal = Schema.decodeUnknownSync(CollaborationEventProposal);
const isStoreError = (value: unknown): value is CollaborationEventStoreError =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  value._tag === "CollaborationEventStoreError";

function admittedEvent(
  projectName: string,
  eventNumber: number,
  overrides: {
    readonly eventId?: string;
    readonly commandId?: string;
    readonly body?: string;
  } = {},
): CollaborationAdmittedEventProposal {
  const sharedProjectId = decodeProjectId(projectName);
  const body = overrides.body ?? `message ${eventNumber}`;
  const payloadJson = JSON.stringify({ body });
  const proposal = decodeProposal({
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
    occurredAt: `2026-07-30T12:00:0${eventNumber}.000Z`,
  });
  const principal = decodePrincipal({
    sessionId: "session-1",
    sharedProjectId,
    userId: "user-1",
    deviceId: "device-1",
    membershipEpoch: 1,
    issuedAt: "2026-07-30T11:30:00.000Z",
    expiresAt: "2026-07-30T12:30:00.000Z",
  });
  const member = decodeMember({
    userId: "user-1",
    displayName: "Operator One",
    role: "contributor",
    permissions: [
      "transcript.read",
      "transcript.append",
      "chat.read",
      "chat.append",
      "task.read",
      "task.manage",
      "file.read",
      "file.publish",
    ],
    joinedAt: "2026-07-30T11:00:00.000Z",
  });
  return {
    authorization: {
      principal,
      member,
      permission: "chat.append",
    },
    proposal,
    permission: "chat.append",
    payload: { body },
    payloadBytes: Buffer.from(payloadJson),
  };
}

const memoryLayer = CollaborationEventStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory));

describe("CollaborationEventStore", () => {
  it.effect("assigns project-local sequences and replays bounded monotonic pages", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      const first = yield* store.append(admittedEvent("project-pages", 1));
      const second = yield* store.append(admittedEvent("project-pages", 2));

      assert.equal(first.sequence, 1);
      assert.equal(first.previousEventSha256, null);
      assert.equal(second.sequence, 2);
      assert.match(second.previousEventSha256 ?? "", /^[a-f0-9]{64}$/);

      const pageOne = yield* store.replay({
        sharedProjectId: decodeProjectId("project-pages"),
        afterSequence: 0,
        limit: 1,
      });
      assert.deepStrictEqual(
        pageOne.events.map((event) => event.eventId),
        ["event-1"],
      );
      assert.equal(pageOne.nextCursor, 1);
      assert.equal(pageOne.hasMore, true);

      const pageTwo = yield* store.replay({
        sharedProjectId: decodeProjectId("project-pages"),
        afterSequence: pageOne.nextCursor,
        limit: 1,
      });
      assert.deepStrictEqual(
        pageTwo.events.map((event) => event.eventId),
        ["event-2"],
      );
      assert.equal(pageTwo.nextCursor, 2);
      assert.equal(pageTwo.hasMore, false);
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("returns an exact retry once and rejects conflicting idempotency keys", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      const original = admittedEvent("project-idempotency", 1);
      const first = yield* store.append(original);
      const retry = yield* store.append(original);
      assert.deepStrictEqual(retry, first);

      const conflict = yield* Effect.result(
        store.append(
          admittedEvent("project-idempotency", 2, {
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

  it.effect("isolates identical event and command IDs by project", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      yield* store.append(admittedEvent("project-alpha", 1));
      yield* store.append(admittedEvent("project-beta", 1));

      const alpha = yield* store.replay({
        sharedProjectId: decodeProjectId("project-alpha"),
        afterSequence: 0,
      });
      const beta = yield* store.replay({
        sharedProjectId: decodeProjectId("project-beta"),
        afterSequence: 0,
      });
      assert.equal(alpha.events.length, 1);
      assert.equal(beta.events.length, 1);
      assert.equal(alpha.events[0]?.sharedProjectId, "project-alpha");
      assert.equal(beta.events[0]?.sharedProjectId, "project-beta");
      assert.equal(alpha.events[0]?.sequence, 1);
      assert.equal(beta.events[0]?.sequence, 1);
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("fails closed when payload bytes or the chain link are corrupted", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      const sql = yield* SqlClient.SqlClient;
      yield* store.append(admittedEvent("project-corrupt", 1));
      yield* store.append(admittedEvent("project-corrupt", 2));

      yield* sql`
        UPDATE collaboration_events
        SET payload_json = ${'{"body":"tampered"}'}
        WHERE shared_project_id = ${"project-corrupt"} AND sequence = 1
      `;
      const corruptedPayload = yield* Effect.result(
        store.replay({
          sharedProjectId: decodeProjectId("project-corrupt"),
          afterSequence: 0,
        }),
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
        store.replay({
          sharedProjectId: decodeProjectId("project-corrupt"),
          afterSequence: 0,
        }),
      );
      assert.equal(corruptedChain._tag, "Failure");
      if (corruptedChain._tag === "Failure") {
        assert.ok(isStoreError(corruptedChain.failure));
        assert.equal(corruptedChain.failure.reason, "integrity-failure");
      }
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("rejects invalid cursors and limits instead of issuing unbounded reads", () =>
    Effect.gen(function* () {
      const store = yield* CollaborationEventStore;
      yield* store.append(admittedEvent("project-bounds", 1));

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
          store.replay(request as Parameters<typeof store.replay>[0]),
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
        const layer = CollaborationEventStoreLive.pipe(
          Layer.provideMerge(NodeSqliteClient.layer({ filename: dbPath })),
        );
        const original = admittedEvent("project-restart", 1);
        return Effect.gen(function* () {
          const first = yield* Effect.gen(function* () {
            yield* runMigrations();
            const store = yield* CollaborationEventStore;
            return yield* store.append(original);
          }).pipe(Effect.provide(layer));

          const afterRestart = yield* Effect.gen(function* () {
            yield* runMigrations();
            const store = yield* CollaborationEventStore;
            const retry = yield* store.append(original);
            const replay = yield* store.replay({
              sharedProjectId: decodeProjectId("project-restart"),
              afterSequence: 0,
            });
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
