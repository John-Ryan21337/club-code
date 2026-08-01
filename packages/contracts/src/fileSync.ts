import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt } from "./baseSchemas.ts";
import {
  CollaborationMembershipEpoch,
  CollaborationSha256,
  DeviceId,
  SharedProjectId,
  UserId,
} from "./collaboration.ts";

export const COLLABORATION_DATABASE_LEASE_MAX_LIFETIME_MILLIS = 15 * 60 * 1_000;
export const COLLABORATION_DATABASE_FILE_MAX_BYTES = 1024 * 1024 * 1024 * 1024;
export const COLLABORATION_REPLICA_PATH_MAX_CHARS = 4_096;
export const COLLABORATION_REPLICA_PATH_MAX_UTF8_BYTES = 4_096;
export const COLLABORATION_REPLICA_PATH_SEGMENT_MAX_CHARS = 255;
export const COLLABORATION_REPLICA_PATH_SEGMENT_MAX_UTF8_BYTES = 255;
export const COLLABORATION_DATABASE_FENCING_TOKEN_MAX = Number.MAX_SAFE_INTEGER;

const CollaborationDatabaseIdentifier = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
);

const CollaborationDatabaseTimestamp = Schema.String.check(
  Schema.isMinLength(24),
  Schema.isMaxLength(24),
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  Schema.makeFilter((value) => {
    const epochMillis = Date.parse(value);
    return Number.isFinite(epochMillis) && new Date(epochMillis).toISOString() === value
      ? undefined
      : "database timestamp must be a canonical, valid UTC instant";
  }),
);

const WINDOWS_RESERVED_FILE_STEM =
  /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/iu;

function hasForbiddenReplicaPathCodeUnit(path: string): boolean {
  for (let index = 0; index < path.length; index += 1) {
    const codeUnit = path.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = path.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function invalidReplicaPath(path: string): string | undefined {
  if (
    path.length === 0 ||
    path.trim() !== path ||
    path.normalize("NFC") !== path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    hasForbiddenReplicaPathCodeUnit(path)
  ) {
    return "must be a canonical normalized project-relative path";
  }
  if (new TextEncoder().encode(path).byteLength > COLLABORATION_REPLICA_PATH_MAX_UTF8_BYTES) {
    return `must be at most ${COLLABORATION_REPLICA_PATH_MAX_UTF8_BYTES} UTF-8 bytes`;
  }

  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      return "must not contain empty, current-directory, or parent-directory segments";
    }
    if (
      segment.length > COLLABORATION_REPLICA_PATH_SEGMENT_MAX_CHARS ||
      new TextEncoder().encode(segment).byteLength >
        COLLABORATION_REPLICA_PATH_SEGMENT_MAX_UTF8_BYTES
    ) {
      return "contains a path segment that exceeds portable filesystem limits";
    }
    if (segment.endsWith(".") || segment.endsWith(" ")) {
      return "must not contain path segments ending in a dot or space";
    }
    const stem = segment.split(".", 1)[0]!;
    if (WINDOWS_RESERVED_FILE_STEM.test(stem)) {
      return "must not contain a Windows reserved device name";
    }
  }
  return undefined;
}

export const SharedReplicaRelativePath = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(COLLABORATION_REPLICA_PATH_MAX_CHARS),
  Schema.makeFilter(invalidReplicaPath),
).pipe(Schema.brand("SharedReplicaRelativePath"));
export type SharedReplicaRelativePath = typeof SharedReplicaRelativePath.Type;

export const CollaborationDatabaseId = CollaborationDatabaseIdentifier.pipe(
  Schema.brand("CollaborationDatabaseId"),
);
export type CollaborationDatabaseId = typeof CollaborationDatabaseId.Type;

export const CollaborationDatabaseLeaseId = CollaborationDatabaseIdentifier.pipe(
  Schema.brand("CollaborationDatabaseLeaseId"),
);
export type CollaborationDatabaseLeaseId = typeof CollaborationDatabaseLeaseId.Type;

export const CollaborationDatabaseCommandId = CollaborationDatabaseIdentifier.pipe(
  Schema.brand("CollaborationDatabaseCommandId"),
);
export type CollaborationDatabaseCommandId = typeof CollaborationDatabaseCommandId.Type;

export const CollaborationDatabaseFencingToken = PositiveInt.check(
  Schema.isLessThanOrEqualTo(COLLABORATION_DATABASE_FENCING_TOKEN_MAX),
);
export type CollaborationDatabaseFencingToken = typeof CollaborationDatabaseFencingToken.Type;

export const CollaborationDatabaseEngine = Schema.Literals(["sqlite", "duckdb", "lmdb", "unknown"]);
export type CollaborationDatabaseEngine = typeof CollaborationDatabaseEngine.Type;

