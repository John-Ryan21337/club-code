import {
  DEFAULT_UNIFIED_SETTINGS,
  type UnifiedSettings,
  type ClientSettings,
  type ClientSettingsPatch,
} from "@cafecode/contracts/settings";
import type { HardwareLightingStatus } from "@cafecode/contracts";
import { EnvironmentId } from "@cafecode/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { HardwareLightingSettings } from "./HardwareLightingSettings";
import "../../index.css";

const fixture = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  environmentId: null as EnvironmentId | null,
  connection: null as {
    client: {
      server: {
        getHardwareLightingStatus: ReturnType<typeof vi.fn<() => Promise<HardwareLightingStatus>>>;
        refreshHardwareLighting: ReturnType<typeof vi.fn<() => Promise<HardwareLightingStatus>>>;
        updateClientSettings: ReturnType<
          typeof vi.fn<(patch: ClientSettingsPatch) => Promise<ClientSettings>>
        >;
      };
    };
  } | null,
  listeners: new Set<() => void>(),
  saved: vi.fn(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => fixture.settings ?? DEFAULT_UNIFIED_SETTINGS,
}));
vi.mock("../../environments/primary", () => ({
  usePrimaryEnvironmentId: () => fixture.environmentId,
}));
vi.mock("../../environments/runtime", () => ({
  readEnvironmentConnection: () => fixture.connection,
  subscribeEnvironmentConnections: (listener: () => void) => {
    fixture.listeners.add(listener);
    return () => fixture.listeners.delete(listener);
  },
}));
vi.mock("../../rpc/serverState", () => ({
  applyClientSettingsUpdated: (settings: ClientSettings) => {
    fixture.saved(settings);
    fixture.settings = { ...DEFAULT_UNIFIED_SETTINGS, ...settings };
  },
}));

const status: HardwareLightingStatus = {
  state: "disabled",
  adapter: "OpenRGB SDK (loopback)",
  detail: "Hardware lighting sync is off.",
  protocolVersion: null,
  controllers: [
    {
      id: "a".repeat(16),
      name: "Synthetic LEDs",
      vendor: "Fixture",
      type: "led-strip",
      ledCount: 8,
      supported: true,
    },
  ],
  selectedControllerCount: 0,
  lastFrameAt: null,
  lastDisposition: null,
};

function connection() {
  return {
    client: {
      server: {
        getHardwareLightingStatus: vi
          .fn<() => Promise<HardwareLightingStatus>>()
          .mockResolvedValue(status),
        refreshHardwareLighting: vi
          .fn<() => Promise<HardwareLightingStatus>>()
          .mockResolvedValue(status),
        updateClientSettings: vi
          .fn<(patch: ClientSettingsPatch) => Promise<ClientSettings>>()
          .mockImplementation(async (patch) => ({ ...DEFAULT_UNIFIED_SETTINGS, ...patch })),
      },
    },
  };
}

describe("HardwareLightingSettings", () => {
  beforeEach(() => {
    fixture.environmentId = EnvironmentId.make("lighting-primary");
    fixture.settings = { ...DEFAULT_UNIFIED_SETTINGS };
    fixture.saved.mockReset();
    fixture.connection = connection();
  });

  it("reads cached status without discovering devices and requires explicit discovery", async () => {
    await render(<HardwareLightingSettings />);
    await expect
      .element(page.getByRole("checkbox", { name: "Synthetic LEDs · 8 LEDs" }))
      .toBeEnabled();
    expect(fixture.connection!.client.server.refreshHardwareLighting).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Refresh devices" }).click();
    await expect
      .poll(() => fixture.connection!.client.server.refreshHardwareLighting.mock.calls.length)
      .toBe(1);
    expect(fixture.saved).not.toHaveBeenCalled();
  });

  it("keeps the saved switch off until the exact write is confirmed", async () => {
    let resolve!: (value: ClientSettings) => void;
    fixture.connection!.client.server.updateClientSettings.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render(<HardwareLightingSettings />);
    const toggle = page.getByRole("switch", { name: "Sync Matrix hardware lighting" });
    await expect.element(toggle).toBeEnabled();
    await toggle.click();
    await expect.element(toggle).toBeDisabled();
    await expect.element(toggle).not.toBeChecked();
    expect(fixture.saved).not.toHaveBeenCalled();
    expect(fixture.connection!.client.server.updateClientSettings).toHaveBeenCalledExactlyOnceWith({
      hardwareLightingSyncEnabled: true,
    });
    resolve({ ...DEFAULT_UNIFIED_SETTINGS, hardwareLightingSyncEnabled: true });
    await expect.element(page.getByRole("status")).toHaveTextContent("Lighting settings saved.");
    await expect.element(toggle).toBeChecked();
  });

  it("does not claim or expose a failed settings write", async () => {
    fixture.connection!.client.server.updateClientSettings.mockRejectedValue(
      new Error("private-host-details"),
    );
    await render(<HardwareLightingSettings />);
    const toggle = page.getByRole("switch", { name: "Sync Matrix hardware lighting" });
    await expect.element(toggle).toBeEnabled();
    await toggle.click();
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("The operation was not confirmed.");
    await expect.element(toggle).not.toBeChecked();
    await expect.element(page.getByText("private-host-details")).not.toBeInTheDocument();
    expect(fixture.saved).not.toHaveBeenCalled();
  });

  it("discards a pending write response from a replaced connection", async () => {
    let resolve!: (value: ClientSettings) => void;
    fixture.connection!.client.server.updateClientSettings.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await render(<HardwareLightingSettings />);
    const toggle = page.getByRole("switch", { name: "Sync Matrix hardware lighting" });
    await expect.element(toggle).toBeEnabled();
    await toggle.click();
    await expect.element(toggle).toBeDisabled();
    fixture.connection = connection();
    for (const notify of fixture.listeners) notify();
    await expect.element(toggle).toBeEnabled();
    resolve({ ...DEFAULT_UNIFIED_SETTINGS, hardwareLightingSyncEnabled: true });
    await new Promise((done) => setTimeout(done, 20));
    expect(fixture.saved).not.toHaveBeenCalled();
    await expect.element(toggle).not.toBeChecked();
  });

  it("does not send a stale control action before a connection-change render", async () => {
    const oldConnection = fixture.connection!;
    await render(<HardwareLightingSettings />);
    const toggle = page.getByRole("switch", { name: "Sync Matrix hardware lighting" });
    await expect.element(toggle).toBeEnabled();
    // The registry changes synchronously before its subscribers render again.
    fixture.connection = connection();
    await toggle.click();
    expect(oldConnection.client.server.updateClientSettings).not.toHaveBeenCalled();
    expect(fixture.connection.client.server.updateClientSettings).not.toHaveBeenCalled();
  });
});
