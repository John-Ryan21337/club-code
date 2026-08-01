import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  COLLABORATION_DATABASE_FENCING_TOKEN_MAX,
  COLLABORATION_DATABASE_LEASE_MAX_LIFETIME_MILLIS,
  CollaborationDatabaseCoordinationPolicy,
  CollaborationDatabaseHeadUpdate,
  CollaborationDatabaseSnapshot,
  CollaborationDatabaseWriterLease,
  SharedReplicaRelativePath,
  isDatabaseSidecarPath,
} from "./fileSync.js";

const decodePath = Schema.decodeUnknownSync(SharedReplicaRelativePath);
const decodePolicy = Schema.decodeUnknownSync(CollaborationDatabaseCoordinationPolicy);
const decodeSnapshot = Schema.decodeUnknownSync(CollaborationDatabaseSnapshot);
const decodeLease = Schema.decodeUnknownSync(CollaborationDatabaseWriterLease);
const decodeHeadUpdate = Schema.decodeUnknownSync(CollaborationDatabaseHeadUpdate);

const snapshot = {
  sharedProjectId: "shared-project-1",
  databaseId: "database-1",
  relativePath: "data/project.sqlite",
  engine: "sqlite" as const,
  contentSha256: "a".repeat(64),
  baseContentSha256: "b".repeat(64),
  schemaSha256: "c".repeat(64),
  byteSize: 4_096,
  consistency: "online-backup" as const,
  sidecarsExcluded: true as const,
  createdByUserId: "user-1",
  createdByDeviceId: "device-1",
  createdAt: "2026-07-31T20:00:00.000Z",
};

