import { describe, expect, it } from "vitest";

import {
  drawAtmosphereScene,
  type AtmosphereParticle,
  type AtmosphereScene,
} from "../windowAtmosphere";

function matrixParticle(x: number, y: number): AtmosphereParticle {
  return {
    x,
    y,
    velocityX: 0,
    velocityY: 80,
    size: 24,
    phase: 0,
    glyphOffset: 0,
    glyphs: "8",
    matrixLanguage: "english",
    matrixToken: null,
    matrixWorkToken: null,
    matrixLifecycleStartY: 0,
    matrixLifecycleProgress: 0.5,
    matrixLifecycleOpacity: 1,
    matrixLifecycleGeneration: 0,
  };
}

function edgeCoverageScene(width: number, height: number): AtmosphereScene {
  const columnCount = 4;
  const outerColumnInset = width / (columnCount * 2);
  return {
    kind: "matrix",
    width,
    height,
    particles: [
      matrixParticle(outerColumnInset, 0),
      matrixParticle(width - outerColumnInset, 0),
      matrixParticle(outerColumnInset, height),
      matrixParticle(width - outerColumnInset, height),
    ],
  };
}

function cornerContainsGlyph(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right",
  requestedSpan: number,
): boolean {
  const span = Math.min(requestedSpan, canvas.width, canvas.height);
  const x = corner.endsWith("right") ? canvas.width - span : 0;
  const y = corner.startsWith("bottom") ? canvas.height - span : 0;
  const pixels = context.getImageData(x, y, span, span).data;
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] !== 0) return true;
  }
  return false;
}

describe("Matrix directional viewport coverage", () => {
  it("draws glyph pixels near all four corners across aspect ratios and DPRs", () => {
    for (const { width, height, dpr } of [
      { width: 360, height: 780, dpr: 1 },
      { width: 1_280, height: 720, dpr: 2 },
    ]) {
      for (const mode of ["forward", "reverse", "walk-forward", "walk-reverse"] as const) {
        const canvas = document.createElement("canvas");
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        const context = canvas.getContext("2d");
        expect(context).not.toBeNull();
        if (!context) continue;
        context.scale(dpr, dpr);

        drawAtmosphereScene(
          context,
          edgeCoverageScene(width, height),
          "#00ff00",
          1,
          undefined,
          mode,
          24,
          24,
        );

        for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
          expect(
            cornerContainsGlyph(context, canvas, corner, 32 * dpr),
            `${mode} ${width}x${height} @ ${dpr}x ${corner}`,
          ).toBe(true);
        }
      }
    }
  });
});
