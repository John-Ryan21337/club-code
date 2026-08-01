import type {
  CollaborationFileConflict as FileConflict,
  CollaborationFileContentManifest as FileManifest,
  CollaborationFileHead as FileHead,
  CollaborationFilePublishCommand as PublishCommand,
  CollaborationFilePublishResult as PublishResult,
  CollaborationFileState as FileState,
  CollaborationFileTombstone as FileTombstone,
  CollaborationFileTombstoneCommand as TombstoneCommand,
  CollaborationFileTombstoneResult as TombstoneResult,
  CollaborationFileVersion as FileVersion,
  CollaborationPrincipal,
  SharedProjectId,
} from "@cafecode/contracts";
import {
  CollaborationFileConflict,
  CollaborationFileContentKind,
  CollaborationFileContentManifest,
  CollaborationFilePublishCommand,
  CollaborationFilePublishResult,
  CollaborationFileReadRequest,
  CollaborationFileTombstone,
  CollaborationFileTombstoneCommand,
  CollaborationFileTombstoneResult,
  CollaborationFileVersion,
  isDatabaseSidecarPath,
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
import { CollaborationDeviceKeyAuthority } from "./CollaborationEventAdmission.ts";
import { CollaborationSandboxPathAuthority } from "./CollaborationSandboxPathAuthority.ts";

type Operation = "publish" | "read" | "tombstone";

export type CollaborationFileSyncStoreFailureReason =
  | "invalid-command"
  | "not-authorized"
  | "device-key-unavailable"
  | "path-unsafe"
  | "database-declaration-required"
  | "database-authority-invalid"
  | "database-sidecar-forbidden"
  | "idempotency-conflict"
  | "integrity-failure"
  | "storage-unavailable";

export class CollaborationFileSyncStoreError extends Data.TaggedError(
  "CollaborationFileSyncStoreError",
)<{
  readonly operation: Operation;
  readonly reason: CollaborationFileSyncStoreFailureReason;
}> {}

interface CommandInput {
  readonly principal: unknown;
  readonly command: unknown;
}

interface ReadInput {
  readonly principal: unknown;
  readonly request: unknown;
}

export interface CollaborationFileSyncStoreShape {
  readonly publish: (
    input: CommandInput,
  ) => Effect.Effect<
    PublishResult,
    CollaborationFileSyncStoreError,
    | CollaborationMembershipAuthority
    | CollaborationDeviceKeyAuthority
    | CollaborationSandboxPathAuthority
  >;
  readonly tombstone: (
    input: CommandInput,
  ) => Effect.Effect<
    TombstoneResult,
    CollaborationFileSyncStoreError,
    | CollaborationMembershipAuthority
    | CollaborationDeviceKeyAuthority
    | CollaborationSandboxPathAuthority
  >;
  readonly read: (
    input: ReadInput,
  ) => Effect.Effect<
    FileState,
    CollaborationFileSyncStoreError,
    | CollaborationMembershipAuthority
    | CollaborationDeviceKeyAuthority
    | CollaborationSandboxPathAuthority
  >;
}

export class CollaborationFileSyncStore extends Context.Service<
  CollaborationFileSyncStore,
  CollaborationFileSyncStoreShape
>()("cafecode/collaboration/CollaborationFileSyncStore") {}

interface HeadRow {
  readonly revisionId: string;
  readonly revisionKind: "version" | "tombstone";
  readonly versionId: string | null;
  readonly tombstoneId: string | null;
}

interface VersionRow {
  readonly versionId: string;
  readonly sharedProjectId: string;
  readonly relativePath: string;
  readonly contentSha256: string;
  readonly byteSize: number;
  readonly chunkManifestJson: string;
  readonly contentKindJson: string;
  readonly createdByUserId: string;
  readonly createdByDeviceId: string;
  readonly createdAt: string;
}

interface TombstoneRow {
  readonly tombstoneId: string;
  readonly sharedProjectId: string;
  readonly relativePath: string;
  readonly previousHeadRevisionId: string | null;
  readonly createdByUserId: string;
  readonly createdByDeviceId: string;
  readonly createdAt: string;
}

interface ConflictRow {
  readonly conflictId: string;
  readonly sharedProjectId: string;
  readonly relativePath: string;
  readonly expectedHeadRevisionId: string | null;
  readonly observedHeadRevisionId: string | null;
  readonly proposedRevisionId: string;
  readonly proposedRevisionKind: "version" | "tombstone";
  readonly createdAt: string;
}

interface ReceiptRow {
  readonly operation: "publish" | "tombstone";
  readonly requestSha256: string;
  readonly actorUserId: string;
  readonly actorDeviceId: string;
  readonly actorMembershipEpoch: number;
  readonly responseJson: string;
  readonly responseSha256: string;
}

interface DatabaseAuthorityRow {
  readonly relativePath: string;
  readonly engine: string;
  readonly coordinationKind: string;
  readonly headContentSha256: string | null;
  readonly headSnapshotJson: string | null;
  readonly activeLeaseId: string | null;
  readonly holderUserId: string | null;
  readonly holderDeviceId: string | null;
  readonly leaseMembershipEpoch: number | null;
  readonly leaseFencingToken: number | null;
  readonly leaseExpiresAt: string | null;
}

interface DatabaseSnapshotAuthority {
  readonly createdByUserId?: unknown;
  readonly createdByDeviceId?: unknown;
  readonly contentSha256?: unknown;
}

const decodePublish = Schema.decodeUnknownEffect(CollaborationFilePublishCommand);
const decodeRead = Schema.decodeUnknownEffect(CollaborationFileReadRequest);
const decodeTombstoneCommand = Schema.decodeUnknownEffect(CollaborationFileTombstoneCommand);
const decodeManifest = Schema.decodeUnknownSync(CollaborationFileContentManifest);
const decodeContentKind = Schema.decodeUnknownSync(CollaborationFileContentKind);
const decodeVersion = Schema.decodeUnknownSync(CollaborationFileVersion);
const decodeTombstone = Schema.decodeUnknownSync(CollaborationFileTombstone);
const decodeConflict = Schema.decodeUnknownSync(CollaborationFileConflict);
const decodePublishResult = Schema.decodeUnknownSync(CollaborationFilePublishResult);
const decodeTombstoneResult = Schema.decodeUnknownSync(CollaborationFileTombstoneResult);

const DATABASE_PATH_PATTERN = /(?:^|\/)[^/]+\.(?:db|db3|sqlite|sqlite3|duckdb|lmdb|mdb)$/iu;

function fail(operation: Operation, reason: CollaborationFileSyncStoreFailureReason) {
  return new CollaborationFileSyncStoreError({ operation, reason });
}

function isStoreError(cause: unknown): cause is CollaborationFileSyncStoreError {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "CollaborationFileSyncStoreError"
  );
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

function canonicalParse(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  if (canonicalJson(parsed) !== value) throw new Error("non-canonical JSON");
  return parsed;
}

function headFromRow(row: HeadRow | undefined): FileHead | null {
  if (!row) return null;
  if (
    row.revisionKind === "version" &&
    row.versionId === row.revisionId &&
    row.tombstoneId === null
  ) {
    return {
      revisionId: row.revisionId as FileHead["revisionId"],
      kind: "version",
      versionId: row.versionId as Extract<FileHead, { kind: "version" }>["versionId"],
    };
  }
  if (
    row.revisionKind === "tombstone" &&
    row.tombstoneId === row.revisionId &&
    row.versionId === null
  ) {
    return {
      revisionId: row.revisionId as FileHead["revisionId"],
      kind: "tombstone",
      tombstoneId: row.tombstoneId as Extract<FileHead, { kind: "tombstone" }>["tombstoneId"],
    };
  }
  throw new Error("corrupt collaboration file head");
}

function versionFromRow(row: VersionRow): FileVersion {
  const manifest = decodeManifest(
    {
      ...(canonicalParse(row.chunkManifestJson) as object),
      contentSha256: row.contentSha256,
      byteSize: row.byteSize,
    },
    { onExcessProperty: "error" },
  );
  return decodeVersion(
    {
      versionId: row.versionId,
      sharedProjectId: row.sharedProjectId,
      relativePath: row.relativePath,
      manifest,
      contentKind: decodeContentKind(canonicalParse(row.contentKindJson), {
        onExcessProperty: "error",
      }),
      createdByUserId: row.createdByUserId,
      createdByDeviceId: row.createdByDeviceId,
      createdAt: row.createdAt,
    },
    { onExcessProperty: "error" },
  );
}

function tombstoneFromRow(row: TombstoneRow): FileTombstone {
  return decodeTombstone(
    {
      tombstoneId: row.tombstoneId,
      sharedProjectId: row.sharedProjectId,
      relativePath: row.relativePath,
      previousHeadRevisionId: row.previousHeadRevisionId,
      createdByUserId: row.createdByUserId,
      createdByDeviceId: row.createdByDeviceId,
      createdAt: row.createdAt,
    },
    { onExcessProperty: "error" },
  );
}

function conflictFromRow(row: ConflictRow): FileConflict {
  return decodeConflict(
    {
      conflictId: row.conflictId,
      sharedProjectId: row.sharedProjectId,
      relativePath: row.relativePath,
      expectedHeadRevisionId: row.expectedHeadRevisionId,
      observedHeadRevisionId: row.observedHeadRevisionId,
      proposedRevisionId: row.proposedRevisionId,
      proposedRevisionKind: row.proposedRevisionKind,
      createdAt: row.createdAt,
    },
    { onExcessProperty: "error" },
  );
}

function commandRequestJson(
  command: PublishCommand | TombstoneCommand,
  principal: Pick<CollaborationPrincipal, "userId" | "deviceId" | "membershipEpoch">,
): string {
  return canonicalJson({
    command,
    actor: {
      userId: principal.userId,
      deviceId: principal.deviceId,
      membershipEpoch: principal.membershipEpoch,
    },
  });
}

const makeStore = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const lockPath = (sharedProjectId: SharedProjectId, relativePath: string) => sql`
    INSERT INTO collaboration_file_write_locks (shared_project_id, relative_path)
    VALUES (${sharedProjectId}, ${relativePath})
    ON CONFLICT(shared_project_id, relative_path)
    DO UPDATE SET relative_path = excluded.relative_path
  `;

  const readHeadRow = (sharedProjectId: string, relativePath: string) =>
    sql<HeadRow>`
      SELECT revision_id AS "revisionId", revision_kind AS "revisionKind",
        version_id AS "versionId", tombstone_id AS "tombstoneId"
      FROM collaboration_file_heads
      WHERE shared_project_id = ${sharedProjectId} AND relative_path = ${relativePath}
    `;

  const assertPath = (operation: Operation, relativePath: PublishCommand["relativePath"]) =>
    Effect.gen(function* () {
      const pathAuthority = yield* CollaborationSandboxPathAuthority;
      yield* pathAuthority
        .assertContained(relativePath)
        .pipe(Effect.mapError(() => fail(operation, "path-unsafe")));
    });

  const authorizeActor = (
    operation: Operation,
    permission: "file.read" | "file.publish" | "file.tombstone",
    principal: unknown,
    sharedProjectId: SharedProjectId,
    deviceKeyId: PublishCommand["deviceKeyId"],
  ) =>
    Effect.gen(function* () {
      const grant = yield* authorizeCollaborationPermission({
        principal,
        targetProjectId: sharedProjectId,
        permission,
      }).pipe(Effect.mapError(() => fail(operation, "not-authorized")));
      const deviceAuthority = yield* CollaborationDeviceKeyAuthority;
      const activeKey = yield* deviceAuthority
        .getActiveEd25519PublicKey({
          sharedProjectId,
          userId: grant.principal.userId,
          deviceId: grant.principal.deviceId,
          deviceKeyId,
          membershipEpoch: grant.principal.membershipEpoch,
        })
        .pipe(Effect.mapError(() => fail(operation, "device-key-unavailable")));
      if (
        activeKey === null ||
        activeKey.sharedProjectId !== sharedProjectId ||
        activeKey.userId !== grant.principal.userId ||
        activeKey.deviceId !== grant.principal.deviceId ||
        activeKey.deviceKeyId !== deviceKeyId ||
        activeKey.membershipEpoch !== grant.principal.membershipEpoch
      ) {
        return yield* Effect.fail(fail(operation, "not-authorized"));
      }
      if (
        !(activeKey.publicKeySpkiDer instanceof Uint8Array) ||
        activeKey.publicKeySpkiDer.byteLength !== 44
      ) {
        return yield* Effect.fail(fail(operation, "device-key-unavailable"));
      }
      return grant.principal;
    });

  const verifyDatabaseAuthority = (
    operation: Operation,
    command: PublishCommand,
    principal: CollaborationPrincipal,
    now: string,
  ) =>
    Effect.gen(function* () {
      if (isDatabaseSidecarPath(command.relativePath)) {
        return yield* Effect.fail(fail(operation, "database-sidecar-forbidden"));
      }
      if (command.contentKind.kind === "regular-file") {
        if (DATABASE_PATH_PATTERN.test(command.relativePath)) {
          return yield* Effect.fail(fail(operation, "database-declaration-required"));
        }
        return true;
      }
      const rows = yield* sql<DatabaseAuthorityRow>`
        SELECT relative_path AS "relativePath", engine,
          coordination_kind AS "coordinationKind",
          head_content_sha256 AS "headContentSha256",
          head_snapshot_json AS "headSnapshotJson",
          active_lease_id AS "activeLeaseId",
          holder_user_id AS "holderUserId",
          holder_device_id AS "holderDeviceId",
          lease_membership_epoch AS "leaseMembershipEpoch",
          lease_fencing_token AS "leaseFencingToken",
          lease_expires_at AS "leaseExpiresAt"
        FROM collaboration_database_states
        WHERE shared_project_id = ${command.sharedProjectId}
          AND database_id = ${command.contentKind.databaseId}
      `;
      const row = rows[0];
      let snapshot: DatabaseSnapshotAuthority | null = null;
      try {
        snapshot = row?.headSnapshotJson
          ? (canonicalParse(row.headSnapshotJson) as DatabaseSnapshotAuthority)
          : null;
      } catch {
        return yield* Effect.fail(fail(operation, "integrity-failure"));
      }
      if (
        !row ||
        row.relativePath !== command.relativePath ||
        row.engine !== command.contentKind.engine ||
        row.coordinationKind !== "serialized-head" ||
        row.activeLeaseId !== command.contentKind.leaseId ||
        row.holderUserId !== principal.userId ||
        row.holderDeviceId !== principal.deviceId ||
        row.leaseMembershipEpoch !== principal.membershipEpoch ||
        row.leaseFencingToken !== command.contentKind.fencingToken ||
        row.leaseExpiresAt === null ||
        Date.parse(row.leaseExpiresAt) <= Date.parse(now)
      ) {
        return yield* Effect.fail(fail(operation, "database-authority-invalid"));
      }
      // A current serialized database head may advance the shared file head.
      // Older/private database snapshots from the same fenced writer remain
      // admissible as immutable forks, but can never win the canonical CAS.
      return (
        row.headContentSha256 === command.manifest.contentSha256 &&
        snapshot?.contentSha256 === command.manifest.contentSha256 &&
        snapshot.createdByUserId === principal.userId &&
        snapshot.createdByDeviceId === principal.deviceId
      );
    });

  const retryReceipt = (
    operation: "publish" | "tombstone",
    command: PublishCommand | TombstoneCommand,
    principal: CollaborationPrincipal,
    requestJson: string,
  ) =>
    Effect.gen(function* () {
      const rows = yield* sql<ReceiptRow>`
        SELECT operation, request_sha256 AS "requestSha256",
          actor_user_id AS "actorUserId", actor_device_id AS "actorDeviceId",
          actor_membership_epoch AS "actorMembershipEpoch",
          response_json AS "responseJson", response_sha256 AS "responseSha256"
        FROM collaboration_file_command_receipts
        WHERE shared_project_id = ${command.sharedProjectId}
          AND command_id = ${command.commandId}
      `;
      const row = rows[0];
      if (!row) return null;
      if (
        row.operation !== operation ||
        row.requestSha256 !== sha256(requestJson) ||
        row.actorUserId !== principal.userId ||
        row.actorDeviceId !== principal.deviceId ||
        row.actorMembershipEpoch !== principal.membershipEpoch ||
        row.responseSha256 !== sha256(row.responseJson)
      ) {
        return yield* Effect.fail(fail(operation, "idempotency-conflict"));
      }
      try {
        const parsed = canonicalParse(row.responseJson);
        if (operation === "publish") {
          const decoded = decodePublishResult(parsed, { onExcessProperty: "error" });
          if (
            decoded.version.sharedProjectId !== command.sharedProjectId ||
            decoded.version.relativePath !== command.relativePath
          ) {
            throw new Error("receipt target mismatch");
          }
          return { ...decoded, disposition: "already-applied" as const };
        }
        const decoded = decodeTombstoneResult(parsed, { onExcessProperty: "error" });
        if (
          decoded.tombstone.sharedProjectId !== command.sharedProjectId ||
          decoded.tombstone.relativePath !== command.relativePath
        ) {
          throw new Error("receipt target mismatch");
        }
        return { ...decoded, disposition: "already-applied" as const };
      } catch {
        return yield* Effect.fail(fail(operation, "integrity-failure"));
      }
    });

  const storeReceipt = (
    operation: "publish" | "tombstone",
    command: PublishCommand | TombstoneCommand,
    principal: CollaborationPrincipal,
    requestJson: string,
    response: PublishResult | TombstoneResult,
    now: string,
  ) => {
    const responseJson = canonicalJson(response);
    return sql`
      INSERT INTO collaboration_file_command_receipts (
        shared_project_id, command_id, operation, request_sha256,
        actor_user_id, actor_device_id, actor_membership_epoch,
        response_json, response_sha256, created_at
      ) VALUES (
        ${command.sharedProjectId}, ${command.commandId}, ${operation}, ${sha256(requestJson)},
        ${principal.userId}, ${principal.deviceId}, ${principal.membershipEpoch},
        ${responseJson}, ${sha256(responseJson)}, ${now}
      )
    `;
  };

  const storeManifest = (
    sharedProjectId: SharedProjectId,
    manifest: FileManifest,
    now: string,
    operation: Operation,
  ) =>
    Effect.gen(function* () {
      const chunkManifestJson = canonicalJson({ chunks: manifest.chunks });
      const chunkManifestSha256 = sha256(chunkManifestJson);
      yield* sql`
        INSERT INTO collaboration_file_contents (
          shared_project_id, content_sha256, byte_size,
          chunk_manifest_json, chunk_manifest_sha256, created_at
        ) VALUES (
          ${sharedProjectId}, ${manifest.contentSha256}, ${manifest.byteSize},
          ${chunkManifestJson}, ${chunkManifestSha256}, ${now}
        ) ON CONFLICT(shared_project_id, content_sha256) DO NOTHING
      `;
      const contents = yield* sql<{
        readonly byteSize: number;
        readonly chunkManifestJson: string;
        readonly chunkManifestSha256: string;
      }>`
        SELECT byte_size AS "byteSize", chunk_manifest_json AS "chunkManifestJson",
          chunk_manifest_sha256 AS "chunkManifestSha256"
        FROM collaboration_file_contents
        WHERE shared_project_id = ${sharedProjectId}
          AND content_sha256 = ${manifest.contentSha256}
      `;
      const content = contents[0];
      if (
        !content ||
        content.byteSize !== manifest.byteSize ||
        content.chunkManifestJson !== chunkManifestJson ||
        content.chunkManifestSha256 !== chunkManifestSha256
      ) {
        return yield* Effect.fail(fail(operation, "integrity-failure"));
      }
      for (const chunk of manifest.chunks) {
        yield* sql`
          INSERT INTO collaboration_file_chunks (
            shared_project_id, content_sha256, chunk_index, chunk_offset, byte_size, chunk_sha256
          ) VALUES (
            ${sharedProjectId}, ${manifest.contentSha256}, ${chunk.index},
            ${chunk.offset}, ${chunk.byteSize}, ${chunk.contentSha256}
          ) ON CONFLICT(shared_project_id, content_sha256, chunk_index) DO NOTHING
        `;
      }
      const chunks = yield* sql<{
        readonly index: number;
        readonly offset: number;
        readonly byteSize: number;
        readonly contentSha256: string;
      }>`
        SELECT chunk_index AS "index", chunk_offset AS "offset", byte_size AS "byteSize",
          chunk_sha256 AS "contentSha256"
        FROM collaboration_file_chunks
        WHERE shared_project_id = ${sharedProjectId}
          AND content_sha256 = ${manifest.contentSha256}
        ORDER BY chunk_index ASC
      `;
      if (canonicalJson(chunks) !== canonicalJson(manifest.chunks)) {
        return yield* Effect.fail(fail(operation, "integrity-failure"));
      }
    });

  const publish: CollaborationFileSyncStoreShape["publish"] = (input) =>
    Effect.gen(function* () {
      const command = yield* decodePublish(input?.command, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => fail("publish", "invalid-command")),
      );
      yield* assertPath("publish", command.relativePath);
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* lockPath(command.sharedProjectId, command.relativePath);
          // Membership epoch and active-device authority are checked after the
          // path writer lock, immediately before any durable mutation.
          const principal = yield* authorizeActor(
            "publish",
            "file.publish",
            input?.principal,
            command.sharedProjectId,
            command.deviceKeyId,
          );
          const now = DateTime.formatIso(yield* DateTime.now);
          const requestJson = commandRequestJson(command, principal);
          const retry = yield* retryReceipt("publish", command, principal, requestJson);
          if (retry !== null) return retry as PublishResult;
          const databaseHeadIsCurrent = yield* verifyDatabaseAuthority(
            "publish",
            command,
            principal,
            now,
          );
          yield* storeManifest(command.sharedProjectId, command.manifest, now, "publish");

          const versionId = sha256(
            canonicalJson([
              "club-code/cowork-file-version/v1",
              command.sharedProjectId,
              command.relativePath,
              command.manifest,
              command.contentKind,
              principal.userId,
              principal.deviceId,
            ]),
          );
          const contentKindJson = canonicalJson(command.contentKind);
          yield* sql`
            INSERT INTO collaboration_file_versions (
              version_id, shared_project_id, relative_path, content_sha256,
              content_kind, content_kind_json, created_by_user_id, created_by_device_id, created_at
            ) VALUES (
              ${versionId}, ${command.sharedProjectId}, ${command.relativePath},
              ${command.manifest.contentSha256}, ${command.contentKind.kind}, ${contentKindJson},
              ${principal.userId}, ${principal.deviceId}, ${now}
            ) ON CONFLICT(version_id) DO NOTHING
          `;
          const versionRows = yield* sql<VersionRow>`
            SELECT v.version_id AS "versionId", v.shared_project_id AS "sharedProjectId",
              v.relative_path AS "relativePath", v.content_sha256 AS "contentSha256",
              c.byte_size AS "byteSize", c.chunk_manifest_json AS "chunkManifestJson",
              v.content_kind_json AS "contentKindJson",
              v.created_by_user_id AS "createdByUserId",
              v.created_by_device_id AS "createdByDeviceId", v.created_at AS "createdAt"
            FROM collaboration_file_versions v
            JOIN collaboration_file_contents c
              ON c.shared_project_id = v.shared_project_id
              AND c.content_sha256 = v.content_sha256
            WHERE v.version_id = ${versionId}
          `;
          let version: FileVersion;
          try {
            version = versionFromRow(versionRows[0]!);
            if (
              version.sharedProjectId !== command.sharedProjectId ||
              version.relativePath !== command.relativePath ||
              canonicalJson(version.manifest) !== canonicalJson(command.manifest) ||
              canonicalJson(version.contentKind) !== contentKindJson ||
              version.createdByUserId !== principal.userId ||
              version.createdByDeviceId !== principal.deviceId
            ) {
              throw new Error("version identity mismatch");
            }
          } catch {
            return yield* Effect.fail(fail("publish", "integrity-failure"));
          }

          const headRows = yield* readHeadRow(command.sharedProjectId, command.relativePath);
          let head: FileHead | null;
          try {
            head = headFromRow(headRows[0]);
          } catch {
            return yield* Effect.fail(fail("publish", "integrity-failure"));
          }
          let conflict: FileConflict | null = null;
          let disposition: PublishResult["disposition"];
          if (
            databaseHeadIsCurrent &&
            (head?.revisionId ?? null) === command.expectedHeadRevisionId
          ) {
            yield* sql`
              INSERT INTO collaboration_file_heads (
                shared_project_id, relative_path, revision_id, revision_kind,
                version_id, tombstone_id, updated_at
              ) VALUES (
                ${command.sharedProjectId}, ${command.relativePath}, ${versionId},
                ${"version"}, ${versionId}, ${null}, ${now}
              ) ON CONFLICT(shared_project_id, relative_path) DO UPDATE SET
                revision_id = excluded.revision_id, revision_kind = excluded.revision_kind,
                version_id = excluded.version_id, tombstone_id = excluded.tombstone_id,
                updated_at = excluded.updated_at
            `;
            head = { revisionId: version.versionId, kind: "version", versionId: version.versionId };
            disposition = "head-advanced";
          } else {
            const conflictId = sha256(
              canonicalJson([
                "club-code/cowork-file-conflict/v1",
                command.sharedProjectId,
                command.relativePath,
                command.expectedHeadRevisionId,
                head?.revisionId ?? null,
                version.versionId,
                "version",
              ]),
            );
            yield* sql`
              INSERT INTO collaboration_file_conflicts (
                conflict_id, shared_project_id, relative_path, expected_head_revision_id,
                observed_head_revision_id, proposed_revision_id, proposed_revision_kind, created_at
              ) VALUES (
                ${conflictId}, ${command.sharedProjectId}, ${command.relativePath},
                ${command.expectedHeadRevisionId}, ${head?.revisionId ?? null}, ${version.versionId},
                ${"version"}, ${now}
              ) ON CONFLICT(conflict_id) DO NOTHING
            `;
            conflict = decodeConflict(
              {
                conflictId,
                sharedProjectId: command.sharedProjectId,
                relativePath: command.relativePath,
                expectedHeadRevisionId: command.expectedHeadRevisionId,
                observedHeadRevisionId: head?.revisionId ?? null,
                proposedRevisionId: version.versionId,
                proposedRevisionKind: "version",
                createdAt: now,
              },
              { onExcessProperty: "error" },
            );
            disposition = "fork-preserved";
          }
          const result: PublishResult = { disposition, version, head, conflict };
          yield* storeReceipt("publish", command, principal, requestJson, result, now);
          return result;
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail("publish", "storage-unavailable"),
      ),
    );

  const tombstone: CollaborationFileSyncStoreShape["tombstone"] = (input) =>
    Effect.gen(function* () {
      const command = yield* decodeTombstoneCommand(input?.command, {
        onExcessProperty: "error",
      }).pipe(Effect.mapError(() => fail("tombstone", "invalid-command")));
      yield* assertPath("tombstone", command.relativePath);
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* lockPath(command.sharedProjectId, command.relativePath);
          const principal = yield* authorizeActor(
            "tombstone",
            "file.tombstone",
            input?.principal,
            command.sharedProjectId,
            command.deviceKeyId,
          );
          const requestJson = commandRequestJson(command, principal);
          const retry = yield* retryReceipt("tombstone", command, principal, requestJson);
          if (retry !== null) return retry as TombstoneResult;
          const now = DateTime.formatIso(yield* DateTime.now);
          const headRows = yield* readHeadRow(command.sharedProjectId, command.relativePath);
          let head: FileHead | null;
          try {
            head = headFromRow(headRows[0]);
          } catch {
            return yield* Effect.fail(fail("tombstone", "integrity-failure"));
          }
          const tombstoneId = sha256(
            canonicalJson([
              "club-code/cowork-file-tombstone/v1",
              command.sharedProjectId,
              command.relativePath,
              command.commandId,
              command.expectedHeadRevisionId,
              principal.userId,
              principal.deviceId,
            ]),
          );
          yield* sql`
            INSERT INTO collaboration_file_tombstones (
              tombstone_id, shared_project_id, relative_path, previous_head_revision_id,
              created_by_user_id, created_by_device_id, created_at
            ) VALUES (
              ${tombstoneId}, ${command.sharedProjectId}, ${command.relativePath},
              ${command.expectedHeadRevisionId}, ${principal.userId}, ${principal.deviceId}, ${now}
            ) ON CONFLICT(tombstone_id) DO NOTHING
          `;
          const tombstoneValue = decodeTombstone(
            {
              tombstoneId,
              sharedProjectId: command.sharedProjectId,
              relativePath: command.relativePath,
              previousHeadRevisionId: command.expectedHeadRevisionId,
              createdByUserId: principal.userId,
              createdByDeviceId: principal.deviceId,
              createdAt: now,
            },
            { onExcessProperty: "error" },
          );
          let conflict: FileConflict | null = null;
          let disposition: TombstoneResult["disposition"];
          if ((head?.revisionId ?? null) === command.expectedHeadRevisionId) {
            yield* sql`
              INSERT INTO collaboration_file_heads (
                shared_project_id, relative_path, revision_id, revision_kind,
                version_id, tombstone_id, updated_at
              ) VALUES (
                ${command.sharedProjectId}, ${command.relativePath}, ${tombstoneId},
                ${"tombstone"}, ${null}, ${tombstoneId}, ${now}
              ) ON CONFLICT(shared_project_id, relative_path) DO UPDATE SET
                revision_id = excluded.revision_id, revision_kind = excluded.revision_kind,
                version_id = excluded.version_id, tombstone_id = excluded.tombstone_id,
                updated_at = excluded.updated_at
            `;
            head = {
              revisionId: tombstoneValue.tombstoneId,
              kind: "tombstone",
              tombstoneId: tombstoneValue.tombstoneId,
            };
            disposition = "head-advanced";
          } else {
            const conflictId = sha256(
              canonicalJson([
                "club-code/cowork-file-conflict/v1",
                command.sharedProjectId,
                command.relativePath,
                command.expectedHeadRevisionId,
                head?.revisionId ?? null,
                tombstoneValue.tombstoneId,
                "tombstone",
              ]),
            );
            yield* sql`
              INSERT INTO collaboration_file_conflicts (
                conflict_id, shared_project_id, relative_path, expected_head_revision_id,
                observed_head_revision_id, proposed_revision_id, proposed_revision_kind, created_at
              ) VALUES (
                ${conflictId}, ${command.sharedProjectId}, ${command.relativePath},
                ${command.expectedHeadRevisionId}, ${head?.revisionId ?? null},
                ${tombstoneValue.tombstoneId}, ${"tombstone"}, ${now}
              ) ON CONFLICT(conflict_id) DO NOTHING
            `;
            conflict = decodeConflict(
              {
                conflictId,
                sharedProjectId: command.sharedProjectId,
                relativePath: command.relativePath,
                expectedHeadRevisionId: command.expectedHeadRevisionId,
                observedHeadRevisionId: head?.revisionId ?? null,
                proposedRevisionId: tombstoneValue.tombstoneId,
                proposedRevisionKind: "tombstone",
                createdAt: now,
              },
              { onExcessProperty: "error" },
            );
            disposition = "tombstone-preserved";
          }
          const result: TombstoneResult = {
            disposition,
            tombstone: tombstoneValue,
            head,
            conflict,
          };
          yield* storeReceipt("tombstone", command, principal, requestJson, result, now);
          return result;
        }),
      );
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail("tombstone", "storage-unavailable"),
      ),
    );

  const read: CollaborationFileSyncStoreShape["read"] = (input) =>
    Effect.gen(function* () {
      const request = yield* decodeRead(input?.request, { onExcessProperty: "error" }).pipe(
        Effect.mapError(() => fail("read", "invalid-command")),
      );
      yield* assertPath("read", request.relativePath);
      yield* authorizeActor(
        "read",
        "file.read",
        input?.principal,
        request.sharedProjectId,
        request.deviceKeyId,
      );
      const headRows = yield* readHeadRow(request.sharedProjectId, request.relativePath);
      const versionRows = yield* sql<VersionRow>`
        SELECT v.version_id AS "versionId", v.shared_project_id AS "sharedProjectId",
          v.relative_path AS "relativePath", v.content_sha256 AS "contentSha256",
          c.byte_size AS "byteSize", c.chunk_manifest_json AS "chunkManifestJson",
          v.content_kind_json AS "contentKindJson",
          v.created_by_user_id AS "createdByUserId",
          v.created_by_device_id AS "createdByDeviceId", v.created_at AS "createdAt"
        FROM collaboration_file_versions v
        JOIN collaboration_file_contents c
          ON c.shared_project_id = v.shared_project_id AND c.content_sha256 = v.content_sha256
        WHERE v.shared_project_id = ${request.sharedProjectId}
          AND v.relative_path = ${request.relativePath}
        ORDER BY v.created_at DESC, v.version_id DESC LIMIT 100
      `;
      const tombstoneRows = yield* sql<TombstoneRow>`
        SELECT tombstone_id AS "tombstoneId", shared_project_id AS "sharedProjectId",
          relative_path AS "relativePath", previous_head_revision_id AS "previousHeadRevisionId",
          created_by_user_id AS "createdByUserId", created_by_device_id AS "createdByDeviceId",
          created_at AS "createdAt"
        FROM collaboration_file_tombstones
        WHERE shared_project_id = ${request.sharedProjectId} AND relative_path = ${request.relativePath}
        ORDER BY created_at DESC, tombstone_id DESC LIMIT 100
      `;
      const conflictRows = yield* sql<ConflictRow>`
        SELECT conflict_id AS "conflictId", shared_project_id AS "sharedProjectId",
          relative_path AS "relativePath", expected_head_revision_id AS "expectedHeadRevisionId",
          observed_head_revision_id AS "observedHeadRevisionId",
          proposed_revision_id AS "proposedRevisionId",
          proposed_revision_kind AS "proposedRevisionKind", created_at AS "createdAt"
        FROM collaboration_file_conflicts
        WHERE shared_project_id = ${request.sharedProjectId} AND relative_path = ${request.relativePath}
        ORDER BY created_at DESC, conflict_id DESC LIMIT 100
      `;
      try {
        const head = headFromRow(headRows[0]);
        const versions = versionRows.map(versionFromRow);
        const headVersion =
          head?.kind === "version"
            ? (versions.find((version) => version.versionId === head.versionId) ?? null)
            : null;
        return {
          sharedProjectId: request.sharedProjectId,
          relativePath: request.relativePath,
          head,
          headVersion,
          forks: versions.filter((version) => version.versionId !== headVersion?.versionId),
          tombstones: tombstoneRows.map(tombstoneFromRow),
          conflicts: conflictRows.map(conflictFromRow),
        } satisfies FileState;
      } catch {
        return yield* Effect.fail(fail("read", "integrity-failure"));
      }
    }).pipe(
      Effect.mapError((cause) =>
        isStoreError(cause) ? cause : fail("read", "storage-unavailable"),
      ),
    );

  return { publish, tombstone, read } satisfies CollaborationFileSyncStoreShape;
});

export const CollaborationFileSyncStoreLive = Layer.effect(CollaborationFileSyncStore, makeStore);
