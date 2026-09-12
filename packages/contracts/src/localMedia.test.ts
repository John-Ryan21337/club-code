import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import {
  DesktopLocalMediaCapabilitySchema,
  DesktopLocalMediaNavigateInputSchema,
  DesktopLocalMediaReleaseInputSchema,
  DesktopLocalMediaSelectionSchema,
} from "./localMedia.ts";
const decodeLocalMediaCapability = Schema.decodeUnknownSync(DesktopLocalMediaCapabilitySchema);
const decodeLocalMediaSelection = Schema.decodeUnknownSync(DesktopLocalMediaSelectionSchema);
const decodeLocalMediaNavigate = Schema.decodeUnknownSync(DesktopLocalMediaNavigateInputSchema);
const decodeLocalMediaRelease = Schema.decodeUnknownSync(DesktopLocalMediaReleaseInputSchema);
describe("desktop local media contracts", () => {
  const sessionId = "s".repeat(43);
  const playbackToken = "p".repeat(43);

  it("accepts bounded opaque selections without filesystem or upstream URLs", () => {
    expect(
      decodeLocalMediaSelection({
        sessionId,
        kind: "video",
        displayTitle: "Holiday",
        playbackUrl: `cafecode-media://stream/${playbackToken}`,
        currentIndex: 2,
        totalItems: 4,
        engine: { label: "VLC", version: null, reason: null },
      }),
    ).toMatchObject({
      sessionId,
      kind: "video",
      displayTitle: "Holiday",
      currentIndex: 2,
      totalItems: 4,
    });

    for (const playbackUrl of [
      "file:///C:/Users/private/movie.flv",
      "http://127.0.0.1:45555/secret.webm",
      `cafecode-media://stream/${sessionId}?extra=true`,
      "cafecode-media://stream/short",
    ]) {
      expect(() =>
        decodeLocalMediaSelection({
          sessionId,
          kind: "video",
          displayTitle: "Holiday",
          playbackUrl,
          currentIndex: 0,
          totalItems: 1,
          engine: { label: "VLC", version: null, reason: null },
        }),
      ).toThrow();
    }
    expect(() =>
      decodeLocalMediaSelection({
        sessionId,
        kind: "video",
        displayTitle: "Holiday",
        playbackUrl: `cafecode-media://stream/${sessionId}`,
        currentIndex: 0,
        totalItems: 1,
        engine: { label: "VLC", version: null, reason: "Startup actually failed" },
      }),
    ).toThrow();
    expect(() =>
      decodeLocalMediaSelection({
        sessionId,
        kind: "video",
        displayTitle: "Holiday",
        playbackUrl: `cafecode-media://stream/${playbackToken}`,
        currentIndex: 64,
        totalItems: 4,
        engine: { label: "VLC", version: null, reason: null },
      }),
    ).toThrow();
    expect(decodeLocalMediaNavigate({ sessionId, direction: "next" })).toEqual({
      sessionId,
      direction: "next",
    });
    expect(() => decodeLocalMediaNavigate({ sessionId, direction: "random" })).toThrow();
  });

  it("bounds capability reasons and rejects excess release fields in strict IPC decoding", () => {
    expect(
      decodeLocalMediaCapability({
        available: false,
        engine: { label: "VLC", version: null, reason: "Unavailable" },
      }),
    ).toMatchObject({ available: false });
    expect(() =>
      decodeLocalMediaCapability({
        available: false,
        engine: { label: "VLC", version: null, reason: "x".repeat(513) },
      }),
    ).toThrow();
    expect(() =>
      decodeLocalMediaCapability({
        available: true,
        engine: { label: "VLC", version: null, reason: "Not actually available" },
      }),
    ).toThrow();
    expect(() =>
      decodeLocalMediaRelease(
        { sessionId, unexpected: true },
        {
          onExcessProperty: "error",
        },
      ),
    ).toThrow();
  });
});
