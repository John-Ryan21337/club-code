import type {
  CollaborationAppendAuthoredMessageRequest,
  CollaborationAuthoredMessage,
  CollaborationAuthoredMessageKind,
  CollaborationAuthoredMessagePage,
  CollaborationAuthoredMessagePageRequest,
  CollaborationContextPacket,
  CollaborationCreateContextPacketRequest,
  CollaborationPrincipal,
  CollaborationSha256,
  CollaborationTombstoneAuthoredMessageRequest,
} from "@cafecode/contracts";
import {
  COLLABORATION_AUTHORED_MESSAGE_PAGE_DEFAULT_LIMIT,
  COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT,
  COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_UTF8_BYTES,
  CollaborationAppendAuthoredMessageRequest as AppendRequestSchema,
  CollaborationAuthoredMessage as MessageSchema,
  CollaborationAuthoredMessagePage as MessagePageSchema,
  CollaborationAuthoredMessagePageRequest as PageRequestSchema,
  CollaborationContextPacket as ContextPacketSchema,
  CollaborationCreateContextPacketRequest as CreateContextPacketRequestSchema,
  CollaborationTombstoneAuthoredMessageRequest as TombstoneRequestSchema,
} from "@cafecode/contracts";
import { createHash } from "node:crypto";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  authorizeCollaborationPermission,
  CollaborationMembershipAuthority,
} from "./CollaborationAuthorization.ts";

const APPEND_DOMAIN = "club-code-collaboration-authored-message-input-v1";
const MESSAGE_DOMAIN = "club-code-collaboration-authored-message-v1";
const TOMBSTONE_DOMAIN = "club-code-collaboration-authored-message-tombstone-v1";
const CONTEXT_DOMAIN = "club-code-collaboration-context-packet-v1";

const encodeAppend = Schema.encodeUnknownEffect(AppendRequestSchema);
const decodeEncodedAppend = Schema.decodeUnknownEffect(AppendRequestSchema);
const decodeAppend = (input: unknown) =>
  encodeAppend(input, { onExcessProperty: "error" }).pipe(
    Effect.flatMap((encoded) => decodeEncodedAppend(encoded, { onExcessProperty: "error" })),
  );
const decodeTombstone = Schema.decodeUnknownEffect(TombstoneRequestSchema);
const decodePageRequest = Schema.decodeUnknownEffect(PageRequestSchema);
const decodeCreatePacket = Schema.decodeUnknownEffect(CreateContextPacketRequestSchema);
const decodeMessage = Schema.decodeUnknownSync(MessageSchema);
const encodeMessage = Schema.encodeUnknownSync(MessageSchema);
const decodePage = Schema.decodeUnknownSync(MessagePageSchema);
const encodePage = Schema.encodeUnknownSync(MessagePageSchema);
const decodePacket = Schema.decodeUnknownSync(ContextPacketSchema);

type Operation = "append" | "tombstone" | "page" | "context.create";

export type CollaborationAuthoredMessageStoreFailureReason =
  | "invalid-request"
  | "access-denied"
  | "not-found"
  | "idempotency-conflict"
  | "context-budget-exceeded"
  | "integrity-failure"
  | "storage-unavailable";

export class CollaborationAuthoredMessageStoreError extends Data.TaggedError(
  "CollaborationAuthoredMessageStoreError",
)<{
  readonly operation: Operation;
  readonly reason: CollaborationAuthoredMessageStoreFailureReason;
}> {}

export interface CollaborationAuthoredMessageStoreShape {
  readonly append: (input: {
    readonly principal: unknown;
    readonly command: CollaborationAppendAuthoredMessageRequest;
  }) => Effect.Effect<
    CollaborationAuthoredMessage,
    CollaborationAuthoredMessageStoreError,
    CollaborationMembershipAuthority
  >;
  readonly tombstone: (input: {
    readonly principal: unknown;
    readonly command: CollaborationTombstoneAuthoredMessageRequest;
  }) => Effect.Effect<
    CollaborationAuthoredMessage,
    CollaborationAuthoredMessageStoreError,
    CollaborationMembershipAuthority
  >;
  readonly page: (input: {
    readonly principal: unknown;
    readonly request: CollaborationAuthoredMessagePageRequest;
  }) => Effect.Effect<
    CollaborationAuthoredMessagePage,
    CollaborationAuthoredMessageStoreError,
    CollaborationMembershipAuthority
  >;
  readonly createContextPacket: (input: {
    readonly principal: unknown;
    readonly command: CollaborationCreateContextPacketRequest;
  }) => Effect.Effect<
    CollaborationContextPacket,
    CollaborationAuthoredMessageStoreError,
    CollaborationMembershipAuthority
  >;
}

