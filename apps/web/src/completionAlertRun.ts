import {
  isCompletionAlertCancelled,
  playCompletionSound,
  playCompletionSpeech,
  type CompletionAlertPlaybackReport,
  type CompletionAlertPreferences,
} from "./completionAlerts";

/**
 * The abort handles for one completion alert. Sound and speech are separate so
 * turning one switch off stops only that half: silencing the ping must not cut
 * a Japanese phrase the user still wants to hear, and vice versa. Aborting both
 * is how an unmount stops the whole alert.
 */
export interface CompletionAlertRun {
  readonly sound: AbortController;
  readonly speech: AbortController;
}

export interface CompletionAlertRunInput {
  readonly run: CompletionAlertRun;
  /** Read live, never captured: the user can switch audio off mid-alert. */
  readonly isSoundEnabled: () => boolean;
  readonly isSpeechEnabled: () => boolean;
  readonly getPreferences: () => CompletionAlertPreferences;
  readonly playSound?: (signal: AbortSignal) => Promise<CompletionAlertPlaybackReport>;
  readonly playSpeech?: (
    preferences: CompletionAlertPreferences,
    signal: AbortSignal,
  ) => Promise<CompletionAlertPlaybackReport>;
}

export interface CompletionAlertRunResult {
  readonly played: readonly ("sound" | "speech")[];
  readonly cancelled: readonly ("sound" | "speech")[];
  readonly failed: readonly ("sound" | "speech")[];
}

/**
 * Play one coalesced completion alert, re-checking consent at every stage.
 *
 * The ordering matters: the sound can run for most of a second and native
 * speech synthesis is a subprocess round trip, so between "the alert started"
 * and "speech begins" the user may have switched audio off, and the renderer
 * may have unmounted. Both are checked again here, and the abort signals also
 * reach playback that is already sounding.
 */
export async function runCompletionAlert(
  input: CompletionAlertRunInput,
): Promise<CompletionAlertRunResult> {
  const playSound = input.playSound ?? playCompletionSound;
  const playSpeech = input.playSpeech ?? playCompletionSpeech;
  const played: ("sound" | "speech")[] = [];
  const cancelled: ("sound" | "speech")[] = [];
  const failed: ("sound" | "speech")[] = [];

  if (!input.run.sound.signal.aborted && input.isSoundEnabled()) {
    try {
      await playSound(input.run.sound.signal);
      played.push("sound");
    } catch (error) {
      (isCompletionAlertCancelled(error) ? cancelled : failed).push("sound");
    }
  }

  // Re-read after the sound: this is the window the user is most likely to use
  // to turn the alert off, and a failed sound must not block the speech.
  if (!input.run.speech.signal.aborted && input.isSpeechEnabled()) {
    try {
      await playSpeech(input.getPreferences(), input.run.speech.signal);
      played.push("speech");
    } catch (error) {
      (isCompletionAlertCancelled(error) ? cancelled : failed).push("speech");
    }
  }

  return { played, cancelled, failed };
}
