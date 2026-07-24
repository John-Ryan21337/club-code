import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUDIT_AND_REPAIR_OPENAI_YAML,
  AUDIT_AND_REPAIR_SKILL_MD,
  installBundledAuditAndRepairSkill,
} from "./BundledAuditAndRepairSkill.ts";

async function withTempHome<A>(run: (home: string) => Promise<A>): Promise<A> {
  const home = await mkdtemp(join(tmpdir(), "club-code-skill-"));
  try {
    return await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

describe("installBundledAuditAndRepairSkill", () => {
  it("installs exact bundled content and is idempotent", async () =>
    await withTempHome(async (home) => {
      expect(await installBundledAuditAndRepairSkill(home)).toBe("installed");
      expect(await readFile(join(home, "skills/audit-and-repair/SKILL.md"), "utf8")).toBe(
        AUDIT_AND_REPAIR_SKILL_MD,
      );
      expect(await readFile(join(home, "skills/audit-and-repair/agents/openai.yaml"), "utf8")).toBe(
        AUDIT_AND_REPAIR_OPENAI_YAML,
      );
      expect(await installBundledAuditAndRepairSkill(home)).toBe("unchanged");
    }));

  it("updates a previous unmodified Club Code-managed version", async () =>
    await withTempHome(async (home) => {
      const skillDirectory = join(home, "skills/audit-and-repair");
      const oldSkill = "old managed skill\n";
      const oldYaml = "interface: {}\n";
      const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
      await mkdir(join(skillDirectory, "agents"), { recursive: true });
      await writeFile(join(skillDirectory, "SKILL.md"), oldSkill);
      await writeFile(join(skillDirectory, "agents/openai.yaml"), oldYaml);
      await writeFile(
        join(skillDirectory, ".club-code-managed.json"),
        `${JSON.stringify(
          {
            owner: "club-code",
            version: 1,
            files: {
              "SKILL.md": digest(oldSkill),
              "agents/openai.yaml": digest(oldYaml),
            },
          },
          null,
          2,
        )}\n`,
      );

      expect(await installBundledAuditAndRepairSkill(home)).toBe("updated");
      expect(await readFile(join(skillDirectory, "SKILL.md"), "utf8")).toBe(
        AUDIT_AND_REPAIR_SKILL_MD,
      );
    }));

  it("does not overwrite an unmarked user-owned skill", async () =>
    await withTempHome(async (home) => {
      const skillDirectory = join(home, "skills/audit-and-repair");
      await mkdir(skillDirectory, { recursive: true });
      await writeFile(join(skillDirectory, "SKILL.md"), "my reviewer\n");
      expect(await installBundledAuditAndRepairSkill(home)).toBe("preserved-user-owned");
      expect(await readFile(join(skillDirectory, "SKILL.md"), "utf8")).toBe("my reviewer\n");
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

  it("refuses a symlinked skill destination", async () =>
    await withTempHome(async (home) => {
      const outside = join(home, "outside");
      const skillDirectory = join(home, "skills/audit-and-repair");
      await mkdir(join(home, "skills"), { recursive: true });
      await mkdir(outside);
      try {
        await symlink(outside, skillDirectory, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM")
          return;
        throw error;
      }
      expect(await installBundledAuditAndRepairSkill(home)).toBe("preserved-user-owned");
    }));

  it("refuses a symlinked skills directory instead of writing outside the provider home", async () =>
    await withTempHome(async (home) => {
      const outside = join(home, "outside");
      const skillsDirectory = join(home, "skills");
      await mkdir(outside);
      try {
        await symlink(outside, skillsDirectory, process.platform === "win32" ? "junction" : "dir");
      } catch (error) {
        if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM")
          return;
        throw error;
      }

      expect(await installBundledAuditAndRepairSkill(home)).toBe("preserved-user-owned");
      await expect(
        readFile(join(outside, "audit-and-repair/SKILL.md"), "utf8"),
      ).rejects.toMatchObject({ code: "ENOENT" });
    }));
});
