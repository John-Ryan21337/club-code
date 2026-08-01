import type {
  CollaborationDatabaseBinding,
  CollaborationPrincipal,
  CollaborationSqliteSnapshotCaptureResult as SqliteSnapshotCaptureResult,
  CollaborationSqliteSnapshotRestoreResult as SqliteSnapshotRestoreResult,
  SharedProjectId,
  SharedReplicaRelativePath,
} from "@cafecode/contracts";
import {
  COLLABORATION_MATERIALIZED_FILE_MAX_BYTES,
  COLLABORATION_SQLITE_SNAPSHOT_MAX_BYTES,
  CollaborationDatabaseBinding as CollaborationDatabaseBindingSchema,
  CollaborationSqliteSnapshotArtifact,
  CollaborationSqliteSnapshotCaptureRequest,
  CollaborationSqliteSnapshotCaptureResult,
  CollaborationSqliteSnapshotRestoreRequest,
  CollaborationSqliteSnapshotRestoreResult,
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
import { isAbsolute, relative, resolve, sep } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { CollaborationMembershipAuthorityShape } from "./CollaborationAuthorization.ts";
import {
  authorizeCollaborationPermission,
  CollaborationMembershipAuthority,
} from "./CollaborationAuthorization.ts";
import type { CollaborationDeviceKeyAuthorityShape } from "./CollaborationEventAdmission.ts";
import type { CollaborationSandboxPathAuthorityShape } from "./CollaborationSandboxPathAuthority.ts";

const MANAGED_DIRECTORY = ".club-code-managed";
const SNAPSHOT_DIRECTORY = "sqlite-snapshots";
const STAGING_DIRECTORY = "staging";
const RECOVERY_DIRECTORY = "recovery";
const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "utf8");
const SQLITE_STORAGE_MAX_BYTES = 8 * 1024 * 1024 * 1024;
const SQLITE_STORAGE_ENTRY_MAX = 4_096;

type Operation = "capture" | "restore";

export type CollaborationSqliteManagedSnapshotFailureReason =
  | "invalid-request"
  | "not-authorized"
  | "device-key-unavailable"
  | "database-authority-unavailable"
  | "lease-invalid"
  | "head-conflict"
  | "unsupported-database"
  | "database-busy"
  | "database-corrupt"
  | "quota-exceeded"
  | "artifact-not-found"
  | "artifact-invalid"
  | "sidecar-active"
  | "unsafe-storage"
  | "authority-changed"
  | "quiescence-unavailable"
  | "cancelled"
  | "unavailable";

/** Public failures never include local paths, database contents, or SQLite messages. */
export class CollaborationSqliteManagedSnapshotError extends Data.TaggedError(
  "CollaborationSqliteManagedSnapshotError",
)<{
  readonly operation: Operation;
  readonly reason: CollaborationSqliteManagedSnapshotFailureReason;
}> {}

export interface CollaborationSqliteDatabaseAuthorityShape {
  /** Must resolve the current durable database binding, never a client snapshot. */
  readonly getCurrent: (input: {
    readonly principal: CollaborationPrincipal;
    readonly sharedProjectId: SharedProjectId;
    readonly databaseId: typeof CollaborationSqliteSnapshotCaptureRequest.Type.databaseId;
    readonly deviceKeyId: typeof CollaborationSqliteSnapshotCaptureRequest.Type.deviceKeyId;
  }) => Effect.Effect<unknown, unknown>;
}

export interface CollaborationSqliteReplicaQuiescenceAuthorityShape {
  /**
   * Blocks local database clients from opening or using this replica path for
   * the complete effect. A restore cannot infer this guarantee from file locks
   * alone, especially when a POSIX reader retains an unlinked inode.
   */
  readonly withExclusive: <A, E, R>(
    input: {
      readonly sharedProjectId: SharedProjectId;
      readonly databaseId: typeof CollaborationSqliteSnapshotCaptureRequest.Type.databaseId;
      readonly relativePath: SharedReplicaRelativePath;
    },
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | unknown, R>;
}

interface SnapshotInput {
  readonly principal: unknown;
  readonly request: unknown;
  readonly signal?: AbortSignal;
}

export interface CollaborationSqliteManagedSnapshotShape {
  readonly capture: (
    input: SnapshotInput,
  ) => Effect.Effect<SqliteSnapshotCaptureResult, CollaborationSqliteManagedSnapshotError>;
  readonly restore: (
    input: SnapshotInput,
  ) => Effect.Effect<SqliteSnapshotRestoreResult, CollaborationSqliteManagedSnapshotError>;
}

export interface CollaborationSqliteManagedSnapshotOptions {
  readonly replicaRoot: string;
  readonly membershipAuthority: CollaborationMembershipAuthorityShape;
  readonly deviceKeyAuthority: CollaborationDeviceKeyAuthorityShape;
  readonly databaseAuthority: CollaborationSqliteDatabaseAuthorityShape;
  readonly sandboxPathAuthority: CollaborationSandboxPathAuthorityShape;
  readonly quiescenceAuthority: CollaborationSqliteReplicaQuiescenceAuthorityShape;
  readonly snapshotMaxBytes?: number;
  /** Logical bytes retained per managed database, including recovery copies and staging. */
  readonly snapshotStorageMaxBytes?: number;
  readonly busyTimeoutMs?: number;
}

const decodeCapture = Schema.decodeUnknownEffect(CollaborationSqliteSnapshotCaptureRequest);
const decodeRestore = Schema.decodeUnknownEffect(CollaborationSqliteSnapshotRestoreRequest);
const decodeBinding = Schema.decodeUnknownEffect(CollaborationDatabaseBindingSchema);
const decodeArtifact = Schema.decodeUnknownSync(CollaborationSqliteSnapshotArtifact);
const decodeCaptureResult = Schema.decodeUnknownSync(CollaborationSqliteSnapshotCaptureResult);
const decodeRestoreResult = Schema.decodeUnknownSync(CollaborationSqliteSnapshotRestoreResult);
const encodeBinding = Schema.encodeUnknownSync(CollaborationDatabaseBindingSchema);

function fail(operation: Operation, reason: CollaborationSqliteManagedSnapshotFailureReason) {
  return new CollaborationSqliteManagedSnapshotError({ operation, reason });
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot))
  );
}

