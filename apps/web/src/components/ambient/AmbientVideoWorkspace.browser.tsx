import "../../index.css";

import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@cafecode/contracts";
import { useState, useSyncExternalStore } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { AmbientVideoWorkspace, useAmbientVideoWorkspace } from "./AmbientVideoWorkspace";
import { AmbientVideoSettings } from "../settings/AmbientVideoSettings";
import { localMediaStore, DEFAULT_LOCAL_MEDIA_STATE } from "../../localMedia";
import { youtubeUrlQueueStore } from "../../youtubeQueuePlayback";

const fixture = vi.hoisted(() => ({
  settings: {} as UnifiedSettings,
  listeners: new Set<() => void>(),
  artwork: vi.fn(async () => null),
}));
vi.mock("../../hooks/useSettings", () => ({
  getClientSettings: () => fixture.settings,
  useSettings: <T,>(selector?: (settings: UnifiedSettings) => T) => {
    const settings = useSyncExternalStore(
      (listener) => {
        fixture.listeners.add(listener);
        return () => fixture.listeners.delete(listener);
      },
      () => fixture.settings,
    );
    return selector ? selector(settings) : settings;
  },
  useUpdateSettings: () => ({
    updateSettings: (patch: Partial<UnifiedSettings>) => {
      fixture.settings = { ...fixture.settings, ...patch };
      for (const listener of fixture.listeners) listener();
    },
  }),
}));
vi.mock("../../hooks/clientSettingsState", () => ({
  subscribeClientSettingsSnapshot: (listener: () => void) => {
    fixture.listeners.add(listener);
    return () => fixture.listeners.delete(listener);
  },
}));
vi.mock("../../ambientVideoGlow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ambientVideoGlow")>()),
  loadYouTubeEdgePalette: fixture.artwork,
}));

function Chat() {
  const { registerChatAnchor } = useAmbientVideoWorkspace();
  return (
    <main ref={registerChatAnchor} className="h-full min-h-0 p-4">
      Synthetic chat instructions
    </main>
  );
}

function Harness() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [environment, setEnvironment] = useState("environment-a");
  return (
    <div data-streaming-harness className="flex h-[800px] w-[1200px] flex-col">
      <div className="flex gap-3">
        <button onClick={() => setSettingsOpen((open) => !open)}>Toggle settings route</button>
        <button onClick={() => setEnvironment("environment-b")}>Switch environment</button>
      </div>
      <AmbientVideoWorkspace
        environmentScopeKey={environment}
        retainPlayerWithoutAnchor={settingsOpen}
      >
        {settingsOpen ? <AmbientVideoSettings /> : <Chat />}
      </AmbientVideoWorkspace>
    </div>
  );
}

beforeEach(async () => {
  await page.viewport(1280, 900);
  localStorage.clear();
  fixture.artwork.mockClear();
  fixture.settings = { ...DEFAULT_UNIFIED_SETTINGS };
  youtubeUrlQueueStore.stop();
  localMediaStore.clear();
  localMediaStore.update(DEFAULT_LOCAL_MEDIA_STATE);
});
afterEach(() => {
  youtubeUrlQueueStore.stop();
  localStorage.clear();
});

