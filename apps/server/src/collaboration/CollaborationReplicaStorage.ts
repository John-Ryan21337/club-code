import type {
  CollaborationBlobPutResult as BlobPutResult,
  CollaborationFileChunk,
  CollaborationFileState,
  CollaborationFileVersion,
  CollaborationMaterializeResult as MaterializeResult,
  SharedProjectId,
  SharedReplicaRelativePath,
} from "@cafecode/contracts";
import {
  COLLABORATION_BLOB_CHUNK_MAX_BYTES,
  COLLABORATION_BLOB_STREAM_FRAME_MAX_BYTES,
  COLLABORATION_MATERIALIZED_FILE_MAX_BYTES,
  COLLABORATION_PROJECT_BLOB_QUOTA_MAX_BYTES,
  CollaborationBlobPutRequest,
  CollaborationBlobPutResult,
  CollaborationMaterializeResult,
  CollaborationMaterializeTombstoneRequest,
  CollaborationMaterializeVersionRequest,
  isDatabaseSidecarPath,
} from "@cafecode/contracts";
import { createHash, randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  constants as fsConstants,
  type FileHandle,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { CollaborationMembershipAuthorityShape } from "./CollaborationAuthorization.ts";
import { CollaborationMembershipAuthority } from "./CollaborationAuthorization.ts";
import type { CollaborationDeviceKeyAuthorityShape } from "./CollaborationEventAdmission.ts";
import { CollaborationDeviceKeyAuthority } from "./CollaborationEventAdmission.ts";
import type { CollaborationFileSyncStoreShape } from "./CollaborationFileSyncStore.ts";
import type { CollaborationSandboxPathAuthorityShape } from "./CollaborationSandboxPathAuthority.ts";
import {
  CollaborationSandboxPathAuthority,
  CollaborationSandboxPathError,
} from "./CollaborationSandboxPathAuthority.ts";

const MANAGED_DIRECTORY = ".club-code-managed";
const STAGING_DIRECTORY = "staging";
const RECOVERY_DIRECTORY = "recovery";
const TEMP_NAME_PATTERN = /^upload-[a-f0-9]{32}\.tmp$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const WINDOWS_RESERVED_FILE_STEM =
  /^(?:con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/iu;

type Operation = "blob.put" | "version.materialize" | "tombstone.materialize";

export type CollaborationReplicaStorageFailureReason =
  | "invalid-request"
  | "not-found"
  | "quota-exceeded"
  | "content-invalid"
  | "unsafe-storage"
  | "database-content-forbidden"
  | "cancelled"
  | "unavailable";

/** Public errors contain no local paths, bodies, tokens, or authorization detail. */
export class CollaborationReplicaStorageError extends Data.TaggedError(
  "CollaborationReplicaStorageError",
)<{
  readonly operation: Operation;
  readonly reason: CollaborationReplicaStorageFailureReason;
}> {}

interface StorageInput {
  readonly principal: unknown;
  readonly request: unknown;
  readonly signal?: AbortSignal;
}

export interface CollaborationReplicaStorageShape {
  readonly putBlob: (
    input: StorageInput & { readonly source: AsyncIterable<Uint8Array> },
  ) => Effect.Effect<BlobPutResult, CollaborationReplicaStorageError>;
  readonly materializeVersion: (
    input: StorageInput,
  ) => Effect.Effect<MaterializeResult, CollaborationReplicaStorageError>;
  readonly materializeTombstone: (
    input: StorageInput,
  ) => Effect.Effect<MaterializeResult, CollaborationReplicaStorageError>;
}

export class CollaborationReplicaStorage extends Context.Service<
  CollaborationReplicaStorage,
  CollaborationReplicaStorageShape
>()("cafecode/collaboration/CollaborationReplicaStorage") {}

export interface CollaborationReplicaStorageOptions {
  readonly replicaRoot: string;
  readonly blobRoot: string;
  readonly fileAuthority: CollaborationFileSyncStoreShape;
  readonly membershipAuthority: CollaborationMembershipAuthorityShape;
  readonly deviceKeyAuthority: CollaborationDeviceKeyAuthorityShape;
  readonly sandboxPathAuthority: CollaborationSandboxPathAuthorityShape;
  readonly projectBlobQuotaBytes?: number;
  readonly fileMaxBytes?: number;
  readonly chunkMaxBytes?: number;
  readonly streamFrameMaxBytes?: number;
}

const decodePut = Schema.decodeUnknownEffect(CollaborationBlobPutRequest);
const decodeVersionRequest = Schema.decodeUnknownEffect(CollaborationMaterializeVersionRequest);
const decodeTombstoneRequest = Schema.decodeUnknownEffect(CollaborationMaterializeTombstoneRequest);
const decodePutResult = Schema.decodeUnknownSync(CollaborationBlobPutResult);
const decodeMaterializeResult = Schema.decodeUnknownSync(CollaborationMaterializeResult);

function fail(operation: Operation, reason: CollaborationReplicaStorageFailureReason) {
  return new CollaborationReplicaStorageError({ operation, reason });
}

function isCancelled(...signals: ReadonlyArray<AbortSignal | undefined>): boolean {
  return signals.some((signal) => signal?.aborted === true);
}

function throwIfCancelled(
  operation: Operation,
  ...signals: ReadonlyArray<AbortSignal | undefined>
) {
  if (isCancelled(...signals)) throw fail(operation, "cancelled");
}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot))
  );
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === code
  );
}

