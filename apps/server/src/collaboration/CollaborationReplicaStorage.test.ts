import type { CollaborationFileState as FileState } from "@cafecode/contracts";
import { CollaborationFileState, SharedProjectId } from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { CollaborationFileSyncStoreShape } from "./CollaborationFileSyncStore.ts";
import {
  CollaborationReplicaStorageError,
  makeCollaborationReplicaStorage,
} from "./CollaborationReplicaStorage.ts";
import { makeCollaborationSandboxPathAuthority } from "./CollaborationSandboxPathAuthority.ts";

const decodeProjectId = Schema.decodeUnknownSync(SharedProjectId);
const decodeState = Schema.decodeUnknownSync(CollaborationFileState);
const projectId = decodeProjectId("managed-replica-project");
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

function versionState(
  chunks: ReadonlyArray<string>,
  options: {
    readonly relativePath?: string;
    readonly contentKind?:
      | { readonly kind: "regular-file" }
      | {
          readonly kind: "database";
          readonly databaseId: string;
          readonly engine: "sqlite";
          readonly coordination: "serialized-head";
          readonly leaseId: string;
          readonly fencingToken: number;
        };
  } = {},
) {
  const value = chunks.join("");
  const relativePath = options.relativePath ?? "src/shared.txt";
  const versionId = sha256(`version\0${relativePath}\0${value}`);
  let offset = 0;
  const manifestChunks = chunks.map((chunk, index) => {
    const byteSize = Buffer.byteLength(chunk);
    const result = { index, offset, byteSize, contentSha256: sha256(chunk) };
    offset += byteSize;
    return result;
  });
  const state = decodeState({
    sharedProjectId: projectId,
    relativePath,
    head: { revisionId: versionId, kind: "version", versionId },
    headVersion: {
      versionId,
      sharedProjectId: projectId,
      relativePath,
      manifest: {
        contentSha256: sha256(value),
        byteSize: Buffer.byteLength(value),
        chunks: manifestChunks,
      },
      contentKind: options.contentKind ?? { kind: "regular-file" },
      createdByUserId: "user-1",
      createdByDeviceId: "device-1",
      createdAt: "2026-08-01T12:00:00.000Z",
    },
    forks: [],
    tombstones: [],
    conflicts: [],
  });
  return { state, versionId, relativePath, manifestChunks, value };
}

function tombstoneState(relativePath = "src/deleted.txt") {
  const previousHeadRevisionId = sha256(`previous\0${relativePath}`);
  const tombstoneId = sha256(`tombstone\0${relativePath}`);
  return {
    tombstoneId,
    relativePath,
    state: decodeState({
      sharedProjectId: projectId,
      relativePath,
      head: { revisionId: tombstoneId, kind: "tombstone", tombstoneId },
      headVersion: null,
      forks: [],
      tombstones: [
        {
          tombstoneId,
          sharedProjectId: projectId,
          relativePath,
          previousHeadRevisionId,
          createdByUserId: "user-1",
          createdByDeviceId: "device-1",
          createdAt: "2026-08-01T12:00:00.000Z",
        },
      ],
      conflicts: [],
    }),
  };
}

function fileAuthority(readState: () => FileState): CollaborationFileSyncStoreShape {
  return {
    publish: () => Effect.die("unused publish"),
    tombstone: () => Effect.die("unused tombstone"),
    read: () => Effect.sync(readState),
  };
}

