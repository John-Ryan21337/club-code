import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  DesktopLocalMediaCapabilitySchema,
  DesktopLocalMediaNavigateInputSchema,
  DesktopLocalMediaReleaseInputSchema,
  DesktopLocalMediaSelectionSchema,
  DesktopCompletionSpeechCapabilitySchema,
  DesktopCompletionSpeechSynthesizeInputSchema,
  DesktopCompletionSpeechSynthesizeResultSchema,
  DesktopWindowOpacityPreferenceSchema,
  DesktopWindowOpacityStateSchema,
} from "./ipc.js";

const decodePreference = Schema.decodeUnknownSync(DesktopWindowOpacityPreferenceSchema);
const decodeState = Schema.decodeUnknownSync(DesktopWindowOpacityStateSchema);
const decodeLocalMediaCapability = Schema.decodeUnknownSync(DesktopLocalMediaCapabilitySchema);
const decodeLocalMediaSelection = Schema.decodeUnknownSync(DesktopLocalMediaSelectionSchema);
const decodeLocalMediaNavigate = Schema.decodeUnknownSync(DesktopLocalMediaNavigateInputSchema);
const decodeLocalMediaRelease = Schema.decodeUnknownSync(DesktopLocalMediaReleaseInputSchema);
const decodeCompletionSpeechCapability = Schema.decodeUnknownSync(
  DesktopCompletionSpeechCapabilitySchema,
);
const decodeCompletionSpeechInput = Schema.decodeUnknownSync(
  DesktopCompletionSpeechSynthesizeInputSchema,
);
const decodeCompletionSpeechResult = Schema.decodeUnknownSync(
  DesktopCompletionSpeechSynthesizeResultSchema,
);

describe("desktop window opacity contracts", () => {
  it("accepts only finite bounded opacity preferences", () => {
    expect(decodePreference({ enabled: true, opacity: 0.65 })).toEqual({
      enabled: true,
      opacity: 0.65,
    });
    expect(decodePreference({ enabled: false, opacity: 1 })).toEqual({
      enabled: false,
      opacity: 1,
    });

    for (const opacity of [0.64, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.8"]) {
      expect(() => decodePreference({ enabled: true, opacity })).toThrow();
    }
  });

  it("represents unknown live opacity without claiming a successful safe reset", () => {
    expect(
      decodeState({
        supported: true,
        enabled: false,
        opacity: 1,
        effectiveOpacity: null,
        reason: "safe-reset-failed",
      }),
    ).toEqual({
      supported: true,
      enabled: false,
      opacity: 1,
      effectiveOpacity: null,
      reason: "safe-reset-failed",
    });
  });
});

describe("desktop completion speech contracts", () => {
  it("accepts only fixed language/gender enums and rejects extra prompt-like input", () => {
    expect(decodeCompletionSpeechInput({ language: "ja", gender: "female" })).toEqual({
      language: "ja",
      gender: "female",
    });
    for (const input of [
      { language: "fr", gender: "female" },
      { language: "en", gender: "neutral" },
      { language: "en", gender: "male", text: "private prompt" },
    ]) {
      expect(() => decodeCompletionSpeechInput(input, { onExcessProperty: "error" })).toThrow();
    }
  });

  it("bounds native capability metadata and WAV output", () => {
    expect(
      decodeCompletionSpeechCapability({
        available: true,
        engine: "Windows System.Speech",
        voices: [{ name: "David", language: "en", culture: "en-US", gender: "male" }],
        reason: null,
      }),
    ).toMatchObject({ available: true });
    expect(() =>
      decodeCompletionSpeechCapability({
        available: false,
        engine: "Windows System.Speech",
        voices: [],
        reason: "x".repeat(513),
      }),
    ).toThrow();
    expect(() =>
      decodeCompletionSpeechResult({
        clip: {
          language: "en",
          requestedGender: "female",
          voice: { name: "Zira", language: "en", culture: "en-US", gender: "female" },
          wavBase64: "x".repeat(1_500_001),
        },
        reason: null,
      }),
    ).toThrow();
  });
});

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
