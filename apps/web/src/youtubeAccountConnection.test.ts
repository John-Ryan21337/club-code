import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decodeYouTubeOwnedPlaylistResponse,
  getYouTubeAccountConnectionStatus,
  startYouTubeAccountConnection,
} from "./youtubeAccountConnection";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("YouTube account connection client", () => {
  it("strictly decodes the bounded playlist selector payload", () => {
    expect(
      decodeYouTubeOwnedPlaylistResponse({
        playlists: [{ id: "PL1234567890", title: "Mine", itemCount: 7 }],
      }),
    ).toEqual([{ id: "PL1234567890", title: "Mine", itemCount: 7 }]);
    expect(() =>
      decodeYouTubeOwnedPlaylistResponse({
        playlists: [{ id: "unsafe id", title: "No", itemCount: 1 }],
      }),
    ).toThrow("invalid YouTube account response");
  });

  it("starts and checks status without receiving an authorization target", async () => {
    vi.stubGlobal("window", {
      location: {
        href: "http://127.0.0.1:3773/settings",
        origin: "http://127.0.0.1:3773",
      },
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "pending" }), { status: 202 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "connected" }), { status: 200 }),
      );

    await expect(startYouTubeAccountConnection()).resolves.toBe("pending");
    await expect(getYouTubeAccountConnectionStatus()).resolves.toBe("connected");
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/api/ambient-media/youtube/account/start"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});
