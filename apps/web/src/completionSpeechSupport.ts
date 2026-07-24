import type { DesktopCompletionSpeechCapability } from "@cafecode/contracts";

export const WINDOWS_JAPANESE_FEMALE_VOICE_GUIDANCE =
  "Microsoft lists Ayumi and Haruka as Japanese female Windows TTS voices. Open Narrator settings (Windows key + Ctrl + N), choose Add legacy voices, then under Manage voices choose Add voices and Japanese. Club Code prefers Haruka when both are installed. Then return here and refresh voices. Club Code does not upload speech or audio.";

export const WINDOWS_SPEECH_GUIDE_URL =
  "https://support.microsoft.com/en-us/windows/appendix-a-supported-languages-and-voices-4486e345-7730-53da-fcfe-55cc64300f01";

const NON_WINDOWS_NATIVE_REASON =
  "Native stereo speech is available only in the Windows desktop app.";

function voicesFor(
  capability: DesktopCompletionSpeechCapability,
  language: "en" | "ja",
  gender: "female" | "male",
): readonly string[] {
  return capability.voices
    .filter((voice) => voice.language === language && voice.gender === gender)
    .map((voice) => voice.name);
}

function describeVoice(
  capability: DesktopCompletionSpeechCapability,
  language: "en" | "ja",
  gender: "female" | "male",
): string {
  const names = voicesFor(capability, language, gender);
  return names.length > 0 ? `available (${names.join(", ")})` : "not installed";
}

/**
 * Keep missing Japanese speech actionable without claiming that an English
 * voice, browser fallback, or a cloud service can stand in for it.
 */
export function describeDesktopCompletionSpeech(
  capability: DesktopCompletionSpeechCapability | null,
): string {
  if (!capability) return "Checking installed Windows System.Speech voices…";
  if (!capability.available && capability.reason === NON_WINDOWS_NATIVE_REASON) {
    return capability.reason;
  }
  const japaneseFemaleInstalled = voicesFor(capability, "ja", "female").length > 0;
  const availability = `Native exact voices — English female: ${describeVoice(capability, "en", "female")}; English male: ${describeVoice(capability, "en", "male")}; Japanese female: ${describeVoice(capability, "ja", "female")}; Japanese male: ${describeVoice(capability, "ja", "male")}.`;
  const stereo =
    " Dual mode uses simultaneous stereo only when both requested native voices exist; missing matches are reported and never substituted.";

  if (!capability.available) {
    return `${capability.reason ?? "Native speech unavailable"} ${WINDOWS_JAPANESE_FEMALE_VOICE_GUIDANCE}`;
  }
  return japaneseFemaleInstalled
    ? `${availability}${stereo}`
    : `${availability}${stereo} ${WINDOWS_JAPANESE_FEMALE_VOICE_GUIDANCE}`;
}

export function shouldOfferWindowsSpeechGuide(
  capability: DesktopCompletionSpeechCapability | null,
): boolean {
  return capability !== null && capability.reason !== NON_WINDOWS_NATIVE_REASON;
}