interface RootIdentity {
  readonly configuredPath: string;
  readonly canonicalPath: string;
  readonly dev: bigint;
  readonly ino: bigint;
}

async function makeRootIdentity(path: string): Promise<RootIdentity> {
  const configuredPath = resolve(path);
  await mkdir(configuredPath, { recursive: true, mode: 0o700 });
  const configured = await lstat(configuredPath, { bigint: true });
  if (!configured.isDirectory() || configured.isSymbolicLink()) throw new Error("unsafe root");
  const canonicalPath = await realpath(configuredPath);
  const canonical = await lstat(canonicalPath, { bigint: true });
  if (!canonical.isDirectory() || canonical.isSymbolicLink()) throw new Error("unsafe root");
  return {
    configuredPath,
    canonicalPath,
    dev: canonical.dev,
    ino: canonical.ino,
  };
}

async function assertRootIdentity(root: RootIdentity): Promise<void> {
  const configured = await lstat(root.configuredPath, { bigint: true });
  const canonicalPath = await realpath(root.configuredPath);
  const canonical = await lstat(canonicalPath, { bigint: true });
  if (
    !configured.isDirectory() ||
    configured.isSymbolicLink() ||
    canonicalPath !== root.canonicalPath ||
    !canonical.isDirectory() ||
    canonical.isSymbolicLink() ||
    canonical.dev !== root.dev ||
    canonical.ino !== root.ino
  )
    throw new Error("root changed");
}

async function exactEntry(parent: string, segment: string): Promise<Dirent | null> {
  const folded = segment.toLowerCase();
  const matches = (await readdir(parent, { withFileTypes: true })).filter(
    (entry) => entry.name.toLowerCase() === folded,
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1 || matches[0]!.name !== segment) throw new Error("case alias");
  return matches[0]!;
}

async function ensureDirectory(root: RootIdentity, segments: ReadonlyArray<string>) {
  await assertRootIdentity(root);
  let cursor = root.canonicalPath;
  for (const segment of segments) {
    const child = resolve(cursor, segment);
    if (!isContained(root.canonicalPath, child)) throw new Error("outside root");
    const existing = await exactEntry(cursor, segment);
    if (existing === null) {
      try {
        await mkdir(child, { mode: 0o700 });
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

async function boundedDirectoryBytes(root: string, limit: number): Promise<number> {
  const pending = [root];
  let entries = 0;
  let bytes = 0;
  while (pending.length > 0) {
    const directory = pending.pop()!;
    const directoryStats = await lstat(directory, { bigint: true });
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink())
      throw new Error("unsafe storage");
    const canonicalDirectory = await realpath(directory);
    if (!isContained(root, canonicalDirectory)) throw new Error("unsafe storage");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      entries += 1;
      if (entries > SQLITE_STORAGE_ENTRY_MAX) throw new Error("storage entry quota");
      const path = resolve(directory, entry.name);
      if (!isContained(root, path) || entry.isSymbolicLink()) throw new Error("unsafe storage");
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) throw new Error("unsafe storage");
      const stats = await lstat(path, { bigint: true });
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("unsafe storage");
      const size = Number(stats.size);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("unsafe storage");
      bytes += size;
      if (!Number.isSafeInteger(bytes) || bytes > limit) throw new Error("storage byte quota");
    }
  }
  return bytes;
}

interface SafeTarget {
  readonly path: string;
  readonly exists: boolean;
  readonly dev: bigint | null;
  readonly ino: bigint | null;
}

async function inspectReplicaTarget(
  root: RootIdentity,
  relativePath: SharedReplicaRelativePath,
): Promise<SafeTarget> {
  await assertRootIdentity(root);
  const segments = relativePath.split("/");
  let cursor = root.canonicalPath;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const child = resolve(cursor, segment);
    if (!isContained(root.canonicalPath, child)) throw new Error("outside root");
    const entry = await exactEntry(cursor, segment);
    const leaf = index === segments.length - 1;
    if (entry === null) {
      if (!leaf) throw new Error("missing ancestor");
      return { path: child, exists: false, dev: null, ino: null };
    }
    const stats = await lstat(child, { bigint: true });
    if (leaf) {
      if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n)
        throw new Error("unsafe leaf");
      const canonical = await realpath(child);
      if (!isContained(root.canonicalPath, canonical)) throw new Error("outside root");
      return { path: child, exists: true, dev: stats.dev, ino: stats.ino };
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("unsafe ancestor");
    const canonical = await realpath(child);
    if (!isContained(root.canonicalPath, canonical)) throw new Error("outside root");
    cursor = child;
  }
  throw new Error("invalid target");
}

