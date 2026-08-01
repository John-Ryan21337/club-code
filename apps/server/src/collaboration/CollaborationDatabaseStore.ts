import type {
  CollaborationDatabaseBinding,
  CollaborationDatabaseLeaseCommand,
  CollaborationDatabaseReleaseResult,
  CollaborationDatabaseSnapshot,
  CollaborationDatabaseWriterLease,
  CollaborationPrincipal,
  SharedProjectId,
} from "@cafecode/contracts";
import {
  COLLABORATION_DATABASE_FENCING_TOKEN_MAX,
  CollaborationDatabaseAcquireLeaseCommand as AcquireLeaseCommandSchema,
  CollaborationDatabaseBinding as DatabaseBindingSchema,
  CollaborationDatabaseConfigureCommand as ConfigureCommandSchema,
  CollaborationDatabaseCoordinationPolicy,
  CollaborationDatabaseLeaseCommand as LeaseCommandSchema,
  CollaborationDatabasePublishHeadCommand as PublishHeadCommandSchema,
  CollaborationDatabaseReleaseResult as ReleaseResultSchema,
  CollaborationDatabaseSnapshot as DatabaseSnapshotSchema,
  CollaborationDatabaseWriterLease as WriterLeaseSchema,
} from "@cafecode/contracts";
import { createHash, randomUUID } from "node:crypto";

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

type Operation = "configure" | "acquire" | "renew" | "release" | "publish";

export type CollaborationDatabaseStoreFailureReason =
  | "invalid-command"
  | "not-authorized"
  | "binding-conflict"
  | "database-not-found"
  | "policy-disallows-lease"
  | "lease-unavailable"
  | "lease-invalid"
  | "head-conflict"
  | "idempotency-conflict"
  | "integrity-failure"
  | "storage-unavailable";

export class CollaborationDatabaseStoreError extends Data.TaggedError(
  "CollaborationDatabaseStoreError",
)<{
  readonly operation: Operation;
  readonly reason: CollaborationDatabaseStoreFailureReason;
}> {}

interface CommandInput<C> {
  readonly principal: unknown;
  readonly command: C;
}

export interface CollaborationDatabaseStoreShape {
  readonly configure: (
    input: CommandInput<unknown>,
  ) => Effect.Effect<
    CollaborationDatabaseBinding,
    CollaborationDatabaseStoreError,
    CollaborationMembershipAuthority
  >;
  readonly acquireLease: (
    input: CommandInput<unknown>,
  ) => Effect.Effect<
    CollaborationDatabaseWriterLease,
    CollaborationDatabaseStoreError,
    CollaborationMembershipAuthority
  >;
  readonly renewLease: (
    input: CommandInput<unknown>,
  ) => Effect.Effect<
    CollaborationDatabaseWriterLease,
    CollaborationDatabaseStoreError,
    CollaborationMembershipAuthority
  >;
  readonly releaseLease: (
    input: CommandInput<unknown>,
  ) => Effect.Effect<
    CollaborationDatabaseReleaseResult,
    CollaborationDatabaseStoreError,
    CollaborationMembershipAuthority
  >;
  readonly publishHead: (
    input: CommandInput<unknown>,
  ) => Effect.Effect<
    CollaborationDatabaseSnapshot,
    CollaborationDatabaseStoreError,
    CollaborationMembershipAuthority
  >;
}

export class CollaborationDatabaseStore extends Context.Service<
  CollaborationDatabaseStore,
  CollaborationDatabaseStoreShape
>()("cafecode/collaboration/CollaborationDatabaseStore") {}

interface DatabaseStateRow {
  readonly sharedProjectId: string;
  readonly databaseId: string;
  readonly relativePath: string;
  readonly engine: string;
  readonly coordinationKind: string;
  readonly policyJson: string;
  readonly headContentSha256: string | null;
  readonly headSnapshotJson: string | null;
  readonly lastFencingToken: number;
  readonly activeLeaseId: string | null;
  readonly holderUserId: string | null;
  readonly holderDeviceId: string | null;
  readonly leaseMembershipEpoch: number | null;
  readonly leaseFencingToken: number | null;
  readonly leaseGrantedAt: string | null;
  readonly leaseExpiresAt: string | null;
}

