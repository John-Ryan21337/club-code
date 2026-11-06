import { afterEach, describe, expect, it, vi } from "vitest";
import * as path from "node:path";

vi.mock("electron-updater", () => {
  class Updater {
    readonly httpExecutor = { kind: "electron" };
    readonly app = { baseCachePath: "external" };
  }
  return {
    NsisUpdater: class NsisUpdater extends Updater {},
    MacUpdater: class MacUpdater extends Updater {},
    AppImageUpdater: class AppImageUpdater extends Updater {},
    DebUpdater: class DebUpdater extends Updater {},
    RpmUpdater: class RpmUpdater extends Updater {},
    PacmanUpdater: class PacmanUpdater extends Updater {},
  };
});
vi.mock("electron-updater/out/ElectronAppAdapter.js", () => ({
  ElectronAppAdapter: class {
    get baseCachePath() {
      return "external";
    }
  },
}));

import { createReleaseUpdater } from "./ElectronUpdater.ts";

afterEach(() => vi.unstubAllEnvs());

describe("release updater storage", () => {
  it.each([
    ["win32", "deb", "ReleaseNsisUpdater"],
    ["darwin", "rpm", "ReleaseMacUpdater"],
    ["linux", "", "ReleaseAppImageUpdater"],
    ["linux", "unknown", "ReleaseAppImageUpdater"],
    ["linux", "deb\n", "ReleaseDebUpdater"],
    ["linux", "rpm", "ReleaseRpmUpdater"],
    ["linux", "pacman", "ReleasePacmanUpdater"],
  ] as const)("keeps the %s/%s updater and contains its cache", (platform, type, name) => {
    const root = path.resolve("release");
    vi.stubEnv("CAFE_CODE_RELEASE_ROOT", root);
    const updater = createReleaseUpdater(platform, type);
    const internals = updater as unknown as {
      app: { baseCachePath: string };
      httpExecutor: { kind: string };
    };
    expect(updater.constructor.name).toBe(name);
    expect(internals.app.baseCachePath).toBe(path.join(root, ".club-runtime", "cache", "updates"));
    expect(internals.httpExecutor.kind).toBe("electron");
  });

  it.each(["", "relative"])("rejects uninitialized storage %s", (root) => {
    vi.stubEnv("CAFE_CODE_RELEASE_ROOT", root);
    const updater = createReleaseUpdater("win32") as unknown as { app: { baseCachePath: string } };
    expect(() => updater.app.baseCachePath).toThrow("not initialized");
  });
});