async function assertSameTarget(target: SafeTarget): Promise<void> {
  if (!target.exists) {
    try {
      await lstat(target.path);
      throw new Error("target appeared");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return;
      throw error;
    }
  }
  const stats = await lstat(target.path, { bigint: true });
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.nlink !== 1n ||
    stats.dev !== target.dev ||
    stats.ino !== target.ino
  )
    throw new Error("target changed");
}

async function assertNoSqliteSidecars(targetPath: string): Promise<void> {
  const parent = resolve(targetPath, "..");
  const fileName = targetPath.slice(
    Math.max(targetPath.lastIndexOf("/"), targetPath.lastIndexOf("\\")) + 1,
  );
  const foldedFileName = fileName.toLowerCase();
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    const foldedEntryName = entry.name.toLowerCase();
    if (foldedEntryName === foldedFileName) continue;
    if (
      foldedEntryName.startsWith(`${foldedFileName}-`) ||
      foldedEntryName === `${foldedFileName}.wal`
    ) {
      if (isDatabaseSidecarPath(foldedEntryName)) throw new Error("active sidecar");
    }
  }
}

function sameTarget(left: SafeTarget, right: SafeTarget): boolean {
  return (
    left.path === right.path &&
    left.exists === right.exists &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function throwIfCancelled(
  operation: Operation,
  ...signals: ReadonlyArray<AbortSignal | undefined>
) {
  if (signals.some((signal) => signal?.aborted === true)) throw fail(operation, "cancelled");
}

async function safeOpenRead(path: string): Promise<FileHandle> {
  const handle = await open(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  const stats = await handle.stat({ bigint: true });
  if (!stats.isFile() || stats.nlink !== 1n) {
    await handle.close();
    throw new Error("unsafe file");
  }
  return handle;
}

async function hashFile(
  operation: Operation,
  path: string,
  maxBytes: number,
  ...signals: ReadonlyArray<AbortSignal | undefined>
) {
  const handle = await safeOpenRead(path);
  try {
    const digest = createHash("sha256");
    const header = Buffer.alloc(SQLITE_HEADER.byteLength);
    let offset = 0;
    let headerOffset = 0;
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    for (;;) {
      throwIfCancelled(operation, ...signals);
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, offset);
      if (bytesRead === 0) break;
      if (headerOffset < header.byteLength) {
        const copied = Math.min(bytesRead, header.byteLength - headerOffset);
        buffer.copy(header, headerOffset, 0, copied);
        headerOffset += copied;
      }
      offset += bytesRead;
      if (offset > maxBytes) throw fail(operation, "quota-exceeded");
      digest.update(buffer.subarray(0, bytesRead));
    }
    if (offset === 0 || headerOffset !== header.byteLength || !header.equals(SQLITE_HEADER))
      throw fail(operation, "unsupported-database");
    return { byteSize: offset, sha256: digest.digest("hex") };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function copyFileVerified(
  operation: Operation,
  source: string,
  destination: string,
  expected: { readonly byteSize: number; readonly sha256: string },
  ...signals: ReadonlyArray<AbortSignal | undefined>
) {
  const sourceHandle = await safeOpenRead(source);
  let destinationHandle: FileHandle | undefined;
  try {
    destinationHandle = await open(
      destination,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_WRONLY |
        (fsConstants.O_NOFOLLOW ?? 0),
      0o600,
    );
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let offset = 0;
    for (;;) {
      throwIfCancelled(operation, ...signals);
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.byteLength, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
      if (offset > expected.byteSize) throw fail(operation, "artifact-invalid");
      digest.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(
          buffer,
          written,
          bytesRead - written,
          offset - bytesRead + written,
        );
        if (result.bytesWritten < 1) throw new Error("short write");
        written += result.bytesWritten;
      }
    }
    if (offset !== expected.byteSize || digest.digest("hex") !== expected.sha256)
      throw fail(operation, "artifact-invalid");
    await destinationHandle.sync();
  } finally {
    await sourceHandle.close().catch(() => undefined);
    await destinationHandle?.close().catch(() => undefined);
  }
}

interface DatabaseInspection {
  readonly applicationId: number;
  readonly userVersion: number;
  readonly pageSize: number;
  readonly pageCount: number;
  readonly journalMode: "delete" | "truncate" | "persist" | "wal";
  readonly schemaSha256: string;
}

function scalarInteger(database: DatabaseSync, pragma: string): number {
  const row = database.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
  const value = row ? Object.values(row)[0] : undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("invalid pragma");
  return value as number;
}

function inspectOpenDatabase(database: DatabaseSync): DatabaseInspection {
  database.enableDefensive(true);
  database.exec("PRAGMA query_only = ON");
  const integrity = database.prepare("PRAGMA integrity_check(1)").get() as
    | Record<string, unknown>
    | undefined;
  if (!integrity || Object.values(integrity)[0] !== "ok") throw new Error("integrity failure");
  const journalRow = database.prepare("PRAGMA journal_mode").get() as
    | Record<string, unknown>
    | undefined;
  const journalMode = journalRow ? Object.values(journalRow)[0] : undefined;
  if (
    journalMode !== "delete" &&
    journalMode !== "truncate" &&
    journalMode !== "persist" &&
    journalMode !== "wal"
  )
    throw new Error("unsupported journal mode");
  const databases = database.prepare("PRAGMA database_list").all() as ReadonlyArray<
    Record<string, unknown>
  >;
  const mainDatabases = databases.filter((entry) => entry.name === "main" && entry.seq === 0);
  const unexpectedDatabases = databases.filter(
    (entry) =>
      !(entry.name === "main" && entry.seq === 0) && !(entry.name === "temp" && entry.file === ""),
  );
  if (mainDatabases.length !== 1 || unexpectedDatabases.length !== 0)
    throw new Error("attached database");
  const schemaRows = database
    .prepare(
      `SELECT type, name, tbl_name AS tableName, sql
       FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name, tbl_name, COALESCE(sql, '')`,
    )
    .all();
  const schemaSha256 = createHash("sha256")
    .update("club-code-sqlite-schema-v1")
    .update("\0")
    .update(JSON.stringify(schemaRows))
    .digest("hex");
  return {
    applicationId: scalarInteger(database, "application_id"),
    userVersion: scalarInteger(database, "user_version"),
    pageSize: scalarInteger(database, "page_size"),
    pageCount: scalarInteger(database, "page_count"),
    journalMode,
    schemaSha256,
  };
}

function inspectDatabase(path: string, busyTimeoutMs: number): DatabaseInspection {
  const database = new DatabaseSync(path, {
    readOnly: true,
    allowExtension: false,
    timeout: busyTimeoutMs,
  });
  try {
    return inspectOpenDatabase(database);
  } finally {
    database.close();
  }
}

function projectKey(sharedProjectId: string) {
  return createHash("sha256")
    .update("club-code-sqlite-project-v1")
    .update("\0")
    .update(sharedProjectId)
    .digest("hex")
    .slice(0, 32);
}

function databaseKey(databaseId: string) {
  return createHash("sha256")
    .update("club-code-sqlite-database-v1")
    .update("\0")
    .update(databaseId)
    .digest("hex")
    .slice(0, 32);
}

function sameLeaseAuthority(
  left: CollaborationDatabaseBinding,
  right: CollaborationDatabaseBinding,
): boolean {
  const leftEncoded = encodeBinding(left);
  const rightEncoded = encodeBinding(right);
  return (
    JSON.stringify({ ...leftEncoded, headSnapshot: null }) ===
    JSON.stringify({ ...rightEncoded, headSnapshot: null })
  );
}

function currentHead(binding: CollaborationDatabaseBinding) {
  return binding.headSnapshot?.contentSha256 ?? null;
}

function deviceKeyFingerprint(publicKeySpkiDer: Uint8Array): string {
  return createHash("sha256")
    .update("club-code-sqlite-device-key-v1")
    .update("\0")
    .update(publicKeySpkiDer)
    .digest("hex");
}

function verifyLease(
  operation: Operation,
  binding: CollaborationDatabaseBinding,
  request: typeof CollaborationSqliteSnapshotCaptureRequest.Type,
  principal: CollaborationPrincipal,
  nowMillis: number,
) {
  const lease = binding.activeLease;
  if (
    binding.sharedProjectId !== request.sharedProjectId ||
    binding.databaseId !== request.databaseId ||
    binding.engine !== "sqlite" ||
    binding.policy.kind !== "serialized-head" ||
    isDatabaseSidecarPath(binding.relativePath)
  )
    throw fail(operation, "unsupported-database");
  if (
    request.membershipEpoch !== principal.membershipEpoch ||
    lease === null ||
    lease.leaseId !== request.leaseId ||
    lease.holderUserId !== principal.userId ||
    lease.holderDeviceId !== principal.deviceId ||
    lease.membershipEpoch !== principal.membershipEpoch ||
    lease.fencingToken !== request.fencingToken ||
    binding.lastFencingToken !== request.fencingToken ||
    DateTime.toEpochMillis(lease.expiresAt) <= nowMillis
  )
    throw fail(operation, "lease-invalid");
}

function mapUnknown(operation: Operation, cause: unknown) {
  if (cause instanceof CollaborationSqliteManagedSnapshotError) return cause;
  const message = cause instanceof Error ? cause.message.toLowerCase() : "";
  if (message.includes("busy") || message.includes("locked"))
    return fail(operation, "database-busy");
  if (message.includes("integrity") || message.includes("malformed") || message.includes("corrupt"))
    return fail(operation, "database-corrupt");
  if (message.includes("unsupported") || message.includes("attached database"))
    return fail(operation, "unsupported-database");
  if (message.includes("active sidecar")) return fail(operation, "sidecar-active");
  if (message.includes("storage byte quota") || message.includes("storage entry quota"))
    return fail(operation, "quota-exceeded");
  if (
    [
      "unsafe root",
      "root changed",
      "outside root",
      "case alias",
      "unsafe directory",
      "unsafe ancestor",
      "unsafe leaf",
      "unsafe file",
      "missing ancestor",
      "target changed",
      "target appeared",
      "unsafe storage",
    ].includes(message)
  )
    return fail(operation, "unsafe-storage");
  return fail(operation, "unavailable");
}

class KeyedMutex {
  readonly #tails = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveRelease) => {
      release = resolveRelease;
    });
    const tail = previous.then(() => current);
    this.#tails.set(key, tail);
    await previous;
    return () => {
      release();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    };
  }

  async run<A>(key: string, effect: () => Promise<A>): Promise<A> {
    const release = await this.acquire(key);
    try {
      return await effect();
    } finally {
      release();
    }
  }
}

