import type {
  CollaborationEventEnvelope,
  CollaborationEventProposal,
  CollaborationEventReplayPage,
  CollaborationEventReplayRequest,
  CollaborationSha256,
} from "@cafecode/contracts";
import {
  COLLABORATION_EVENT_REPLAY_DEFAULT_LIMIT,
  COLLABORATION_EVENT_REPLAY_MAX_PAGE_UTF8_BYTES,
  COLLABORATION_EVENT_REPLAY_MAX_LIMIT,
  CollaborationEventEnvelope as CollaborationEventEnvelopeSchema,
  CollaborationEventProposal as CollaborationEventProposalSchema,
  CollaborationEventReplayPage as CollaborationEventReplayPageSchema,
  CollaborationEventReplayRequest as CollaborationEventReplayRequestSchema,
} from "@cafecode/contracts";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  admitCollaborationEventProposal,
  collaborationEventProposalSignatureBytes,
  type CollaborationAdmittedEventProposal,
  CollaborationDeviceKeyAuthority,
  isCollaborationAdmittedEventProposal,
} from "./CollaborationEventAdmission.ts";
import {
  authorizeCollaborationPermission,
  CollaborationMembershipAuthority,
} from "./CollaborationAuthorization.ts";

const HASH_DOMAIN = "cafecode-collaboration-event-envelope-v1";
const IDEMPOTENCY_DOMAIN = "cafecode-collaboration-event-idempotency-v1";
const decodeEnvelope = Schema.decodeUnknownSync(CollaborationEventEnvelopeSchema);
const decodeProposal = Schema.decodeUnknownEffect(CollaborationEventProposalSchema);
const decodeStoredProposal = Schema.decodeUnknownSync(CollaborationEventProposalSchema);
const decodeReplayPage = Schema.decodeUnknownSync(CollaborationEventReplayPageSchema);
const decodeReplayRequest = Schema.decodeUnknownEffect(CollaborationEventReplayRequestSchema);

export type CollaborationEventStoreFailureReason =
  | "invalid-admitted-event"
  | "invalid-replay-request"
  | "idempotency-conflict"
  | "integrity-failure"
  | "storage-unavailable";

export class CollaborationEventStoreError extends Data.TaggedError("CollaborationEventStoreError")<{
  readonly reason: CollaborationEventStoreFailureReason;
  readonly operation: "append" | "replay";
}> {}

export interface CollaborationEventStoreShape {
  readonly append: (
    admitted: CollaborationAdmittedEventProposal,
  ) => Effect.Effect<
    CollaborationEventEnvelope,
    CollaborationEventStoreError,
    CollaborationDeviceKeyAuthority | CollaborationMembershipAuthority
  >;
  readonly replay: (
    input: CollaborationEventReplayInput,
  ) => Effect.Effect<
    CollaborationEventReplayPage,
    CollaborationEventStoreError,
    CollaborationMembershipAuthority
  >;
}

export interface CollaborationEventReplayInput {
  readonly principal: unknown;
  readonly request: CollaborationEventReplayRequest;
}

export class CollaborationEventStore extends Context.Service<
  CollaborationEventStore,
  CollaborationEventStoreShape
>()("cafecode/collaboration/CollaborationEventStore") {}

interface CollaborationEventRow {
  readonly sharedProjectId: string;
  readonly sequence: number;
  readonly eventId: string;
  readonly commandId: string;
  readonly proposalSha256: string;
  readonly envelopeSha256: string;
  readonly membershipEpoch: number;
  readonly actorJson: string;
  readonly deviceKeyId: string;
  readonly eventType: string;
  readonly payloadJson: string;
  readonly payloadSha256: string;
  readonly previousEventSha256: string | null;
  readonly authorSignature: string;
  readonly causationEventId: string | null;
  readonly correlationId: string | null;
  readonly occurredAt: string;
  readonly receivedAt: string;
}

interface VerifiedStoredEvent {
  readonly envelope: CollaborationEventEnvelope;
  readonly envelopeSha256: CollaborationSha256;
  readonly proposalSha256: CollaborationSha256;
}

interface CollaborationEventReplayCandidate {
  readonly sequence: number;
  readonly encodedBytes: number;
}

function fail(
  operation: "append" | "replay",
  reason: CollaborationEventStoreFailureReason,
): CollaborationEventStoreError {
  return new CollaborationEventStoreError({ operation, reason });
}

function isStoreError(cause: unknown): cause is CollaborationEventStoreError {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "CollaborationEventStoreError"
  );
}

