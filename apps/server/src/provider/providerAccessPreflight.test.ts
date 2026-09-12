import {
  ProviderDriverKind,
  ProviderInstanceId,
  DEFAULT_SERVER_SETTINGS,
  type ProviderInstanceConfig,
  type ServerSettings,
  type ServerProvider,
  type ServerProviderAccessResult,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { describe, expect, it, vi } from "vitest";

import type { ProviderInstance } from "./ProviderDriver.ts";
import { ProviderInstanceRegistry } from "./Services/ProviderInstanceRegistry.ts";
import { checkProviderAccess } from "./providerAccessPreflight.ts";
import { makeManualOnlyProviderMaintenanceCapabilities } from "./providerMaintenance.ts";
import { ServerSettingsService } from "../serverSettings.ts";

const instanceId = ProviderInstanceId.make("claude-work");
const driver = ProviderDriverKind.make("claudeAgent");
const input = { instanceId, model: "claude-test" };
const configuration = { driver, enabled: true, config: { binaryPath: "selected-claude" } };
const savedSettings: ServerSettings = {
  ...DEFAULT_SERVER_SETTINGS,
  providerInstances: { [instanceId]: configuration },
};
const verified: ServerProviderAccessResult = {
  ...input,
  checkedAt: "2026-09-11T00:00:00.000Z",
  status: "verified",
};
function makeInstance(checkAccess: NonNullable<ProviderInstance["checkAccess"]>): ProviderInstance {
  const snapshot: ServerProvider = {
    instanceId,
    driver,
    enabled: true,
    installed: true,
    version: "2.1.240",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: verified.checkedAt,
    models: [{ slug: input.model, name: "Test", isCustom: true, capabilities: null }],
    slashCommands: [],
    skills: [],
  };
  return {
    instanceId,
    driverKind: driver,
    displayName: undefined,
    enabled: true,
    continuationIdentity: { driverKind: driver, continuationKey: "exact-instance" },
    snapshot: {
      getSnapshot: Effect.succeed(snapshot),
      refresh: Effect.succeed(snapshot),
      streamChanges: Stream.empty,
      maintenanceCapabilities: makeManualOnlyProviderMaintenanceCapabilities({
        provider: driver,
        packageName: null,
      }),
    },
    adapter: {} as ProviderInstance["adapter"],
    textGeneration: {} as ProviderInstance["textGeneration"],
    checkAccess,
  };
}
const registry = (
  getInstance: (
    id: ProviderInstanceId,
    expected?: ProviderInstanceConfig,
  ) => ProviderInstance | undefined,
  readSettings: () => ServerSettings = () => savedSettings,
) =>
  Layer.mergeAll(
    Layer.mock(ProviderInstanceRegistry)({
      getInstance: (id, expected) => Effect.sync(() => getInstance(id, expected)),
    }),
    Layer.mock(ServerSettingsService)({ getSettings: Effect.sync(readSettings) }),
  );

describe("provider access routing", () => {
  it("checks only the selected enabled instance and configured model", async () => {
    const check = vi.fn(() => Effect.succeed(verified));
    const instance = makeInstance(check);
    const layer = registry((id) => (id === instanceId ? instance : undefined));
    expect(await Effect.runPromise(checkProviderAccess(input).pipe(Effect.provide(layer)))).toEqual(
      verified,
    );
    expect(check).toHaveBeenCalledWith(input.model);
    for (const invalid of [
      { ...input, model: "unlisted" },
      { ...input, instanceId: ProviderInstanceId.make("other") },
    ]) {
      expect(
        (await Effect.runPromise(checkProviderAccess(invalid).pipe(Effect.provide(layer)))).status,
      ).toBe("unverified");
    }
    expect(check).toHaveBeenCalledOnce();
    const disabled = registry(() => ({ ...instance, enabled: false }));
    expect(
      (await Effect.runPromise(checkProviderAccess(input).pipe(Effect.provide(disabled)))).status,
    ).toBe("unverified");
  });

  it("does not accept success from an instance replaced during the check", async () => {
    let active: ProviderInstance;
    const original = makeInstance(() =>
      Effect.sync(() => {
        active = makeInstance(() => Effect.succeed(verified));
        return verified;
      }),
    );
    active = original;
    expect(
      (
        await Effect.runPromise(
          checkProviderAccess(input).pipe(Effect.provide(registry(() => active))),
        )
      ).status,
    ).toBe("unverified");
  });

  it("returns no raw provider error data", async () => {
    const instance = makeInstance(() =>
      Effect.die(new Error("synthetic credential and account detail")),
    );
    const result = await Effect.runPromise(
      checkProviderAccess(input).pipe(Effect.provide(registry(() => instance))),
    );
    expect(result.status).toBe("unverified");
    expect(JSON.stringify(result)).not.toContain("credential");
  });

  it("refuses a pending saved configuration and rejects settings changed during a live probe", async () => {
    const check = vi.fn(() => Effect.succeed(verified));
    const instance = makeInstance(check);
    const unhydrated = registry((_id, expected) => {
      expect(expected).toEqual(configuration);
      return undefined;
    });
    expect(
      (await Effect.runPromise(checkProviderAccess(input).pipe(Effect.provide(unhydrated)))).status,
    ).toBe("unverified");
    expect(check).not.toHaveBeenCalled();
    let current = savedSettings;
    const active = {
      ...instance,
      checkAccess: () =>
        Effect.sync(() => {
          current = {
            ...savedSettings,
            providerInstances: {
              [instanceId]: { ...configuration, config: { binaryPath: "replacement" } },
            },
          };
          return verified;
        }),
    };
    expect(
      (
        await Effect.runPromise(
          checkProviderAccess(input).pipe(
            Effect.provide(
              registry(
                () => active,
                () => current,
              ),
            ),
          ),
        )
      ).status,
    ).toBe("unverified");
  });
});
