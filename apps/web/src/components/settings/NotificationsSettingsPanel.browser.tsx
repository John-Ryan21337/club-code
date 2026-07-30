import "../../index.css";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const openExternal = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../env", () => ({ isElectron: true }));
vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({ shell: { openExternal } }),
}));
vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({
    notificationsEnabled: false,
    completionAlertSoundEnabled: false,
    completionAlertSpeechEnabled: true,
    completionAlertLanguage: "ja",
    completionAlertEnglishVoiceGender: "female",
    completionAlertJapaneseVoiceGender: "female",
    completionAlertDualStereoOrder: "ja-left-en-right",
  }),
  useUpdateSettings: () => ({ updateSettings: vi.fn() }),
  useClientSettingsHydrated: () => true,
}));
vi.mock("../../completionAlertFiles", () => ({
  addCompletionAlertFiles: vi.fn(),
  listCompletionAlertFiles: vi.fn(async () => []),
  removeCompletionAlertFile: vi.fn(),
}));
vi.mock("../../completionAlerts", () => ({
  playCustomCompletionAlert: vi.fn(),
  testCompletionAlerts: vi.fn(async () => []),
}));

import { NotificationsSettingsPanel } from "./NotificationsSettingsPanel";

describe("NotificationsSettingsPanel completion voices", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    Reflect.deleteProperty(window, "desktopBridge");
    document.body.innerHTML = "";
  });

  it("shows the detected English female voice, local Haruka guidance, and refreshes voice detection", async () => {
    const getCompletionSpeechCapability = vi.fn(async () => ({
      available: true,
      engine: "Windows System.Speech" as const,
      reason: null,
      voices: [
        {
          name: "Microsoft Zira Desktop",
          language: "en" as const,
          culture: "en-US",
          gender: "female" as const,
        },
      ],
    }));
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: { getCompletionSpeechCapability },
    });

    await render(<NotificationsSettingsPanel />);

    await expect.element(page.getByText(/Microsoft Zira Desktop/)).toBeInTheDocument();
    await expect.element(page.getByText(/Ayumi and Haruka/)).toBeInTheDocument();

    await page.getByRole("button", { name: "Refresh Windows voices" }).click();
    await vi.waitFor(() => expect(getCompletionSpeechCapability).toHaveBeenCalledTimes(2));

    await page.getByRole("button", { name: "Open Microsoft voice guide" }).click();
    await vi.waitFor(() => expect(openExternal).toHaveBeenCalledTimes(1));
    expect(openExternal).toHaveBeenCalledWith(
      "https://support.microsoft.com/en-us/windows/appendix-a-supported-languages-and-voices-4486e345-7730-53da-fcfe-55cc64300f01",
    );
  });

  it("does not offer Windows installation guidance on a non-Windows desktop host", async () => {
    Object.defineProperty(window, "desktopBridge", {
      configurable: true,
      value: {
        getCompletionSpeechCapability: vi.fn(async () => ({
          available: false,
          engine: "Windows System.Speech" as const,
          voices: [],
          reason: "Native stereo speech is available only in the Windows desktop app.",
        })),
      },
    });

    await render(<NotificationsSettingsPanel />);

    await expect
      .element(page.getByText("Native stereo speech is available only in the Windows desktop app."))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Open Microsoft voice guide" }))
      .not.toBeInTheDocument();
  });
});
