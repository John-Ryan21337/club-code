import { describe, expect, it } from "vitest";

import {
  MAX_ATMOSPHERE_DPR,
  MAX_ATMOSPHERE_CANVAS_PIXELS,
  MAX_ATMOSPHERE_FRAME_DELTA_SECONDS,
  advanceAtmosphereSceneInPlace,
  calculateAtmosphereParticleCount,
  clampAtmosphereDpr,
  fitAtmosphereDpr,
  createAtmosphereScene,
  createSeededRandom,
  resolveAtmosphereColor,
  shouldAnimateAtmosphere,
} from "./windowAtmosphere";

describe("window atmosphere", () => {
  it("builds deterministic scenes from a seeded random source", () => {
    const first = createAtmosphereScene("snow", 1_280, 720, createSeededRandom(42));
    const second = createAtmosphereScene("snow", 1_280, 720, createSeededRandom(42));
    const different = createAtmosphereScene("snow", 1_280, 720, createSeededRandom(43));

    expect(first).toEqual(second);
    expect(first).not.toEqual(different);
  });

  it("bounds DPR and particle counts", () => {
    expect(clampAtmosphereDpr(0)).toBe(1);
    expect(clampAtmosphereDpr(1.5)).toBe(1.5);
    expect(clampAtmosphereDpr(8)).toBe(MAX_ATMOSPHERE_DPR);
    expect(fitAtmosphereDpr(8, 1_000, 1_000)).toBe(MAX_ATMOSPHERE_DPR);
    expect(fitAtmosphereDpr(2, 8_000, 4_000) ** 2 * 8_000 * 4_000).toBeLessThanOrEqual(
      MAX_ATMOSPHERE_CANVAS_PIXELS,
    );

    expect(calculateAtmosphereParticleCount("snow", 0, 720)).toBe(0);
    expect(calculateAtmosphereParticleCount("snow", 20_000, 20_000)).toBe(160);
    expect(calculateAtmosphereParticleCount("rain", 20_000, 20_000)).toBe(220);
    expect(calculateAtmosphereParticleCount("matrix", 20_000, 20_000)).toBe(80);
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
