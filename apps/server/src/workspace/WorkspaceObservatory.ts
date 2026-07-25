// @effect-diagnostics nodeBuiltinImport:off
import { DatabaseSync } from "node:sqlite";
import { constants } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";

import {
  WORKSPACE_OBSERVATORY_LIMITS,
  type WorkspaceObservatoryActivityInput,
  type WorkspaceObservatoryActivityResult,
  type WorkspaceObservatoryDatabaseInput,
  type WorkspaceObservatoryDatabaseResult,
  type WorkspaceObservatoryFileInput,
  type WorkspaceObservatoryFileResult,
  type WorkspaceObservatoryRowsResult,
  type WorkspaceObservatoryTableInput,
  type WorkspaceObservatoryTableResult,
  type WorkspaceObservatoryTreeInput,
  type WorkspaceObservatoryTreeResult,
} from "@cafecode/contracts";

const SQLITE_EXTENSIONS = new Set([".db", ".sqlite", ".sqlite3"]);
const SQLITE_HEADER = Buffer.from("SQLite format 3\u0000");
const REDACTED_NAME =
  /(pass(word)?|secret|token|api.?key|credential|authori[sz]ation|cookie|session)/i;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TELEMETRY_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const OBSERVED_OPERATIONS = new Set([
  "create",
  "delete",
  "execute",
  "inspect",
  "query",
  "read",
  "rename",
  "search",
  "write",
]);
const OBSERVED_STATUSES = new Set([
  "blocked",
  "completed",
  "failed",
  "idle",
  "observed",
  "running",
  "stalled",
]);
const IGNORED_DIRECTORIES = new Set([".git", ".turbo", "build", "dist", "node_modules"]);
const SENSITIVE_PATH_NAME =
  /(?:^|[._-])(auth|credentials?|private|secrets?|sessions?|tokens?)(?:[._-]|$)|^(?:id_(?:rsa|dsa|ecdsa|ed25519)|\.env(?:\..*)?)$|\.(?:key|p12|pfx|pem)$/i;
const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g;
const SECRET_ASSIGNMENT =
  /^(\s*(?:(?:const|let|var)\s+)?["']?[A-Za-z0-9_.-]*(?:pass(?:word)?|secret|token|api.?key|credential|authori[sz]ation|cookie|session)[A-Za-z0-9_.-]*["']?\s*[:=]\s*)(.+)$/gim;
const SECRET_VALUE =
  /^(?:bearer\s+\S+|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.)/i;
const KEY_COLUMN = /^(?:key|name|field|setting)$/i;
const VALUE_COLUMN = /^(?:content|data|payload|value)$/i;
const MAX_REGISTERED_WORKSPACE_ROOTS = 256;
const MAX_FILESYSTEM_PATH_LENGTH = 4_096;
const MAX_ADDITIONAL_ROOTS_JSON_BYTES = 64 * 1024;
const MAX_ACTIVITY_PAYLOAD_BYTES = 64 * 1024;
const MAX_ACTIVITY_CANDIDATES = 1_000;

export class WorkspaceObservatoryFailure extends Error {}

function fail(message: string): never {
  throw new WorkspaceObservatoryFailure(message);
}

function isContained(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot !== "" && !pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..";
}

function isSamePath(left: string, right: string): boolean {
  return relative(left, right) === "";
}

function pathSegments(path: string): string[] {
  return path.replaceAll("\\", "/").split("/").filter(Boolean);
}

function isSensitivePath(path: string): boolean {
  return pathSegments(path).some(
    (segment) => segment.startsWith(".") || SENSITIVE_PATH_NAME.test(segment),
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f);
  });
}

async function assertPathHasNoLinks(root: string, target: string): Promise<void> {
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot === ".." || fromRoot.startsWith(`..${sep}`))
    fail("Workspace path must stay within the project root.");
  let cursor = root;
  for (const segment of fromRoot.split(sep)) {
    cursor = resolve(cursor, segment);
    const metadata = await lstat(cursor).catch(() => fail("Workspace item is unavailable."));
    if (metadata.isSymbolicLink())
      fail("Workspace links and reparse-point aliases are not displayed.");
  }
}

