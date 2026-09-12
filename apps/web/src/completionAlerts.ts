import type {
  CompletionSpeechGender,
  CompletionSpeechLanguage,
  DesktopCompletionSpeechClip,
} from "@cafecode/contracts";

import { getCompletionAlertFile, getNextCompletionAlertFile } from "./completionAlertFiles";

export const COMPLETION_PHRASES = {
  en: "Task complete.",
  ja: "作業が完了しました。",
} as const satisfies Record<CompletionSpeechLanguage, string>;

export interface CompletionAlertPreferences {
  readonly language: "en" | "ja" | "dual";
  readonly englishGender: CompletionSpeechGender;
  readonly japaneseGender: CompletionSpeechGender;
  readonly stereoOrder: "ja-left-en-right" | "en-left-ja-right";
}

export interface CompletionAlertPlaybackReport {
  readonly mode:
    | "sound"
    | "native"
    | "native-stereo"
    | "web-speech-centered-sequential"
    | "unavailable";
  readonly message: string;
}

const MAX_NATIVE_REASON_LENGTH = 512;
const MAX_AUDIO_PLAYBACK_MS = 17_000;

/**
 * Thrown when the listening device withdraws consent mid-alert: the renderer
 * unmounted, or the user switched that half of completion audio off while it
 * was still playing. It is a normal control-flow signal, never an error the
 * user needs to see.
 */
export class CompletionAlertCancelledError extends Error {
  constructor() {
    super("Completion alert playback was cancelled.");
    this.name = "CompletionAlertCancelledError";
  }
}

export function isCompletionAlertCancelled(error: unknown): boolean {
  return error instanceof CompletionAlertCancelledError;
}

function makeAudioContext(): AudioContext {
  return new AudioContext();
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new CompletionAlertCancelledError();
}

function stopSource(source: AudioScheduledSourceNode): void {
  try {
    if (typeof source.stop === "function") source.stop();
  } catch {
    // A source that never started (or already ended) throws here; the enclosing
    // AudioContext close is what actually guarantees silence.
  }
}

/**
 * Await one playback stage with three exits: it finished, the bounded timeout
 * elapsed, or the caller aborted. Abort must stop the scheduled sources before
 * rejecting, so switching audio off or unmounting silences audio that is
 * already sounding instead of only suppressing the *next* alert.
 */
function awaitPlayback(options: {
  readonly signal: AbortSignal | undefined;
  readonly timeoutMs: number;
  readonly timeoutMessage: string;
  /** Starts playback and returns the stop function used on abort or timeout. */
  readonly start: (finish: (error?: unknown) => void) => () => void;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new CompletionAlertCancelledError());
      return;
    }
    let settled = false;
    let stop: (() => void) | null = null;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
      if (error === undefined) resolve();
      else reject(error);
    };
    const onAbort = () => {
      stop?.();
      finish(new CompletionAlertCancelledError());
    };
    const timeout = setTimeout(() => {
      stop?.();
      finish(new Error(options.timeoutMessage));
    }, options.timeoutMs);
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      stop = options.start(finish);
    } catch (error) {
      finish(error);
      return;
    }
    // An abort that lands during `start` still has to stop what just started.
    if (settled || options.signal?.aborted) stop();
  });
}

async function playDecodedAudio(data: ArrayBuffer, signal?: AbortSignal): Promise<void> {
  throwIfCancelled(signal);
  const context = makeAudioContext();
  try {
    const buffer = await context.decodeAudioData(data.slice(0));
    throwIfCancelled(signal);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    await awaitPlayback({
      signal,
      timeoutMs: MAX_AUDIO_PLAYBACK_MS,
      timeoutMessage: "Completion audio playback did not finish.",
      start: (finish) => {
        source.addEventListener("ended", () => finish(), { once: true });
        source.start();
        return () => stopSource(source);
      },
    });
  } finally {
    await context.close();
  }
}

export async function playCustomCompletionAlert(id: string, signal?: AbortSignal): Promise<void> {
  const file = await getCompletionAlertFile(id);
  if (!file) throw new Error("This local completion alert file no longer exists.");
  await playDecodedAudio(await file.arrayBuffer(), signal);
}

