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
const MATERIALIZE_TEMP_NAME_PATTERN = /^materialize-[a-f0-9]{32}\.tmp$/u;
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
  expectedMaxBytes: number,
  ...signals: ReadonlyArray<AbortSignal | undefined>
): Promise<{ readonly sha256: string; readonly byteSize: number }> {
  const before = await lstat(path, { bigint: true });
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1n ||
    before.size > BigInt(expectedMaxBytes)
  )
    throw new Error("unsafe leaf");
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  const hash = createHash("sha256");
  let byteSize = 0;
  try {
    const opened = await handle.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      throw new Error("unsafe leaf");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      throwIfCancelled(operation, ...signals);
      const read = await handle.read(buffer, 0, buffer.byteLength, null);
      if (read.bytesRead === 0) break;
      hash.update(buffer.subarray(0, read.bytesRead));
      byteSize += read.bytesRead;
      if (byteSize > expectedMaxBytes) throw fail(operation, "content-invalid");
    }
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest("hex"), byteSize };
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (written.bytesWritten <= 0) throw new Error("short write");
    offset += written.bytesWritten;
  }
}

async function nextWithCancellation<T>(
  operation: Operation,
  iterator: AsyncIterator<T>,
  ...signals: ReadonlyArray<AbortSignal | undefined>
): Promise<IteratorResult<T>> {
  throwIfCancelled(operation, ...signals);
  const activeSignals = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (activeSignals.length === 0) return iterator.next();
  let removeListeners: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    const onAbort = () => reject(fail(operation, "cancelled"));
    for (const signal of activeSignals) signal.addEventListener("abort", onAbort, { once: true });
    removeListeners = () => {
      for (const signal of activeSignals) signal.removeEventListener("abort", onAbort);
    };
    if (activeSignals.some((signal) => signal.aborted)) onAbort();
  });
  try {
    return await Promise.race([iterator.next(), cancelled]);
  } finally {
    removeListeners?.();
  }
}

