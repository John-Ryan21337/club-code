import { describe, expect, it, vi } from "vitest";

import { CompletionAlertCancelledError } from "./completionAlerts";
import { runCompletionAlert, type CompletionAlertRun } from "./completionAlertRun";

const preferences = {
  language: "dual",
  englishGender: "female",
  japaneseGender: "female",
  stereoOrder: "ja-left-en-right",
} as const;

function makeRun(): CompletionAlertRun {
  return { sound: new AbortController(), speech: new AbortController() };
}

/** A playback stub that resolves only when the test releases it, and that
 *  rejects with the real cancellation error when its signal aborts. */
function deferredPlayback() {
  let release!: () => void;
  const calls: AbortSignal[] = [];
  const play = vi.fn((signal: AbortSignal) => {
    calls.push(signal);
    return new Promise<{ mode: "sound"; message: string }>((resolve, reject) => {
      release = () => resolve({ mode: "sound", message: "done" });
      if (signal.aborted) {
        reject(new CompletionAlertCancelledError());
        return;
      }
      signal.addEventListener("abort", () => reject(new CompletionAlertCancelledError()), {
        once: true,
      });
    });
  });
  return { play, calls, release: () => release() };
}

describe("completion alert run", () => {
  it("suppresses queued speech when the switch is turned off during the sound", async () => {
    const run = makeRun();
    const sound = deferredPlayback();
    const speech = vi.fn();
    let speechEnabled = true;

    const finished = runCompletionAlert({
      run,
      isSoundEnabled: () => true,
      isSpeechEnabled: () => speechEnabled,
      getPreferences: () => preferences,
      playSound: sound.play,
      playSpeech: speech,
    });
    // The user switches the spoken alert off while the ping is still playing.
    speechEnabled = false;
    run.speech.abort();
    sound.release();

    await expect(finished).resolves.toEqual({
      played: ["sound"],
      cancelled: [],
      failed: [],
    });
    expect(speech).not.toHaveBeenCalled();
  });

  it("cancels in-progress sound and pending speech when the renderer unmounts", async () => {
    const run = makeRun();
    const sound = deferredPlayback();
    const speech = vi.fn();

    const finished = runCompletionAlert({
      run,
      isSoundEnabled: () => true,
      isSpeechEnabled: () => true,
      getPreferences: () => preferences,
      playSound: sound.play,
      playSpeech: speech,
    });
    run.sound.abort();
    run.speech.abort();

    await expect(finished).resolves.toEqual({
      played: [],
      cancelled: ["sound"],
      failed: [],
    });
    expect(speech).not.toHaveBeenCalled();
  });

  it("still speaks when only the sound half is switched off mid-alert", async () => {
    const run = makeRun();
    const sound = deferredPlayback();
    const speech = vi.fn(async () => ({ mode: "native" as const, message: "spoke" }));

    const finished = runCompletionAlert({
      run,
      isSoundEnabled: () => true,
      isSpeechEnabled: () => true,
      getPreferences: () => preferences,
      playSound: sound.play,
      playSpeech: speech,
    });
    run.sound.abort();

    await expect(finished).resolves.toEqual({
      played: ["speech"],
      cancelled: ["sound"],
      failed: [],
    });
    expect(speech).toHaveBeenCalledWith(preferences, run.speech.signal);
  });

  it("does not let a failed sound swallow the speech, and reports the failure", async () => {
    const run = makeRun();
    const finished = await runCompletionAlert({
      run,
      isSoundEnabled: () => true,
      isSpeechEnabled: () => true,
      getPreferences: () => preferences,
      playSound: () => Promise.reject(new Error("no audio device")),
      playSpeech: async () => ({ mode: "native", message: "spoke" }),
    });
    expect(finished).toEqual({ played: ["speech"], cancelled: [], failed: ["sound"] });
  });

  it("plays nothing when both switches are off at fire time", async () => {
    const run = makeRun();
    const sound = vi.fn();
    const speech = vi.fn();
    await runCompletionAlert({
      run,
      isSoundEnabled: () => false,
      isSpeechEnabled: () => false,
      getPreferences: () => preferences,
      playSound: sound,
      playSpeech: speech,
    });
    expect(sound).not.toHaveBeenCalled();
    expect(speech).not.toHaveBeenCalled();
  });
});