function portableRelativePath(relativePath: string): boolean {
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    relativePath.includes(":") ||
    relativePath.normalize("NFC") !== relativePath
  )
    return false;
  const segments = relativePath.split("/");
  if (segments[0]?.toLowerCase() === MANAGED_DIRECTORY) return false;
  return segments.every((segment) => {
    const stem = segment.split(".", 1)[0]!;
    return (
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.endsWith(".") &&
      !segment.endsWith(" ") &&
      !WINDOWS_RESERVED_FILE_STEM.test(stem)
    );
  });
}

interface RootIdentity {
  readonly configuredPath: string;
  readonly canonicalPath: string;
  readonly dev: number | bigint;
  readonly ino: number | bigint;
}

async function makeRootIdentity(path: string): Promise<RootIdentity> {
  const configuredPath = resolve(path);
  await mkdir(configuredPath, { recursive: true });
  const configuredStats = await lstat(configuredPath, { bigint: true });
  if (!configuredStats.isDirectory() || configuredStats.isSymbolicLink())
    throw new Error("unsafe root");
  const canonicalPath = await realpath(configuredPath);
  const canonicalStats = await lstat(canonicalPath, { bigint: true });
  if (!canonicalStats.isDirectory() || canonicalStats.isSymbolicLink())
    throw new Error("unsafe root");
  return {
    configuredPath,
    canonicalPath,
    dev: canonicalStats.dev,
    ino: canonicalStats.ino,
  };
}

async function assertRootIdentity(root: RootIdentity): Promise<void> {
  const configuredStats = await lstat(root.configuredPath, { bigint: true });
  if (!configuredStats.isDirectory() || configuredStats.isSymbolicLink())
    throw new Error("root changed");
  const currentCanonical = await realpath(root.configuredPath);
  const currentStats = await lstat(currentCanonical, { bigint: true });
  if (
    currentCanonical !== root.canonicalPath ||
    !currentStats.isDirectory() ||
    currentStats.isSymbolicLink() ||
    currentStats.dev !== root.dev ||
    currentStats.ino !== root.ino
  )
    throw new Error("root changed");
}

async function exactEntry(parent: string, segment: string): Promise<Dirent | null> {
  const entries = await readdir(parent, { withFileTypes: true });
  const folded = segment.toLowerCase();
  const aliases = entries.filter((entry) => entry.name.toLowerCase() === folded);
  if (aliases.length === 0) return null;
  if (aliases.length !== 1 || aliases[0]!.name !== segment) throw new Error("case alias");
  return aliases[0]!;
}

async function ensureDirectory(
  root: RootIdentity,
  segments: ReadonlyArray<string>,
): Promise<string> {
  await assertRootIdentity(root);
  let cursor = root.canonicalPath;
  for (const segment of segments) {
    const existing = await exactEntry(cursor, segment);
    const child = resolve(cursor, segment);
    if (!isContained(root.canonicalPath, child)) throw new Error("outside root");
    if (existing === null) {
      try {
        await mkdir(child);
      } catch (error) {
        if (!isNodeError(error, "EEXIST")) throw error;
      }
    }
    const stats = await lstat(child, { bigint: true });
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("unsafe directory");
    const canonical = await realpath(child);
    if (!isContained(root.canonicalPath, canonical)) throw new Error("outside root");
    cursor = child;
  }
  await assertRootIdentity(root);
  return cursor;
}

