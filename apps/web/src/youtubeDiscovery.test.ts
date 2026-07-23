import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decodeYouTubeDiscoveryResults,
  isYouTubeDiscoveryAbort,
  searchYouTube,
  YouTubeDiscoveryError,
} from "./youtubeDiscovery";

afterEach(() => {
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "private ambient query", maxResults: 8 }),
    });
  });
});
