import {
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  type FallingEffectKind,
  type FallingEffectMatrixMotionMode,
} from "@cafecode/contracts/settings";
import { describe, expect, it } from "vitest";

import {
  advanceAtmosphereSceneInPlace,
  createAtmosphereScene,
  createSeededRandom,
  isMatrixWalkMotionMode,
  resolveAtmosphereProjectedPointInPlace,
  resolveMatrixWalkLifecycleOpacity,
  type AtmosphereProjectedPoint,
} from "./windowAtmosphere";

const MOTION_MODES: readonly FallingEffectMatrixMotionMode[] = [
  "flat",
  "forward",
  "reverse",
  "tunnel",
  "walk-forward",
  "walk-reverse",
];
const KINDS: readonly FallingEffectKind[] = ["snow", "rain", "matrix"];
const VIEWPORTS = [
  { width: 3_840, height: 900 },
  { width: 420, height: 2_000 },
  { width: 1_280, height: 720 },
] as const;

function projection(): AtmosphereProjectedPoint {
  return { x: 0, y: 0, scale: 1, depthScale: 1 };
}

describe("bounded atmosphere motion", () => {
  it("projects finite bounded geometry for every effect and motion combination", () => {
    const output = projection();
    for (const kind of KINDS) {
      for (const motionMode of MOTION_MODES) {
        for (const viewport of VIEWPORTS) {
          const scene = createAtmosphereScene(
            kind,
            viewport.width,
            viewport.height,
            createSeededRandom(7),
            1,
            0.5,
            motionMode,
            30,
            4,
          );
          expect(scene.particles.length).toBeGreaterThan(0);
          for (let step = 0; step < 20; step += 1) {
            advanceAtmosphereSceneInPlace(scene, 0.016, 1, motionMode, 30, 4);
          }
          for (const particle of scene.particles) {
            expect(Number.isFinite(particle.x)).toBe(true);
            expect(Number.isFinite(particle.y)).toBe(true);
            resolveAtmosphereProjectedPointInPlace(
              output,
              scene,
              particle,
              particle.x,
              particle.y,
              motionMode,
              DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
              DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
            );
            expect(Number.isFinite(output.x)).toBe(true);
            expect(Number.isFinite(output.y)).toBe(true);
            expect(output.scale).toBeGreaterThan(0);
            expect(output.scale).toBeLessThanOrEqual(200);
            expect(output.depthScale).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("keeps Flat projection identical to the source coordinates", () => {
    const scene = createAtmosphereScene("matrix", 800, 600, createSeededRandom(3), 1, 0);
    const output = projection();
    const particle = scene.particles[0]!;
    resolveAtmosphereProjectedPointInPlace(output, scene, particle, 123.5, 456.25, "flat");
    expect(output).toEqual({ x: 123.5, y: 456.25, scale: 1, depthScale: 1 });
  });

  it("mirrors Forward and Reverse depth ramps", () => {
    const scene = createAtmosphereScene("matrix", 1_000, 800, createSeededRandom(5), 1, 0);
    const particle = scene.particles[3]!;
    const forward = projection();
    const reverse = projection();
    resolveAtmosphereProjectedPointInPlace(forward, scene, particle, particle.x, 40, "forward");
    resolveAtmosphereProjectedPointInPlace(reverse, scene, particle, particle.x, 40, "reverse");
    expect(forward.scale).toBeLessThan(reverse.scale);

    const deepForward = projection();
    resolveAtmosphereProjectedPointInPlace(
      deepForward,
      scene,
      particle,
      particle.x,
      760,
      "forward",
    );
    expect(deepForward.scale).toBeGreaterThan(forward.scale);
  });

  it("projects Warp from the viewport center", () => {
    const scene = createAtmosphereScene("matrix", 1_000, 800, createSeededRandom(9), 1, 0);
    const particle = scene.particles[0]!;
    particle.phase = 0;
    const nearField = projection();
    const farField = projection();
    resolveAtmosphereProjectedPointInPlace(nearField, scene, particle, particle.x, 0, "tunnel");
    resolveAtmosphereProjectedPointInPlace(farField, scene, particle, particle.x, 800, "tunnel");

    const centerX = scene.width * 0.5;
    const centerY = scene.height * 0.5;
    const nearRadius = Math.hypot(nearField.x - centerX, nearField.y - centerY);
    const farRadius = Math.hypot(farField.x - centerX, farField.y - centerY);
    expect(nearRadius).toBeLessThan(farRadius);
    expect(nearField.scale).toBeLessThan(farField.scale);
  });

  it("interpolates the exact Walk size endpoints across the lifecycle", () => {
    const scene = createAtmosphereScene(
      "matrix",
      1_000,
      800,
      createSeededRandom(13),
      1,
      0,
      "walk-forward",
      30,
      0,
    );
    const particle = scene.particles[0]!;
    const output = projection();

    particle.matrixLifecycleProgress = 0;
    resolveAtmosphereProjectedPointInPlace(
      output,
      scene,
      particle,
      particle.x,
      particle.y,
      "walk-forward",
      8,
      64,
    );
    expect(particle.size * output.scale).toBeCloseTo(8, 5);

    particle.matrixLifecycleProgress = 1;
    resolveAtmosphereProjectedPointInPlace(
      output,
      scene,
      particle,
      particle.x,
      particle.y,
      "walk-forward",
      8,
      64,
    );
    expect(particle.size * output.scale).toBeCloseTo(64, 5);
  });

  it("reverses the Walk size interpolation for Walk Reverse", () => {
    const scene = createAtmosphereScene(
      "matrix",
      1_000,
      800,
      createSeededRandom(17),
      1,
      0,
      "walk-reverse",
      30,
      0,
    );
    const particle = scene.particles[0]!;
    const output = projection();

    particle.matrixLifecycleProgress = 0;
    resolveAtmosphereProjectedPointInPlace(
      output,
      scene,
      particle,
      particle.x,
      particle.y,
      "walk-reverse",
      8,
      64,
    );
    expect(particle.size * output.scale).toBeCloseTo(64, 5);
  });

  it("follows the particle lifecycle rather than viewport Y and fades before respawn", () => {
    const scene = createAtmosphereScene(
      "matrix",
      900,
      600,
      createSeededRandom(21),
      1,
      0,
      "walk-forward",
      30,
      0,
    );
    expect(isMatrixWalkMotionMode("walk-forward")).toBe(true);
    const particle = scene.particles[0]!;
    // Walk streams are seeded across the whole lifecycle so enabling the mode
    // produces a full field immediately instead of an empty top-down sweep.
    expect(scene.particles.some((candidate) => candidate.matrixLifecycleProgress > 0.5)).toBe(true);

    particle.matrixLifecycleProgress = 0.5;
    advanceAtmosphereSceneInPlace(scene, 0.016, 1, "walk-forward", 30, 0);
    expect(resolveMatrixWalkLifecycleOpacity(particle, "walk-forward")).toBe(1);

    particle.matrixLifecycleProgress = 0.9;
    advanceAtmosphereSceneInPlace(scene, 0.016, 1, "walk-forward", 30, 0);
    const fading = resolveMatrixWalkLifecycleOpacity(particle, "walk-forward");
    expect(fading).toBeGreaterThan(0);
    expect(fading).toBeLessThan(1);

    const generation = particle.matrixLifecycleGeneration;
    particle.matrixLifecycleProgress = 0.999;
    for (let step = 0; step < 200; step += 1) {
      advanceAtmosphereSceneInPlace(scene, 0.05, 4, "walk-forward", 30, 0);
      if (particle.matrixLifecycleGeneration > generation) break;
    }
    expect(particle.matrixLifecycleGeneration).toBeGreaterThan(generation);
    expect(particle.matrixLifecycleProgress).toBeLessThan(1);
    expect(particle.y).toBeGreaterThanOrEqual(0);
    expect(particle.y).toBeLessThanOrEqual(scene.height);
  });

  it("derives signed center wind from the distance to the viewport center", () => {
    const scene = createAtmosphereScene(
      "matrix",
      1_000,
      600,
      createSeededRandom(29),
      1,
      0,
      "walk-forward",
      30,
      10,
    );
    const left = scene.particles[0]!;
    const right = scene.particles[scene.particles.length - 1]!;
    advanceAtmosphereSceneInPlace(scene, 0.016, 1, "walk-forward", 30, 10);
    expect(left.velocityX).toBeLessThan(0);
    expect(right.velocityX).toBeGreaterThan(0);

    const calm = createAtmosphereScene(
      "matrix",
      1_000,
      600,
      createSeededRandom(29),
      1,
      0,
      "walk-forward",
      30,
      0,
    );
    advanceAtmosphereSceneInPlace(calm, 0.016, 1, "walk-forward", 30, 0);
    for (const particle of calm.particles) {
      expect(Math.abs(particle.velocityX)).toBe(0);
    }
  });
});
