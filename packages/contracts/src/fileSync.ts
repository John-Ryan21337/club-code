import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import { IsoDateTime, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
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

export const SharedReplicaRelativePath = TrimmedNonEmptyString.check(
  Schema.isMaxLength(COLLABORATION_REPLICA_PATH_MAX_CHARS),
  Schema.makeFilter((path) => {
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.includes(":") ||
      /[\u0000-\u001f\u007f]/u.test(path)
    ) {
      return "must be a normalized project-relative path";
    }

    const segments = path.split("/");
    return segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    )
      ? "must not contain empty, current-directory, or parent-directory segments"
      : undefined;
  }),
).pipe(Schema.brand("SharedReplicaRelativePath"));
export type SharedReplicaRelativePath = typeof SharedReplicaRelativePath.Type;

export const CollaborationDatabaseId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
).pipe(Schema.brand("CollaborationDatabaseId"));
export type CollaborationDatabaseId = typeof CollaborationDatabaseId.Type;

export const CollaborationDatabaseLeaseId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(128),
).pipe(Schema.brand("CollaborationDatabaseLeaseId"));
export type CollaborationDatabaseLeaseId = typeof CollaborationDatabaseLeaseId.Type;

export const CollaborationDatabaseEngine = Schema.Literals([
  "sqlite",
  "duckdb",
  "lmdb",
  "unknown",
]);
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
  byteSize: PositiveInt.check(
    Schema.isLessThanOrEqualTo(COLLABORATION_DATABASE_FILE_MAX_BYTES),
  ),
  consistency: Schema.Literals([
    "online-backup",
    "checkpointed-copy",
    "offline-copy",
    "logical-export",
  ]),
  sidecarsExcluded: Schema.Literal(true),
  createdByUserId: UserId,
  createdByDeviceId: DeviceId,
  createdAt: IsoDateTime,
}).check(
  Schema.makeFilter((snapshot) =>
    isDatabaseSidecarPath(snapshot.relativePath)
      ? "database snapshots must not publish live sidecar files"
      : undefined,
  ),
);
export type CollaborationDatabaseSnapshot = typeof CollaborationDatabaseSnapshot.Type;

export const CollaborationDatabaseWriterLease = Schema.Struct({
  sharedProjectId: SharedProjectId,
  databaseId: CollaborationDatabaseId,
  leaseId: CollaborationDatabaseLeaseId,
  holderUserId: UserId,
  holderDeviceId: DeviceId,
  membershipEpoch: CollaborationMembershipEpoch,
  fencingToken: PositiveInt,
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
    return lifetimeMillis > 0 &&
      lifetimeMillis <= COLLABORATION_DATABASE_LEASE_MAX_LIFETIME_MILLIS
      ? undefined
      : `database writer lease lifetime must be greater than zero and at most ${COLLABORATION_DATABASE_LEASE_MAX_LIFETIME_MILLIS} milliseconds`;
  }),
);
export type CollaborationDatabaseWriterLease =
  typeof CollaborationDatabaseWriterLease.Type;

/**
 * Compare-and-swap command for advancing a canonical database head. The
 * coordinator must atomically verify the expected head, membership epoch,
 * lease identity, fencing token, and lease expiry before accepting it.
 */
export const CollaborationDatabaseHeadUpdate = Schema.Struct({
  sharedProjectId: SharedProjectId,
  databaseId: CollaborationDatabaseId,
  snapshot: CollaborationDatabaseSnapshot,
  expectedHeadContentSha256: Schema.NullOr(CollaborationSha256),
  leaseId: CollaborationDatabaseLeaseId,
  fencingToken: PositiveInt,
  membershipEpoch: CollaborationMembershipEpoch,
}).check(
  Schema.makeFilter((update) =>
    update.snapshot.sharedProjectId !== update.sharedProjectId ||
    update.snapshot.databaseId !== update.databaseId
      ? "database head update and snapshot identities must match"
      : undefined,
  ),
);
export type CollaborationDatabaseHeadUpdate = typeof CollaborationDatabaseHeadUpdate.Type;

const SQLITE_SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"] as const;

export function isDatabaseSidecarPath(path: string): boolean {
  const normalized = path.toLocaleLowerCase("en-US");
  return SQLITE_SIDECAR_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}
