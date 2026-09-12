import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const race = vi.hoisted(() => ({ beforeRename: null as null | ((from: string) => Promise<void>) }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (...args: Parameters<typeof actual.rename>) => {
      await race.beforeRename?.(String(args[0]));
      return actual.rename(...args);
    },
  };
});

import { installBundledAuditAndRepairSkill } from "./BundledAuditAndRepairSkill.ts";

afterEach(() => {
  race.beforeRename = null;
});

it("preserves an edit made after ownership validation but before directory replacement", async () => {
  const home = await mkdtemp(join(tmpdir(), "cafe-skill-edit-race-"));
  const skill = join(home, "skills", "audit-and-repair");
  try {
    await mkdir(join(skill, "agents"), { recursive: true });
    const files = { "SKILL.md": "old managed skill", "agents/openai.yaml": "interface: {}" };
    for (const [name, text] of Object.entries(files)) await writeFile(join(skill, name), text);
    await writeFile(
      join(skill, ".cafe-code-managed.json"),
      JSON.stringify({
        owner: "cafe-code",
        version: 1,
        files: Object.fromEntries(
          Object.entries(files).map(([name, text]) => [
            name,
            createHash("sha256").update(text).digest("hex"),
          ]),
        ),
      }),
    );
    race.beforeRename = async (from) => {
      if (from !== skill) return;
      race.beforeRename = null;
      await writeFile(join(skill, "SKILL.md"), "user edit made during update");
    };
    expect(await installBundledAuditAndRepairSkill(home)).toBe("preserved-user-owned");
    expect(await readFile(join(skill, "SKILL.md"), "utf8")).toBe("user edit made during update");
    expect(await readdir(join(home, "skills"))).toEqual(["audit-and-repair"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
