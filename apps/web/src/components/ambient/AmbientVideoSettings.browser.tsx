import "../../index.css";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { AmbientVideoSettings } from "./AmbientVideoSettings";

const mocks = vi.hoisted(() => ({
  settings: {
    ambientVideoEnabled: true,
    ambientVideoSource: {
      kind: "video" as const,
      id: "dQw4w9WgXcQ",
    } as { kind: "video"; id: string } | null,
    ambientVideoPresetPlacement: "bottom-right" as const,
    ambientVideoPresetSize: "medium" as const,
    ambientVideoPresentationMode: "floating" as const,
    ambientVideoKeepAboveContent: true,
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
    mocks.settings.ambientVideoEnabled = true;
    mocks.settings.ambientVideoSource = {
      kind: "video",
      id: "dQw4w9WgXcQ",
    };
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
    await page.getByLabelText("Keep ambient YouTube above app content").click();
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      ambientVideoKeepAboveContent: false,
    });
  });

  it("resets the complete player preference atomically", async () => {
    await render(<AmbientVideoSettings />);
    const input = page.getByLabelText("Ambient YouTube URL");
    await input.fill("invalid");
    await userEvent.keyboard("{Enter}");
    await expect.element(input).toHaveAttribute("aria-invalid", "true");

    mocks.updateSettings.mockClear();
    await page.getByLabelText("Reset ambient YouTube to default").click();

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      ambientVideoEnabled: false,
      ambientVideoSource: null,
      ambientVideoPresetPlacement: "bottom-right",
      ambientVideoPresetSize: "medium",
      ambientVideoPresentationMode: "floating",
      ambientVideoKeepAboveContent: false,
    });
    await expect.element(input).not.toHaveAttribute("aria-invalid");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the working source and reports an invalid replacement accessibly", async () => {
    await render(<AmbientVideoSettings />);
    const input = page.getByLabelText("Ambient YouTube URL");

    await input.fill("https://example.com/not-youtube");
    await userEvent.keyboard("{Enter}");

    expect(mocks.updateSettings).not.toHaveBeenCalled();
    await expect.element(input).toHaveValue("https://example.com/not-youtube");
    await expect.element(input).toHaveAttribute("aria-invalid", "true");
    await expect.element(input).toHaveAttribute("aria-describedby", "ambient-youtube-url-error");
    await expect
      .element(page.getByRole("alert"))
      .toHaveAttribute("id", "ambient-youtube-url-error");
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent(
        "That is not a supported YouTube video or playlist. The current player was not changed.",
      );

    await input.fill("https://youtu.be/dQw4w9WgXcQ");
    await userEvent.keyboard("{Enter}");

    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
    });
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });

  it("clears a stale error when an edit restores the exact persisted value", async () => {
    await render(<AmbientVideoSettings />);
    const input = page.getByLabelText("Ambient YouTube URL");

    await input.fill("invalid");
    await userEvent.keyboard("{Enter}");
    await expect.element(input).toHaveAttribute("aria-invalid", "true");

    mocks.updateSettings.mockClear();
    await input.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await expect.element(input).not.toHaveAttribute("aria-invalid");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");

    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("clears a stale error when an edit returns to an already-empty persisted value", async () => {
    mocks.settings.ambientVideoEnabled = false;
    mocks.settings.ambientVideoSource = null;
    await render(<AmbientVideoSettings />);
    const input = page.getByLabelText("Ambient YouTube URL");

    await input.fill("invalid");
    await userEvent.keyboard("{Enter}");
    await expect.element(input).toHaveAttribute("aria-invalid", "true");

    mocks.updateSettings.mockClear();
    await input.fill("");
    await expect.element(input).not.toHaveAttribute("aria-invalid");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");

    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("clears a stale error when the persisted source changes externally", async () => {
    const screen = await render(<AmbientVideoSettings />);
    const input = page.getByLabelText("Ambient YouTube URL");
    await input.fill("invalid");
    await userEvent.keyboard("{Enter}");
    await expect.element(input).toHaveAttribute("aria-invalid", "true");

    mocks.settings.ambientVideoSource = {
      kind: "video",
      id: "M7lc1UVf-VE",
    };
    await screen.rerender(<AmbientVideoSettings />);

    await expect.element(input).toHaveValue("https://www.youtube.com/watch?v=M7lc1UVf-VE");
    await expect.element(input).not.toHaveAttribute("aria-invalid");
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  });

  it("treats an intentionally cleared URL as a request to stop and clear the player", async () => {
    await render(<AmbientVideoSettings />);
    const input = page.getByLabelText("Ambient YouTube URL");

    await input.fill("");
    await userEvent.keyboard("{Enter}");

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      ambientVideoSource: null,
      ambientVideoEnabled: false,
    });
    await expect.element(input).not.toHaveAttribute("aria-invalid");
  });
});
