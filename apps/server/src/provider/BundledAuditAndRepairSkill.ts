/**
 * BundledAuditAndRepairSkill — Cafe-managed `audit-and-repair` skill files.
 *
 * Cafe ships one cross-provider reviewer skill and installs it into the
 * provider configuration homes it already owns (`CLAUDE_CONFIG_DIR` for the
 * Claude Agent SDK, the shared `CODEX_HOME` for Codex). The installation is
 * deliberately narrow:
 *
 *   - It writes only `<provider home>/skills/audit-and-repair/`.
 *   - It claims that directory with an owner marker that records the exact
 *     SHA-256 digest of every file Cafe wrote.
 *   - It updates the directory only while every managed file still matches
 *     that marker and no extra file was added, so a user edit, an extra user
 *     file, or another tool's install (for example a Club Code-managed skill)
 *     is preserved untouched.
 *   - It never follows a symbolic link or Windows junction out of the
 *     configured provider home.
 *   - It writes within the provider home passed by the caller. That configured
 *     home can be the user's ordinary Claude or Codex configuration directory.
 *
 * Writes are atomic: content is built in an owned temporary sibling directory
 * and moved into place with `rename`, so a concurrent Cafe instance, a crash,
 * or a failed swap does not expose partially written files. An update has a
 * brief gap between moving the old directory and promoting the new one.
 *
 * @module provider/BundledAuditAndRepairSkill
 */
// @effect-diagnostics nodeBuiltinImport:off
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const AUDIT_AND_REPAIR_SKILL_NAME = "audit-and-repair";

export const AUDIT_AND_REPAIR_SKILL_MD = `---
name: audit-and-repair
description: Audit implementation work, repair every in-scope defect in the same reviewer context, and verify the repaired result. Use for authorized audit-and-fix passes, cross-agent code review, pre-merge hardening, failing or brittle test cleanup, or a second independent quality pass where handing findings to another fixer would waste recontextualization tokens.
---

# Audit and Repair

Keep diagnosis and repair in one context. Prefer a reviewer who did not create the files; once that reviewer understands a defect, make that reviewer implement and verify the fix instead of handing a prose report to another agent.

## Workflow

1. Read repository instructions and inspect the exact diff, nearby contracts, callers, tests, and working-tree state. Preserve unrelated user changes.
2. Establish the relevant validation baseline. Distinguish pre-existing failures from regressions without using that distinction to excuse an in-scope defect.
3. Audit for correctness, security, lifecycle cleanup, boundary cases, accessibility, performance, misleading UI or copy, and missing tests. Follow data across boundaries instead of reviewing one file in isolation.
4. Repair every in-scope finding immediately while its context is fresh. Add or strengthen regression tests for behavioral defects.
5. Run the focused format, typecheck, unit, integration, browser, native, or smoke checks appropriate to the changed surface. Continue auditing and repairing until they are clean.
6. Run repository-required broader gates before declaring completion.

Do not stop at a findings list when mutation is authorized. If the request is explicitly read-only, report findings without edits. Do not broaden authority, hide unresolved failures, weaken tests, or replace a real integration with a mock merely to make checks green.

## Second round

Start a second independent audit-and-repair round when tests still fail, a material risk remains, the first reviewer reports low confidence, or the implementation is only superficially functional. Use a different available model family when possible. Give it raw artifacts (scope, diff, files, and test output), not the first reviewer's conclusions. The second reviewer also owns every repair it finds through clean validation.

## Context economy

- Assign bounded, non-overlapping scopes.
- Keep one reviewer on diagnosis, repair, and focused validation.
- Share paths, diffs, failing commands, and exact errors instead of retelling project history.
- Record only durable decisions, unresolved risks, and validation evidence.
- Avoid repeating already-read files or long logs; extract only the lines needed to act.

Finish with the defects repaired, commands run and their outcomes, and any specific residual risk. "No findings" is acceptable only after evidence-backed inspection and validation.
`;

export const AUDIT_AND_REPAIR_OPENAI_YAML = `interface:
  display_name: "Audit and Repair"
  short_description: "Audit findings, repair them, and verify clean"
  default_prompt: "Use $audit-and-repair to inspect this work, fix every issue you find, and verify it clean."
`;

