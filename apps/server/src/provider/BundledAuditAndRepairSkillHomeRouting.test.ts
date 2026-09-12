/**
 * Integration coverage for the provider homes the drivers install the bundled
 * `audit-and-repair` skill into.
 *
 * These cases run the same home-resolution code the drivers run
 * (`resolveClaudeConfigDirectory`, `resolveCodexHomeLayout`,
 * `materializeCodexShadowHome`) against fresh temporary directories. They
 * start no provider process, read no real provider home, and perform no login.
 */
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import { CodexSettings, ProviderInstanceId } from "@cafecode/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  AUDIT_AND_REPAIR_SKILL_MD,
  installBundledAuditAndRepairSkill,
} from "./BundledAuditAndRepairSkill.ts";
import { withDefaultCodexShadowHome } from "./Drivers/CodexDriver.ts";
import { materializeCodexShadowHome, resolveCodexHomeLayout } from "./Drivers/CodexHomeLayout.ts";
import { makeClaudeEnvironment, resolveClaudeConfigDirectory } from "./Drivers/ClaudeHome.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

const makeTempDir = Effect.fn("BundledAuditAndRepairSkillHomeRouting.test.makeTempDir")(function* (
  prefix: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix });
});

// The Claude driver derives its environment from the ambient process
// environment. Mask a developer machine's real CLAUDE_CONFIG_DIR so the test
// exercises the configured instance home instead of the machine's home.
const baseEnvWithoutClaudeConfigDir = (): NodeJS.ProcessEnv => {
  const env = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  return env;
};