interface ReceiptRow {
  readonly operation: Operation;
  readonly requestSha256: string;
  readonly responseJson: string;
  readonly responseSha256: string;
}

const decodeConfigure = Schema.decodeUnknownEffect(ConfigureCommandSchema);
const decodeAcquire = Schema.decodeUnknownEffect(AcquireLeaseCommandSchema);
const decodeLeaseCommand = Schema.decodeUnknownEffect(LeaseCommandSchema);
const decodePublish = Schema.decodeUnknownEffect(PublishHeadCommandSchema);
const decodePolicy = Schema.decodeUnknownSync(CollaborationDatabaseCoordinationPolicy);
const decodeBinding = Schema.decodeUnknownSync(DatabaseBindingSchema);
const decodeWriterLease = Schema.decodeUnknownSync(WriterLeaseSchema);
const decodeReleaseResult = Schema.decodeUnknownSync(ReleaseResultSchema);
const decodeSnapshot = Schema.decodeUnknownSync(DatabaseSnapshotSchema);

const selectStateColumns = `
  shared_project_id AS "sharedProjectId",
  database_id AS "databaseId",
  relative_path AS "relativePath",
  engine,
  coordination_kind AS "coordinationKind",
  policy_json AS "policyJson",
  head_content_sha256 AS "headContentSha256",
  head_snapshot_json AS "headSnapshotJson",
  last_fencing_token AS "lastFencingToken",
  active_lease_id AS "activeLeaseId",
  holder_user_id AS "holderUserId",
  holder_device_id AS "holderDeviceId",
  lease_membership_epoch AS "leaseMembershipEpoch",
  lease_fencing_token AS "leaseFencingToken",
  lease_granted_at AS "leaseGrantedAt",
  lease_expires_at AS "leaseExpiresAt"
`;

function fail(operation: Operation, reason: CollaborationDatabaseStoreFailureReason) {
  return new CollaborationDatabaseStoreError({ operation, reason });
}