export class CollaborationAuthoredMessageStore extends Context.Service<
  CollaborationAuthoredMessageStore,
  CollaborationAuthoredMessageStoreShape
>()("cafecode/collaboration/CollaborationAuthoredMessageStore") {}

interface MessageRow {
  readonly sharedProjectId: string;
  readonly projectSequence: number;
  readonly operatorSequence: number;
  readonly messageId: string;
  readonly commandId: string;
  readonly inputSha256: string;
  readonly kind: CollaborationAuthoredMessageKind;
  readonly body: string;
  readonly bodySha256: string;
  readonly contextInclusion: "eligible" | "excluded-sensitive";
  readonly authorUserId: string;
  readonly authorDeviceId: string;
  readonly membershipEpoch: number;
  readonly previousMessageSha256: string | null;
  readonly messageSha256: string;
  readonly occurredAt: string;
  readonly receivedAt: string;
  readonly tombstoneCommandId: string | null;
  readonly tombstoneActorUserId: string | null;
  readonly tombstoneActorDeviceId: string | null;
  readonly tombstoneMembershipEpoch: number | null;
  readonly tombstoneReason: string | null;
  readonly tombstoneCreatedAt: string | null;
  readonly tombstoneSha256: string | null;
}

interface PacketRow {
  readonly sharedProjectId: string;
  readonly packetId: string;
  readonly commandId: string;
  readonly inputSha256: string;
  readonly basePacketId: string | null;
  readonly sourcesJson: string;
  readonly excludedSourcesJson: string;
  readonly tokenBudget: number;
  readonly estimatedTokens: number;
  readonly encodedBytes: number;
  readonly throughSequence: number;
  readonly packetSha256: string;
  readonly createdByUserId: string;
  readonly createdByDeviceId: string;
  readonly membershipEpoch: number;
  readonly createdAt: string;
}

const messageColumns = `
  m.shared_project_id AS "sharedProjectId",
  m.project_sequence AS "projectSequence",
  m.operator_sequence AS "operatorSequence",
  m.message_id AS "messageId",
  m.command_id AS "commandId",
  m.input_sha256 AS "inputSha256",
  m.kind,
  m.body,
  m.body_sha256 AS "bodySha256",
  m.context_inclusion AS "contextInclusion",
  m.author_user_id AS "authorUserId",
  m.author_device_id AS "authorDeviceId",
  m.membership_epoch AS "membershipEpoch",
  m.previous_message_sha256 AS "previousMessageSha256",
  m.message_sha256 AS "messageSha256",
  m.occurred_at AS "occurredAt",
  m.received_at AS "receivedAt",
  t.command_id AS "tombstoneCommandId",
  t.actor_user_id AS "tombstoneActorUserId",
  t.actor_device_id AS "tombstoneActorDeviceId",
  t.membership_epoch AS "tombstoneMembershipEpoch",
  t.reason AS "tombstoneReason",
  t.created_at AS "tombstoneCreatedAt",
  t.tombstone_sha256 AS "tombstoneSha256"
`;

const packetColumns = `
  shared_project_id AS "sharedProjectId",
  packet_id AS "packetId",
  command_id AS "commandId",
  input_sha256 AS "inputSha256",
  base_packet_id AS "basePacketId",
  sources_json AS "sourcesJson",
  excluded_sources_json AS "excludedSourcesJson",
  token_budget AS "tokenBudget",
  estimated_tokens AS "estimatedTokens",
  encoded_bytes AS "encodedBytes",
  through_sequence AS "throughSequence",
  packet_sha256 AS "packetSha256",
  created_by_user_id AS "createdByUserId",
  created_by_device_id AS "createdByDeviceId",
  membership_epoch AS "membershipEpoch",
  created_at AS "createdAt"
`;

function fail(
  operation: Operation,
  reason: CollaborationAuthoredMessageStoreFailureReason,
): CollaborationAuthoredMessageStoreError {
  return new CollaborationAuthoredMessageStoreError({ operation, reason });
}

function isStoreError(value: unknown): value is CollaborationAuthoredMessageStoreError {
  return value instanceof CollaborationAuthoredMessageStoreError;
}

function sha256(domain: string, value: string): CollaborationSha256 {
  return createHash("sha256")
    .update(domain)
    .update("\0")
    .update(value)
    .digest("hex") as CollaborationSha256;
}

function permissionForKind(kind: CollaborationAuthoredMessageKind, mode: "read" | "append") {
  if (kind === "operator-chat") {
    return mode === "read" ? ("chat.read" as const) : ("chat.append" as const);
  }
  return mode === "read" ? ("transcript.read" as const) : ("transcript.append" as const);
}

