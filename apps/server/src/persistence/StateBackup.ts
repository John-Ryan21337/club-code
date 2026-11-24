import * as fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createGzip, createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";

import { shouldShareCodexShadowEntryName } from "../provider/Drivers/CodexHomeLayout.ts";

const LEGACY = /^club-code-state-\d{8}-\d{6}Z\.sqlite$/u;
const SNAPSHOT = /^club-code-state-(\d{4}-\d{2}-\d{2})-[0-9a-f-]{36}$/u;
const OMIT = new Set([
  "cache",
  "caches",
  "code cache",
  "gpucache",
  "dawngraphitecache",
  "dawnwebgpucache",
  "logs",
  "worktrees",
  "temp",
  "crash-dumps",
  "shared dictionary",
  "videodecodestats",
  "network",
  "dips",
  "dips-wal",
  "sharedstorage",
  "sharedstorage-wal",
  "lockfile",
  "server-runtime.json",
  "provider-daemon.json",
  "provider-daemon-token.bin",
  "state.sqlite",
  "state.sqlite-wal",
  "state.sqlite-shm",
  "userdata",
]);
export interface SnapshotManifest {
  readonly version: 1;
  readonly day: string;
  readonly createdAt: string;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly blob: string;
    readonly sha256: string;
    readonly bytes: number;
  }>;
  readonly exclusions: string;
}
function safeRelative(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\\") &&
    !value.includes(":") &&
    value
      .split("/")
      .every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          !/[. ]$/u.test(part) &&
          !/[<>:"|?*]/u.test(part) &&
          [...part].every((character) => character.charCodeAt(0) >= 32) &&
          !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
      )
  );
}
async function directory(root: string): Promise<string> {
  const info = await fs.lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Backup storage must not redirect through a link.");
  return fs.realpath(root);
}
async function regular(file: string): Promise<void> {
  const info = await fs.lstat(file);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Backup files must be regular files.");
}
function digest(maxBytes = Number.MAX_SAFE_INTEGER) {
  const hash = createHash("sha256");
  let bytes = 0;
  const stream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      if (bytes > maxBytes) return callback(new Error("Backup size exceeds its manifest."));
      callback(null, chunk);
    },
  });
  return { stream, result: () => ({ sha256: hash.digest("hex"), bytes }) };
}
async function verifyDatabase(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const check = db.prepare("PRAGMA quick_check").all();
    if (
      check.length !== 1 ||
      Object.values(check[0]!)[0] !== "ok" ||
      Number(db.prepare("SELECT count(*) AS n FROM sqlite_schema").get()!.n) === 0
    )
      throw new Error("The database backup failed verification.");
  } finally {
    db.close();
  }
}
async function readSnapshot(
  snapshotPath: string,
  verifyPayloads: boolean,
): Promise<SnapshotManifest> {
  const root = await directory(snapshotPath);
  const manifestPath = path.join(root, "manifest.json");
  await regular(manifestPath);
  if ((await fs.stat(manifestPath)).size > 32 * 1024 * 1024)
    throw new Error("Backup manifest is too large.");
  const value: unknown = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const m = value as SnapshotManifest;
  if (
    !m ||
    m.version !== 1 ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(m.day) ||
    !Number.isFinite(Date.parse(m.createdAt)) ||
    !Array.isArray(m.files) ||
    !m.files.length ||
    m.files.length > 100_000
  )
    throw new Error("Invalid backup manifest.");
  const paths = new Set<string>();
  for (const file of m.files) {
    if (
      !file ||
      typeof file.path !== "string" ||
      !safeRelative(file.path) ||
      paths.has(file.path.toLowerCase()) ||
      !/^\d{6}\.gz$/u.test(file.blob) ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    )
      throw new Error("Invalid backup file entry.");
    paths.add(file.path.toLowerCase());
    const blob = path.join(root, file.blob);
    await regular(blob);
    if (!verifyPayloads) continue;
    const hash = createHash("sha256");
    let size = 0;
    const output = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        if (size > file.bytes)
          return callback(new Error("Backup size does not match its manifest."));
        hash.update(chunk);
        callback();
      },
    });
    await pipeline(createReadStream(blob), createGunzip(), output);
    if (size !== file.bytes || hash.digest("hex") !== file.sha256)
      throw new Error("Backup checksum does not match its manifest.");
  }
  if (!paths.has("state.sqlite")) throw new Error("Backup database is missing.");
  return m;
}
export const verifySnapshot = (snapshotPath: string): Promise<SnapshotManifest> =>
  readSnapshot(snapshotPath, true);