/**
 * Cafe's own owner marker. A directory that carries a different owner (for
 * example a Club Code-managed skill) or no marker at all is foreign content:
 * Cafe reports it as preserved and never adopts, rewrites, or deletes it.
 */
const MANAGED_MARKER_FILE_NAME = ".cafe-code-managed.json";
const MANAGED_MARKER_OWNER = "cafe-code";
const MANAGED_MARKER_VERSION = 1;
/**
 * Temporary and backup siblings Cafe creates inside the same `skills`
 * directory. Both are dot-prefixed with the owner name and carry a random
 * suffix, so cleanup stays bounded to paths this call created and a
 * concurrent installer can never collide with them.
 */
const OWNED_SIBLING_PREFIX = `.${AUDIT_AND_REPAIR_SKILL_NAME}.${MANAGED_MARKER_OWNER}-`;

interface ManagedMarker {
  readonly owner: typeof MANAGED_MARKER_OWNER;
  readonly version: typeof MANAGED_MARKER_VERSION;
  readonly files: Readonly<Record<string, string>>;
}

export type BundledSkillInstallResult =
  | "installed"
  | "updated"
  | "unchanged"
  | "preserved-user-owned";

const bundledFiles = {
  "SKILL.md": AUDIT_AND_REPAIR_SKILL_MD,
  "agents/openai.yaml": AUDIT_AND_REPAIR_OPENAI_YAML,
} as const;

/**
 * Managed state of `<provider home>/skills/audit-and-repair`:
 *   - `missing` — nothing is there, so Cafe may create it;
 *   - `current` — Cafe owns it and every file already matches this build;
 *   - `stale`   — Cafe owns it unmodified but the bundled content changed;
 *   - `foreign` — anything else, including user edits, extra files, another
 *     tool's marker, and symbolic links. Foreign content is never modified.
 */
type ManagedState = "missing" | "current" | "stale" | "foreign";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function makeMarker(): ManagedMarker {
  return {
    owner: MANAGED_MARKER_OWNER,
    version: MANAGED_MARKER_VERSION,
    files: Object.fromEntries(
      Object.entries(bundledFiles).map(([relativePath, contents]) => [
        relativePath,
        sha256(contents),
      ]),
    ),
  };
}

function decodeManagedMarker(value: string): ManagedMarker | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("owner" in parsed) ||
      parsed.owner !== MANAGED_MARKER_OWNER ||
      !("version" in parsed) ||
      parsed.version !== MANAGED_MARKER_VERSION ||
      !("files" in parsed) ||
      typeof parsed.files !== "object" ||
      parsed.files === null
    ) {
      return null;
    }

    const files = parsed.files as Record<string, unknown>;
    if (
      Object.keys(bundledFiles).some(
        (relativePath) =>
          typeof files[relativePath] !== "string" || !/^[0-9a-f]{64}$/.test(files[relativePath]),
      )
    ) {
      return null;
    }
    return parsed as ManagedMarker;
  } catch {
    return null;
  }
}

/**
 * Classify a path without following it. A symbolic link or Windows junction
 * reports `other`, never `directory`, so no caller can be redirected outside
 * the configured provider home.
 */
