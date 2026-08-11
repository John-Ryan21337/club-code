import { describe, expect, it } from "vitest";

import {
  ambientVideoAdaptiveArtworkShouldLoad,
  ambientVideoCinemaLayoutFits,
  ambientVideoPlayerShouldMount,
  ambientVideoPresetPosition,
  ambientVideoSourceSupportsPlaylistNavigation,
  parseYouTubeSource,
  youtubeEmbedUrl,
  youtubeSourceInputValue,
} from "./ambientVideo";

describe("parseYouTubeSource", () => {
  it.each([
    ["dQw4w9WgXcQ", { kind: "video", id: "dQw4w9WgXcQ" }],
    ["https://youtu.be/dQw4w9WgXcQ?t=4", { kind: "video", id: "dQw4w9WgXcQ" }],
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890",
      { kind: "playlist", id: "PL1234567890", videoId: "dQw4w9WgXcQ" },
    ],
    [
      "https://youtu.be/dQw4w9WgXcQ?list=PL1234567890",
      { kind: "playlist", id: "PL1234567890", videoId: "dQw4w9WgXcQ" },
    ],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", { kind: "video", id: "dQw4w9WgXcQ" }],
    ["https://youtube.com/live/dQw4w9WgXcQ", { kind: "video", id: "dQw4w9WgXcQ" }],
    [
      "https://www.youtube.com/playlist?list=PL1234567890",
      { kind: "playlist", id: "PL1234567890" },
    ],
  ] as const)("parses %s", (input, expected) => {
    expect(parseYouTubeSource(input)).toEqual(expected);
  });

  it.each([
    "",
    "not youtube",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=short",
    "https://youtube.com/playlist?list=short",
    "http://youtube.com/watch?v=dQw4w9WgXcQ",
    "https://user:password@youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com:444/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/not-supported?list=PL1234567890",
    "https://youtube.com/watch?v=short&list=PL1234567890",
    "https://youtube.com/watch?list=PL1234567890",
    "https://youtu.be/dQw4w9WgXcQ/extra",
    "ftp://youtube.com/watch?v=dQw4w9WgXcQ",
    "javascript:dQw4w9WgXcQ",
  ])("rejects %s", (input) => {
    expect(parseYouTubeSource(input)).toBeNull();
  });
});

describe("ambientVideoCinemaLayoutFits", () => {
  it("reserves padding, a 356px player, a usable chat rail, and vertical controls", () => {
    expect(ambientVideoCinemaLayoutFits(712, 264)).toBe(true);
    expect(ambientVideoCinemaLayoutFits(711.99, 264)).toBe(false);
    expect(ambientVideoCinemaLayoutFits(712, 263.99)).toBe(false);
    expect(ambientVideoCinemaLayoutFits(Number.NaN, 500)).toBe(false);
  });
});

describe("ambientVideoPlayerShouldMount", () => {
  it("unmounts a hidden narrow player instead of leaving playback alive", () => {
    expect(ambientVideoPlayerShouldMount(true, false, false)).toBe(false);
    expect(ambientVideoPlayerShouldMount(true, true, false)).toBe(true);
    expect(ambientVideoPlayerShouldMount(true, false, true)).toBe(true);
    expect(ambientVideoPlayerShouldMount(false, true, true)).toBe(false);
  });
});

describe("ambientVideoAdaptiveArtworkShouldLoad", () => {
  const videoSource = { kind: "video", id: "dQw4w9WgXcQ" } as const;

  it("keeps external artwork disabled until ambient video is explicitly enabled", () => {
    expect(ambientVideoAdaptiveArtworkShouldLoad(false, true, "adaptive", videoSource)).toBe(false);
    expect(ambientVideoAdaptiveArtworkShouldLoad(true, true, "adaptive", videoSource)).toBe(true);
  });

  it("does not sample artwork for fixed glows, missing sources, or Spotify embeds", () => {
    expect(ambientVideoAdaptiveArtworkShouldLoad(true, true, "fixed", videoSource)).toBe(false);
    expect(ambientVideoAdaptiveArtworkShouldLoad(true, false, "adaptive", videoSource)).toBe(false);
    expect(ambientVideoAdaptiveArtworkShouldLoad(true, true, "adaptive", null)).toBe(false);
    expect(
      ambientVideoAdaptiveArtworkShouldLoad(true, true, "adaptive", {
        kind: "spotify",
        entityType: "playlist",
        id: "37i9dQZF1DXcBWIGoYBM5M",
      }),
    ).toBe(false);
  });
});