async function resolveWorkspaceTarget(
  cwd: string,
  relativePath: string,
): Promise<{ root: string; target: string }> {
  if (!relativePath || relativePath.includes("\u0000"))
    fail("A relative workspace path is required.");
  const root = await realpath(cwd).catch(() => fail("Workspace root is unavailable."));
  const candidate = resolve(root, relativePath);
  if (!isContained(root, candidate)) fail("Workspace path must stay within the project root.");
  if (isSensitivePath(relativePath)) fail("Sensitive or hidden workspace items are not displayed.");
  await assertPathHasNoLinks(root, candidate);
  const target = await realpath(candidate).catch(() => fail("Workspace item is unavailable."));
  if (!isContained(root, target)) fail("Workspace symlink resolves outside the project root.");
  return { root, target };
}

async function isSqliteFile(target: string): Promise<boolean> {
  if (!SQLITE_EXTENSIONS.has(extname(target).toLowerCase())) return false;
  const metadata = await lstat(target).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) return false;
  const handle = await open(target, "r").catch(() => null);
  if (!handle) return false;
  try {
    const buffer = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead === SQLITE_HEADER.length && buffer.equals(SQLITE_HEADER);
  } finally {
    await handle.close();
  }
}

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) fail("Invalid database identifier.");
  return `"${value}"`;
}

function truncateUtf8(value: string, maximumBytes: number): { value: string; truncated: boolean } {
  const encoded = Buffer.from(value);
  if (encoded.length <= maximumBytes) return { value, truncated: false };
  let end = maximumBytes;
  while (end > 0 && (encoded[end]! & 0xc0) === 0x80) end -= 1;
  return { value: encoded.subarray(0, end).toString("utf8"), truncated: true };
}

function redactText(value: string): { value: string; redacted: boolean } {
  let redacted = false;
  let source = value;
  let structuredJson = false;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && containsCredentialField(parsed)) {
      source = JSON.stringify(redactJson(parsed), null, 2);
      redacted = true;
      structuredJson = true;
    }
  } catch {
    // Non-JSON source is handled by the line-oriented redactors below.
  }
  const withoutPrivateKeys = source.replace(PRIVATE_KEY_BLOCK, () => {
    redacted = true;
    return "[redacted private key]";
  });
  const output = structuredJson
    ? withoutPrivateKeys
    : withoutPrivateKeys.replace(SECRET_ASSIGNMENT, (_match, prefix: string) => {
        redacted = true;
        return `${prefix}[redacted]`;
      });
  return { value: output, redacted };
}

function stringCell(
  value: unknown,
  name: string,
  forceRedaction = false,
): { value: string; redacted: boolean; identitySafe: boolean } {
  if (
    forceRedaction ||
    REDACTED_NAME.test(name) ||
    (typeof value === "string" && SECRET_VALUE.test(value))
  )
    return { value: "[redacted]", redacted: true, identitySafe: false };
  if (value === null || value === undefined)
    return { value: "null", redacted: false, identitySafe: false };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array)
    return { value: "[binary omitted]", redacted: false, identitySafe: false };
  let displayed: string;
  if (typeof value === "object") {
    displayed = JSON.stringify(redactJson(value));
  } else {
    displayed = String(value);
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object") displayed = JSON.stringify(redactJson(parsed));
      } catch {
        // Plain text is displayed as plain text; it is never interpreted as activity metadata.
      }
    }
  }
  const bounded = truncateUtf8(displayed, WORKSPACE_OBSERVATORY_LIMITS.databaseCellBytes - 3);
  return {
    value: bounded.truncated ? `${bounded.value}…` : displayed,
    redacted: containsCredentialField(value),
    identitySafe: !bounded.truncated && !containsCredentialField(value),
  };
}

