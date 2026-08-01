import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  CollaborationSqliteSnapshotArtifact,
  CollaborationSqliteSnapshotCaptureResult,
  CollaborationSqliteSnapshotRestoreRequest,
} from "./collaborationSqliteSnapshot.js";

const decodeArtifact = Schema.decodeUnknownSync(CollaborationSqliteSnapshotArtifact);
const decodeCaptureResult = Schema.decodeUnknownSync(CollaborationSqliteSnapshotCaptureResult);
const decodeRestore = Schema.decodeUnknownSync(CollaborationSqliteSnapshotRestoreRequest);

const artifact = {
  snapshot: {
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
    createdAt: "2026-08-01T12:00:00.000Z",
  },
  artifactStorage: "managed-content-addressed" as const,
  sqliteFormat: "sqlite-format-3" as const,
  applicationId: 0,
  userVersion: 1,
  pageSize: 4_096,
  pageCount: 1,
  sourceJournalMode: "wal" as const,
  integrityCheck: "ok" as const,
  attachedDatabaseCount: 0 as const,
  sidecarsCopied: false as const,
};

describe("collaboration SQLite managed snapshot contracts", () => {
  it("accepts only self-consistent standalone online-backup artifacts", () => {
    expect(decodeArtifact(artifact).snapshot.contentSha256).toBe("a".repeat(64));
    expect(() => decodeArtifact({ ...artifact, pageCount: 2 })).toThrow();
    expect(() =>
      decodeArtifact({
        ...artifact,
        snapshot: { ...artifact.snapshot, consistency: "offline-copy" },
      }),
    ).toThrow();
  });

  it("distinguishes a head candidate from an authority-change fork", () => {
    expect(
      decodeCaptureResult({
        artifact,
        disposition: "head-candidate",
        observedAuthorityHeadContentSha256: "b".repeat(64),
      }).disposition,
    ).toBe("head-candidate");
    expect(() =>
      decodeCaptureResult({
        artifact,
        disposition: "head-candidate",
        observedAuthorityHeadContentSha256: "d".repeat(64),
      }),
    ).toThrow();
  });

  it("binds restore artifacts to the requested project and database fence", () => {
    const request = {
      operationId: "restore-1",
      sharedProjectId: "shared-project-1",
      databaseId: "database-1",
      deviceKeyId: "key-1",
      leaseId: "lease-1",
      fencingToken: 1,
      membershipEpoch: 1,
      expectedAuthorityHeadContentSha256: "a".repeat(64),
      artifact,
      expectedReplicaContentSha256: null,
      sourceDisposition: "canonical-head" as const,
    };
    expect(decodeRestore(request).databaseId).toBe("database-1");
    expect(() => decodeRestore({ ...request, databaseId: "database-2" })).toThrow();
  });
});