describe("youtubeSourceInputValue", () => {
  it("formats normalized sources without retaining pasted URLs", () => {
    expect(youtubeSourceInputValue({ kind: "video", id: "dQw4w9WgXcQ" })).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(youtubeSourceInputValue({ kind: "playlist", id: "PL1234567890" })).toBe(
      "https://www.youtube.com/playlist?list=PL1234567890",
    );
    expect(
      youtubeSourceInputValue({
        kind: "playlist",
        id: "PL1234567890",
        videoId: "dQw4w9WgXcQ",
      }),
    ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890");
  });
});

describe("youtubeEmbedUrl", () => {
  it("enables the official player API on privacy-enhanced video and playlist embeds", () => {
    const video = new URL(youtubeEmbedUrl({ kind: "video", id: "dQw4w9WgXcQ" }));
    const playlist = new URL(youtubeEmbedUrl({ kind: "playlist", id: "PL1234567890" }));
    const playlistItem = new URL(
      youtubeEmbedUrl({
        kind: "playlist",
        id: "PL1234567890",
        videoId: "dQw4w9WgXcQ",
      }),
    );

    expect(video.origin).toBe("https://www.youtube-nocookie.com");
    expect(video.pathname).toBe("/embed/dQw4w9WgXcQ");
    expect(video.searchParams.get("enablejsapi")).toBe("1");
    expect(video.searchParams.has("autoplay")).toBe(false);
    expect(playlist.origin).toBe("https://www.youtube-nocookie.com");
    expect(playlist.pathname).toBe("/embed/videoseries");
    expect(playlist.searchParams.get("list")).toBe("PL1234567890");
    expect(playlist.searchParams.get("enablejsapi")).toBe("1");
    expect(playlistItem.pathname).toBe("/embed/dQw4w9WgXcQ");
    expect(playlistItem.searchParams.get("list")).toBe("PL1234567890");
  });

  it("requests autoplay only when a session URL queue advances", () => {
    const queueItem = new URL(
      youtubeEmbedUrl({ kind: "video", id: "dQw4w9WgXcQ" }, { autoplay: true }),
    );

    expect(queueItem.searchParams.get("autoplay")).toBe("1");
  });
});

describe("ambientVideoSourceSupportsPlaylistNavigation", () => {
  it("offers Cafe-owned previous and next controls only for YouTube playlists", () => {
    expect(
      ambientVideoSourceSupportsPlaylistNavigation({
        kind: "playlist",
        id: "PL1234567890",
      }),
    ).toBe(true);
    expect(
      ambientVideoSourceSupportsPlaylistNavigation({
        kind: "video",
        id: "dQw4w9WgXcQ",
      }),
    ).toBe(false);
    expect(
      ambientVideoSourceSupportsPlaylistNavigation({
        kind: "spotify",
        entityType: "playlist",
        id: "37i9dQZF1DXcBWIGoYBM5M",
      }),
    ).toBe(false);
    expect(ambientVideoSourceSupportsPlaylistNavigation(null)).toBe(false);
  });
});

describe("ambientVideoPresetPosition", () => {
  it("uses only the two supported corners", () => {
    expect(ambientVideoPresetPosition("bottom-left")).toEqual({
      left: "1rem",
      bottom: "1rem",
    });
    expect(ambientVideoPresetPosition("bottom-right")).toEqual({
      right: "1rem",
      bottom: "1rem",
    });
  });
});
