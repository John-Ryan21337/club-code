import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  type UnifiedSettings,
} from "@cafecode/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  __resetClientSettingsPersistenceForTests,
  getClientSettings,
  useUpdateSettings,
} from "../../hooks/useSettings";

const settingsHarness = vi.hoisted(() => ({
  config: null as {
    settings: Record<string, unknown>;
    clientSettings: Record<string, unknown>;
  } | null,
  updateClientSettings: vi.fn(),
  updateSettings: vi.fn(),
  setClientSettings: vi.fn(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({
    persistence: {
      getClientSettings: vi.fn(async () => null),
      setClientSettings: settingsHarness.setClientSettings,
    },
    server: {
      updateClientSettings: settingsHarness.updateClientSettings,
      updateSettings: settingsHarness.updateSettings,
    },
  }),
}));

vi.mock("~/rpc/serverState", () => ({
  applyClientSettingsUpdated: (clientSettings: Record<string, unknown>) => {
    if (settingsHarness.config) {
      settingsHarness.config = { ...settingsHarness.config, clientSettings };
    }
  },
  applySettingsUpdated: (settings: Record<string, unknown>) => {
    if (settingsHarness.config) {
      settingsHarness.config = { ...settingsHarness.config, settings };
    }
  },
  getServerConfig: () => settingsHarness.config,
  useServerConfig: () => settingsHarness.config,
  useServerSettings: () => settingsHarness.config?.settings ?? DEFAULT_SERVER_SETTINGS,
}));

function createDeferredPromise<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

describe("useUpdateSettings", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;
  let updateSettings: ((patch: Partial<UnifiedSettings>) => void) | null = null;
  let updateSettingsAsync: ((patch: Partial<UnifiedSettings>) => Promise<void>) | null = null;

  beforeEach(() => {
    settingsHarness.config = {
      settings: { ...DEFAULT_SERVER_SETTINGS },
      clientSettings: { ...DEFAULT_CLIENT_SETTINGS },
    };
    settingsHarness.updateClientSettings.mockReset();
    settingsHarness.updateSettings.mockReset();
    settingsHarness.setClientSettings.mockReset();
    __resetClientSettingsPersistenceForTests();
    updateSettings = null;
    updateSettingsAsync = null;
  });

  afterEach(async () => {
    await mounted?.unmount().catch(() => undefined);
    mounted = null;
    document.body.innerHTML = "";
  });

  function SettingsWriter() {
    const updater = useUpdateSettings();
    updateSettings = updater.updateSettings;
    updateSettingsAsync = updater.updateSettingsAsync;
    return null;
  }

  it("does not expose a failed confirmed write as selected", async () => {
    settingsHarness.updateClientSettings.mockRejectedValueOnce(new Error("client write failed"));
    mounted = await render(<SettingsWriter />);
    expect(updateSettingsAsync).not.toBeNull();

    await expect(updateSettingsAsync?.({ ambientImageEnabled: true })).rejects.toThrow(
      "client write failed",
    );
    expect(settingsHarness.config?.clientSettings.ambientImageEnabled).toBe(false);
    expect(settingsHarness.updateClientSettings).toHaveBeenCalledWith({
      ambientImageEnabled: true,
    });
  });

  it("does not regress a newer authoritative value when an earlier write fails", async () => {
    const firstWrite = createDeferredPromise<void>();
    settingsHarness.updateClientSettings.mockReturnValueOnce(firstWrite.promise);
    mounted = await render(<SettingsWriter />);

    const failedUpdate = updateSettingsAsync?.({ ambientImageEnabled: true });
    settingsHarness.config = {
      ...settingsHarness.config!,
      clientSettings: {
        ...settingsHarness.config!.clientSettings,
        ambientImageEnabled: false,
        ambientImageCycleSeconds: 42,
      },
    };
    firstWrite.reject(new Error("first write failed"));

    await expect(failedUpdate).rejects.toThrow("first write failed");
    expect(settingsHarness.config?.clientSettings).toMatchObject({
      ambientImageEnabled: false,
      ambientImageCycleSeconds: 42,
    });
  });

  it("serializes confirmed local writes and commits only after persistence", async () => {
    const firstWrite = createDeferredPromise<void>();
    settingsHarness.config = null;
    settingsHarness.setClientSettings
      .mockReturnValueOnce(firstWrite.promise)
      .mockResolvedValueOnce(undefined);
    mounted = await render(<SettingsWriter />);

    const firstUpdate = updateSettingsAsync?.({ ambientImageEnabled: true });
    const secondUpdate = updateSettingsAsync?.({ ambientImageCycleSeconds: 42 });
    await Promise.resolve();

    expect(settingsHarness.setClientSettings).toHaveBeenCalledTimes(1);
    expect(getClientSettings()).toEqual(DEFAULT_CLIENT_SETTINGS);

    firstWrite.resolve(undefined);
    await firstUpdate;
    await secondUpdate;

    expect(settingsHarness.setClientSettings).toHaveBeenCalledTimes(2);
    expect(getClientSettings()).toMatchObject({
      ambientImageEnabled: true,
      ambientImageCycleSeconds: 42,
    });
  });

  it("leaves local state unchanged when confirmed persistence fails", async () => {
    settingsHarness.config = null;
    settingsHarness.setClientSettings.mockRejectedValueOnce(new Error("local persistence failed"));
    mounted = await render(<SettingsWriter />);

    await expect(updateSettingsAsync?.({ ambientImageEnabled: true })).rejects.toThrow(
      "local persistence failed",
    );
    expect(getClientSettings()).toEqual(DEFAULT_CLIENT_SETTINGS);
  });

  it("preserves later optimistic local updates across an earlier confirmation", async () => {
    const confirmedWrite = createDeferredPromise<void>();
    settingsHarness.config = null;
    settingsHarness.setClientSettings
      .mockReturnValueOnce(confirmedWrite.promise)
      .mockResolvedValueOnce(undefined);
    mounted = await render(<SettingsWriter />);

    const confirmation = updateSettingsAsync?.({
      ambientImageEnabled: true,
      ambientImageCycleSeconds: 42,
    });
    await vi.waitFor(() => {
      expect(settingsHarness.setClientSettings).toHaveBeenCalledOnce();
    });

    updateSettings?.({
      ambientImageEnabled: false,
      ambientImageGlowEnabled: true,
    });
    expect(getClientSettings()).toMatchObject({
      ambientImageEnabled: false,
      ambientImageCycleSeconds: 20,
      ambientImageGlowEnabled: true,
    });

    confirmedWrite.resolve(undefined);
    await confirmation;
    await vi.waitFor(() => {
      expect(settingsHarness.setClientSettings).toHaveBeenCalledTimes(2);
    });

    expect(getClientSettings()).toMatchObject({
      ambientImageEnabled: false,
      ambientImageCycleSeconds: 42,
      ambientImageGlowEnabled: true,
    });
    expect(settingsHarness.setClientSettings.mock.calls[1]?.[0]).toMatchObject({
      ambientImageEnabled: false,
      ambientImageCycleSeconds: 42,
      ambientImageGlowEnabled: true,
    });
  });
});
