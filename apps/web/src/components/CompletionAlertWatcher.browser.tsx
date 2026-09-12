import { useSyncExternalStore } from "react";
import { expect, it, vi } from "vitest";
import { cleanup, render } from "vitest-browser-react";

/**
 * Real-component regression for the completion-audio race the coalescer alone
 * cannot cover: consent is re-read between the sound and the speech, and both
 * an unmount and a mid-alert switch-off must stop playback that is already in
 * progress. Only the surrounding modules (store, router, settings transport,
 * audio device) are synthetic; the watcher, its coalescer, and the alert runner
 * are the real implementations. No audio hardware is touched.
 */
const harness = vi.hoisted(() => {
  interface Thread {
    readonly environmentId: string;
    readonly id: string;
    readonly title: string;
    readonly latestTurn: { readonly turnId: string; readonly state: string } | null;
    readonly session: null;
  }
  const listeners = new Set<() => void>();
  const state = {
    threads: [] as readonly Thread[],
    settings: {
      notificationsEnabled: false,
      completionAlertSoundEnabled: true,
      completionAlertSpeechEnabled: true,
      completionAlertLanguage: "en" as const,
      completionAlertEnglishVoiceGender: "female" as const,
      completionAlertJapaneseVoiceGender: "female" as const,
      completionAlertDualStereoOrder: "ja-left-en-right" as const,
    },
  };
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit,
    thread: (turnId: string, turnState: string): Thread => ({
      environmentId: "env-1",
      id: "thread-1",
      title: "Thread",
      latestTurn: { turnId, state: turnState },
      session: null,
    }),
  };
});

vi.mock("../store", () => ({
  selectSidebarThreadsAcrossEnvironments: (state: { threads: unknown }) => state.threads,
  useStore: (selector: (state: unknown) => unknown) =>
    useSyncExternalStore(harness.subscribe, () => selector(harness.state)),
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({}),
  useRouter: () => ({ navigate: vi.fn() }),
}));
vi.mock("../hooks/useSettings", () => ({
  useLocalClientSettingsHydrated: () => true,
  useSettings: () => useSyncExternalStore(harness.subscribe, () => harness.state.settings),
}));

const playback = vi.hoisted(() => {
  const soundStarts: AbortSignal[] = [];
  const speechStarts: AbortSignal[] = [];
  let releaseSound: (() => void) | null = null;
  return {
    soundStarts,
    speechStarts,
    release: () => releaseSound?.(),
    setRelease: (fn: () => void) => {
      releaseSound = fn;
    },
  };
});

vi.mock("../completionAlerts", async () => {
  const actual = await vi.importActual<typeof import("../completionAlerts")>("../completionAlerts");
  return {
    ...actual,
    playCompletionSound: (signal?: AbortSignal) => {
      playback.soundStarts.push(signal!);
      return new Promise((resolve, reject) => {
        playback.setRelease(() => resolve({ mode: "sound", message: "synthetic" }));
        signal?.addEventListener(
          "abort",
          () => reject(new actual.CompletionAlertCancelledError()),
          {
            once: true,
          },
        );
      });
    },
    playCompletionSpeech: (_preferences: unknown, signal?: AbortSignal) => {
      playback.speechStarts.push(signal!);
      return Promise.resolve({ mode: "native", message: "synthetic" });
    },
  };
});

const { DesktopNotificationWatcher } = await import("./DesktopNotificationWatcher");

/** The watcher only alerts on an *observed* running turn, so the two store
 *  updates must land in separate React commits, exactly as they would live. */
async function completeTurn() {
  harness.state.threads = [harness.thread("turn-1", "running")];
  harness.emit();
  await new Promise((resolve) => setTimeout(resolve, 20));
  harness.state.threads = [harness.thread("turn-1", "completed")];
  harness.emit();
  await new Promise((resolve) => setTimeout(resolve, 20));
}

it("suppresses queued speech when the spoken alert is switched off during the sound", async () => {
  playback.soundStarts.length = 0;
  playback.speechStarts.length = 0;
  harness.state.threads = [];
  render(<DesktopNotificationWatcher />);
  await completeTurn();

  await vi.waitFor(() => expect(playback.soundStarts).toHaveLength(1), { timeout: 4_000 });
  // The user turns the spoken half off while the ping is still playing.
  harness.state.settings = { ...harness.state.settings, completionAlertSpeechEnabled: false };
  harness.emit();
  await vi.waitFor(() => expect(playback.soundStarts[0]!.aborted).toBe(false));
  playback.release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(playback.speechStarts).toHaveLength(0);
});

it("aborts sound already playing when the renderer unmounts", async () => {
  playback.soundStarts.length = 0;
  playback.speechStarts.length = 0;
  harness.state.threads = [];
  harness.state.settings = { ...harness.state.settings, completionAlertSpeechEnabled: true };
  render(<DesktopNotificationWatcher />);
  await completeTurn();

  await vi.waitFor(() => expect(playback.soundStarts).toHaveLength(1), { timeout: 4_000 });
  cleanup();
  await vi.waitFor(() => expect(playback.soundStarts.at(-1)!.aborted).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 50));
  // A late speech stage must not reach a torn-down renderer.
  expect(playback.speechStarts).toHaveLength(0);
});