/**
 * Generic database containers are never merged as ordinary binary files.
 *
 * - external-service: one database service owns concurrency; no database file
 *   is replicated.
 * - private-forks: every operator writes a private copy and publishes an
 *   application-aware change bundle or an immutable snapshot for review.
 * - serialized-head: a short server-authoritative lease selects one writer for
 *   the canonical head while other operators continue on private forks.
 */
export const CollaborationDatabaseCoordinationPolicy = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("external-service"),
    fileReplication: Schema.Literal("forbidden"),
  }),
  Schema.Struct({
    kind: Schema.Literal("private-forks"),
    fileReplication: Schema.Literal("immutable-snapshots-only"),
    mergeStrategy: Schema.Literals(["application-changeset", "manual-export-import"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("serialized-head"),
    fileReplication: Schema.Literal("immutable-snapshots-only"),
    leaseLifetimeMillis: PositiveInt.check(
      Schema.isLessThanOrEqualTo(COLLABORATION_DATABASE_LEASE_MAX_LIFETIME_MILLIS),
    ),
  }),
]);
export type CollaborationDatabaseCoordinationPolicy =
  typeof CollaborationDatabaseCoordinationPolicy.Type;

export const CollaborationDatabaseSnapshot = Schema.Struct({
  sharedProjectId: SharedProjectId,
  databaseId: CollaborationDatabaseId,
  relativePath: SharedReplicaRelativePath,
  engine: CollaborationDatabaseEngine,
  contentSha256: CollaborationSha256,
  baseContentSha256: Schema.NullOr(CollaborationSha256),
  schemaSha256: Schema.NullOr(CollaborationSha256),
  byteSize: PositiveInt.check(Schema.isLessThanOrEqualTo(COLLABORATION_DATABASE_FILE_MAX_BYTES)),
  consistency: Schema.Literals([
    "online-backup",
    "quiesced-checkpoint-copy",
    "offline-copy",
    "logical-export",
  ]),
  sidecarsExcluded: Schema.Literal(true),
  createdByUserId: UserId,
  createdByDeviceId: DeviceId,
  createdAt: CollaborationDatabaseTimestamp,
}).check(
  Schema.makeFilter((snapshot) => {
    if (isDatabaseSidecarPath(snapshot.relativePath)) {
      return "database snapshots must not publish live sidecar files";
    }
    return snapshot.engine === "unknown" &&
      snapshot.consistency !== "offline-copy" &&
      snapshot.consistency !== "logical-export"
      ? "unknown database engines require an offline copy or logical export"
      : undefined;
  }),
);
export type CollaborationDatabaseSnapshot = typeof CollaborationDatabaseSnapshot.Type;

export const CollaborationDatabaseWriterLease = Schema.Struct({
  sharedProjectId: SharedProjectId,
  databaseId: CollaborationDatabaseId,
  leaseId: CollaborationDatabaseLeaseId,
  holderUserId: UserId,
  holderDeviceId: DeviceId,
  membershipEpoch: CollaborationMembershipEpoch,
  fencingToken: CollaborationDatabaseFencingToken,
  grantedAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
}).check(
  Schema.makeFilter((lease) => {
    const grantedAtEpochMillis =
      typeof lease.grantedAt === "string"
        ? Date.parse(lease.grantedAt)
        : DateTime.toEpochMillis(lease.grantedAt);
    const expiresAtEpochMillis =
      typeof lease.expiresAt === "string"
        ? Date.parse(lease.expiresAt)
        : DateTime.toEpochMillis(lease.expiresAt);
    const lifetimeMillis = expiresAtEpochMillis - grantedAtEpochMillis;
    return lifetimeMillis > 0 && lifetimeMillis <= COLLABORATION_DATABASE_LEASE_MAX_LIFETIME_MILLIS
      ? undefined
      : `database writer lease lifetime must be greater than zero and at most ${COLLABORATION_DATABASE_LEASE_MAX_LIFETIME_MILLIS} milliseconds`;
  }),
);
export type CollaborationDatabaseWriterLease = typeof CollaborationDatabaseWriterLease.Type;

/**
 * Compare-and-swap command for advancing a canonical database head. The
 * coordinator must atomically verify the expected head, membership epoch,
 * lease identity, holder identities, fencing token, and lease expiry before
 * accepting it. The author identities must also match the authenticated
 * principal; neither identity nor lease authority is trusted from this
 * client-supplied command alone.
 */
