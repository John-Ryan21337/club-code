import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUDIT_AND_REPAIR_OPENAI_YAML,
  AUDIT_AND_REPAIR_SKILL_MD,
  installBundledAuditAndRepairSkill,
  type BundledSkillInstallResult,
} from "./BundledAuditAndRepairSkill.ts";

// Every case runs against a fresh temporary directory. No test reads or writes
// a real provider home, a real user home, or a real provider process.
async function withTempHome<A>(run: (home: string) => Promise<A>): Promise<A> {
  const home = await mkdtemp(join(tmpdir(), "cafe-code-skill-"));
  try {
    return await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

async function expectManagedContent(skillDirectory: string): Promise<void> {
  expect(await readFile(join(skillDirectory, "SKILL.md"), "utf8")).toBe(AUDIT_AND_REPAIR_SKILL_MD);
  expect(await readFile(join(skillDirectory, "agents/openai.yaml"), "utf8")).toBe(
    AUDIT_AND_REPAIR_OPENAI_YAML,
  );
}

async function writeManagedSkill(input: {
  readonly skillDirectory: string;
  readonly markerFileName: string;
  readonly owner: string;
  readonly skill: string;
  readonly yaml: string;
}): Promise<void> {
  await mkdir(join(input.skillDirectory, "agents"), { recursive: true });
  await writeFile(join(input.skillDirectory, "SKILL.md"), input.skill);
  await writeFile(join(input.skillDirectory, "agents/openai.yaml"), input.yaml);
  await writeFile(
    join(input.skillDirectory, input.markerFileName),
    `${JSON.stringify(
      {
        owner: input.owner,
        version: 1,
        files: {
          "SKILL.md": digest(input.skill),
          "agents/openai.yaml": digest(input.yaml),
        },
      },
      null,
      2,
    )}\n`,
  );
}

// Windows without Developer Mode or administrator rights rejects symlink
// creation. Skip only the privilege-dependent fixture; POSIX and privileged
// Windows machines keep the full security assertion.
async function createDirectoryLink(target: string, link: string): Promise<boolean> {
  try {
    await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (error) {
    if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
      return false;
    }
    throw error;
  }
}

describe("installBundledAuditAndRepairSkill", () => {
  it("installs exact bundled content and is idempotent", async () =>
    await withTempHome(async (home) => {
      const skillDirectory = join(home, "skills/audit-and-repair");

      expect(await installBundledAuditAndRepairSkill(home)).toBe("installed");
      await expectManagedContent(skillDirectory);
      expect(await installBundledAuditAndRepairSkill(home)).toBe("unchanged");
      await expectManagedContent(skillDirectory);
    }));

  it("records the Cafe owner marker with the exact bundled file hashes", async () =>
    await withTempHome(async (home) => {
      await installBundledAuditAndRepairSkill(home);

      const marker: unknown = JSON.parse(
        await readFile(join(home, "skills/audit-and-repair/.cafe-code-managed.json"), "utf8"),
      );
      expect(marker).toEqual({
        owner: "cafe-code",
        version: 1,
        files: {
          "SKILL.md": digest(AUDIT_AND_REPAIR_SKILL_MD),
          "agents/openai.yaml": digest(AUDIT_AND_REPAIR_OPENAI_YAML),
        },
      });
    }));

  it("updates a previous unmodified Cafe-managed version", async () =>
    await withTempHome(async (home) => {
      const skillDirectory = join(home, "skills/audit-and-repair");
      await writeManagedSkill({
        skillDirectory,
        markerFileName: ".cafe-code-managed.json",
        owner: "cafe-code",
        skill: "old managed skill\n",
        yaml: "interface: {}\n",
      });

      expect(await installBundledAuditAndRepairSkill(home)).toBe("updated");
      await expectManagedContent(skillDirectory);
      // The update leaves no owned temporary or backup sibling behind.
      expect(await readdir(join(home, "skills"))).toEqual(["audit-and-repair"]);
    }));

  it("does not overwrite an unmarked user-owned skill", async () =>
    await withTempHome(async (home) => {
      const skillDirectory = join(home, "skills/audit-and-repair");
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(join(skillDirectory, "SKILL.md"), "my reviewer\n");

      expect(await installBundledAuditAndRepairSkill(home)).toBe("preserved-user-owned");
      expect(await readFile(join(skillDirectory, "SKILL.md"), "utf8")).toBe("my reviewer\n");
      expect(await readdir(skillDirectory)).toEqual(["SKILL.md"]);
    }));

  it("does not take ownership of a skill managed by another tool", async () =>
    await withTempHome(async (home) => {
      const skillDirectory = join(home, "skills/audit-and-repair");
      await writeManagedSkill({
        skillDirectory,
        markerFileName: ".club-code-managed.json",
        owner: "club-code",
        skill: "club managed skill\n",
        yaml: "interface: {}\n",
      });

      expect(await installBundledAuditAndRepairSkill(home)).toBe("preserved-user-owned");
      expect(await readFile(join(skillDirectory, "SKILL.md"), "utf8")).toBe("club managed skill\n");
      expect((await readdir(skillDirectory)).toSorted()).toEqual([
        ".club-code-managed.json",
        "SKILL.md",
        "agents",
      ]);
    }));

  it("does not overwrite a user-edited managed skill", async () =>
    await withTempHome(async (home) => {
      const skillPath = join(home, "skills/audit-and-repair/SKILL.md");
      await installBundledAuditAndRepairSkill(home);
      await writeFile(skillPath, "locally customized\n");

      expect(await installBundledAuditAndRepairSkill(home)).toBe("preserved-user-owned");
      expect(await readFile(skillPath, "utf8")).toBe("locally customized\n");
    }));

  it("preserves extra user content added beside managed files", async () =>
    await withTempHome(async (home) => {
      const skillDirectory = join(home, "skills/audit-and-repair");
      await installBundledAuditAndRepairSkill(home);
      await writeFile(join(skillDirectory, "notes.md"), "keep me\n");

      expect(await installBundledAuditAndRepairSkill(home)).toBe("preserved-user-owned");
      expect(await readFile(join(skillDirectory, "notes.md"), "utf8")).toBe("keep me\n");
    }));

  it("preserves unrelated skills in the same provider home", async () =>
    await withTempHome(async (home) => {
      const otherSkill = join(home, "skills/my-skill");
      await mkdir(otherSkill, { recursive: true });
      await writeFile(join(otherSkill, "SKILL.md"), "user skill\n");

      expect(await installBundledAuditAndRepairSkill(home)).toBe("installed");
      expect(await readFile(join(otherSkill, "SKILL.md"), "utf8")).toBe("user skill\n");
      expect((await readdir(join(home, "skills"))).toSorted()).toEqual([
        "audit-and-repair",
        "my-skill",
      ]);
    }));

  it("refuses a symlinked skill destination", async () =>
    await withTempHome(async (home) => {
      const outside = join(home, "outside");
      const skillDirectory = join(home, "skills/audit-and-repair");
      await mkdir(join(home, "skills"), { recursive: true });
      await mkdir(outside);
      if (!(await createDirectoryLink(outside, skillDirectory))) return;

      expect(await installBundledAuditAndRepairSkill(home)).toBe("preserved-user-owned");
      expect(await readdir(outside)).toEqual([]);
    }));

  it("refuses a symlinked skills directory instead of writing outside the provider home", async () =>
    await withTempHome(async (home) => {
      const outside = join(home, "outside");
      await mkdir(outside);
      if (!(await createDirectoryLink(outside, join(home, "skills")))) return;

      expect(await installBundledAuditAndRepairSkill(home)).toBe("preserved-user-owned");
      expect(await readdir(outside)).toEqual([]);
    }));

  it("refuses a managed directory whose agents entry is a link", async () =>
    await withTempHome(async (home) => {
      const skillDirectory = join(home, "skills/audit-and-repair");
      const outside = join(home, "outside");
      await mkdir(outside, { recursive: true });
      await writeFile(join(outside, "openai.yaml"), AUDIT_AND_REPAIR_OPENAI_YAML);
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(join(skillDirectory, "SKILL.md"), AUDIT_AND_REPAIR_SKILL_MD);
      await writeFile(
        join(skillDirectory, ".cafe-code-managed.json"),
        `${JSON.stringify(
          {
            owner: "cafe-code",
            version: 1,
            files: {
              "SKILL.md": digest(AUDIT_AND_REPAIR_SKILL_MD),
              "agents/openai.yaml": digest(AUDIT_AND_REPAIR_OPENAI_YAML),
            },
          },
          null,
          2,
        )}\n`,
      );
      if (!(await createDirectoryLink(outside, join(skillDirectory, "agents")))) return;

      expect(await installBundledAuditAndRepairSkill(home)).toBe("preserved-user-owned");
      expect((await readdir(outside)).toSorted()).toEqual(["openai.yaml"]);
    }));

  it("ignores a corrupt owner marker instead of adopting the directory", async () =>
    await withTempHome(async (home) => {
      const skillDirectory = join(home, "skills/audit-and-repair");
      await mkdir(join(skillDirectory, "agents"), { recursive: true });
      await writeFile(join(skillDirectory, "SKILL.md"), "half written\n");
      await writeFile(join(skillDirectory, "agents/openai.yaml"), "interface: {}\n");
      await writeFile(join(skillDirectory, ".cafe-code-managed.json"), "{not json");

      expect(await installBundledAuditAndRepairSkill(home)).toBe("preserved-user-owned");
      expect(await readFile(join(skillDirectory, "SKILL.md"), "utf8")).toBe("half written\n");
    }));

  it("resolves concurrent first installs into one managed directory", async () =>
    await withTempHome(async (home) => {
      const results = await Promise.all(
        Array.from({ length: 8 }, () => installBundledAuditAndRepairSkill(home)),
      );

      expect(results.filter((result) => result === "installed")).toHaveLength(1);
      expect(results.filter((result) => result === "unchanged")).toHaveLength(7);
      await expectManagedContent(join(home, "skills/audit-and-repair"));
      expect(await readdir(join(home, "skills"))).toEqual(["audit-and-repair"]);
    }));

  it("resolves concurrent updates without losing or duplicating content", async () =>
    await withTempHome(async (home) => {
      await writeManagedSkill({
        skillDirectory: join(home, "skills/audit-and-repair"),
        markerFileName: ".cafe-code-managed.json",
        owner: "cafe-code",
        skill: "old managed skill\n",
        yaml: "interface: {}\n",
      });

      const results = await Promise.all(
        Array.from({ length: 8 }, () => installBundledAuditAndRepairSkill(home)),
      );

      const allowed = new Set<BundledSkillInstallResult>(["updated", "unchanged"]);
      expect(results.every((result) => allowed.has(result))).toBe(true);
      expect(results.filter((result) => result === "updated").length).toBeGreaterThanOrEqual(1);
      await expectManagedContent(join(home, "skills/audit-and-repair"));
      expect(await readdir(join(home, "skills"))).toEqual(["audit-and-repair"]);
    }));
});