it.layer(NodeServices.layer)("bundled audit-and-repair skill home routing", (it) => {
  describe("Claude", () => {
    it.effect("installs into the CLAUDE_CONFIG_DIR the instance launches with", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeTempDir("cafe-code-claude-home-");
        const config = { homePath: home };
        const baseEnv = baseEnvWithoutClaudeConfigDir();

        const configDirectory = yield* resolveClaudeConfigDirectory(config, baseEnv);
        const launchEnvironment = yield* makeClaudeEnvironment(config, baseEnv);
        const result = yield* Effect.promise(() =>
          installBundledAuditAndRepairSkill(configDirectory),
        );

        // The install target and the SDK launch environment must be the same
        // directory, otherwise the provider would never read the skill.
        expect(configDirectory).toBe(path.join(home, ".claude"));
        expect(launchEnvironment.CLAUDE_CONFIG_DIR).toBe(configDirectory);
        expect(result).toBe("installed");
        expect(
          yield* Effect.promise(() =>
            readFile(path.join(configDirectory, "skills/audit-and-repair/SKILL.md"), "utf8"),
          ),
        ).toBe(AUDIT_AND_REPAIR_SKILL_MD);
        // Only the configuration directory is touched. The instance HOME keeps
        // no stray `skills` directory of its own.
        expect((yield* Effect.promise(() => readdir(home))).toSorted()).toEqual([".claude"]);
      }),
    );

    it.effect("follows an explicit CLAUDE_CONFIG_DIR override", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeTempDir("cafe-code-claude-home-");
        const override = yield* makeTempDir("cafe-code-claude-config-");
        const config = { homePath: home };
        const baseEnv = { ...baseEnvWithoutClaudeConfigDir(), CLAUDE_CONFIG_DIR: override };

        const configDirectory = yield* resolveClaudeConfigDirectory(config, baseEnv);
        const result = yield* Effect.promise(() =>
          installBundledAuditAndRepairSkill(configDirectory),
        );

        expect(configDirectory).toBe(path.resolve(override));
        expect(result).toBe("installed");
        expect(
          yield* Effect.promise(() =>
            readFile(path.join(override, "skills/audit-and-repair/SKILL.md"), "utf8"),
          ),
        ).toBe(AUDIT_AND_REPAIR_SKILL_MD);
        expect(yield* Effect.promise(() => readdir(home))).toEqual([]);
      }),
    );

    it.effect("keeps a user-owned skill in the configured Claude home", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = yield* makeTempDir("cafe-code-claude-home-");
        const configDirectory = yield* resolveClaudeConfigDirectory(
          { homePath: home },
          baseEnvWithoutClaudeConfigDir(),
        );
        const userSkill = path.join(configDirectory, "skills/my-reviewer");
        yield* Effect.promise(async () => {
          await mkdir(userSkill, { recursive: true });
          await writeFile(path.join(userSkill, "SKILL.md"), "user reviewer\n");
        });

        const result = yield* Effect.promise(() =>
          installBundledAuditAndRepairSkill(configDirectory),
        );

        expect(result).toBe("installed");
        expect(
          yield* Effect.promise(() => readFile(path.join(userSkill, "SKILL.md"), "utf8")),
        ).toBe("user reviewer\n");
      }),
    );
  });

  describe("Codex", () => {
    it.effect("installs into the shared home an auth overlay reads through", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sharedHome = yield* makeTempDir("cafe-code-codex-shared-");
        const shadowRoot = yield* makeTempDir("cafe-code-codex-shadow-");
        const shadowHome = path.join(shadowRoot, "shadow");
        const config = decodeCodexSettings({
          homePath: sharedHome,
          shadowHomePath: shadowHome,
        });
        // Explicit paths keep the driver default (`~/.cafe-code/codex-homes/…`)
        // out of this test, so no real user home is involved.
        expect(
          withDefaultCodexShadowHome({ instanceId: ProviderInstanceId.make("codex"), config }),
        ).toBe(config);

        const layout = yield* resolveCodexHomeLayout(config);
        const result = yield* Effect.promise(() =>
          installBundledAuditAndRepairSkill(layout.sharedHomePath),
        );
        yield* materializeCodexShadowHome(layout, { authSource: "shared" });

        expect(layout.sharedHomePath).toBe(sharedHome);
        expect(result).toBe("installed");
        // The real file lives in the shared home…
        const sharedSkill = path.join(sharedHome, "skills/audit-and-repair/SKILL.md");
        expect(yield* Effect.promise(() => readFile(sharedSkill, "utf8"))).toBe(
          AUDIT_AND_REPAIR_SKILL_MD,
        );
        // …and the shadow home Codex runs with reaches it through the linked
        // `skills` entry instead of holding a second copy.
        const shadowSkills = path.join(shadowHome, "skills");
        expect((yield* Effect.promise(() => lstat(shadowSkills))).isSymbolicLink()).toBe(true);
        expect(
          yield* Effect.promise(() =>
            readFile(path.join(shadowSkills, "audit-and-repair/SKILL.md"), "utf8"),
          ),
        ).toBe(AUDIT_AND_REPAIR_SKILL_MD);
      }),
    );

    it.effect("installs into a direct Codex home without a shadow overlay", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sharedHome = yield* makeTempDir("cafe-code-codex-direct-");

        const layout = yield* resolveCodexHomeLayout(decodeCodexSettings({ homePath: sharedHome }));
        const result = yield* Effect.promise(() =>
          installBundledAuditAndRepairSkill(layout.sharedHomePath),
        );

        expect(layout.mode).toBe("direct");
        expect(result).toBe("installed");
        expect(
          yield* Effect.promise(() =>
            readFile(path.join(sharedHome, "skills/audit-and-repair/SKILL.md"), "utf8"),
          ),
        ).toBe(AUDIT_AND_REPAIR_SKILL_MD);
      }),
    );

    it.effect("preserves user skills in the shared home across a shadow refresh", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const sharedHome = yield* makeTempDir("cafe-code-codex-shared-");
        const shadowRoot = yield* makeTempDir("cafe-code-codex-shadow-");
        const shadowHome = path.join(shadowRoot, "shadow");
        const userSkill = path.join(sharedHome, "skills/my-reviewer");
        yield* Effect.promise(async () => {
          await mkdir(userSkill, { recursive: true });
          await writeFile(path.join(userSkill, "SKILL.md"), "user reviewer\n");
        });

        const layout = yield* resolveCodexHomeLayout(
          decodeCodexSettings({ homePath: sharedHome, shadowHomePath: shadowHome }),
        );
        // Create, then refresh exactly as the driver does before each session.
        const first = yield* Effect.promise(() =>
          installBundledAuditAndRepairSkill(layout.sharedHomePath),
        );
        yield* materializeCodexShadowHome(layout, { authSource: "shared" });
        const second = yield* Effect.promise(() =>
          installBundledAuditAndRepairSkill(layout.sharedHomePath),
        );
        yield* materializeCodexShadowHome(layout, { authSource: "shared" });

        expect([first, second]).toEqual(["installed", "unchanged"]);
        expect(
          yield* Effect.promise(() => readFile(path.join(userSkill, "SKILL.md"), "utf8")),
        ).toBe("user reviewer\n");
        expect(
          (yield* Effect.promise(() => readdir(path.join(sharedHome, "skills")))).toSorted(),
        ).toEqual(["audit-and-repair", "my-reviewer"]);
      }),
    );
  });
});