describe("collaboration database file contracts", () => {
  it("accepts only normalized project-relative paths", () => {
    expect(decodePath("data/project.sqlite")).toBe("data/project.sqlite");
    expect(decodePath("data/😀.sqlite")).toBe("data/😀.sqlite");

    for (const path of [
      "/data/project.sqlite",
      "C:/data/project.sqlite",
      "data\\project.sqlite",
      "../project.sqlite",
      "data//project.sqlite",
      "data/./project.sqlite",
      "data/../project.sqlite",
      "data/project.sqlite\u0000",
      " data/project.sqlite",
      "data/project.sqlite ",
      "data/project.sqlite.",
      "data/CON.sqlite",
      "data/aux",
      "data/COM¹.log",
      `data/${"a".repeat(256)}.sqlite`,
      `data/${"é".repeat(128)}.sqlite`,
      "data/cafe\u0301.sqlite",
      "data/project\uD800.sqlite",
    ]) {
      expect(() => decodePath(path)).toThrow();
    }
  });

  it("makes unsafe live-file replication unrepresentable in every policy", () => {
    expect(decodePolicy({ kind: "external-service", fileReplication: "forbidden" })).toEqual({
      kind: "external-service",
      fileReplication: "forbidden",
    });
    expect(
      decodePolicy({
        kind: "private-forks",
        fileReplication: "immutable-snapshots-only",
        mergeStrategy: "application-changeset",
      }),
    ).toMatchObject({ kind: "private-forks" });
    expect(
      decodePolicy({
        kind: "serialized-head",
        fileReplication: "immutable-snapshots-only",
        leaseLifetimeMillis: 60_000,
      }),
    ).toMatchObject({ kind: "serialized-head" });

    expect(() =>
      decodePolicy({
        kind: "serialized-head",
        fileReplication: "live-file",
        leaseLifetimeMillis: 1,
      }),
    ).toThrow();
    expect(() =>
      decodePolicy({
        kind: "serialized-head",
        fileReplication: "immutable-snapshots-only",
        leaseLifetimeMillis: COLLABORATION_DATABASE_LEASE_MAX_LIFETIME_MILLIS + 1,
      }),
    ).toThrow();
  });

  it("requires immutable consistent snapshots with excluded sidecars", () => {
    expect(decodeSnapshot(snapshot)).toMatchObject(snapshot);
    expect(() => decodeSnapshot({ ...snapshot, sidecarsExcluded: false })).toThrow();
    expect(() => decodeSnapshot({ ...snapshot, consistency: "filesystem-copy" })).toThrow();
    expect(() => decodeSnapshot({ ...snapshot, contentSha256: "not-a-hash" })).toThrow();
    expect(() => decodeSnapshot({ ...snapshot, createdAt: "sometime tomorrow" })).toThrow();
    expect(() =>
      decodeSnapshot({ ...snapshot, relativePath: "data/project.sqlite-wal" }),
    ).toThrow();
    expect(() =>
      decodeSnapshot({ ...snapshot, relativePath: "data/project.duckdb.wal" }),
    ).toThrow();
    expect(() => decodeSnapshot({ ...snapshot, relativePath: "data/lock.mdb" })).toThrow();
    expect(() =>
      decodeSnapshot({ ...snapshot, engine: "unknown", consistency: "online-backup" }),
    ).toThrow();
    expect(
      decodeSnapshot({ ...snapshot, engine: "unknown", consistency: "offline-copy" }),
    ).toMatchObject({ engine: "unknown", consistency: "offline-copy" });
  });

  it("rejects unbounded writer leases", () => {
    const lease = {
      sharedProjectId: "shared-project-1",
      databaseId: "database-1",
      leaseId: "lease-1",
      holderUserId: "user-1",
      holderDeviceId: "device-1",
      membershipEpoch: 4,
      fencingToken: 7,
      grantedAt: "2026-07-31T20:00:00.000Z",
      expiresAt: "2026-07-31T20:15:00.000Z",
    };

    expect(decodeLease(lease)).toMatchObject({ fencingToken: 7 });
    expect(() => decodeLease({ ...lease, expiresAt: lease.grantedAt })).toThrow();
    expect(() => decodeLease({ ...lease, expiresAt: "2026-07-31T20:15:00.001Z" })).toThrow();
    expect(() =>
      decodeLease({
        ...lease,
        fencingToken: COLLABORATION_DATABASE_FENCING_TOKEN_MAX + 1,
      }),
    ).toThrow();
  });

  it("binds a head update to its project, database, base hash, epoch, lease, and fence", () => {
    const update = decodeHeadUpdate({
      sharedProjectId: "shared-project-1",
      databaseId: "database-1",
      snapshot,
      expectedHeadContentSha256: "b".repeat(64),
      authorUserId: "user-1",
      authorDeviceId: "device-1",
      leaseId: "lease-1",
      fencingToken: 7,
      membershipEpoch: 4,
    });

    expect(update.snapshot.contentSha256).toBe("a".repeat(64));
    expect(update.expectedHeadContentSha256).toBe("b".repeat(64));
    expect(() =>
      decodeHeadUpdate({
        ...update,
        databaseId: "database-2",
      }),
    ).toThrow();
    expect(() =>
      decodeHeadUpdate({
        ...update,
        sharedProjectId: "shared-project-2",
      }),
    ).toThrow();
    expect(() =>
      decodeHeadUpdate({
        ...update,
        authorUserId: "user-2",
      }),
    ).toThrow();
    expect(() =>
      decodeHeadUpdate({
        ...update,
        authorDeviceId: "device-2",
      }),
    ).toThrow();
    expect(() =>
      decodeHeadUpdate({
        ...update,
        expectedHeadContentSha256: "d".repeat(64),
      }),
    ).toThrow();
  });

  it("identifies known live database sidecars case-insensitively", () => {
    expect(isDatabaseSidecarPath("data/project.sqlite-wal")).toBe(true);
    expect(isDatabaseSidecarPath("data/PROJECT.SQLITE-SHM")).toBe(true);
    expect(isDatabaseSidecarPath("data/project.sqlite-journal")).toBe(true);
    expect(isDatabaseSidecarPath("data/project.sqlite-mj 0123ABCD")).toBe(true);
    expect(isDatabaseSidecarPath("data/project.duckdb.wal")).toBe(true);
    expect(isDatabaseSidecarPath("data/LOCK.MDB")).toBe(true);
    expect(isDatabaseSidecarPath("data/project.sqlite")).toBe(false);
  });
});
