import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStopped, migrateReleaseState } from "./migrate-release-state.mjs";

const temp = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.club-runtime/temp");
const fixtures = [];
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fs.rm(fixture, { recursive: true, force: true });
});
async function fixture() {
  await fs.mkdir(temp, { recursive: true });
  const base = await fs.mkdtemp(path.join(temp, "migration-test-"));
  fixtures.push(base);
  const root = path.join(base, "release");
  const source = path.join(base, "legacy");
  await fs.mkdir(root);
  await fs.mkdir(path.join(source, "userdata", "attachments"), { recursive: true });
  await fs.writeFile(path.join(source, "userdata", "state.sqlite"), "database fixture");
  await fs.writeFile(path.join(source, "userdata", "settings.json"), '{ "name": "日本語" }\r\n');
  await fs.writeFile(path.join(source, "userdata", "attachments", "lockfile"), "keep attachment");
  return { root, source, checkStopped: async () => {} };
}
describe("release state migration", () => {
  it("preserves original bytes, excludes process state, and publishes verified local data", async () => {
    const input = await fixture();
    await fs.writeFile(path.join(input.source, "userdata", "server-runtime.json"), '{"pid":123}');
    const result = await migrateReleaseState(input);
    expect(result.files).toBe(3);
    const target = path.join(input.root, ".club-runtime");
    expect(await fs.readFile(path.join(target, "userdata", "settings.json"), "utf8")).toBe(
      '{ "name": "日本語" }\r\n',
    );
    expect(
      await fs.readFile(path.join(target, "userdata", "attachments", "lockfile"), "utf8"),
    ).toBe("keep attachment");
    expect(await fs.readFile(path.join(input.source, "userdata", "state.sqlite"), "utf8")).toBe(
      "database fixture",
    );
    await expect(fs.access(path.join(target, "userdata", "server-runtime.json"))).rejects.toThrow();
    await expect(fs.access(path.join(target, "migration-in-progress.json"))).rejects.toThrow();
    expect(
      JSON.parse(await fs.readFile(path.join(target, "storage-ready.json"), "utf8")).files,
    ).toBe(3);
    await expect(migrateReleaseState(input)).rejects.toThrow("already exists");
  });
  it("refuses a live recorded process before creating staging", async () => {
    const input = await fixture();
    await fs.writeFile(
      path.join(input.source, "userdata", "server-runtime.json"),
      JSON.stringify({ pid: process.pid }),
    );
    await expect(migrateReleaseState({ ...input, checkStopped: assertStopped })).rejects.toThrow(
      "still running",
    );
    expect(await fs.readdir(path.join(input.root, ".club-runtime"))).toEqual([]);
  });
  it("refuses overlapping source and destination", async () => {
    const input = await fixture();
    await expect(migrateReleaseState({ ...input, root: input.source })).rejects.toThrow("separate");
  });
  it("refuses junctions without following their content", async () => {
    const input = await fixture();
    await fs.symlink(
      input.root,
      path.join(input.source, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(migrateReleaseState(input)).rejects.toThrow("link or special file");
  });
  it("keeps startup blocked and staged data if a writer starts during copy", async () => {
    const input = await fixture();
    let checks = 0;
    await expect(
      migrateReleaseState({
        ...input,
        checkStopped: async () => {
          if (++checks === 2) throw new Error("Writer started");
        },
      }),
    ).rejects.toThrow("Writer started");
    await fs.access(path.join(input.root, ".club-runtime", "migration-in-progress.json"));
    await expect(fs.access(path.join(input.root, ".club-runtime", "userdata"))).rejects.toThrow();
    await expect(migrateReleaseState(input)).rejects.toThrow("incomplete");
  });
  it("preserves shadow credentials while omitting only generated links", async () => {
    const input = await fixture();
    const shadow = path.join(input.source, "codex-homes", "personal");
    await fs.mkdir(path.join(shadow, "packages", "standalone"), { recursive: true });
    await fs.writeFile(path.join(shadow, "auth.json"), "private fixture");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await fs.symlink(input.root, path.join(shadow, "sessions"), linkType);
    await fs.symlink(input.root, path.join(shadow, "packages", "standalone", "current"), linkType);
    await migrateReleaseState(input);
    const target = path.join(input.root, ".club-runtime");
    expect(
      await fs.readFile(path.join(target, "codex-homes", "personal", "auth.json"), "utf8"),
    ).toBe("private fixture");
    await expect(
      fs.lstat(path.join(target, "codex-homes", "personal", "sessions")),
    ).rejects.toThrow();
    expect(
      JSON.parse(await fs.readFile(path.join(target, "migration-omitted-links.json"), "utf8"))
        .entries,
    ).toEqual([
      path.join("codex-homes", "personal", "packages", "standalone", "current"),
      path.join("codex-homes", "personal", "sessions"),
    ]);
    expect((await fs.lstat(path.join(shadow, "sessions"))).isSymbolicLink()).toBe(true);
  });
  it("rejects unknown shadow links instead of silently dropping them", async () => {
    const input = await fixture();
    const shadow = path.join(input.source, "codex-homes", "personal");
    await fs.mkdir(shadow, { recursive: true });
    await fs.symlink(
      input.root,
      path.join(shadow, "unknown"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(migrateReleaseState(input)).rejects.toThrow("link or special file");
  });
  it("rebases a known internal CLI alias to the copied release directory", async () => {
    const input = await fixture();
    const standalone = path.join(input.source, "codex-homes", "personal", "packages", "standalone");
    const version = path.join(standalone, "releases", "fixture");
    await fs.mkdir(version, { recursive: true });
    await fs.writeFile(path.join(version, "binary"), "fixture binary");
    await fs.symlink(
      version,
      path.join(standalone, "current"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await migrateReleaseState(input);
    const copied = path.join(
      input.root,
      ".club-runtime",
      "codex-homes",
      "personal",
      "packages",
      "standalone",
    );
    expect(await fs.realpath(path.join(copied, "current"))).toBe(
      await fs.realpath(path.join(copied, "releases", "fixture")),
    );
    expect(await fs.readFile(path.join(copied, "current", "binary"), "utf8")).toBe(
      "fixture binary",
    );
  });
  it("archives conflicting logs and caches without overwriting local content", async () => {
    const input = await fixture();
    const target = path.join(input.root, ".club-runtime");
    for (const name of ["launcher-logs", "caches"]) {
      await fs.mkdir(path.join(input.source, name));
      await fs.writeFile(path.join(input.source, name, "entry"), "legacy");
      await fs.mkdir(path.join(target, name), { recursive: true });
      await fs.writeFile(path.join(target, name, "entry"), "current");
    }
    await migrateReleaseState(input);
    const archives = await fs.readdir(path.join(target, "legacy-state"));
    expect(archives).toHaveLength(1);
    for (const name of ["launcher-logs", "caches"]) {
      expect(await fs.readFile(path.join(target, name, "entry"), "utf8")).toBe("current");
      expect(
        await fs.readFile(path.join(target, "legacy-state", archives[0], name, "entry"), "utf8"),
      ).toBe("legacy");
    }
  });
  it("refuses conflicting worktrees instead of archiving or merging them", async () => {
    const input = await fixture();
    await fs.mkdir(path.join(input.source, "worktrees"));
    await fs.mkdir(path.join(input.root, ".club-runtime", "worktrees"), { recursive: true });
    await expect(migrateReleaseState(input)).rejects.toThrow("conflicts");
  });
});
