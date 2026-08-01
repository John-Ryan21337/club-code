import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt } from "./baseSchemas.ts";
import {
  CollaborationDeviceKeyId,
  CollaborationSha256,
  DeviceId,
  SharedProjectId,
  UserId,
} from "./collaboration.ts";
import {
  CollaborationDatabaseEngine,
  CollaborationDatabaseFencingToken,
  CollaborationDatabaseId,
  CollaborationDatabaseLeaseId,
  SharedReplicaRelativePath,
} from "./fileSync.ts";

export const COLLABORATION_FILE_CHUNK_MAX_BYTES = 64 * 1024 * 1024;
export const COLLABORATION_FILE_MAX_CHUNKS = 16_384;
export const COLLABORATION_FILE_MAX_BYTES = 1024 * 1024 * 1024 * 1024;
export const COLLABORATION_BLOB_STREAM_FRAME_MAX_BYTES = 1024 * 1024;
export const COLLABORATION_BLOB_CHUNK_MAX_BYTES = 8 * 1024 * 1024;
export const COLLABORATION_MATERIALIZED_FILE_MAX_BYTES = 1024 * 1024 * 1024;
export const COLLABORATION_PROJECT_BLOB_QUOTA_MAX_BYTES = 20 * 1024 * 1024 * 1024;

const CollaborationFileIdentifier = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
);

export const CollaborationFileCommandId = CollaborationFileIdentifier.pipe(
  Schema.brand("CollaborationFileCommandId"),
);
export type CollaborationFileCommandId = typeof CollaborationFileCommandId.Type;

export const CollaborationFileVersionId = CollaborationSha256.pipe(
  Schema.brand("CollaborationFileVersionId"),
);
export type CollaborationFileVersionId = typeof CollaborationFileVersionId.Type;

export const CollaborationFileRevisionId = CollaborationSha256;
export type CollaborationFileRevisionId = typeof CollaborationFileRevisionId.Type;

export const CollaborationFileConflictId = CollaborationSha256.pipe(
  Schema.brand("CollaborationFileConflictId"),
);
export type CollaborationFileConflictId = typeof CollaborationFileConflictId.Type;

export const CollaborationFileTombstoneId = CollaborationSha256.pipe(
  Schema.brand("CollaborationFileTombstoneId"),
);
export type CollaborationFileTombstoneId = typeof CollaborationFileTombstoneId.Type;

export const CollaborationFileChunk = Schema.Struct({
  index: NonNegativeInt,
  offset: NonNegativeInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_FILE_MAX_BYTES)),
  byteSize: PositiveInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_FILE_CHUNK_MAX_BYTES)),
  contentSha256: CollaborationSha256,
});
export type CollaborationFileChunk = typeof CollaborationFileChunk.Type;

export const CollaborationFileContentManifest = Schema.Struct({
  contentSha256: CollaborationSha256,
  byteSize: NonNegativeInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_FILE_MAX_BYTES)),
  chunks: Schema.Array(CollaborationFileChunk).check(
    Schema.isMaxLength(COLLABORATION_FILE_MAX_CHUNKS),
  ),
}).check(
  Schema.makeFilter((manifest) => {
    if (manifest.byteSize === 0) {
      return manifest.chunks.length === 0
        ? undefined
        : "empty file manifests must not contain chunks";
    }
    if (manifest.chunks.length === 0) return "non-empty file manifests require chunks";
    let offset = 0;
    for (let index = 0; index < manifest.chunks.length; index += 1) {
      const chunk = manifest.chunks[index]!;
      if (chunk.index !== index || chunk.offset !== offset) {
        return "file manifest chunks must be contiguous and canonically indexed";
      }
      offset += chunk.byteSize;
      if (!Number.isSafeInteger(offset) || offset > COLLABORATION_FILE_MAX_BYTES) {
        return "file manifest chunk sizes exceed the supported file size";
      }
    }
    return offset === manifest.byteSize
      ? undefined
      : "file manifest chunk bytes must equal the declared file size";
  }),
);
export type CollaborationFileContentManifest = typeof CollaborationFileContentManifest.Type;