async function assertSafeRelativePath(
  root: RootIdentity,
  relativePath: string,
  options: { readonly allowMissingLeaf: boolean },
): Promise<{ readonly absolutePath: string; readonly exists: boolean }> {
  if (!portableRelativePath(relativePath)) throw new Error("non-portable path");
  await assertRootIdentity(root);
  const segments = relativePath.split("/");
  let cursor = root.canonicalPath;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const entry = await exactEntry(cursor, segment);
    const child = resolve(cursor, segment);
    if (!isContained(root.canonicalPath, child)) throw new Error("outside root");
    const isLeaf = index === segments.length - 1;
    if (entry === null) {
      if (!options.allowMissingLeaf || !isLeaf) return { absolutePath: child, exists: false };
      return { absolutePath: child, exists: false };
    }
    const stats = await lstat(child, { bigint: true });
    if (stats.isSymbolicLink()) throw new Error("link");
    if (isLeaf) {
      if (!stats.isFile() || stats.nlink !== 1n) throw new Error("unsafe leaf");
    } else if (!stats.isDirectory()) {
      throw new Error("non-directory ancestor");
    }
    const canonical = await realpath(child);
    if (!isContained(root.canonicalPath, canonical)) throw new Error("outside root");
    cursor = child;
  }
  await assertRootIdentity(root);
  return { absolutePath: resolve(root.canonicalPath, ...segments), exists: true };
}

async function fsyncDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch (error) {
    if (
      process.platform !== "win32" ||
      (!isNodeError(error, "EPERM") && !isNodeError(error, "EACCES"))
    )
      throw error;
  } finally {
    await handle?.close();
  }
}

async function hashFile(
  operation: Operation,
  path: string,
  signal: AbortSignal | undefined,
): Promise<{ readonly sha256: string; readonly byteSize: number }> {
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  const hash = createHash("sha256");
  let byteSize = 0;
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      throwIfCancelled(operation, signal);
      const read = await handle.read(buffer, 0, buffer.byteLength, null);
      if (read.bytesRead === 0) break;
      hash.update(buffer.subarray(0, read.bytesRead));
      byteSize += read.bytesRead;
    }
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest("hex"), byteSize };
}

async function safeUnlink(path: string): Promise<void> {
  try {
    const stats = await lstat(path, { bigint: true });
    if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("unsafe cleanup target");
    await unlink(path);
  } catch (error) {
    if (!isNodeError(error, "ENOENT")) throw error;
  }
}

class ProjectMutex {
  readonly #tails = new Map<string, Promise<void>>();

