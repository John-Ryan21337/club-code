import "../../index.css";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { AmbientVideoWorkspace } from "./AmbientVideoWorkspace";

const mocks = vi.hoisted(() => ({
  settings: {
    ambientVideoEnabled: true,
    ambientVideoSource: {
      kind: "video" as const,
      id: "dQw4w9WgXcQ",
    } as { kind: "video"; id: string } | null,
    ambientVideoPresetPlacement: "bottom-right" as "bottom-left" | "bottom-right",
    ambientVideoPresetSize: "medium" as "small" | "medium" | "large",
    ambientVideoPresentationMode: "floating" as "floating" | "cinema",
  },
  settingsListeners: new Set<() => void>(),
  serverListeners: new Set<() => void>(),
  updateSettings: vi.fn(),
  serverConfig: {
    ambientExperienceCapabilities: {
      youtubePlayer: true as boolean,
    },
  },
}));

vi.mock("../../hooks/useSettings", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSettings: () =>
      useSyncExternalStore(
        (listener) => {
          mocks.settingsListeners.add(listener);
          return () => mocks.settingsListeners.delete(listener);
        },
        () => mocks.settings,
      ),
    useUpdateSettings: () => ({ updateSettings: mocks.updateSettings }),
  };
});

vi.mock("../../rpc/serverState", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useServerConfig: () =>
      useSyncExternalStore(
        (listener) => {
          mocks.serverListeners.add(listener);
          return () => mocks.serverListeners.delete(listener);
        },
        () => mocks.serverConfig,
      ),
  };
});

function updateMockSettings(patch: Partial<typeof mocks.settings>) {
  mocks.settings = { ...mocks.settings, ...patch };
  for (const listener of mocks.settingsListeners) listener();
}

function updateMockCapability(enabled: boolean) {
  mocks.serverConfig = {
    ambientExperienceCapabilities: {
      youtubePlayer: enabled,
    },
  };
  for (const listener of mocks.serverListeners) listener();
}

describe("AmbientVideoWorkspace", () => {
  beforeEach(() => {
    mocks.updateSettings.mockReset();
    updateMockSettings({
      ambientVideoEnabled: true,
      ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
      ambientVideoPresetPlacement: "bottom-right",
      ambientVideoPresetSize: "medium",
      ambientVideoPresentationMode: "floating",
    });
    updateMockCapability(true);
  });

  it("renders one bounded privacy-enhanced player", async () => {
    await render(<AmbientVideoWorkspace />);

    const frame = page.getByTitle("Ambient YouTube video player");
    await expect
      .element(frame)
      .toHaveAttribute(
        "src",
        expect.stringContaining("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?"),
      );
    await expect.element(frame).toHaveAttribute("allowfullscreen", "");
    await expect
      .element(frame)
      .toHaveAttribute(
        "sandbox",
        "allow-scripts allow-same-origin allow-presentation allow-popups",
      );
    expect(document.querySelectorAll("iframe[src*='youtube-nocookie.com']")).toHaveLength(1);
  });

  it("changes presentation without replacing or reparenting the iframe", async () => {
    await render(<AmbientVideoWorkspace />);
    const initialFrame = document.querySelector<HTMLIFrameElement>(
      'iframe[title="Ambient YouTube video player"]',
    );
    const initialParent = initialFrame?.parentElement;
    const initialSource = initialFrame?.src;

    updateMockSettings({ ambientVideoPresentationMode: "cinema" });

    await expect
      .element(page.getByTestId("ambient-video-player"))
      .toHaveAttribute("data-presentation-mode", "cinema");
    const currentFrame = document.querySelector<HTMLIFrameElement>(
      'iframe[title="Ambient YouTube video player"]',
    );
    expect(currentFrame).toBe(initialFrame);
    expect(currentFrame?.parentElement).toBe(initialParent);
    expect(currentFrame?.src).toBe(initialSource);
  });

  it("fails closed when the server capability is revoked", async () => {
    await render(<AmbientVideoWorkspace />);
    updateMockCapability(false);
    await expect.element(page.getByTestId("ambient-video-player")).not.toBeInTheDocument();
  });

  it("persists disable intent through the settings update boundary", async () => {
    await render(<AmbientVideoWorkspace />);
    await page.getByRole("button", { name: "Close ambient YouTube player" }).click();
    expect(mocks.updateSettings).toHaveBeenCalledWith({ ambientVideoEnabled: false });
  });
});
