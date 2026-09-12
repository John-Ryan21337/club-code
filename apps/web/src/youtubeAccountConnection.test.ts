import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  decodeYouTubeOwnedPlaylistResponse,
  startYouTubeAccountConnection,
  getYouTubeAccountConnectionStatus,
  listYouTubeOwnedPlaylists,
  disconnectYouTubeAccount,
  YouTubeAccountConnectionRequestError,
} from "./youtubeAccountConnection";

beforeEach(() =>
  vi.stubGlobal("window", {
    location: { href: "http://127.0.0.1:3210/settings", origin: "http://127.0.0.1:3210" },
  }),
);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const playlist = { id: "PL_SYNTHETIC_123", title: "Owned test playlist", itemCount: 4 };

it("decodes only bounded owned playlist display fields", () => {
  expect(
    decodeYouTubeOwnedPlaylistResponse({ playlists: [{ ...playlist, ignored: "private" }] }),
  ).toEqual([playlist]);
});
it.each([
  null,
  {
    playlists: Array.from({ length: 51 }, (_, index) => ({
      ...playlist,
      id: `PL_SYNTHETIC_${index}`,
    })),
  },
  { playlists: [playlist, playlist] },
  { playlists: [{ ...playlist, id: "short" }] },
  { playlists: [{ ...playlist, title: "bad\nvalue" }] },
  { playlists: [{ ...playlist, title: "x".repeat(201) }] },
  { playlists: [{ ...playlist, itemCount: -1 }] },
  { playlists: [{ ...playlist, itemCount: 1.5 }] },
])("rejects malformed or duplicate playlist payload %#", (value) =>
  expect(() => decodeYouTubeOwnedPlaylistResponse(value)).toThrow(
    YouTubeAccountConnectionRequestError,
  ),
);

it("uses authenticated same-server routes with closed redirects and no referrer", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ status: "pending" }))
    .mockResolvedValueOnce(Response.json({ status: "connected" }))
    .mockResolvedValueOnce(Response.json({ playlists: [playlist] }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  expect(await startYouTubeAccountConnection()).toBe("pending");
  expect(await getYouTubeAccountConnectionStatus()).toBe("connected");
  expect(await listYouTubeOwnedPlaylists()).toEqual([playlist]);
  await disconnectYouTubeAccount();
  for (const [index, method, suffix] of [
    [0, "POST", "/start"],
    [1, "GET", "/status"],
    [2, "GET", "/playlists"],
    [3, "DELETE", ""],
  ] as const) {
    expect(fetch.mock.calls[index]).toEqual([
      `http://127.0.0.1:3210/api/ambient-media/youtube/account${suffix}`,
      expect.objectContaining({
        method,
        headers: { "content-type": "application/json" },
        credentials: "include",
        redirect: "error",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    ]);
  }
});

it("does not expose raw server error values or unexpected start success", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json({ error: "private raw token" }, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ status: "connected" })),
  );
  await expect(getYouTubeAccountConnectionStatus()).rejects.toThrow(
    "Cafe could not reach the YouTube account connector.",
  );
  await expect(startYouTubeAccountConnection()).rejects.toThrow("invalid YouTube account response");
});

it.each(["declared", "streamed", "redirect"])("cancels %s responses", async (mode) => {
  const cancel = vi.fn();
  const response = new Response(
    new ReadableStream({
      start(controller) {
        if (mode === "streamed") controller.enqueue(new Uint8Array(65537));
      },
      cancel,
    }),
    { headers: mode === "declared" ? { "content-length": "65537" } : {} },
  );
  if (mode === "redirect") Object.defineProperty(response, "redirected", { value: true });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => response),
  );
  await expect(getYouTubeAccountConnectionStatus()).rejects.toThrow(
    YouTubeAccountConnectionRequestError,
  );
  expect(cancel).toHaveBeenCalled();
});

it("bounds body consumption to 20 seconds even when fetch already succeeded", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new ReadableStream({ cancel }))),
  );
  const failure = expect(getYouTubeAccountConnectionStatus()).rejects.toThrow("could not reach");
  await vi.advanceTimersByTimeAsync(20001);
  await failure;
  expect(cancel).toHaveBeenCalled();
});

it("rejects pre-abort without a request and cancels a body delivered after a stalled fetch", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(getYouTubeAccountConnectionStatus(controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fetch).not.toHaveBeenCalled();
  vi.useFakeTimers();
  let release!: (value: Response) => void;
  fetch.mockImplementation(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  const failure = expect(getYouTubeAccountConnectionStatus()).rejects.toThrow("could not reach");
  await vi.advanceTimersByTimeAsync(20001);
  await failure;
  const cancel = vi.fn();
  release(new Response(new ReadableStream({ cancel })));
  await vi.advanceTimersByTimeAsync(0);
  expect(cancel).toHaveBeenCalled();
});
