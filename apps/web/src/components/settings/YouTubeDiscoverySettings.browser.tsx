import "../../index.css";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { DEFAULT_UNIFIED_SETTINGS } from "@cafecode/contracts";
import { YouTubeDiscoverySettings } from "./YouTubeDiscoverySettings";
import { AmbientVideoSettings } from "./AmbientVideoSettings";
import { youtubeUrlQueueStore } from "../../youtubeQueuePlayback";
import { YouTubeDiscoveryError } from "../../youtubeDiscovery";

const harness = vi.hoisted(() => ({ search: vi.fn(), connection: {}, updateSettings: vi.fn() }));
vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => DEFAULT_UNIFIED_SETTINGS,
  useUpdateSettings: () => ({ updateSettings: harness.updateSettings }),
}));
vi.mock("../ambient/AmbientVideoWorkspace", () => ({
  useAmbientVideoWorkspace: () => ({ environmentScopeKey: "synthetic-environment" }),
}));
vi.mock("../../youtubeDiscovery", async (original) => ({
  ...(await original<typeof import("../../youtubeDiscovery")>()),
  searchYouTube: harness.search,
}));
vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => harness.connection,
}));
const video = { kind: "video", id: "dQw4w9WgXcQ", title: "Synthetic search result" };

beforeEach(async () => {
  harness.search.mockReset();
  harness.updateSettings.mockReset();
  harness.connection = {};
  await page.viewport(900, 800);
});
afterEach(() => {
  youtubeUrlQueueStore.stop();
  vi.restoreAllMocks();
});
async function search() {
  await page.getByLabelText("Public YouTube search").fill("synthetic query");
  await page.getByRole("button", { name: "Search", exact: true }).click();
}