export const CollaborationFileContentKind = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("regular-file") }),
  Schema.Struct({
    kind: Schema.Literal("database"),
    databaseId: CollaborationDatabaseId,
    engine: CollaborationDatabaseEngine,
    coordination: Schema.Literal("serialized-head"),
    leaseId: CollaborationDatabaseLeaseId,
    fencingToken: CollaborationDatabaseFencingToken,
  }),
]);
export type CollaborationFileContentKind = typeof CollaborationFileContentKind.Type;

export const CollaborationFilePublishCommand = Schema.Struct({
  commandId: CollaborationFileCommandId,
  sharedProjectId: SharedProjectId,
  relativePath: SharedReplicaRelativePath,
  deviceKeyId: CollaborationDeviceKeyId,
  expectedHeadRevisionId: Schema.NullOr(CollaborationFileRevisionId),
  manifest: CollaborationFileContentManifest,
  contentKind: CollaborationFileContentKind,
});
export type CollaborationFilePublishCommand = typeof CollaborationFilePublishCommand.Type;

export const CollaborationFileReadRequest = Schema.Struct({
  sharedProjectId: SharedProjectId,
  relativePath: SharedReplicaRelativePath,
  deviceKeyId: CollaborationDeviceKeyId,
});
export type CollaborationFileReadRequest = typeof CollaborationFileReadRequest.Type;

export const CollaborationFileTombstoneCommand = Schema.Struct({
  commandId: CollaborationFileCommandId,
  sharedProjectId: SharedProjectId,
  relativePath: SharedReplicaRelativePath,
  deviceKeyId: CollaborationDeviceKeyId,
  // A remote tombstone must name a version already admitted for this exact
  // project-relative path. It can never introduce a delete marker for an
  // otherwise local-only path.
  expectedHeadRevisionId: CollaborationFileRevisionId,
});
export type CollaborationFileTombstoneCommand = typeof CollaborationFileTombstoneCommand.Type;

export const CollaborationFileVersion = Schema.Struct({
  versionId: CollaborationFileVersionId,
  sharedProjectId: SharedProjectId,
  relativePath: SharedReplicaRelativePath,
  manifest: CollaborationFileContentManifest,
  contentKind: CollaborationFileContentKind,
  createdByUserId: UserId,
  createdByDeviceId: DeviceId,
  createdAt: Schema.DateTimeUtcFromString,
});
export type CollaborationFileVersion = typeof CollaborationFileVersion.Type;

export const CollaborationFileTombstone = Schema.Struct({
  tombstoneId: CollaborationFileTombstoneId,
  sharedProjectId: SharedProjectId,
  relativePath: SharedReplicaRelativePath,
  previousHeadRevisionId: CollaborationFileRevisionId,
  createdByUserId: UserId,
  createdByDeviceId: DeviceId,
  createdAt: Schema.DateTimeUtcFromString,
});
export type CollaborationFileTombstone = typeof CollaborationFileTombstone.Type;

export const CollaborationFileConflict = Schema.Struct({
  conflictId: CollaborationFileConflictId,
  sharedProjectId: SharedProjectId,
  relativePath: SharedReplicaRelativePath,
  expectedHeadRevisionId: Schema.NullOr(CollaborationFileRevisionId),
  observedHeadRevisionId: Schema.NullOr(CollaborationFileRevisionId),
  proposedRevisionId: CollaborationFileRevisionId,
  proposedRevisionKind: Schema.Literals(["version", "tombstone"]),
  createdAt: Schema.DateTimeUtcFromString,
});
export type CollaborationFileConflict = typeof CollaborationFileConflict.Type;

export const CollaborationFileHead = Schema.Union([
  Schema.Struct({
    revisionId: CollaborationFileRevisionId,
    kind: Schema.Literal("version"),
    versionId: CollaborationFileVersionId,
  }),
  Schema.Struct({
    revisionId: CollaborationFileRevisionId,
    kind: Schema.Literal("tombstone"),
    tombstoneId: CollaborationFileTombstoneId,
  }),
]);
export type CollaborationFileHead = typeof CollaborationFileHead.Type;

