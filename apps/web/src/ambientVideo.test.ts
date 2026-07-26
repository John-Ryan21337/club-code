import { describe, expect, it } from "vitest";

import { parseYouTubeSource, youtubeEmbedUrl, youtubeSourceInputValue } from "./ambientVideo";

describe("parseYouTubeSource", () => {
  it.each([
    ["dQw4w9WgXcQ", { kind: "video", id: "dQw4w9WgXcQ" }],
    ["https://youtu.be/dQw4w9WgXcQ?t=4", { kind: "video", id: "dQw4w9WgXcQ" }],
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890",
      { kind: "playlist", id: "PL1234567890", videoId: "dQw4w9WgXcQ" },
    ],
    ["https://youtube.com/shorts/dQw4w9WgXcQ", { kind: "video", id: "dQw4w9WgXcQ" }],
    ["https://youtube.com/live/dQw4w9WgXcQ", { kind: "video", id: "dQw4w9WgXcQ" }],
    [
      "https://www.youtube.com/playlist?list=PL1234567890",
      { kind: "playlist", id: "PL1234567890" },
    ],
    [
      "https://www.youtube-nocookie.com/embed/videoseries?list=PL1234567890",
      { kind: "playlist", id: "PL1234567890" },
    ],
  ] as const)("normalizes %s", (input, expected) => {
    expect(parseYouTubeSource(input)).toEqual(expected);
  });

  it.each([
    "",
    "not youtube",
    "https://example.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
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

  it("bounds untrusted pasted input", () => {
    expect(parseYouTubeSource(`https://youtube.com/watch?v=${"a".repeat(4_096)}`)).toBeNull();
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
  it("constructs only privacy-enhanced API-enabled embeds", () => {
    const video = new URL(youtubeEmbedUrl({ kind: "video", id: "dQw4w9WgXcQ" }));
    const playlist = new URL(youtubeEmbedUrl({ kind: "playlist", id: "PL1234567890" }));

    expect(video.origin).toBe("https://www.youtube-nocookie.com");
    expect(video.pathname).toBe("/embed/dQw4w9WgXcQ");
    expect(video.searchParams.get("enablejsapi")).toBe("1");
    expect(video.searchParams.has("autoplay")).toBe(false);
    expect(playlist.origin).toBe("https://www.youtube-nocookie.com");
    expect(playlist.pathname).toBe("/embed/videoseries");
    expect(playlist.searchParams.get("list")).toBe("PL1234567890");
  });

  it("requests autoplay only when explicitly asked", () => {
    const autoplay = new URL(
      youtubeEmbedUrl({ kind: "video", id: "dQw4w9WgXcQ" }, { autoplay: true }),
    );
    expect(autoplay.searchParams.get("autoplay")).toBe("1");
  });
});
