import {
  DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  type FallingEffectMatrixMotionMode,
} from "@cafecode/contracts/settings";
import { describe, expect, it, vi } from "vitest";

import {
  createAtmosphereScene,
  createSeededRandom,
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
  walkStartFontSize = DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  walkEndFontSize = DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
): AtmosphereProjectedPoint {
  const output = { x: 0, y: 0, scale: 0, depthScale: 0 };
  resolveAtmosphereProjectedPointInPlace(
    output,
    scene,
    particle,
    x,
    y,
    mode,
    walkStartFontSize,
    walkEndFontSize,
  );
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
        depthScale: 1,
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

  it("keeps the outer Matrix columns on every viewport edge in directional modes", () => {
    for (const [width, height] of [
      [320, 800],
      [1_440, 720],
    ] as const) {
      const scene = createAtmosphereScene(
        "matrix",
        width,
        height,
        createSeededRandom(width ^ height),
        1,
        0,
      );
      const leftColumn = scene.particles[0];
      const rightColumn = scene.particles.at(-1);
      expect(leftColumn).toBeDefined();
      expect(rightColumn).toBeDefined();
      if (!leftColumn || !rightColumn) continue;

      for (const mode of ["forward", "reverse", "walk-forward", "walk-reverse"] as const) {
        for (const y of [0, height]) {
          const projectedColumns = scene.particles.map((particle) =>
            project(scene, particle, particle.x, y, mode, 12, 24),
          );
          const left = projectedColumns[0];
          const right = projectedColumns.at(-1);
          expect(left).toBeDefined();
          expect(right).toBeDefined();
          if (!left || !right) continue;

          expect(left.x, `${mode} ${width}x${height} left @ ${y}`).toBeCloseTo(0, 10);
          expect(right.x, `${mode} ${width}x${height} right @ ${y}`).toBeCloseTo(width, 10);
          expect(left.y).toBe(y);
          expect(right.y).toBe(y);

          const projectedGaps = projectedColumns.slice(1).map((column, index) => {
            const previous = projectedColumns[index];
            expect(previous).toBeDefined();
            if (!previous) return 0;
            expect(column.x, `${mode} ${width}x${height} order @ ${y}`).toBeGreaterThan(previous.x);
            return column.x - previous.x;
          });
          expect(
            Math.max(...projectedGaps),
            `${mode} ${width}x${height} density @ ${y}`,
          ).toBeLessThanOrEqual((width / (projectedColumns.length - 1)) * 1.5);
        }
      }
    }
  });

  it("does not add Matrix particles or glyph draw calls for directional perspective", () => {
    const scene = createAtmosphereScene("matrix", 1_280, 720, createSeededRandom(42), 1, 0);
    const particleCount = scene.particles.length;
    const flat = createContextRecorder();
    drawAtmosphereScene(flat.context, scene, "#00ff00", 1, undefined, "flat", 12, 24);

    for (const mode of ["forward", "reverse", "walk-forward", "walk-reverse"] as const) {
      const directional = createContextRecorder();
      drawAtmosphereScene(directional.context, scene, "#00ff00", 1, undefined, mode, 12, 24);
      expect(scene.particles).toHaveLength(particleCount);
      expect(directional.texts).toHaveLength(flat.texts.length);
    }
  });

  it("mirrors continuously interpolated 1px-to-72px Walk depth for every effect kind", () => {
    for (const kind of ["snow", "rain", "matrix"] as const) {
      const particle = createParticle();
      const scene = createScene(kind, particle);
      const topForward = project(scene, particle, 80, 0, "walk-forward");
      const bottomForward = project(scene, particle, 80, scene.height, "walk-forward");
      const topReverse = project(scene, particle, 80, 0, "walk-reverse");
      const bottomReverse = project(scene, particle, 80, scene.height, "walk-reverse");

      expect(topForward.scale * particle.size).toBeCloseTo(
        DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
        10,
      );
      expect(bottomForward.scale * particle.size).toBeCloseTo(
        DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
        10,
      );
      expect(topReverse.scale * particle.size).toBeCloseTo(
        DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
        10,
      );
      expect(bottomReverse.scale * particle.size).toBeCloseTo(
        DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
        10,
      );
      expect(topForward.depthScale).toBe(1);
      expect(bottomForward.depthScale).toBe(
        DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE /
          DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
      );
      expect(topReverse.depthScale).toBe(
        DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE /
          DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
      );
      expect(bottomReverse.depthScale).toBe(1);
      expect(topForward.y).toBe(0);
      expect(bottomForward.y).toBe(scene.height);
      expect(topReverse.y).toBe(0);
      expect(bottomReverse.y).toBe(scene.height);

      const intermediate = project(scene, particle, 80, scene.height * 0.432_187, "walk-forward");
      const intermediateSize = intermediate.scale * particle.size;
      expect(intermediateSize).toBeCloseTo(
        DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE +
          0.432_187 *
            (DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE -
              DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE),
        10,
      );
    }
  });

  it("uses configurable absolute Walk endpoints and particle-independent connector depth", () => {
    const startFontSize = 12;
    const endFontSize = 24;
    const smallParticle = createParticle({ size: 3 });
    const largeParticle = createParticle({ size: 90 });
    const scene = createScene("matrix", smallParticle);

    for (const particle of [smallParticle, largeParticle]) {
      const topForward = project(
        scene,
        particle,
        80,
        0,
        "walk-forward",
        startFontSize,
        endFontSize,
      );
      const bottomForward = project(
        scene,
        particle,
        80,
        scene.height,
        "walk-forward",
        startFontSize,
        endFontSize,
      );
      const topReverse = project(
        scene,
        particle,
        80,
        0,
        "walk-reverse",
        startFontSize,
        endFontSize,
      );
      const bottomReverse = project(
        scene,
        particle,
        80,
        scene.height,
        "walk-reverse",
        startFontSize,
        endFontSize,
      );

      expect(topForward.scale * particle.size).toBeCloseTo(12, 10);
      expect(bottomForward.scale * particle.size).toBeCloseTo(24, 10);
      expect(topReverse.scale * particle.size).toBeCloseTo(24, 10);
      expect(bottomReverse.scale * particle.size).toBeCloseTo(12, 10);
      expect(topForward.depthScale).toBe(1);
      expect(bottomForward.depthScale).toBeCloseTo(2, 10);
      expect(topReverse.depthScale).toBeCloseTo(2, 10);
      expect(bottomReverse.depthScale).toBe(1);
    }
  });

  it("preserves descending Walk endpoints instead of silently reordering them", () => {
    const particle = createParticle();
    const scene = createScene("matrix", particle);
    const topForward = project(scene, particle, 80, 0, "walk-forward", 24, 12);
    const bottomForward = project(scene, particle, 80, scene.height, "walk-forward", 24, 12);
    const topReverse = project(scene, particle, 80, 0, "walk-reverse", 24, 12);
    const bottomReverse = project(scene, particle, 80, scene.height, "walk-reverse", 24, 12);

    expect(topForward.scale * particle.size).toBeCloseTo(24, 10);
    expect(bottomForward.scale * particle.size).toBeCloseTo(12, 10);
    expect(topReverse.scale * particle.size).toBeCloseTo(12, 10);
    expect(bottomReverse.scale * particle.size).toBeCloseTo(24, 10);
    expect(topForward.depthScale).toBe(1);
    expect(bottomForward.depthScale).toBeCloseTo(0.5, 10);
    expect(topReverse.depthScale).toBeCloseTo(0.5, 10);
    expect(bottomReverse.depthScale).toBe(1);
  });

  it("keeps equal Walk endpoints at one connector-depth scale in both directions", () => {
    const particle = createParticle();
    const scene = createScene("matrix", particle);

    for (const mode of ["walk-forward", "walk-reverse"] as const) {
      for (const y of [0, scene.height * 0.432_187, scene.height]) {
        const projected = project(scene, particle, 80, y, mode, 17.25, 17.25);
        expect(projected.scale * particle.size).toBeCloseTo(17.25, 10);
        expect(projected.depthScale).toBe(1);
      }
    }
  });

  it("ignores configurable Walk endpoints in every non-Walk projection", () => {
    const particle = createParticle();
    const scene = createScene("matrix", particle);

    for (const mode of ["flat", "forward", "reverse", "tunnel"] as const) {
      expect(project(scene, particle, 80, 120, mode, 0.01, 144)).toEqual(
        project(scene, particle, 80, 120, mode),
      );
    }
  });

  it("caches Walk Matrix glyph strings on a bounded 1px grid without stepping depth", () => {
    const particle = createParticle({ y: 0 });
    const scene = createScene("matrix", particle);
    const forwardTop = createContextRecorder();
    drawAtmosphereScene(
      forwardTop.context,
      scene,
      "#00ff00",
      0.6,
      undefined,
      "walk-forward",
      12.34,
      24.56,
    );
    expect(forwardTop.fonts.at(-1)).toMatch(/^12px /u);

    particle.y = scene.height;
    const forwardBottom = createContextRecorder();
    drawAtmosphereScene(
      forwardBottom.context,
      scene,
      "#00ff00",
      0.6,
      undefined,
      "walk-forward",
      12.34,
      24.56,
    );
    expect(forwardBottom.fonts.at(-1)).toMatch(/^25px /u);

    const reverseBottom = createContextRecorder();
    drawAtmosphereScene(
      reverseBottom.context,
      scene,
      "#00ff00",
      0.6,
      undefined,
      "walk-reverse",
      12.34,
      24.56,
    );
    expect(reverseBottom.fonts.at(-1)).toMatch(/^12px /u);

    particle.y = 80;
    const firstProjection = project(scene, particle, 80, 80, "walk-forward", 12.34, 24.56);
    const firstBucket = createContextRecorder();
    drawAtmosphereScene(
      firstBucket.context,
      scene,
      "#00ff00",
      0.6,
      undefined,
      "walk-forward",
      12.34,
      24.56,
    );
    particle.y = 81;
    const secondProjection = project(scene, particle, 80, 81, "walk-forward", 12.34, 24.56);
    const secondBucket = createContextRecorder();
    drawAtmosphereScene(
      secondBucket.context,
      scene,
      "#00ff00",
      0.6,
      undefined,
      "walk-forward",
      12.34,
      24.56,
    );
    expect(secondProjection.scale).toBeGreaterThan(firstProjection.scale);
    expect(secondProjection.depthScale).toBeGreaterThan(firstProjection.depthScale);
    expect(firstBucket.fonts.at(-1)).toBe(secondBucket.fonts.at(-1));
  });

  it("applies the baseline only to non-Walk Matrix glyph fonts", () => {
    const matrixParticle = createParticle({ y: 120, size: 14 });
    const matrixScene = createScene("matrix", matrixParticle);
    const defaultMatrix = createContextRecorder();
    const doubledMatrix = createContextRecorder();
    drawAtmosphereScene(
      defaultMatrix.context,
      matrixScene,
      "#00ff00",
      1,
      undefined,
      "flat",
      1,
      72,
      DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
    );
    drawAtmosphereScene(
      doubledMatrix.context,
      matrixScene,
      "#00ff00",
      1,
      undefined,
      "flat",
      1,
      72,
      DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE * 2,
    );
    expect(defaultMatrix.fonts.at(-1)).toMatch(/^14px /u);
    expect(doubledMatrix.fonts.at(-1)).toMatch(/^28px /u);

    for (const kind of ["snow", "rain"] as const) {
      const particle = createParticle();
      const scene = createScene(kind, particle);
      const defaultGeometry = createContextRecorder();
      const maximumBaselineGeometry = createContextRecorder();
      drawAtmosphereScene(
        defaultGeometry.context,
        scene,
        "#00ff00",
        1,
        undefined,
        "forward",
        1,
        72,
        DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
      );
      drawAtmosphereScene(
        maximumBaselineGeometry.context,
        scene,
        "#00ff00",
        1,
        undefined,
        "forward",
        1,
        72,
        72,
      );
      expect(maximumBaselineGeometry.arcs).toEqual(defaultGeometry.arcs);
      expect(maximumBaselineGeometry.moves).toEqual(defaultGeometry.moves);
      expect(maximumBaselineGeometry.lines).toEqual(defaultGeometry.lines);
      expect(maximumBaselineGeometry.context.lineWidth).toBe(defaultGeometry.context.lineWidth);
    }

    const defaultWalk = createContextRecorder();
    const changedBaselineWalk = createContextRecorder();
    drawAtmosphereScene(
      defaultWalk.context,
      matrixScene,
      "#00ff00",
      1,
      undefined,
      "walk-forward",
      12,
      24,
      DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
    );
    drawAtmosphereScene(
      changedBaselineWalk.context,
      matrixScene,
      "#00ff00",
      1,
      undefined,
      "walk-forward",
      12,
      24,
      72,
    );
    expect(changedBaselineWalk.fonts).toEqual(defaultWalk.fonts);
  });

  it("routes Warp from the exact center to a bounded radial far plane", () => {
    for (const kind of ["snow", "rain", "matrix"] as const) {
      const particle = createParticle();
      const scene = createScene(kind, particle);
      const margin = kind === "matrix" ? particle.size * 8 : particle.size * 2;
      const center = project(scene, particle, 80, -margin, "tunnel");
      const far = project(scene, particle, 80, scene.height + margin, "tunnel");

      expect(center).toEqual({
        x: scene.width / 2,
        y: scene.height / 2,
        scale: 0.4,
        depthScale: 0.4,
      });
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
