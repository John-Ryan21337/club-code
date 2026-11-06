import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const releaseRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const transient = new Set([
  "lockfile",
  "SingletonLock",
  "SingletonCookie",
  "SingletonSocket",
  "server-runtime.json",
  "provider-daemon.json",
  "provider-supervisor.json",
  "provider-daemon-token.bin",
]);
const generatedShadowEntries = new Set([
  "sessions",
  "archived_sessions",
  "ambient-suggestions",
  "sqlite",
  "shell_snapshots",
  "worktrees",
  "skills",
  "plugins",
  "cache",
  "computer-use",
  "logs",
  "pets",
  "rules",
  "vendor_imports",
  ".codex-global-state.json",
  ".codex-global-state.json.bak",
  ".personality_migration",
  "AGENTS.md",
  "config.toml",
  "history.jsonl",
  "installation_id",
  "managed_config.toml",
  "session_index.jsonl",
  "version.json",
]);
const archivableRoots = new Set([
  "cache",
  "caches",
  "launcher-logs",
  "restart-logs",
  "logs",
  "temp",
  "tmp",
]);

function isGeneratedShadowLink(relative) {
  const parts = relative.split(path.sep);
  return (
    parts[0] === "codex-homes" &&
    parts[1] &&
    ((parts.length === 3 && generatedShadowEntries.has(parts[2])) ||
      (parts.length === 5 && parts.slice(2).join("/") === "packages/standalone/current"))
  );
}

async function exists(file) {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function contains(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

async function assertRealDirectory(directory) {
  const info = await fs.lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    path.resolve(await fs.realpath(directory)) !== path.resolve(directory)
  ) {
    throw new Error("Migration requires real directories without redirected parent paths.");
  }
}

export async function assertStopped(source, root, platform = process.platform) {
  for (const name of ["server-runtime.json", "provider-daemon.json", "provider-supervisor.json"]) {
    const file = path.join(source, "userdata", name);
    if (!(await exists(file))) continue;
    const record = JSON.parse(await fs.readFile(file, "utf8"));
    if (!Number.isSafeInteger(record.pid) || record.pid <= 0) {
      throw new Error("A runtime record has an invalid process ID. Inspect it before migration.");
    }
    try {
      process.kill(record.pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") continue;
      throw error;
    }
    throw new Error(
      "Club Code is still running. Quit Club Code and its provider daemon before migration.",
    );
  }
  // Electron holds this file open on Windows. Do not skip a sharing violation.
  const lock = path.join(source, "userdata", "lockfile");
  if (await exists(lock)) {
    const handle = await fs.open(lock, "r");
    await handle.close();
  }
  if (platform === "win32") {
    const powershell = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "psmodulepath"),
    );
    const pending = execFileAsync(
      powershell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'electron|club.?code|cafe.?code' } | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
      ],
      { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true, env },
    );
    pending.child.stdin.end();
    const { stdout } = await pending;
    const records = stdout.trim() ? JSON.parse(stdout) : [];
    for (const record of Array.isArray(records) ? records : [records]) {
      const command = `${record.ExecutablePath || ""} ${record.CommandLine || ""}`.toLowerCase();
      if (command.includes(root.toLowerCase()) || command.includes(source.toLowerCase())) {
        throw new Error("Club Code still has an active process. Quit it before migration.");
      }
    }
  }
}

async function digest(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function inventory(source, relative = "", files = []) {
  const directory = path.join(source, relative);
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const next = path.join(relative, entry.name);
    // Only process-owned root files are transient. Preserve similarly named attachments.
    if (relative === "userdata" && transient.has(entry.name)) continue;
    const full = path.join(source, next);
    const stat = await fs.lstat(full);
    if (stat.isSymbolicLink() && isGeneratedShadowLink(next)) {
      // The provider rebuilds shared links. Never copy data through these links.
      const linkedTarget = await fs.readlink(full);
      const resolvedTarget = path.resolve(path.dirname(full), linkedTarget);
      const internalTarget = contains(source, resolvedTarget)
        ? path.relative(source, resolvedTarget)
        : null;
      files.push({ relative: next, omittedLink: true, target: linkedTarget, internalTarget });
      continue;
    }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(
        "Legacy state contains a link or special file. Migration stopped without changing the source.",
      );
    }
    files.push({
      relative: next,
      directory: stat.isDirectory(),
      size: stat.size,
      modified: stat.mtimeMs,
      mode: stat.mode,
    });
    if (stat.isDirectory()) await inventory(source, next, files);
  }
  return files;
}

