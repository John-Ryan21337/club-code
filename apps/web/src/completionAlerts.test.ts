import { afterEach, describe, expect, it, vi } from "vitest";

import {
  COMPLETION_PHRASES,
  CompletionAlertCancelledError,
  playCompletionSound,
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

function audioParamStub() {
  return { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
}

describe("completion alert cancellation", () => {
  it("drops a native speech clip whose IPC response lands after cancellation", async () => {
    const createBufferSource = vi.fn();
    class TestAudioContext {
      readonly currentTime = 0;
      readonly destination = {} as AudioDestinationNode;
      async decodeAudioData(): Promise<AudioBuffer> {
        return {} as AudioBuffer;
      }
      createBufferSource = createBufferSource;
      async close(): Promise<void> {}
    }
    const controller = new AbortController();
    const synthesizeCompletionSpeech = vi.fn(
      async () =>
        new Promise<{ clip: null; reason: string }>((resolve) => {
          // The subprocess answers only after the renderer stopped listening.
          setTimeout(() => {
            resolve({ clip: null, reason: "late" });
          }, 0);
        }),
    );
    vi.stubGlobal("AudioContext", TestAudioContext);
    vi.stubGlobal("window", { desktopBridge: { synthesizeCompletionSpeech } });
    const speaking = playCompletionSpeech(
      {
        language: "en",
        englishGender: "female",
        japaneseGender: "female",
        stereoOrder: "ja-left-en-right",
      },
      controller.signal,
    );
    controller.abort();
    await expect(speaking).rejects.toThrow(CompletionAlertCancelledError);
    expect(createBufferSource).not.toHaveBeenCalled();
  });

  it("stops the built-in ping and closes its context when audio is switched off", async () => {
    const stop = vi.fn();
    const close = vi.fn(async () => {});
    class TestAudioContext {
      readonly currentTime = 0;
      readonly destination = {} as AudioDestinationNode;
      createGain() {
        return { gain: audioParamStub(), connect: vi.fn() } as unknown as GainNode;
      }
      createOscillator() {
        return {
          type: "sine",
          frequency: audioParamStub(),
          connect: vi.fn(),
          start: vi.fn(),
          stop,
        } as unknown as OscillatorNode;
      }
      close = close;
    }
    vi.stubGlobal("AudioContext", TestAudioContext);
    vi.stubGlobal("indexedDB", undefined);
    const controller = new AbortController();
    const playing = playCompletionSound(controller.signal);
    // Abort only once the ping is actually sounding, which is the case this
    // regression is about: cancelling playback already in progress.
    await vi.waitFor(() => expect(stop.mock.calls.length).toBe(0), { timeout: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await expect(playing).rejects.toThrow(CompletionAlertCancelledError);
    expect(close).toHaveBeenCalled();
    // Both scheduled notes are stopped, not merely left to sound out.
    expect(stop.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses to start once the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(playCompletionSound(controller.signal)).rejects.toThrow(
      CompletionAlertCancelledError,
    );
  });
});