async function waitWithCancellation(
  operation: Operation,
  promise: Promise<void>,
  ...signals: ReadonlyArray<AbortSignal | undefined>
): Promise<void> {
  throwIfCancelled(operation, ...signals);
  const activeSignals = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (activeSignals.length === 0) return promise;
  let removeListeners: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
    const onAbort = () => reject(fail(operation, "cancelled"));
    for (const signal of activeSignals) signal.addEventListener("abort", onAbort, { once: true });
    removeListeners = () => {
      for (const signal of activeSignals) signal.removeEventListener("abort", onAbort);
    };
    if (activeSignals.some((signal) => signal.aborted)) onAbort();
  });
  try {
    await Promise.race([promise, cancelled]);
  } finally {
    removeListeners?.();
  }
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

  async run<A>(
    key: string,
    operation: Operation,
    signals: ReadonlyArray<AbortSignal | undefined>,
    action: () => Promise<A>,
  ): Promise<A> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const ticket = new Promise<void>((resolveTicket) => {
      release = resolveTicket;
    });
    const tail = previous.then(() => ticket);
    this.#tails.set(key, tail);
    try {
      await waitWithCancellation(operation, previous, ...signals);
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

function sha256Path(relativePath: SharedReplicaRelativePath): string {
  return createHash("sha256").update(relativePath).digest("hex");
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
      "installed target missing",
      "tombstone rollback collision",
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
      const managedStaging = await ensureDirectory(managedRoot, [STAGING_DIRECTORY]);
      await ensureDirectory(managedRoot, [RECOVERY_DIRECTORY]);
      const mutex = new ProjectMutex();
      const blobReservations = new Map<string, Map<string, { byteSize: number; count: number }>>();

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

      const cleanupMaterializeStaging = async () => {
        const entries = await readdir(managedStaging, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isFile() || !MATERIALIZE_TEMP_NAME_PATTERN.test(entry.name))
            throw new Error("unsafe staging entry");
          await safeUnlink(resolve(managedStaging, entry.name));
        }
      };

      const blobUsage = async (bucket: string) => {
        let total = 0n;
        for (const entry of await readdir(bucket, { withFileTypes: true })) {
          if (entry.name === STAGING_DIRECTORY && entry.isDirectory()) continue;
          if (!entry.isFile() || !DIGEST_PATTERN.test(entry.name))
            throw new Error("unsafe blob entry");
          const path = resolve(bucket, entry.name);
          const stats = await lstat(path, { bigint: true });
          if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n)
            throw new Error("unsafe blob");
          total += stats.size;
          if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("blob quota overflow");
        }
        return Number(total);
      };

      const verifyBlob = async (
        operation: Operation,
        bucket: string,
        digest: string,
        byteSize: number,
        ...signals: ReadonlyArray<AbortSignal | undefined>
      ) => {
        const path = resolve(bucket, digest);
        const entry = await exactEntry(bucket, digest);
        if (entry === null) return null;
        if (!entry.isFile()) throw new Error("unsafe blob");
        const stats = await lstat(path, { bigint: true });
        if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n)
          throw new Error("unsafe blob");
        const observed = await hashFile(operation, path, byteSize, ...signals);
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
      await cleanupMaterializeStaging();

      const reservedBytes = (projectKey: string) => {
        let total = 0;
        for (const reservation of blobReservations.get(projectKey)?.values() ?? [])
          total += reservation.byteSize;
        return total;
      };

      const releaseBlobReservation = (projectKey: string, digest: string) => {
        const project = blobReservations.get(projectKey);
        const reservation = project?.get(digest);
        if (!project || !reservation) return;
        if (reservation.count > 1)
          project.set(digest, { ...reservation, count: reservation.count - 1 });
        else project.delete(digest);
        if (project.size === 0) blobReservations.delete(projectKey);
      };

      const reserveBlob = async (
        projectKey: string,
        bucket: string,
        digest: string,
        byteSize: number,
        ...signals: ReadonlyArray<AbortSignal | undefined>
      ) =>
        mutex.run(projectKey, "blob.put", signals, async () => {
          const existing = await verifyBlob("blob.put", bucket, digest, byteSize, ...signals);
          if (existing !== null) return false;
          const project = blobReservations.get(projectKey) ?? new Map();
          const reservation = project.get(digest);
          if (reservation && reservation.byteSize !== byteSize)
            throw fail("blob.put", "content-invalid");
          if (reservation) {
            project.set(digest, { ...reservation, count: reservation.count + 1 });
          } else {
            const used = await blobUsage(bucket);
            if (used + reservedBytes(projectKey) + byteSize > projectQuota)
              throw fail("blob.put", "quota-exceeded");
            project.set(digest, { byteSize, count: 1 });
          }
          blobReservations.set(projectKey, project);
          return true;
        });

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
              const { key, bucket, staging } = await blobProjectDirectory(request.sharedProjectId);
              const reserved = await reserveBlob(
                key,
                bucket,
                request.contentSha256,
                request.byteSize,
                input.signal,
                effectSignal,
              );
              if (!reserved) return { key, bucket, tempPath: null, reserved: false };
              const tempName = `upload-${randomBytes(16).toString("hex")}.tmp`;
              const tempPath = resolve(staging, tempName);
              try {
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
                const iterator = input.source[Symbol.asyncIterator]();
                try {
                  for (;;) {
                    const next = await nextWithCancellation(
                      "blob.put",
                      iterator,
                      input.signal,
                      effectSignal,
                    );
                    if (next.done) break;
                    const frame = next.value;
                    if (
                      !(frame instanceof Uint8Array) ||
                      frame.byteLength === 0 ||
                      frame.byteLength > frameLimit
                    )
                      throw fail("blob.put", "content-invalid");
                    const stableFrame = Buffer.from(frame);
                    byteSize += stableFrame.byteLength;
                    if (byteSize > request.byteSize || byteSize > chunkLimit)
                      throw fail("blob.put", "content-invalid");
                    digest.update(stableFrame);
                    await writeAll(handle, stableFrame);
                  }
                  if (
                    byteSize !== request.byteSize ||
                    digest.digest("hex") !== request.contentSha256
                  )
                    throw fail("blob.put", "content-invalid");
                  await handle.sync();
                } catch (cause) {
                  try {
                    void Promise.resolve(iterator.return?.()).catch(() => undefined);
                  } catch {
                    // Preserve the validated storage failure over producer cleanup.
                  }
                  throw cause;
                } finally {
                  await handle.close().catch(() => undefined);
                }
              } catch (cause) {
                await safeUnlink(tempPath).catch(() => undefined);
                releaseBlobReservation(key, request.contentSha256);
                throw cause;
              }
              return { key, bucket, tempPath, reserved: true };
            },
            catch: (cause) => mapUnknown("blob.put", cause),
          });
          const cleanupStaged = Effect.promise(async () => {
            if (staged.tempPath) await safeUnlink(staged.tempPath).catch(() => undefined);
            if (staged.reserved) releaseBlobReservation(staged.key, request.contentSha256);
          });
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
            try: async (effectSignal) =>
              mutex.run(staged.key, "blob.put", [input.signal, effectSignal], async () => {
                throwIfCancelled("blob.put", input.signal, effectSignal);
                await assertRootIdentity(blobRoot);
                const existing = await verifyBlob(
                  "blob.put",
                  staged.bucket,
                  request.contentSha256,
                  request.byteSize,
                  input.signal,
                  effectSignal,
                );
                if (existing !== null) {
                  if (staged.tempPath) await safeUnlink(staged.tempPath);
                  return "already-present" as const;
                }
                if (staged.tempPath === null) throw new Error("missing staged blob");
                const stagedObserved = await hashFile(
                  "blob.put",
                  staged.tempPath,
                  request.byteSize,
                  input.signal,
                  effectSignal,
                );
                if (
                  stagedObserved.byteSize !== request.byteSize ||
                  stagedObserved.sha256 !== request.contentSha256
                )
                  throw fail("blob.put", "content-invalid");
                const used = await blobUsage(staged.bucket);
                if (used + reservedBytes(staged.key) > projectQuota)
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
                    effectSignal,
                  );
                  if (racedBlob === null) throw cause;
                  await safeUnlink(staged.tempPath);
                  return "already-present" as const;
                }
                await safeUnlink(staged.tempPath);
                const promoted = await verifyBlob(
                  "blob.put",
                  staged.bucket,
                  request.contentSha256,
                  request.byteSize,
                  input.signal,
                  effectSignal,
                );
                if (promoted === null) throw new Error("unsafe promoted blob");
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
            try: async (effectSignal) =>
              mutex.run(
                `replica:${projectStorageKey(request.sharedProjectId)}:${sha256Path(request.relativePath)}`,
                "version.materialize",
                [input.signal, effectSignal],
                async () => {
                  throwIfCancelled("version.materialize", input.signal, effectSignal);
                  await options.sandboxPathAuthority
                    .assertContained(request.relativePath)
                    .pipe(Effect.runPromise);
                  const freshState = await Effect.runPromise(
                    readCurrent("version.materialize", input.principal, request),
                  );
                  versionFromCurrentState("version.materialize", freshState, request.versionId);
                  const segments = request.relativePath.split("/");
                  const parent = await ensureDirectory(replicaRoot, segments.slice(0, -1));
                  const checked = await assertSafeRelativePath(replicaRoot, request.relativePath, {
                    allowMissingLeaf: true,
                  });
                  if (checked.exists) {
                    const observed = await hashFile(
                      "version.materialize",
                      checked.absolutePath,
                      fileLimit,
                      input.signal,
                      effectSignal,
                    );
                    if (
                      observed.sha256 === version.manifest.contentSha256 &&
                      observed.byteSize === version.manifest.byteSize
                    )
                      return "already-materialized" as const;
                  }
                  const tempPath = resolve(
                    managedStaging,
                    `materialize-${randomBytes(16).toString("hex")}.tmp`,
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
                  let outputDevice = -1n;
                  let outputInode = -1n;
                  try {
                    const outputIdentity = await output.stat({ bigint: true });
                    if (!outputIdentity.isFile() || outputIdentity.nlink !== 1n)
                      throw new Error("unsafe staging entry");
                    outputDevice = outputIdentity.dev;
                    outputInode = outputIdentity.ino;
                    const { bucket } = await blobProjectDirectory(request.sharedProjectId);
                    for (const chunk of version.manifest.chunks) {
                      throwIfCancelled("version.materialize", input.signal, effectSignal);
                      const blobPath = await verifyBlob(
                        "version.materialize",
                        bucket,
                        chunk.contentSha256,
                        chunk.byteSize,
                        input.signal,
                        effectSignal,
                      );
                      if (blobPath === null) throw fail("version.materialize", "not-found");
                      const blobBefore = await lstat(blobPath, { bigint: true });
                      if (
                        !blobBefore.isFile() ||
                        blobBefore.isSymbolicLink() ||
                        blobBefore.nlink !== 1n ||
                        blobBefore.size !== BigInt(chunk.byteSize)
                      )
                        throw new Error("unsafe blob");
                      const blob = await open(
                        blobPath,
                        fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
                      );
                      const chunkDigest = createHash("sha256");
                      let chunkSize = 0;
                      try {
                        const blobOpened = await blob.stat({ bigint: true });
                        if (
                          !blobOpened.isFile() ||
                          blobOpened.nlink !== 1n ||
                          blobOpened.dev !== blobBefore.dev ||
                          blobOpened.ino !== blobBefore.ino ||
                          blobOpened.size !== blobBefore.size
                        )
                          throw new Error("unsafe blob");
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
                          if (fullSize > fileLimit)
                            throw fail("version.materialize", "quota-exceeded");
                          await writeAll(output, bytes);
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
                    const stagedIdentity = await lstat(tempPath, { bigint: true });
                    if (
                      !stagedIdentity.isFile() ||
                      stagedIdentity.isSymbolicLink() ||
                      stagedIdentity.nlink !== 1n ||
                      stagedIdentity.dev !== outputDevice ||
                      stagedIdentity.ino !== outputInode ||
                      stagedIdentity.size !== BigInt(fullSize)
                    )
                      throw new Error("unsafe staging entry");
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
                    const recoveryParent = await ensureDirectory(managedRoot, [
                      RECOVERY_DIRECTORY,
                      projectStorageKey(request.sharedProjectId),
                      "replacements",
                      request.versionId,
                    ]);
                    const recoveryPath = beforeReplace.exists
                      ? resolve(recoveryParent, `previous-${randomBytes(16).toString("hex")}`)
                      : null;
                    if (recoveryPath) {
                      await rename(beforeReplace.absolutePath, recoveryPath);
                    }
                    try {
                      await rename(tempPath, beforeReplace.absolutePath);
                    } catch (cause) {
                      if (recoveryPath)
                        await rename(recoveryPath, beforeReplace.absolutePath).catch(
                          () => undefined,
                        );
                      throw cause;
                    }
                    await fsyncDirectory(parent);
                    await fsyncDirectory(recoveryParent);
                    try {
                      const installedObserved = await hashFile(
                        "version.materialize",
                        beforeReplace.absolutePath,
                        fileLimit,
                        input.signal,
                        effectSignal,
                      );
                      if (
                        installedObserved.byteSize !== version.manifest.byteSize ||
                        installedObserved.sha256 !== version.manifest.contentSha256
                      )
                        throw fail("version.materialize", "content-invalid");
                      const finalState = await Effect.runPromise(
                        readCurrent("version.materialize", input.principal, request),
                      );
                      versionFromCurrentState("version.materialize", finalState, request.versionId);
                    } catch (cause) {
                      const installed = await assertSafeRelativePath(
                        replicaRoot,
                        request.relativePath,
                        { allowMissingLeaf: false },
                      );
                      if (!installed.exists) throw new Error("installed target missing", { cause });
                      const stalePath = resolve(
                        recoveryParent,
                        `stale-${randomBytes(16).toString("hex")}`,
                      );
                      await rename(installed.absolutePath, stalePath);
                      if (recoveryPath) await rename(recoveryPath, installed.absolutePath);
                      await fsyncDirectory(parent);
                      await fsyncDirectory(recoveryParent);
                      throw cause;
                    }
                    return "materialized" as const;
                  } finally {
                    await safeUnlink(tempPath).catch(() => undefined);
                  }
                },
              ),
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
            try: async (effectSignal) =>
              mutex.run(
                `replica:${projectStorageKey(request.sharedProjectId)}:${sha256Path(request.relativePath)}`,
                "tombstone.materialize",
                [input.signal, effectSignal],
                async () => {
                  throwIfCancelled("tombstone.materialize", input.signal, effectSignal);
                  await options.sandboxPathAuthority
                    .assertContained(request.relativePath)
                    .pipe(Effect.runPromise);
                  const freshState = await Effect.runPromise(
                    readCurrent("tombstone.materialize", input.principal, request),
                  );
                  if (
                    freshState.head?.kind !== "tombstone" ||
                    freshState.head.tombstoneId !== request.tombstoneId ||
                    !freshState.tombstones.some(
                      (tombstone) => tombstone.tombstoneId === request.tombstoneId,
                    )
                  )
                    throw fail("tombstone.materialize", "not-found");
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
                  const recoveryName = `deleted-${randomBytes(16).toString("hex")}`;
                  const recoveryPath = resolve(recoveryParent, recoveryName);
                  await assertRootIdentity(replicaRoot);
                  const commitState = await Effect.runPromise(
                    readCurrent("tombstone.materialize", input.principal, request),
                  );
                  if (
                    commitState.head?.kind !== "tombstone" ||
                    commitState.head.tombstoneId !== request.tombstoneId
                  )
                    throw fail("tombstone.materialize", "not-found");
                  const beforeMove = await assertSafeRelativePath(
                    replicaRoot,
                    request.relativePath,
                    {
                      allowMissingLeaf: false,
                    },
                  );
                  if (!beforeMove.exists) return "already-absent" as const;
                  await rename(beforeMove.absolutePath, recoveryPath);
                  await fsyncDirectory(dirname(beforeMove.absolutePath));
                  await fsyncDirectory(recoveryParent);
                  try {
                    const finalState = await Effect.runPromise(
                      readCurrent("tombstone.materialize", input.principal, request),
                    );
                    if (
                      finalState.head?.kind !== "tombstone" ||
                      finalState.head.tombstoneId !== request.tombstoneId ||
                      !finalState.tombstones.some(
                        (tombstone) => tombstone.tombstoneId === request.tombstoneId,
                      )
                    )
                      throw fail("tombstone.materialize", "not-found");
                  } catch (cause) {
                    const target = await assertSafeRelativePath(replicaRoot, request.relativePath, {
                      allowMissingLeaf: true,
                    });
                    if (target.exists) throw new Error("tombstone rollback collision", { cause });
                    await rename(recoveryPath, target.absolutePath);
                    await fsyncDirectory(dirname(target.absolutePath));
                    await fsyncDirectory(recoveryParent);
                    throw cause;
                  }
                  return "moved-to-recovery" as const;
                },
              ),
            catch: (cause) => mapUnknown("tombstone.materialize", cause),
          });
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