export const CollaborationFilePublishResult = Schema.Struct({
  disposition: Schema.Literals(["head-advanced", "fork-preserved", "already-applied"]),
  version: CollaborationFileVersion,
  head: Schema.NullOr(CollaborationFileHead),
  conflict: Schema.NullOr(CollaborationFileConflict),
});
export type CollaborationFilePublishResult = typeof CollaborationFilePublishResult.Type;

export const CollaborationFileTombstoneResult = Schema.Struct({
  disposition: Schema.Literals(["head-advanced", "tombstone-preserved", "already-applied"]),
  tombstone: CollaborationFileTombstone,
  head: Schema.NullOr(CollaborationFileHead),
  conflict: Schema.NullOr(CollaborationFileConflict),
});
export type CollaborationFileTombstoneResult = typeof CollaborationFileTombstoneResult.Type;

export const CollaborationFileState = Schema.Struct({
  sharedProjectId: SharedProjectId,
  relativePath: SharedReplicaRelativePath,
  head: Schema.NullOr(CollaborationFileHead),
  headVersion: Schema.NullOr(CollaborationFileVersion),
  forks: Schema.Array(CollaborationFileVersion),
  tombstones: Schema.Array(CollaborationFileTombstone),
  conflicts: Schema.Array(CollaborationFileConflict),
}).check(
  Schema.makeFilter((state) => {
    if (state.head === null)
      return state.headVersion === null ? undefined : "head version without head";
    if (state.head.kind === "tombstone") {
      return state.headVersion === null
        ? undefined
        : "tombstone head must not expose a head version";
    }
    return state.headVersion?.versionId === state.head.versionId
      ? undefined
      : "version head must resolve to the matching immutable version";
  }),
);
export type CollaborationFileState = typeof CollaborationFileState.Type;

export const CollaborationBlobPutRequest = Schema.Struct({
  sharedProjectId: SharedProjectId,
  relativePath: SharedReplicaRelativePath,
  deviceKeyId: CollaborationDeviceKeyId,
  versionId: CollaborationFileVersionId,
  chunkIndex: NonNegativeInt.check(Schema.isLessThan(COLLABORATION_FILE_MAX_CHUNKS)),
  contentSha256: CollaborationSha256,
  byteSize: PositiveInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_BLOB_CHUNK_MAX_BYTES)),
});
export type CollaborationBlobPutRequest = typeof CollaborationBlobPutRequest.Type;

export const CollaborationBlobPutResult = Schema.Struct({
  disposition: Schema.Literals(["stored", "already-present"]),
  contentSha256: CollaborationSha256,
  byteSize: PositiveInt,
});
export type CollaborationBlobPutResult = typeof CollaborationBlobPutResult.Type;

export const CollaborationMaterializeVersionRequest = Schema.Struct({
  sharedProjectId: SharedProjectId,
  relativePath: SharedReplicaRelativePath,
  deviceKeyId: CollaborationDeviceKeyId,
  versionId: CollaborationFileVersionId,
});
export type CollaborationMaterializeVersionRequest =
  typeof CollaborationMaterializeVersionRequest.Type;

export const CollaborationMaterializeTombstoneRequest = Schema.Struct({
  sharedProjectId: SharedProjectId,
  relativePath: SharedReplicaRelativePath,
  deviceKeyId: CollaborationDeviceKeyId,
  tombstoneId: CollaborationFileTombstoneId,
});
export type CollaborationMaterializeTombstoneRequest =
  typeof CollaborationMaterializeTombstoneRequest.Type;

export const CollaborationMaterializeResult = Schema.Struct({
  disposition: Schema.Literals([
    "materialized",
    "already-materialized",
    "moved-to-recovery",
    "already-absent",
  ]),
  sharedProjectId: SharedProjectId,
  relativePath: SharedReplicaRelativePath,
  revisionId: CollaborationFileRevisionId,
});
export type CollaborationMaterializeResult = typeof CollaborationMaterializeResult.Type;
