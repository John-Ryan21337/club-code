import { describe, expect, it } from "vitest";

import {
  clampWorldClockPanelGeometry,
  WORLD_CLOCK_PANEL_COLLAPSED_HEIGHT,
  WORLD_CLOCK_PANEL_MARGIN,
} from "./worldClockPanelGeometry";

describe("world clock panel geometry", () => {
  it("keeps expanded geometry within an ordinary viewport", () => {
    const geometry = clampWorldClockPanelGeometry(
      {
        x: -100,
        y: 10_000,
        width: 2_000,
        height: 2_000,
        collapsed: false,
      },
      { width: 800, height: 600 },
    );

    expect(geometry.x).toBe(WORLD_CLOCK_PANEL_MARGIN);
    expect(geometry.width).toBe(800 - WORLD_CLOCK_PANEL_MARGIN * 2);
    expect(geometry.y + geometry.height).toBe(600 - WORLD_CLOCK_PANEL_MARGIN);
  });

  it("shrinks the collapsed header inside a very short responsive viewport", () => {
    const bounds = { width: 240, height: 40 };
    const geometry = clampWorldClockPanelGeometry(
      {
        x: 10_000,
        y: 10_000,
        width: 390,
        height: 360,
        collapsed: true,
      },
      bounds,
    );
    const renderedHeight = Math.min(WORLD_CLOCK_PANEL_COLLAPSED_HEIGHT, geometry.height);

    expect(geometry.x + geometry.width).toBeLessThanOrEqual(
      bounds.width - WORLD_CLOCK_PANEL_MARGIN,
    );
    expect(geometry.y + renderedHeight).toBeLessThanOrEqual(
      bounds.height - WORLD_CLOCK_PANEL_MARGIN,
    );
  });

  it("replaces non-finite persisted values before clamping", () => {
    const geometry = clampWorldClockPanelGeometry(
      {
        x: Number.NaN,
        y: Number.POSITIVE_INFINITY,
        width: Number.NEGATIVE_INFINITY,
        height: Number.NaN,
        collapsed: false,
      },
      { width: 1_000, height: 700 },
    );

    expect(
      Object.values(geometry).every(
        (value) => typeof value === "boolean" || Number.isFinite(value),
      ),
    ).toBe(true);
  });
});
