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

function opaquePixelBounds(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
): { width: number; height: number } | null {
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width;
  let right = -1;
  let top = canvas.height;
  let bottom = -1;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (pixels[(y * canvas.width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left || bottom < top
    ? null
    : { width: right - left + 1, height: bottom - top + 1 };
}

describe("Matrix directional viewport coverage", () => {
  it.each(["walk-forward", "walk-reverse"] as const)(
    "preserves a readable long-label aspect ratio in %s",
    (motionMode) => {
      const canvas = document.createElement("canvas");
      canvas.width = 600;
      canvas.height = 240;
      const context = canvas.getContext("2d");
      expect(context).not.toBeNull();
      if (!context) return;
      const particle = matrixParticle(300, 120);
      particle.glyphs = " ";
      particle.matrixWorkToken = "very-long-file-name.ts";

      drawAtmosphereScene(
        context,
        { kind: "matrix", width: 600, height: 240, particles: [particle] },
        "#00ff00",
        1,
        undefined,
        motionMode,
        72,
        72,
      );

      const bounds = opaquePixelBounds(context, canvas);
      expect(bounds).not.toBeNull();
      expect(bounds!.width / bounds!.height).toBeGreaterThan(7);
    },
  );

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
