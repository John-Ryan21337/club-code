import "../../index.css";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { useLayoutEffect } from "react";
import { DEFAULT_UNIFIED_SETTINGS } from "@cafecode/contracts";
import { YouTubeAccountSettings } from "./YouTubeAccountSettings";
import { AmbientVideoSettings } from "./AmbientVideoSettings";
import { youtubeUrlQueueStore } from "../../youtubeQueuePlayback";

const h = vi.hoisted(() => ({
  connection: {},
  check: vi.fn(),
  connect: vi.fn(),
  list: vi.fn(),
  disconnect: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../../youtubeAccountConnection", async (original) => ({
  ...(await original<typeof import("../../youtubeAccountConnection")>()),
  getYouTubeAccountConnectionStatus: h.check,
  startYouTubeAccountConnection: h.connect,
  listYouTubeOwnedPlaylists: h.list,
  disconnectYouTubeAccount: h.disconnect,
}));
vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => h.connection,
}));
vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => DEFAULT_UNIFIED_SETTINGS,
  useUpdateSettings: () => ({ updateSettings: h.update }),
}));
vi.mock("../ambient/AmbientVideoWorkspace", () => ({
  useAmbientVideoWorkspace: () => ({ environmentScopeKey: "first" }),
}));
const playlist = { id: "PL_SYNTHETIC_123", title: "Owned synthetic playlist", itemCount: 3 };
beforeEach(async () => {
  for (const mock of [h.check, h.connect, h.list, h.disconnect, h.update]) mock.mockReset();
  h.connection = {};
  await page.viewport(900, 800);
});
afterEach(() => {
  youtubeUrlQueueStore.stop();
  vi.restoreAllMocks();
});

it("makes no automatic requests and distinguishes stored connection from live access", async () => {
  h.check.mockResolvedValue("connected");
  const screen = await render(
    <YouTubeAccountSettings environmentScopeKey="first" onSelect={vi.fn()} />,
  );
  for (const mock of [h.check, h.connect, h.list, h.disconnect])
    expect(mock).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Check connection", exact: true }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("not a live access check");
  expect(h.list).not.toHaveBeenCalled();
  expect(h.connect).not.toHaveBeenCalled();
  await screen.unmount();
});

it("opens consent only on Connect and does not poll afterward", async () => {
  h.connect.mockResolvedValue("pending");
  const screen = await render(
    <YouTubeAccountSettings environmentScopeKey="first" onSelect={vi.fn()} />,
  );
  await page.getByRole("button", { name: "Connect YouTube", exact: true }).click();
  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("Complete consent in the system browser");
  expect(h.connect).toHaveBeenCalledOnce();
  expect(h.check).not.toHaveBeenCalled();
  await screen.unmount();
});

it("loads only selected canonical playlist through real settings and stops the prior queue", async () => {
  h.list.mockResolvedValue([playlist]);
  youtubeUrlQueueStore.start({ name: "Old", videoIds: ["dQw4w9WgXcQ"] }, "first");
  const screen = await render(<AmbientVideoSettings />);
  await page.getByRole("button", { name: "Load my playlists", exact: true }).click();
  await expect.element(page.getByText(/Owned synthetic playlist/)).toBeVisible();
  expect(h.update).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Load owned playlist", exact: true }).click();
  expect(h.update).toHaveBeenCalledExactlyOnceWith({
    ambientVideoSource: { kind: "playlist", id: playlist.id },
    ambientVideoEnabled: true,
  });
  expect(youtubeUrlQueueStore.getSnapshot().active).toBe(false);
  await screen.unmount();
});

it("does not disconnect a replacement connection from a stale view", async () => {
  const screen = await render(
    <YouTubeAccountSettings environmentScopeKey="first" onSelect={vi.fn()} />,
  );
  h.connection = {};
  await page.getByRole("button", { name: "Disconnect YouTube", exact: true }).click();
  expect(h.disconnect).not.toHaveBeenCalled();
  await expect.element(page.getByRole("status")).toHaveTextContent("connection changed");
  await screen.unmount();
});