export const CollaborationDatabaseHeadUpdate = Schema.Struct({
  sharedProjectId: SharedProjectId,
  databaseId: CollaborationDatabaseId,
  snapshot: CollaborationDatabaseSnapshot,
  expectedHeadContentSha256: Schema.NullOr(CollaborationSha256),
  authorUserId: UserId,
  authorDeviceId: DeviceId,
  leaseId: CollaborationDatabaseLeaseId,
  fencingToken: CollaborationDatabaseFencingToken,
  membershipEpoch: CollaborationMembershipEpoch,
}).check(
  Schema.makeFilter((update) => {
    if (
      update.snapshot.sharedProjectId !== update.sharedProjectId ||
      update.snapshot.databaseId !== update.databaseId
    ) {
      return "database head update and snapshot identities must match";
    }
    if (
      update.snapshot.createdByUserId !== update.authorUserId ||
      update.snapshot.createdByDeviceId !== update.authorDeviceId
    ) {
      return "database head update author and snapshot creator identities must match";
    }
    return update.snapshot.baseContentSha256 === update.expectedHeadContentSha256
      ? undefined
      : "database head update expected hash must match the snapshot base hash";
  }),
);
export type CollaborationDatabaseHeadUpdate = typeof CollaborationDatabaseHeadUpdate.Type;

export const CollaborationDatabaseConfigureCommand = Schema.Struct({
  commandId: CollaborationDatabaseCommandId,
  sharedProjectId: SharedProjectId,
  databaseId: CollaborationDatabaseId,
  relativePath: SharedReplicaRelativePath,
  engine: CollaborationDatabaseEngine,
  policy: CollaborationDatabaseCoordinationPolicy,
}).check(
  Schema.makeFilter((command) =>
    isDatabaseSidecarPath(command.relativePath)
      ? "database bindings must not target live database sidecar files"
      : undefined,
  ),
);
export type CollaborationDatabaseConfigureCommand =
  typeof CollaborationDatabaseConfigureCommand.Type;

export const CollaborationDatabaseAcquireLeaseCommand = Schema.Struct({
  commandId: CollaborationDatabaseCommandId,
  sharedProjectId: SharedProjectId,
  databaseId: CollaborationDatabaseId,
});
export type CollaborationDatabaseAcquireLeaseCommand =
  typeof CollaborationDatabaseAcquireLeaseCommand.Type;

export const CollaborationDatabaseLeaseCommand = Schema.Struct({
  commandId: CollaborationDatabaseCommandId,
  sharedProjectId: SharedProjectId,
  databaseId: CollaborationDatabaseId,
  leaseId: CollaborationDatabaseLeaseId,
  fencingToken: CollaborationDatabaseFencingToken,
});
export type CollaborationDatabaseLeaseCommand = typeof CollaborationDatabaseLeaseCommand.Type;

export const CollaborationDatabasePublishHeadCommand = Schema.Struct({
  commandId: CollaborationDatabaseCommandId,
  update: CollaborationDatabaseHeadUpdate,
});
export type CollaborationDatabasePublishHeadCommand =
  typeof CollaborationDatabasePublishHeadCommand.Type;

export const CollaborationDatabaseBinding = Schema.Struct({
  sharedProjectId: SharedProjectId,
  databaseId: CollaborationDatabaseId,
  relativePath: SharedReplicaRelativePath,
  engine: CollaborationDatabaseEngine,
  policy: CollaborationDatabaseCoordinationPolicy,
  headSnapshot: Schema.NullOr(CollaborationDatabaseSnapshot),
  lastFencingToken: NonNegativeInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_DATABASE_FENCING_TOKEN_MAX),
  ),
  activeLease: Schema.NullOr(CollaborationDatabaseWriterLease),
}).check(
  Schema.makeFilter((binding) => {
    if (
      binding.headSnapshot !== null &&
      (binding.headSnapshot.sharedProjectId !== binding.sharedProjectId ||
        binding.headSnapshot.databaseId !== binding.databaseId ||
        binding.headSnapshot.relativePath !== binding.relativePath ||
        binding.headSnapshot.engine !== binding.engine)
    ) {
      return "database binding and head snapshot identities must match";
    }
    return binding.activeLease !== null &&
      (binding.activeLease.sharedProjectId !== binding.sharedProjectId ||
        binding.activeLease.databaseId !== binding.databaseId ||
        binding.activeLease.fencingToken !== binding.lastFencingToken)
      ? "database binding and active lease identities and fence must match"
      : undefined;
  }),
);
export type CollaborationDatabaseBinding = typeof CollaborationDatabaseBinding.Type;

export const CollaborationDatabaseReleaseResult = Schema.Struct({
  sharedProjectId: SharedProjectId,
  databaseId: CollaborationDatabaseId,
  leaseId: CollaborationDatabaseLeaseId,
  fencingToken: CollaborationDatabaseFencingToken,
  released: Schema.Literal(true),
});
export type CollaborationDatabaseReleaseResult = typeof CollaborationDatabaseReleaseResult.Type;

const DATABASE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal", ".wal"] as const;

export function isDatabaseSidecarPath(path: string): boolean {
  const normalized = path.toLowerCase();
  const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
  return (
    DATABASE_SIDECAR_SUFFIXES.some((suffix) => normalized.endsWith(suffix)) ||
    /^.+-mj [a-f0-9]+$/u.test(fileName) ||
    fileName === "lock.mdb"
  );
}
