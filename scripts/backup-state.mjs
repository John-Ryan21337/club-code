import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";
import { assertReleasePath } from "../apps/desktop/scripts/release-path-policy.mjs";
import {
  restoreSnapshot,
  runAutomaticDatabaseBackup,
  verifySnapshot,
} from "../apps/server/src/persistence/AutomaticDatabaseBackup.ts";

const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backupRoot = path.join(releaseRoot, "backups");
const stateRoot = path.join(releaseRoot, ".club-runtime", "userdata");
assertReleasePath(releaseRoot, backupRoot);
assertReleasePath(releaseRoot, stateRoot);
const [command, name, ...extra] = process.argv.slice(2);
if (extra.length || !["backup", "verify", "restore"].includes(command ?? "")) {
  throw new Error(
    "Use: node scripts/backup-state.mjs backup | verify <snapshot> | restore <snapshot>",
  );
}

if (command === "backup") {
  if (name) throw new Error("The backup command does not accept a snapshot name.");
  const database = new DatabaseSync(path.join(stateRoot, "state.sqlite"), { readOnly: true });
  try {
    const result = await runAutomaticDatabaseBackup({
      backupRoot,
      stateRoot,
      backupTo: (destination) => backup(database, destination, { rate: 2_147_483_647 }),
    });
    console.log(JSON.stringify(result));
  } finally {
    database.close();
  }
} else {
  if (!name || !/^[a-zA-Z0-9_-]+$/u.test(name)) {
    throw new Error("Use one snapshot directory name from the release backups folder.");
  }
  const root = await fs.realpath(backupRoot);
  const snapshot = path.join(root, name);
  if ((await fs.lstat(snapshot)).isSymbolicLink()) {
    throw new Error("The snapshot must not be a link.");
  }
  await verifySnapshot(snapshot);
  if (command === "verify") {
    console.log("Backup verification passed.");
  } else {
    const recovery = path.join(releaseRoot, ".club-runtime", "recovery");
    assertReleasePath(releaseRoot, recovery);
    await fs.mkdir(recovery, { recursive: true });
    const actualRecovery = await fs.realpath(recovery);
    const relative = path.relative(await fs.realpath(releaseRoot), actualRecovery);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("The recovery folder must stay inside the release folder.");
    }
    const destination = await fs.mkdtemp(path.join(actualRecovery, "restore-"));
    await restoreSnapshot(snapshot, destination);
    console.log(`Verified state restored to ${destination}. Active state was not changed.`);
  }
}
