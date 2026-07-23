import { describe, expect, it } from "vitest";

import {
  ambientVideoCinemaLayoutFits,
  ambientVideoPlayerShouldMount,
  ambientVideoPresetPosition,
  parseYouTubeSource,
  youtubeSourceInputValue,
} from "./ambientVideo";

describe("parseYouTubeSource", () => {
  it.each([
    ["dQw4w9WgXcQ", { kind: "video", id: "dQw4w9WgXcQ" }],
    ["https://youtu.be/dQw4w9WgXcQ?t=4", { kind: "video", id: "dQw4w9WgXcQ" }],
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890",
      { kind: "video", id: "dQw4w9WgXcQ" },
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

describe("youtubeSourceInputValue", () => {
  it("formats normalized sources without retaining pasted URLs", () => {
    expect(youtubeSourceInputValue({ kind: "video", id: "dQw4w9WgXcQ" })).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
    expect(youtubeSourceInputValue({ kind: "playlist", id: "PL1234567890" })).toBe(
      "https://www.youtube.com/playlist?list=PL1234567890",
    );
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
