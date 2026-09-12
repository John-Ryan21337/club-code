// @effect-diagnostics nodeBuiltinImport:off
import { spawn } from "node:child_process";
import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { SQLITE_PREVIEW_PROGRAM } from "./sqlitePreviewProgram.ts";

export const SQLITE_PREVIEW_TIMEOUT_MS = 3000;
export const SQLITE_PREVIEW_FILE_BYTES = 32 * 1024 * 1024;
export const SQLITE_PREVIEW_WAL_BYTES = 16 * 1024 * 1024;
const RESULT_BYTES = 256 * 1024;
const SNAPSHOT_PREFIX = "cafe-sqlite-preview-";

export interface SqlitePreviewRequest {
  readonly operation: "tables" | "rows";
  readonly table?: string;
  readonly limit?: number;
}

function unavailable(): Error {
  return new Error("The database preview is unavailable or changed while reading.");
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

interface PinnedFile {
  readonly filename: string;
  readonly handle: FileHandle;
  readonly metadata: BigIntStats;
}

async function pinFile(
  filename: string,
  maximum: number,
  optional = false,
): Promise<PinnedFile | null> {
  let metadata: BigIntStats;
  try {
    metadata = await lstat(filename, { bigint: true });
  } catch (cause) {
    if (optional && (cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw unavailable();
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > BigInt(maximum))
    throw unavailable();
  // Match ordinary file previews: a concurrent replacement with a FIFO must
  // not block a libuv worker waiting for a writer. Absent on Windows.
  const handle = await open(
    filename,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
  );
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(metadata, opened)) throw unavailable();
    return { filename, handle, metadata };
  } catch {
    await handle.close();
    throw unavailable();
  }
}

async function copyPinned(
  file: PinnedFile,
  destination: string,
  signal?: AbortSignal,
): Promise<void> {
  const output = await open(destination, "wx", 0o600);
  try {
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    const size = Number(file.metadata.size);
    while (offset < size) {
      if (signal?.aborted) throw unavailable();
      const { bytesRead } = await file.handle.read(
        buffer,
        0,
        Math.min(buffer.length, size - offset),
        offset,
      );
      if (bytesRead === 0) throw unavailable();
      let written = 0;
      while (written < bytesRead) {
        const result = await output.write(buffer, written, bytesRead - written, offset + written);
        if (result.bytesWritten === 0) throw unavailable();
        written += result.bytesWritten;
      }
      offset += bytesRead;
    }
  } finally {
    await output.close();
  }
}

/** A child never launches other processes. A hard kill stops synchronous SQLite
 * work; settlement waits for close so its caller cannot release admission while
 * the old worker still owns native resources. Neither paths nor row data go in
 * argv, stderr, tracing or diagnostics. */
function querySnapshot(
  filename: string,
  request: SqlitePreviewRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  if (signal?.aborted) return Promise.reject(unavailable());
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=128", "--eval", SQLITE_PREVIEW_PROGRAM],
      {
        shell: false,
        windowsHide: true,
        cwd: dirname(filename),
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
          ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
        },
        stdio: ["pipe", "pipe", "ignore"],
      },
    );
    let invalid = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const stop = () => {
      invalid = true;
      child.kill("SIGKILL");
    };
    const timer = setTimeout(stop, SQLITE_PREVIEW_TIMEOUT_MS);
    signal?.addEventListener("abort", stop, { once: true });
    if (signal?.aborted) stop();
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
    };
    child.on("error", () => {
      invalid = true;
    });
    child.stdin.on("error", () => {
      invalid = true;
    });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > RESULT_BYTES) {
        stop();
        return;
      }
      chunks.push(chunk);
    });
    child.on("close", (code) => {
      cleanup();
      if (invalid || code !== 0 || bytes === 0) {
        reject(unavailable());
        return;
      }
      try {
        resolveResult(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))),
        );
      } catch {
        reject(unavailable());
      }
    });
    child.stdin.end(JSON.stringify({ ...request, filename }));
  });
}

/** Snapshot a small SQLite database and optional WAL through bounded pinned
 * descriptors. A changing database is refused. This is a convenience snapshot,
 * not SQLite's atomic backup protocol or a hostile-writer sandbox: portable
 * pathname traversal has the same documented race as the file observatory.
 * A hot rollback journal is refused rather than replayed into workspace files.
 */
export async function readSqlitePreview(
  filename: string,
  request: SqlitePreviewRequest,
  revalidatePath: () => Promise<void>,
  signal?: AbortSignal,
): Promise<unknown> {
  const files: PinnedFile[] = [];
  let snapshot: string | undefined;
  const root = resolve(tmpdir());
  const checkJournal = async () => {
    try {
      await lstat(`${filename}-journal`);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
      throw unavailable();
    }
    throw unavailable();
  };
  try {
    if (signal?.aborted) throw unavailable();
    await checkJournal();
    const database = await pinFile(filename, SQLITE_PREVIEW_FILE_BYTES);
    if (!database) throw unavailable();
    files.push(database);
    const header = Buffer.alloc(16);
    await database.handle.read(header, 0, 16, 0);
    if (header.toString("binary") !== "SQLite format 3\0") throw unavailable();
    const wal = await pinFile(`${filename}-wal`, SQLITE_PREVIEW_WAL_BYTES, true);
    if (wal) files.push(wal);
    snapshot = await mkdtemp(join(root, SNAPSHOT_PREFIX));
    const copy = join(snapshot, "preview.sqlite");
    await copyPinned(database, copy, signal);
    if (wal) await copyPinned(wal, `${copy}-wal`, signal);
    const verify = async () => {
      if (signal?.aborted) throw unavailable();
      await revalidatePath();
      await checkJournal();
      for (const file of files) {
        if (
          !sameFile(file.metadata, await file.handle.stat({ bigint: true })) ||
          !sameFile(file.metadata, await lstat(file.filename, { bigint: true }))
        )
          throw unavailable();
      }
      if (!wal) {
        try {
          await lstat(`${filename}-wal`);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code === "ENOENT") return;
          throw unavailable();
        }
        throw unavailable();
      }
    };
    await verify();
    const result = await querySnapshot(copy, request, signal);
    await verify();
    return result;
  } catch {
    throw unavailable();
  } finally {
    await Promise.allSettled(files.map((file) => file.handle.close()));
    // Delete only our resolved direct-child temp directory, after child close.
    if (
      snapshot &&
      dirname(resolve(snapshot)) === root &&
      basename(snapshot).startsWith(SNAPSHOT_PREFIX)
    ) {
      await rm(snapshot, { recursive: true, force: true });
    }
  }
}
