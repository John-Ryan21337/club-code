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

const MANAGED_MARKER_FILE_NAME = ".club-code-managed.json";
const MANAGED_MARKER_OWNER = "club-code";
const MANAGED_MARKER_VERSION = 1;

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

async function isUnmodifiedManagedDirectory(
  directory: string,
  marker: ManagedMarker,
): Promise<boolean> {
  try {
    const [rootEntries, agentEntries] = await Promise.all([
      readdir(directory),
      readdir(join(directory, "agents")),
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
      if (!info.isFile() || info.isSymbolicLink()) return false;
      if (sha256(await readFile(filePath, "utf8")) !== marker.files[relativePath]) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Install Club Code's cross-project reviewer skill into one provider config
 * home (for example CODEX_HOME or CLAUDE_CONFIG_DIR).
 *
 * Unmarked destinations are user-owned and never modified. Managed content is
 * updated only while every file still matches its marker, so local edits are
 * also preserved.
 */
export async function installBundledAuditAndRepairSkill(
  agentConfigHomePath: string,
): Promise<BundledSkillInstallResult> {
  const skillsDirectory = join(agentConfigHomePath, "skills");
  const skillDirectory = join(skillsDirectory, AUDIT_AND_REPAIR_SKILL_NAME);
  const skillsDirectoryKind = await pathKind(skillsDirectory);
  if (skillsDirectoryKind === "other") {
    // `skills` is itself user-owned when it is a file or symbolic link. Do
    // not follow it outside the configured provider home just because the
    // managed child does not exist yet.
    return "preserved-user-owned";
  }
  if (skillsDirectoryKind === "missing") {
    await mkdir(skillsDirectory, { recursive: true, mode: 0o700 });
  }
  // Re-check after creation so a concurrent replacement with a symlink fails
  // closed before any temporary or managed content is written through it.
  if ((await pathKind(skillsDirectory)) !== "directory") {
    return "preserved-user-owned";
  }

  const existingKind = await pathKind(skillDirectory);
  if (existingKind === "other") return "preserved-user-owned";

  if (existingKind === "directory") {
    let marker: ManagedMarker | null = null;
    try {
      marker = decodeManagedMarker(
        await readFile(join(skillDirectory, MANAGED_MARKER_FILE_NAME), "utf8"),
      );
    } catch {
      return "preserved-user-owned";
    }
    if (marker === null || !(await isUnmodifiedManagedDirectory(skillDirectory, marker))) {
      return "preserved-user-owned";
    }
    const nextMarker = makeMarker();
    if (
      Object.entries(nextMarker.files).every(
        ([relativePath, digest]) => marker.files[relativePath] === digest,
      )
    ) {
      return "unchanged";
    }
  }

  const temporaryDirectory = join(
    skillsDirectory,
    `.${AUDIT_AND_REPAIR_SKILL_NAME}.club-code-${randomUUID()}`,
  );
  await mkdir(temporaryDirectory, { mode: 0o700 });
  try {
    await writeSkillDirectory(temporaryDirectory);
    if (existingKind === "directory") {
      const backupDirectory = join(
        skillsDirectory,
        `.${AUDIT_AND_REPAIR_SKILL_NAME}.club-code-backup-${randomUUID()}`,
      );
      await rename(skillDirectory, backupDirectory);
      try {
        await rename(temporaryDirectory, skillDirectory);
      } catch (error) {
        await rename(backupDirectory, skillDirectory);
        throw error;
      }
      await rm(backupDirectory, { recursive: true, force: true });
      return "updated";
    }

    try {
      await rename(temporaryDirectory, skillDirectory);
      return "installed";
    } catch (error) {
      if (["EEXIST", "ENOTEMPTY", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        return "preserved-user-owned";
      }
      throw error;
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