function sha256(...parts: ReadonlyArray<string | Uint8Array>): CollaborationSha256 {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
  }
  return hash.digest("hex") as CollaborationSha256;
}

function proposalSha256(proposal: CollaborationEventProposal): CollaborationSha256 {
  return sha256(
    IDEMPOTENCY_DOMAIN,
    "\0",
    collaborationEventProposalSignatureBytes(proposal),
    "\0",
    proposal.authorSignature,
  );
}

function envelopeSha256(
  envelope: CollaborationEventEnvelope,
  actorJson: string,
  payloadJson: string,
): CollaborationSha256 {
  return sha256(
    HASH_DOMAIN,
    "\0",
    JSON.stringify([
      envelope.version,
      envelope.sharedProjectId,
      envelope.sequence,
      envelope.eventId,
      envelope.commandId,
      envelope.membershipEpoch,
      actorJson,
      envelope.deviceKeyId,
      envelope.type,
      payloadJson,
      envelope.payloadSha256,
      envelope.previousEventSha256,
      envelope.authorSignature,
      envelope.causationEventId,
      envelope.correlationId,
      envelope.occurredAt,
      envelope.receivedAt,
    ]),
  );
}

function verifyStoredRow(
  row: CollaborationEventRow,
  operation: "append" | "replay",
): Effect.Effect<VerifiedStoredEvent, CollaborationEventStoreError> {
  return Effect.try({
    try: () => {
      const actor = JSON.parse(row.actorJson);
      const payload = JSON.parse(row.payloadJson);
      if (JSON.stringify(actor) !== row.actorJson || JSON.stringify(payload) !== row.payloadJson) {
        throw new Error("non-canonical collaboration JSON");
      }
      const envelope = decodeEnvelope(
        {
          version: 1,
          sharedProjectId: row.sharedProjectId,
          sequence: row.sequence,
          eventId: row.eventId,
          commandId: row.commandId,
          membershipEpoch: row.membershipEpoch,
          actor,
          deviceKeyId: row.deviceKeyId,
          type: row.eventType,
          payload,
          payloadSha256: row.payloadSha256,
          previousEventSha256: row.previousEventSha256,
          authorSignature: row.authorSignature,
          causationEventId: row.causationEventId,
          correlationId: row.correlationId,
          occurredAt: row.occurredAt,
          receivedAt: row.receivedAt,
        },
        { onExcessProperty: "error" },
      );
      if (sha256(Buffer.from(row.payloadJson, "utf8")) !== envelope.payloadSha256) {
        throw new Error("payload hash mismatch");
      }
      if (envelopeSha256(envelope, row.actorJson, row.payloadJson) !== row.envelopeSha256) {
        throw new Error("envelope hash mismatch");
      }
      const storedProposal = decodeStoredProposal(
        {
          version: envelope.version,
          sharedProjectId: envelope.sharedProjectId,
          eventId: envelope.eventId,
          commandId: envelope.commandId,
          membershipEpoch: envelope.membershipEpoch,
          actor: envelope.actor,
          deviceKeyId: envelope.deviceKeyId,
          type: envelope.type,
          payloadJson: row.payloadJson,
          payloadSha256: envelope.payloadSha256,
          authorSignature: envelope.authorSignature,
          causationEventId: envelope.causationEventId,
          correlationId: envelope.correlationId,
          occurredAt: envelope.occurredAt,
        },
        { onExcessProperty: "error" },
      );
      if (proposalSha256(storedProposal) !== row.proposalSha256) {
        throw new Error("proposal hash mismatch");
      }
      return {
        envelope,
        envelopeSha256: row.envelopeSha256 as CollaborationSha256,
        proposalSha256: row.proposalSha256 as CollaborationSha256,
      };
    },
    catch: () => fail(operation, "integrity-failure"),
  });
}

const selectColumns = `
  shared_project_id AS "sharedProjectId",
  sequence,
  event_id AS "eventId",
  command_id AS "commandId",
  proposal_sha256 AS "proposalSha256",
  envelope_sha256 AS "envelopeSha256",
  membership_epoch AS "membershipEpoch",
  actor_json AS "actorJson",
  device_key_id AS "deviceKeyId",
  event_type AS "eventType",
  payload_json AS "payloadJson",
  payload_sha256 AS "payloadSha256",
  previous_event_sha256 AS "previousEventSha256",
  author_signature AS "authorSignature",
  causation_event_id AS "causationEventId",
  correlation_id AS "correlationId",
  occurred_at AS "occurredAt",
  received_at AS "receivedAt"
`;