async function pathKind(path: string): Promise<"missing" | "directory" | "other"> {
  try {
    const info = await lstat(path);
    return info.isDirectory() && !info.isSymbolicLink() ? "directory" : "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function writeSkillDirectory(directory: string): Promise<void> {
  await mkdir(join(directory, "agents"), { recursive: true, mode: 0o700 });
  await Promise.all(
    Object.entries(bundledFiles).map(([relativePath, contents]) =>
      writeFile(join(directory, relativePath), contents, {
        encoding: "utf8",
        // `wx` fails instead of overwriting. The directory is a fresh
        // randomly named temporary, so an existing entry would mean something
        // unexpected shares the path and the swap must not proceed.
        flag: "wx",
        mode: 0o600,
      }),
    ),
  );
  await writeFile(
    join(directory, MANAGED_MARKER_FILE_NAME),
    `${JSON.stringify(makeMarker(), null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

/**
 * Confirm the directory still holds exactly the files the marker records.
 * Any extra entry, missing entry, replaced link, or edited byte makes the
 * directory user-owned from Cafe's point of view.
 */
async function isUnmodifiedManagedDirectory(
  directory: string,
  marker: ManagedMarker,
): Promise<boolean> {
  const agentsDirectory = join(directory, "agents");
  // Classify the subdirectory before reading it: `readdir` follows a symbolic
  // link, and a linked `agents` entry points at content outside the managed
  // tree that Cafe must not inspect or replace.
  if ((await pathKind(agentsDirectory)) !== "directory") return false;
  try {
    const [rootEntries, agentEntries] = await Promise.all([
      readdir(directory),
      readdir(agentsDirectory),
    ]);
    if (
      rootEntries.length !== 3 ||
      !rootEntries.includes("SKILL.md") ||
      !rootEntries.includes("agents") ||
      !rootEntries.includes(MANAGED_MARKER_FILE_NAME) ||
      agentEntries.length !== 1 ||
      agentEntries[0] !== "openai.yaml"
    ) {
      return false;
    }
  } catch {
    return false;
  }

  for (const relativePath of Object.keys(bundledFiles)) {
    try {
      const filePath = join(directory, relativePath);
      const info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 262_144) return false;
      if (sha256(await readFile(filePath, "utf8")) !== marker.files[relativePath]) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function readManagedState(skillDirectory: string): Promise<ManagedState> {
  const kind = await pathKind(skillDirectory);
  if (kind === "missing") return "missing";
  if (kind === "other") return "foreign";

  let marker: ManagedMarker | null = null;
  try {
    const markerInfo = await lstat(join(skillDirectory, MANAGED_MARKER_FILE_NAME));
    if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || markerInfo.size > 16_384) {
      return "foreign";
    }
    marker = decodeManagedMarker(
      await readFile(join(skillDirectory, MANAGED_MARKER_FILE_NAME), "utf8"),
    );
  } catch {
    // No readable Cafe marker: unmarked user content, or content managed by
    // another tool under its own marker. Both stay untouched.
    return "foreign";
  }
  if (marker === null || !(await isUnmodifiedManagedDirectory(skillDirectory, marker))) {
    return "foreign";
  }

  const currentMarker = makeMarker();
  const managedMarker = marker;
  return Object.entries(currentMarker.files).every(
    ([relativePath, digest]) => managedMarker.files[relativePath] === digest,
  )
    ? "current"
    : "stale";
}

/** Remove one path this call created. Cleanup failures never mask the result. */
async function removeOwnedSibling(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined);
}

/**
 * Error codes a `rename` onto the managed destination can report when another
 * writer created it first. POSIX reports `ENOTEMPTY` (or `EEXIST`) for a
 * non-empty destination directory; Windows reports `EPERM`, `EACCES`, or
 * `EEXIST` for a directory that already exists or is briefly locked.
 */
const SWAP_COLLISION_CODES: ReadonlySet<string> = new Set([
  "EACCES",
  "EBUSY",
  "EEXIST",
  "ENOTEMPTY",
  "EPERM",
]);

/**
 * Attempts before the installer stops racing another writer. Each attempt
 * re-reads the destination, so only a writer that keeps winning can consume
 * them all, and that writer owns a valid managed directory.
 */
const MAX_SWAP_ATTEMPTS = 3;

/**
 * Build the managed content in an owned temporary sibling and move it into
 * place. Returns `retry` when a concurrent writer changed the destination
 * between the state read and the swap.
 */
async function swapManagedSkillDirectory(input: {
  readonly skillsDirectory: string;
  readonly skillDirectory: string;
  readonly replaceExisting: boolean;
}): Promise<BundledSkillInstallResult | "retry"> {
  const temporaryDirectory = join(input.skillsDirectory, `${OWNED_SIBLING_PREFIX}${randomUUID()}`);
  await mkdir(temporaryDirectory, { mode: 0o700 });
  try {
    await writeSkillDirectory(temporaryDirectory);
    if (input.replaceExisting) {
      // Windows cannot rename onto an existing directory and POSIX refuses a
      // non-empty one, so move the old managed copy aside first.
      const backupDirectory = join(
        input.skillsDirectory,
        `${OWNED_SIBLING_PREFIX}backup-${randomUUID()}`,
      );
      try {
        await rename(input.skillDirectory, backupDirectory);
      } catch (error) {
        // Another installer already moved or replaced the directory.
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return "retry";
        throw error;
      }
      // The destination may have changed after the initial ownership check.
      // Recheck the directory we actually moved before replacing or deleting it.
      if ((await readManagedState(backupDirectory)) === "foreign") {
        await rename(backupDirectory, input.skillDirectory).catch(() => undefined);
        if ((await pathKind(backupDirectory)) !== "missing") {
          throw new Error(`Concurrent skill edits were preserved at ${backupDirectory}`);
        }
        return "preserved-user-owned";
      }
      try {
        await rename(temporaryDirectory, input.skillDirectory);
      } catch (error) {
        if (SWAP_COLLISION_CODES.has((error as NodeJS.ErrnoException).code ?? "")) {
          // Another installer filled the destination while this call held the
          // previous copy aside. That copy holds only content Cafe wrote and
          // verified unmodified, so discard it and read the truth again.
          if ((await readManagedState(backupDirectory)) === "foreign") {
            throw new Error(`Concurrent skill edits were preserved at ${backupDirectory}`);
          }
          await removeOwnedSibling(backupDirectory);
          return "retry";
        }
        // Put the previous managed copy back. If that also fails, the copy
        // stays as an owned backup sibling instead of being deleted, and the
        // original failure is reported.
        await rename(backupDirectory, input.skillDirectory).catch(() => undefined);
        throw error;
      }
      // The managed content is live. A blocked backup removal, for example an
      // open handle on Windows, must not be reported as a failed update.
      if ((await readManagedState(backupDirectory)) === "foreign") {
        throw new Error(`Concurrent skill edits were preserved at ${backupDirectory}`);
      }
      await removeOwnedSibling(backupDirectory);
      return "updated";
    }

    try {
      await rename(temporaryDirectory, input.skillDirectory);
      return "installed";
    } catch (error) {
      if (SWAP_COLLISION_CODES.has((error as NodeJS.ErrnoException).code ?? "")) return "retry";
      throw error;
    }
  } finally {
    // Bounded cleanup: only the uniquely named directory this call created.
    await removeOwnedSibling(temporaryDirectory);
  }
}

/**
 * Install or update Cafe Code's bundled `audit-and-repair` skill inside one
 * provider configuration home, for example `CLAUDE_CONFIG_DIR` or the shared
 * `CODEX_HOME`.
 *
 * The caller passes an already resolved provider home that Cafe manages. This
 * function creates at most `<home>/skills/audit-and-repair` plus its own
 * temporary siblings, and reports the outcome instead of throwing for the
 * ordinary "the destination is not ours" result.
 */
export async function installBundledAuditAndRepairSkill(
  agentConfigHomePath: string,
): Promise<BundledSkillInstallResult> {
  const skillsDirectory = join(agentConfigHomePath, "skills");
  const skillDirectory = join(skillsDirectory, AUDIT_AND_REPAIR_SKILL_NAME);
  const skillsDirectoryKind = await pathKind(skillsDirectory);
  if (skillsDirectoryKind === "other") {
    // `skills` is user-owned when it is a file, a symbolic link, or a Windows
    // junction. Do not write through it into another directory just because
    // the managed child does not exist yet.
    return "preserved-user-owned";
  }
  if (skillsDirectoryKind === "missing") {
    await mkdir(skillsDirectory, { recursive: true, mode: 0o700 });
  }
  // Classify again after creation so a concurrent replacement with a link
  // fails closed before any temporary or managed content is written into it.
  if ((await pathKind(skillsDirectory)) !== "directory") {
    return "preserved-user-owned";
  }

  for (let attempt = 1; ; attempt += 1) {
    const state = await readManagedState(skillDirectory);
    if (state === "foreign") return "preserved-user-owned";
    if (state === "current") return "unchanged";

    const outcome = await swapManagedSkillDirectory({
      skillsDirectory,
      skillDirectory,
      replaceExisting: state === "stale",
    });
    if (outcome !== "retry") return outcome;
    if (attempt >= MAX_SWAP_ATTEMPTS) {
      // Another installer keeps winning the race. Report what is on disk now
      // instead of looping against it.
      return (await readManagedState(skillDirectory)) === "current"
        ? "unchanged"
        : "preserved-user-owned";
    }
  }
}
