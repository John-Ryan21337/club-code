import type { FallingEffectMatrixMotionMode } from "@cafecode/contracts/settings";
import { describe, expect, it, vi } from "vitest";

import {
  MATRIX_WALK_FONT_MAX_PX,
  MATRIX_WALK_FONT_MIN_PX,
  drawAtmosphereScene,
  resolveAtmosphereProjectedPointInPlace,
  resolveAtmosphereRenderOpacity,
  shouldAnimateAtmosphere,
  shouldShowAtmosphere,
  type AtmosphereParticle,
  type AtmosphereProjectedPoint,
  type AtmosphereScene,
} from "./windowAtmosphere";

function createParticle(overrides: Partial<AtmosphereParticle> = {}): AtmosphereParticle {
  return {
    x: 80,
    y: 120,
    velocityX: -24,
    velocityY: 80,
    size: 14,
    phase: 0.7,
    glyphOffset: 0,
    glyphs: "01",
    matrixLanguage: "english",
    matrixToken: null,
    matrixWorkToken: null,
    ...overrides,
  };
}

function createScene(kind: AtmosphereScene["kind"], particle = createParticle()): AtmosphereScene {
  return { kind, width: 400, height: 240, particles: [particle] };
}

function project(
  scene: AtmosphereScene,
  particle: AtmosphereParticle,
  x: number,
  y: number,
  mode: FallingEffectMatrixMotionMode,
): AtmosphereProjectedPoint {
  const output = { x: 0, y: 0, scale: 0 };
  resolveAtmosphereProjectedPointInPlace(output, scene, particle, x, y, mode);
  return output;
}

function createContextRecorder() {
  const arcs: Array<readonly [number, number, number]> = [];
  const moves: Array<readonly [number, number]> = [];
  const lines: Array<readonly [number, number]> = [];
  const texts: Array<readonly [string, number, number, number | undefined]> = [];
  const fonts: string[] = [];
  const context = {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn((x: number, y: number, radius: number) => arcs.push([x, y, radius])),
    moveTo: vi.fn((x: number, y: number) => moves.push([x, y])),
    lineTo: vi.fn((x: number, y: number) => lines.push([x, y])),
    fillText: vi.fn(function (
      this: { font: string },
      text: string,
      x: number,
      y: number,
      maxWidth?: number,
    ) {
      fonts.push(this.font);
      texts.push([text, x, y, maxWidth]);
    }),
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineCap: "butt",
    lineWidth: 1,
    textAlign: "start",
    textBaseline: "alphabetic",
    font: "",
  } as unknown as CanvasRenderingContext2D;
  return { context, arcs, moves, lines, texts, fonts };
}

