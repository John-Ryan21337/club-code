import { describe, expect, it } from "vitest";

import {
  describeDesktopCompletionSpeech,
  shouldOfferWindowsSpeechGuide,
  WINDOWS_JAPANESE_FEMALE_VOICE_GUIDANCE,
  WINDOWS_SPEECH_GUIDE_URL,
} from "./completionSpeechSupport";

describe("desktop completion speech support copy", () => {
  it("names the installed voice and gives local Japanese female install guidance when absent", () => {
    const summary = describeDesktopCompletionSpeech({
      available: true,
      engine: "Windows System.Speech",
      reason: null,
      voices: [
        { name: "Microsoft Zira Desktop", language: "en", culture: "en-US", gender: "female" },
      ],
    });

    expect(summary).toContain("Microsoft Zira Desktop");
    expect(summary).toContain(WINDOWS_JAPANESE_FEMALE_VOICE_GUIDANCE);
    expect(summary).toContain("Ayumi and Haruka");
  });

  it("does not show an install instruction when a Japanese female voice is present", () => {
    const summary = describeDesktopCompletionSpeech({
      available: true,
      engine: "Windows System.Speech",
      reason: null,
      voices: [
        { name: "Microsoft Haruka Desktop", language: "ja", culture: "ja-JP", gender: "female" },
      ],
    });

    expect(summary).toContain("Japanese female: available (Microsoft Haruka Desktop)");
    expect(summary).not.toContain(WINDOWS_JAPANESE_FEMALE_VOICE_GUIDANCE);
  });

  it("uses the fixed official Microsoft HTTPS guide", () => {
    expect(WINDOWS_SPEECH_GUIDE_URL).toBe(
      "https://support.microsoft.com/en-us/windows/appendix-a-supported-languages-and-voices-4486e345-7730-53da-fcfe-55cc64300f01",
    );
  });

  it("does not offer Windows installation guidance on non-Windows desktop hosts", () => {
    const capability = {
      available: false,
      engine: "Windows System.Speech" as const,
      voices: [],
      reason: "Native stereo speech is available only in the Windows desktop app.",
    };

    expect(describeDesktopCompletionSpeech(capability)).toBe(capability.reason);
    expect(shouldOfferWindowsSpeechGuide(capability)).toBe(false);
  });
});