function canonicalPrincipal(principal: CollaborationPrincipal) {
  return {
    userId: principal.userId,
    deviceId: principal.deviceId,
    membershipEpoch: principal.membershipEpoch,
  };
}

function appendInputJson(
  command: CollaborationAppendAuthoredMessageRequest,
  principal: CollaborationPrincipal,
) {
  return JSON.stringify({
    commandId: command.commandId,
    sharedProjectId: command.sharedProjectId,
    messageId: command.messageId,
    kind: command.kind,
    body: command.body,
    contextInclusion: command.contextInclusion,
    occurredAt: DateTime.formatIso(command.occurredAt),
    principal: canonicalPrincipal(principal),
  });
}

function messageHashInput(row: Omit<MessageRow, "messageSha256">) {
  return JSON.stringify([
    row.sharedProjectId,
    row.projectSequence,
    row.operatorSequence,
    row.messageId,
    row.kind,
    row.bodySha256,
    row.contextInclusion,
    row.authorUserId,
    row.authorDeviceId,
    row.membershipEpoch,
    row.previousMessageSha256,
    row.occurredAt,
    row.receivedAt,
  ]);
}

function tombstoneHashInput(row: MessageRow) {
  return JSON.stringify([
    row.sharedProjectId,
    row.messageId,
    row.tombstoneCommandId,
    row.tombstoneActorUserId,
    row.tombstoneActorDeviceId,
    row.tombstoneMembershipEpoch,
    row.tombstoneReason,
    row.tombstoneCreatedAt,
    true,
  ]);
}

function verifyMessageRow(
  row: MessageRow,
  operation: Operation,
): Effect.Effect<CollaborationAuthoredMessage, CollaborationAuthoredMessageStoreError> {
  return Effect.try({
    try: () => {
      if (sha256("body", row.body) !== row.bodySha256) {
        throw new Error("body hash mismatch");
      }
      const { messageSha256: _ignored, ...withoutHash } = row;
      if (sha256(MESSAGE_DOMAIN, messageHashInput(withoutHash)) !== row.messageSha256) {
        throw new Error("message hash mismatch");
      }
      const hasTombstone = row.tombstoneCommandId !== null;
      if (
        hasTombstone !==
        [
          row.tombstoneActorUserId,
          row.tombstoneActorDeviceId,
          row.tombstoneMembershipEpoch,
          row.tombstoneReason,
          row.tombstoneCreatedAt,
          row.tombstoneSha256,
        ].every((value) => value !== null)
      ) {
        throw new Error("partial tombstone");
      }
      if (
        hasTombstone &&
        sha256(TOMBSTONE_DOMAIN, tombstoneHashInput(row)) !== row.tombstoneSha256
      ) {
        throw new Error("tombstone hash mismatch");
      }
      return decodeMessage(
        {
          sharedProjectId: row.sharedProjectId,
          projectSequence: row.projectSequence,
          operatorSequence: row.operatorSequence,
          messageId: row.messageId,
          kind: row.kind,
          body: row.body,
          contextInclusion: row.contextInclusion,
          authorUserId: row.authorUserId,
          authorDeviceId: row.authorDeviceId,
          membershipEpoch: row.membershipEpoch,
          previousMessageSha256: row.previousMessageSha256,
          messageSha256: row.messageSha256,
          occurredAt: row.occurredAt,
          receivedAt: row.receivedAt,
          tombstone: hasTombstone
            ? {
                commandId: row.tombstoneCommandId,
                targetMessageId: row.messageId,
                actorUserId: row.tombstoneActorUserId,
                actorDeviceId: row.tombstoneActorDeviceId,
                membershipEpoch: row.tombstoneMembershipEpoch,
                reason: row.tombstoneReason,
                createdAt: row.tombstoneCreatedAt,
                recoverable: true,
              }
            : null,
        },
        { onExcessProperty: "error" },
      );
    },
    catch: () => fail(operation, "integrity-failure"),
  });
}

