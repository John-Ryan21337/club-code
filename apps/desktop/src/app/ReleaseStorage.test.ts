import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prepareReleaseStorage, resolveReleaseRoot } from "./ReleaseStorage.ts";

const roots: string[] = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "club-storage-"));
  roots.push(root);
  return { root, homeDirectory: path.join(root, "old-home"), env: {} as NodeJS.ProcessEnv };
}
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("release storage policy", () => {
  it("requires a dedicated macOS release directory outside the signed app bundle", () => {
    const input = {
      dirname: "unused",
      executablePath: path.resolve("Applications/Club Code.app/Contents/MacOS/Club Code"),
      isPackaged: true,
      platform: "darwin" as const,
    };
    expect(() => resolveReleaseRoot(input)).toThrow("own writable release folder");
    expect(
      resolveReleaseRoot({
        ...input,
        executablePath: path.resolve(
          "Applications/Club Code/Club Code.app/Contents/MacOS/Club Code",
        ),
      }),
    ).toBe(path.resolve("Applications/Club Code"));
  });
  it("rejects an external Git dependency on direct launch", () => {
    const input = fixture();
    const outside = fixture().root;
    fs.writeFileSync(path.join(input.root, ".git"), `gitdir: ${outside}\n`);
    expect(() => prepareReleaseStorage(input)).toThrow("standalone checkout");
    expect(fs.existsSync(path.join(input.root, ".club-runtime"))).toBe(false);
  });
  it.each(["corepack", "yarn", "npm", "updates"])("rejects an escaped %s cache", (name) => {
    const input = fixture();
    const outside = fixture().root;
    const cache = path.join(input.root, ".club-runtime", "cache");
    fs.mkdirSync(cache, { recursive: true });
    fs.symlinkSync(
      outside,
      path.join(cache, name),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => prepareReleaseStorage(input)).toThrow("cannot link outside");
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it("creates a CommonJS boundary for direct-launch Corepack without overwriting conflicts", () => {
    const input = fixture();
    const storage = prepareReleaseStorage(input);
    const boundary = path.join(storage.corepack, "package.json");
    expect(JSON.parse(fs.readFileSync(boundary, "utf8")).type).toBe("commonjs");
    fs.writeFileSync(boundary, '{"type":"module"}');
    expect(() => prepareReleaseStorage(input)).toThrow("must use CommonJS");
    expect(fs.readFileSync(boundary, "utf8")).toBe('{"type":"module"}');
  });
  it("normalizes inherited environment spellings and rejects conflicting roots", () => {
    const input = fixture();
    input.env.Temp = "external-temp";
    input.env.npm_CONFIG_CACHE = "external-cache";
    input.env.cafe_code_home = path.join(input.root, ".club-runtime");
    const result = prepareReleaseStorage(input);
    expect(input.env.Temp).toBeUndefined();
    expect(input.env.npm_CONFIG_CACHE).toBeUndefined();
    expect(input.env.TEMP).toBe(result.temp);
    expect(input.env.CAFE_CODE_HOME).toBe(result.baseDir);
    const conflicting = fixture();
    conflicting.env.CAFE_CODE_HOME = "first";
    conflicting.env.cafe_code_home = "second";
    expect(() => prepareReleaseStorage(conflicting)).toThrow("Conflicting");
  });
  it("rejects external profiler output before creating state", () => {
    const input = fixture();
    input.env.CAFE_CODE_STARTUP_PROFILE_DIR = path.dirname(input.root);
    expect(() => prepareReleaseStorage(input)).toThrow("inside its release folder");
    expect(fs.existsSync(path.join(input.root, ".club-runtime"))).toBe(false);
  });
  it("contains application state and temporary files without changing provider identity", () => {
    const input = fixture();
    input.env.USERPROFILE = "existing-profile";
    input.env.TEMP = "external-temp";
    const result = prepareReleaseStorage(input);
    expect(result.baseDir).toBe(path.join(input.root, ".club-runtime"));
    expect(result.backups).toBe(path.join(input.root, "backups"));
    expect(input.env.TEMP).toBe(result.temp);
    expect(input.env.CAFE_CODE_HOME).toBe(result.baseDir);
    expect(input.env.CAFE_CODE_BACKUPS_DIR).toBe(result.backups);
    expect(input.env.USERPROFILE).toBe("existing-profile");
    expect(fs.existsSync(result.stateDir)).toBe(true);
  });
  it("rejects external overrides before creating state", () => {
    const input = fixture();
    input.env.CAFE_CODE_HOME = path.dirname(input.root);
    expect(() => prepareReleaseStorage(input)).toThrow("inside its release folder");
    expect(fs.existsSync(path.join(input.root, ".club-runtime"))).toBe(false);
  });
  it("requires migration instead of starting with empty history", () => {
    const input = fixture();
    const legacy = path.join(input.homeDirectory, ".cafe-code", "userdata");
    fs.mkdirSync(legacy, { recursive: true });
    fs.writeFileSync(path.join(legacy, "state.sqlite"), "existing history");
    expect(() => prepareReleaseStorage(input)).toThrow("needs migration");
    expect(fs.readFileSync(path.join(legacy, "state.sqlite"), "utf8")).toBe("existing history");
  });
  it("blocks startup during migration", () => {
    const input = fixture();
    fs.mkdirSync(path.join(input.root, ".club-runtime"));
    fs.writeFileSync(path.join(input.root, ".club-runtime", "migration-in-progress.json"), "{}");
    expect(() => prepareReleaseStorage(input)).toThrow("in progress");
  });
  it("rejects an escaped storage junction", () => {
    const input = fixture();
    const outside = fixture().root;
    fs.symlinkSync(
      outside,
      path.join(input.root, ".club-runtime"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() => prepareReleaseStorage(input)).toThrow("cannot link outside");
    expect(fs.readdirSync(outside)).toEqual([]);
  });
  it("derives a direct source launch root from its bundle", () => {
    expect(
      resolveReleaseRoot({
        dirname: path.resolve("release/apps/desktop/dist-electron"),
        executablePath: "ignored",
        isPackaged: false,
        platform: process.platform,
      }),
    ).toBe(path.resolve("release"));
  });
});