async function harness(
  readState: () => FileState,
  limits: {
    readonly projectBlobQuotaBytes?: number;
    readonly streamFrameMaxBytes?: number;
    readonly beforeStorage?: (roots: {
      readonly replicaRoot: string;
      readonly blobRoot: string;
    }) => Promise<void>;
  } = {},
) {
  const outer = await mkdtemp(join(tmpdir(), "club-code-managed-replica-"));
  const replicaRoot = join(outer, "replica");
  const blobRoot = join(outer, "blobs");
  await mkdir(replicaRoot);
  await mkdir(blobRoot);
  await limits.beforeStorage?.({ replicaRoot, blobRoot });
  const { beforeStorage: _, ...storageLimits } = limits;
  const sandboxPathAuthority = await Effect.runPromise(
    makeCollaborationSandboxPathAuthority(replicaRoot),
  );
  const storage = await Effect.runPromise(
    makeCollaborationReplicaStorage({
      replicaRoot,
      blobRoot,
      fileAuthority: fileAuthority(readState),
      membershipAuthority: { getCurrent: () => Effect.die("provided to file authority") },
      deviceKeyAuthority: {
        getActiveEd25519PublicKey: () => Effect.die("provided to file authority"),
      },
      sandboxPathAuthority,
      ...storageLimits,
    }),
  );
  return {
    outer,
    replicaRoot,
    blobRoot,
    storage,
    cleanup: () => rm(outer, { recursive: true, force: true }),
  };
}

async function* bytes(...frames: ReadonlyArray<string>): AsyncIterable<Uint8Array> {
  for (const frame of frames) yield Buffer.from(frame);
}

function putRequest(version: ReturnType<typeof versionState>, chunkIndex = 0) {
  const chunk = version.manifestChunks[chunkIndex]!;
  return {
    sharedProjectId: projectId,
    relativePath: version.relativePath,
    deviceKeyId: "key-1",
    versionId: version.versionId,
    chunkIndex,
    contentSha256: chunk.contentSha256,
    byteSize: chunk.byteSize,
  };
}

async function expectReason<A>(
  effect: Effect.Effect<A, CollaborationReplicaStorageError>,
  reason: CollaborationReplicaStorageError["reason"],
) {
  const error = await Effect.runPromise(effect.pipe(Effect.flip));
  assert.instanceOf(error, CollaborationReplicaStorageError);
  assert.equal(error.reason, reason);
}

async function assertNoUploadTemps(root: string) {
  const entries = await readdir(root, { recursive: true });
  assert.isFalse(entries.some((entry) => /^upload-[a-f0-9]{32}\.tmp$/u.test(entry)));
}