function verifyPacketRow(
  row: PacketRow,
  operation: Operation,
): Effect.Effect<CollaborationContextPacket, CollaborationAuthoredMessageStoreError> {
  return Effect.try({
    try: () => {
      const sources = JSON.parse(row.sourcesJson);
      const excludedSources = JSON.parse(row.excludedSourcesJson);
      if (
        JSON.stringify(sources) !== row.sourcesJson ||
        JSON.stringify(excludedSources) !== row.excludedSourcesJson
      ) {
        throw new Error("non-canonical packet JSON");
      }
      const hashInput = JSON.stringify([
        row.sharedProjectId,
        row.packetId,
        row.basePacketId,
        sources,
        excludedSources,
        row.tokenBudget,
        row.estimatedTokens,
        row.encodedBytes,
        row.throughSequence,
        row.createdByUserId,
        row.createdByDeviceId,
        row.membershipEpoch,
        row.createdAt,
      ]);
      if (sha256(CONTEXT_DOMAIN, hashInput) !== row.packetSha256) {
        throw new Error("packet hash mismatch");
      }
      return decodePacket(
        {
          sharedProjectId: row.sharedProjectId,
          packetId: row.packetId,
          basePacketId: row.basePacketId,
          sources,
          excludedSources,
          tokenBudget: row.tokenBudget,
          estimatedTokens: row.estimatedTokens,
          encodedBytes: row.encodedBytes,
          throughSequence: row.throughSequence,
          packetSha256: row.packetSha256,
          createdByUserId: row.createdByUserId,
          createdByDeviceId: row.createdByDeviceId,
          membershipEpoch: row.membershipEpoch,
          createdAt: row.createdAt,
        },
        { onExcessProperty: "error" },
      );
    },
    catch: () => fail(operation, "integrity-failure"),
  });
}

function packetInputJson(
  command: CollaborationCreateContextPacketRequest,
  principal: CollaborationPrincipal,
) {
  return JSON.stringify({
    command,
    principal: canonicalPrincipal(principal),
  });
}