function isStoreError(cause: unknown): cause is CollaborationDatabaseStoreError {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "CollaborationDatabaseStoreError"
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function receiptRequestJson(
  command: unknown,
  principal: Pick<CollaborationPrincipal, "userId" | "deviceId" | "membershipEpoch">,
): string {
  return canonicalJson({
    command,
    principal: {
      userId: principal.userId,
      deviceId: principal.deviceId,
      membershipEpoch: principal.membershipEpoch,
    },
  });
}

function canonicalParse(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  if (canonicalJson(parsed) !== value) {
    throw new Error("non-canonical JSON");
  }
  return parsed;
}

function leaseInputFromRow(row: DatabaseStateRow): Record<string, unknown> | null {
  if (row.activeLeaseId === null) return null;
  return {
    sharedProjectId: row.sharedProjectId,
    databaseId: row.databaseId,
    leaseId: row.activeLeaseId,
    holderUserId: row.holderUserId,
    holderDeviceId: row.holderDeviceId,
    membershipEpoch: row.leaseMembershipEpoch,
    fencingToken: row.leaseFencingToken,
    grantedAt: row.leaseGrantedAt,
    expiresAt: row.leaseExpiresAt,
  };
}

function verifyState(row: DatabaseStateRow, operation: Operation): CollaborationDatabaseBinding {
  try {
    const policyValue = canonicalParse(row.policyJson);
    const policy = decodePolicy(policyValue, { onExcessProperty: "error" });
    if (policy.kind !== row.coordinationKind) throw new Error("policy kind mismatch");
    const headSnapshot =
      row.headSnapshotJson === null
        ? null
        : decodeSnapshot(canonicalParse(row.headSnapshotJson), { onExcessProperty: "error" });
    if (
      (headSnapshot === null) !== (row.headContentSha256 === null) ||
      (headSnapshot !== null &&
        (headSnapshot.sharedProjectId !== row.sharedProjectId ||
          headSnapshot.databaseId !== row.databaseId ||
          headSnapshot.relativePath !== row.relativePath ||
          headSnapshot.engine !== row.engine ||
          headSnapshot.contentSha256 !== row.headContentSha256))
    ) {
      throw new Error("head binding mismatch");
    }
    const activeLeaseInput = leaseInputFromRow(row);
    const activeLease =
      activeLeaseInput === null
        ? null
        : decodeWriterLease(activeLeaseInput, { onExcessProperty: "error" });
    if (activeLease !== null && policy.kind !== "serialized-head") {
      throw new Error("lease on non-serialized policy");
    }
    if (
      !Number.isSafeInteger(row.lastFencingToken) ||
      row.lastFencingToken < 0 ||
      row.lastFencingToken > COLLABORATION_DATABASE_FENCING_TOKEN_MAX ||
      (activeLease !== null && activeLease.fencingToken !== row.lastFencingToken)
    ) {
      throw new Error("invalid fence state");
    }
    return decodeBinding(
      {
        sharedProjectId: row.sharedProjectId,
        databaseId: row.databaseId,
        relativePath: row.relativePath,
        engine: row.engine,
        policy,
        headSnapshot,
        lastFencingToken: row.lastFencingToken,
        activeLease: activeLeaseInput,
      },
      { onExcessProperty: "error" },
    );
  } catch {
    throw fail(operation, "integrity-failure");
  }
}

function decodeReceiptResponse(
  operation: Operation,
  responseJson: string,
  projectId: string,
  databaseId: string,
): unknown {
  const parsed = canonicalParse(responseJson);
  let decoded: unknown;
  switch (operation) {
    case "configure":
      decoded = decodeBinding(parsed, { onExcessProperty: "error" });
      break;
    case "acquire":
    case "renew":
      decoded = decodeWriterLease(parsed, { onExcessProperty: "error" });
      break;
    case "release":
      decoded = decodeReleaseResult(parsed, { onExcessProperty: "error" });
      break;
    case "publish":
      decoded = decodeSnapshot(parsed, { onExcessProperty: "error" });
      break;
  }
  const identities = decoded as {
    readonly sharedProjectId?: unknown;
    readonly databaseId?: unknown;
  };
  if (identities.sharedProjectId !== projectId || identities.databaseId !== databaseId) {
    throw new Error("receipt identity mismatch");
  }
  return decoded;
}

const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const lockProject = (sharedProjectId: SharedProjectId) => sql`
    INSERT INTO collaboration_database_write_locks (shared_project_id)
    VALUES (${sharedProjectId})
    ON CONFLICT(shared_project_id) DO UPDATE SET shared_project_id = excluded.shared_project_id
  `;

  const readState = (sharedProjectId: string, databaseId: string, operation: Operation) =>
    Effect.gen(function* () {
      const rows = yield* sql<DatabaseStateRow>`
        SELECT ${sql.unsafe(selectStateColumns)}
        FROM collaboration_database_states
        WHERE shared_project_id = ${sharedProjectId} AND database_id = ${databaseId}
      `;
      if (rows.length !== 1) return yield* Effect.fail(fail(operation, "database-not-found"));
      const binding = yield* Effect.try({
        try: () => verifyState(rows[0]!, operation),
        catch: (cause) => (isStoreError(cause) ? cause : fail(operation, "integrity-failure")),
      });
      return { row: rows[0]!, binding };
    });

  const authorize = (principal: unknown, projectId: SharedProjectId, operation: Operation) =>
    authorizeCollaborationPermission({
      principal,
      targetProjectId: projectId,
      permission: operation === "configure" ? "project.manage-settings" : "file.publish",
    }).pipe(Effect.mapError(() => fail(operation, "not-authorized")));

  const retryReceipt = (
    projectId: string,
    databaseId: string,
    commandId: string,
    operation: Operation,
    requestJson: string,
  ) =>
    Effect.gen(function* () {
      const rows = yield* sql<ReceiptRow>`
        SELECT operation, request_sha256 AS "requestSha256",
          response_json AS "responseJson", response_sha256 AS "responseSha256"
        FROM collaboration_database_command_receipts
        WHERE shared_project_id = ${projectId} AND database_id = ${databaseId}
          AND command_id = ${commandId}
      `;
      if (rows.length === 0) return null;
      if (rows.length !== 1) return yield* Effect.fail(fail(operation, "integrity-failure"));
      const row = rows[0]!;
      if (row.operation !== operation || row.requestSha256 !== sha256(requestJson)) {
        return yield* Effect.fail(fail(operation, "idempotency-conflict"));
      }
      if (sha256(row.responseJson) !== row.responseSha256) {
        return yield* Effect.fail(fail(operation, "integrity-failure"));
      }
      return yield* Effect.try({
        try: () => decodeReceiptResponse(operation, row.responseJson, projectId, databaseId),
        catch: () => fail(operation, "integrity-failure"),
      });
    });

  const storeReceipt = (
    projectId: string,
    databaseId: string,
    commandId: string,
    operation: Operation,
    requestJson: string,
    response: unknown,
    createdAt: string,
  ) => {
    const responseJson = canonicalJson(response);
    return sql`
      INSERT INTO collaboration_database_command_receipts (
        shared_project_id, database_id, command_id, operation, request_sha256,
        response_json, response_sha256, created_at
      ) VALUES (
        ${projectId}, ${databaseId}, ${commandId}, ${operation}, ${sha256(requestJson)},
        ${responseJson}, ${sha256(responseJson)}, ${createdAt}
      )
    `;
  };

  const configure: CollaborationDatabaseStoreShape["configure"] = (input) => {
    const operation = "configure" as const;
    return Effect.gen(function* () {
      const command = yield* decodeConfigure(input?.command, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => fail(operation, "invalid-command")),
      );
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* lockProject(command.sharedProjectId);
          const grant = yield* authorize(input?.principal, command.sharedProjectId, operation);
          const requestJson = receiptRequestJson(command, grant.principal);
          const retry = yield* retryReceipt(
            command.sharedProjectId,
            command.databaseId,
            command.commandId,
            operation,
            requestJson,
          );
          if (retry !== null) {
            const { binding: current } = yield* readState(
              command.sharedProjectId,
              command.databaseId,
              operation,
            );
            const prior = retry as CollaborationDatabaseBinding;
            if (
              prior.relativePath !== current.relativePath ||
              prior.engine !== current.engine ||
              canonicalJson(prior.policy) !== canonicalJson(current.policy)
            ) {
              return yield* Effect.fail(fail(operation, "integrity-failure"));
            }
            return prior;
          }
          const existing = yield* sql<DatabaseStateRow>`
            SELECT ${sql.unsafe(selectStateColumns)} FROM collaboration_database_states
            WHERE shared_project_id = ${command.sharedProjectId}
              AND (database_id = ${command.databaseId} OR relative_path = ${command.relativePath})
          `;
          if (existing.length !== 0) {
            yield* Effect.try({
              try: () => existing.forEach((row) => verifyState(row, operation)),
              catch: (cause) =>
                isStoreError(cause) ? cause : fail(operation, "integrity-failure"),
            });
            return yield* Effect.fail(fail(operation, "binding-conflict"));
          }
          const now = DateTime.formatIso(yield* DateTime.now);
          const policyJson = canonicalJson(command.policy);
          yield* sql`
            INSERT INTO collaboration_database_states (
              shared_project_id, database_id, relative_path, engine, coordination_kind,
              policy_json, updated_at
            ) VALUES (
              ${command.sharedProjectId}, ${command.databaseId}, ${command.relativePath},
              ${command.engine}, ${command.policy.kind}, ${policyJson}, ${now}
            )
          `;
          const { binding } = yield* readState(
            command.sharedProjectId,
            command.databaseId,
            operation,
          );
          const encoded = {
            ...binding,
            activeLease: null,
          };
          yield* storeReceipt(
            command.sharedProjectId,
            command.databaseId,
            command.commandId,
            operation,
            requestJson,
            encoded,
            now,
          );
          return binding;
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail(operation, "storage-unavailable"),
      ),
    );
  };

  const mutateLease = (operation: "acquire" | "renew", input: CommandInput<unknown>) =>
    Effect.gen(function* () {
      const command = yield* (
        operation === "acquire"
          ? decodeAcquire(input?.command, { onExcessProperty: "error" })
          : decodeLeaseCommand(input?.command, { onExcessProperty: "error" })
      ).pipe(Effect.mapError(() => fail(operation, "invalid-command")));
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* lockProject(command.sharedProjectId);
          const grant = yield* authorize(input?.principal, command.sharedProjectId, operation);
          const requestJson = receiptRequestJson(command, grant.principal);
          const { row, binding } = yield* readState(
            command.sharedProjectId,
            command.databaseId,
            operation,
          );
          const retry = yield* retryReceipt(
            command.sharedProjectId,
            command.databaseId,
            command.commandId,
            operation,
            requestJson,
          );
          if (retry !== null) return retry as CollaborationDatabaseWriterLease;
          if (binding.policy.kind !== "serialized-head") {
            return yield* Effect.fail(fail(operation, "policy-disallows-lease"));
          }
          const now = DateTime.formatIso(yield* DateTime.now);
          const nowMillis = Date.parse(now);
          if (operation === "acquire") {
            if (binding.activeLease !== null && Date.parse(row.leaseExpiresAt!) > nowMillis) {
              return yield* Effect.fail(fail(operation, "lease-unavailable"));
            }
            if (row.lastFencingToken >= COLLABORATION_DATABASE_FENCING_TOKEN_MAX) {
              return yield* Effect.fail(fail(operation, "lease-invalid"));
            }
          } else {
            const leaseCommand = command as CollaborationDatabaseLeaseCommand;
            if (
              binding.activeLease === null ||
              row.activeLeaseId !== leaseCommand.leaseId ||
              row.leaseFencingToken !== leaseCommand.fencingToken ||
              row.holderUserId !== grant.principal.userId ||
              row.holderDeviceId !== grant.principal.deviceId ||
              row.leaseMembershipEpoch !== grant.principal.membershipEpoch ||
              Date.parse(row.leaseExpiresAt!) <= nowMillis
            ) {
              return yield* Effect.fail(fail(operation, "lease-invalid"));
            }
          }
          const leaseId = operation === "acquire" ? randomUUID() : row.activeLeaseId!;
          const fencingToken =
            operation === "acquire" ? row.lastFencingToken + 1 : row.leaseFencingToken!;
          const expiresAt = new Date(nowMillis + binding.policy.leaseLifetimeMillis).toISOString();
          const encodedLease = {
            sharedProjectId: command.sharedProjectId,
            databaseId: command.databaseId,
            leaseId,
            holderUserId: grant.principal.userId,
            holderDeviceId: grant.principal.deviceId,
            membershipEpoch: grant.principal.membershipEpoch,
            fencingToken,
            grantedAt: now,
            expiresAt,
          };
          const lease = decodeWriterLease(encodedLease, { onExcessProperty: "error" });
          yield* sql`
            UPDATE collaboration_database_states SET
              last_fencing_token = ${fencingToken}, active_lease_id = ${leaseId},
              holder_user_id = ${grant.principal.userId},
              holder_device_id = ${grant.principal.deviceId},
              lease_membership_epoch = ${grant.principal.membershipEpoch},
              lease_fencing_token = ${fencingToken}, lease_granted_at = ${now},
              lease_expires_at = ${expiresAt}, updated_at = ${now}
            WHERE shared_project_id = ${command.sharedProjectId}
              AND database_id = ${command.databaseId}
          `;
          yield* storeReceipt(
            command.sharedProjectId,
            command.databaseId,
            command.commandId,
            operation,
            requestJson,
            encodedLease,
            now,
          );
          return lease;
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail(operation, "storage-unavailable"),
      ),
    );

  const releaseLease: CollaborationDatabaseStoreShape["releaseLease"] = (input) => {
    const operation = "release" as const;
    return Effect.gen(function* () {
      const command = yield* decodeLeaseCommand(input?.command, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError(() => fail(operation, "invalid-command")));
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* lockProject(command.sharedProjectId);
          const grant = yield* authorize(input?.principal, command.sharedProjectId, operation);
          const requestJson = receiptRequestJson(command, grant.principal);
          const { row, binding } = yield* readState(
            command.sharedProjectId,
            command.databaseId,
            operation,
          );
          const retry = yield* retryReceipt(
            command.sharedProjectId,
            command.databaseId,
            command.commandId,
            operation,
            requestJson,
          );
          if (retry !== null) return retry as CollaborationDatabaseReleaseResult;
          const now = DateTime.formatIso(yield* DateTime.now);
          if (
            binding.policy.kind !== "serialized-head" ||
            binding.activeLease === null ||
            row.activeLeaseId !== command.leaseId ||
            row.leaseFencingToken !== command.fencingToken ||
            row.holderUserId !== grant.principal.userId ||
            row.holderDeviceId !== grant.principal.deviceId ||
            row.leaseMembershipEpoch !== grant.principal.membershipEpoch ||
            Date.parse(row.leaseExpiresAt!) <= Date.parse(now)
          ) {
            return yield* Effect.fail(fail(operation, "lease-invalid"));
          }
          yield* sql`
            UPDATE collaboration_database_states SET active_lease_id = NULL,
              holder_user_id = NULL, holder_device_id = NULL,
              lease_membership_epoch = NULL, lease_fencing_token = NULL,
              lease_granted_at = NULL, lease_expires_at = NULL, updated_at = ${now}
            WHERE shared_project_id = ${command.sharedProjectId}
              AND database_id = ${command.databaseId}
          `;
          const encoded = {
            sharedProjectId: command.sharedProjectId,
            databaseId: command.databaseId,
            leaseId: command.leaseId,
            fencingToken: command.fencingToken,
            released: true as const,
          };
          const result = decodeReleaseResult(encoded, { onExcessProperty: "error" });
          yield* storeReceipt(
            command.sharedProjectId,
            command.databaseId,
            command.commandId,
            operation,
            requestJson,
            encoded,
            now,
          );
          return result;
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail(operation, "storage-unavailable"),
      ),
    );
  };

  const publishHead: CollaborationDatabaseStoreShape["publishHead"] = (input) => {
    const operation = "publish" as const;
    return Effect.gen(function* () {
      const command = yield* decodePublish(input?.command, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => fail(operation, "invalid-command")),
      );
      const { update } = command;
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* lockProject(update.sharedProjectId);
          const grant = yield* authorize(input?.principal, update.sharedProjectId, operation);
          const requestJson = receiptRequestJson(command, grant.principal);
          const { row, binding } = yield* readState(
            update.sharedProjectId,
            update.databaseId,
            operation,
          );
          const retry = yield* retryReceipt(
            update.sharedProjectId,
            update.databaseId,
            command.commandId,
            operation,
            requestJson,
          );
          if (retry !== null) return retry as CollaborationDatabaseSnapshot;
          const now = DateTime.formatIso(yield* DateTime.now);
          if (
            binding.policy.kind !== "serialized-head" ||
            binding.activeLease === null ||
            row.activeLeaseId !== update.leaseId ||
            row.leaseFencingToken !== update.fencingToken ||
            row.holderUserId !== grant.principal.userId ||
            row.holderDeviceId !== grant.principal.deviceId ||
            row.leaseMembershipEpoch !== grant.principal.membershipEpoch ||
            update.authorUserId !== grant.principal.userId ||
            update.authorDeviceId !== grant.principal.deviceId ||
            update.membershipEpoch !== grant.principal.membershipEpoch ||
            Date.parse(row.leaseExpiresAt!) <= Date.parse(now) ||
            update.snapshot.relativePath !== binding.relativePath ||
            update.snapshot.engine !== binding.engine
          ) {
            return yield* Effect.fail(fail(operation, "lease-invalid"));
          }
          if (update.expectedHeadContentSha256 !== row.headContentSha256) {
            return yield* Effect.fail(fail(operation, "head-conflict"));
          }
          const snapshotJson = canonicalJson(update.snapshot);
          yield* sql`
            UPDATE collaboration_database_states SET
              head_content_sha256 = ${update.snapshot.contentSha256},
              head_snapshot_json = ${snapshotJson}, updated_at = ${now}
            WHERE shared_project_id = ${update.sharedProjectId}
              AND database_id = ${update.databaseId}
          `;
          yield* storeReceipt(
            update.sharedProjectId,
            update.databaseId,
            command.commandId,
            operation,
            requestJson,
            update.snapshot,
            now,
          );
          return update.snapshot;
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail(operation, "storage-unavailable"),
      ),
    );
  };

  return {
    configure,
    acquireLease: (input) => mutateLease("acquire", input),
    renewLease: (input) => mutateLease("renew", input),
    releaseLease,
    publishHead,
  } satisfies CollaborationDatabaseStoreShape;
});

export const CollaborationDatabaseStoreLive = Layer.effect(CollaborationDatabaseStore, makeStore);
