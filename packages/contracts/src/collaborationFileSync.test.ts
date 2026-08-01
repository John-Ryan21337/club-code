import { assert, describe, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  COLLABORATION_BLOB_CHUNK_MAX_BYTES,
  CollaborationBlobPutRequest,
  CollaborationFileContentManifest,
  CollaborationFilePublishCommand,
  CollaborationFileTombstoneCommand,
  CollaborationMaterializeTombstoneRequest,
  CollaborationMaterializeVersionRequest,
} from "./collaborationFileSync.ts";

const decodeManifest = Schema.decodeUnknownSync(CollaborationFileContentManifest);
const decodePublish = Schema.decodeUnknownSync(CollaborationFilePublishCommand);
const decodeTombstone = Schema.decodeUnknownSync(CollaborationFileTombstoneCommand);
const decodeBlobPut = Schema.decodeUnknownSync(CollaborationBlobPutRequest);
const decodeMaterializeVersion = Schema.decodeUnknownSync(CollaborationMaterializeVersionRequest);
const decodeMaterializeTombstone = Schema.decodeUnknownSync(
  CollaborationMaterializeTombstoneRequest,
);
const hash = "a".repeat(64);

describe("collaboration file synchronization contracts", () => {
  it("accepts a canonical contiguous immutable chunk manifest", () => {
    const decoded = decodeManifest({
      contentSha256: hash,
      byteSize: 6,
      chunks: [
        { index: 0, offset: 0, byteSize: 3, contentSha256: "b".repeat(64) },
        { index: 1, offset: 3, byteSize: 3, contentSha256: "c".repeat(64) },
      ],
    });
    assert.equal(decoded.byteSize, 6);
  });

  it("rejects gaps, overlaps, index ambiguity, and byte-count lies", () => {
    for (const chunks of [
      [{ index: 1, offset: 0, byteSize: 3, contentSha256: hash }],
      [{ index: 0, offset: 1, byteSize: 3, contentSha256: hash }],
      [
        { index: 0, offset: 0, byteSize: 2, contentSha256: hash },
        { index: 1, offset: 1, byteSize: 2, contentSha256: hash },
      ],
    ]) {
      assert.throws(() => decodeManifest({ contentSha256: hash, byteSize: 3, chunks }));
    }
  });

  it("rejects absolute, traversal, UNC, ADS, device, non-NFC and side-shaped paths", () => {
    const invalidPaths = [
      "/etc/passwd",
      "../secret",
      "safe/../../secret",
      String.raw`C:\Windows\System32`,
      String.raw`\\server\share\file`,
      "safe/file.txt:stream",
      "CON",
      "safe/NUL.txt",
      "safe/PRN.log",
      "safe//file.txt",
      "safe/./file.txt",
      "safe/file.txt ",
      "safe/e\u0301.txt",
    ];
    for (const relativePath of invalidPaths) {
      assert.throws(() =>
        decodePublish({
          commandId: "publish-1",
          sharedProjectId: "project-1",
          relativePath,
          deviceKeyId: "key-1",
          expectedHeadRevisionId: null,
          manifest: { contentSha256: hash, byteSize: 0, chunks: [] },
          contentKind: { kind: "regular-file" },
        }),
      );
    }
  });

  it("requires every tombstone to identify a previously admitted revision", () => {
    assert.throws(() =>
      decodeTombstone({
        commandId: "tombstone-1",
        sharedProjectId: "project-1",
        relativePath: "safe/file.txt",
        deviceKeyId: "key-1",
        expectedHeadRevisionId: null,
      }),
    );
  });

  it("bounds blob admission and requires an exact authorized version chunk identity", () => {
    const request = {
      sharedProjectId: "project-1",
      relativePath: "safe/file.txt",
      deviceKeyId: "key-1",
      versionId: hash,
      chunkIndex: 0,
      contentSha256: "b".repeat(64),
      byteSize: 3,
    };
    assert.equal(decodeBlobPut(request).byteSize, 3);
    assert.throws(() =>
      decodeBlobPut({ ...request, byteSize: COLLABORATION_BLOB_CHUNK_MAX_BYTES + 1 }),
    );
    assert.throws(() => decodeBlobPut({ ...request, chunkIndex: -1 }));
    assert.throws(() => decodeBlobPut({ ...request, contentSha256: "client-label" }));
  });

  it("separates immutable version materialization from recoverable tombstones", () => {
    assert.equal(
      decodeMaterializeVersion({
        sharedProjectId: "project-1",
        relativePath: "safe/file.txt",
        deviceKeyId: "key-1",
        versionId: hash,
      }).versionId,
      hash,
    );
    assert.equal(
      decodeMaterializeTombstone({
        sharedProjectId: "project-1",
        relativePath: "safe/file.txt",
        deviceKeyId: "key-1",
        tombstoneId: "b".repeat(64),
      }).tombstoneId,
      "b".repeat(64),
    );
  });
});
