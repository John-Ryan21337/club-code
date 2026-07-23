import { assert, describe, it } from "@effect/vitest";

import {
  collectDesktopRuntimeSelfTestResult,
  isDesktopRuntimeSelfTestEnabled,
  type DesktopRuntimeSelfTestDependencies,
} from "./DesktopRuntimeSelfTest.ts";

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