it("removes private playlist titles before the changed scope can paint", async () => {
  h.list.mockResolvedValue([playlist]);
  const committed: string[] = [];
  function Harness({ scope }: { scope: string }) {
    useLayoutEffect(() => {
      if (scope === "second") committed.push(document.body.textContent ?? "");
    }, [scope]);
    return <YouTubeAccountSettings environmentScopeKey={scope} onSelect={vi.fn()} />;
  }
  const screen = await render(<Harness scope="first" />);
  await page.getByRole("button", { name: "Load my playlists", exact: true }).click();
  await expect.element(page.getByText(/Owned synthetic playlist/)).toBeVisible();
  await screen.rerender(<Harness scope="second" />);
  expect(committed).toHaveLength(1);
  expect(committed[0]).not.toContain(playlist.title);
  await screen.unmount();
});

it("hides private results when the same scope renders a replaced connection", async () => {
  h.list.mockResolvedValue([playlist]);
  const select = vi.fn();
  const screen = await render(
    <YouTubeAccountSettings environmentScopeKey="same" onSelect={select} />,
  );
  await page.getByRole("button", { name: "Load my playlists", exact: true }).click();
  await expect.element(page.getByText(/Owned synthetic playlist/)).toBeVisible();
  h.connection = {};
  await screen.rerender(<YouTubeAccountSettings environmentScopeKey="same" onSelect={select} />);
  expect(document.body.textContent).not.toContain(playlist.title);
  await expect.element(page.getByRole("status")).toHaveTextContent("connection changed");
  expect(select).not.toHaveBeenCalled();
  await screen.unmount();
});

it.each(["connection", "scope", "unmount", "cancel"])(
  "discards late private playlists after %s",
  async (change) => {
    let release!: (value: unknown) => void;
    let signal!: AbortSignal;
    h.list.mockImplementation((value) => {
      signal = value;
      return new Promise((done) => {
        release = done;
      });
    });
    const select = vi.fn();
    const screen = await render(
      <YouTubeAccountSettings environmentScopeKey="first" onSelect={select} />,
    );
    await page.getByRole("button", { name: "Load my playlists", exact: true }).click();
    if (change === "connection") h.connection = {};
    if (change === "scope")
      await screen.rerender(
        <YouTubeAccountSettings environmentScopeKey="second" onSelect={select} />,
      );
    if (change === "unmount") await screen.unmount();
    if (change === "cancel")
      await page.getByRole("button", { name: "Stop waiting", exact: true }).click();
    release([playlist]);
    await vi.waitFor(() => expect(document.body.textContent).not.toContain(playlist.title));
    expect(select).not.toHaveBeenCalled();
    if (change !== "connection") expect(signal.aborted).toBe(true);
    if (change !== "unmount") await screen.unmount();
  },
);

it("refuses selecting a stale result and hides raw request errors", async () => {
  h.list.mockResolvedValue([playlist]);
  const select = vi.fn();
  const screen = await render(
    <YouTubeAccountSettings environmentScopeKey="first" onSelect={select} />,
  );
  await page.getByRole("button", { name: "Load my playlists", exact: true }).click();
  await expect.element(page.getByText(/Owned synthetic playlist/)).toBeVisible();
  h.connection = {};
  await page.getByRole("button", { name: "Load owned playlist", exact: true }).click();
  expect(select).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "Check connection", exact: true }).click();
  h.check.mockRejectedValue(new Error("private refresh token"));
  await page.getByRole("button", { name: "Check connection", exact: true }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("request failed");
  expect(document.body.textContent).not.toContain("private refresh token");
  await screen.unmount();
});

it("keeps long private playlist titles and account controls inside a320px viewport", async () => {
  await page.viewport(320, 800);
  h.list.mockResolvedValue([{ ...playlist, title: "日本語".repeat(60) }]);
  const screen = await render(
    <div style={{ width: 320 }}>
      <YouTubeAccountSettings environmentScopeKey="first" onSelect={vi.fn()} />
    </div>,
  );
  await page.getByRole("button", { name: "Load my playlists", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Load owned playlist", exact: true }))
    .toBeVisible();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  await screen.unmount();
});
