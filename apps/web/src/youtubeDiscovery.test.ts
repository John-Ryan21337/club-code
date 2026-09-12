import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decodeYouTubeDiscoveryResults,
  isYouTubeDiscoveryAbort,
  searchYouTube,
  YouTubeDiscoveryError,
} from "./youtubeDiscovery";

beforeEach(() =>
  vi.stubGlobal("window", {
    location: { href: "http://127.0.0.1:3210/settings", origin: "http://127.0.0.1:3210" },
  }),
);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("decodeYouTubeDiscoveryResults", () => {
  it("accepts bounded video and playlist results while removing exact duplicates", () => {
    expect(
      decodeYouTubeDiscoveryResults({
        results: [
          {
            kind: "video",
            id: "dQw4w9WgXcQ",
            title: "A video title",
            thumbnail: { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg" },
          },
          {
            kind: "playlist",
            id: "PL1234567890",
            title: "A public playlist",
            thumbnail: null,
          },
          {
            kind: "video",
            id: "dQw4w9WgXcQ",
            title: "Duplicate",
          },
        ],
      }),
    ).toEqual([
      { kind: "video", id: "dQw4w9WgXcQ", title: "A video title" },
      { kind: "playlist", id: "PL1234567890", title: "A public playlist" },
    ]);
  });

  it.each([
    null,
    {
      results: Array.from({ length: 13 }, () => ({
        kind: "video",
        id: "dQw4w9WgXcQ",
        title: "x",
      })),
    },
    { results: [{ kind: "channel", id: "dQw4w9WgXcQ", title: "x" }] },
    { results: [{ kind: "video", id: "short", title: "x" }] },
    { results: [{ kind: "playlist", id: "short", title: "x" }] },
    { results: [{ kind: "video", id: "dQw4w9WgXcQ", title: "" }] },
    { results: [{ kind: "video", id: "dQw4w9WgXcQ", title: " title " }] },
    { results: [{ kind: "video", id: "dQw4w9WgXcQ", title: "title\nwith control" }] },
    {
      results: [{ kind: "video", id: "dQw4w9WgXcQ", title: "x".repeat(201) }],
    },
  ])("rejects malformed discovery payloads", (payload) => {
    expect(() => decodeYouTubeDiscoveryResults(payload)).toThrow(YouTubeDiscoveryError);
  });

  it("recognizes AbortErrors across browser realms", () => {
    expect(isYouTubeDiscoveryAbort({ name: "AbortError" })).toBe(true);
    expect(isYouTubeDiscoveryAbort(new Error("request failed"))).toBe(false);
  });

  it("keeps the private query in the authenticated POST body instead of the request URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("window", {
      location: {
        href: "http://127.0.0.1:3210/settings",
        origin: "http://127.0.0.1:3210",
      },
    });

    await expect(searchYouTube("  private ambient query  ")).resolves.toEqual([]);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsedUrl = new URL(requestUrl);
    expect(parsedUrl.pathname).toBe("/api/ambient-media/youtube/search");
    expect(parsedUrl.search).toBe("");
    expect(requestInit).toMatchObject({
      method: "POST",
      credentials: "include",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "private ambient query", maxResults: 8 }),
    });
  });
});

describe("YouTube search transfer limits", () => {
  it("does not misdiagnose a configured upstream failure as missing configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "unavailable" }, { status: 503 })),
    );
    await expect(searchYouTube("synthetic")).rejects.toMatchObject({
      code: "unavailable",
      message: "YouTube search is not available on this server right now.",
    });
  });
  it.each(["declared", "streamed"])("rejects %s oversized response data", async (mode) => {
    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(32769));
        },
        cancel,
      }),
      mode === "declared" ? { headers: { "content-length": "32769" } } : {},
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(searchYouTube("synthetic")).rejects.toMatchObject({ code: "invalid-response" });
    expect(cancel).toHaveBeenCalled();
  });
  it("bounds a stalled response body and releases its reader", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })));
    vi.stubGlobal("fetch", fetch);
    const result = searchYouTube("synthetic").catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20000);
    expect(await result).toMatchObject({ code: "request-failed" });
    expect(cancel).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("settles cancellation and releases a late response without exposing its data", async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const controller = new AbortController();
    const result = searchYouTube("synthetic", { signal: controller.signal }).catch(
      (error: unknown) => error,
    );
    controller.abort();
    expect(await result).toMatchObject({ name: "AbortError" });
    const cancel = vi.fn();
    release(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });
});
