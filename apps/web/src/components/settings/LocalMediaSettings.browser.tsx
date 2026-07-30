import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { DesktopBridge } from "@cafecode/contracts";

import { localMediaStore } from "../../localMedia";
import { LocalMediaSettings } from "./LocalMediaSettings";

vi.mock("../../milkdropVisualizer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../milkdropVisualizer")>();
  return {
    ...actual,
    loadMilkdropPresetNames: async () =>
      Array.from(
        { length: 395 },
        (_, index) => `Bundled preset ${String(index + 1).padStart(3, "0")}`,
      ),
  };
});

function localAudioFile(): File {
  return new File(["local-only"], "midnight-set.mp3", { type: "audio/mpeg" });
}

function localVideoFile(): File {
  return new File(["local-only"], "night-drive.mp4", { type: "video/mp4" });
}

beforeEach(() => {
  localMediaStore.clear();
});

afterEach(() => {
  localMediaStore.clear();
  Reflect.deleteProperty(window, "desktopBridge");
});

it("loads the local preset browser and keeps visualizer controls in session state", async () => {
  expect(localMediaStore.selectFile(localAudioFile())).toBe(true);
  localMediaStore.update({
    visualizerEnabled: true,
    visualizerStyle: "milkdrop",
  });
  const screen = await render(<LocalMediaSettings />);

  try {
    await expect.element(page.getByLabelText("MilkDrop preset", { exact: true })).toBeEnabled();
    await expect.element(page.getByText("395 bundled presets, loaded locally")).toBeVisible();

    await page.getByLabelText("MilkDrop preset", { exact: true }).fill("Bundled preset 022");
    expect(localMediaStore.getSnapshot().visualizerPresetName).toBe("Bundled preset 022");
    await page.getByRole("button", { name: "Previous preset" }).click();
    expect(localMediaStore.getSnapshot().visualizerPresetName).toBe("Bundled preset 021");

    await page.getByLabelText("MilkDrop auto-cycle interval").fill("75");
    expect(localMediaStore.getSnapshot().visualizerCycleSeconds).toBe(75);

    await page.getByLabelText("MilkDrop preset blend duration").fill("6.5");
    expect(localMediaStore.getSnapshot().visualizerBlendSeconds).toBe(6.5);

    await expect.element(page.getByText(/Rapid motion and flashing imagery/)).toBeVisible();
    expect(localStorage.getItem("local-media")).toBeNull();
  } finally {
    await screen.unmount();
  }
});

it("offers bounded adaptive edge colors only for selected video", async () => {
  expect(localMediaStore.selectFile(localVideoFile())).toBe(true);
  const screen = await render(<LocalMediaSettings />);

  try {
    await page.getByLabelText("Enable local media glow").click();
    const mode = page.getByLabelText("Local media glow mode");
    await expect.element(mode).toBeEnabled();
    await mode.selectOptions("adaptive");
    expect(localMediaStore.getSnapshot()).toMatchObject({
      glowEnabled: true,
      glowMode: "adaptive",
    });
    await expect.element(page.getByText(/tiny current frame/)).toBeVisible();
  } finally {
    await screen.unmount();
  }
});

it("keeps adaptive frame sampling unavailable for audio-only media", async () => {
  expect(localMediaStore.selectFile(localAudioFile())).toBe(true);
  const screen = await render(<LocalMediaSettings />);

  try {
    await page.getByLabelText("Enable local media glow").click();
    await expect.element(page.getByLabelText("Local media glow mode")).toBeDisabled();
  } finally {
    await screen.unmount();
  }
});

it("accepts a multi-file direct queue and reports its session-only position", async () => {
  const screen = await render(<LocalMediaSettings />);

  try {
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Choose local audio or video"]',
    );
    expect(input).not.toBeNull();
    expect(input?.multiple).toBe(true);
    const transfer = new DataTransfer();
    transfer.items.add(new File(["one"], "first.mp3", { type: "audio/mpeg" }));
    transfer.items.add(new File(["two"], "second.mp3", { type: "audio/mpeg" }));
    Object.defineProperty(input, "files", { configurable: true, value: transfer.files });
    input?.dispatchEvent(new Event("change", { bubbles: true }));

    await expect.element(page.getByText(/Current: first \(1\/2\) via browser/)).toBeVisible();
    expect(localMediaStore.getSnapshot().queue).toEqual({ currentIndex: 0, totalItems: 2 });
  } finally {
    await screen.unmount();
  }
});

it("opens broad-format local media through an opaque desktop VLC session", async () => {
  const sessionId = "s".repeat(43);
  const releaseLocalMedia = vi.fn<DesktopBridge["releaseLocalMedia"]>().mockResolvedValue(true);
  window.desktopBridge = {
    getLocalMediaCapability: vi.fn().mockResolvedValue({
      available: true,
      engine: { label: "VLC", version: null, reason: null },
    }),
    pickLocalMedia: vi.fn().mockResolvedValue({
      sessionId,
      kind: "video",
      displayTitle: "opening-night.flv",
      playbackUrl: `cafecode-media://stream/${"p".repeat(43)}`,
      currentIndex: 1,
      totalItems: 3,
      engine: { label: "VLC", version: null, reason: null },
    }),
    releaseLocalMedia,
  } as unknown as DesktopBridge;

  const screen = await render(<LocalMediaSettings />);
  try {
    const openWithVlc = page.getByRole("button", { name: "VLC queue" });
    await expect.element(openWithVlc).toBeEnabled();
    await openWithVlc.click();

    expect(localMediaStore.getSnapshot().source).toEqual({
      kind: "video",
      objectUrl: `cafecode-media://stream/${"p".repeat(43)}`,
      displayTitle: "opening-night.flv",
      engine: "vlc",
      sessionId,
    });
    await expect
      .element(page.getByText(/Current: opening-night\.flv \(2\/3\) via VLC/))
      .toBeVisible();
  } finally {
    await screen.unmount();
  }
});

it("releases a stale VLC result when a newer local-file choice wins", async () => {
  const sessionId = "v".repeat(43);
  let resolvePick!: (value: Awaited<ReturnType<DesktopBridge["pickLocalMedia"]>>) => void;
  const pickLocalMedia = vi.fn<DesktopBridge["pickLocalMedia"]>(
    async () =>
      await new Promise((resolve) => {
        resolvePick = resolve;
      }),
  );
  const releaseLocalMedia = vi.fn<DesktopBridge["releaseLocalMedia"]>().mockResolvedValue(true);
  window.desktopBridge = {
    getLocalMediaCapability: vi.fn().mockResolvedValue({
      available: true,
      engine: { label: "VLC", version: null, reason: null },
    }),
    pickLocalMedia,
    releaseLocalMedia,
  } as unknown as DesktopBridge;

  const screen = await render(<LocalMediaSettings />);
  try {
    await page.getByRole("button", { name: "VLC queue" }).click();
    await vi.waitFor(() => expect(pickLocalMedia).toHaveBeenCalledTimes(1));
    expect(localMediaStore.selectFile(localAudioFile())).toBe(true);
    resolvePick({
      sessionId,
      kind: "video",
      displayTitle: "stale.flv",
      playbackUrl: `cafecode-media://stream/${sessionId}`,
      currentIndex: 0,
      totalItems: 1,
      engine: { label: "VLC", version: null, reason: null },
    });

    await vi.waitFor(() => expect(releaseLocalMedia).toHaveBeenCalledWith({ sessionId }));
    expect(localMediaStore.getSnapshot().source).toMatchObject({
      engine: "browser",
      displayTitle: "midnight-set",
    });
  } finally {
    await screen.unmount();
  }
});