const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const authorize = (
    principal: unknown,
    projectId: CollaborationAppendAuthoredMessageRequest["sharedProjectId"],
    kind: CollaborationAuthoredMessageKind,
    mode: "read" | "append",
    operation: Operation,
  ) =>
    authorizeCollaborationPermission({
      principal,
      targetProjectId: projectId,
      permission: permissionForKind(kind, mode),
    }).pipe(Effect.mapError(() => fail(operation, "access-denied")));

  const acquireProjectWrite = (projectId: string) => sql`
    INSERT INTO collaboration_authored_message_write_locks(shared_project_id)
    VALUES (${projectId})
    ON CONFLICT(shared_project_id) DO UPDATE
    SET shared_project_id = excluded.shared_project_id
  `;

  const selectByIdentity = (projectId: string, messageId: string, commandId: string) =>
    sql<MessageRow>`
      SELECT ${sql.unsafe(messageColumns)}
      FROM collaboration_authored_messages m
      LEFT JOIN collaboration_authored_message_tombstones t
        ON t.shared_project_id = m.shared_project_id
       AND t.target_message_id = m.message_id
      WHERE m.shared_project_id = ${projectId}
        AND (m.message_id = ${messageId} OR m.command_id = ${commandId})
      ORDER BY m.project_sequence ASC
    `;

  const append: CollaborationAuthoredMessageStoreShape["append"] = (input) => {
    const operation = "append" as const;
    return Effect.gen(function* () {
      const command = yield* decodeAppend(input?.command).pipe(
        Effect.mapError(() => fail(operation, "invalid-request")),
      );
      const initialGrant = yield* authorize(
        input?.principal,
        command.sharedProjectId,
        command.kind,
        "append",
        operation,
      );
      const inputSha256 = sha256(APPEND_DOMAIN, appendInputJson(command, initialGrant.principal));

      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* acquireProjectWrite(command.sharedProjectId);
          const grant = yield* authorize(
            initialGrant.principal,
            command.sharedProjectId,
            command.kind,
            "append",
            operation,
          );
          const existingRows = yield* selectByIdentity(
            command.sharedProjectId,
            command.messageId,
            command.commandId,
          );
          if (existingRows.length > 1) {
            return yield* Effect.fail(fail(operation, "integrity-failure"));
          }
          if (existingRows.length === 1) {
            const existing = yield* verifyMessageRow(existingRows[0]!, operation);
            if (
              existingRows[0]!.messageId !== command.messageId ||
              existingRows[0]!.commandId !== command.commandId ||
              existingRows[0]!.inputSha256 !== inputSha256
            ) {
              return yield* Effect.fail(fail(operation, "idempotency-conflict"));
            }
            return existing;
          }

          const tailRows = yield* sql<MessageRow>`
            SELECT ${sql.unsafe(messageColumns)}
            FROM collaboration_authored_messages m
            LEFT JOIN collaboration_authored_message_tombstones t
              ON t.shared_project_id = m.shared_project_id
             AND t.target_message_id = m.message_id
            WHERE m.shared_project_id = ${command.sharedProjectId}
            ORDER BY m.project_sequence DESC
            LIMIT 2
          `;
          const tail =
            tailRows.length === 0 ? null : yield* verifyMessageRow(tailRows[0]!, operation);
          if (tail !== null) {
            if (tail.projectSequence === 1) {
              if (tailRows.length !== 1 || tail.previousMessageSha256 !== null) {
                return yield* Effect.fail(fail(operation, "integrity-failure"));
              }
            } else {
              if (tailRows.length !== 2) {
                return yield* Effect.fail(fail(operation, "integrity-failure"));
              }
              const prior = yield* verifyMessageRow(tailRows[1]!, operation);
              if (
                prior.projectSequence + 1 !== tail.projectSequence ||
                tail.previousMessageSha256 !== prior.messageSha256
              ) {
                return yield* Effect.fail(fail(operation, "integrity-failure"));
              }
            }
          }
          const operatorTail = yield* sql<{ readonly sequence: number }>`
            SELECT operator_sequence AS sequence
            FROM collaboration_authored_messages
            WHERE shared_project_id = ${command.sharedProjectId}
              AND author_user_id = ${grant.principal.userId}
            ORDER BY operator_sequence DESC
            LIMIT 1
          `;
          const projectSequence = (tail?.projectSequence ?? 0) + 1;
          const operatorSequence = (operatorTail[0]?.sequence ?? 0) + 1;
          if (
            projectSequence > Number.MAX_SAFE_INTEGER ||
            operatorSequence > Number.MAX_SAFE_INTEGER
          ) {
            return yield* Effect.fail(fail(operation, "storage-unavailable"));
          }
          const bodySha256 = sha256("body", command.body);
          const receivedAt = DateTime.formatIso(yield* DateTime.now);
          const rowWithoutHash: Omit<MessageRow, "messageSha256"> = {
            sharedProjectId: command.sharedProjectId,
            projectSequence,
            operatorSequence,
            messageId: command.messageId,
            commandId: command.commandId,
            inputSha256,
            kind: command.kind,
            body: command.body,
            bodySha256,
            contextInclusion: command.contextInclusion,
            authorUserId: grant.principal.userId,
            authorDeviceId: grant.principal.deviceId,
            membershipEpoch: grant.principal.membershipEpoch,
            previousMessageSha256: tail?.messageSha256 ?? null,
            occurredAt: DateTime.formatIso(command.occurredAt),
            receivedAt,
            tombstoneCommandId: null,
            tombstoneActorUserId: null,
            tombstoneActorDeviceId: null,
            tombstoneMembershipEpoch: null,
            tombstoneReason: null,
            tombstoneCreatedAt: null,
            tombstoneSha256: null,
          };
          const messageSha256 = sha256(MESSAGE_DOMAIN, messageHashInput(rowWithoutHash));
          yield* sql`
            INSERT INTO collaboration_authored_messages(
              shared_project_id, project_sequence, operator_sequence, message_id, command_id,
              input_sha256, kind, body, body_sha256, context_inclusion, author_user_id,
              author_device_id, membership_epoch, previous_message_sha256, message_sha256,
              occurred_at, received_at
            ) VALUES (
              ${command.sharedProjectId}, ${projectSequence}, ${operatorSequence},
              ${command.messageId}, ${command.commandId}, ${inputSha256}, ${command.kind},
              ${command.body}, ${bodySha256}, ${command.contextInclusion},
              ${grant.principal.userId}, ${grant.principal.deviceId},
              ${grant.principal.membershipEpoch}, ${rowWithoutHash.previousMessageSha256},
              ${messageSha256}, ${rowWithoutHash.occurredAt}, ${receivedAt}
            )
          `;
          return yield* verifyMessageRow({ ...rowWithoutHash, messageSha256 }, operation);
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail(operation, "storage-unavailable"),
      ),
    );
  };

  const tombstone: CollaborationAuthoredMessageStoreShape["tombstone"] = (input) => {
    const operation = "tombstone" as const;
    return Effect.gen(function* () {
      const command = yield* decodeTombstone(input?.command, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError(() => fail(operation, "invalid-request")));
      const initialGrant = yield* authorize(
        input?.principal,
        command.sharedProjectId,
        command.targetKind,
        "append",
        operation,
      );
      const inputJson = JSON.stringify({
        command,
        principal: canonicalPrincipal(initialGrant.principal),
      });
      const inputSha256 = sha256(TOMBSTONE_DOMAIN, inputJson);
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* acquireProjectWrite(command.sharedProjectId);
          const grant = yield* authorize(
            initialGrant.principal,
            command.sharedProjectId,
            command.targetKind,
            "append",
            operation,
          );
          const rows = yield* selectByIdentity(
            command.sharedProjectId,
            command.targetMessageId,
            "__never_matches__",
          );
          if (rows.length !== 1) {
            return yield* Effect.fail(fail(operation, "not-found"));
          }
          const current = yield* verifyMessageRow(rows[0]!, operation);
          if (
            current.kind !== command.targetKind ||
            current.authorUserId !== grant.principal.userId
          ) {
            return yield* Effect.fail(fail(operation, "access-denied"));
          }
          if (current.tombstone !== null) {
            const row = rows[0]!;
            if (row.tombstoneCommandId !== command.commandId) {
              return yield* Effect.fail(fail(operation, "idempotency-conflict"));
            }
            const receiptRows = yield* sql<{ readonly inputSha256: string }>`
              SELECT input_sha256 AS "inputSha256"
              FROM collaboration_authored_message_tombstones
              WHERE shared_project_id = ${command.sharedProjectId}
                AND target_message_id = ${command.targetMessageId}
            `;
            if (receiptRows.length !== 1 || receiptRows[0]!.inputSha256 !== inputSha256) {
              return yield* Effect.fail(fail(operation, "idempotency-conflict"));
            }
            return current;
          }
          const commandConflicts = yield* sql<{ readonly targetMessageId: string }>`
            SELECT target_message_id AS "targetMessageId"
            FROM collaboration_authored_message_tombstones
            WHERE shared_project_id = ${command.sharedProjectId}
              AND command_id = ${command.commandId}
          `;
          if (commandConflicts.length !== 0) {
            return yield* Effect.fail(fail(operation, "idempotency-conflict"));
          }
          const createdAt = DateTime.formatIso(yield* DateTime.now);
          const tombstoneInput = JSON.stringify([
            command.sharedProjectId,
            command.targetMessageId,
            command.commandId,
            grant.principal.userId,
            grant.principal.deviceId,
            grant.principal.membershipEpoch,
            command.reason,
            createdAt,
            true,
          ]);
          const tombstoneSha256 = sha256(TOMBSTONE_DOMAIN, tombstoneInput);
          yield* sql`
            INSERT INTO collaboration_authored_message_tombstones(
              shared_project_id, target_message_id, command_id, input_sha256,
              actor_user_id, actor_device_id, membership_epoch, reason,
              tombstone_sha256, created_at
            ) VALUES (
              ${command.sharedProjectId}, ${command.targetMessageId}, ${command.commandId},
              ${inputSha256}, ${grant.principal.userId}, ${grant.principal.deviceId},
              ${grant.principal.membershipEpoch}, ${command.reason}, ${tombstoneSha256},
              ${createdAt}
            )
          `;
          const updatedRows = yield* selectByIdentity(
            command.sharedProjectId,
            command.targetMessageId,
            command.commandId,
          );
          if (updatedRows.length !== 1) {
            return yield* Effect.fail(fail(operation, "integrity-failure"));
          }
          return yield* verifyMessageRow(updatedRows[0]!, operation);
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail(operation, "storage-unavailable"),
      ),
    );
  };

  const page: CollaborationAuthoredMessageStoreShape["page"] = (input) => {
    const operation = "page" as const;
    return Effect.gen(function* () {
      const request = yield* decodePageRequest(input?.request, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => fail(operation, "invalid-request")),
      );
      for (const kind of request.kinds) {
        yield* authorize(input?.principal, request.sharedProjectId, kind, "read", operation);
      }
      const limit = Math.min(
        request.limit ?? COLLABORATION_AUTHORED_MESSAGE_PAGE_DEFAULT_LIMIT,
        COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT,
      );
      const firstKind = request.kinds[0]!;
      const secondKind = request.kinds[1] ?? firstKind;
      const rows = yield* sql<MessageRow>`
        SELECT ${sql.unsafe(messageColumns)}
        FROM collaboration_authored_messages m
        LEFT JOIN collaboration_authored_message_tombstones t
          ON t.shared_project_id = m.shared_project_id
         AND t.target_message_id = m.message_id
        WHERE m.shared_project_id = ${request.sharedProjectId}
          AND m.project_sequence > ${request.afterSequence}
          AND (m.kind = ${firstKind} OR m.kind = ${secondKind})
        ORDER BY m.project_sequence ASC
        LIMIT ${limit + 1}
      `;
      const messages: CollaborationAuthoredMessage[] = [];
      let selectedBytes = 256;
      for (const row of rows.slice(0, limit)) {
        const message = yield* verifyMessageRow(row, operation);
        const encodedMessage = encodeMessage(message, {
          onExcessProperty: "error",
        });
        const messageBytes =
          new TextEncoder().encode(JSON.stringify(encodedMessage)).byteLength + 128;
        if (
          messages.length > 0 &&
          selectedBytes + messageBytes > COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_UTF8_BYTES
        ) {
          break;
        }
        messages.push(message);
        selectedBytes += messageBytes;
      }
      const result = {
        sharedProjectId: request.sharedProjectId,
        messages,
        mergedOrder: messages.map((message) => message.messageId),
        lanePositions: messages.map((message) => ({
          messageId: message.messageId,
          userId: message.authorUserId,
          projectSequence: message.projectSequence,
          operatorSequence: message.operatorSequence,
        })),
        nextCursor: messages.at(-1)?.projectSequence ?? request.afterSequence,
        hasMore: rows.length > messages.length,
      };
      return yield* Effect.try({
        try: () =>
          decodePage(encodePage(result, { onExcessProperty: "error" }), {
            onExcessProperty: "error",
          }),
        catch: () => fail(operation, "integrity-failure"),
      });
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail(operation, "storage-unavailable"),
      ),
    );
  };

  const createContextPacket: CollaborationAuthoredMessageStoreShape["createContextPacket"] = (
    input,
  ) => {
    const operation = "context.create" as const;
    return Effect.gen(function* () {
      const command = yield* decodeCreatePacket(input?.command, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError(() => fail(operation, "invalid-request")));
      const initialGrants = [];
      for (const kind of command.selection.sourceKinds) {
        initialGrants.push(
          yield* authorize(input?.principal, command.sharedProjectId, kind, "read", operation),
        );
      }
      const principal = initialGrants[0]!.principal;
      const inputSha256 = sha256(CONTEXT_DOMAIN, packetInputJson(command, principal));
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* acquireProjectWrite(command.sharedProjectId);
          for (const kind of command.selection.sourceKinds) {
            yield* authorize(principal, command.sharedProjectId, kind, "read", operation);
          }
          const existingRows = yield* sql<PacketRow>`
            SELECT ${sql.unsafe(packetColumns)}
            FROM collaboration_context_packets
            WHERE shared_project_id = ${command.sharedProjectId}
              AND (packet_id = ${command.packetId} OR command_id = ${command.commandId})
          `;
          if (existingRows.length > 1) {
            return yield* Effect.fail(fail(operation, "integrity-failure"));
          }
          if (existingRows.length === 1) {
            if (
              existingRows[0]!.packetId !== command.packetId ||
              existingRows[0]!.commandId !== command.commandId ||
              existingRows[0]!.inputSha256 !== inputSha256
            ) {
              return yield* Effect.fail(fail(operation, "idempotency-conflict"));
            }
            return yield* verifyPacketRow(existingRows[0]!, operation);
          }
          let baseThroughSequence = 0;
          const inheritedExcludedSources: Array<{
            readonly messageId: CollaborationAuthoredMessage["messageId"];
            readonly reason: "tombstoned";
          }> = [];
          if (command.basePacketId !== null) {
            const baseRows = yield* sql<PacketRow>`
              SELECT ${sql.unsafe(packetColumns)}
              FROM collaboration_context_packets
              WHERE shared_project_id = ${command.sharedProjectId}
                AND packet_id = ${command.basePacketId}
            `;
            if (baseRows.length !== 1) {
              return yield* Effect.fail(fail(operation, "not-found"));
            }
            const basePacket = yield* verifyPacketRow(baseRows[0]!, operation);
            baseThroughSequence = basePacket.throughSequence;
            if (basePacket.sources.length > 0) {
              const baseSourceIdsJson = JSON.stringify(
                basePacket.sources.map((source) => source.messageId),
              );
              const baseSourceRows = yield* sql<MessageRow>`
                SELECT ${sql.unsafe(messageColumns)}
                FROM collaboration_authored_messages m
                LEFT JOIN collaboration_authored_message_tombstones t
                  ON t.shared_project_id = m.shared_project_id
                 AND t.target_message_id = m.message_id
                WHERE m.shared_project_id = ${command.sharedProjectId}
                  AND m.message_id IN (SELECT value FROM json_each(${baseSourceIdsJson}))
                ORDER BY m.project_sequence ASC
              `;
              if (baseSourceRows.length !== basePacket.sources.length) {
                return yield* Effect.fail(fail(operation, "integrity-failure"));
              }
              for (const row of baseSourceRows) {
                const message = yield* verifyMessageRow(row, operation);
                if (message.tombstone !== null) {
                  inheritedExcludedSources.push({
                    messageId: message.messageId,
                    reason: "tombstoned",
                  });
                }
              }
            }
          }
          const messageIdsJson = JSON.stringify(command.selection.messageIds);
          const rows = yield* sql<MessageRow>`
            SELECT ${sql.unsafe(messageColumns)}
            FROM collaboration_authored_messages m
            LEFT JOIN collaboration_authored_message_tombstones t
              ON t.shared_project_id = m.shared_project_id
             AND t.target_message_id = m.message_id
            WHERE m.shared_project_id = ${command.sharedProjectId}
              AND m.message_id IN (SELECT value FROM json_each(${messageIdsJson}))
            ORDER BY m.project_sequence ASC
          `;
          if (rows.length !== command.selection.messageIds.length) {
            return yield* Effect.fail(fail(operation, "not-found"));
          }
          const allowedKinds = new Set(command.selection.sourceKinds);
          const sources = [];
          const excludedSources: Array<{
            readonly messageId: CollaborationAuthoredMessage["messageId"];
            readonly reason: "sensitive" | "tombstoned" | "base-packet-covered";
          }> = [...inheritedExcludedSources];
          const excludedMessageIds = new Set(excludedSources.map((source) => source.messageId));
          let estimatedTokens = 0;
          let encodedBytes = 0;
          let throughSequence = baseThroughSequence;
          for (const row of rows) {
            const message = yield* verifyMessageRow(row, operation);
            if (!allowedKinds.has(message.kind)) {
              return yield* Effect.fail(fail(operation, "access-denied"));
            }
            throughSequence = Math.max(throughSequence, message.projectSequence);
            if (message.contextInclusion === "excluded-sensitive") {
              if (!excludedMessageIds.has(message.messageId)) {
                excludedSources.push({ messageId: message.messageId, reason: "sensitive" });
                excludedMessageIds.add(message.messageId);
              }
              continue;
            }
            if (message.tombstone !== null) {
              if (!excludedMessageIds.has(message.messageId)) {
                excludedSources.push({ messageId: message.messageId, reason: "tombstoned" });
                excludedMessageIds.add(message.messageId);
              }
              continue;
            }
            if (message.projectSequence <= baseThroughSequence) {
              if (!excludedMessageIds.has(message.messageId)) {
                excludedSources.push({
                  messageId: message.messageId,
                  reason: "base-packet-covered",
                });
                excludedMessageIds.add(message.messageId);
              }
              continue;
            }
            const sourceBytes = new TextEncoder().encode(message.body).byteLength;
            const sourceTokens = Math.ceil(sourceBytes / 4);
            if (
              estimatedTokens + sourceTokens > command.tokenBudget ||
              encodedBytes + sourceBytes > command.encodedByteBudget
            ) {
              return yield* Effect.fail(fail(operation, "context-budget-exceeded"));
            }
            estimatedTokens += sourceTokens;
            encodedBytes += sourceBytes;
            sources.push({
              messageId: message.messageId,
              projectSequence: message.projectSequence,
              operatorSequence: message.operatorSequence,
              authorUserId: message.authorUserId,
              kind: message.kind,
              bodySha256: sha256("body", message.body),
            });
          }
          const sourcesJson = JSON.stringify(sources);
          const excludedSourcesJson = JSON.stringify(excludedSources);
          const createdAt = DateTime.formatIso(yield* DateTime.now);
          const packetHashInput = JSON.stringify([
            command.sharedProjectId,
            command.packetId,
            command.basePacketId,
            sources,
            excludedSources,
            command.tokenBudget,
            estimatedTokens,
            encodedBytes,
            throughSequence,
            principal.userId,
            principal.deviceId,
            principal.membershipEpoch,
            createdAt,
          ]);
          const packetSha256 = sha256(CONTEXT_DOMAIN, packetHashInput);
          yield* sql`
            INSERT INTO collaboration_context_packets(
              shared_project_id, packet_id, command_id, input_sha256, base_packet_id,
              sources_json, excluded_sources_json, token_budget, estimated_tokens,
              encoded_bytes, through_sequence, packet_sha256, created_by_user_id,
              created_by_device_id, membership_epoch, created_at
            ) VALUES (
              ${command.sharedProjectId}, ${command.packetId}, ${command.commandId},
              ${inputSha256}, ${command.basePacketId}, ${sourcesJson},
              ${excludedSourcesJson}, ${command.tokenBudget}, ${estimatedTokens},
              ${encodedBytes}, ${throughSequence}, ${packetSha256}, ${principal.userId},
              ${principal.deviceId}, ${principal.membershipEpoch}, ${createdAt}
            )
          `;
          return yield* verifyPacketRow(
            {
              sharedProjectId: command.sharedProjectId,
              packetId: command.packetId,
              commandId: command.commandId,
              inputSha256,
              basePacketId: command.basePacketId,
              sourcesJson,
              excludedSourcesJson,
              tokenBudget: command.tokenBudget,
              estimatedTokens,
              encodedBytes,
              throughSequence,
              packetSha256,
              createdByUserId: principal.userId,
              createdByDeviceId: principal.deviceId,
              membershipEpoch: principal.membershipEpoch,
              createdAt,
            },
            operation,
          );
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail(operation, "storage-unavailable"),
      ),
    );
  };

  return CollaborationAuthoredMessageStore.of({ append, tombstone, page, createContextPacket });
});

export const CollaborationAuthoredMessageStoreLive = Layer.effect(
  CollaborationAuthoredMessageStore,
  makeStore,
);
