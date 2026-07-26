import "../../index.css";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { AmbientVideoSettings } from "./AmbientVideoSettings";

const mocks = vi.hoisted(() => ({
  settings: {
    ambientVideoEnabled: true,
    ambientVideoSource: {
      kind: "video" as const,
      id: "dQw4w9WgXcQ",
    },
    ambientVideoPresetPlacement: "bottom-right" as const,
    ambientVideoPresetSize: "medium" as const,
    ambientVideoPresentationMode: "floating" as const,
  },
  updateSettings: vi.fn(),
  serverConfig: {
    ambientExperienceCapabilities: {
      youtubePlayer: true,
    },
  },
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => mocks.settings,
  useUpdateSettings: () => ({ updateSettings: mocks.updateSettings }),
}));

vi.mock("../../rpc/serverState", () => ({
  useServerConfig: () => mocks.serverConfig,
}));

describe("AmbientVideoSettings", () => {
  beforeEach(() => {
    mocks.updateSettings.mockReset();
  });

  it("exposes persisted presentation and enable controls without playback claims", async () => {
    await render(<AmbientVideoSettings />);

    await expect.element(page.getByText("Ambient YouTube")).toBeInTheDocument();
    await expect.element(page.getByLabelText("Ambient YouTube URL")).toBeInTheDocument();
    await page.getByText("Cinema", { exact: true }).click();
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      ambientVideoPresentationMode: "cinema",
    });
    await page.getByLabelText("Show ambient YouTube player").click();
    expect(mocks.updateSettings).toHaveBeenCalledWith({ ambientVideoEnabled: false });
  });

  it("resets the complete player preference atomically", async () => {
    await render(<AmbientVideoSettings />);
    await page.getByLabelText("Reset ambient YouTube to default").click();

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      ambientVideoEnabled: false,
      ambientVideoSource: null,
      ambientVideoPresetPlacement: "bottom-right",
      ambientVideoPresetSize: "medium",
      ambientVideoPresentationMode: "floating",
    });
  });
});
