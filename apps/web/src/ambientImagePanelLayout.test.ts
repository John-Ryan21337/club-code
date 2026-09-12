import { describe, expect, it } from "vitest";

import {
  clampAmbientImageGeometryForPane,
  CUSTOM_MAXIMUM_WIDTH_FRACTION,
  CUSTOM_MINIMUM_WIDTH_PX,
  PANEL_MARGIN_PX,
  PRESET_MAXIMUM_WIDTH_FRACTION,
  PRESET_WIDTH_PX,
  resolveAmbientImagePresetGeometry,
} from "./ambientImagePanelLayout";

const PANE = { width: 1280, height: 800 };
const WIDE = 16 / 9;

describe("preset geometry", () => {
  it("places each corner inside the window margin", () => {
    const size = "medium" as const;
    const width = PRESET_WIDTH_PX[size] / PANE.width;
    const height = PRESET_WIDTH_PX[size] / WIDE / PANE.height;

    const topLeft = resolveAmbientImagePresetGeometry({
      pane: PANE,
      size,
      placement: "top-left",
      aspectRatio: WIDE,
    });
    expect(topLeft?.x).toBeCloseTo(PANEL_MARGIN_PX / PANE.width, 6);
    expect(topLeft?.y).toBeCloseTo(PANEL_MARGIN_PX / PANE.height, 6);

    const bottomRight = resolveAmbientImagePresetGeometry({
      pane: PANE,
      size,
      placement: "bottom-right",
      aspectRatio: WIDE,
    });
    expect(bottomRight?.x).toBeCloseTo(1 - width - PANEL_MARGIN_PX / PANE.width, 6);
    expect(bottomRight?.y).toBeCloseTo(1 - height - PANEL_MARGIN_PX / PANE.height, 6);
  });

  it("keeps the silver-ratio relation between the preset widths", () => {
    const deltaS = 1 + Math.SQRT2;
    expect(PRESET_WIDTH_PX.large / PRESET_WIDTH_PX.small).toBeCloseTo(deltaS, 1);
    expect(PRESET_WIDTH_PX.medium / PRESET_WIDTH_PX.small).toBeCloseTo(Math.sqrt(deltaS), 1);
  });

  it("steps down to a smaller preset when the requested size does not fit", () => {
    // A very tall image in a short window: the large preset would be taller
    // than the pane, so a smaller preset must be selected.
    const shortPane = { width: 1280, height: 220 };
    const tall = 1 / 3;
    const large = resolveAmbientImagePresetGeometry({
      pane: shortPane,
      size: "large",
      placement: "bottom-right",
      aspectRatio: tall,
    });
    expect(large).not.toBeNull();
    expect(large!.width * shortPane.width).toBeLessThan(PRESET_WIDTH_PX.large);
    // Still completely inside the pane.
    expect(large!.y).toBeGreaterThanOrEqual(0);
    expect(
      large!.y + (large!.width * shortPane.width) / tall / shortPane.height,
    ).toBeLessThanOrEqual(1 + 1e-9);
  });

  it.each([320, 414])("keeps a preset panel inside the minor share of a %ipx window", (width) => {
    // A fixed pixel width would cover most of a narrow window.
    const narrowPane = { width, height: 896 };
    const preset = resolveAmbientImagePresetGeometry({
      pane: narrowPane,
      size: "large",
      placement: "bottom-right",
      aspectRatio: WIDE,
    });
    expect(preset!.width).toBeLessThanOrEqual(PRESET_MAXIMUM_WIDTH_FRACTION + 1e-9);
    expect(preset!.width * narrowPane.width).toBeLessThan(narrowPane.width / 2);
  });

  it("returns null while the pane is not measurable", () => {
    expect(
      resolveAmbientImagePresetGeometry({
        pane: null,
        size: "medium",
        placement: "bottom-right",
        aspectRatio: WIDE,
      }),
    ).toBeNull();
    expect(
      resolveAmbientImagePresetGeometry({
        pane: { width: 0, height: 0 },
        size: "medium",
        placement: "bottom-right",
        aspectRatio: WIDE,
      }),
    ).toBeNull();
  });
});

describe("clamping for a pane", () => {
  it("pulls a panel dragged past the right edge back on screen", () => {
    const clamped = clampAmbientImageGeometryForPane({ x: 4, y: 0.2, width: 0.25 }, PANE, WIDE);
    expect(clamped?.x).toBeCloseTo(1 - 0.25, 6);
  });

  it("pulls a panel dragged past the bottom edge back on screen", () => {
    const clamped = clampAmbientImageGeometryForPane({ x: 0.1, y: 9, width: 0.25 }, PANE, WIDE);
    const height = (0.25 * PANE.width) / WIDE / PANE.height;
    expect(clamped?.y).toBeCloseTo(1 - height, 6);
  });

  it("never allows a panel wider than the silver-ratio share of the window", () => {
    const clamped = clampAmbientImageGeometryForPane({ x: 0, y: 0, width: 5 }, PANE, WIDE);
    expect(clamped?.width).toBeLessThanOrEqual(CUSTOM_MAXIMUM_WIDTH_FRACTION + 1e-9);
    expect(clamped?.x).toBeGreaterThanOrEqual(0);
  });

  it("never allows a panel narrower than the minimum handle width", () => {
    const clamped = clampAmbientImageGeometryForPane({ x: 0.1, y: 0.1, width: 0.0001 }, PANE, WIDE);
    expect(clamped!.width * PANE.width).toBeCloseTo(CUSTOM_MINIMUM_WIDTH_PX, 6);
  });

  it("caps the width by height for a tall image so the panel still fits", () => {
    const tall = 1 / 3;
    const clamped = clampAmbientImageGeometryForPane({ x: 0, y: 0, width: 1 }, PANE, tall);
    const height = (clamped!.width * PANE.width) / tall / PANE.height;
    expect(height).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("rejects values that are not geometry", () => {
    expect(clampAmbientImageGeometryForPane(null, PANE, WIDE)).toBeNull();
    expect(clampAmbientImageGeometryForPane({ x: 0, y: 0 }, PANE, WIDE)).toBeNull();
    expect(
      clampAmbientImageGeometryForPane({ x: Number.NaN, y: 0, width: 0.2 }, PANE, WIDE),
    ).toBeNull();
    expect(clampAmbientImageGeometryForPane({ x: 0, y: 0, width: 0.2 }, PANE, 0)).toBeNull();
  });
});