const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const append: CollaborationEventStoreShape["append"] = (admitted) => {
    const operation = "append" as const;
    return Effect.gen(function* () {
      if (!isCollaborationAdmittedEventProposal(admitted)) {
        return yield* Effect.fail(fail(operation, "invalid-admitted-event"));
      }
      const initialAuthorization = admitted.authorization;
      const proposal = yield* decodeProposal(admitted?.proposal, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError(() => fail(operation, "invalid-admitted-event")));

      if (
        !(admitted.payloadBytes instanceof Uint8Array) ||
        initialAuthorization.principal.sharedProjectId !== proposal.sharedProjectId ||
        initialAuthorization.principal.userId !==
          (proposal.actor.kind === "operator" ? proposal.actor.userId : undefined) ||
        initialAuthorization.principal.deviceId !==
          (proposal.actor.kind === "operator" ? proposal.actor.deviceId : undefined) ||
        initialAuthorization.principal.membershipEpoch !== proposal.membershipEpoch ||
        initialAuthorization.permission !== admitted.permission ||
        JSON.stringify(admitted.payload) !== proposal.payloadJson ||
        sha256(admitted.payloadBytes) !== proposal.payloadSha256 ||
        Buffer.compare(Buffer.from(admitted.payloadBytes), Buffer.from(proposal.payloadJson)) !== 0
      ) {
        return yield* Effect.fail(fail(operation, "invalid-admitted-event"));
      }
      if (!isCollaborationAdmittedEventProposal(admitted)) {
        return yield* Effect.fail(fail(operation, "invalid-admitted-event"));
      }

      const retrySha256 = proposalSha256(proposal);
      const actorJson = JSON.stringify(proposal.actor);
      const payloadJson = proposal.payloadJson;
      const payload = JSON.parse(payloadJson);

      return yield* sql.withTransaction(
        Effect.gen(function* () {
          // Acquire SQLite's writer reservation before reading the project
          // tail. This prevents two coordinator processes from allocating the
          // same next sequence from concurrent deferred transactions.
          yield* sql`
            INSERT INTO collaboration_event_write_locks (shared_project_id)
            VALUES (${proposal.sharedProjectId})
            ON CONFLICT(shared_project_id) DO UPDATE
            SET shared_project_id = excluded.shared_project_id
          `;
          // An admitted proposal is an in-process capability, not a durable
          // authorization lease. Re-run admission only after acquiring the
          // project writer reservation, so a same-database membership
          // revocation and the durable append are ordered by SQLite rather
          // than leaving a queueing window between authorization and write.
          const currentlyAdmitted = yield* admitCollaborationEventProposal({
            principal: initialAuthorization.principal,
            targetProjectId: proposal.sharedProjectId,
            proposal,
          }).pipe(Effect.mapError(() => fail(operation, "invalid-admitted-event")));
          if (currentlyAdmitted.permission !== admitted.permission) {
            return yield* Effect.fail(fail(operation, "invalid-admitted-event"));
          }
          const existingRows = yield* sql<CollaborationEventRow>`
            SELECT ${sql.unsafe(selectColumns)}
            FROM collaboration_events
            WHERE shared_project_id = ${proposal.sharedProjectId}
              AND (event_id = ${proposal.eventId} OR command_id = ${proposal.commandId})
            ORDER BY sequence ASC
          `;
          if (existingRows.length > 1) {
            return yield* Effect.fail(fail(operation, "integrity-failure"));
          }
          if (existingRows.length === 1) {
            const existing = yield* verifyStoredRow(existingRows[0]!, operation);
            if (
              existing.envelope.eventId !== proposal.eventId ||
              existing.envelope.commandId !== proposal.commandId ||
              existing.proposalSha256 !== retrySha256
            ) {
              return yield* Effect.fail(fail(operation, "idempotency-conflict"));
            }
            return existing.envelope;
          }

          const tailRows = yield* sql<CollaborationEventRow>`
            SELECT ${sql.unsafe(selectColumns)}
            FROM collaboration_events
            WHERE shared_project_id = ${proposal.sharedProjectId}
            ORDER BY sequence DESC
            LIMIT 2
          `;
          const tail =
            tailRows.length === 0 ? null : yield* verifyStoredRow(tailRows[0]!, operation);
          if (tail !== null) {
            if (tail.envelope.sequence === 1) {
              if (tailRows.length !== 1 || tail.envelope.previousEventSha256 !== null) {
                return yield* Effect.fail(fail(operation, "integrity-failure"));
              }
            } else {
              if (tailRows.length !== 2) {
                return yield* Effect.fail(fail(operation, "integrity-failure"));
              }
              const predecessor = yield* verifyStoredRow(tailRows[1]!, operation);
              if (
                predecessor.envelope.sequence + 1 !== tail.envelope.sequence ||
                tail.envelope.previousEventSha256 !== predecessor.envelopeSha256
              ) {
                return yield* Effect.fail(fail(operation, "integrity-failure"));
              }
            }
          }
          if (tail !== null && tail.envelope.sequence >= Number.MAX_SAFE_INTEGER) {
            return yield* Effect.fail(fail(operation, "storage-unavailable"));
          }
          const sequence = (tail?.envelope.sequence ?? 0) + 1;
          const receivedAt = DateTime.formatIso(yield* DateTime.now);
          const envelope = yield* Effect.try({
            try: () =>
              decodeEnvelope(
                {
                  version: proposal.version,
                  sharedProjectId: proposal.sharedProjectId,
                  sequence,
                  eventId: proposal.eventId,
                  commandId: proposal.commandId,
                  membershipEpoch: proposal.membershipEpoch,
                  actor: proposal.actor,
                  deviceKeyId: proposal.deviceKeyId,
                  type: proposal.type,
                  payload,
                  payloadSha256: proposal.payloadSha256,
                  previousEventSha256: tail?.envelopeSha256 ?? null,
                  authorSignature: proposal.authorSignature,
                  causationEventId: proposal.causationEventId,
                  correlationId: proposal.correlationId,
                  occurredAt: proposal.occurredAt,
                  receivedAt,
                },
                { onExcessProperty: "error" },
              ),
            catch: () => fail(operation, "invalid-admitted-event"),
          });
          const storedEnvelopeSha256 = envelopeSha256(envelope, actorJson, payloadJson);

          yield* sql`
            INSERT INTO collaboration_events (
              shared_project_id, sequence, event_id, command_id, proposal_sha256,
              envelope_sha256, membership_epoch, actor_json, event_type, payload_json,
              device_key_id, payload_sha256, previous_event_sha256, author_signature,
              causation_event_id, correlation_id, occurred_at, received_at
            )
            VALUES (
              ${envelope.sharedProjectId}, ${envelope.sequence}, ${envelope.eventId},
              ${envelope.commandId}, ${retrySha256}, ${storedEnvelopeSha256},
              ${envelope.membershipEpoch}, ${actorJson}, ${envelope.type}, ${payloadJson},
              ${envelope.deviceKeyId}, ${envelope.payloadSha256}, ${envelope.previousEventSha256},
              ${envelope.authorSignature}, ${envelope.causationEventId},
              ${envelope.correlationId}, ${envelope.occurredAt}, ${envelope.receivedAt}
            )
          `;
          return envelope;
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail(operation, "storage-unavailable"),
      ),
    );
  };

  const replay: CollaborationEventStoreShape["replay"] = (input) => {
    const operation = "replay" as const;
    return Effect.gen(function* () {
      const request = yield* decodeReplayRequest(input?.request, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError(() => fail(operation, "invalid-replay-request")));
      yield* authorizeCollaborationPermission({
        principal: input?.principal,
        targetProjectId: request.sharedProjectId,
        permission: "audit.read",
      }).pipe(Effect.mapError(() => fail(operation, "invalid-replay-request")));
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const limit = Math.min(
            request.limit ?? COLLABORATION_EVENT_REPLAY_DEFAULT_LIMIT,
            COLLABORATION_EVENT_REPLAY_MAX_LIMIT,
          );

          const candidateRows = yield* sql<CollaborationEventReplayCandidate>`
        SELECT
          sequence,
          (
            length(CAST(payload_json AS BLOB)) +
            length(CAST(actor_json AS BLOB)) +
            length(CAST(author_signature AS BLOB)) +
            length(CAST(shared_project_id AS BLOB)) +
            length(CAST(event_id AS BLOB)) +
            length(CAST(command_id AS BLOB)) +
            length(CAST(device_key_id AS BLOB)) +
            length(CAST(event_type AS BLOB)) +
            length(CAST(occurred_at AS BLOB)) +
            length(CAST(received_at AS BLOB)) +
            1024
          ) AS "encodedBytes"
        FROM collaboration_events
        WHERE shared_project_id = ${request.sharedProjectId}
          AND sequence > ${request.afterSequence}
        ORDER BY sequence ASC
        LIMIT ${limit + 1}
      `;
          let selectedCount = 0;
          let selectedBytes = 0;
          for (const candidate of candidateRows) {
            if (
              selectedCount >= limit ||
              (selectedCount > 0 &&
                selectedBytes + candidate.encodedBytes >
                  COLLABORATION_EVENT_REPLAY_MAX_PAGE_UTF8_BYTES)
            ) {
              break;
            }
            selectedCount += 1;
            selectedBytes += candidate.encodedBytes;
          }
          const pageRows = yield* sql<CollaborationEventRow>`
        SELECT ${sql.unsafe(selectColumns)}
        FROM collaboration_events
        WHERE shared_project_id = ${request.sharedProjectId}
          AND sequence > ${request.afterSequence}
        ORDER BY sequence ASC
        LIMIT ${selectedCount + 1}
      `;
          const predecessorRows =
            request.afterSequence === 0
              ? []
              : yield* sql<CollaborationEventRow>`
              SELECT ${sql.unsafe(selectColumns)}
              FROM collaboration_events
              WHERE shared_project_id = ${request.sharedProjectId}
                AND sequence <= ${request.afterSequence}
              ORDER BY sequence DESC
              LIMIT 2
            `;
          const tailRows = yield* sql<{ readonly sequence: number }>`
        SELECT sequence
        FROM collaboration_events
        WHERE shared_project_id = ${request.sharedProjectId}
        ORDER BY sequence DESC
        LIMIT 1
      `;
          const tailSequence = tailRows[0]?.sequence ?? 0;
          if (
            request.afterSequence > tailSequence ||
            (request.afterSequence > 0 &&
              predecessorRows.length !== Math.min(2, request.afterSequence))
          ) {
            return yield* Effect.fail(fail(operation, "invalid-replay-request"));
          }

          let previousHash: CollaborationSha256 | null = null;
          if (predecessorRows.length >= 1) {
            const predecessor = yield* verifyStoredRow(predecessorRows[0]!, operation);
            if (predecessor.envelope.sequence !== request.afterSequence) {
              return yield* Effect.fail(fail(operation, "integrity-failure"));
            }
            if (predecessor.envelope.sequence === 1) {
              if (predecessor.envelope.previousEventSha256 !== null) {
                return yield* Effect.fail(fail(operation, "integrity-failure"));
              }
            } else {
              if (predecessorRows.length !== 2) {
                return yield* Effect.fail(fail(operation, "integrity-failure"));
              }
              const prior = yield* verifyStoredRow(predecessorRows[1]!, operation);
              if (
                prior.envelope.sequence + 1 !== predecessor.envelope.sequence ||
                predecessor.envelope.previousEventSha256 !== prior.envelopeSha256
              ) {
                return yield* Effect.fail(fail(operation, "integrity-failure"));
              }
            }
            previousHash = predecessor.envelopeSha256;
          }

          const hasMore = candidateRows.length > selectedCount;
          const selectedRows = pageRows.slice(0, selectedCount);
          const events: CollaborationEventEnvelope[] = [];
          let expectedSequence = request.afterSequence + 1;
          for (const row of selectedRows) {
            const stored = yield* verifyStoredRow(row, operation);
            if (
              stored.envelope.sequence !== expectedSequence ||
              stored.envelope.previousEventSha256 !== previousHash
            ) {
              return yield* Effect.fail(fail(operation, "integrity-failure"));
            }
            events.push(stored.envelope);
            previousHash = stored.envelopeSha256;
            expectedSequence += 1;
          }
          if (hasMore) {
            const lookahead = yield* verifyStoredRow(pageRows[selectedCount]!, operation);
            if (
              lookahead.envelope.sequence !== expectedSequence ||
              lookahead.envelope.previousEventSha256 !== previousHash
            ) {
              return yield* Effect.fail(fail(operation, "integrity-failure"));
            }
          }

          if (request.afterSequence < tailSequence && events.length === 0) {
            return yield* Effect.fail(fail(operation, "integrity-failure"));
          }
          // The SQL estimate avoids materializing a page that cannot fit, but
          // validate the exact serialized result at the protocol boundary as
          // a fail-closed guard against a schema expansion or malformed stored
          // row making the estimate stale.
          return yield* Effect.try({
            try: () =>
              decodeReplayPage(
                {
                  sharedProjectId: request.sharedProjectId,
                  events,
                  nextCursor: events.at(-1)?.sequence ?? request.afterSequence,
                  hasMore,
                },
                { onExcessProperty: "error" },
              ),
            catch: () => fail(operation, "integrity-failure"),
          });
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail(operation, "storage-unavailable"),
      ),
    );
  };

  return { append, replay } satisfies CollaborationEventStoreShape;
});

export const CollaborationEventStoreLive = Layer.effect(CollaborationEventStore, makeStore);