function containsCredentialField(value: unknown): boolean {
  if (typeof value === "string") {
    try {
      return containsCredentialField(JSON.parse(value));
    } catch {
      return false;
    }
  }
  if (Array.isArray(value)) return value.some(containsCredentialField);
  return Boolean(
    value &&
    typeof value === "object" &&
    Object.entries(value).some(
      ([key, child]) => REDACTED_NAME.test(key) || containsCredentialField(child),
    ),
  );
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        REDACTED_NAME.test(key) ? "[redacted]" : redactJson(child),
      ]),
    );
  }
  return value;
}

/**
 * A deliberately small, read-only adapter. It accepts only project-relative
 * paths and fixed metadata queries; callers can never supply SQL.
 */
export class WorkspaceObservatory {
  private readonly stateDbPath: string;
  private readonly defaultWorkspaceRoot: string;

  constructor(stateDbPath: string, defaultWorkspaceRoot: string) {
    this.stateDbPath = stateDbPath;
    this.defaultWorkspaceRoot = defaultWorkspaceRoot;
  }

  private async assertWorkspaceAllowed(cwd: string): Promise<void> {
    const requested = await realpath(cwd).catch(() => fail("Workspace root is unavailable."));
    const roots = new Set<string>();
    const configured = await realpath(this.defaultWorkspaceRoot).catch(() => null);
    if (configured) roots.add(configured);
    let registeredRootCount = 0;
    const addRegisteredRoot = async (candidate: unknown): Promise<void> => {
      if (
        registeredRootCount >= MAX_REGISTERED_WORKSPACE_ROOTS ||
        typeof candidate !== "string" ||
        candidate.length > MAX_FILESYSTEM_PATH_LENGTH
      )
        return;
      const resolved = await realpath(candidate).catch(() => null);
      if (resolved && ![...roots].some((root) => isSamePath(root, resolved))) {
        roots.add(resolved);
        registeredRootCount += 1;
      }
    };
    if (await isSqliteFile(this.stateDbPath)) {
      let database: DatabaseSync | undefined;
      try {
        database = new DatabaseSync(this.stateDbPath, { readOnly: true, allowExtension: false });
        const projectsTable = database
          .prepare(
            "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'projection_projects'",
          )
          .get() as { present: number } | undefined;
        if (projectsTable) {
          const projectColumns = new Set(
            (
              database.prepare("PRAGMA table_info(projection_projects)").all() as Array<{
                name: string;
              }>
            ).map((column) => column.name),
          );
          const hasAdditionalRoots = projectColumns.has("additional_workspace_roots_json");
          const projects = projectColumns.has("workspace_root")
            ? (database
                .prepare(
                  `SELECT substr(workspace_root, 1, ${MAX_FILESYSTEM_PATH_LENGTH}) AS workspace_root${
                    hasAdditionalRoots
                      ? `, substr(additional_workspace_roots_json, 1, ${MAX_ADDITIONAL_ROOTS_JSON_BYTES}) AS additional_workspace_roots_json`
                      : ""
                  } FROM projection_projects${
                    projectColumns.has("deleted_at") ? " WHERE deleted_at IS NULL" : ""
                  } LIMIT 200`,
                )
                .all() as Array<{
                workspace_root: string;
                additional_workspace_roots_json?: string;
              }>)
            : [];
          const threadsTable = database
            .prepare(
              "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'projection_threads'",
            )
            .get() as { present: number } | undefined;
          const threadColumns = threadsTable
            ? new Set(
                (
                  database.prepare("PRAGMA table_info(projection_threads)").all() as Array<{
                    name: string;
                  }>
                ).map((column) => column.name),
              )
            : new Set<string>();
          const worktrees = threadColumns.has("worktree_path")
            ? (database
                .prepare(
                  `SELECT substr(worktree_path, 1, ${MAX_FILESYSTEM_PATH_LENGTH}) AS worktree_path FROM projection_threads WHERE worktree_path IS NOT NULL${
                    threadColumns.has("deleted_at") ? " AND deleted_at IS NULL" : ""
                  } LIMIT 200`,
                )
                .all() as Array<{ worktree_path: string }>)
            : [];
          for (const candidate of [
            ...projects.map((project) => project.workspace_root),
            ...worktrees.map((thread) => thread.worktree_path),
          ]) {
            await addRegisteredRoot(candidate);
          }
          for (const project of projects) {
            if (registeredRootCount >= MAX_REGISTERED_WORKSPACE_ROOTS) break;
            if (!project.additional_workspace_roots_json) continue;
            try {
              const additional = JSON.parse(project.additional_workspace_roots_json) as unknown;
              if (!Array.isArray(additional)) continue;
              for (const candidate of additional
                .filter((item): item is string => typeof item === "string")
                .slice(0, 32)) {
                await addRegisteredRoot(candidate);
              }
            } catch {
              /* malformed historical roots are ignored */
            }
          }
        }
      } catch {
        // Historical or partially migrated state must not block the configured
        // workspace. Registered project roots are additive, never authoritative.
      } finally {
        database?.close();
      }
    }
    if (![...roots].some((root) => isSamePath(root, requested)))
      fail("Workspace is not part of this connected environment.");
  }

