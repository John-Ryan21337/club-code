import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ANNOUNCEMENT_CHIME_NOTES,
  COMPLETION_PHRASES,
  playAnnouncementChime,
  playCompletionSpeech,
} from "./completionAlerts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("completion alert privacy contract", () => {
  it("contains only the two fixed short completion phrases", () => {
    expect(COMPLETION_PHRASES).toEqual({
      en: "Task complete.",
      ja: "作業が完了しました。",
    });
    expect(Object.keys(COMPLETION_PHRASES)).toEqual(["en", "ja"]);
  });

  it("keeps a successful exact native side and its fulfilled missing-side reason", async () => {
    const endedListeners = new Set<() => void>();
    class TestAudioContext {
      readonly currentTime = 0;
      readonly destination = {} as AudioDestinationNode;

      async decodeAudioData(): Promise<AudioBuffer> {
        return {} as AudioBuffer;
      }

      createBufferSource(): AudioBufferSourceNode {
        return {
          addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
            if (typeof listener === "function") {
              endedListeners.add(() => listener(new Event("ended")));
            }
          },
          connect: vi.fn(),
          start: () => queueMicrotask(() => endedListeners.forEach((listener) => listener())),
        } as unknown as AudioBufferSourceNode;
      }

      async close(): Promise<void> {}
    }

    const synthesizeCompletionSpeech = vi.fn(async ({ language }: { language: "en" | "ja" }) => {
      if (language === "ja") {
        return {
          clip: null,
          reason: "No installed Japanese female System.Speech voice is available.",
        };
      }
      return {
        clip: {
          language: "en" as const,
          requestedGender: "female" as const,
          voice: {
            name: "English Voice",
            language: "en" as const,
            culture: "en-US",
            gender: "female" as const,
          },
          wavBase64: btoa("safe-test-wav"),
        },
        reason: null,
      };
    });
    vi.stubGlobal("AudioContext", TestAudioContext);
    vi.stubGlobal("window", { desktopBridge: { synthesizeCompletionSpeech } });

    await expect(
      playCompletionSpeech({
        language: "dual",
        englishGender: "female",
        japaneseGender: "female",
        stereoOrder: "ja-left-en-right",
      }),
    ).resolves.toMatchObject({
      mode: "native",
      message: expect.stringMatching(
        /No installed Japanese female System\.Speech voice is available\..*not substituted/,
      ),
    });
    expect(synthesizeCompletionSpeech).toHaveBeenCalledTimes(2);
  });

  it("reports a safe generic native reason when an IPC request rejects", async () => {
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [],
    });
    vi.stubGlobal("SpeechSynthesisUtterance", vi.fn());
    vi.stubGlobal("window", {
      desktopBridge: {
        synthesizeCompletionSpeech: vi.fn(async () => {
          throw new Error("sensitive raw implementation detail");
        }),
      },
    });

    await expect(
      playCompletionSpeech({
        language: "ja",
        englishGender: "female",
        japaneseGender: "female",
        stereoOrder: "ja-left-en-right",
      }),
    ).resolves.toEqual({
      mode: "unavailable",
      message:
        "Native Windows speech: Native Windows speech request failed. Browser fallback: No installed Web Speech voice matches the requested language.",
    });
  });

  it("rejects a nonmatching native clip instead of claiming an exact voice match", async () => {
    const synthesizeCompletionSpeech = vi.fn(async () => ({
      clip: {
        language: "en" as const,
        requestedGender: "male" as const,
        voice: {
          name: "Wrong Voice",
          language: "en" as const,
          culture: "en-US",
          gender: "male" as const,
        },
        wavBase64: btoa("not-used"),
      },
      reason: null,
    }));
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [],
    });
    vi.stubGlobal("SpeechSynthesisUtterance", vi.fn());
    vi.stubGlobal("window", { desktopBridge: { synthesizeCompletionSpeech } });

    await expect(
      playCompletionSpeech({
        language: "en",
        englishGender: "female",
        japaneseGender: "female",
        stereoOrder: "ja-left-en-right",
      }),
    ).resolves.toEqual({
      mode: "unavailable",
      message:
        "Native Windows speech: Native Windows speech returned a nonmatching culture or gender. Browser fallback: No installed Web Speech voice matches the requested language.",
    });
  });

  it("matches complete Web Speech language tags rather than arbitrary prefixes", async () => {
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [{ lang: "javanese" }],
    });
    vi.stubGlobal("SpeechSynthesisUtterance", vi.fn());
    vi.stubGlobal("window", {});

    await expect(
      playCompletionSpeech({
        language: "ja",
        englishGender: "female",
        japaneseGender: "female",
        stereoOrder: "ja-left-en-right",
      }),
    ).resolves.toEqual({
      mode: "unavailable",
      message: "No installed Web Speech voice matches the requested language.",
    });
  });

  it("preserves the exact native missing-voice reason when browser speech cannot help", async () => {
    const synthesizeCompletionSpeech = vi.fn(async () => ({
      clip: null,
      reason: "No installed Japanese female System.Speech voice is available.",
    }));
    vi.stubGlobal("speechSynthesis", {
      getVoices: () => [{ lang: "en-US" }],
    });
    vi.stubGlobal("SpeechSynthesisUtterance", vi.fn());
    vi.stubGlobal("window", { desktopBridge: { synthesizeCompletionSpeech } });

    await expect(
      playCompletionSpeech({
        language: "ja",
        englishGender: "female",
        japaneseGender: "female",
        stereoOrder: "ja-left-en-right",
      }),
    ).resolves.toEqual({
      mode: "unavailable",
      message:
        "Native Windows speech: No installed Japanese female System.Speech voice is available. Browser fallback: No installed Web Speech voice matches the requested language.",
    });
  });
});

