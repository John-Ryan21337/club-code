import {
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerProvider,
  type ProviderInstanceConfig,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect, it, vi } from "vitest";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ProviderInstanceRegistry } from "./Services/ProviderInstanceRegistry.ts";
import type { ProviderInstance } from "./ProviderDriver.ts";
import { interpretProviderAtmosphere } from "./providerAtmosphereInterpreter.ts";

const instanceId = ProviderInstanceId.make("claude-work");
const driver = ProviderDriverKind.make("claudeAgent");
const config: ProviderInstanceConfig = {
  driver,
  enabled: true,
  config: { binaryPath: "selected-claude" },
};
const input = {
  instanceId,
  model: "claude-test",
  request: "make it winter",
  expectedAuth: { status: "authenticated" as const, email: "work@example.invalid" },
  expectedConfig: config,
};
const success = {
  status: "completed" as const,
  proposal: '{"commands":[{"kind":"set-effect","effect":"snow"}]}',
};
function harness() {
  const state = {
    config,
    capability: true,
    auth: input.expectedAuth,
    installed: true,
  };
  const interpret = vi.fn(() => Effect.succeed(success));
  let active: ProviderInstance = {
    instanceId,
    driverKind: driver,
    enabled: true,
    interpretAtmosphere: interpret,
    snapshot: {
      getSnapshot: Effect.sync(
        () =>
          ({
            installed: state.installed,
            auth: state.auth,
            models: [{ slug: input.model }],
          }) as unknown as ServerProvider,
      ),
    },
  } as unknown as ProviderInstance;
  const getInstance = vi.fn((_id: ProviderInstanceId, expected?: ProviderInstanceConfig) =>
    expected === state.config ? active : undefined,
  );
  const layer = Layer.mergeAll(
    Layer.mock(ServerConfig)({ ambientExperienceCapabilities: { atmosphere: true } } as never),
    Layer.mock(ServerSettingsService)({
      getSettings: Effect.sync(() => ({
        ...DEFAULT_SERVER_SETTINGS,
        providerInstances: { [instanceId]: state.config },
      })),
    }),
    Layer.mock(ProviderInstanceRegistry)({
      getInstance: (id, expected) =>
        Effect.sync(() => (id === instanceId ? getInstance(id, expected) : undefined)),
    }),
  );
  return {
    state,
    interpret,
    getInstance,
    setInstance: (next: ProviderInstance) => {
      active = next;
    },
    get active() {
      return active;
    },
    run: (next = input) =>
      Effect.runPromise(interpretProviderAtmosphere(next).pipe(Effect.provide(layer))),
  };
}

it("routes only the saved exact instance and model, with a JSON-roundtripped displayed config", async () => {
  const h = harness();
  expect(await h.run({ ...input, expectedConfig: JSON.parse(JSON.stringify(config)) })).toEqual({
    instanceId,
    model: input.model,
    ...success,
  });
  expect(h.interpret).toHaveBeenCalledExactlyOnceWith(input.request, input.model);
  expect(h.getInstance).toHaveBeenCalledWith(instanceId, config);
});

it("refuses a stale displayed account, config, unavailable model or disabled instance before any request", async () => {
  for (const change of [
    { ...input, expectedAuth: { ...input.expectedAuth, email: "other@example.invalid" } },
    { ...input, expectedConfig: { ...config, config: { binaryPath: "other" } } },
    { ...input, model: "unlisted" },
  ]) {
    const h = harness();
    expect((await h.run(change)).status).toBe("stale");
    expect(h.interpret).not.toHaveBeenCalled();
  }
  const h = harness();
  h.setInstance({ ...h.active, enabled: false });
  expect((await h.run()).status).toBe("stale");
  expect(h.interpret).not.toHaveBeenCalled();
});

it("reports Codex unsupported without invoking generic text generation", async () => {
  const h = harness();
  h.setInstance({ ...h.active, driverKind: ProviderDriverKind.make("codex") });
  expect((await h.run()).status).toBe("unsupported");
  expect(h.interpret).not.toHaveBeenCalled();
});

it.each(["account", "config", "instance"])(
  "discards a completed response after %s changes",
  async (change) => {
    const h = harness();
    h.interpret.mockImplementation(() =>
      Effect.sync(() => {
        if (change === "account")
          h.state.auth = { ...input.expectedAuth, email: "changed@example.invalid" };
        if (change === "config") h.state.config = { ...config, config: { binaryPath: "changed" } };
        if (change === "instance") h.setInstance({ ...h.active });
        return success;
      }),
    );
    expect(await h.run()).toEqual({ instanceId, model: input.model, status: "stale" });
  },
);

it("returns fixed failure fields without request, auth or raw provider error", async () => {
  const h = harness();
  h.interpret.mockImplementation(() => Effect.die(new Error("private account detail")));
  expect(await h.run()).toEqual({ instanceId, model: input.model, status: "unavailable" });
});
