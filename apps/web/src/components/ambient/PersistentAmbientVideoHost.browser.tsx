import "../../index.css";

import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { PersistentAmbientVideoHost } from "./PersistentAmbientVideoHost";

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

function ShellNavigationHarness() {
  const [route, setRoute] = useState<"chat" | "settings">("chat");
  const [selection, setSelection] = useState("project-a/thread-a");

  return (
    <>
      <PersistentAmbientVideoHost />
      <main data-testid="route-content">
        {route}:{selection}
      </main>
      <button type="button" onClick={() => setRoute("settings")}>
        Open Settings
      </button>
      <button type="button" onClick={() => setRoute("chat")}>
        Open Chat
      </button>
      <button type="button" onClick={() => setSelection("project-b/thread-b")}>
        Select another thread
      </button>
      <button
        type="button"
        onClick={() => updateMockSettings({ ambientVideoPresentationMode: "cinema" })}
      >
        Enter cinema
      </button>
      <button type="button" onClick={() => updateMockSettings({ ambientVideoEnabled: false })}>
        Disable player
      </button>
      <button type="button" onClick={() => updateMockSettings({ ambientVideoSource: null })}>
        Clear source
      </button>
      <button type="button" onClick={() => updateMockCapability(false)}>
        Revoke capability
      </button>
    </>
  );
}

function currentFrame(): HTMLIFrameElement {
  const frame = document.querySelector<HTMLIFrameElement>(
    'iframe[title="Ambient YouTube video player"]',
  );
  expect(frame).not.toBeNull();
  return frame!;
}

describe("PersistentAmbientVideoHost", () => {
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

  it("preserves one exact iframe, parent, and source across every shell transition", async () => {
    await render(<ShellNavigationHarness />);
    const initialFrame = currentFrame();
    const initialParent = initialFrame.parentElement;
    const initialSource = initialFrame.src;
    expect(document.querySelectorAll("iframe[src*='youtube-nocookie.com']")).toHaveLength(1);

    await page.getByRole("button", { name: "Open Settings" }).click();
    expect(currentFrame()).toBe(initialFrame);
    expect(currentFrame().parentElement).toBe(initialParent);
    expect(currentFrame().src).toBe(initialSource);

    await page.getByRole("button", { name: "Open Chat" }).click();
    await page.getByRole("button", { name: "Select another thread" }).click();
    expect(currentFrame()).toBe(initialFrame);
    expect(currentFrame().parentElement).toBe(initialParent);
    expect(currentFrame().src).toBe(initialSource);

    await page.getByRole("button", { name: "Enter cinema" }).click();
    await expect
      .element(page.getByTestId("ambient-video-player"))
      .toHaveAttribute("data-presentation-mode", "cinema");
    expect(currentFrame()).toBe(initialFrame);
    expect(currentFrame().parentElement).toBe(initialParent);
    expect(currentFrame().src).toBe(initialSource);
    expect(document.querySelectorAll("iframe[src*='youtube-nocookie.com']")).toHaveLength(1);
  });

  it.each(["Disable player", "Clear source", "Revoke capability"])(
    "unmounts intentionally after %s",
    async (buttonName) => {
      await render(<ShellNavigationHarness />);
      currentFrame();
      await page.getByRole("button", { name: buttonName }).click();
      await expect.element(page.getByTitle("Ambient YouTube video player")).not.toBeInTheDocument();
    },
  );
});
