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
  resolveMatrixWalkTextLayout,
  advanceAtmosphereSceneInPlace,
  shouldAnimateAtmosphere,
  shouldShowAtmosphere,
  type AtmosphereParticle,
  type AtmosphereProjectedPoint,
  type AtmosphereScene,
} from "./windowAtmosphere";

function createParticle(overrides: Partial<AtmosphereParticle> = {}): AtmosphereParticle {
  const particle: AtmosphereParticle = {
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
    matrixLifecycleStartY: 0,
    matrixLifecycleProgress: 0.5,
    matrixLifecycleOpacity: 1,
    matrixLifecycleGeneration: 0,
  };
  return Object.assign(particle, overrides);
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
  if (scene.kind === "matrix" && (mode === "walk-forward" || mode === "walk-reverse")) {
    particle.matrixLifecycleProgress = Math.min(1, Math.max(0, y / Math.max(1, scene.height)));
  }
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
  it("fits long Walk labels uniformly instead of compressing their width", () => {
    const longLabel = resolveMatrixWalkTextLayout("very-long-file-name.ts", 144, 400);
    const singleGlyph = resolveMatrixWalkTextLayout("8", 144, 400);

    expect(longLabel.fontSizePx).toBeLessThan(144);
    expect(longLabel.widthPx).toBeLessThanOrEqual(360);
    expect(longLabel.widthPx / longLabel.fontSizePx).toBeGreaterThan(10);
    expect(singleGlyph.fontSizePx).toBe(144);
    expect(singleGlyph.widthPx / singleGlyph.fontSizePx).toBeCloseTo(0.72);
  });

  it("floors a fitted Unicode label to the rendered font grid", () => {
    const layout = resolveMatrixWalkTextLayout("構".repeat(32), 144, 520);

    expect(layout.fontSizePx).toBe(14);
    expect(layout.widthPx).toBe(448);
    expect(layout.widthPx).toBeLessThanOrEqual(520 * 0.9);
  });

  it.each(["walk-forward", "walk-reverse"] as const)(
    "draws an unconstrained proportional work label in %s",
    (motionMode) => {
      const label = "very-long-file-name.ts";
      const particle = createParticle({
        x: 200,
        y: 120,
        matrixLifecycleProgress: 0.5,
        matrixWorkToken: label,
      });
      const recorder = createContextRecorder();

      drawAtmosphereScene(
        recorder.context,
        createScene("matrix", particle),
        "#00ff00",
        1,
        undefined,
        motionMode,
        72,
        72,
      );

      const labelIndex = recorder.texts.findIndex(([text]) => text === label);
      expect(labelIndex).toBeGreaterThanOrEqual(0);
      expect(recorder.texts[labelIndex]?.[3]).toBeUndefined();
      expect(Number.parseFloat(recorder.fonts[labelIndex]!)).toBeLessThan(72);
    },
  );

  it.each(["walk-forward", "walk-reverse"] as const)(
    "keeps a proportional edge-column label inside the viewport in %s",
    (motionMode) => {
      const label = "very-long-file-name.ts";
      const particle = createParticle({
        x: 0,
        y: 120,
        matrixLifecycleProgress: 0.5,
        matrixWorkToken: label,
      });
      const recorder = createContextRecorder();

      drawAtmosphereScene(
        recorder.context,
        createScene("matrix", particle),
        "#00ff00",
        1,
        undefined,
        motionMode,
        72,
        72,
      );

      const labelIndex = recorder.texts.findIndex(([text]) => text === label);
      expect(labelIndex).toBeGreaterThanOrEqual(0);
      const [, x] = recorder.texts[labelIndex]!;
      const layout = resolveMatrixWalkTextLayout(label, 72, 400);
      expect(x - layout.widthPx / 2).toBeGreaterThanOrEqual(0);
      expect(x + layout.widthPx / 2).toBeLessThanOrEqual(400);
    },
  );

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

  it("preserves every non-Walk stream and bounds only contending Walk glyphs", () => {
    const scene = createAtmosphereScene("matrix", 1_280, 720, createSeededRandom(42), 1, 0);
    const particleCount = scene.particles.length;
    const flat = createContextRecorder();
    drawAtmosphereScene(flat.context, scene, "#00ff00", 1, undefined, "flat", 12, 24);

    for (const mode of ["forward", "reverse"] as const) {
      const directional = createContextRecorder();
      drawAtmosphereScene(directional.context, scene, "#00ff00", 1, undefined, mode, 12, 24);
      expect(scene.particles).toHaveLength(particleCount);
      expect(directional.texts).toHaveLength(flat.texts.length);
    }

    for (const mode of ["walk-forward", "walk-reverse"] as const) {
      const walkScene = createAtmosphereScene(
        "matrix",
        1_280,
        720,
        createSeededRandom(42),
        1,
        0,
        false,
        { english: [], japanese: [] },
        mode,
      );
      const walk = createContextRecorder();
      drawAtmosphereScene(walk.context, walkScene, "#00ff00", 1, undefined, mode, 12, 144);
      expect(walkScene.particles).toHaveLength(particleCount);
      expect(walk.texts.length).toBeGreaterThan(0);
      expect(walk.texts.length).toBeLessThanOrEqual(flat.texts.length);
    }
  });

  it("uses the 640-stream pool in both Walk directions without full-height stripe rejection", () => {
    const baseline = createAtmosphereScene(
      "matrix",
      1_920,
      1_080,
      createSeededRandom(44),
      2.5,
      0,
      false,
      { english: [], japanese: [] },
      "walk-forward",
    );
    const highDensity = createAtmosphereScene(
      "matrix",
      1_920,
      1_080,
      createSeededRandom(44),
      10,
      0,
      false,
      { english: [], japanese: [] },
      "walk-forward",
    );
    const baselineFrame = createContextRecorder();
    const highDensityFrame = createContextRecorder();
    drawAtmosphereScene(
      baselineFrame.context,
      baseline,
      "#00ff00",
      1,
      undefined,
      "walk-forward",
      1,
      72,
    );
    drawAtmosphereScene(
      highDensityFrame.context,
      highDensity,
      "#00ff00",
      1,
      undefined,
      "walk-forward",
      1,
      72,
    );
    const baselineReverseFrame = createContextRecorder();
    const highDensityReverseFrame = createContextRecorder();
    drawAtmosphereScene(
      baselineReverseFrame.context,
      baseline,
      "#00ff00",
      1,
      undefined,
      "walk-reverse",
      1,
      72,
    );
    drawAtmosphereScene(
      highDensityReverseFrame.context,
      highDensity,
      "#00ff00",
      1,
      undefined,
      "walk-reverse",
      1,
      72,
    );
    expect(baseline.particles).toHaveLength(200);
    expect(highDensity.particles).toHaveLength(640);
    expect(highDensityFrame.texts.length).toBeGreaterThanOrEqual(
      Math.floor(baselineFrame.texts.length * 1.5),
    );
    expect(highDensityReverseFrame.texts.length).toBeGreaterThanOrEqual(
      Math.floor(baselineReverseFrame.texts.length * 1.5),
    );
    expect(highDensityFrame.texts.length).toBeGreaterThan(1_000);
    expect(highDensityReverseFrame.texts.length).toBeGreaterThan(1_000);
    const directionDifference = Math.abs(
      highDensityFrame.texts.length - highDensityReverseFrame.texts.length,
    );
    expect(directionDifference).toBeLessThanOrEqual(
      Math.ceil(
        Math.max(highDensityFrame.texts.length, highDensityReverseFrame.texts.length) * 0.1,
      ),
    );
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

  it("drives Matrix Walk font expansion from the bounded lifecycle instead of viewport Y", () => {
    const particle = createParticle({
      y: 190,
      matrixLifecycleStartY: 130,
      matrixLifecycleProgress: 0.25,
    });
    const scene = createScene("matrix", particle);
    const forward = { x: 0, y: 0, scale: 0, depthScale: 0 };
    const reverse = { x: 0, y: 0, scale: 0, depthScale: 0 };

    resolveAtmosphereProjectedPointInPlace(
      forward,
      scene,
      particle,
      particle.x,
      particle.y,
      "walk-forward",
      10,
      50,
    );
    resolveAtmosphereProjectedPointInPlace(
      reverse,
      scene,
      particle,
      particle.x,
      particle.y,
      "walk-reverse",
      10,
      50,
    );

    expect(forward.scale * particle.size).toBeCloseTo(20, 10);
    expect(reverse.scale * particle.size).toBeCloseTo(40, 10);

    particle.y = 12;
    const movedOnScreen = { x: 0, y: 0, scale: 0, depthScale: 0 };
    resolveAtmosphereProjectedPointInPlace(
      movedOnScreen,
      scene,
      particle,
      particle.x,
      particle.y,
      "walk-forward",
      10,
      50,
    );
    expect(movedOnScreen.scale).toBe(forward.scale);
  });

  it("spawns Walk streams across the full viewport, fades them, and respawns in place", () => {
    const scene = createAtmosphereScene(
      "matrix",
      400,
      240,
      createSeededRandom(91),
      1,
      0,
      false,
      { english: [], japanese: [] },
      "walk-forward",
      30,
      10,
    );
    const lifecycleDistance = 72;

    expect(
      scene.particles.every(
        (particle) =>
          particle.matrixLifecycleStartY >= 0 &&
          particle.matrixLifecycleStartY < scene.height &&
          particle.y >= 0 &&
          particle.y < scene.height,
      ),
    ).toBe(true);
    expect(
      Math.min(...scene.particles.map((particle) => particle.matrixLifecycleStartY)),
    ).toBeLessThan(scene.height * 0.1);
    expect(
      Math.max(...scene.particles.map((particle) => particle.matrixLifecycleStartY)),
    ).toBeGreaterThan(scene.height * 0.9);

    const left = scene.particles.reduce((candidate, particle) =>
      particle.x < candidate.x ? particle : candidate,
    );
    const right = scene.particles.reduce((candidate, particle) =>
      particle.x > candidate.x ? particle : candidate,
    );
    const center = scene.particles.reduce((candidate, particle) =>
      Math.abs(particle.x - scene.width / 2) < Math.abs(candidate.x - scene.width / 2)
        ? particle
        : candidate,
    );
    const before = new Map(scene.particles.map((particle) => [particle, particle.x]));
    advanceAtmosphereSceneInPlace(scene, 0.05, 1, "walk-forward", 30, 10);
    expect(left.x).toBeLessThan(before.get(left)!);
    expect(right.x).toBeGreaterThan(before.get(right)!);
    expect(Math.abs(center.x - before.get(center)!)).toBeLessThan(
      Math.abs(right.x - before.get(right)!),
    );

    const ending = scene.particles[3]!;
    ending.velocityY = 100;
    ending.matrixLifecycleStartY = 50;
    ending.matrixLifecycleProgress = 0.9;
    ending.matrixLifecycleOpacity = 1;
    ending.y = 50 + lifecycleDistance * 0.9;
    const generation = ending.matrixLifecycleGeneration;
    advanceAtmosphereSceneInPlace(scene, 0.05, 1, "walk-forward", 30, 10);
    expect(ending.matrixLifecycleOpacity).toBeLessThan(0.2);
    expect(ending.matrixLifecycleGeneration).toBe(generation);

    advanceAtmosphereSceneInPlace(scene, 0.05, 1, "walk-forward", 30, 10);
    expect(ending.matrixLifecycleGeneration).toBe(generation + 1);
    expect(ending.matrixLifecycleProgress).toBe(0);
    expect(ending.matrixLifecycleOpacity).toBe(1);
    expect(ending.y).toBe(ending.matrixLifecycleStartY);
    expect(ending.y).toBeGreaterThanOrEqual(0);
    expect(ending.y).toBeLessThan(scene.height);
  });

  it("keeps large Walk glyph rectangles separated in two dimensions", () => {
    const scene = createAtmosphereScene(
      "matrix",
      1_280,
      720,
      createSeededRandom(123),
      2.5,
      0,
      false,
      { english: [], japanese: [] },
      "walk-forward",
      30,
      10,
    );
    for (const particle of scene.particles) {
      particle.matrixLifecycleProgress = 1;
      particle.matrixLifecycleOpacity = 1;
    }
    const recorder = createContextRecorder();
    drawAtmosphereScene(recorder.context, scene, "#00ff00", 1, undefined, "walk-forward", 1, 144);

    expect(recorder.texts.length).toBeGreaterThan(0);
    for (let leftIndex = 0; leftIndex < recorder.texts.length; leftIndex += 1) {
      const [leftGlyph, leftX, leftY] = recorder.texts[leftIndex]!;
      const leftFontSize = Number.parseFloat(recorder.fonts[leftIndex]!);
      const leftWidth = leftFontSize * (leftGlyph.length > 1 ? 0.9 : 0.72);
      for (let rightIndex = leftIndex + 1; rightIndex < recorder.texts.length; rightIndex += 1) {
        const [rightGlyph, rightX, rightY] = recorder.texts[rightIndex]!;
        const rightFontSize = Number.parseFloat(recorder.fonts[rightIndex]!);
        const rightWidth = rightFontSize * (rightGlyph.length > 1 ? 0.9 : 0.72);
        const separatedHorizontally = Math.abs(leftX - rightX) >= (leftWidth + rightWidth) * 0.5;
        const separatedVertically =
          Math.abs(leftY - rightY) >= (leftFontSize + rightFontSize) * 0.5;
        expect(separatedHorizontally || separatedVertically).toBe(true);
      }
    }
  });

  it("disables center wind at intensity zero", () => {
    const scene = createAtmosphereScene(
      "matrix",
      400,
      240,
      createSeededRandom(92),
      1,
      0,
      false,
      { english: [], japanese: [] },
      "walk-reverse",
      30,
      0,
    );
    const xPositions = scene.particles.map((particle) => particle.x);
    advanceAtmosphereSceneInPlace(scene, 0.05, 1, "walk-reverse", 30, 0);
    expect(scene.particles.map((particle) => particle.x)).toEqual(xPositions);
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
    const particle = createParticle({ y: 0, matrixLifecycleProgress: 0 });
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
    particle.matrixLifecycleProgress = 1;
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
    particle.matrixLifecycleProgress = 80 / scene.height;
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
    particle.matrixLifecycleProgress = 81 / scene.height;
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
