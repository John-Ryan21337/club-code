import { describe, expect, it } from "vitest";

import {
  MAX_ATMOSPHERE_DPR,
  MAX_ATMOSPHERE_CANVAS_PIXELS,
  MAX_ATMOSPHERE_FRAME_DELTA_SECONDS,
  MAX_ATMOSPHERE_PARTICLES_BY_KIND,
  MATRIX_ENRICHED_JAPANESE_GLYPHS,
  MATRIX_ENRICHED_JAPANESE_TOKENS,
  MATRIX_JAPANESE_GLYPHS,
  MATRIX_ROMAN_GLYPHS,
  MATRIX_RAINBOW_CYCLE_MS,
  advanceAtmosphereSceneInPlace,
  calculateAtmosphereParticleCount,
  clampAtmosphereDpr,
  clampFallingEffectDensity,
  fitAtmosphereDpr,
  createAtmosphereScene,
  createMatrixColorAnimationState,
  createSeededRandom,
  resolveAtmosphereColor,
  resolveMatrixAtmosphereColor,
  shouldAnimateAtmosphere,
} from "./windowAtmosphere";

function hueFromHsl(color: string): number {
  return Number(/^hsl\(([\d.]+)/.exec(color)?.[1]);
}

describe("window atmosphere", () => {
  it("builds deterministic scenes from a seeded random source", () => {
    const first = createAtmosphereScene("snow", 1_280, 720, createSeededRandom(42));
    const second = createAtmosphereScene("snow", 1_280, 720, createSeededRandom(42));
    const different = createAtmosphereScene("snow", 1_280, 720, createSeededRandom(43));

    expect(first).toEqual(second);
    expect(first).not.toEqual(different);
  });

  it("bounds DPR and density-scaled particle counts", () => {
    expect(clampAtmosphereDpr(0)).toBe(1);
    expect(clampAtmosphereDpr(1.5)).toBe(1.5);
    expect(clampAtmosphereDpr(8)).toBe(MAX_ATMOSPHERE_DPR);
    expect(fitAtmosphereDpr(8, 1_000, 1_000)).toBe(MAX_ATMOSPHERE_DPR);
    expect(fitAtmosphereDpr(2, 8_000, 4_000) ** 2 * 8_000 * 4_000).toBeLessThanOrEqual(
      MAX_ATMOSPHERE_CANVAS_PIXELS,
    );

    expect(calculateAtmosphereParticleCount("snow", 0, 720)).toBe(0);
    expect(calculateAtmosphereParticleCount("snow", 1_280, 720, 0.5)).toBe(33);
    expect(calculateAtmosphereParticleCount("snow", 1_280, 720, 2.5)).toBe(165);
    expect(calculateAtmosphereParticleCount("snow", 20_000, 20_000, 2.5)).toBe(
      MAX_ATMOSPHERE_PARTICLES_BY_KIND.snow,
    );
    expect(calculateAtmosphereParticleCount("rain", 20_000, 20_000, 2.5)).toBe(
      MAX_ATMOSPHERE_PARTICLES_BY_KIND.rain,
    );
    expect(calculateAtmosphereParticleCount("matrix", 20_000, 20_000, 2.5)).toBe(
      MAX_ATMOSPHERE_PARTICLES_BY_KIND.matrix,
    );
    expect(clampFallingEffectDensity(Number.NaN)).toBe(1);
    expect(clampFallingEffectDensity(99)).toBe(2.5);
  });

  it("deterministically selects reviewed Matrix glyph pools by Japanese ratio", () => {
    const romanOnly = createAtmosphereScene("matrix", 20_000, 720, createSeededRandom(7), 1, 0);
    const japaneseOnly = createAtmosphereScene("matrix", 20_000, 720, createSeededRandom(7), 1, 1);
    const defaultScene = createAtmosphereScene("matrix", 20_000, 720, createSeededRandom(7));
    const repeatedDefault = createAtmosphereScene("matrix", 20_000, 720, createSeededRandom(7));

    expect(romanOnly.particles).toHaveLength(MAX_ATMOSPHERE_PARTICLES_BY_KIND.matrix);
    expect(romanOnly.particles.every((particle) => particle.glyphs === MATRIX_ROMAN_GLYPHS)).toBe(
      true,
    );
    expect(romanOnly.particles.every((particle) => particle.matrixToken === null)).toBe(true);
    expect(
      japaneseOnly.particles.every((particle) => particle.glyphs === MATRIX_JAPANESE_GLYPHS),
    ).toBe(true);
    expect(defaultScene).toEqual(repeatedDefault);
    expect(defaultScene.particles.some((particle) => particle.glyphs === MATRIX_ROMAN_GLYPHS)).toBe(
      true,
    );
    expect(
      defaultScene.particles.some((particle) => particle.glyphs === MATRIX_JAPANESE_GLYPHS),
    ).toBe(true);
  });

  it("keeps enrichment off by default and adds only intact reviewed tokens when enabled", () => {
    const withoutEnrichment = createAtmosphereScene(
      "matrix",
      20_000,
      720,
      createSeededRandom(9),
      1,
      1,
      false,
    );
    const enriched = createAtmosphereScene(
      "matrix",
      20_000,
      720,
      createSeededRandom(9),
      1,
      1,
      true,
    );
    const ratioDisablesJapanese = createAtmosphereScene(
      "matrix",
      20_000,
      720,
      createSeededRandom(9),
      1,
      0,
      true,
    );

    expect(
      withoutEnrichment.particles.every((particle) => particle.glyphs === MATRIX_JAPANESE_GLYPHS),
    ).toBe(true);
    expect(withoutEnrichment.particles.every((particle) => particle.matrixToken === null)).toBe(
      true,
    );
    expect(
      enriched.particles.some((particle) => particle.glyphs === MATRIX_ENRICHED_JAPANESE_GLYPHS),
    ).toBe(true);
    expect(
      enriched.particles
        .map((particle) => particle.matrixToken)
        .filter(
          (token): token is (typeof MATRIX_ENRICHED_JAPANESE_TOKENS)[number] => token !== null,
        )
        .every((token) => MATRIX_ENRICHED_JAPANESE_TOKENS.includes(token)),
    ).toBe(true);
    expect(enriched.particles.some((particle) => particle.matrixToken !== null)).toBe(true);
    expect(
      ratioDisablesJapanese.particles.every((particle) => particle.glyphs === MATRIX_ROMAN_GLYPHS),
    ).toBe(true);
    expect(ratioDisablesJapanese.particles.every((particle) => particle.matrixToken === null)).toBe(
      true,
    );
  });

  it("caps long frame gaps and applies the speed multiplier", () => {
    const scene = createAtmosphereScene("rain", 800, 600, createSeededRandom(7));
    const particle = scene.particles[0]!;
    particle.y = 0;
    const initialY = particle.y;
    const velocityY = particle.velocityY;

    advanceAtmosphereSceneInPlace(scene, 30, 2);

    expect(particle.y - initialY).toBeCloseTo(velocityY * MAX_ATMOSPHERE_FRAME_DELTA_SECONDS * 2);
  });

  it("resolves conservative automatic colors while preserving explicit colors", () => {
    expect(resolveAtmosphereColor("snow", "auto", true)).toBe("#f8fafc");
    expect(resolveAtmosphereColor("rain", "auto", false)).toBe("#0369a1");
    expect(resolveAtmosphereColor("matrix", "auto", true)).toBe("#4ade80");
    expect(resolveAtmosphereColor("matrix", "#123abc", true)).toBe("#123abc");
  });

  it("keeps Matrix color fixed by default, cycles rainbow smoothly, and falls back safely without fresh audio", () => {
    const fixedState = createMatrixColorAnimationState();
    expect(
      resolveMatrixAtmosphereColor(
        "fixed",
        "#123abc",
        true,
        100,
        { active: true, level: 1, sampledAt: 100 },
        fixedState,
      ),
    ).toBe("#123abc");

    const rainbowState = createMatrixColorAnimationState();
    const rainbowStart = resolveMatrixAtmosphereColor(
      "rainbow",
      "auto",
      true,
      0,
      { active: false, level: 0, sampledAt: Number.NEGATIVE_INFINITY },
      rainbowState,
    );
    const rainbowHalf = resolveMatrixAtmosphereColor(
      "rainbow",
      "auto",
      true,
      MATRIX_RAINBOW_CYCLE_MS / 2,
      { active: false, level: 0, sampledAt: Number.NEGATIVE_INFINITY },
      rainbowState,
    );
    expect(rainbowStart).toBe("hsl(0.0 88% 62%)");
    expect(rainbowHalf).toBe("hsl(180.0 88% 62%)");

    const musicState = createMatrixColorAnimationState();
    expect(
      resolveMatrixAtmosphereColor(
        "music-reactive",
        "#123abc",
        true,
        2_000,
        { active: true, level: 1, sampledAt: 100 },
        musicState,
      ),
    ).toBe("#123abc");
    expect(
      resolveMatrixAtmosphereColor(
        "music-reactive",
        "#123abc",
        true,
        2_000,
        { active: true, level: 0, sampledAt: 2_000 },
        musicState,
      ),
    ).toBe("#123abc");
  });

  it("caps music-reactive Matrix palette transitions", () => {
    const state = createMatrixColorAnimationState();
    const first = resolveMatrixAtmosphereColor(
      "music-reactive",
      "auto",
      true,
      1_000,
      { active: true, level: 0.1, sampledAt: 1_000 },
      state,
    );
    const second = resolveMatrixAtmosphereColor(
      "music-reactive",
      "auto",
      true,
      1_100,
      { active: true, level: 1, sampledAt: 1_100 },
      state,
    );
    expect(Number.isFinite(hueFromHsl(first))).toBe(true);
    expect(Math.abs(hueFromHsl(second) - hueFromHsl(first))).toBeLessThanOrEqual(11.1);
  });

  it("stops for reduced motion and pauses in the background unless explicitly allowed", () => {
    const foreground = {
      enabled: true,
      reducedMotion: false,
      documentVisible: true,
      windowFocused: true,
      continueBackgroundAnimations: false,
    };

    expect(shouldAnimateAtmosphere(foreground)).toBe(true);
    expect(shouldAnimateAtmosphere({ ...foreground, enabled: false })).toBe(false);
    expect(shouldAnimateAtmosphere({ ...foreground, reducedMotion: true })).toBe(false);
    expect(shouldAnimateAtmosphere({ ...foreground, windowFocused: false })).toBe(false);
    expect(
      shouldAnimateAtmosphere({
        ...foreground,
        documentVisible: false,
        windowFocused: false,
        continueBackgroundAnimations: true,
      }),
    ).toBe(true);
    expect(
      shouldAnimateAtmosphere({
        ...foreground,
        reducedMotion: true,
        continueBackgroundAnimations: true,
      }),
    ).toBe(false);
  });
});
