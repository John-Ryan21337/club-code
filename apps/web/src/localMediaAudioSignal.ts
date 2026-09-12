/**
 * One bounded, renderer-session-only activity sample from an approved direct,
 * VLC, or explicitly shared display-audio analyser. It contains no PCM,
 * frequency bins, or history and is never persisted or exposed outside this
 * renderer.
 */
export interface LocalMediaAudioSignal {
  readonly active: boolean;
  readonly level: number;
  /** Coarse normalized energy bands; these are not recoverable spectrum bins. */
  readonly bass: number;
  readonly mid: number;
  readonly treble: number;
  /** Bounded transient/onset strength derived inside the active analyser. */
  readonly beat: number;
  /** `requestAnimationFrame`'s monotonic timestamp for this sample. */
  readonly sampledAt: number;
}

export type LocalMediaAudioFeatures = Pick<
  LocalMediaAudioSignal,
  "level" | "bass" | "mid" | "treble" | "beat"
>;

export const EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL: LocalMediaAudioSignal = {
  active: false,
  level: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  beat: 0,
  sampledAt: Number.NEGATIVE_INFINITY,
};

/** Three missed 30 FPS samples are enough to fall back without visible flicker. */
export const MAX_LOCAL_MEDIA_AUDIO_SIGNAL_AGE_MS = 100;

export interface LocalMediaAudioSignalStore {
  readonly getSnapshot: () => LocalMediaAudioSignal;
  readonly claim: (owner: object) => void;
  readonly publish: (owner: object, features: LocalMediaAudioFeatures, sampledAt: number) => void;
  readonly release: (owner: object) => void;
}

function normalizeLevel(level: number): number {
  return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
}

/**
 * Ownership is claimed at controller activation, rather than implicitly on
 * every frame. This prevents a late frame from an outgoing media element from
 * replacing or clearing the newer element's signal during a React handoff.
 *
 * There is intentionally no subscription API: decorative consumers read the
 * current sample from their existing animation frame, so audio never causes a
 * React render or creates another scheduling loop.
 */
export function createLocalMediaAudioSignalStore(): LocalMediaAudioSignalStore {
  let owner: object | null = null;
  let snapshot = EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL;

  return {
    getSnapshot: () => snapshot,
    claim: (nextOwner) => {
      if (owner === nextOwner) return;
      owner = nextOwner;
      snapshot = EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL;
    },
    publish: (currentOwner, features, sampledAt) => {
      if (owner !== currentOwner || !Number.isFinite(sampledAt)) return;
      if (snapshot.active && sampledAt <= snapshot.sampledAt) return;
      snapshot = {
        active: true,
        level: normalizeLevel(features.level),
        bass: normalizeLevel(features.bass),
        mid: normalizeLevel(features.mid),
        treble: normalizeLevel(features.treble),
        beat: normalizeLevel(features.beat),
        sampledAt,
      };
    },
    release: (currentOwner) => {
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