it("does not mount disabled embeds or load artwork and activates only canonical service URLs", async () => {
  const view = await render(<Harness />);
  expect(document.querySelector("iframe")).toBeNull();
  expect(fixture.artwork).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Toggle settings route" }).click();
  await page
    .getByRole("textbox", { name: "Streaming media link" })
    .fill("https://example.test/private?token=secret");
  await page.getByRole("button", { name: "Load player", exact: true }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Enter a supported YouTube or Spotify link.");
  expect(fixture.settings.ambientVideoSource).toBeNull();
  await page
    .getByRole("textbox", { name: "Streaming media link" })
    .fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ&token=discard-me");
  await page.getByRole("button", { name: "Load player", exact: true }).click();
  expect(fixture.settings.ambientVideoSource).toEqual({ kind: "video", id: "dQw4w9WgXcQ" });
  await page.getByRole("button", { name: "Toggle settings route" }).click();
  await expect
    .poll(() => document.querySelector("iframe")?.src)
    .toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  expect(document.querySelector("iframe")?.src).not.toContain("discard-me");
  expect(document.querySelector("iframe")?.sandbox.contains("allow-top-navigation")).toBe(false);
  await view.unmount();
});

it("retains the same frame across the settings route and replaces it at an environment boundary", async () => {
  fixture.settings = {
    ...fixture.settings,
    ambientVideoEnabled: true,
    ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
  };
  const view = await render(<Harness />);
  await expect.poll(() => document.querySelector("iframe")).not.toBeNull();
  const frame = document.querySelector("iframe")!;
  await page.getByRole("button", { name: "Toggle settings route" }).click();
  await expect
    .element(page.getByRole("heading", { name: "Streaming player", exact: true }))
    .toBeVisible();
  expect(document.querySelector("iframe")).toBe(frame);
  await page.getByRole("button", { name: "Toggle settings route" }).click();
  expect(document.querySelector("iframe")).toBe(frame);
  await page.getByRole("button", { name: "Switch environment" }).click();
  await expect.poll(() => document.querySelector("iframe") === frame).toBe(false);
  expect(frame.isConnected).toBe(false);
  await view.unmount();
});

it("enters cinema after the iframe load and Escape returns to floating without replacing the frame", async () => {
  fixture.settings = {
    ...fixture.settings,
    ambientVideoEnabled: true,
    ambientVideoPresentationMode: "cinema",
    ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
  };
  const view = await render(<Harness />);
  await expect.poll(() => document.querySelector("iframe")).not.toBeNull();
  const frame = document.querySelector("iframe")!;
  // This checks renderer load handling; it makes no claim that the remote service played media.
  frame.dispatchEvent(new Event("load"));
  await expect
    .poll(() =>
      document
        .querySelector("[data-ambient-video-presentation]")
        ?.getAttribute("data-ambient-video-presentation"),
    )
    .toBe("cinema");
  await userEvent.keyboard("{Escape}");
  await expect
    .poll(() =>
      document
        .querySelector("[data-ambient-video-presentation]")
        ?.getAttribute("data-ambient-video-presentation"),
    )
    .toBe("floating");
  expect(document.querySelector("iframe")).toBe(frame);
  await view.unmount();
});

it("uses the fixed Spotify origin and destroys playback when disabled", async () => {
  fixture.settings = {
    ...fixture.settings,
    ambientVideoEnabled: true,
    ambientVideoSource: { kind: "spotify", entityType: "track", id: "4cOdK2wGLETKBW3PvgPWqT" },
  };
  const view = await render(<Harness />);
  await expect
    .poll(() => document.querySelector("iframe")?.src)
    .toContain("https://open.spotify.com/embed/track/4cOdK2wGLETKBW3PvgPWqT");
  const frame = document.querySelector("iframe")!;
  await page.getByRole("button", { name: "Disable ambient video", exact: true }).click();
  await expect.poll(() => document.querySelector("iframe")).toBeNull();
  expect(frame.isConnected).toBe(false);
  expect(fixture.settings.ambientVideoEnabled).toBe(false);
  expect(fixture.artwork).not.toHaveBeenCalled();
  await view.unmount();
});

it("supports keyboard geometry controls without replacing the player", async () => {
  fixture.settings = {
    ...fixture.settings,
    ambientVideoEnabled: true,
    ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
  };
  const view = await render(<Harness />);
  await expect.poll(() => document.querySelector("iframe")).not.toBeNull();
  const frame = document.querySelector("iframe")!;
  const player = page.getByRole("region", { name: "Ambient streaming player" });
  const before = player.element().getBoundingClientRect();
  const move = page.getByRole("button", { name: "Move ambient video", exact: true });
  (move.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.poll(() => player.element().getBoundingClientRect().left).toBeLessThan(before.left);
  expect(fixture.settings.ambientVideoLayoutMode).toBe("custom");
  const width = player.element().getBoundingClientRect().width;
  (
    page.getByRole("button", { name: "Resize ambient video", exact: true }).element() as HTMLElement
  ).focus();
  await userEvent.keyboard("{ArrowRight}");
  await expect.poll(() => player.element().getBoundingClientRect().width).toBeGreaterThan(width);
  expect(document.querySelector("iframe")).toBe(frame);
  expect(localStorage.length).toBeGreaterThan(0);
  await view.unmount();
});

it("unmounts retained playback when the settings workspace becomes too small", async () => {
  fixture.settings = {
    ...fixture.settings,
    ambientVideoEnabled: true,
    ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
  };
  const view = await render(<Harness />);
  await expect.poll(() => document.querySelector("iframe")).not.toBeNull();
  const frame = document.querySelector("iframe")!;
  await page.getByRole("button", { name: "Toggle settings route" }).click();
  expect(document.querySelector("iframe")).toBe(frame);
  const shell = document.querySelector<HTMLElement>("[data-streaming-harness]")!;
  shell.style.width = "180px";
  await expect.poll(() => document.querySelector("iframe")).toBeNull();
  expect(frame.isConnected).toBe(false);
  await view.unmount();
});

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function silentWavFile(name = "private-session-audio.wav"): File {
  const buffer = new ArrayBuffer(45);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 37, true);
  writeAscii(view, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8_000, true);
  view.setUint32(28, 8_000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, 1, true);
  view.setUint8(44, 128);
  return new File([buffer], name, { type: "audio/wav" });
}

it("retains the local element in settings, exits cinema with Escape, and releases on environment change", async () => {
  const view = await render(<Harness />);
  expect(localMediaStore.selectFile(silentWavFile())).toBe(true);
  const player = page.getByRole("region", { name: "Local media player" });
  await expect.element(player).toBeVisible();
  const element = document.querySelector("audio")!;
  expect(element.autoplay).toBe(false);
  const source = element.src;
  await page.getByRole("button", { name: "Toggle settings route" }).click();
  expect(document.querySelector("audio")).toBe(element);
  localMediaStore.update({ presentationMode: "cinema" });
  await expect.element(player).toHaveAttribute("data-local-media-presentation", "cinema");
  await userEvent.keyboard("{Escape}");
  await expect.element(player).toHaveAttribute("data-local-media-presentation", "floating");
  expect(document.querySelector("audio")).toBe(element);
  await page.getByRole("button", { name: "Switch environment" }).click();
  await expect.poll(() => document.querySelector("audio")).toBeNull();
  expect(localMediaStore.getSnapshot().source).toBeNull();
  expect(localStorage.getItem("local-media")).toBeNull();
  await expect(fetch(source)).rejects.toThrow();
  await view.unmount();
});

it("unmounts streaming while local cinema is active and restores it after clearing local media", async () => {
  fixture.settings = {
    ...fixture.settings,
    ambientVideoEnabled: true,
    ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
  };
  const view = await render(<Harness />);
  await expect.poll(() => document.querySelector("iframe")).not.toBeNull();
  const frame = document.querySelector("iframe")!;
  expect(localMediaStore.selectFile(silentWavFile())).toBe(true);
  localMediaStore.update({ presentationMode: "cinema" });
  await expect.poll(() => document.querySelector("iframe")).toBeNull();
  expect(frame.isConnected).toBe(false);
  await page.getByRole("button", { name: "Clear local media", exact: true }).click();
  await expect.poll(() => document.querySelector("iframe")).not.toBeNull();
  expect(document.querySelector("audio")).toBeNull();
  await view.unmount();
});
