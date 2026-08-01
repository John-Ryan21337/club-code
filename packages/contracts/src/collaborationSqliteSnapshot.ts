import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt } from "./baseSchemas.ts";
import {
  CollaborationDeviceKeyId,
  CollaborationMembershipEpoch,
  CollaborationSha256,
  SharedProjectId,
} from "./collaboration.ts";
import {
  CollaborationDatabaseFencingToken,
  CollaborationDatabaseId,
  CollaborationDatabaseLeaseId,
  CollaborationDatabaseSnapshot,
} from "./fileSync.ts";

export const COLLABORATION_SQLITE_SNAPSHOT_MAX_BYTES = 1024 * 1024 * 1024;
export const COLLABORATION_SQLITE_PAGE_SIZE_MAX = 65_536;
export const COLLABORATION_SQLITE_PAGE_COUNT_MAX = Math.floor(
  COLLABORATION_SQLITE_SNAPSHOT_MAX_BYTES / 512,
);
export const COLLABORATION_SQLITE_APPLICATION_ID_MAX = 0x7fff_ffff;
export const COLLABORATION_SQLITE_USER_VERSION_MAX = 0x7fff_ffff;

const SnapshotOperationId = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
).pipe(Schema.brand("CollaborationSqliteSnapshotOperationId"));
export type CollaborationSqliteSnapshotOperationId = typeof SnapshotOperationId.Type;

const FenceRequest = {
  /** Correlation only until a production binding supplies durable request-bound receipts. */
  operationId: SnapshotOperationId,
  sharedProjectId: SharedProjectId,
  databaseId: CollaborationDatabaseId,
  deviceKeyId: CollaborationDeviceKeyId,
  leaseId: CollaborationDatabaseLeaseId,
  fencingToken: CollaborationDatabaseFencingToken,
  membershipEpoch: CollaborationMembershipEpoch,
  expectedAuthorityHeadContentSha256: Schema.NullOr(CollaborationSha256),
} as const;

export const CollaborationSqliteSnapshotCaptureRequest = Schema.Struct(FenceRequest);
export type CollaborationSqliteSnapshotCaptureRequest =
  typeof CollaborationSqliteSnapshotCaptureRequest.Type;

export const CollaborationSqliteJournalMode = Schema.Literals([
  "delete",
  "truncate",
  "persist",
  "wal",
]);
export type CollaborationSqliteJournalMode = typeof CollaborationSqliteJournalMode.Type;

export const CollaborationSqliteSnapshotArtifact = Schema.Struct({
  snapshot: CollaborationDatabaseSnapshot,
  artifactStorage: Schema.Literal("managed-content-addressed"),
  sqliteFormat: Schema.Literal("sqlite-format-3"),
  applicationId: NonNegativeInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_SQLITE_APPLICATION_ID_MAX),
  ),
  userVersion: NonNegativeInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_SQLITE_USER_VERSION_MAX),
  ),
  pageSize: PositiveInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_SQLITE_PAGE_SIZE_MAX)),
  pageCount: PositiveInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_SQLITE_PAGE_COUNT_MAX)),
  sourceJournalMode: CollaborationSqliteJournalMode,
  integrityCheck: Schema.Literal("ok"),
  attachedDatabaseCount: Schema.Literal(0),
  sidecarsCopied: Schema.Literal(false),
}).check(
  Schema.makeFilter((artifact) => {
    const snapshot = artifact.snapshot;
    if (
      snapshot.engine !== "sqlite" ||
      snapshot.consistency !== "online-backup" ||
      snapshot.sidecarsExcluded !== true ||
      snapshot.schemaSha256 === null
    )
      return "SQLite artifacts require an online backup with a schema hash and no sidecars";
    const pageBytes = artifact.pageSize * artifact.pageCount;
    return Number.isSafeInteger(pageBytes) && pageBytes === snapshot.byteSize
      ? undefined
      : "SQLite artifact page geometry must equal the snapshot byte size";
  }),
);
export type CollaborationSqliteSnapshotArtifact = typeof CollaborationSqliteSnapshotArtifact.Type;

export const CollaborationSqliteSnapshotCaptureResult = Schema.Struct({
  artifact: CollaborationSqliteSnapshotArtifact,
  disposition: Schema.Literals(["head-candidate", "conflict-fork"]),
  observedAuthorityHeadContentSha256: Schema.NullOr(CollaborationSha256),
}).check(
  Schema.makeFilter((result) =>
    result.disposition === "head-candidate" &&
    result.artifact.snapshot.baseContentSha256 !== result.observedAuthorityHeadContentSha256
      ? "head candidates must still be based on the observed authority head"
      : result.disposition === "conflict-fork" &&
          result.artifact.snapshot.baseContentSha256 === result.observedAuthorityHeadContentSha256
        ? "conflict forks require an authority head change"
        : undefined,
  ),
);
export type CollaborationSqliteSnapshotCaptureResult =
  typeof CollaborationSqliteSnapshotCaptureResult.Type;

export const CollaborationSqliteSnapshotRestoreRequest = Schema.Struct({
  ...FenceRequest,
  artifact: CollaborationSqliteSnapshotArtifact,
  expectedReplicaContentSha256: Schema.NullOr(CollaborationSha256),
  sourceDisposition: Schema.Literals(["canonical-head", "explicit-fork"]),
}).check(
  Schema.makeFilter((request) =>
    request.artifact.snapshot.sharedProjectId === request.sharedProjectId &&
    request.artifact.snapshot.databaseId === request.databaseId
      ? undefined
      : "restore artifact must belong to the requested project and database",
  ),
);
export type CollaborationSqliteSnapshotRestoreRequest =
  typeof CollaborationSqliteSnapshotRestoreRequest.Type;

export const CollaborationSqliteSnapshotRestoreResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("restored"),
    sharedProjectId: SharedProjectId,
    databaseId: CollaborationDatabaseId,
    contentSha256: CollaborationSha256,
    replacedContentSha256: Schema.NullOr(CollaborationSha256),
    recoveryRetained: Schema.Boolean,
    sidecarsRestored: Schema.Literal(false),
  }),
  Schema.Struct({
    status: Schema.Literal("conflict"),
    sharedProjectId: SharedProjectId,
    databaseId: CollaborationDatabaseId,
    selectedContentSha256: CollaborationSha256,
    reason: Schema.Literals([
      "authority-head-changed",
      "replica-content-changed",
      "selected-snapshot-not-head",
    ]),
    observedAuthorityHeadContentSha256: Schema.NullOr(CollaborationSha256),
    observedReplicaContentSha256: Schema.NullOr(CollaborationSha256),
    forkRetained: Schema.Literal(true),
  }),
]);
export type CollaborationSqliteSnapshotRestoreResult =
  typeof CollaborationSqliteSnapshotRestoreResult.Type;
