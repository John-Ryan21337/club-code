import { assert, describe, it } from "@effect/vitest";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import {
  collectDesktopRuntimeSelfTestResult,
  isDesktopRuntimeSelfTestEnabled,
  runDesktopRuntimeSelfTestAndExit,
  type DesktopRuntimeSelfTestDependencies,
} from "./DesktopRuntimeSelfTest.ts";

const electronApp = vi.hoisted(() => ({
  on: vi.fn(),
  removeListener: vi.fn(),
  exit: vi.fn(),
}));

vi.mock("electron", () => ({ app: electronApp }));

const makeDependencies = (
  overrides: Partial<DesktopRuntimeSelfTestDependencies> = {},
): DesktopRuntimeSelfTestDependencies => ({
  platform: "linux",
  arch: "x64",
  isPackaged: true,
  whenReady: async () => undefined,
  safeStorageRoundTrip: async () => true,
  sqliteRoundTrip: async () => true,
  ptyRoundTrip: async () => true,
  packagedResourcesPresent: async () => true,
  packagedArtifactAudit: async () => true,
  updateMetadataPresent: async () => true,
  managedRuntimePresent: async () => null,
  windowOpacityRoundTrip: async () => null,
  ...overrides,
});

describe("DesktopRuntimeSelfTest", () => {
  it.each([true, false])(
    "reports before exiting when the last probe window closes (PTY success: %s)",
    async (ptySucceeded) => {
      const root = await mkdtemp(join(tmpdir(), "cafe-runtime-lifecycle-test-"));
      const resultPath = join(root, "result.json");
      const listeners = new Set<() => void>();
      electronApp.on.mockImplementation((event, listener) => {
        if (event === "window-all-closed") listeners.add(listener);
      });
      electronApp.removeListener.mockImplementation((event, listener) => {
        if (event === "window-all-closed") listeners.delete(listener);
      });
      electronApp.exit.mockClear();
      electronApp.exit.mockImplementation(() => {
        assert.strictEqual(JSON.parse(readFileSync(resultPath, "utf8")).ok, ptySucceeded);
      });
      vi.stubEnv("CAFE_CODE_RUNTIME_SELF_TEST_RESULT", resultPath);
      const output = vi.spyOn(console, "info").mockImplementation(() => undefined);
      const ptyCheck = Promise.withResolvers<boolean>();
      const windowClosed = Promise.withResolvers<void>();
      let completed: Promise<void> | undefined;
      try {
        completed = runDesktopRuntimeSelfTestAndExit(
          makeDependencies({
            ptyRoundTrip: () => ptyCheck.promise,
            windowOpacityRoundTrip: async () => {
              // Electron quits by default if nobody handles its last-window event.
              try {
                if (listeners.size === 0) electronApp.exit(0);
                for (const listener of listeners) listener();
              } finally {
                windowClosed.resolve();
              }
              return true;
            },
          }),
        );
        await windowClosed.promise;
        assert.strictEqual(electronApp.exit.mock.calls.length, 0);
        ptyCheck.resolve(ptySucceeded);
        await completed;
        const report = JSON.parse(await readFile(resultPath, "utf8"));
        assert.strictEqual(report.ok, ptySucceeded);
        assert.strictEqual(report.checks.pty, ptySucceeded);
        assert.deepEqual(report.failedChecks, ptySucceeded ? [] : ["pty"]);
        assert.deepEqual(electronApp.exit.mock.calls, [[ptySucceeded ? 0 : 1]]);
        assert.strictEqual(listeners.size, 0);
      } finally {
        ptyCheck.resolve(ptySucceeded);
        await completed?.catch(() => undefined);
        output.mockRestore();
        vi.unstubAllEnvs();
        electronApp.on.mockReset();
        electronApp.removeListener.mockReset();
        electronApp.exit.mockReset();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("enables only for the explicit self-test switch", () => {
    assert.isFalse(isDesktopRuntimeSelfTestEnabled(["Cafe Code"]));
    assert.isTrue(isDesktopRuntimeSelfTestEnabled(["Cafe Code", "--cafe-runtime-self-test"]));
  });

  it("reports every successful runtime boundary", async () => {
    const result = await collectDesktopRuntimeSelfTestResult(makeDependencies());

    assert.isTrue(result.ok);
    assert.deepEqual(result.failedChecks, []);
    assert.deepEqual(result.checks, {
      safeStorage: true,
      sqlite: true,
      pty: true,
      packagedResources: true,
      packagedArtifactAudit: true,
      updateMetadata: true,
      managedRuntime: null,
      windowOpacity: null,
    });
  });

  it("fails closed with stable check names and no raw exception details", async () => {
    const result = await collectDesktopRuntimeSelfTestResult(
      makeDependencies({
        platform: "win32",
        safeStorageRoundTrip: async () => {
          throw new Error("private path and token must not escape");
        },
        ptyRoundTrip: async () => false,
        packagedArtifactAudit: async () => false,
        managedRuntimePresent: async () => false,
        windowOpacityRoundTrip: async () => false,
      }),
    );

    assert.isFalse(result.ok);
    assert.deepEqual(result.failedChecks, [
      "safeStorage",
      "pty",
      "packagedArtifactAudit",
      "managedRuntime",
      "windowOpacity",
    ]);
    assert.notInclude(JSON.stringify(result), "private path");
    assert.notInclude(JSON.stringify(result), "token must not escape");
  });

  it("fails closed when an individual native check never settles", async () => {
    const result = await collectDesktopRuntimeSelfTestResult(
      makeDependencies({
        platform: "win32",
        windowOpacityRoundTrip: () => new Promise(() => undefined),
      }),
      { checkTimeoutMs: 5 },
    );

    assert.isFalse(result.ok);
    assert.strictEqual(result.checks.windowOpacity, false);
    assert.include(result.failedChecks, "windowOpacity");
  });

  it("bounds readiness so bootstrap cannot hang forever", async () => {
    let failure: unknown;
    try {
      await collectDesktopRuntimeSelfTestResult(
        makeDependencies({ whenReady: () => new Promise(() => undefined) }),
        { checkTimeoutMs: 5 },
      );
    } catch (error) {
      failure = error;
    }
    assert.instanceOf(failure, Error);
    assert.include(failure.message, "timed out");
  });
});
