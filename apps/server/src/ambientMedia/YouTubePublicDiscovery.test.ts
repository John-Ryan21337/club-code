import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import {
  decodeYouTubeSearchResponse,
  makeYouTubePublicDiscovery,
  parseYouTubeDiscoveryInput,
} from "./YouTubePublicDiscovery.ts";

const validResponse = {
  items: [
    {
      id: { kind: "youtube#video", videoId: "dQw4w9WgXcQ" },
      snippet: {
        title: "A safe video",
        thumbnails: {
          medium: {
            url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
            width: 320,
            height: 180,
          },
        },
      },
    },
  ],
};

describe("YouTube public discovery", () => {
  it("strictly bounds request input before it reaches the upstream request", () => {
    expect(parseYouTubeDiscoveryInput({ query: "  jazz mix  ", maxResults: null })).toEqual({
      query: "jazz mix",
      maxResults: 8,
    });
    expect(parseYouTubeDiscoveryInput({ query: "un\nsafe", maxResults: "2" })).toBeNull();
    expect(parseYouTubeDiscoveryInput({ query: "valid", maxResults: "01" })).toBeNull();
    expect(parseYouTubeDiscoveryInput({ query: "valid", maxResults: "13" })).toBeNull();
  });

  it("decodes only selectable IDs, titles, and safe thumbnail metadata", () => {
    const decoded = decodeYouTubeSearchResponse(
      {
        items: [
          ...validResponse.items,
          {
            id: { kind: "youtube#channel", channelId: "not-selectable" },
            snippet: { title: "A channel" },
          },
          {
            id: { kind: "youtube#playlist", playlistId: "PL1234567890" },
            snippet: {
              title: "A playlist",
              thumbnails: {
                medium: {
                  url: "https://example.invalid/not-a-youtube-thumbnail.jpg",
                  width: 320,
                  height: 180,
                },
              },
            },
          },
          {
            id: { kind: "youtube#video", videoId: "dQw4w9WgXcQ" },
            snippet: { title: "Duplicate" },
          },
          {
            id: { kind: "youtube#video", videoId: "abcdefghijk" },
            snippet: { title: "contains\u0000control" },
          },
        ],
        nextPageToken: "must-not-pass-through",
      },
      8,
    );

    expect(decoded).toEqual([
      {
        kind: "video",
        id: "dQw4w9WgXcQ",
        title: "A safe video",
        thumbnail: {
          url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
          width: 320,
          height: 180,
        },
      },
      { kind: "playlist", id: "PL1234567890", title: "A playlist", thumbnail: null },
    ]);
  });

  it("uses a fixed upstream origin, rejects redirects, and serves a bounded cache", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const fetch = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(validResponse), { status: 200 });
    };
    const discovery = makeYouTubePublicDiscovery({ apiKey: "server-only-key", fetch });

    const first = await Effect.runPromise(
      discovery.search({ query: "ambient jazz", maxResults: 4, clientId: "127.0.0.1" }),
    );
    const second = await Effect.runPromise(
      discovery.search({ query: "ambient jazz", maxResults: 4, clientId: "127.0.0.1" }),
    );

    expect(second).toEqual(first);
    expect(calls).toHaveLength(1);
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    const upstream = new URL(firstCall!.url);
    expect(upstream.origin).toBe("https://www.googleapis.com");
    expect(upstream.pathname).toBe("/youtube/v3/search");
    expect(upstream.searchParams.get("type")).toBe("video,playlist");
    expect(upstream.searchParams.get("key")).toBeNull();
    expect(firstCall!.url).not.toContain("server-only-key");
    expect(firstCall!.init.headers).toMatchObject({
      Accept: "application/json",
      "X-Goog-Api-Key": "server-only-key",
    });
    expect(firstCall!.init.redirect).toBe("error");
  });

  it("returns stable quota and local rate-limit errors without exposing upstream text", async () => {
    const quotaDiscovery = makeYouTubePublicDiscovery({
      apiKey: "server-only-key",
      fetch: async () =>
        new Response(
          JSON.stringify({
            error: { errors: [{ reason: "quotaExceeded", message: "raw upstream details" }] },
          }),
          { status: 403 },
        ),
    });
    await expect(
      Effect.runPromise(
        quotaDiscovery.search({ query: "ambient", maxResults: 1, clientId: "client-a" }),
      ),
    ).rejects.toMatchObject({ code: "quota-exhausted", status: 429 });

    const rateDiscovery = makeYouTubePublicDiscovery({
      apiKey: "server-only-key",
      fetch: async () => new Response(JSON.stringify(validResponse), { status: 200 }),
    });
    for (let index = 0; index < 12; index += 1) {
      await Effect.runPromise(
        rateDiscovery.search({ query: `ambient ${index}`, maxResults: 1, clientId: "client-a" }),
      );
    }
    await expect(
      Effect.runPromise(
        rateDiscovery.search({ query: "one too many", maxResults: 1, clientId: "client-a" }),
      ),
    ).rejects.toMatchObject({ code: "rate-limited", status: 429 });
  });
});
