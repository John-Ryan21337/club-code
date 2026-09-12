import { describe, expect, it } from "vitest";

import { MatrixGpuFrameCollector, parseMatrixGpuColor } from "./matrixGpuFrameCollector";
import {
  applyMatrixWorkVocabularyInPlace,
  applyMatrixEnrichmentInPlace,
  MATRIX_2CH_AA_TOKENS,
  createAtmosphereScene,
  createSeededRandom,
  MATRIX_ROMAN_GLYPHS,
} from "./windowAtmosphere";

describe("MatrixGpuFrameCollector", () => {
  it.each(["flat", "forward", "reverse", "tunnel", "walk-forward", "walk-reverse"] as const)(
    "keeps cat tokens intact at heads and gives work labels priority in %s",
    (motionMode) => {
      const scene = createAtmosphereScene(
        "matrix",
        1280,
        720,
        createSeededRandom(42),
        2,
        1,
        motionMode,
      );
      applyMatrixEnrichmentInPlace(scene, true, () => 0);
      const collector = new MatrixGpuFrameCollector();
      const collect = () =>
        collector.collect({
          scene,
          color: "#00ff00",
          opacity: 1,
          matrixColorFrame: undefined,
          motionMode,
          walkStartFontSize: 12,
          walkEndFontSize: 72,
          matrixBaseFontSize: 14,
          devicePixelRatio: 1,
        });
      const heads = collect().glyphs.filter((glyph) => String(glyph.glyph).length > 1);
      expect(heads.length).toBeGreaterThan(0);
      expect(heads.length).toBeLessThanOrEqual(scene.particles.length);
      expect(heads.every((glyph) => glyph.glyph === MATRIX_2CH_AA_TOKENS[0])).toBe(true);
      applyMatrixWorkVocabularyInPlace(scene, { english: [], japanese: ["作業"] }, () => 0);
      expect(collect().glyphs.some((glyph) => glyph.glyph === "作業")).toBe(true);
      expect(collect().glyphs.some((glyph) => glyph.glyph === MATRIX_2CH_AA_TOKENS[0])).toBe(false);
      applyMatrixWorkVocabularyInPlace(scene, { english: [], japanese: [] }, () => 0);
      applyMatrixEnrichmentInPlace(scene, false, () => 0);
      expect(collect().glyphs.every((glyph) => String(glyph.glyph).length === 1)).toBe(true);
    },
  );
  it.each(["flat", "walk-forward", "walk-reverse"] as const)(
    "keeps whole work labels at stream heads in %s",
    (motionMode) => {
      const scene = createAtmosphereScene(
        "matrix",
        1280,
        720,
        createSeededRandom(42),
        2,
        0,
        motionMode,
      );
      const before = structuredClone(scene.particles);
      applyMatrixWorkVocabularyInPlace(
        scene,
        { english: ["SafeFile.tsx"], japanese: ["作業"] },
        () => 0,
      );
      expect(scene.particles.map((particle) => ({ ...particle, matrixWorkToken: null }))).toEqual(
        before,
      );
      const collector = new MatrixGpuFrameCollector();
      const collect = () =>
        collector.collect({
          scene,
          color: "#00ff00",
          opacity: 1,
          matrixColorFrame: undefined,
          motionMode,
          walkStartFontSize: 12,
          walkEndFontSize: 72,
          matrixBaseFontSize: 14,
          devicePixelRatio: 1,
        });
      const frame = collect();
      const labels = frame.glyphs.filter((glyph) => glyph.glyph === "SafeFile.tsx");
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.length).toBeLessThanOrEqual(scene.particles.length);
      expect(frame.glyphs.filter((glyph) => String(glyph.glyph).length > 1)).toHaveLength(
        labels.length,
      );
      applyMatrixWorkVocabularyInPlace(scene, { english: [], japanese: [] }, () => 0);
      expect(collect().glyphs.every((glyph) => String(glyph.glyph).length === 1)).toBe(true);
    },
  );
  it("converts the existing Matrix geometry traversal into bounded GPU glyph instances", () => {
    const scene = createAtmosphereScene(
      "matrix",
      1_280,
      720,
      createSeededRandom(42),
      10,
      0,
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
    expect(frame.glyphs.every((glyph) => glyph.maxWidthPx === undefined)).toBe(true);
  });

  it("reuses frame storage and supports Flat Matrix glyphs", () => {
    const scene = createAtmosphereScene(
      "matrix",
      800,
      600,
      createSeededRandom(7),
      2.5,
      0,
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
