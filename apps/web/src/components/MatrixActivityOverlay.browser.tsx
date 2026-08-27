import { describe, expect, it } from "vitest";

import {
  MAX_MATRIX_ACTIVITY_LINKS,
  createMatrixActivityAnimationState,
  drawMatrixActivityAnimation,
  updateMatrixActivityAnimationInPlace,
  type MatrixActivityEvent,
} from "../matrixActivityOverlay";
import type { AtmosphereParticle, AtmosphereScene, MatrixColorFrame } from "../windowAtmosphere";

const MATRIX_FRAME: MatrixColorFrame = {
  color: "#4ade80",
  perStream: false,
  baseHue: 135,
  saturation: 70,
  lightness: 58,
};

function matrixParticle(x: number, y: number): AtmosphereParticle {
  return {
    x,
    y,
    velocityX: 0,
    velocityY: 80,
    size: 14,
    phase: 0,
    glyphOffset: 0,
    glyphs: "A",
    matrixLanguage: "english",
    matrixToken: null,
    matrixWorkToken: null,
    matrixLifecycleStartY: 0,
    matrixLifecycleProgress: 0.5,
    matrixLifecycleOpacity: 1,
    matrixLifecycleGeneration: 0,
  };
}

function opaquePixelBounds(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): { count: number; width: number; height: number } | null {
  const pixels = context.getImageData(0, 0, width, height).data;
  let count = 0;
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      count += 1;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return count === 0
    ? null
    : {
        count,
        width: right - left + 1,
        height: bottom - top + 1,
      };
}

describe("Matrix concurrent agent activity Canvas", () => {
  it("renders the complete bounded connector field as visible Chromium pixels", () => {
    const width = 800;
    const height = 600;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    expect(context).not.toBeNull();
    if (!context) return;

    const particles = Array.from({ length: MAX_MATRIX_ACTIVITY_LINKS * 2 }, (_, index) => {
      const endpointOffset = index % MAX_MATRIX_ACTIVITY_LINKS;
      const x = 45 + (endpointOffset * (width - 90)) / (MAX_MATRIX_ACTIVITY_LINKS - 1);
      const y = index < MAX_MATRIX_ACTIVITY_LINKS ? 70 : height - 70;
      return matrixParticle(index < MAX_MATRIX_ACTIVITY_LINKS ? x : width - x, y);
    });
    const scene: AtmosphereScene = { kind: "matrix", width, height, particles };
    const now = Date.parse("2026-08-24T09:00:00.000Z");
    const events: MatrixActivityEvent[] = Array.from(
      { length: MAX_MATRIX_ACTIVITY_LINKS },
      (_, index) => ({
        anchorSeed: index,
        category: "agent",
        observedAtMs: now,
        relationHashes: [index + 1],
        verifiedAgentDispatch: {
          operationAnchorSeed: index + MAX_MATRIX_ACTIVITY_LINKS,
          relationHash: index + 10_000,
        },
      }),
    );
    const state = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(state, events, now, particles.length, false);
    expect(state.linkCount).toBe(MAX_MATRIX_ACTIVITY_LINKS);

    drawMatrixActivityAnimation(context, scene, state, 0.9, "random", MATRIX_FRAME);
    const bounds = opaquePixelBounds(context, width, height);
    expect(bounds).not.toBeNull();
    expect(bounds!.count).toBeGreaterThan(2_000);
    expect(bounds!.width).toBeGreaterThan(width * 0.85);
    expect(bounds!.height).toBeGreaterThan(height * 0.7);
  });

  it("renders a neutral verified work lifecycle connector", () => {
    const width = 320;
    const height = 220;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    expect(context).not.toBeNull();
    if (!context) return;

    const particles = [matrixParticle(50, 45), matrixParticle(270, 175)];
    const scene: AtmosphereScene = { kind: "matrix", width, height, particles };
    const now = Date.parse("2026-08-24T09:00:00.300Z");
    const events: MatrixActivityEvent[] = [
      {
        anchorSeed: 0,
        category: "work",
        observedAtMs: now - 250,
        relationHashes: [9_001],
      },
      {
        anchorSeed: 1,
        category: "work",
        observedAtMs: now - 1,
        relationHashes: [9_001],
      },
    ];
    const state = createMatrixActivityAnimationState();
    updateMatrixActivityAnimationInPlace(state, events, now, particles.length, false);
    expect(state.linkCount).toBe(1);

    drawMatrixActivityAnimation(context, scene, state, 0.9, "random", MATRIX_FRAME);
    const bounds = opaquePixelBounds(context, width, height);
    expect(bounds).not.toBeNull();
    expect(bounds!.count).toBeGreaterThan(250);
    expect(bounds!.width).toBeGreaterThan(width * 0.5);
    expect(bounds!.height).toBeGreaterThan(height * 0.35);
  });
});
