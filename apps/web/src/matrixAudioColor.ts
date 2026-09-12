import { hasFreshLocalMediaAudioSignal, type LocalMediaAudioSignal } from "./localMediaAudioSignal";
import type { MatrixColorFrame } from "./windowAtmosphere";

export interface MatrixAudioColorState {
  hue: number | null;
  lightness: number | null;
  lastUpdatedAt: number | null;
  lastSignalSampledAt: number | null;
}
export const createMatrixAudioColorState = (): MatrixAudioColorState => ({
  hue: null,
  lightness: null,
  lastUpdatedAt: null,
  lastSignalSampledAt: null,
});
const normalize = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
const wrapHue = (value: number) => ((value % 360) + 360) % 360;
const MIN_LEVEL = 0.015;
const MAX_HUE_RATE = 110;
const MAX_LIGHTNESS_RATE = 42;
const MAX_BEAT_IMPULSE = 22;

/** The Club palette consumes one fresh coarse sample from the existing frame
 * clock. It cannot acquire audio. Quiet/stale samples restore the fixed color. */
export function resolveMatrixAudioColor(
  fallback: string,
  darkTheme: boolean,
  timestamp: number,
  signal: LocalMediaAudioSignal,
  state: MatrixAudioColorState,
  colorCycleSpeed: number,
  perStream: boolean,
): MatrixColorFrame {
  const now = Number.isFinite(timestamp) ? Math.max(0, timestamp) : 0;
  const level = normalize(signal.level),
    bass = normalize(signal.bass),
    mid = normalize(signal.mid),
    treble = normalize(signal.treble),
    beat = normalize(signal.beat);
  if (
    !hasFreshLocalMediaAudioSignal(signal, now) ||
    Math.max(level, bass, mid, treble) < MIN_LEVEL
  ) {
    state.hue = null;
    state.lightness = null;
    state.lastUpdatedAt = now;
    state.lastSignalSampledAt = null;
    return { color: fallback, perStream: false, baseHue: null, saturation: null, lightness: null };
  }
  const elapsed =
    state.lastUpdatedAt === null
      ? 0
      : Math.min(0.1, Math.max(0, (now - state.lastUpdatedAt) / 1000));
  const total = bass + mid + treble;
  const spectralHue = total <= 0 ? 110 : wrapHue((bass * 18 + mid * 150 + treble * 286) / total);
  const rate = Math.min(MAX_HUE_RATE, 14 + level * 30 + bass * 18 + mid * 28 + treble * 42);
  const speed = Number.isFinite(colorCycleSpeed)
    ? Math.min(64, Math.max(0.25, colorCycleSpeed))
    : 1;
  const newSample =
    state.lastSignalSampledAt === null || signal.sampledAt > state.lastSignalSampledAt;
  state.hue =
    state.hue === null
      ? spectralHue
      : wrapHue(
          state.hue +
            Math.min(MAX_HUE_RATE, rate * speed) * elapsed +
            (newSample ? beat * MAX_BEAT_IMPULSE : 0),
        );
  const target = (darkTheme ? 45 : 33) + level * 22 + bass * 4 + beat * 10;
  state.lightness =
    state.lightness === null
      ? target
      : state.lightness +
        Math.min(
          MAX_LIGHTNESS_RATE * elapsed,
          Math.max(-MAX_LIGHTNESS_RATE * elapsed, target - state.lightness),
        );
  state.lastUpdatedAt = now;
  state.lastSignalSampledAt = signal.sampledAt;
  const saturation = Math.min(96, 70 + level * 15 + treble * 11);
  return {
    color: `hsl(${state.hue.toFixed(1)} ${saturation.toFixed(1)}% ${state.lightness.toFixed(1)}%)`,
    perStream,
    baseHue: state.hue,
    saturation,
    lightness: state.lightness,
  };
}
