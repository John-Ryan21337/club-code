import {
  COLLABORATION_ROLE_PERMISSIONS,
  CollaborationAppendAuthoredMessageRequest,
  CollaborationAuthoredMessagePageRequest,
  CollaborationCreateContextPacketRequest,
  CollaborationPrincipal,
  CollaborationProjectMembershipSnapshot,
  CollaborationTombstoneAuthoredMessageRequest,
  SharedProjectId,
} from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";
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
import { CollaborationMembershipAuthority } from "./CollaborationAuthorization.ts";
import {
  CollaborationAuthoredMessageStore,
  CollaborationAuthoredMessageStoreError,
  CollaborationAuthoredMessageStoreLive,
} from "./CollaborationAuthoredMessageStore.ts";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const projectId = Schema.decodeUnknownSync(SharedProjectId)("project-authored-messages");
const decodePrincipal = Schema.decodeUnknownSync(CollaborationPrincipal);
const decodeMembership = Schema.decodeUnknownSync(CollaborationProjectMembershipSnapshot);
const decodeAppend = Schema.decodeUnknownSync(CollaborationAppendAuthoredMessageRequest);
const encodeAppend = Schema.encodeUnknownSync(CollaborationAppendAuthoredMessageRequest);
const decodeTombstone = Schema.decodeUnknownSync(CollaborationTombstoneAuthoredMessageRequest);
const decodePage = Schema.decodeUnknownSync(CollaborationAuthoredMessagePageRequest);
const decodePacket = Schema.decodeUnknownSync(CollaborationCreateContextPacketRequest);

function principal(userId: "user-1" | "user-2", deviceId: "device-1" | "device-2") {
  return decodePrincipal({
    sessionId: `session-${userId}`,
    sharedProjectId: projectId,
    userId,
    deviceId,
    membershipEpoch: 1,
    issuedAt: "2026-08-01T11:30:00.000Z",
    expiresAt: "2026-08-01T12:30:00.000Z",
  });
}

const firstPrincipal = principal("user-1", "device-1");
const secondPrincipal = principal("user-2", "device-2");
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

const memoryLayer = Layer.merge(
  CollaborationAuthoredMessageStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
  membershipLayer,
);

function fileLayer(filename: string) {
  return Layer.merge(
    CollaborationAuthoredMessageStoreLive.pipe(
      Layer.provideMerge(NodeSqliteClient.layer({ filename, busyTimeoutMs: 15_000 })),
    ),
    membershipLayer,
  );
}

function appendCommand(
  id: number,
  kind: "operator-chat" | "authored-prompt" = "operator-chat",
  contextInclusion: "eligible" | "excluded-sensitive" = "eligible",
) {
  return decodeAppend({
    commandId: `append-${id}`,
    sharedProjectId: projectId,
    messageId: `message-${id}`,
    kind,
    body: `shared body ${id}`,
    contextInclusion,
    occurredAt: "2026-08-01T11:59:00.000Z",
  });
}