export function makeCollaborationSqliteManagedSnapshot(
  options: CollaborationSqliteManagedSnapshotOptions,
): Effect.Effect<CollaborationSqliteManagedSnapshotShape, CollaborationSqliteManagedSnapshotError> {
  const maxBytes = options.snapshotMaxBytes ?? COLLABORATION_SQLITE_SNAPSHOT_MAX_BYTES;
  const storageMaxBytes = options.snapshotStorageMaxBytes ?? SQLITE_STORAGE_MAX_BYTES;
  const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > COLLABORATION_SQLITE_SNAPSHOT_MAX_BYTES ||
    maxBytes > COLLABORATION_MATERIALIZED_FILE_MAX_BYTES ||
    !Number.isSafeInteger(storageMaxBytes) ||
    storageMaxBytes < maxBytes ||
    storageMaxBytes > SQLITE_STORAGE_MAX_BYTES ||
    !Number.isSafeInteger(busyTimeoutMs) ||
    busyTimeoutMs < 0 ||
    busyTimeoutMs > 60_000
  )
    return Effect.fail(fail("capture", "invalid-request"));

  return Effect.tryPromise({
    try: async () => {
      const replicaRoot = await makeRootIdentity(options.replicaRoot);
      const managedRootPath = await ensureDirectory(replicaRoot, [MANAGED_DIRECTORY]);
      const managedRoot = await makeRootIdentity(managedRootPath);
      await ensureDirectory(managedRoot, [SNAPSHOT_DIRECTORY]);
      const mutex = new KeyedMutex();
      let lastAuthorityTimeMillis = Number.NEGATIVE_INFINITY;

      const authorize = (
        operation: Operation,
        permission: "file.publish" | "file.apply",
        principalInput: unknown,
        request: typeof CollaborationSqliteSnapshotCaptureRequest.Type,
      ) =>
        Effect.gen(function* () {
          const grant = yield* authorizeCollaborationPermission({
            principal: principalInput,
            targetProjectId: request.sharedProjectId,
            permission,
          }).pipe(
            Effect.provideService(CollaborationMembershipAuthority, options.membershipAuthority),
            Effect.mapError(() => fail(operation, "not-authorized")),
          );
          const key = yield* options.deviceKeyAuthority
            .getActiveEd25519PublicKey({
              sharedProjectId: request.sharedProjectId,
              userId: grant.principal.userId,
              deviceId: grant.principal.deviceId,
              deviceKeyId: request.deviceKeyId,
              membershipEpoch: grant.principal.membershipEpoch,
            })
            .pipe(Effect.mapError(() => fail(operation, "device-key-unavailable")));
          if (
            key === null ||
            key.sharedProjectId !== request.sharedProjectId ||
            key.userId !== grant.principal.userId ||
            key.deviceId !== grant.principal.deviceId ||
            key.deviceKeyId !== request.deviceKeyId ||
            key.membershipEpoch !== grant.principal.membershipEpoch ||
            !(key.publicKeySpkiDer instanceof Uint8Array) ||
            key.publicKeySpkiDer.byteLength !== 44
          )
            return yield* Effect.fail(fail(operation, "device-key-unavailable"));
          const binding = yield* options.databaseAuthority
            .getCurrent({
              principal: grant.principal,
              sharedProjectId: request.sharedProjectId,
              databaseId: request.databaseId,
              deviceKeyId: request.deviceKeyId,
            })
            .pipe(
              Effect.flatMap((value) => decodeBinding(value, { onExcessProperty: "error" })),
              Effect.mapError(() => fail(operation, "database-authority-unavailable")),
            );
          const now = yield* DateTime.now;
          yield* Effect.try({
            try: () => {
              const nowMillis = DateTime.toEpochMillis(now);
              if (nowMillis < lastAuthorityTimeMillis) throw fail(operation, "lease-invalid");
              lastAuthorityTimeMillis = nowMillis;
              verifyLease(operation, binding, request, grant.principal, nowMillis);
            },
            catch: (cause) => mapUnknown(operation, cause),
          });
          return {
            principal: grant.principal,
            binding,
            deviceKeySha256: deviceKeyFingerprint(new Uint8Array(key.publicKeySpkiDer)),
          };
        });

      const artifactDirectories = async (
        sharedProjectId: SharedProjectId,
        databaseId: typeof CollaborationSqliteSnapshotCaptureRequest.Type.databaseId,
      ) => {
        const project = projectKey(sharedProjectId);
        const database = databaseKey(databaseId);
        const bucket = await ensureDirectory(managedRoot, [SNAPSHOT_DIRECTORY, project, database]);
        const staging = await ensureDirectory(managedRoot, [
          SNAPSHOT_DIRECTORY,
          project,
          database,
          STAGING_DIRECTORY,
        ]);
        const recovery = await ensureDirectory(managedRoot, [
          SNAPSHOT_DIRECTORY,
          project,
          database,
          RECOVERY_DIRECTORY,
        ]);
        return { bucket, staging, recovery };
      };

      const capture: CollaborationSqliteManagedSnapshotShape["capture"] = (input) =>
        Effect.gen(function* () {
          const request = yield* decodeCapture(input.request, { onExcessProperty: "error" }).pipe(
            Effect.mapError(() => fail("capture", "invalid-request")),
          );
          const initial = yield* authorize("capture", "file.publish", input.principal, request);
          if (currentHead(initial.binding) !== request.expectedAuthorityHeadContentSha256)
            return yield* Effect.fail(fail("capture", "head-conflict"));
          yield* options.sandboxPathAuthority
            .assertContained(initial.binding.relativePath)
            .pipe(Effect.mapError(() => fail("capture", "unsafe-storage")));
          const now = yield* DateTime.now;
          const captured = yield* Effect.tryPromise({
            try: async (effectSignal) => {
              const mutexKey = `${request.sharedProjectId}\0${request.databaseId}`;
              return mutex.run(mutexKey, async () => {
                throwIfCancelled("capture", input.signal, effectSignal);
                const target = await inspectReplicaTarget(
                  replicaRoot,
                  initial.binding.relativePath,
                );
                if (!target.exists) throw fail("capture", "artifact-not-found");
                const pinned = await safeOpenRead(target.path);
                const directories = await artifactDirectories(
                  request.sharedProjectId,
                  request.databaseId,
                );
                const tempPath = resolve(
                  directories.staging,
                  `backup-${randomBytes(16).toString("hex")}.sqlite`,
                );
                let source: DatabaseSync | undefined;
                try {
                  await hashFile("capture", target.path, maxBytes, input.signal, effectSignal);
                  source = new DatabaseSync(target.path, {
                    readOnly: true,
                    allowExtension: false,
                    timeout: busyTimeoutMs,
                  });
                  const sourceInspection = inspectOpenDatabase(source);
                  const pinnedStats = await pinned.stat({ bigint: true });
                  const currentStats = await lstat(target.path, { bigint: true });
                  if (
                    pinnedStats.dev !== currentStats.dev ||
                    pinnedStats.ino !== currentStats.ino ||
                    currentStats.dev !== target.dev ||
                    currentStats.ino !== target.ino
                  )
                    throw new Error("target changed");
                  await backup(source, tempPath, {
                    source: "main",
                    target: "main",
                    rate: 256,
                    progress: () => throwIfCancelled("capture", input.signal, effectSignal),
                  });
                  source.close();
                  source = undefined;
                  await assertSameTarget(target);
                  const observed = await hashFile(
                    "capture",
                    tempPath,
                    maxBytes,
                    input.signal,
                    effectSignal,
                  );
                  const snapshotInspection = inspectDatabase(tempPath, busyTimeoutMs);
                  if (
                    snapshotInspection.applicationId !== sourceInspection.applicationId ||
                    snapshotInspection.userVersion !== sourceInspection.userVersion ||
                    snapshotInspection.schemaSha256 !== sourceInspection.schemaSha256 ||
                    snapshotInspection.pageSize !== sourceInspection.pageSize ||
                    snapshotInspection.pageCount * snapshotInspection.pageSize !== observed.byteSize
                  )
                    throw fail("capture", "database-corrupt");
                  const artifactPath = resolve(directories.bucket, `${observed.sha256}.sqlite`);
                  if (!isContained(directories.bucket, artifactPath))
                    throw new Error("outside root");
                  try {
                    const retainedBytes = await boundedDirectoryBytes(
                      directories.bucket,
                      storageMaxBytes,
                    );
                    if (retainedBytes + observed.byteSize > storageMaxBytes)
                      throw fail("capture", "quota-exceeded");
                    await link(tempPath, artifactPath);
                  } catch (error) {
                    if (!isNodeError(error, "EEXIST")) throw error;
                    const existing = await hashFile("capture", artifactPath, maxBytes);
                    if (
                      existing.byteSize !== observed.byteSize ||
                      existing.sha256 !== observed.sha256
                    )
                      throw fail("capture", "artifact-invalid");
                  }
                  await unlink(tempPath);
                  return {
                    observed,
                    inspection: snapshotInspection,
                    sourceJournalMode: sourceInspection.journalMode,
                  };
                } catch (cause) {
                  source?.close();
                  await unlink(tempPath).catch(() => undefined);
                  throw cause;
                } finally {
                  await pinned.close().catch(() => undefined);
                }
              });
            },
            catch: (cause) => mapUnknown("capture", cause),
          });
          const finalAuthority = yield* authorize(
            "capture",
            "file.publish",
            input.principal,
            request,
          ).pipe(Effect.mapError(() => fail("capture", "authority-changed")));
          if (
            !sameLeaseAuthority(initial.binding, finalAuthority.binding) ||
            initial.deviceKeySha256 !== finalAuthority.deviceKeySha256
          )
            return yield* Effect.fail(fail("capture", "authority-changed"));
          const finalHead = currentHead(finalAuthority.binding);
          const snapshot = {
            sharedProjectId: request.sharedProjectId,
            databaseId: request.databaseId,
            relativePath: initial.binding.relativePath,
            engine: "sqlite" as const,
            contentSha256: captured.observed.sha256,
            baseContentSha256: request.expectedAuthorityHeadContentSha256,
            schemaSha256: captured.inspection.schemaSha256,
            byteSize: captured.observed.byteSize,
            consistency: "online-backup" as const,
            sidecarsExcluded: true as const,
            createdByUserId: initial.principal.userId,
            createdByDeviceId: initial.principal.deviceId,
            createdAt: DateTime.formatIso(now),
          };
          const artifact = decodeArtifact(
            {
              snapshot,
              artifactStorage: "managed-content-addressed",
              sqliteFormat: "sqlite-format-3",
              applicationId: captured.inspection.applicationId,
              userVersion: captured.inspection.userVersion,
              pageSize: captured.inspection.pageSize,
              pageCount: captured.inspection.pageCount,
              sourceJournalMode: captured.sourceJournalMode,
              integrityCheck: "ok",
              attachedDatabaseCount: 0,
              sidecarsCopied: false,
            },
            { onExcessProperty: "error" },
          );
          return decodeCaptureResult(
            {
              artifact,
              disposition:
                finalHead === request.expectedAuthorityHeadContentSha256
                  ? "head-candidate"
                  : "conflict-fork",
              observedAuthorityHeadContentSha256: finalHead,
            },
            { onExcessProperty: "error" },
          );
        });

      const restore: CollaborationSqliteManagedSnapshotShape["restore"] = (input) =>
        Effect.gen(function* () {
          const request = yield* decodeRestore(input.request, { onExcessProperty: "error" }).pipe(
            Effect.mapError(() => fail("restore", "invalid-request")),
          );
          const initial = yield* authorize("restore", "file.apply", input.principal, request);
          const initialHead = currentHead(initial.binding);
          if (initialHead !== request.expectedAuthorityHeadContentSha256)
            return decodeRestoreResult({
              status: "conflict",
              sharedProjectId: request.sharedProjectId,
              databaseId: request.databaseId,
              selectedContentSha256: request.artifact.snapshot.contentSha256,
              reason: "authority-head-changed",
              observedAuthorityHeadContentSha256: initialHead,
              observedReplicaContentSha256: null,
              forkRetained: true,
            });
          if (
            request.sourceDisposition === "canonical-head" &&
            request.artifact.snapshot.contentSha256 !== initialHead
          )
            return decodeRestoreResult({
              status: "conflict",
              sharedProjectId: request.sharedProjectId,
              databaseId: request.databaseId,
              selectedContentSha256: request.artifact.snapshot.contentSha256,
              reason: "selected-snapshot-not-head",
              observedAuthorityHeadContentSha256: initialHead,
              observedReplicaContentSha256: null,
              forkRetained: true,
            });
          if (
            request.artifact.snapshot.relativePath !== initial.binding.relativePath ||
            request.artifact.snapshot.engine !== "sqlite"
          )
            return yield* Effect.fail(fail("restore", "artifact-invalid"));
          const directories = yield* Effect.tryPromise({
            try: () => artifactDirectories(request.sharedProjectId, request.databaseId),
            catch: (cause) => mapUnknown("restore", cause),
          });
          const artifactPath = resolve(
            directories.bucket,
            `${request.artifact.snapshot.contentSha256}.sqlite`,
          );
          const mutexKey = `${request.sharedProjectId}\0${request.databaseId}`;
          const result = yield* options.quiescenceAuthority
            .withExclusive(
              {
                sharedProjectId: request.sharedProjectId,
                databaseId: request.databaseId,
                relativePath: initial.binding.relativePath,
              },
              Effect.acquireUseRelease(
                Effect.tryPromise({
                  try: () => mutex.acquire(mutexKey),
                  catch: (cause) => mapUnknown("restore", cause),
                }),
                () =>
                  Effect.gen(function* () {
                    const artifactState = yield* Effect.tryPromise({
                      try: async (effectSignal) => {
                        throwIfCancelled("restore", input.signal, effectSignal);
                        const observedArtifact = await hashFile(
                          "restore",
                          artifactPath,
                          maxBytes,
                          input.signal,
                          effectSignal,
                        ).catch((error) => {
                          if (isNodeError(error, "ENOENT"))
                            throw fail("restore", "artifact-not-found");
                          throw error;
                        });
                        if (
                          observedArtifact.byteSize !== request.artifact.snapshot.byteSize ||
                          observedArtifact.sha256 !== request.artifact.snapshot.contentSha256
                        )
                          throw fail("restore", "artifact-invalid");
                        const artifactInspection = inspectDatabase(artifactPath, busyTimeoutMs);
                        if (
                          artifactInspection.applicationId !== request.artifact.applicationId ||
                          artifactInspection.userVersion !== request.artifact.userVersion ||
                          artifactInspection.pageSize !== request.artifact.pageSize ||
                          artifactInspection.pageCount !== request.artifact.pageCount ||
                          artifactInspection.schemaSha256 !== request.artifact.snapshot.schemaSha256
                        )
                          throw fail("restore", "artifact-invalid");
                        return { observedArtifact, artifactInspection };
                      },
                      catch: (cause) => mapUnknown("restore", cause),
                    });
                    yield* options.sandboxPathAuthority
                      .assertContained(initial.binding.relativePath)
                      .pipe(Effect.mapError(() => fail("restore", "unsafe-storage")));
                    const replicaState = yield* Effect.tryPromise({
                      try: async (effectSignal) => {
                        throwIfCancelled("restore", input.signal, effectSignal);
                        const target = await inspectReplicaTarget(
                          replicaRoot,
                          initial.binding.relativePath,
                        );
                        await assertNoSqliteSidecars(target.path);
                        const observedReplica = target.exists
                          ? await hashFile(
                              "restore",
                              target.path,
                              maxBytes,
                              input.signal,
                              effectSignal,
                            )
                          : null;
                        return { target, observedReplica };
                      },
                      catch: (cause) => mapUnknown("restore", cause),
                    });
                    if (
                      (replicaState.observedReplica?.sha256 ?? null) !==
                      request.expectedReplicaContentSha256
                    )
                      return decodeRestoreResult({
                        status: "conflict",
                        sharedProjectId: request.sharedProjectId,
                        databaseId: request.databaseId,
                        selectedContentSha256: request.artifact.snapshot.contentSha256,
                        reason: "replica-content-changed",
                        observedAuthorityHeadContentSha256: initialHead,
                        observedReplicaContentSha256: replicaState.observedReplica?.sha256 ?? null,
                        forkRetained: true,
                      });
                    const refreshed = yield* authorize(
                      "restore",
                      "file.apply",
                      input.principal,
                      request,
                    ).pipe(Effect.mapError(() => fail("restore", "authority-changed")));
                    if (
                      !sameLeaseAuthority(initial.binding, refreshed.binding) ||
                      currentHead(refreshed.binding) !== initialHead
                    )
                      return yield* Effect.fail(fail("restore", "authority-changed"));
                    yield* options.sandboxPathAuthority
                      .assertContained(initial.binding.relativePath)
                      .pipe(Effect.mapError(() => fail("restore", "unsafe-storage")));
                    const commit = yield* Effect.tryPromise({
                      try: async (effectSignal) => {
                        throwIfCancelled("restore", input.signal, effectSignal);
                        const { target, observedReplica } = replicaState;
                        const { observedArtifact, artifactInspection } = artifactState;
                        await assertSameTarget(target);
                        await assertNoSqliteSidecars(target.path);
                        const stagePath = resolve(
                          directories.staging,
                          `restore-${randomBytes(16).toString("hex")}.sqlite`,
                        );
                        const recoveryPath = resolve(
                          directories.recovery,
                          `recovery-${randomBytes(16).toString("hex")}.sqlite`,
                        );
                        let installed = false;
                        let recoveryMade = false;
                        const rollback = async () => {
                          if (installed) {
                            await unlink(target.path).catch(() => undefined);
                            if (recoveryMade) await rename(recoveryPath, target.path);
                            installed = false;
                            recoveryMade = false;
                          }
                        };
                        try {
                          const retainedBytes = await boundedDirectoryBytes(
                            directories.bucket,
                            storageMaxBytes,
                          );
                          const requiredBytes =
                            observedArtifact.byteSize + (observedReplica?.byteSize ?? 0);
                          if (retainedBytes + requiredBytes > storageMaxBytes)
                            throw fail("restore", "quota-exceeded");
                          await copyFileVerified(
                            "restore",
                            artifactPath,
                            stagePath,
                            observedArtifact,
                            input.signal,
                            effectSignal,
                          );
                          const refreshedTarget = await inspectReplicaTarget(
                            replicaRoot,
                            initial.binding.relativePath,
                          );
                          if (!sameTarget(target, refreshedTarget))
                            throw new Error("target changed");
                          await assertRootIdentity(replicaRoot);
                          await assertNoSqliteSidecars(refreshedTarget.path);
                          if (refreshedTarget.exists) {
                            await link(refreshedTarget.path, recoveryPath);
                            recoveryMade = true;
                          }
                          await rename(stagePath, refreshedTarget.path);
                          installed = true;
                          const installedInspection = inspectDatabase(target.path, busyTimeoutMs);
                          const installedHash = await hashFile("restore", target.path, maxBytes);
                          if (
                            installedHash.sha256 !== observedArtifact.sha256 ||
                            installedHash.byteSize !== observedArtifact.byteSize ||
                            installedInspection.schemaSha256 !== artifactInspection.schemaSha256 ||
                            installedInspection.applicationId !== artifactInspection.applicationId
                          )
                            throw fail("restore", "artifact-invalid");
                          return {
                            result: decodeRestoreResult({
                              status: "restored",
                              sharedProjectId: request.sharedProjectId,
                              databaseId: request.databaseId,
                              contentSha256: observedArtifact.sha256,
                              replacedContentSha256: observedReplica?.sha256 ?? null,
                              recoveryRetained: recoveryMade,
                              sidecarsRestored: false,
                            }),
                            rollback,
                          };
                        } catch (cause) {
                          await rollback();
                          if (!installed && recoveryMade)
                            await unlink(recoveryPath).catch(() => undefined);
                          throw cause;
                        } finally {
                          await unlink(stagePath).catch(() => undefined);
                        }
                      },
                      catch: (cause) => mapUnknown("restore", cause),
                    });
                    yield* authorize("restore", "file.apply", input.principal, request).pipe(
                      Effect.mapError(() => fail("restore", "authority-changed")),
                      Effect.flatMap((finalAuthority) =>
                        sameLeaseAuthority(initial.binding, finalAuthority.binding) &&
                        currentHead(finalAuthority.binding) === initialHead &&
                        initial.deviceKeySha256 === finalAuthority.deviceKeySha256
                          ? Effect.void
                          : Effect.fail(fail("restore", "authority-changed")),
                      ),
                      Effect.catch((error) =>
                        Effect.tryPromise({
                          try: commit.rollback,
                          catch: () => fail("restore", "unsafe-storage"),
                        }).pipe(Effect.andThen(Effect.fail(error))),
                      ),
                    );
                    return commit.result;
                  }),
                (release) => Effect.sync(release),
              ),
            )
            .pipe(
              Effect.mapError((error) =>
                error instanceof CollaborationSqliteManagedSnapshotError
                  ? error
                  : fail("restore", "quiescence-unavailable"),
              ),
            );
          return result;
        });

      return { capture, restore } satisfies CollaborationSqliteManagedSnapshotShape;
    },
    catch: (cause) => mapUnknown("capture", cause),
  });
}
