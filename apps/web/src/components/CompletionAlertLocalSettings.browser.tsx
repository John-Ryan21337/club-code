import { DEFAULT_CLIENT_SETTINGS, DEFAULT_SERVER_SETTINGS } from "@cafecode/contracts";
import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import {
  __resetClientSettingsPersistenceForTests,
  getClientSettings,
  useSettings,
  useUpdateSettings,
  useLocalClientSettingsHydrated,
} from "../hooks/useSettings";

const fixture = vi.hoisted(() => ({
  getPersisted: vi.fn(),
  setPersisted: vi.fn(),
  updateShared: vi.fn(),
}));
const config = {
  clientSettings: { ...DEFAULT_CLIENT_SETTINGS, completionAlertSpeechEnabled: true },
};
vi.mock("../localApi", () => ({
  ensureLocalApi: () => ({
    persistence: {
      getClientSettings: fixture.getPersisted,
      setClientSettings: fixture.setPersisted,
    },
    server: { updateClientSettings: fixture.updateShared },
  }),
}));
vi.mock("../rpc/serverState", () => ({
  getServerConfig: () => config,
  useServerConfig: () => config,
  useServerSettings: () => DEFAULT_SERVER_SETTINGS,
  applyClientSettingsUpdated: vi.fn(),
  applySettingsUpdated: vi.fn(),
}));
beforeEach(() => {
  __resetClientSettingsPersistenceForTests();
  fixture.getPersisted
    .mockReset()
    .mockResolvedValue({ ...DEFAULT_CLIENT_SETTINGS, sidebarThreadPreviewCount: 9 });
  fixture.setPersisted.mockReset().mockResolvedValue(undefined);
  fixture.updateShared.mockReset().mockResolvedValue(undefined);
});

function Control() {
  const enabled = useSettings((settings) => settings.completionAlertSpeechEnabled);
  const { updateSettings } = useUpdateSettings();
  return (
    <button
      onClick={() =>
        updateSettings({ completionAlertSpeechEnabled: true, completionAlertLanguage: "ja" })
      }
    >
      {enabled ? "Local speech enabled" : "Local speech disabled"}
    </button>
  );
}

function HydrationProbe() {
  const hydrated = useLocalClientSettingsHydrated();
  return <span>{hydrated ? "Audio baseline ready" : "Audio baseline waiting"}</span>;
}

it("waits for device preference hydration even when shared server settings already exist", async () => {
  let finish!: (value: typeof DEFAULT_CLIENT_SETTINGS) => void;
  fixture.getPersisted.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const screen = await render(<HydrationProbe />);
  try {
    await expect.element(screen.getByText("Audio baseline waiting", { exact: true })).toBeVisible();
  } finally {
    finish(DEFAULT_CLIENT_SETTINGS);
  }
  await expect.element(screen.getByText("Audio baseline ready", { exact: true })).toBeVisible();
});

it("does not inherit server audio activation and saves an explicit choice only on this device", async () => {
  await render(<Control />);
  await expect.element(page.getByRole("button", { name: "Local speech disabled" })).toBeVisible();
  expect(getClientSettings().completionAlertSpeechEnabled).toBe(false);
  // Cafe can import other pre-existing local preferences during first hydration.
  await expect
    .poll(() => fixture.updateShared.mock.calls.at(-1)?.[0]?.sidebarThreadPreviewCount)
    .toBe(9);
  expect(fixture.updateShared.mock.calls.at(-1)?.[0]).not.toHaveProperty(
    "completionAlertSpeechEnabled",
  );
  fixture.updateShared.mockClear();
  await page.getByRole("button").click();
  await expect.element(page.getByRole("button", { name: "Local speech enabled" })).toBeVisible();
  await expect
    .poll(() => fixture.setPersisted.mock.calls.at(-1)?.[0])
    .toMatchObject({
      completionAlertSpeechEnabled: true,
      completionAlertLanguage: "ja",
      sidebarThreadPreviewCount: 9,
    });
  expect(fixture.updateShared).not.toHaveBeenCalled();
  expect(config.clientSettings.completionAlertLanguage).toBe("en");
});