/**
 * Minimal Web Audio stand-in. Each oscillator reports `ended` shortly after
 * its scheduled stop so the chime's completion is observable in order.
 */
function stubChimeAudio(events: string[]) {
  const fundamentals: number[] = [];
  class ChimeAudioContext {
    readonly currentTime = 0;
    readonly destination = {} as AudioDestinationNode;
    createGain(): GainNode {
      return {
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      } as unknown as GainNode;
    }
    createOscillator(): OscillatorNode {
      const listeners: Array<() => void> = [];
      let frequency = 0;
      return {
        type: "sine",
        frequency: {
          setValueAtTime: (value: number) => {
            frequency = value;
          },
        },
        connect: vi.fn(),
        addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
        start: () => fundamentals.push(frequency),
        stop: () =>
          setTimeout(() => {
            events.push("oscillator-ended");
            listeners.forEach((listener) => listener());
          }, 5),
      } as unknown as OscillatorNode;
    }
    async close(): Promise<void> {
      events.push("chime-closed");
    }
  }
  vi.stubGlobal("AudioContext", ChimeAudioContext);
  return fundamentals;
}

function stubWebSpeech(events: string[]) {
  class Utterance {
    lang = "";
    voice: unknown = null;
    rate = 1;
    volume = 1;
    private readonly listeners = new Map<string, () => void>();
    constructor(readonly text: string) {}
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, listener);
    }
    fire(type: string) {
      this.listeners.get(type)?.();
    }
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  vi.stubGlobal("speechSynthesis", {
    getVoices: () => [{ lang: "ja-JP" }],
    speak: (utterance: Utterance) => {
      events.push(`speak:${utterance.text}`);
      queueMicrotask(() => utterance.fire("end"));
    },
  });
  vi.stubGlobal("window", {});
}

describe("station announcement chime", () => {
  it("rises through four notes and finishes before the announcement speaks", async () => {
    const events: string[] = [];
    const startedFrequencies = stubChimeAudio(events);
    stubWebSpeech(events);

    const report = await playCompletionSpeech({
      language: "ja",
      englishGender: "female",
      japaneseGender: "female",
      stereoOrder: "ja-left-en-right",
      announcementChime: true,
    });

    const fundamentals: number[] = ANNOUNCEMENT_CHIME_NOTES.map((note) => note.frequency);
    expect(fundamentals).toEqual([...fundamentals].toSorted((left, right) => left - right));
    expect(startedFrequencies.filter((frequency) => fundamentals.includes(frequency))).toEqual(
      fundamentals,
    );
    const speakIndex = events.indexOf(`speak:${COMPLETION_PHRASES.ja}`);
    expect(speakIndex).toBeGreaterThan(events.indexOf("chime-closed"));
    expect(events.indexOf("chime-closed")).toBeGreaterThan(events.indexOf("oscillator-ended"));
    expect(report).toMatchObject({
      mode: "web-speech-centered-sequential",
      message: expect.stringMatching(/^Played the original station-style announcement chime\. /),
    });
  });

  it("speaks without a chime when the chime is off", async () => {
    const events: string[] = [];
    const startedFrequencies = stubChimeAudio(events);
    stubWebSpeech(events);

    const report = await playCompletionSpeech({
      language: "ja",
      englishGender: "female",
      japaneseGender: "female",
      stereoOrder: "ja-left-en-right",
      announcementChime: false,
    });

    expect(startedFrequencies).toEqual([]);
    expect(events).toEqual([`speak:${COMPLETION_PHRASES.ja}`]);
    expect(report.message).not.toMatch(/chime/);
  });

  it("still speaks when Web Audio is unavailable for the chime", async () => {
    const events: string[] = [];
    vi.stubGlobal(
      "AudioContext",
      vi.fn(() => {
        throw new Error("no audio device");
      }),
    );
    stubWebSpeech(events);

    await expect(playAnnouncementChime()).resolves.toBe(false);
    const report = await playCompletionSpeech({
      language: "ja",
      englishGender: "female",
      japaneseGender: "female",
      stereoOrder: "ja-left-en-right",
      announcementChime: true,
    });
    expect(events).toEqual([`speak:${COMPLETION_PHRASES.ja}`]);
    expect(report.mode).toBe("web-speech-centered-sequential");
    expect(report.message).not.toMatch(/chime/);
  });
});