export async function restoreSnapshot(
  snapshotPath: string,
  destinationEmpty: string,
): Promise<void> {
  const manifest = await verifySnapshot(snapshotPath);
  const destination = await directory(destinationEmpty);
  if ((await fs.readdir(destination)).length) throw new Error("Restore destination must be empty.");
  for (const file of manifest.files) {
    const target = path.join(destination, ...file.path.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const hash = digest(file.bytes);
    await pipeline(
      createReadStream(path.join(snapshotPath, file.blob)),
      createGunzip(),
      hash.stream,
      createWriteStream(target, { flags: "wx", mode: 0o600 }),
    );
    const actual = hash.result();
    if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes)
      throw new Error("Backup changed during restore.");
  }
  await verifyDatabase(path.join(destination, "state.sqlite"));
}
async function collect(root: string, prefix = "", privateHome = false): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (
      privateHome &&
      prefix.split("/").filter(Boolean).length === 1 &&
      (shouldShareCodexShadowEntryName(entry.name) ||
        [
          ".sandbox",
          ".sandbox-bin",
          "packages",
          "bin",
          "tmp",
          ".tmp",
          "log",
          "mcp-oauth-locks",
          ".sqlite-maintenance.lock",
          "thread-writer-locks",
          "models_cache.json",
        ].includes(entry.name) ||
        /(?:-wal|-shm|-journal)$/u.test(entry.name))
    )
      continue;
    if (
      entry.name === "LOCK" ||
      entry.name.startsWith("Singleton") ||
      (prefix === "" && OMIT.has(entry.name.toLowerCase()))
    )
      continue;
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    if (!safeRelative(relative)) throw new Error("Unsupported application state filename.");
    if (entry.isSymbolicLink())
      throw new Error("Application state contains a link; backup stopped.");
    if (entry.isDirectory()) files.push(...(await collect(root, relative, privateHome)));
    else if (entry.isFile()) files.push(relative);
    else throw new Error("Application state contains an unsupported file.");
  }
  return files.toSorted();
}
let active = false;
export async function createStateSnapshot(input: {
  readonly backupRoot: string;
  readonly stateRoot?: string;
  readonly now?: Date;
  readonly backupTo: (destination: string) => Promise<number>;
  readonly intervalMs?: number;
}): Promise<{ status: "created" | "not-due"; path?: string; pages?: number }> {
  if (active) return { status: "not-due" };
  active = true;
  let staging: string | undefined;
  try {
    const root = path.resolve(input.backupRoot);
    const parent = await directory(path.dirname(root));
    await fs.mkdir(root, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    const canonicalRoot = await directory(root);
    if (path.relative(parent, canonicalRoot) !== path.basename(root))
      throw new Error("Backup storage must not redirect outside its release folder.");
    const now = input.now ?? new Date();
    const day =
      now.getFullYear() +
      "-" +
      String(now.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(now.getDate()).padStart(2, "0");
    const completed: Array<{ name: string; manifest: SnapshotManifest }> = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
      if (
        /^\.club-state-pending-[A-Za-z0-9]{6}$/u.test(entry.name) &&
        entry.isDirectory() &&
        !entry.isSymbolicLink()
      ) {
        const pending = path.resolve(root, entry.name);
        const ownerFile = path.join(pending, "owner.json");
        try {
          await regular(ownerFile);
          if ((await fs.stat(ownerFile)).size > 256) continue;
          const owner = JSON.parse(await fs.readFile(ownerFile, "utf8")) as {
            kind?: string;
            pid?: number;
          };
          if (
            owner.kind !== "club-code-state-backup-v1" ||
            !Number.isSafeInteger(owner.pid) ||
            owner.pid! <= 0
          )
            continue;
          let dead = false;
          try {
            process.kill(owner.pid!, 0);
          } catch (error) {
            dead = (error as NodeJS.ErrnoException).code === "ESRCH";
          }
          if (dead && path.dirname(pending) === root) {
            await directory(pending);
            await fs.rm(pending, { recursive: true });
          }
        } catch {
          /* Preserve staging whose ownership cannot be established. */
        }
        continue;
      }
      if (LEGACY.test(entry.name) && entry.isFile() && !entry.isSymbolicLink()) {
        const info = await fs.stat(path.join(root, entry.name));
        const date = new Date(info.mtimeMs);
        completed.push({
          name: entry.name,
          manifest: {
            version: 1,
            day:
              date.getFullYear() +
              "-" +
              String(date.getMonth() + 1).padStart(2, "0") +
              "-" +
              String(date.getDate()).padStart(2, "0"),
            createdAt: date.toISOString(),
            files: [],
            exclusions: "legacy database only",
          },
        });
        continue;
      }
      if (!SNAPSHOT.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) continue;
      const manifest = await readSnapshot(path.join(root, entry.name), false);
      if (SNAPSHOT.exec(entry.name)![1] !== manifest.day)
        throw new Error("Backup directory date does not match its manifest.");
      completed.push({ name: entry.name, manifest });
    }
    const today = completed
      .filter((x) => SNAPSHOT.test(x.name) && x.manifest.day === day)
      .toSorted((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt))[0];
    if (
      today &&
      now.getTime() - Date.parse(today.manifest.createdAt) < (input.intervalMs ?? 3_600_000)
    )
      return { status: "not-due" };
    staging = await fs.mkdtemp(path.join(root, ".club-state-pending-"));
    await fs.writeFile(
      path.join(staging, "owner.json"),
      JSON.stringify({ kind: "club-code-state-backup-v1", pid: process.pid }),
      { mode: 0o600, flag: "wx" },
    );
    const db = path.join(staging, "database.partial");
    const pages = await input.backupTo(db);
    await verifyDatabase(db);
    const stateRoot = input.stateRoot ? await directory(input.stateRoot) : undefined;
    const sources = stateRoot ? await collect(stateRoot) : [];
    if (sources.some((p) => p.startsWith("__club-private/")))
      throw new Error("Reserved backup path already exists in application state.");
    const privateRoot = stateRoot ? path.join(path.dirname(stateRoot), "codex-homes") : undefined;
    let privateSources: string[] = [];
    if (privateRoot) {
      const exists = await fs.lstat(privateRoot).then(
        () => true,
        (e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") return false;
          throw e;
        },
      );
      if (exists) {
        await directory(privateRoot);
        privateSources = await collect(privateRoot, "", true);
      }
    }
    const privatePrefix = "__club-private/codex-homes/";
    sources.push(...privateSources.map((p) => privatePrefix + p));
    const manifestFiles: Array<SnapshotManifest["files"][number]> = [];
    for (const [index, relative] of ["state.sqlite", ...sources].entries()) {
      let source =
        relative === "state.sqlite"
          ? db
          : relative.startsWith(privatePrefix)
            ? path.join(privateRoot!, relative.slice(privatePrefix.length))
            : path.join(stateRoot!, relative);
      let privateCopy: string | undefined;
      if (relative.startsWith(privatePrefix) && /\.(?:sqlite|sqlite3|db)$/u.test(relative)) {
        await regular(source);
        privateCopy = path.join(staging, "provider-database.partial");
        const providerDatabase = new DatabaseSync(source, { readOnly: true });
        try {
          await sqliteBackup(providerDatabase, privateCopy, { rate: 2_147_483_647 });
        } finally {
          providerDatabase.close();
        }
        await verifyDatabase(privateCopy);
        source = privateCopy;
      }
      await regular(source);
      const before = await fs.stat(source);
      const blob = String(index).padStart(6, "0") + ".gz";
      const hash = digest();
      await pipeline(
        createReadStream(source),
        hash.stream,
        createGzip(),
        createWriteStream(path.join(staging, blob), { flags: "wx", mode: 0o600 }),
      );
      const after = await fs.stat(source);
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ino !== after.ino
      )
        throw new Error("Application state changed during backup; retry on the next check.");
      manifestFiles.push({ path: relative, blob, ...hash.result() });
      if (privateCopy) await fs.rm(privateCopy);
    }
    await fs.rm(db);
    const manifest: SnapshotManifest = {
      version: 1,
      day,
      createdAt: now.toISOString(),
      files: manifestFiles,
      exclusions:
        "Projects, worktrees, caches, logs, temporary/runtime files, installed tools and external provider-owned files. SQLite is coherent; ancillary and browser files are individually checked, not a cross-store transaction.",
    };
    await fs.writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest), {
      mode: 0o600,
      flag: "wx",
    });
    await verifySnapshot(staging);
    const name = "club-code-state-" + day + "-" + randomUUID();
    const destination = path.join(root, name);
    await fs.rename(staging, destination);
    staging = undefined;
    completed.push({ name, manifest });
    const sorted = completed.toSorted((a, b) =>
      b.manifest.createdAt.localeCompare(a.manifest.createdAt),
    );
    const keepDays = new Set<string>();
    for (const item of sorted) {
      if (!keepDays.has(item.manifest.day) && keepDays.size < 3) {
        keepDays.add(item.manifest.day);
        continue;
      }
      const target = path.resolve(root, item.name);
      if (
        path.dirname(target) !== root ||
        !(SNAPSHOT.test(path.basename(target)) || LEGACY.test(path.basename(target)))
      )
        throw new Error("Unsafe backup cleanup path.");
      if (LEGACY.test(item.name)) {
        await regular(target);
        await fs.rm(target);
      } else {
        await directory(target);
        await fs.rm(target, { recursive: true });
      }
    }
    return { status: "created", path: destination, pages };
  } finally {
    try {
      if (staging) await fs.rm(staging, { recursive: true, force: true });
    } finally {
      active = false;
    }
  }
}