export async function playCompletionSound(
  signal?: AbortSignal,
): Promise<CompletionAlertPlaybackReport> {
  throwIfCancelled(signal);
  const custom = await getNextCompletionAlertFile().catch(() => null);
  throwIfCancelled(signal);
  if (custom) {
    try {
      await playDecodedAudio(await custom.arrayBuffer(), signal);
      return { mode: "sound", message: "Played the next local custom completion alert." };
    } catch (error) {
      // A cancelled alert must stay cancelled; only a decode/playback failure
      // (a file can become undecodable after a browser/codec change) falls back
      // to the original built-in sound.
      if (isCompletionAlertCancelled(error)) throw error;
    }
  }

  throwIfCancelled(signal);
  const context = makeAudioContext();
  const start = context.currentTime + 0.02;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.055, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.58);
  gain.connect(context.destination);

  // An original, restrained station-like interval: two short sine notes with
  // a small overlap. It intentionally does not reproduce a railway melody.
  const scheduled: AudioScheduledSourceNode[] = [];
  const notes = [
    { frequency: 587.33, offset: 0, duration: 0.3 },
    { frequency: 783.99, offset: 0.22, duration: 0.34 },
  ];
  for (const note of notes) {
    const oscillator = context.createOscillator();
    const noteGain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(note.frequency, start + note.offset);
    noteGain.gain.setValueAtTime(0.0001, start + note.offset);
    noteGain.gain.exponentialRampToValueAtTime(0.75, start + note.offset + 0.018);
    noteGain.gain.exponentialRampToValueAtTime(0.0001, start + note.offset + note.duration);
    oscillator.connect(noteGain);
    noteGain.connect(gain);
    oscillator.start(start + note.offset);
    oscillator.stop(start + note.offset + note.duration + 0.02);
    scheduled.push(oscillator);
  }
  try {
    await awaitPlayback({
      signal,
      timeoutMs: MAX_AUDIO_PLAYBACK_MS,
      timeoutMessage: "Completion ping playback did not finish.",
      start: (finish) => {
        const timer = setTimeout(() => finish(), 700);
        return () => {
          clearTimeout(timer);
          for (const oscillator of scheduled) stopSource(oscillator);
        };
      },
    });
  } finally {
    // Closing the context is what silences an aborted ping, because the two
    // oscillators are scheduled ahead of `currentTime`.
    await context.close();
  }
  return { mode: "sound", message: "Played the built-in original two-tone completion ping." };
}

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function playNativeClips(
  clips: readonly DesktopCompletionSpeechClip[],
  preferences: CompletionAlertPreferences,
  signal?: AbortSignal,
): Promise<CompletionAlertPlaybackReport> {
  throwIfCancelled(signal);
  const context = makeAudioContext();
  try {
    const decoded = await Promise.all(
      clips.map(async (clip) => ({
        clip,
        buffer: await context.decodeAudioData(decodeBase64(clip.wavBase64)),
      })),
    );
    throwIfCancelled(signal);
    const simultaneousStereo =
      decoded.length === 2 && typeof context.createStereoPanner === "function";
    const start = context.currentTime + 0.06;
    let remaining = decoded.length;
    await awaitPlayback({
      signal,
      timeoutMs: MAX_AUDIO_PLAYBACK_MS,
      timeoutMessage: "Native completion speech playback did not finish.",
      start: (finish) => {
        const sources: AudioScheduledSourceNode[] = [];
        for (const item of decoded) {
          const source = context.createBufferSource();
          source.buffer = item.buffer;
          if (simultaneousStereo) {
            const panner = context.createStereoPanner();
            const japaneseLeft = preferences.stereoOrder === "ja-left-en-right";
            const pan =
              item.clip.language === "ja" ? (japaneseLeft ? -1 : 1) : japaneseLeft ? 1 : -1;
            panner.pan.setValueAtTime(pan, start);
            source.connect(panner);
            panner.connect(context.destination);
          } else {
            source.connect(context.destination);
          }
          source.addEventListener(
            "ended",
            () => {
              remaining -= 1;
              if (remaining === 0) finish();
            },
            { once: true },
          );
          source.start(start);
          sources.push(source);
        }
        return () => {
          for (const source of sources) stopSource(source);
        };
      },
    });
    if (simultaneousStereo) {
      return {
        mode: "native-stereo",
        message:
          preferences.stereoOrder === "ja-left-en-right"
            ? "Played simultaneous native speech: Japanese left, English right."
            : "Played simultaneous native speech: English left, Japanese right.",
      };
    }
    return {
      mode: "native",
      message:
        clips.length === 1
          ? `Played native ${clips[0]!.language === "ja" ? "Japanese" : "English"} speech centered.`
          : "Played native speech centered because stereo panning was unavailable.",
    };
  } finally {
    await context.close();
  }
}

function requestedLanguages(
  preferences: CompletionAlertPreferences,
): readonly CompletionSpeechLanguage[] {
  if (preferences.language !== "dual") return [preferences.language];
  return preferences.stereoOrder === "ja-left-en-right" ? ["ja", "en"] : ["en", "ja"];
}

