import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { ServerConfig } from "../config.ts";
import { SqliteBackup } from "./NodeSqliteClient.ts";

export const AUTOMATIC_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const AUTOMATIC_BACKUP_RETENTION = 7;
const BACKUP_CHECK_INTERVAL = Duration.hours(1);
const BACKUP_START_DELAY = Duration.minutes(1);
const BACKUP_NAME = /^club-code-state-\d{8}-\d{6}Z\.sqlite$/u;
const PARTIAL_BACKUP_NAME = /^club-code-state-\d{8}-\d{6}Z\.sqlite\.partial$/u;

export interface AutomaticDatabaseBackupResult {
  readonly status: "created" | "not-due";
  readonly path?: string;
  readonly pages?: number;
}

function backupFileName(now: Date): string {
  return `club-code-state-${now
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace("T", "-")
    .replace(/\.\d{3}Z$/u, "Z")}.sqlite`;
}

async function verifyBackup(file: string): Promise<void> {
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    const pageCount = database.prepare("PRAGMA page_count").get() as
      | Record<string, number>
      | undefined;
    const schemaCount = database.prepare("SELECT count(*) AS count FROM sqlite_schema").get() as
      | { count?: number }
      | undefined;
    if (
      !pageCount ||
      Object.values(pageCount)[0] === 0 ||
      !schemaCount ||
      schemaCount.count === 0
    ) {
      throw new Error("The database backup did not contain a readable schema.");
    }
  } finally {
    database.close();
  }
}

export async function runAutomaticDatabaseBackup(input: {
  readonly backupRoot: string;
  readonly now?: Date;
  readonly backupTo: (path: string) => Promise<number>;
  readonly intervalMs?: number;
  readonly retention?: number;
}): Promise<AutomaticDatabaseBackupResult> {
  const now = input.now ?? new Date();
  const intervalMs = input.intervalMs ?? AUTOMATIC_BACKUP_INTERVAL_MS;
  const retention = input.retention ?? AUTOMATIC_BACKUP_RETENTION;
  const backupRoot = path.resolve(input.backupRoot);

  const canonicalParent = await fs.realpath(path.dirname(backupRoot));
  await fs.mkdir(backupRoot, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  const canonicalRoot = await fs.realpath(backupRoot);
  const rootInfo = await fs.lstat(backupRoot);
  if (
    rootInfo.isSymbolicLink() ||
    !rootInfo.isDirectory() ||
    path.relative(canonicalParent, canonicalRoot) !== path.basename(backupRoot)
  ) {
    throw new Error("Club Code backup storage must not redirect outside its release folder.");
  }

  const entries = await fs.readdir(canonicalRoot, { withFileTypes: true });
  const completed: Array<{ readonly path: string; readonly modified: number }> = [];
  for (const entry of entries) {
    const file = path.join(canonicalRoot, entry.name);
    if (entry.isFile() && PARTIAL_BACKUP_NAME.test(entry.name)) {
      await fs.rm(file, { force: true });
      continue;
    }
    if (!entry.isFile() || !BACKUP_NAME.test(entry.name)) continue;
    const info = await fs.stat(file);
    completed.push({ path: file, modified: info.mtimeMs });
  }

  const newest = completed.toSorted((left, right) => right.modified - left.modified)[0];
  if (newest && now.getTime() - newest.modified < intervalMs) {
    return { status: "not-due" };
  }

  const finalPath = path.join(canonicalRoot, backupFileName(now));
  const partialPath = `${finalPath}.partial`;
  let pages = 0;
  try {
    pages = await input.backupTo(partialPath);
    await verifyBackup(partialPath);
    await fs.rename(partialPath, finalPath);
  } catch (error) {
    await fs.rm(partialPath, { force: true }).catch(() => undefined);
    throw error;
  }

  const retained = [...completed, { path: finalPath, modified: now.getTime() }].toSorted(
    (left, right) => right.modified - left.modified,
  );
  for (const stale of retained.slice(Math.max(1, retention))) {
    await fs.rm(stale.path, { force: true });
  }

  return { status: "created", path: finalPath, pages };
}

export function resolveBackupRoot(
  baseDir: string,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const configured = environment.CAFE_CODE_BACKUPS_DIR?.trim();
  const releaseRoot = environment.CAFE_CODE_RELEASE_ROOT?.trim();
  const inferredReleaseRoot =
    path.isAbsolute(baseDir) && path.basename(baseDir) === ".club-runtime"
      ? path.dirname(path.resolve(baseDir))
      : undefined;
  if (
    releaseRoot &&
    (!path.isAbsolute(releaseRoot) ||
      inferredReleaseRoot === undefined ||
      path.relative(path.resolve(releaseRoot), inferredReleaseRoot) !== "")
  ) {
    throw new Error("Club Code backup storage does not match the configured release folder.");
  }
  const root = releaseRoot ? path.resolve(releaseRoot) : inferredReleaseRoot;
  if (!root) {
    if (configured) {
      throw new Error("Club Code backup storage is not bound to a release folder.");
    }
    return null;
  }
  const expected = path.join(root, "backups");
  if (configured && (!path.isAbsolute(configured) || path.relative(expected, configured) !== "")) {
    throw new Error("Club Code backups must use the release folder's backups directory.");
  }
  return expected;
}

const startAutomaticDatabaseBackups = Effect.gen(function* () {
  const config = yield* ServerConfig;
  const backupRoot = yield* Effect.try({
    try: () => resolveBackupRoot(config.baseDir),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("automatic database backup disabled", { message: error.message }).pipe(
        Effect.as(null),
      ),
    ),
  );
  if (backupRoot === null) return;
  const backup = yield* SqliteBackup;
  const runCycle = Effect.tryPromise({
    try: () =>
      runAutomaticDatabaseBackup({
        backupRoot,
        backupTo: (destination) => Effect.runPromise(backup.backupTo(destination)),
      }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(
    Effect.tap((result) =>
      result.status === "created"
        ? Effect.logInfo("automatic database backup completed", {
            pages: result.pages,
            path: result.path,
          })
        : Effect.void,
    ),
    Effect.catch((error) =>
      Effect.logWarning("automatic database backup failed", { message: error.message }),
    ),
  );

  yield* Effect.forkScoped(
    Effect.sleep(BACKUP_START_DELAY).pipe(
      Effect.andThen(runCycle),
      Effect.repeat(Schedule.spaced(BACKUP_CHECK_INTERVAL)),
    ),
  );
});

export const AutomaticDatabaseBackupLive = Layer.effectDiscard(startAutomaticDatabaseBackups);

// Exported for focused tests and recovery tools that already own a DatabaseSync connection.
export const backupDatabaseConnection = (
  database: DatabaseSync,
  destination: string,
): Promise<number> => sqliteBackup(database, destination, { rate: 4_096 });
