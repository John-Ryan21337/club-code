import { describe, expect, it } from "vitest";
import { createMatrixAudioColorState, resolveMatrixAudioColor } from "./matrixAudioColor";
import {
  EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL,
  type LocalMediaAudioSignal,
} from "./localMediaAudioSignal";
import { resolveMatrixAtmosphereColorFrame } from "./windowAtmosphere";

const signal = (patch: Partial<LocalMediaAudioSignal> = {}): LocalMediaAudioSignal => ({
  active: true,
  level: 0.5,
  bass: 0.3,
  mid: 0.4,
  treble: 0.2,
  beat: 0,
  sampledAt: 1000,
  ...patch,
});
describe("Matrix approved audio palette", () => {
  it("uses the fixed fallback without fresh audible input and clears prior animation state", () => {
    const state = createMatrixAudioColorState();
    expect(resolveMatrixAudioColor("#123456", true, 1000, signal(), state, 1, true).perStream).toBe(
      true,
    );
    for (const sample of [
      EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL,
      signal({ sampledAt: 899 }),
      signal({ sampledAt: 1001 }),
      signal({ level: 0, bass: 0, mid: 0, treble: 0, beat: 1 }),
    ]) {
      expect(resolveMatrixAudioColor("#123456", true, 1000, sample, state, 1, true)).toEqual({
        color: "#123456",
        perStream: false,
        baseHue: null,
        saturation: null,
        lightness: null,
      });
      expect(state.hue).toBeNull();
    }
  });
  it("bounds continuous hue and lightness and applies each beat only once per sample", () => {
    const state = createMatrixAudioColorState();
    const first = resolveMatrixAudioColor(
      "#123456",
      true,
      1000,
      signal({ beat: 0 }),
      state,
      64,
      false,
    );
    const second = resolveMatrixAudioColor(
      "#123456",
      true,
      1030,
      signal({ sampledAt: 1030, level: 1, bass: 1, mid: 1, treble: 1, beat: 1 }),
      state,
      64,
      false,
    );
    expect(second.baseHue! - first.baseHue!).toBeCloseTo(110 * 0.03 + 22);
    expect(second.lightness! - first.lightness!).toBeLessThanOrEqual(42 * 0.03 + 1e-9);
    const repeated = resolveMatrixAudioColor(
      "#123456",
      true,
      1030,
      signal({ sampledAt: 1030, beat: 1 }),
      state,
      64,
      false,
    );
    expect(repeated.baseHue).toBe(second.baseHue);
    expect(repeated.lightness).toBe(second.lightness);
  });
  it("keeps hostile feature values finite and integrates both modes with the existing palette caller", () => {
    const extreme = signal({ level: Infinity, bass: -10, mid: NaN, treble: 100, beat: 100 });
    for (const mode of ["music-reactive", "music-reactive-extra"] as const) {
      const result = resolveMatrixAtmosphereColorFrame(
        mode,
        "auto",
        true,
        1000,
        1,
        extreme,
        createMatrixAudioColorState(),
      );
      expect(result.color).not.toMatch(/NaN|Infinity/);
      expect(result.perStream).toBe(mode.endsWith("extra"));
      expect(result.lightness).toBeLessThanOrEqual(81);
    }
    expect(resolveMatrixAtmosphereColorFrame("music-reactive", "#abcdef", true, 1000).color).toBe(
      "#abcdef",
    );
  });
});
