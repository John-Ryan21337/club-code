import { describe, expect, it } from "vitest";
import type { SpotifySource } from "@cafecode/contracts/settings";

import { parseSpotifySource, spotifyEmbedUrl, spotifySourceInputValue } from "./spotify";

const track: SpotifySource = {
  kind: "spotify",
  entityType: "track",
  id: "4uLU6hMCjMI75M1A2tKUQC",
};

describe("parseSpotifySource", () => {
  it.each([
    ["spotify:track:4uLU6hMCjMI75M1A2tKUQC", track],
    ["https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=sensitive", track],
    ["https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC", track],
    ["https://open.spotify.com/intl-ja/track/4uLU6hMCjMI75M1A2tKUQC", track],
    [
      "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
      {
        kind: "spotify",
        entityType: "playlist",
        id: "37i9dQZF1DXcBWIGoYBM5M",
      },
    ],
  ] as const)("normalizes %s without retaining query data", (input, expected) => {
    expect(parseSpotifySource(input)).toEqual(expected);
  });

  it.each([
    "",
    "not spotify",
    "http://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    "https://example.com/track/4uLU6hMCjMI75M1A2tKUQC",
    "https://open.spotify.com:444/track/4uLU6hMCjMI75M1A2tKUQC",
    "https://user@open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    "https://open.spotify.com//track/4uLU6hMCjMI75M1A2tKUQC",
    "https://open.spotify.com/intl-untrusted/track/4uLU6hMCjMI75M1A2tKUQC",
    "https://open.spotify.com/user/example",
    "https://open.spotify.com/track/short",
    "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC/extra",
    "spotify:local:artist:album",
    "javascript:track:4uLU6hMCjMI75M1A2tKUQC",
  ])("rejects %s", (input) => {
    expect(parseSpotifySource(input)).toBeNull();
  });
});

describe("Spotify normalized URLs", () => {
  it("constructs only fixed official player and share origins", () => {
    expect(spotifySourceInputValue(track)).toBe(
      "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
    );
    expect(spotifyEmbedUrl(track)).toBe(
      "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC",
    );
  });

  it("does not interpolate unsound runtime values into a URL", () => {
    const hostile = {
      kind: "spotify",
      entityType: "track/../../artist",
      id: "4uLU6hMCjMI75M1A2tKUQC",
    } as unknown as SpotifySource;

    expect(() => spotifySourceInputValue(hostile)).toThrow("Invalid Spotify source");
    expect(() => spotifyEmbedUrl(hostile)).toThrow("Invalid Spotify source");
    expect(() => spotifyEmbedUrl(null as unknown as SpotifySource)).toThrow(
      "Invalid Spotify source",
    );
    expect(() => spotifyEmbedUrl({ ...track, kind: "video" } as unknown as SpotifySource)).toThrow(
      "Invalid Spotify source",
    );
  });
});