function requestedGender(
  language: CompletionSpeechLanguage,
  preferences: CompletionAlertPreferences,
): CompletionSpeechGender {
  return language === "ja" ? preferences.japaneseGender : preferences.englishGender;
}

function nativeFailureReasons(
  results: readonly {
    readonly clip: DesktopCompletionSpeechClip | null;
    readonly reason: string | null;
  }[],
): readonly string[] {
  return [
    ...new Set(
      results.flatMap((result) => {
        const reason = result.reason?.trim();
        if (!reason) return [];
        return reason.length <= MAX_NATIVE_REASON_LENGTH
          ? [reason]
          : ["Native Windows speech returned an invalid failure reason."];
      }),
    ),
  ];
}

function speechVoiceMatchesLanguage(
  voice: SpeechSynthesisVoice,
  language: CompletionSpeechLanguage,
): boolean {
  const normalized = voice.lang.toLowerCase();
  return normalized === language || normalized.startsWith(`${language}-`);
}

function readWebSpeechVoices(): SpeechSynthesisVoice[] | null {
  try {
    return speechSynthesis.getVoices();
  } catch {
    return null;
  }
}

async function speakWebSpeechUtterance(
  language: CompletionSpeechLanguage,
  voice: SpeechSynthesisVoice,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let utterance: SpeechSynthesisUtterance;
    try {
      utterance = new SpeechSynthesisUtterance(COMPLETION_PHRASES[language]);
    } catch {
      resolve(false);
      return;
    }
    utterance.lang = language === "ja" ? "ja-JP" : "en-US";
    utterance.voice = voice;
    utterance.rate = 1;
    utterance.volume = 0.9;
    let settled = false;
    const finish = (played: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolve(played);
    };
    // Aborting has to reach the speech engine, not just this promise: an
    // utterance already queued in `speechSynthesis` would otherwise keep
    // speaking after the switch was turned off or the renderer unmounted.
    const onAbort = () => {
      speechSynthesis.cancel?.();
      finish(false);
    };
    const timeout = setTimeout(() => {
      speechSynthesis.cancel?.();
      finish(false);
    }, 10_000);
    signal?.addEventListener("abort", onAbort, { once: true });
    utterance.addEventListener("end", () => finish(true), { once: true });
    utterance.addEventListener("error", () => finish(false), { once: true });
    try {
      speechSynthesis.speak(utterance);
    } catch {
      finish(false);
    }
  });
}

async function playWebSpeech(
  languages: readonly CompletionSpeechLanguage[],
  signal?: AbortSignal,
): Promise<CompletionAlertPlaybackReport> {
  throwIfCancelled(signal);
  if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance === "undefined") {
    return { mode: "unavailable", message: "Speech synthesis is unavailable on this device." };
  }
  let voices = readWebSpeechVoices();
  if (voices === null) {
    return { mode: "unavailable", message: "Web Speech voices could not be queried." };
  }
  if (voices.length === 0) {
    const canObserveVoices =
      typeof speechSynthesis.addEventListener === "function" &&
      typeof speechSynthesis.removeEventListener === "function";
    if (canObserveVoices) {
      voices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const timeout = setTimeout(() => {
          speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
          resolve(readWebSpeechVoices() ?? []);
        }, 500);
        const handleVoicesChanged = () => {
          clearTimeout(timeout);
          speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
          resolve(readWebSpeechVoices() ?? []);
        };
        speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
      });
    }
    throwIfCancelled(signal);
  }
  const missing: CompletionSpeechLanguage[] = [];
  const failed: CompletionSpeechLanguage[] = [];
  for (const language of languages) {
    throwIfCancelled(signal);
    const voice = voices.find((candidate) => speechVoiceMatchesLanguage(candidate, language));
    if (!voice) {
      missing.push(language);
      continue;
    }
    if (!(await speakWebSpeechUtterance(language, voice, signal))) failed.push(language);
    // A dual alert must not speak its second language after cancellation.
    throwIfCancelled(signal);
  }
  if (missing.length + failed.length === languages.length) {
    return {
      mode: "unavailable",
      message:
        missing.length === languages.length
          ? "No installed Web Speech voice matches the requested language."
          : "A matching Web Speech voice was found, but playback did not complete.",
    };
  }
  return {
    mode: "web-speech-centered-sequential",
    message:
      missing.length + failed.length > 0
        ? "Played the available language centered and sequentially; another requested language was unavailable or failed. Web Speech does not expose reliable gender or panning."
        : "Played Web Speech centered and sequentially. Web Speech does not expose reliable gender or panning.",
  };
}