  async run<A>(key: string, signal: AbortSignal | undefined, action: () => Promise<A>): Promise<A> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const ticket = new Promise<void>((resolveTicket) => {
      release = resolveTicket;
    });
    const tail = previous.then(() => ticket);
    this.#tails.set(key, tail);
    try {
      if (signal) {
        await Promise.race([
          previous,
          new Promise<never>((_, reject) => {
            if (signal.aborted) reject(fail("blob.put", "cancelled"));
            else
              signal.addEventListener("abort", () => reject(fail("blob.put", "cancelled")), {
                once: true,
              });
          }),
        ]);
      } else {
        await previous;
      }
      return await action();
    } finally {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

function projectStorageKey(projectId: SharedProjectId): string {
  return createHash("sha256")
    .update("club-code/cowork-project-blob-root/v1\0")
    .update(projectId)
    .digest("hex");
}

function versionFromCurrentState(
  operation: Operation,
  state: CollaborationFileState,
  versionId: string,
): CollaborationFileVersion {
  if (
    state.head?.kind !== "version" ||
    state.head.versionId !== versionId ||
    state.headVersion?.versionId !== versionId
  )
    throw fail(operation, "not-found");
  if (
    state.headVersion.contentKind.kind === "database" ||
    isDatabaseSidecarPath(state.relativePath)
  )
    throw fail(operation, "database-content-forbidden");
  return state.headVersion;
}

function chunkFromVersion(
  version: CollaborationFileVersion,
  request: {
    readonly chunkIndex: number;
    readonly contentSha256: string;
    readonly byteSize: number;
  },
): CollaborationFileChunk {
  const chunk = version.manifest.chunks[request.chunkIndex];
  if (
    !chunk ||
    chunk.index !== request.chunkIndex ||
    chunk.contentSha256 !== request.contentSha256 ||
    chunk.byteSize !== request.byteSize
  )
    throw fail("blob.put", "not-found");
  return chunk;
}

function mapUnknown(operation: Operation, cause: unknown): CollaborationReplicaStorageError {
  if (cause instanceof CollaborationReplicaStorageError) return cause;
  if (cause instanceof CollaborationSandboxPathError) return fail(operation, "unsafe-storage");
  if (
    cause instanceof Error &&
    [
      "unsafe root",
      "root changed",
      "case alias",
      "outside root",
      "unsafe directory",
      "non-portable path",
      "link",
      "unsafe leaf",
      "non-directory ancestor",
      "unsafe cleanup target",
      "unsafe staging entry",
      "unsafe blob root entry",
      "unsafe blob entry",
      "unsafe blob",
      "unsafe promoted blob",
      "replacement recovery collision",
      "recovery collision",
    ].includes(cause.message)
  )
    return fail(operation, "unsafe-storage");
  return fail(operation, "unavailable");
}

export function makeCollaborationReplicaStorage(
  options: CollaborationReplicaStorageOptions,
): Effect.Effect<CollaborationReplicaStorageShape, CollaborationReplicaStorageError> {
  const projectQuota = options.projectBlobQuotaBytes ?? COLLABORATION_PROJECT_BLOB_QUOTA_MAX_BYTES;
  const fileLimit = options.fileMaxBytes ?? COLLABORATION_MATERIALIZED_FILE_MAX_BYTES;
  const chunkLimit = options.chunkMaxBytes ?? COLLABORATION_BLOB_CHUNK_MAX_BYTES;
  const frameLimit = options.streamFrameMaxBytes ?? COLLABORATION_BLOB_STREAM_FRAME_MAX_BYTES;
  if (
    !Number.isSafeInteger(projectQuota) ||
    projectQuota < 1 ||
    projectQuota > COLLABORATION_PROJECT_BLOB_QUOTA_MAX_BYTES ||
    !Number.isSafeInteger(fileLimit) ||
    fileLimit < 1 ||
    fileLimit > COLLABORATION_MATERIALIZED_FILE_MAX_BYTES ||
    !Number.isSafeInteger(chunkLimit) ||
    chunkLimit < 1 ||
    chunkLimit > COLLABORATION_BLOB_CHUNK_MAX_BYTES ||
    !Number.isSafeInteger(frameLimit) ||
    frameLimit < 1 ||
    frameLimit > COLLABORATION_BLOB_STREAM_FRAME_MAX_BYTES
  )
    return Effect.fail(fail("blob.put", "invalid-request"));

  return Effect.tryPromise({
    try: async () => {
      const replicaRoot = await makeRootIdentity(options.replicaRoot);
      const blobRoot = await makeRootIdentity(options.blobRoot);
      const managedRootPath = await ensureDirectory(replicaRoot, [MANAGED_DIRECTORY]);
      const managedRoot = await makeRootIdentity(managedRootPath);
      await ensureDirectory(managedRoot, [STAGING_DIRECTORY]);
      await ensureDirectory(managedRoot, [RECOVERY_DIRECTORY]);
      const mutex = new ProjectMutex();

      const readCurrent = (
        operation: Operation,
        principal: unknown,
        request: {
          readonly sharedProjectId: SharedProjectId;
          readonly relativePath: SharedReplicaRelativePath;
          readonly deviceKeyId: typeof CollaborationBlobPutRequest.Type.deviceKeyId;
        },
      ) =>
        options.fileAuthority
          .read({
            principal,
            request: {
              sharedProjectId: request.sharedProjectId,
              relativePath: request.relativePath,
              deviceKeyId: request.deviceKeyId,
            },
          })
          .pipe(
            Effect.provideService(CollaborationMembershipAuthority, options.membershipAuthority),
            Effect.provideService(CollaborationDeviceKeyAuthority, options.deviceKeyAuthority),
            Effect.provideService(CollaborationSandboxPathAuthority, options.sandboxPathAuthority),
            Effect.mapError(() => fail(operation, "not-found")),
          );

      const blobProjectDirectory = async (projectId: SharedProjectId) => {
        const key = projectStorageKey(projectId);
        const bucket = await ensureDirectory(blobRoot, [key]);
        const staging = await ensureDirectory(blobRoot, [key, STAGING_DIRECTORY]);
        return { key, bucket, staging };
      };

      const cleanupStaging = async (staging: string) => {
        const entries = await readdir(staging, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !TEMP_NAME_PATTERN.test(entry.name))
            throw new Error("unsafe staging entry");
          await safeUnlink(resolve(staging, entry.name));
        }
      };

      const blobUsage = async (bucket: string) => {
        let total = 0;
        for (const entry of await readdir(bucket, { withFileTypes: true })) {
          if (entry.name === STAGING_DIRECTORY && entry.isDirectory()) continue;
          if (!entry.isFile() || !DIGEST_PATTERN.test(entry.name))
            throw new Error("unsafe blob entry");
          const path = resolve(bucket, entry.name);
          const stats = await lstat(path, { bigint: true });
          if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n)
            throw new Error("unsafe blob");
          total += Number(stats.size);
          if (!Number.isSafeInteger(total)) throw new Error("blob quota overflow");
        }
        return total;
      };

      const verifyBlob = async (
        operation: Operation,
        bucket: string,
        digest: string,
        byteSize: number,
        signal: AbortSignal | undefined,
      ) => {
        const path = resolve(bucket, digest);
        const entry = await exactEntry(bucket, digest);
        if (entry === null) return null;
        if (!entry.isFile()) throw new Error("unsafe blob");
        const stats = await lstat(path, { bigint: true });
        if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n)
          throw new Error("unsafe blob");
        const observed = await hashFile(operation, path, signal);
        if (observed.byteSize !== byteSize || observed.sha256 !== digest)
          throw fail(operation, "content-invalid");
        return path;
      };

      // Clean only incomplete files from earlier process crashes. This never
      // recursively deletes and refuses any unexpected entry type or name.
      for (const entry of await readdir(blobRoot.canonicalPath, { withFileTypes: true })) {
        if (!entry.isDirectory() || !DIGEST_PATTERN.test(entry.name))
          throw new Error("unsafe blob root entry");
        const staging = await ensureDirectory(blobRoot, [entry.name, STAGING_DIRECTORY]);
        await cleanupStaging(staging);
      }

      const putBlob: CollaborationReplicaStorageShape["putBlob"] = (input) =>
        Effect.gen(function* () {
          const request = yield* decodePut(input.request, { onExcessProperty: "error" }).pipe(
            Effect.mapError(() => fail("blob.put", "invalid-request")),
          );
          if (!portableRelativePath(request.relativePath) || request.byteSize > chunkLimit)
            return yield* Effect.fail(fail("blob.put", "invalid-request"));
          const initialState = yield* readCurrent("blob.put", input.principal, request);
          const initialVersion = yield* Effect.try({
            try: () => versionFromCurrentState("blob.put", initialState, request.versionId),
            catch: (cause) => mapUnknown("blob.put", cause),
          });
          yield* Effect.try({
            try: () => chunkFromVersion(initialVersion, request),
            catch: (cause) => mapUnknown("blob.put", cause),
          });
          const staged = yield* Effect.tryPromise({
            try: async (effectSignal) => {
              throwIfCancelled("blob.put", input.signal, effectSignal);
              const { bucket, staging } = await blobProjectDirectory(request.sharedProjectId);
              const existing = await verifyBlob(
                "blob.put",
                bucket,
                request.contentSha256,
                request.byteSize,
                input.signal,
              );
              if (existing !== null) return { bucket, tempPath: null };
              const tempName = `upload-${randomBytes(16).toString("hex")}.tmp`;
              const tempPath = resolve(staging, tempName);
              const handle = await open(
                tempPath,
                fsConstants.O_CREAT |
                  fsConstants.O_EXCL |
                  fsConstants.O_WRONLY |
                  (fsConstants.O_NOFOLLOW ?? 0),
                0o600,
              );
              const digest = createHash("sha256");
              let byteSize = 0;
              try {
                for await (const frame of input.source) {
                  throwIfCancelled("blob.put", input.signal, effectSignal);
                  if (
                    !(frame instanceof Uint8Array) ||
                    frame.byteLength === 0 ||
                    frame.byteLength > frameLimit
                  )
                    throw fail("blob.put", "content-invalid");
                  byteSize += frame.byteLength;
                  if (byteSize > request.byteSize || byteSize > chunkLimit)
                    throw fail("blob.put", "content-invalid");
                  digest.update(frame);
                  await handle.write(frame);
                }
                if (byteSize !== request.byteSize || digest.digest("hex") !== request.contentSha256)
                  throw fail("blob.put", "content-invalid");
                await handle.sync();
              } catch (cause) {
                await handle.close().catch(() => undefined);
                await safeUnlink(tempPath).catch(() => undefined);
                throw cause;
              }
              await handle.close();
              return { bucket, tempPath };
            },
            catch: (cause) => mapUnknown("blob.put", cause),
          });
          const cleanupStaged = staged.tempPath
            ? Effect.promise(() => safeUnlink(staged.tempPath!).catch(() => undefined))
            : Effect.void;
          const currentState = yield* readCurrent("blob.put", input.principal, request).pipe(
            Effect.onError(() => cleanupStaged),
          );
          yield* Effect.try({
            try: () => {
              const version = versionFromCurrentState("blob.put", currentState, request.versionId);
              chunkFromVersion(version, request);
            },
            catch: (cause) => mapUnknown("blob.put", cause),
          }).pipe(Effect.onError(() => cleanupStaged));
          const disposition = yield* Effect.tryPromise({
            try: async () =>
              mutex.run(projectStorageKey(request.sharedProjectId), input.signal, async () => {
                throwIfCancelled("blob.put", input.signal);
                await assertRootIdentity(blobRoot);
                const existing = await verifyBlob(
                  "blob.put",
                  staged.bucket,
                  request.contentSha256,
                  request.byteSize,
                  input.signal,
                );
                if (existing !== null) {
                  if (staged.tempPath) await safeUnlink(staged.tempPath);
                  return "already-present" as const;
                }
                if (staged.tempPath === null) throw new Error("missing staged blob");
                const used = await blobUsage(staged.bucket);
                if (used + request.byteSize > projectQuota)
                  throw fail("blob.put", "quota-exceeded");
                const finalPath = resolve(staged.bucket, request.contentSha256);
                // This is an atomic create-if-absent promotion. A rename could
                // overwrite a blob raced into the digest slot after our check.
                try {
                  await link(staged.tempPath, finalPath);
                } catch (cause) {
                  if (!isNodeError(cause, "EEXIST")) throw cause;
                  const racedBlob = await verifyBlob(
                    "blob.put",
                    staged.bucket,
                    request.contentSha256,
                    request.byteSize,
                    input.signal,
                  );
                  if (racedBlob === null) throw cause;
                  await safeUnlink(staged.tempPath);
                  return "already-present" as const;
                }
                await safeUnlink(staged.tempPath);
                const stats = await lstat(finalPath, { bigint: true });
                if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n)
                  throw new Error("unsafe promoted blob");
                await fsyncDirectory(staged.bucket);
                return "stored" as const;
              }),
            catch: (cause) => mapUnknown("blob.put", cause),
          }).pipe(Effect.ensuring(cleanupStaged));
          const finalState = yield* readCurrent("blob.put", input.principal, request);
          yield* Effect.try({
            try: () => {
              const version = versionFromCurrentState("blob.put", finalState, request.versionId);
              chunkFromVersion(version, request);
            },
            catch: (cause) => mapUnknown("blob.put", cause),
          });
          return decodePutResult({
            disposition,
            contentSha256: request.contentSha256,
            byteSize: request.byteSize,
          });
        });

      const materializeVersion: CollaborationReplicaStorageShape["materializeVersion"] = (input) =>
        Effect.gen(function* () {
          const request = yield* decodeVersionRequest(input.request, {
            onExcessProperty: "error",
          }).pipe(Effect.mapError(() => fail("version.materialize", "invalid-request")));
          if (!portableRelativePath(request.relativePath))
            return yield* Effect.fail(fail("version.materialize", "invalid-request"));
          const state = yield* readCurrent("version.materialize", input.principal, request);
          const version = yield* Effect.try({
            try: () => versionFromCurrentState("version.materialize", state, request.versionId),
            catch: (cause) => mapUnknown("version.materialize", cause),
          });
          if (
            version.manifest.byteSize > fileLimit ||
            version.manifest.chunks.some((chunk) => chunk.byteSize > chunkLimit)
          )
            return yield* Effect.fail(fail("version.materialize", "quota-exceeded"));
          const result = yield* Effect.tryPromise({
            try: async (effectSignal) => {
              throwIfCancelled("version.materialize", input.signal, effectSignal);
              await options.sandboxPathAuthority
                .assertContained(request.relativePath)
                .pipe(Effect.runPromise);
              const segments = request.relativePath.split("/");
              const parent = await ensureDirectory(replicaRoot, segments.slice(0, -1));
              const checked = await assertSafeRelativePath(replicaRoot, request.relativePath, {
                allowMissingLeaf: true,
              });
              if (checked.exists) {
                const observed = await hashFile(
                  "version.materialize",
                  checked.absolutePath,
                  input.signal,
                );
                if (
                  observed.sha256 === version.manifest.contentSha256 &&
                  observed.byteSize === version.manifest.byteSize
                )
                  return "already-materialized" as const;
              }
              const tempPath = resolve(
                parent,
                `.${segments.at(-1)!}.club-code-${randomBytes(16).toString("hex")}.tmp`,
              );
              const output = await open(
                tempPath,
                fsConstants.O_CREAT |
                  fsConstants.O_EXCL |
                  fsConstants.O_WRONLY |
                  (fsConstants.O_NOFOLLOW ?? 0),
                0o600,
              );
              const fullDigest = createHash("sha256");
              let fullSize = 0;
              try {
                const { bucket } = await blobProjectDirectory(request.sharedProjectId);
                for (const chunk of version.manifest.chunks) {
                  throwIfCancelled("version.materialize", input.signal, effectSignal);
                  const blobPath = await verifyBlob(
                    "version.materialize",
                    bucket,
                    chunk.contentSha256,
                    chunk.byteSize,
                    input.signal,
                  );
                  if (blobPath === null) throw fail("version.materialize", "not-found");
                  const blob = await open(
                    blobPath,
                    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
                  );
                  const chunkDigest = createHash("sha256");
                  let chunkSize = 0;
                  try {
                    const buffer = Buffer.allocUnsafe(frameLimit);
                    for (;;) {
                      throwIfCancelled("version.materialize", input.signal, effectSignal);
                      const read = await blob.read(buffer, 0, buffer.byteLength, null);
                      if (read.bytesRead === 0) break;
                      const bytes = buffer.subarray(0, read.bytesRead);
                      chunkDigest.update(bytes);
                      fullDigest.update(bytes);
                      chunkSize += read.bytesRead;
                      fullSize += read.bytesRead;
                      if (fullSize > fileLimit) throw fail("version.materialize", "quota-exceeded");
                      await output.write(bytes);
                    }
                  } finally {
                    await blob.close();
                  }
                  if (
                    chunkSize !== chunk.byteSize ||
                    chunkDigest.digest("hex") !== chunk.contentSha256
                  )
                    throw fail("version.materialize", "content-invalid");
                }
                if (
                  fullSize !== version.manifest.byteSize ||
                  fullDigest.digest("hex") !== version.manifest.contentSha256
                )
                  throw fail("version.materialize", "content-invalid");
                await output.sync();
              } catch (cause) {
                await output.close().catch(() => undefined);
                await safeUnlink(tempPath).catch(() => undefined);
                throw cause;
              }
              await output.close();
              try {
                await assertRootIdentity(replicaRoot);
                const commitState = await Effect.runPromise(
                  readCurrent("version.materialize", input.principal, request),
                );
                versionFromCurrentState("version.materialize", commitState, request.versionId);
                await options.sandboxPathAuthority
                  .assertContained(request.relativePath)
                  .pipe(Effect.runPromise);
                const beforeReplace = await assertSafeRelativePath(
                  replicaRoot,
                  request.relativePath,
                  { allowMissingLeaf: true },
                );
                if (process.platform === "win32" && beforeReplace.exists) {
                  const projectRecovery = projectStorageKey(request.sharedProjectId);
                  const recoveryParent = await ensureDirectory(managedRoot, [
                    RECOVERY_DIRECTORY,
                    projectRecovery,
                    "replacements",
                    request.versionId,
                  ]);
                  const recoveryPath = resolve(
                    recoveryParent,
                    createHash("sha256").update(request.relativePath).digest("hex"),
                  );
                  if (
                    (await exactEntry(recoveryParent, recoveryPath.split(/[\\/]/u).at(-1)!)) !==
                    null
                  )
                    throw new Error("replacement recovery collision");
                  await rename(beforeReplace.absolutePath, recoveryPath);
                  try {
                    await rename(tempPath, beforeReplace.absolutePath);
                  } catch (cause) {
                    await rename(recoveryPath, beforeReplace.absolutePath).catch(() => undefined);
                    throw cause;
                  }
                  await fsyncDirectory(recoveryParent);
                } else {
                  await rename(tempPath, beforeReplace.absolutePath);
                }
                await fsyncDirectory(parent);
                return "materialized" as const;
              } finally {
                await safeUnlink(tempPath).catch(() => undefined);
              }
            },
            catch: (cause) => mapUnknown("version.materialize", cause),
          });
          const finalState = yield* readCurrent("version.materialize", input.principal, request);
          yield* Effect.try({
            try: () =>
              versionFromCurrentState("version.materialize", finalState, request.versionId),
            catch: (cause) => mapUnknown("version.materialize", cause),
          });
          return decodeMaterializeResult({
            disposition: result,
            sharedProjectId: request.sharedProjectId,
            relativePath: request.relativePath,
            revisionId: request.versionId,
          });
        });

      const materializeTombstone: CollaborationReplicaStorageShape["materializeTombstone"] = (
        input,
      ) =>
        Effect.gen(function* () {
          const request = yield* decodeTombstoneRequest(input.request, {
            onExcessProperty: "error",
          }).pipe(Effect.mapError(() => fail("tombstone.materialize", "invalid-request")));
          if (!portableRelativePath(request.relativePath))
            return yield* Effect.fail(fail("tombstone.materialize", "invalid-request"));
          const state = yield* readCurrent("tombstone.materialize", input.principal, request);
          if (
            state.head?.kind !== "tombstone" ||
            state.head.tombstoneId !== request.tombstoneId ||
            !state.tombstones.some((tombstone) => tombstone.tombstoneId === request.tombstoneId)
          )
            return yield* Effect.fail(fail("tombstone.materialize", "not-found"));
          const disposition = yield* Effect.tryPromise({
            try: async (effectSignal) => {
              throwIfCancelled("tombstone.materialize", input.signal, effectSignal);
              await options.sandboxPathAuthority
                .assertContained(request.relativePath)
                .pipe(Effect.runPromise);
              const checked = await assertSafeRelativePath(replicaRoot, request.relativePath, {
                allowMissingLeaf: true,
              });
              if (!checked.exists) return "already-absent" as const;
              const recoveryParent = await ensureDirectory(managedRoot, [
                RECOVERY_DIRECTORY,
                projectStorageKey(request.sharedProjectId),
                "tombstones",
                request.tombstoneId,
              ]);
              const recoveryName = createHash("sha256").update(request.relativePath).digest("hex");
              const recoveryPath = resolve(recoveryParent, recoveryName);
              if ((await exactEntry(recoveryParent, recoveryName)) !== null)
                throw new Error("recovery collision");
              await assertRootIdentity(replicaRoot);
              const commitState = await Effect.runPromise(
                readCurrent("tombstone.materialize", input.principal, request),
              );
              if (
                commitState.head?.kind !== "tombstone" ||
                commitState.head.tombstoneId !== request.tombstoneId
              )
                throw fail("tombstone.materialize", "not-found");
              await rename(checked.absolutePath, recoveryPath);
              await fsyncDirectory(dirname(checked.absolutePath));
              await fsyncDirectory(recoveryParent);
              return "moved-to-recovery" as const;
            },
            catch: (cause) => mapUnknown("tombstone.materialize", cause),
          });
          const finalState = yield* readCurrent("tombstone.materialize", input.principal, request);
          if (
            finalState.head?.kind !== "tombstone" ||
            finalState.head.tombstoneId !== request.tombstoneId
          )
            return yield* Effect.fail(fail("tombstone.materialize", "not-found"));
          return decodeMaterializeResult({
            disposition,
            sharedProjectId: request.sharedProjectId,
            relativePath: request.relativePath,
            revisionId: request.tombstoneId,
          });
        });

      return CollaborationReplicaStorage.of({
        putBlob,
        materializeVersion,
        materializeTombstone,
      });
    },
    catch: (cause) => mapUnknown("blob.put", cause),
  });
}
