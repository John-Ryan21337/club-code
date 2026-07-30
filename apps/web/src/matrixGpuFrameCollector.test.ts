import { describe, expect, it } from "vitest";

import { MatrixGpuFrameCollector, parseMatrixGpuColor } from "./matrixGpuFrameCollector";
import { createAtmosphereScene, createSeededRandom, MATRIX_ROMAN_GLYPHS } from "./windowAtmosphere";

describe("MatrixGpuFrameCollector", () => {
  it("converts the existing Matrix geometry traversal into bounded GPU glyph instances", () => {
    const scene = createAtmosphereScene(
      "matrix",
      1_280,
      720,
      createSeededRandom(42),
      10,
      0,
      false,
      { english: [], japanese: [] },
      "walk-forward",
      30,
      4,
    );
    const collector = new MatrixGpuFrameCollector(5_120);
    const frame = collector.collect({
      scene,
      color: "#00ff00",
      opacity: 0.7,
      matrixColorFrame: undefined,
      motionMode: "walk-forward",
      walkStartFontSize: 12,
      walkEndFontSize: 72,
      matrixBaseFontSize: 14,
      devicePixelRatio: 2,
    });

    expect(frame.width).toBe(1_280);
    expect(frame.height).toBe(720);
    expect(frame.devicePixelRatio).toBe(2);
    expect(frame.glyphs.length).toBeGreaterThan(160);
    expect(frame.glyphs.length).toBeLessThanOrEqual(5_120);
    expect(frame.glyphs.every((glyph) => String(glyph.glyph).length > 0)).toBe(true);
    expect(frame.glyphs.every((glyph) => glyph.opacity > 0 && glyph.opacity <= 0.7)).toBe(true);
    expect(frame.glyphs.some((glyph) => glyph.maxWidthPx !== undefined)).toBe(true);
  });

  it("reuses frame storage and supports Flat Matrix glyphs", () => {
    const scene = createAtmosphereScene(
      "matrix",
      800,
      600,
      createSeededRandom(7),
      2.5,
      0,
      false,
      { english: [], japanese: [] },
      "flat",
      30,
      0,
    );
    expect(scene.particles[0]?.glyphs).toBe(MATRIX_ROMAN_GLYPHS);
    const collector = new MatrixGpuFrameCollector();
    const first = collector.collect({
      scene,
      color: "#12abef",
      opacity: 1,
      matrixColorFrame: undefined,
      motionMode: "flat",
      walkStartFontSize: 12,
      walkEndFontSize: 72,
      matrixBaseFontSize: 18,
      devicePixelRatio: 1,
    });
    const firstGlyph = first.glyphs[0];
    const second = collector.collect({
      scene,
      color: "#12abef",
      opacity: 1,
      matrixColorFrame: undefined,
      motionMode: "flat",
      walkStartFontSize: 12,
      walkEndFontSize: 72,
      matrixBaseFontSize: 18,
      devicePixelRatio: 1,
    });

    expect(second.glyphs[0]).toBe(firstGlyph);
    expect(second.glyphs[0]?.color).toEqual({
      red: 0x12 / 255,
      green: 0xab / 255,
      blue: 0xef / 255,
      alpha: 1,
    });
  });

  it("bounds animated color parsing cache entries to the current frame", () => {
    const scene = createAtmosphereScene(
      "matrix",
      800,
      600,
      createSeededRandom(9),
      2.5,
      0,
      false,
      { english: [], japanese: [] },
      "flat",
      30,
      0,
    );
    const collector = new MatrixGpuFrameCollector();
    const collect = (baseHue: number) =>
      collector.collect({
        scene,
        color: "#00ff00",
        opacity: 1,
        matrixColorFrame: {
          color: `hsl(${String(baseHue)} 80% 50%)`,
          perStream: true,
          baseHue,
          saturation: 80,
          lightness: 50,
        },
        motionMode: "flat",
        walkStartFontSize: 12,
        walkEndFontSize: 72,
        matrixBaseFontSize: 18,
        devicePixelRatio: 1,
      });

    const first = collect(10);
    const firstColor = first.glyphs[0]?.color;
    const second = collect(10);
    expect(second.glyphs[0]?.color).not.toBe(firstColor);
  });
});

describe("parseMatrixGpuColor", () => {
  it("parses bounded hex and HSL colors used by fixed and reactive Matrix modes", () => {
    expect(parseMatrixGpuColor("#0f08")).toEqual({
      red: 0,
      green: 1,
      blue: 0,
      alpha: 0x88 / 255,
    });
    const hsl = parseMatrixGpuColor("hsl(120.0 100.0% 50.0%)");
    expect(hsl.red).toBeCloseTo(0);
    expect(hsl.green).toBeCloseTo(1);
    expect(hsl.blue).toBeCloseTo(0);
    expect(hsl.alpha).toBe(1);
  });
});
