import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_RESTART_DELAY_MS,
  DEFAULT_RESTART_WAIT_MS,
  buildHelperProcessArgs,
  defaultLaunchCommand,
  parseRestartCafeCodeArgs,
  resolveRestartLogDir,
  restartSpawnOptions,
} from "./restart-cafe-code.ts";

describe("restart-cafe-code", () => {
  const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const fixtures: string[] = [];
  function fixture() {
    const base = join(checkout, ".task-tmp", "restart-tests");
    mkdirSync(base, { recursive: true });
    const root = mkdtempSync(join(base, "fixture-"));
    fixtures.push(root);
    const release = join(root, "release");
    const outside = join(root, "outside");
    mkdirSync(release);
    mkdirSync(outside);
    return { release, outside };
  }
  afterEach(() => {
    for (const path of fixtures.splice(0)) {
      if (!path.startsWith(join(checkout, ".task-tmp", "restart-tests", "fixture-"))) {
        throw new Error("Invalid fixture cleanup path.");
      }
      rmSync(path, { recursive: true, force: true });
    }
  });
  it("uses safe defaults for a scheduled desktop restart", () => {
    expect(parseRestartCafeCodeArgs([])).toEqual({
      runHelper: false,
      waitMs: DEFAULT_RESTART_WAIT_MS,
      restartDelayMs: DEFAULT_RESTART_DELAY_MS,
      logDir: undefined,
      launchCommand: undefined,
      dryRun: false,
      help: false,
    });
  });

  it("preserves an explicit launch command after the separator", () => {
    expect(
      parseRestartCafeCodeArgs([
        "--wait-ms=25",
        "--restart-delay-ms",
        "50",
        "--",
        "yarn",
        "dev:desktop",
      ]),
    ).toMatchObject({
      waitMs: 25,
      restartDelayMs: 50,
      launchCommand: ["yarn", "dev:desktop"],
    });
  });

  it("rejects an empty explicit launch command", () => {
    expect(() => parseRestartCafeCodeArgs(["--"])).toThrow("Expected a launch command");
  });

  it("builds the default desktop launch command through Node", () => {
    expect(defaultLaunchCommand("/opt/bin/node")).toEqual([
      "/opt/bin/node",
      "apps/desktop/scripts/start-electron.mjs",
    ]);
  });

  it("keeps helper args structured and appends custom launch argv only after --", () => {
    expect(
      buildHelperProcessArgs({
        scriptPath: "/repo/scripts/restart-cafe-code.ts",
        waitMs: 10,
        restartDelayMs: 20,
        logDir: "/tmp/logs",
        launchCommand: ["yarn", "dev:desktop"],
      }),
    ).toEqual([
      "/repo/scripts/restart-cafe-code.ts",
      "--run-helper",
      "--wait-ms",
      "10",
      "--restart-delay-ms",
      "20",
      "--log-dir",
      "/tmp/logs",
      "--",
      "yarn",
      "dev:desktop",
    ]);
  });

  it("keeps default restart logs under the actual release checkout", () => {
    const { release } = fixture();
    expect(
      resolveRestartLogDir({
        explicitLogDir: undefined,
        env: {},
        cwd: release,
      }),
    ).toBe(join(release, ".club-runtime", "restart-logs"));
  });

  it("accepts a relative log directory inside the release", () => {
    const { release } = fixture();
    expect(resolveRestartLogDir({ explicitLogDir: "logs", env: {}, cwd: release })).toBe(
      join(release, "logs"),
    );
  });

  it("rejects absolute external logs and relative traversal", () => {
    const { release, outside } = fixture();
    for (const explicitLogDir of [outside, "../outside"]) {
      expect(() => resolveRestartLogDir({ explicitLogDir, env: {}, cwd: release })).toThrow(
        /release folder/,
      );
    }
  });

  it("rejects an external home even with a local explicit log directory", () => {
    const { release, outside } = fixture();
    expect(() =>
      resolveRestartLogDir({
        explicitLogDir: "logs",
        env: { CAFE_CODE_HOME: outside },
        cwd: release,
      }),
    ).toThrow(/CAFE_CODE_HOME/);
  });

  it("rejects a log directory through a link outside the release", () => {
    const { release, outside } = fixture();
    symlinkSync(
      outside,
      join(release, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    expect(() =>
      resolveRestartLogDir({ explicitLogDir: "escape/logs", env: {}, cwd: release }),
    ).toThrow(/release folder/);
  });

  it("starts Windows Node and executables without a shell", () => {
    for (const executable of [process.execPath, "node", "node.exe", "custom.exe"]) {
      expect(restartSpawnOptions(checkout, executable, "win32")).toMatchObject({
        shell: false,
        windowsHide: true,
      });
    }
    expect(restartSpawnOptions(checkout, "yarn.cmd", "win32").shell).toBe(true);
    expect(restartSpawnOptions(checkout, "yarn", "linux").shell).toBe(false);
  });
});
