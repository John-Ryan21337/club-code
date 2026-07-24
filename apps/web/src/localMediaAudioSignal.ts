/**
 * A tiny renderer-session-only signal shared by the approved Local Media
 * analyser and decorative consumers. It contains neither PCM nor spectrum
 * history, is never persisted, and deliberately has no remote/iframe,
 * microphone, or system-audio input.
 */
export interface LocalMediaAudioSignal {
  readonly active: boolean;
  readonly level: number;
  /** `performance.now()` at the bounded analyser sample. */
  readonly sampledAt: number;
}

export const EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL: LocalMediaAudioSignal = {
  active: false,
  level: 0,
  sampledAt: Number.NEGATIVE_INFINITY,
};

export const MAX_LOCAL_MEDIA_AUDIO_SIGNAL_AGE_MS = 1_500;

export interface LocalMediaAudioSignalStore {
  readonly getSnapshot: () => LocalMediaAudioSignal;
  readonly publish: (owner: object, level: number, sampledAt: number) => void;
  readonly clear: (owner: object) => void;
}

function normalizeLevel(level: number): number {
  return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
}

/**
 * Last-publisher-wins avoids an outgoing media element clearing a newer
 * element's signal during a React handoff. No listener/render loop is needed:
 * the atmosphere reads this bounded snapshot inside its own RAF.
 */
export function createLocalMediaAudioSignalStore(): LocalMediaAudioSignalStore {
  let owner: object | null = null;
  let snapshot = EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL;

  return {
    getSnapshot: () => snapshot,
    publish: (nextOwner, level, sampledAt) => {
      if (!Number.isFinite(sampledAt)) return;
      owner = nextOwner;
      snapshot = { active: true, level: normalizeLevel(level), sampledAt };
    },
    clear: (currentOwner) => {
      if (owner !== currentOwner) return;
      owner = null;
      snapshot = EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL;
    },
  };
}

export const localMediaAudioSignalStore = createLocalMediaAudioSignalStore();

export function hasFreshLocalMediaAudioSignal(signal: LocalMediaAudioSignal, now: number): boolean {
  return (
    signal.active &&
    Number.isFinite(now) &&
    Number.isFinite(signal.sampledAt) &&
    now >= signal.sampledAt &&
    now - signal.sampledAt <= MAX_LOCAL_MEDIA_AUDIO_SIGNAL_AGE_MS
  );
}