const seedProject = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO collaboration_projects(shared_project_id, membership_epoch, updated_at)
    VALUES (${projectId}, 1, ${"2026-08-01T11:00:00.000Z"})
  `;
});

function expectFailure(value: unknown, reason: CollaborationAuthoredMessageStoreError["reason"]) {
  assert.instanceOf(value, CollaborationAuthoredMessageStoreError);
  assert.equal((value as CollaborationAuthoredMessageStoreError).reason, reason);
}

function appendWithLayer(
  operator: typeof firstPrincipal,
  command: ReturnType<typeof appendCommand>,
  layer: ReturnType<typeof fileLayer>,
) {
  return Effect.gen(function* () {
    const store = yield* CollaborationAuthoredMessageStore;
    return yield* store.append({ principal: operator, command });
  }).pipe(Effect.provide(layer));
}

describe("CollaborationAuthoredMessageStore", () => {
  it.effect("orders merged messages and independent side-by-side operator lanes", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* runMigrations();
      yield* seedProject;
      const store = yield* CollaborationAuthoredMessageStore;
      const first = yield* store.append({ principal: firstPrincipal, command: appendCommand(1) });
      const second = yield* store.append({ principal: secondPrincipal, command: appendCommand(2) });
      const third = yield* store.append({
        principal: firstPrincipal,
        command: appendCommand(3, "authored-prompt"),
      });

      assert.deepEqual(
        [first.projectSequence, second.projectSequence, third.projectSequence],
        [1, 2, 3],
      );
      assert.deepEqual(
        [first.operatorSequence, second.operatorSequence, third.operatorSequence],
        [1, 1, 2],
      );
      assert.equal(second.previousMessageSha256, first.messageSha256);
      assert.equal(third.previousMessageSha256, second.messageSha256);

      const page = yield* store.page({
        principal: firstPrincipal,
        request: decodePage({
          sharedProjectId: projectId,
          afterSequence: 0,
          kinds: ["operator-chat", "authored-prompt"],
        }),
      });
      assert.deepEqual(page.mergedOrder.map(String), ["message-1", "message-2", "message-3"]);
      assert.deepEqual(
        page.lanePositions.map((position) => [position.userId, position.operatorSequence]),
        [
          ["user-1", 1],
          ["user-2", 1],
          ["user-1", 2],
        ],
      );
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("binds append idempotency to exact content and authenticated principal", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* runMigrations();
      yield* seedProject;
      const store = yield* CollaborationAuthoredMessageStore;
      const command = appendCommand(10);
      const first = yield* store.append({ principal: firstPrincipal, command });
      const retry = yield* store.append({ principal: firstPrincipal, command });
      assert.equal(retry.messageSha256, first.messageSha256);

      const stolen = yield* store.append({ principal: secondPrincipal, command }).pipe(Effect.flip);
      expectFailure(stolen, "idempotency-conflict");

      const changed = yield* store
        .append({
          principal: firstPrincipal,
          command: decodeAppend({
            ...encodeAppend(command),
            body: "changed body",
          }),
        })
        .pipe(Effect.flip);
      expectFailure(changed, "idempotency-conflict");
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("records a recoverable tombstone without deleting immutable source content", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* runMigrations();
      yield* seedProject;
      const store = yield* CollaborationAuthoredMessageStore;
      yield* store.append({ principal: firstPrincipal, command: appendCommand(20) });
      const command = decodeTombstone({
        commandId: "tombstone-20",
        sharedProjectId: projectId,
        targetMessageId: "message-20",
        targetKind: "operator-chat",
        reason: "operator requested removal from ordinary display",
      });
      const tombstoned = yield* store.tombstone({ principal: firstPrincipal, command });
      assert.equal(tombstoned.tombstone?.recoverable, true);
      assert.equal(tombstoned.body, "shared body 20");

      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly body: string }>`
        SELECT body FROM collaboration_authored_messages
        WHERE shared_project_id = ${projectId} AND message_id = ${"message-20"}
      `;
      assert.deepEqual(rows, [{ body: "shared body 20" }]);

      const otherUser = yield* store
        .tombstone({
          principal: secondPrincipal,
          command: decodeTombstone({ ...command, commandId: "tombstone-stolen" }),
        })
        .pipe(Effect.flip);
      expectFailure(otherUser, "access-denied");
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("creates pointer-only delta packets and excludes sensitive or tombstoned sources", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);
      yield* runMigrations();
      yield* seedProject;
      const store = yield* CollaborationAuthoredMessageStore;
      yield* store.append({ principal: firstPrincipal, command: appendCommand(30) });
      yield* store.append({
        principal: firstPrincipal,
        command: appendCommand(31, "authored-prompt", "excluded-sensitive"),
      });
      yield* store.append({ principal: secondPrincipal, command: appendCommand(32) });

      const firstPacket = yield* store.createContextPacket({
        principal: firstPrincipal,
        command: decodePacket({
          commandId: "packet-command-1",
          sharedProjectId: projectId,
          packetId: "packet-1",
          basePacketId: null,
          selection: {
            messageIds: ["message-30", "message-31"],
            sourceKinds: ["operator-chat", "authored-prompt"],
          },
          tokenBudget: 100,
          encodedByteBudget: 1_000,
        }),
      });
      assert.deepEqual(
        firstPacket.sources.map((source) => source.messageId),
        ["message-30"],
      );
      assert.deepEqual(
        firstPacket.excludedSources.map((source) => ({
          messageId: String(source.messageId),
          reason: source.reason,
        })),
        [{ messageId: "message-31", reason: "sensitive" }],
      );
      assert.equal(JSON.stringify(firstPacket).includes("shared body"), false);

      yield* store.tombstone({
        principal: firstPrincipal,
        command: decodeTombstone({
          commandId: "tombstone-30",
          sharedProjectId: projectId,
          targetMessageId: "message-30",
          targetKind: "operator-chat",
          reason: "remove this source from reusable context",
        }),
      });

      const delta = yield* store.createContextPacket({
        principal: firstPrincipal,
        command: decodePacket({
          commandId: "packet-command-2",
          sharedProjectId: projectId,
          packetId: "packet-2",
          basePacketId: "packet-1",
          selection: {
            messageIds: ["message-32"],
            sourceKinds: ["operator-chat"],
          },
          tokenBudget: 100,
          encodedByteBudget: 1_000,
        }),
      });
      assert.deepEqual(
        delta.sources.map((source) => source.messageId),
        ["message-32"],
      );
      assert.deepEqual(
        delta.excludedSources.map((source) => ({
          messageId: String(source.messageId),
          reason: source.reason,
        })),
        [{ messageId: "message-30", reason: "tombstoned" }],
      );
    }).pipe(Effect.provide(memoryLayer)),
  );

  it.effect("serializes concurrent appends across two file-backed SQLite clients", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-authored-message-race-"))),
      (directory) => {
        const filename = join(directory, "state.sqlite");
        const setupLayer = fileLayer(filename);
        return Effect.gen(function* () {
          yield* TestClock.setTime(NOW);
          yield* Effect.gen(function* () {
            yield* runMigrations();
            yield* seedProject;
          }).pipe(Effect.provide(setupLayer));

          const [first, second] = yield* Effect.all(
            [
              appendWithLayer(firstPrincipal, appendCommand(40), fileLayer(filename)),
              appendWithLayer(secondPrincipal, appendCommand(41), fileLayer(filename)),
            ],
            { concurrency: "unbounded" },
          );
          assert.deepEqual(
            [first.projectSequence, second.projectSequence].toSorted((a, b) => a - b),
            [1, 2],
          );

          const rows = yield* Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            return yield* sql<{
              readonly projectSequence: number;
              readonly previousMessageSha256: string | null;
              readonly messageSha256: string;
            }>`
              SELECT project_sequence AS "projectSequence",
                previous_message_sha256 AS "previousMessageSha256",
                message_sha256 AS "messageSha256"
              FROM collaboration_authored_messages
              WHERE shared_project_id = ${projectId}
              ORDER BY project_sequence ASC
            `;
          }).pipe(Effect.provide(fileLayer(filename)));
          assert.equal(rows.length, 2);
          assert.equal(rows[0]!.previousMessageSha256, null);
          assert.equal(rows[1]!.previousMessageSha256, rows[0]!.messageSha256);
        });
      },
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    ),
  );

  it.effect("fails closed when file-backed stored message content is corrupted", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "club-code-authored-message-corrupt-"))),
      (directory) => {
        const filename = join(directory, "state.sqlite");
        const layer = fileLayer(filename);
        return Effect.gen(function* () {
          yield* TestClock.setTime(NOW);
          yield* runMigrations();
          yield* seedProject;
          const store = yield* CollaborationAuthoredMessageStore;
          yield* store.append({ principal: firstPrincipal, command: appendCommand(50) });
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            UPDATE collaboration_authored_messages SET body = ${"tampered"}
            WHERE shared_project_id = ${projectId} AND message_id = ${"message-50"}
          `;
          const failure = yield* store
            .page({
              principal: firstPrincipal,
              request: decodePage({
                sharedProjectId: projectId,
                afterSequence: 0,
                kinds: ["operator-chat"],
              }),
            })
            .pipe(Effect.flip);
          expectFailure(failure, "integrity-failure");
        }).pipe(Effect.provide(layer));
      },
      (directory) => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    ),
  );
});