describe("atmosphere motion projection", () => {
  it("keeps Flat byte-for-byte geometric semantics for every effect kind", () => {
    for (const kind of ["snow", "rain", "matrix"] as const) {
      const particle = createParticle();
      const scene = createScene(kind, particle);
      expect(project(scene, particle, 73.25, -19.5, "flat")).toEqual({
        x: 73.25,
        y: -19.5,
        scale: 1,
      });
    }
  });

  it("mirrors Forward and Reverse depth without changing falling direction", () => {
    for (const kind of ["snow", "rain", "matrix"] as const) {
      const particle = createParticle();
      const scene = createScene(kind, particle);
      const nearForward = project(scene, particle, 80, 0, "forward");
      const farForward = project(scene, particle, 80, scene.height, "forward");
      const nearReverse = project(scene, particle, 80, 0, "reverse");
      const farReverse = project(scene, particle, 80, scene.height, "reverse");

      expect(nearForward.scale).toBeLessThan(farForward.scale);
      expect(nearReverse.scale).toBeGreaterThan(farReverse.scale);
      expect(nearForward.y).toBe(0);
      expect(farForward.y).toBe(scene.height);
      expect(nearReverse.y).toBe(0);
      expect(farReverse.y).toBe(scene.height);
      expect(nearForward.scale + nearReverse.scale).toBeCloseTo(1.99, 10);
      expect(farForward.scale + farReverse.scale).toBeCloseTo(1.99, 10);
    }
  });

  it("mirrors fluid 1.00px-to-72.00px Walk depth for every effect kind", () => {
    for (const kind of ["snow", "rain", "matrix"] as const) {
      const particle = createParticle();
      const scene = createScene(kind, particle);
      const topForward = project(scene, particle, 80, 0, "walk-forward");
      const bottomForward = project(scene, particle, 80, scene.height, "walk-forward");
      const topReverse = project(scene, particle, 80, 0, "walk-reverse");
      const bottomReverse = project(scene, particle, 80, scene.height, "walk-reverse");

      expect(topForward.scale * particle.size).toBeCloseTo(MATRIX_WALK_FONT_MIN_PX, 10);
      expect(bottomForward.scale * particle.size).toBeCloseTo(MATRIX_WALK_FONT_MAX_PX, 10);
      expect(topReverse.scale * particle.size).toBeCloseTo(MATRIX_WALK_FONT_MAX_PX, 10);
      expect(bottomReverse.scale * particle.size).toBeCloseTo(MATRIX_WALK_FONT_MIN_PX, 10);
      expect(topForward.y).toBe(0);
      expect(bottomForward.y).toBe(scene.height);
      expect(topReverse.y).toBe(0);
      expect(bottomReverse.y).toBe(scene.height);

      const intermediate = project(scene, particle, 80, scene.height * 0.432_187, "walk-forward");
      const intermediateSize = intermediate.scale * particle.size;
      expect(intermediateSize * 100).toBeCloseTo(Math.round(intermediateSize * 100), 10);
    }
  });

  it("renders Walk Matrix glyphs with two-decimal endpoint font sizes", () => {
    const particle = createParticle({ y: 0 });
    const scene = createScene("matrix", particle);
    const forwardTop = createContextRecorder();
    drawAtmosphereScene(forwardTop.context, scene, "#00ff00", 0.6, undefined, "walk-forward");
    expect(forwardTop.fonts.at(-1)).toMatch(/^1\.00px /u);

    particle.y = scene.height;
    const forwardBottom = createContextRecorder();
    drawAtmosphereScene(forwardBottom.context, scene, "#00ff00", 0.6, undefined, "walk-forward");
    expect(forwardBottom.fonts.at(-1)).toMatch(/^72\.00px /u);

    const reverseBottom = createContextRecorder();
    drawAtmosphereScene(reverseBottom.context, scene, "#00ff00", 0.6, undefined, "walk-reverse");
    expect(reverseBottom.fonts.at(-1)).toMatch(/^1\.00px /u);
  });

  it("routes Warp from the exact center to a bounded radial far plane", () => {
    for (const kind of ["snow", "rain", "matrix"] as const) {
      const particle = createParticle();
      const scene = createScene(kind, particle);
      const margin = kind === "matrix" ? particle.size * 8 : particle.size * 2;
      const center = project(scene, particle, 80, -margin, "tunnel");
      const far = project(scene, particle, 80, scene.height + margin, "tunnel");

      expect(center).toEqual({ x: scene.width / 2, y: scene.height / 2, scale: 0.4 });
      expect(Number.isFinite(far.x)).toBe(true);
      expect(Number.isFinite(far.y)).toBe(true);
      expect(far.scale).toBeCloseTo(1.35, 10);
      expect(Math.hypot(far.x - scene.width / 2, far.y - scene.height / 2)).toBeCloseTo(
        Math.max(scene.width, scene.height) * 0.74,
        10,
      );
    }
  });

  it("projects snow, rain, and Matrix draw calls without mutating particle state", () => {
    for (const kind of ["snow", "rain", "matrix"] as const) {
      const particle = createParticle();
      const scene = createScene(kind, particle);
      const before = structuredClone(particle);
      const flat = createContextRecorder();
      const warp = createContextRecorder();

      drawAtmosphereScene(flat.context, scene, "#00ff00", 0.6, undefined, "flat");
      drawAtmosphereScene(warp.context, scene, "#00ff00", 0.6, undefined, "tunnel");

      if (kind === "snow") {
        expect(warp.arcs[0]).not.toEqual(flat.arcs[0]);
      } else if (kind === "rain") {
        expect(warp.moves[0]).not.toEqual(flat.moves[0]);
        expect(warp.lines[0]).not.toEqual(flat.lines[0]);
      } else {
        expect(warp.texts[0]?.[0]).toBe(flat.texts[0]?.[0]);
        expect(warp.texts[0]?.slice(1)).not.toEqual(flat.texts[0]?.slice(1));
      }
      expect(particle).toEqual(before);
    }
  });
});

describe("reduced-motion atmosphere policy", () => {
  const visibleState = {
    enabled: true,
    reducedMotion: true,
    documentVisible: true,
    windowFocused: true,
    continueBackgroundAnimations: false,
  };

  it("shows one dimmed static frame but never schedules continuous animation", () => {
    expect(shouldShowAtmosphere(visibleState)).toBe(true);
    expect(shouldAnimateAtmosphere(visibleState)).toBe(false);
    expect(resolveAtmosphereRenderOpacity(0.4, true)).toBeCloseTo(0.22, 10);
    expect(resolveAtmosphereRenderOpacity(0.4, false)).toBe(0.4);
  });
});
