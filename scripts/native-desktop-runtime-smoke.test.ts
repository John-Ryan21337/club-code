import { assert, describe, it } from "@effect/vitest";

import {
  assertRuntimeSelfTestResult,
  desktopSmokeChromiumSwitches,
  isReadyDesktopDebugSnapshot,
  parseRuntimeSmokeArgs,
  readDebugUrl,
  resolvePackagedResourcesPath,
  summarizeDesktopDebugReadiness,
} from "./native-desktop-runtime-smoke.ts";

describe("native desktop runtime smoke", () => {
  const successfulWindowsResult = {
    ok: true,
    platform: "win32",
    arch: "x64",
    isPackaged: true,
    checks: {
      safeStorage: true,
      sqlite: true,
      pty: true,
      packagedResources: true,
      packagedArtifactAudit: true,
      updateMetadata: true,
      managedRuntime: true,
      windowOpacity: true,
    },
    failedChecks: [],
  } as const;

  it("parses explicit app and resource paths", () => {
    const options = parseRuntimeSmokeArgs(["--app", "./Club Code", "--resources", "./Resources"]);
    assert.match(options.appPath, /Club Code$/);
    assert.match(options.resourcesPath ?? "", /Resources$/);
  });

  it("derives native packaged resource locations", () => {
    assert.equal(
      resolvePackagedResourcesPath("C:\\Club\\Club Code.exe", "win32"),
      "C:\\Club\\resources",
    );
    assert.equal(
      resolvePackagedResourcesPath(
        "/Applications/Club Code.app/Contents/MacOS/Club Code",
        "darwin",
      ),
      "/Applications/Club Code.app/Contents/Resources",
    );
  });

  it("extracts only a loopback desktop debug endpoint", () => {
    assert.equal(
      readDebugUrl("noise [Club Code debug] http://127.0.0.1:4567/debug more"),
      "http://127.0.0.1:4567/debug",
    );
    assert.isUndefined(readDebugUrl("[Club Code debug] http://192.0.2.1:4567/debug"));
  });

  it("disables Chromium sandboxing only for an explicit container smoke", () => {
    assert.deepEqual(desktopSmokeChromiumSwitches({}), []);
    assert.deepEqual(
      desktopSmokeChromiumSwitches({ CAFE_CODE_NATIVE_SMOKE_DISABLE_CHROMIUM_SANDBOX: "1" }),
      ["--no-sandbox"],
    );
  });

  it("requires provider health and a hydrated renderer IPC surface", () => {
    assert.isTrue(
      isReadyDesktopDebugSnapshot({
        providerDaemon: { available: true, lastHealth: { ok: true } },
        renderer: {
          available: true,
          diagnostics: { localApi: { available: true } },
          connection: { connected: true },
        },
      }),
    );
    assert.isFalse(
      isReadyDesktopDebugSnapshot({
        providerDaemon: { available: true, lastHealth: { ok: true } },
        renderer: {
          available: true,
          diagnostics: { localApi: { available: true } },
          connection: { connected: false },
        },
      }),
    );
    assert.isFalse(
      isReadyDesktopDebugSnapshot({
        providerDaemon: { available: true, lastHealth: { ok: true } },
        renderer: { available: false },
      }),
    );
    assert.deepEqual(
      summarizeDesktopDebugReadiness({
        providerDaemon: { available: true, status: "running", lastHealth: { ok: false } },
        renderer: { available: false },
      }),
      {
        providerAvailable: true,
        providerStatus: "running",
        providerHealthOk: false,
        rendererAvailable: false,
        rendererLocalApiAvailable: false,
        rendererWebSocketConnected: false,
      },
    );
  });

  it("accepts a complete packaged Windows runtime result", () => {
    assert.deepEqual(
      assertRuntimeSelfTestResult(successfulWindowsResult, "win32", "x64"),
      successfulWindowsResult,
    );
  });

  it("fails closed when packaged opacity evidence is missing or unsuccessful", () => {
    for (const windowOpacity of [undefined, null, false]) {
      const result = {
        ...successfulWindowsResult,
        checks: { ...successfulWindowsResult.checks, windowOpacity },
      };
      assert.throws(
        () => assertRuntimeSelfTestResult(result, "win32", "x64"),
        /runtime self-test failed/,
      );
    }
  });

  it("requires every packaged runtime boundary even when the aggregate says ok", () => {
    assert.throws(
      () =>
        assertRuntimeSelfTestResult(
          {
            ...successfulWindowsResult,
            checks: { ...successfulWindowsResult.checks, packagedArtifactAudit: false },
          },
          "win32",
          "x64",
        ),
      /runtime self-test failed/,
    );
  });
});