describe("YouTubeDiscoverySettings", () => {
  it.each([
    { kind: "video", id: "dQw4w9WgXcQ" },
    { kind: "playlist", id: "PL_SYNTHETIC_123" },
  ])(
    "loads a selected $kind through the real settings owner and stops the old queue",
    async (source) => {
      harness.search.mockResolvedValue([{ ...source, title: "Synthetic selection" }]);
      youtubeUrlQueueStore.start(
        { name: "Old queue", videoIds: [video.id] },
        "synthetic-environment",
      );
      const screen = await render(<AmbientVideoSettings />);
      await search();
      await expect.element(page.getByText("Synthetic selection")).toBeVisible();
      expect(harness.updateSettings).not.toHaveBeenCalled();
      expect(youtubeUrlQueueStore.getSnapshot().active).toBe(true);
      await page.getByRole("button", { name: `Load ${source.kind}`, exact: true }).click();
      expect(harness.updateSettings).toHaveBeenCalledExactlyOnceWith({
        ambientVideoSource: source,
        ambientVideoEnabled: true,
      });
      expect(youtubeUrlQueueStore.getSnapshot().active).toBe(false);
      await screen.unmount();
    },
  );

  it("keeps long result titles and both selection controls inside a narrow settings row", async () => {
    await page.viewport(320, 800);
    harness.search.mockResolvedValue([
      { ...video, title: "A".repeat(200) },
      { kind: "playlist", id: "PL_SYNTHETIC_123", title: "日本語の合成プレイリスト ".repeat(10) },
    ]);
    const screen = await render(
      <div style={{ width: 320 }}>
        <YouTubeDiscoverySettings environmentScopeKey="first" onSelect={vi.fn()} />
      </div>,
    );
    await search();
    await expect.element(page.getByRole("button", { name: "Load playlist" })).toBeVisible();
    for (const element of document.querySelectorAll(
      '[aria-label="YouTube search results"], [aria-label="YouTube search results"] li, [aria-label="YouTube search results"] button',
    )) {
      const bounds = element.getBoundingClientRect();
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(320);
    }
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    await screen.unmount();
  });

  it("waits for Search and loads only canonical selected source data", async () => {
    harness.search.mockResolvedValue([video]);
    const onSelect = vi.fn();
    const screen = await render(
      <YouTubeDiscoverySettings environmentScopeKey="first" onSelect={onSelect} />,
    );
    expect(harness.search).not.toHaveBeenCalled();
    await search();
    await expect.element(page.getByText(video.title)).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();
    await page.getByRole("button", { name: "Load video" }).click();
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ kind: "video", id: video.id });
    await screen.unmount();
  });

  it.each(["cancel", "environment", "connection", "unmount"])(
    "rejects a late result after %s",
    async (ending) => {
      let release!: (value: unknown) => void;
      let signal!: AbortSignal;
      harness.search.mockImplementation((_query, options) => {
        signal = options.signal;
        return new Promise((resolve) => {
          release = resolve;
        });
      });
      const onSelect = vi.fn();
      const screen = await render(
        <YouTubeDiscoverySettings environmentScopeKey="first" onSelect={onSelect} />,
      );
      await search();
      if (ending === "cancel") await page.getByRole("button", { name: "Cancel search" }).click();
      if (ending === "environment")
        await screen.rerender(
          <YouTubeDiscoverySettings environmentScopeKey="second" onSelect={onSelect} />,
        );
      if (ending === "connection") harness.connection = {};
      if (ending === "unmount") await screen.unmount();
      if (ending !== "connection") expect(signal.aborted).toBe(true);
      release([video]);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(document.querySelector('[aria-label="YouTube search results"]')).toBeNull();
      expect(onSelect).not.toHaveBeenCalled();
      if (ending !== "unmount") await screen.unmount();
    },
  );

  it("rejects selection from a replaced connection after results were displayed", async () => {
    harness.search.mockResolvedValue([video]);
    const onSelect = vi.fn();
    const screen = await render(
      <YouTubeDiscoverySettings environmentScopeKey="first" onSelect={onSelect} />,
    );
    await search();
    await expect.element(page.getByText(video.title)).toBeVisible();
    harness.connection = {};
    await page.getByRole("button", { name: "Load video" }).click();
    expect(onSelect).not.toHaveBeenCalled();
    await expect.element(page.getByRole("status")).toHaveTextContent("connection changed");
    await screen.unmount();
  });

  it("does not send text entered on a previous connection after a switch before Search", async () => {
    harness.search.mockResolvedValue([video]);
    const screen = await render(
      <YouTubeDiscoverySettings environmentScopeKey="first" onSelect={vi.fn()} />,
    );
    await page.getByLabelText("Public YouTube search").fill("query for the previous server");
    harness.connection = {};
    await page.getByRole("button", { name: "Search", exact: true }).click();
    expect(harness.search).not.toHaveBeenCalled();
    await expect.element(page.getByRole("status")).toHaveTextContent("connection changed");
    await expect.element(page.getByLabelText("Public YouTube search")).toHaveValue("");
    await search();
    await expect.element(page.getByText(video.title)).toBeVisible();
    expect(harness.search).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });

  it("does not expose a raw search failure", async () => {
    harness.search.mockRejectedValue(new Error("PRIVATE SYNTHETIC DIAGNOSTIC"));
    const screen = await render(
      <YouTubeDiscoverySettings environmentScopeKey="first" onSelect={vi.fn()} />,
    );
    await search();
    await expect.element(page.getByRole("status")).toHaveTextContent("could not be reached");
    expect(document.body.textContent).not.toContain("PRIVATE SYNTHETIC DIAGNOSTIC");
    await screen.unmount();
  });

  it("clears an old query instead of carrying it into an edit on a replacement connection", async () => {
    const screen = await render(
      <YouTubeDiscoverySettings environmentScopeKey="first" onSelect={vi.fn()} />,
    );
    const input = page.getByLabelText("Public YouTube search");
    await input.fill("previous server query");
    harness.connection = {};
    await input.fill("previous server query edited");
    await expect.element(input).toHaveValue("");
    expect(harness.search).not.toHaveBeenCalled();
    await expect.element(page.getByRole("status")).toHaveTextContent("connection changed");
    await screen.unmount();
  });

  it("does not show an old server's quota failure after a connection change", async () => {
    let reject!: (error: Error) => void;
    harness.search.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const screen = await render(
      <YouTubeDiscoverySettings environmentScopeKey="first" onSelect={vi.fn()} />,
    );
    await search();
    harness.connection = {};
    reject(new YouTubeDiscoveryError("quota-exhausted"));
    await expect.element(page.getByRole("status")).toHaveTextContent("connection changed");
    expect(document.body.textContent).not.toContain("reached its current API quota");
    await screen.unmount();
  });
});