describe("CollaborationReplicaStorage", () => {
  it("stores verified blobs idempotently and materializes the authorized version", async () => {
    const version = versionState(["shared ", "content"]);
    const test = await harness(() => version.state);
    try {
      for (const [index, chunk] of ["shared ", "content"].entries()) {
        const first = await Effect.runPromise(
          test.storage.putBlob({
            principal: {},
            request: putRequest(version, index),
            source: bytes(chunk),
          }),
        );
        assert.equal(first.disposition, "stored");
      }
      const duplicate = await Effect.runPromise(
        test.storage.putBlob({
          principal: {},
          request: putRequest(version),
          source: {
            [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
              return {
                next: () =>
                  Promise.reject(new Error("an existing blob must not consume the source")),
              };
            },
          },
        }),
      );
      assert.equal(duplicate.disposition, "already-present");
      const result = await Effect.runPromise(
        test.storage.materializeVersion({
          principal: {},
          request: {
            sharedProjectId: projectId,
            relativePath: version.relativePath,
            deviceKeyId: "key-1",
            versionId: version.versionId,
          },
        }),
      );
      assert.equal(result.disposition, "materialized");
      assert.equal(
        await readFile(join(test.replicaRoot, "src", "shared.txt"), "utf8"),
        version.value,
      );
      const again = await Effect.runPromise(
        test.storage.materializeVersion({
          principal: {},
          request: {
            sharedProjectId: projectId,
            relativePath: version.relativePath,
            deviceKeyId: "key-1",
            versionId: version.versionId,
          },
        }),
      );
      assert.equal(again.disposition, "already-materialized");
    } finally {
      await test.cleanup();
    }
  });

  it("rejects oversized frames and digest mismatches without retaining staging bytes", async () => {
    const version = versionState(["abcd"]);
    const test = await harness(() => version.state, { streamFrameMaxBytes: 2 });
    try {
      await expectReason(
        test.storage.putBlob({
          principal: {},
          request: putRequest(version),
          source: bytes("abcd"),
        }),
        "content-invalid",
      );
      await expectReason(
        test.storage.putBlob({
          principal: {},
          request: putRequest(version),
          source: bytes("ab", "ce"),
        }),
        "content-invalid",
      );
      await assertNoUploadTemps(test.blobRoot);
    } finally {
      await test.cleanup();
    }
  });

  it("enforces the per-project content-addressed byte quota", async () => {
    const version = versionState(["abc", "def"]);
    const test = await harness(() => version.state, { projectBlobQuotaBytes: 3 });
    try {
      await Effect.runPromise(
        test.storage.putBlob({
          principal: {},
          request: putRequest(version, 0),
          source: bytes("abc"),
        }),
      );
      await expectReason(
        test.storage.putBlob({
          principal: {},
          request: putRequest(version, 1),
          source: bytes("def"),
        }),
        "quota-exceeded",
      );
      await assertNoUploadTemps(test.blobRoot);
    } finally {
      await test.cleanup();
    }
  });

  it("rechecks the current head after streaming and cleans staged bytes when it changes", async () => {
    const version = versionState(["sensitive"]);
    const noHead = decodeState({ ...version.state, head: null, headVersion: null });
    let reads = 0;
    const test = await harness(() => (reads++ === 0 ? version.state : noHead));
    try {
      await expectReason(
        test.storage.putBlob({
          principal: {},
          request: putRequest(version),
          source: bytes("sensitive"),
        }),
        "not-found",
      );
      await assertNoUploadTemps(test.blobRoot);
    } finally {
      await test.cleanup();
    }
  });

  it("honors cancellation before pulling upload bytes and reserves its managed subtree", async () => {
    const version = versionState(["cancelled"]);
    const test = await harness(() => version.state);
    try {
      const controller = new AbortController();
      controller.abort();
      let pulls = 0;
      await expectReason(
        test.storage.putBlob({
          principal: {},
          request: putRequest(version),
          signal: controller.signal,
          source: (async function* () {
            pulls += 1;
            yield Buffer.from("cancelled");
          })(),
        }),
        "cancelled",
      );
      assert.equal(pulls, 0);

      const reserved = versionState(["remote"], {
        relativePath: ".club-code-managed/stolen.txt",
      });
      await expectReason(
        test.storage.materializeVersion({
          principal: {},
          request: {
            sharedProjectId: projectId,
            relativePath: reserved.relativePath,
            deviceKeyId: "key-1",
            versionId: reserved.versionId,
          },
        }),
        "invalid-request",
      );
    } finally {
      await test.cleanup();
    }
  });

  it("cleans only recognized crash-stage files when a project bucket is reopened", async () => {
    const version = versionState(["recovered"]);
    const projectKey = createHash("sha256")
      .update("club-code/cowork-project-blob-root/v1\0")
      .update(projectId)
      .digest("hex");
    const test = await harness(() => version.state, {
      beforeStorage: async ({ blobRoot }) => {
        const staging = join(blobRoot, projectKey, "staging");
        await mkdir(staging, { recursive: true });
        await writeFile(join(staging, `upload-${"a".repeat(32)}.tmp`), "partial");
      },
    });
    try {
      assert.deepEqual(await readdir(join(test.blobRoot, projectKey, "staging")), []);
    } finally {
      await test.cleanup();
    }
  });

  it("refuses database pages and volatile sidecars from this byte plane", async () => {
    const database = versionState(["sqlite-page"], {
      relativePath: "data/app.sqlite",
      contentKind: {
        kind: "database",
        databaseId: "database-1",
        engine: "sqlite",
        coordination: "serialized-head",
        leaseId: "lease-1",
        fencingToken: 1,
      },
    });
    const test = await harness(() => database.state);
    try {
      await expectReason(
        test.storage.putBlob({
          principal: {},
          request: putRequest(database),
          source: bytes("sqlite-page"),
        }),
        "database-content-forbidden",
      );
    } finally {
      await test.cleanup();
    }
  });

  it("rejects hardlinked targets and case aliases without replacing them", async () => {
    const version = versionState(["remote"], { relativePath: "data/shared.txt" });
    const test = await harness(() => version.state);
    const outside = join(test.outer, "outside.txt");
    try {
      await mkdir(join(test.replicaRoot, "data"));
      await writeFile(outside, "local");
      await link(outside, join(test.replicaRoot, "data", "shared.txt"));
      await expectReason(
        test.storage.materializeVersion({
          principal: {},
          request: {
            sharedProjectId: projectId,
            relativePath: version.relativePath,
            deviceKeyId: "key-1",
            versionId: version.versionId,
          },
        }),
        "unsafe-storage",
      );
      assert.equal(await readFile(outside, "utf8"), "local");
    } finally {
      await test.cleanup();
    }

    const aliasVersion = versionState(["remote"], { relativePath: "data/file.txt" });
    const aliasTest = await harness(() => aliasVersion.state);
    try {
      await mkdir(join(aliasTest.replicaRoot, "Data"));
      await expectReason(
        aliasTest.storage.materializeVersion({
          principal: {},
          request: {
            sharedProjectId: projectId,
            relativePath: aliasVersion.relativePath,
            deviceKeyId: "key-1",
            versionId: aliasVersion.versionId,
          },
        }),
        "unsafe-storage",
      );
    } finally {
      await aliasTest.cleanup();
    }
  });

  it("moves tombstoned files to recovery and makes retries harmless", async () => {
    const tombstone = tombstoneState();
    const test = await harness(() => tombstone.state);
    try {
      await mkdir(join(test.replicaRoot, "src"));
      await writeFile(join(test.replicaRoot, "src", "deleted.txt"), "recover me");
      const result = await Effect.runPromise(
        test.storage.materializeTombstone({
          principal: {},
          request: {
            sharedProjectId: projectId,
            relativePath: tombstone.relativePath,
            deviceKeyId: "key-1",
            tombstoneId: tombstone.tombstoneId,
          },
        }),
      );
      assert.equal(result.disposition, "moved-to-recovery");
      let sourceMissing = false;
      try {
        await readFile(join(test.replicaRoot, "src", "deleted.txt"));
      } catch (error) {
        sourceMissing =
          typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
      }
      assert.isTrue(sourceMissing);
      const recoveryFiles = await readdir(
        join(test.replicaRoot, ".club-code-managed", "recovery"),
        {
          recursive: true,
          withFileTypes: true,
        },
      );
      const recovered = recoveryFiles.find((entry) => entry.isFile());
      assert.isDefined(recovered);
      assert.equal(
        await readFile(join(recovered!.parentPath, recovered!.name), "utf8"),
        "recover me",
      );
      const retry = await Effect.runPromise(
        test.storage.materializeTombstone({
          principal: {},
          request: {
            sharedProjectId: projectId,
            relativePath: tombstone.relativePath,
            deviceKeyId: "key-1",
            tombstoneId: tombstone.tombstoneId,
          },
        }),
      );
      assert.equal(retry.disposition, "already-absent");
    } finally {
      await test.cleanup();
    }
  });

  it("rejects a replica root swapped after service construction", async () => {
    const version = versionState(["remote"]);
    const test = await harness(() => version.state);
    const moved = `${test.replicaRoot}-moved`;
    try {
      await rename(test.replicaRoot, moved);
      await mkdir(test.replicaRoot);
      await expectReason(
        test.storage.materializeVersion({
          principal: {},
          request: {
            sharedProjectId: projectId,
            relativePath: version.relativePath,
            deviceKeyId: "key-1",
            versionId: version.versionId,
          },
        }),
        "unsafe-storage",
      );
    } finally {
      await rm(moved, { recursive: true, force: true });
      await test.cleanup();
    }
  });
});