  async tree(input: WorkspaceObservatoryTreeInput): Promise<WorkspaceObservatoryTreeResult> {
    await this.assertWorkspaceAllowed(input.cwd);
    const relativePath = input.relativePath ?? ".";
    const root = await realpath(input.cwd).catch(() => fail("Workspace root is unavailable."));
    const target =
      relativePath === "." ? root : (await resolveWorkspaceTarget(input.cwd, relativePath)).target;
    if (!(await stat(target)).isDirectory()) fail("Workspace tree target is not a directory.");
    const directoryHandle = await opendir(target);
    const entries = [];
    let capped = false;
    try {
      for await (const entry of directoryHandle) {
        if (entries.length >= WORKSPACE_OBSERVATORY_LIMITS.treeEntries) {
          capped = true;
          break;
        }
        entries.push(entry);
      }
    } finally {
      await directoryHandle.close().catch(() => undefined);
    }
    const visible: Array<WorkspaceObservatoryTreeResult["entries"][number]> = [];
    let redacted = false;
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      if (isSensitivePath(entry.name)) {
        redacted = true;
        continue;
      }
      const candidate = resolve(target, entry.name);
      const link = await lstat(candidate).catch(() => null);
      if (!link || link.isSymbolicLink()) continue;
      const resolved = await realpath(candidate).catch(() => null);
      if (!resolved || !isContained(root, resolved)) continue;
      const targetStat = await stat(resolved).catch(() => null);
      if (!targetStat || (!targetStat.isDirectory() && !targetStat.isFile())) continue;
      const entryRelativePath = relative(root, resolved).replaceAll("\\", "/");
      if (entryRelativePath.length > 512) {
        capped = true;
        continue;
      }
      visible.push({
        name: entry.name,
        relativePath: entryRelativePath,
        kind: targetStat.isDirectory() ? "directory" : "file",
      });
    }
    return {
      relativePath: relativePath === "." ? "" : relativePath,
      entries: visible,
      truncated: capped,
      redacted,
    };
  }

  async readFile(input: WorkspaceObservatoryFileInput): Promise<WorkspaceObservatoryFileResult> {
    await this.assertWorkspaceAllowed(input.cwd);
    const { root, target } = await resolveWorkspaceTarget(input.cwd, input.relativePath);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)).catch(() =>
      fail("Workspace item cannot be opened safely."),
    );
    try {
      const opened = await handle.stat();
      if (!opened.isFile()) fail("Workspace item is not a regular file.");
      const revalidated = await realpath(target).catch(() =>
        fail("Workspace item is unavailable."),
      );
      if (!isContained(root, revalidated)) fail("Workspace item moved outside the project root.");
      const current = await stat(revalidated);
      if (opened.dev !== current.dev || opened.ino !== current.ino)
        fail("Workspace item changed while it was being opened.");
      const maximumReadBytes = WORKSPACE_OBSERVATORY_LIMITS.textBytes + 4;
      const bytes = Buffer.alloc(Math.min(opened.size, maximumReadBytes));
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const contentBytes = bytes.subarray(0, bytesRead);
      if (contentBytes.includes(0)) fail("Binary files cannot be displayed.");
      const content = new TextDecoder("utf-8", { fatal: true }).decode(contentBytes, {
        stream: opened.size > bytesRead,
      });
      const redaction = redactText(content);
      const bounded = truncateUtf8(redaction.value, WORKSPACE_OBSERVATORY_LIMITS.textBytes);
      return {
        relativePath: relative(root, target).replaceAll("\\", "/"),
        content: bounded.value,
        truncated: opened.size > bytesRead || bounded.truncated,
        redacted: redaction.redacted,
      };
    } finally {
      await handle.close();
    }
  }

  async databases(
    input: WorkspaceObservatoryTreeInput,
  ): Promise<WorkspaceObservatoryDatabaseResult[]> {
    await this.assertWorkspaceAllowed(input.cwd);
    const result: WorkspaceObservatoryDatabaseResult[] = [];
    if (await isSqliteFile(this.stateDbPath))
      result.push({ database: "cafe-code-state", label: "Cafe Code state" });
    const pendingDirectories = [input.relativePath ?? "."];
    let visitedEntries = 0;
    while (
      pendingDirectories.length > 0 &&
      visitedEntries < WORKSPACE_OBSERVATORY_LIMITS.treeEntries
    ) {
      const relativePath = pendingDirectories.shift();
      if (!relativePath) break;
      const tree = await this.tree({ cwd: input.cwd, relativePath });
      for (const entry of tree.entries) {
        visitedEntries += 1;
        if (entry.kind === "directory" && !IGNORED_DIRECTORIES.has(entry.name)) {
          pendingDirectories.push(entry.relativePath);
        }
        if (
          entry.kind === "file" &&
          (await isSqliteFile((await resolveWorkspaceTarget(input.cwd, entry.relativePath)).target))
        ) {
          result.push({ database: entry.relativePath, label: entry.relativePath });
        }
        if (visitedEntries >= WORKSPACE_OBSERVATORY_LIMITS.treeEntries) break;
      }
    }
    return result;
  }

  private async databasePath(input: WorkspaceObservatoryDatabaseInput): Promise<string> {
    await this.assertWorkspaceAllowed(input.cwd);
    if (input.database === "cafe-code-state") {
      if (!(await isSqliteFile(this.stateDbPath))) fail("Cafe Code state database is unavailable.");
      return this.stateDbPath;
    }
    const target = (await resolveWorkspaceTarget(input.cwd, input.database)).target;
    if (!(await isSqliteFile(target))) fail("Database must be a verified SQLite file.");
    return target;
  }

  private async withDatabase<T>(
    input: WorkspaceObservatoryDatabaseInput,
    run: (database: DatabaseSync) => T,
  ): Promise<T> {
    const filename = await this.databasePath(input);
    let database: DatabaseSync | undefined;
    let pinnedFile: Awaited<ReturnType<typeof open>> | undefined;
    try {
      pinnedFile = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const pinnedStat = await pinnedFile.stat();
      const revalidate = async () => {
        const current =
          input.database === "cafe-code-state"
            ? await realpath(this.stateDbPath).catch(() =>
                fail("Cafe Code state database is unavailable."),
              )
            : (await resolveWorkspaceTarget(input.cwd, input.database)).target;
        if (!isSamePath(filename, current))
          fail("Database path changed while it was being opened.");
        const currentStat = await stat(current);
        if (
          !currentStat.isFile() ||
          pinnedStat.dev !== currentStat.dev ||
          pinnedStat.ino !== currentStat.ino
        )
          fail("Database file changed while it was being opened.");
      };
      await revalidate();
      database = new DatabaseSync(filename, {
        readOnly: true,
        allowExtension: false,
        enableForeignKeyConstraints: false,
      });
      await revalidate();
      database.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;");
      return run(database);
    } catch (error) {
      if (error instanceof WorkspaceObservatoryFailure) throw error;
      throw new WorkspaceObservatoryFailure("Unable to read the SQLite database.");
    } finally {
      try {
        database?.close();
      } finally {
        await pinnedFile?.close();
      }
    }
  }

  tables(input: WorkspaceObservatoryDatabaseInput): Promise<WorkspaceObservatoryTableResult[]> {
    return this.withDatabase(input, (database) =>
      database
        .prepare(
          "SELECT name, type FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 200",
        )
        .all()
        .filter(
          (entry): entry is WorkspaceObservatoryTableResult =>
            typeof entry.name === "string" && IDENTIFIER.test(entry.name) && entry.type === "table",
        ),
    );
  }

  rows(input: WorkspaceObservatoryTableInput): Promise<WorkspaceObservatoryRowsResult> {
    return this.withDatabase(input, (database) => {
      const table = quoteIdentifier(input.table);
      const permitted = database
        .prepare("SELECT 1 AS present FROM sqlite_master WHERE name = ? AND type = 'table'")
        .get(input.table) as { present: number } | undefined;
      if (!permitted) fail("Database table is unavailable.");
      const schema = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
        pk: number;
      }>;
      const columns = schema
        .map((column) => column.name)
        .filter((name) => IDENTIFIER.test(name))
        .slice(0, WORKSPACE_OBSERVATORY_LIMITS.databaseColumns);
      if (columns.length === 0) fail("Database table is unavailable.");
      const primaryKeyColumns = schema
        .filter((column) => column.pk > 0)
        .toSorted((left, right) => left.pk - right.pk)
        .map((column) => column.name);
      const identityColumns =
        primaryKeyColumns.length > 0 &&
        primaryKeyColumns.every((column) => columns.includes(column))
          ? primaryKeyColumns.map((column) => columns.indexOf(column))
          : [];
      const selected = columns
        .map((column) => {
          const identifier = quoteIdentifier(column);
          const maximum = WORKSPACE_OBSERVATORY_LIMITS.databaseCellBytes;
          return `CASE WHEN typeof(${identifier}) = 'blob' THEN '[binary omitted]' WHEN length(CAST(${identifier} AS BLOB)) > ${maximum} THEN substr(CAST(${identifier} AS TEXT), 1, ${maximum}) ELSE ${identifier} END AS ${identifier}`;
        })
        .join(", ");
      const limit = Math.min(
        input.limit ?? WORKSPACE_OBSERVATORY_LIMITS.databaseRows,
        WORKSPACE_OBSERVATORY_LIMITS.databaseRows,
      );
      const rawRows = database
        .prepare(
          `SELECT ${selected} FROM ${table}${
            identityColumns.length > 0
              ? ` ORDER BY ${primaryKeyColumns.map(quoteIdentifier).join(", ")}`
              : ""
          } LIMIT ?`,
        )
        .iterate(limit + 1) as IterableIterator<Record<string, unknown>>;
      let byteCount = 0;
      let redacted = false;
      let truncated = false;
      let displayedIdentitySafe = true;
      const rows: string[][] = [];
      for (const rawRow of rawRows) {
        if (rows.length >= limit) {
          truncated = true;
          break;
        }
        const keyNamesCredential = Object.entries(rawRow).some(
          ([column, value]) =>
            KEY_COLUMN.test(column) && typeof value === "string" && REDACTED_NAME.test(value),
        );
        const row = columns.map((column, columnIndex) => {
          const cell = stringCell(
            rawRow[column],
            column,
            keyNamesCredential && VALUE_COLUMN.test(column),
          );
          redacted ||= cell.redacted;
          if (identityColumns.includes(columnIndex)) displayedIdentitySafe &&= cell.identitySafe;
          return cell.value;
        });
        const rowBytes = Buffer.byteLength(JSON.stringify(row));
        if (byteCount + rowBytes > WORKSPACE_OBSERVATORY_LIMITS.databaseBytes) {
          truncated = true;
          break;
        }
        byteCount += rowBytes;
        rows.push(row);
      }
      return {
        columns,
        identityColumns: displayedIdentitySafe ? identityColumns : [],
        rows,
        truncated,
        redacted,
      };
    });
  }

  async activity(
    input: WorkspaceObservatoryActivityInput,
  ): Promise<WorkspaceObservatoryActivityResult> {
    // Attribution is intentionally opt-in: only provider payloads with this exact
    // observed object are shown. Command text and inferred paths are never treated as truth.
    const dbInput: WorkspaceObservatoryDatabaseInput = {
      cwd: input.cwd,
      database: "cafe-code-state",
    };
    const workspaceRoot = await realpath(input.cwd).catch(() =>
      fail("Workspace root is unavailable."),
    );
    return this.withDatabase(dbInput, (database) => {
      const exists = database
        .prepare(
          "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'projection_thread_activities'",
        )
        .get() as { present: number } | undefined;
      if (!exists) return { observations: [] };
      const columns = new Set(
        (
          database.prepare("PRAGMA table_info(projection_thread_activities)").all() as Array<{
            name: string;
          }>
        ).map((column) => column.name),
      );
      if (!["thread_id", "created_at", "payload_json"].every((column) => columns.has(column)))
        return { observations: [] };
      const records = database
        .prepare(
          `WITH recent AS (
             SELECT thread_id, created_at, payload_json
             FROM projection_thread_activities
             ORDER BY created_at DESC
             LIMIT ${MAX_ACTIVITY_CANDIDATES}
           )
           SELECT
             thread_id,
             created_at,
             json_extract(payload_json, '$.observed.agentId') AS agent_id,
             json_extract(payload_json, '$.observed.threadId') AS observed_thread_id,
             json_extract(payload_json, '$.observed.operation') AS operation,
             json_extract(payload_json, '$.observed.path') AS path,
             json_extract(payload_json, '$.observed.status') AS status
           FROM recent
           WHERE typeof(payload_json) = 'text'
             AND length(payload_json) <= ${MAX_ACTIVITY_PAYLOAD_BYTES}
             AND json_valid(payload_json)
             AND json_extract(payload_json, '$.observed.providerObserved') = 1
             AND json_type(payload_json, '$.observed.agentId') = 'text'
             AND json_type(payload_json, '$.observed.operation') = 'text'
             AND json_type(payload_json, '$.observed.path') = 'text'
             AND (? IS NULL OR json_extract(payload_json, '$.observed.agentId') = ?)
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(
          input.agentId ?? null,
          input.agentId ?? null,
          WORKSPACE_OBSERVATORY_LIMITS.observations,
        ) as Array<{
        thread_id: string;
        created_at: string;
        agent_id: string;
        observed_thread_id: unknown;
        operation: string;
        path: string;
        status: unknown;
      }>;
      const observations = records.flatMap((record) => {
        const timestamp =
          typeof record.created_at === "string" ? record.created_at.trim().slice(0, 64) : "";
        if (
          typeof record.thread_id !== "string" ||
          !timestamp ||
          !TELEMETRY_IDENTIFIER.test(record.agent_id) ||
          !OBSERVED_OPERATIONS.has(record.operation)
        )
          return [];
        const candidate = isAbsolute(record.path)
          ? resolve(record.path)
          : resolve(workspaceRoot, record.path);
        if (!isContained(workspaceRoot, candidate)) return [];
        const observedPath = relative(workspaceRoot, candidate).replaceAll("\\", "/");
        if (
          !observedPath ||
          observedPath.length > 512 ||
          hasControlCharacter(observedPath) ||
          isSensitivePath(observedPath)
        )
          return [];
        const threadId =
          typeof record.observed_thread_id === "string" &&
          TELEMETRY_IDENTIFIER.test(record.observed_thread_id)
            ? record.observed_thread_id
            : record.thread_id;
        if (!TELEMETRY_IDENTIFIER.test(threadId)) return [];
        const status =
          typeof record.status === "string" && OBSERVED_STATUSES.has(record.status)
            ? record.status
            : "observed";
        return [
          {
            agentId: record.agent_id,
            threadId,
            operation: record.operation,
            path: observedPath,
            status,
            timestamp,
            attribution: "observed" as const,
          },
        ];
      });
      return { observations };
    }).catch((error) =>
      error instanceof WorkspaceObservatoryFailure ? Promise.reject(error) : { observations: [] },
    );
  }
}
