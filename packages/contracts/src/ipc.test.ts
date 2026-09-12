import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  DesktopCompletionSpeechCapabilitySchema,
  DesktopCompletionSpeechSynthesizeInputSchema,
  DesktopCompletionSpeechSynthesizeResultSchema,
} from "./ipc.js";

const decodeCompletionSpeechCapability = Schema.decodeUnknownSync(
  DesktopCompletionSpeechCapabilitySchema,
);
const decodeCompletionSpeechInput = Schema.decodeUnknownSync(
  DesktopCompletionSpeechSynthesizeInputSchema,
);
const decodeCompletionSpeechResult = Schema.decodeUnknownSync(
  DesktopCompletionSpeechSynthesizeResultSchema,
);

describe("desktop completion speech contracts", () => {
  it("accepts only fixed language/gender enums and rejects extra prompt-like input", () => {
    expect(decodeCompletionSpeechInput({ language: "ja", gender: "female" })).toEqual({
      language: "ja",
      gender: "female",
    });
    for (const input of [
      { language: "fr", gender: "female" },
      { language: "en", gender: "neutral" },
      // The renderer must never be able to smuggle spoken text through this
      // boundary: the phrase is chosen on the native side.
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
      decodeCompletionSpeechCapability({
        available: true,
        engine: "Windows System.Speech",
        voices: Array.from({ length: 129 }, (_unused, index) => ({
          name: `Voice ${index}`,
          language: "en",
          culture: "en-US",
          gender: "female",
        })),
        reason: null,
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

  it("represents a missing voice as a reason without a clip", () => {
    expect(
      decodeCompletionSpeechResult({
        clip: null,
        reason: "No installed Japanese female System.Speech voice is available.",
      }),
    ).toEqual({
      clip: null,
      reason: "No installed Japanese female System.Speech voice is available.",
    });
  });
});
