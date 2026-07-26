import { describe, expect, it } from "vitest";

import {
  clampAmbientImageGeometryForPane,
  resolveAmbientImageKeyboardResize,
  resolveAmbientImageKeyboardMove,
  resolveAmbientImagePointerMove,
  resolveAmbientImagePointerResize,
} from "./ambientImageGeometryController";

const pane = { width: 1_000, height: 800 };
const limits = {
  minimumWidthPixels: 120,
  maximumWidthFraction: 0.9,
};

describe("ambient image move geometry", () => {
  it("normalizes pointer movement and preserves size", () => {
    const moved = resolveAmbientImagePointerMove({
      startGeometry: { x: 0.1, y: 0.2, width: 0.3 },
      startPointer: { clientX: 200, clientY: 300 },
      currentPointer: { clientX: 350, clientY: 380 },
      pane,
      mediaAspectRatio: 2,
      limits,
    });
    expect(moved?.x).toBeCloseTo(0.25);
    expect(moved?.y).toBeCloseTo(0.3);
    expect(moved?.width).toBe(0.3);
  });

  it("keeps pointer movement reachable at every pane edge", () => {
    expect(
      resolveAmbientImagePointerMove({
        startGeometry: { x: 0.1, y: 0.2, width: 0.4 },
        startPointer: { clientX: 200, clientY: 300 },
        currentPointer: { clientX: 2_000, clientY: 2_000 },
        pane,
        mediaAspectRatio: 1,
        limits,
      }),
    ).toEqual({
      x: 0.6,
      y: 0.5,
      width: 0.4,
    });
  });

  it("moves by keyboard while rejecting unrelated and invalid input", () => {
    const moved = resolveAmbientImageKeyboardMove({
      geometry: { x: 0.1, y: 0.2, width: 0.3 },
      key: "ArrowRight",
      step: 0.02,
      pane,
      mediaAspectRatio: 2,
      limits,
    });
    expect(moved?.x).toBeCloseTo(0.12);
    expect(moved).toMatchObject({ y: 0.2, width: 0.3 });
    expect(
      resolveAmbientImageKeyboardMove({
        geometry: { x: 0.1, y: 0.2, width: 0.3 },
        key: "Enter",
        step: 0.02,
        pane,
        mediaAspectRatio: 2,
        limits,
      }),
    ).toBeNull();
  });

  it("fails closed for unusable pane or media measurements", () => {
    expect(
      clampAmbientImageGeometryForPane({
        geometry: { x: 0.1, y: 0.2, width: 0.3 },
        pane: { width: 0, height: 800 },
        mediaAspectRatio: 2,
        limits,
      }),
    ).toBeNull();
    expect(
      clampAmbientImageGeometryForPane({
        geometry: { x: 0.1, y: 0.2, width: 0.3 },
        pane,
        mediaAspectRatio: Number.NaN,
        limits,
      }),
    ).toBeNull();
  });
});

describe("ambient image resize geometry", () => {
  it("normalizes horizontal pointer movement while preserving the top-left anchor", () => {
    const resized = resolveAmbientImagePointerResize({
      startGeometry: { x: 0.1, y: 0.2, width: 0.3 },
      startPointer: { clientX: 400, clientY: 400 },
      currentPointer: { clientX: 550, clientY: 700 },
      pane,
      mediaAspectRatio: 2,
      limits,
    });
    expect(resized).toMatchObject({ x: 0.1, y: 0.2 });
    expect(resized?.width).toBeCloseTo(0.45);
  });

  it("enforces the pixel minimum, fractional maximum, and pane height", () => {
    expect(
      resolveAmbientImagePointerResize({
        startGeometry: { x: 0.1, y: 0.1, width: 0.3 },
        startPointer: { clientX: 400, clientY: 400 },
        currentPointer: { clientX: -1_000, clientY: 400 },
        pane,
        mediaAspectRatio: 2,
        limits,
      }),
    ).toEqual({
      x: 0.1,
      y: 0.1,
      width: 0.12,
    });
    expect(
      resolveAmbientImagePointerResize({
        startGeometry: { x: 0.1, y: 0.1, width: 0.3 },
        startPointer: { clientX: 400, clientY: 400 },
        currentPointer: { clientX: 2_000, clientY: 400 },
        pane,
        mediaAspectRatio: 0.5,
        limits,
      }),
    ).toEqual({
      x: 0.1,
      y: 0,
      width: 0.4,
    });
  });

  it("resizes in both keyboard directions without moving the anchor", () => {
    expect(
      resolveAmbientImageKeyboardResize({
        geometry: { x: 0.1, y: 0.2, width: 0.3 },
        key: "ArrowDown",
        step: 0.025,
        pane,
        mediaAspectRatio: 2,
        limits,
      }),
    ).toEqual({
      x: 0.1,
      y: 0.2,
      width: 0.325,
    });
    expect(
      resolveAmbientImageKeyboardResize({
        geometry: { x: 0.1, y: 0.2, width: 0.3 },
        key: "Enter",
        step: 0.025,
        pane,
        mediaAspectRatio: 2,
        limits,
      }),
    ).toBeNull();
  });
});
