import {
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerConfig,
  type ServerProvider,
} from "@cafecode/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { interpretAtmosphereWithProvider } from "./atmosphereProvider";
import { trackServerSettingsWrite } from "./serverSettingsWriteState";

afterEach(() => vi.useRealTimers());

const provider = {
  instanceId: ProviderInstanceId.make("claude-work"),
  driver: ProviderDriverKind.make("claudeAgent"),
  enabled: true,
  installed: true,
  auth: { status: "authenticated", email: "work@example.invalid" },
  models: [{ slug: "claude-test" }],
} as unknown as ServerProvider;
const configuration = { driver: provider.driver, config: { binaryPath: "selected" } };
function harness() {
  let current = true;
  let config = {
    settings: {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: { [provider.instanceId]: configuration },
    },
    providers: [provider],
  } as unknown as ServerConfig;
  const api = {
    getConfig: vi.fn(async () => JSON.parse(JSON.stringify(config)) as ServerConfig),
    interpretAtmosphereCommand: vi.fn(async () => ({
      instanceId: provider.instanceId,
      model: "claude-test",
      status: "completed" as const,
      proposal: '{"commands":[{"kind":"set-effect","effect":"snow"}]}',
    })),
  };
  return {
    api,
    invalidate: () => {
      current = false;
    },
    setConfig: (value: ServerConfig) => {
      config = value;
    },
    get config() {
      return config;
    },
    run: () =>
      interpretAtmosphereWithProvider(
        "make it winter",
        provider,
        "claude-test",
        api,
        () => config,
        () => current,
      ),
  };
}

it("sends only the selected request/instance/model and displayed account/config, then validates the whole proposal", async () => {
  const h = harness();
  const proposal = await h.run();
  expect(proposal.commands).toEqual([{ kind: "set-effect", effect: "snow" }]);
  expect(proposal.isCurrent()).toBe(true);
  h.invalidate();
  expect(proposal.isCurrent()).toBe(false);
  expect(h.api.interpretAtmosphereCommand).toHaveBeenCalledExactlyOnceWith({
    instanceId: provider.instanceId,
    model: "claude-test",
    request: "make it winter",
    expectedAuth: provider.auth,
    expectedConfig: configuration,
  });
  expect(h.api.getConfig).toHaveBeenCalledTimes(2);
});

it.each(["connection", "account", "configuration", "write"])(
  "rejects a late result after %s changes",
  async (change) => {
    const h = harness();
    const original = h.api.interpretAtmosphereCommand.getMockImplementation()!;
    h.api.interpretAtmosphereCommand.mockImplementation(async () => {
      if (change === "connection") h.invalidate();
      if (change === "account")
        h.setConfig({
          ...h.config,
          providers: [{ ...provider, auth: { ...provider.auth, email: "other@example.invalid" } }],
        });
      if (change === "configuration")
        h.setConfig({ ...h.config, settings: { ...h.config.settings, providerInstances: {} } });
      if (change === "write") await trackServerSettingsWrite(async () => {});
      return original();
    });
    await expect(h.run()).rejects.toThrow("Nothing changed.");
  },
);

it("does not start a paid request after fresh configuration or connection mismatch", async () => {
  for (const mismatch of ["config", "connection"]) {
    const h = harness();
    h.api.getConfig.mockImplementation(async () => {
      if (mismatch === "connection") h.invalidate();
      return { ...h.config, settings: { ...h.config.settings, providerInstances: {} } };
    });
    await expect(h.run()).rejects.toThrow("Nothing changed.");
    expect(h.api.interpretAtmosphereCommand).not.toHaveBeenCalled();
  }
});

it("bounds a stalled initial config read and refuses a paid request when that read arrives late", async () => {
  vi.useFakeTimers();
  const h = harness();
  let release!: (value: ServerConfig) => void;
  h.api.getConfig.mockImplementation(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  const failure = expect(h.run()).rejects.toThrow("Nothing changed.");
  await vi.advanceTimersByTimeAsync(45_001);
  await failure;
  release(h.config);
  await vi.advanceTimersByTimeAsync(0);
  expect(h.api.interpretAtmosphereCommand).not.toHaveBeenCalled();
});

it("bounds a stalled provider response and does not resume its final config read after timeout", async () => {
  vi.useFakeTimers();
  const h = harness();
  let release!: (value: Awaited<ReturnType<typeof h.api.interpretAtmosphereCommand>>) => void;
  h.api.interpretAtmosphereCommand.mockImplementation(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  const failure = expect(h.run()).rejects.toThrow("Nothing changed.");
  await vi.advanceTimersByTimeAsync(45_001);
  await failure;
  release({
    instanceId: provider.instanceId,
    model: "claude-test",
    status: "completed",
    proposal: '{"commands":[{"kind":"set-effect","effect":"snow"}]}',
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(h.api.getConfig).toHaveBeenCalledOnce();
});

it.each(["before", "after"])(
  "refuses fresh server account changes %s interpretation even before local subscription catches up",
  async (phase) => {
    const h = harness();
    const changed = {
      ...h.config,
      providers: [{ ...provider, auth: { ...provider.auth, email: "changed@example.invalid" } }],
    };
    if (phase === "before") h.api.getConfig.mockResolvedValue(changed);
    else h.api.getConfig.mockResolvedValueOnce(h.config).mockResolvedValueOnce(changed);
    await expect(h.run()).rejects.toThrow("Nothing changed.");
    expect(h.api.interpretAtmosphereCommand).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
  },
);

it.each([
  '{"commands":[{"kind":"set-effect","effect":"snow"},{"kind":"set-effect","effect":"rain"}]}',
  '{"commands":[{"kind":"shell","command":"anything"}]}',
  '{"commands":[{"kind":"set-effect","effect":"snow"}],"extra":true}',
  "private upstream account error",
  "x".repeat(4097),
])("does not expose or apply untrusted proposal %#", async (proposal) => {
  const h = harness();
  h.api.interpretAtmosphereCommand.mockResolvedValue({
    instanceId: provider.instanceId,
    model: "claude-test",
    status: "completed",
    proposal,
  });
  await expect(h.run()).rejects.toThrow(
    "The selected provider did not return a current supported command batch. Nothing changed.",
  );
});