function validateNativeResult(
  language: CompletionSpeechLanguage,
  gender: CompletionSpeechGender,
  result: {
    readonly clip: DesktopCompletionSpeechClip | null;
    readonly reason: string | null;
  },
): {
  readonly clip: DesktopCompletionSpeechClip | null;
  readonly reason: string | null;
} {
  const clip = result.clip;
  if (!clip) return result;
  if (
    clip.language !== language ||
    clip.requestedGender !== gender ||
    clip.voice.language !== language ||
    clip.voice.gender !== gender ||
    !clip.voice.culture.toLowerCase().startsWith(`${language}-`)
  ) {
    return {
      clip: null,
      reason: "Native Windows speech returned a nonmatching culture or gender.",
    };
  }
  return result;
}

export async function playCompletionSpeech(
  preferences: CompletionAlertPreferences,
  signal?: AbortSignal,
): Promise<CompletionAlertPlaybackReport> {
  throwIfCancelled(signal);
  const languages = requestedLanguages(preferences);
  const bridge = window.desktopBridge;
  if (bridge?.synthesizeCompletionSpeech) {
    // A one-off IPC failure for one language must not discard a valid exact
    // native clip for the other half of a dual alert. Preserve the successful
    // side and only use the clearly labeled browser fallback for the missing
    // side.
    const settled = await Promise.allSettled(
      languages.map((language) =>
        bridge.synthesizeCompletionSpeech!({
          language,
          gender: requestedGender(language, preferences),
        }),
      ),
    );
    // The native response can arrive long after the user switched speech off or
    // the renderer unmounted. Drop it here instead of decoding and playing it.
    throwIfCancelled(signal);
    const results = settled.map((result, index) => {
      const language = languages[index]!;
      const gender = requestedGender(language, preferences);
      return result.status === "fulfilled"
        ? validateNativeResult(language, gender, result.value)
        : { clip: null, reason: "Native Windows speech request failed." };
    });
    const clips = results.flatMap((result) => (result.clip ? [result.clip] : []));
    const missingLanguages = languages.filter((_language, index) => !results[index]?.clip);
    const reasons = nativeFailureReasons(results);
    if (clips.length > 0) {
      let report: CompletionAlertPlaybackReport;
      try {
        report = await playNativeClips(clips, preferences, signal);
      } catch (error) {
        if (isCompletionAlertCancelled(error)) throw error;
        const fallback = await playWebSpeech(languages, signal);
        const nativeDetail =
          reasons.length > 0 ? ` Native Windows speech: ${reasons.join(" ")}` : "";
        return {
          ...fallback,
          message:
            fallback.mode === "unavailable"
              ? `Native Windows speech audio could not be decoded or played.${nativeDetail} Browser fallback: ${fallback.message}`
              : `Native Windows speech audio could not be decoded or played.${nativeDetail} ${fallback.message}`,
        };
      }
      if (missingLanguages.length > 0) {
        const fallback = await playWebSpeech(missingLanguages, signal);
        const nativeDetail =
          reasons.length > 0 ? ` Native Windows speech: ${reasons.join(" ")}` : "";
        return {
          ...report,
          message:
            fallback.mode === "unavailable"
              ? `${report.message}${nativeDetail} Browser fallback: ${fallback.message} The missing language was not substituted.`
              : `${report.message}${nativeDetail} ${fallback.message} This partial fallback is not simultaneous stereo and does not claim a gender match.`,
        };
      }
      return report;
    }
    const fallback = await playWebSpeech(languages, signal);
    if (reasons.length > 0) {
      return {
        ...fallback,
        message:
          fallback.mode === "unavailable"
            ? `Native Windows speech: ${reasons.join(" ")} Browser fallback: ${fallback.message}`
            : `Native Windows speech: ${reasons.join(" ")} ${fallback.message}`,
      };
    }
    return fallback;
  }
  return playWebSpeech(languages, signal);
}

export async function testCompletionAlerts(input: {
  readonly soundEnabled: boolean;
  readonly speechEnabled: boolean;
  readonly preferences: CompletionAlertPreferences;
  readonly signal?: AbortSignal;
}): Promise<readonly CompletionAlertPlaybackReport[]> {
  const reports: CompletionAlertPlaybackReport[] = [];
  if (input.soundEnabled) reports.push(await playCompletionSound(input.signal));
  if (input.speechEnabled) {
    reports.push(await playCompletionSpeech(input.preferences, input.signal));
  }
  return reports;
}