export async function migrateReleaseState({
  source,
  root = releaseRoot,
  checkStopped = assertStopped,
  report = () => {},
}) {
  source = path.resolve(source);
  root = path.resolve(root);
  await assertRealDirectory(root);
  await assertRealDirectory(source);
  if (contains(source, root) || contains(root, source))
    throw new Error("Source and release directories must be separate.");
  const target = path.join(root, ".club-runtime");
  if (await exists(target)) await assertRealDirectory(target);
  else await fs.mkdir(target, { mode: 0o700 });
  const marker = path.join(target, "migration-in-progress.json");
  if (await exists(marker))
    throw new Error(
      "A previous migration is incomplete. Preserve its staging files and inspect them before retrying.",
    );
  if (await exists(path.join(target, "userdata")))
    throw new Error("Release user data already exists. Migration will not overwrite it.");
  if (!(await exists(path.join(source, "userdata", "state.sqlite"))))
    throw new Error("The source does not contain a Club Code database.");
  await checkStopped(source, root);
  const files = await inventory(source);
  const roots = files
    .filter((file) => !file.relative.includes(path.sep))
    .map((file) => file.relative);
  const archivedRoots = new Set();
  for (const name of roots) {
    if (await exists(path.join(target, name))) {
      if (archivableRoots.has(name)) {
        archivedRoots.add(name);
        continue;
      }
      throw new Error(
        "Release state conflicts with legacy state. Migration will not merge or overwrite it.",
      );
    }
  }
  const archiveParent = path.join(target, "legacy-state");
  if (archivedRoots.size && (await exists(archiveParent))) await assertRealDirectory(archiveParent);
  const handle = await fs.open(marker, "wx", 0o600);
  await handle.writeFile(
    JSON.stringify({ schemaVersion: 1, startedAt: new Date().toISOString() }),
    "utf8",
  );
  await handle.close();
  const stage = await fs.mkdtemp(path.join(target, "migration-staging-"));
  let copied = 0;
  let bytes = 0;
  for (const file of files) {
    if (file.omittedLink) continue;
    const from = path.join(source, file.relative);
    const to = path.join(stage, file.relative);
    if (file.directory) {
      await fs.mkdir(to, { mode: file.mode });
      continue;
    }
    await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
    await fs.chmod(to, file.mode);
    const after = await fs.lstat(from);
    if (
      after.isSymbolicLink() ||
      after.size !== file.size ||
      after.mtimeMs !== file.modified ||
      (await digest(from)) !== (await digest(to))
    ) {
      throw new Error(
        "Source data changed or a copied file did not verify. Staging data was preserved; the source is unchanged.",
      );
    }
    copied += 1;
    bytes += file.size;
    if (copied % 100 === 0 || file.size > 100_000_000) report({ files: copied, bytes });
  }
  await checkStopped(source, root);
  const finalInventory = await inventory(source);
  if (JSON.stringify(files) !== JSON.stringify(finalInventory))
    throw new Error("Source data changed during migration. Staging data was preserved.");
  let archive;
  if (archivedRoots.size) {
    await fs.mkdir(archiveParent, { recursive: true, mode: 0o700 });
    await assertRealDirectory(archiveParent);
    archive = await fs.mkdtemp(path.join(archiveParent, "migration-"));
  }
  // Keep the marker until every directory is published. Startup refuses incomplete migration.
  for (const name of roots.toSorted(
    (a, b) => Number(a === "userdata") - Number(b === "userdata"),
  )) {
    const destination = path.join(archivedRoots.has(name) ? archive : target, name);
    if (await exists(destination))
      throw new Error("Release state appeared during migration. Migration stopped.");
    await fs.rename(path.join(stage, name), destination);
  }
  for (const file of files.filter((entry) => entry.omittedLink && entry.internalTarget !== null)) {
    const destination = path.join(target, file.relative);
    const linkedTarget = path.join(target, file.internalTarget);
    // Resolve the new target before linking. It must remain inside the release.
    const actualTarget = await fs.realpath(linkedTarget);
    if (!contains(target, actualTarget))
      throw new Error("A migrated link target leaves the release directory.");
    const directory = (await fs.stat(actualTarget)).isDirectory();
    await fs.symlink(
      process.platform === "win32"
        ? actualTarget
        : path.relative(path.dirname(destination), actualTarget),
      destination,
      directory ? (process.platform === "win32" ? "junction" : "dir") : "file",
    );
  }
  const omittedLinks = files
    .filter((file) => file.omittedLink && file.internalTarget === null)
    .map((file) => file.relative);
  if (omittedLinks.length)
    await fs.writeFile(
      path.join(target, "migration-omitted-links.json"),
      JSON.stringify({
        schemaVersion: 1,
        reason: "Provider-generated links are rebuilt at startup; external data was not copied.",
        entries: omittedLinks,
      }),
      { flag: "wx", mode: 0o600 },
    );
  await fs.writeFile(
    path.join(target, "storage-ready.json"),
    JSON.stringify({
      schemaVersion: 1,
      migratedAt: new Date().toISOString(),
      files: copied,
      bytes,
      omittedLinks: omittedLinks.length,
      archivedRoots: [...archivedRoots],
    }),
    { flag: "wx", mode: 0o600 },
  );
  await fs.rmdir(stage);
  await fs.unlink(marker);
  return { files: copied, bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== "--source")) {
    console.error("Usage: node scripts/migrate-release-state.mjs [--source <legacy-home>]");
    process.exitCode = 1;
  } else {
    try {
      const result = await migrateReleaseState({
        source: args[1] || path.join(homedir(), ".cafe-code"),
        report: (value) => console.log(`Verified ${value.files} files (${value.bytes} bytes).`),
      });
      console.log(
        `Migration complete: ${result.files} files verified. Original data remains unchanged. Start Club Code from this release.`,
      );
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
