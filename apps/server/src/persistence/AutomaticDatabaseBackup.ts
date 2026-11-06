import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import * as path from "node:path";

import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { ServerConfig } from "../config.ts";
import { SqliteBackup } from "./NodeSqliteClient.ts";

export { verifySnapshot, restoreSnapshot } from "./StateBackup.ts";
import { createStateSnapshot } from "./StateBackup.ts";
export const AUTOMATIC_BACKUP_INTERVAL_MS = 3_600_000;
export const AUTOMATIC_BACKUP_RETENTION = 3;
const BACKUP_CHECK_INTERVAL = Duration.hours(1);
export const runAutomaticDatabaseBackup = createStateSnapshot;

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
        stateRoot: config.stateDir,
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

  yield* Effect.forkScoped(runCycle.pipe(Effect.repeat(Schedule.spaced(BACKUP_CHECK_INTERVAL))));
});

export const AutomaticDatabaseBackupLive = Layer.effectDiscard(startAutomaticDatabaseBackups);

// Exported for focused tests and recovery tools that already own a DatabaseSync connection.
export const backupDatabaseConnection = (
  database: DatabaseSync,
  destination: string,
): Promise<number> => sqliteBackup(database, destination, { rate: 4_096 });
