import { describe, expect, it } from "vitest";

import {
  clampProjectTelemetryPanelGeometry,
  PROJECT_TELEMETRY_PANEL_DEFAULT_GEOMETRY,
  PROJECT_TELEMETRY_PANEL_MARGIN,
} from "./ProjectTelemetryGraph.geometry";

describe("ProjectTelemetryGraph geometry", () => {
  it("places a fresh panel at the upper-right of its chat anchor", () => {
    expect(
      clampProjectTelemetryPanelGeometry(PROJECT_TELEMETRY_PANEL_DEFAULT_GEOMETRY, {
        width: 1_000,
        height: 700,
      }),
    ).toEqual({
      x: 640,
      y: PROJECT_TELEMETRY_PANEL_MARGIN,
      width: 352,
      height: 400,
    });
  });

  it("clamps persisted placement and dimensions to a resized chat anchor", () => {
    expect(
      clampProjectTelemetryPanelGeometry(
        {
          x: 900,
          y: 700,
          width: 900,
          height: 700,
        },
        { width: 640, height: 480 },
      ),
    ).toEqual({
      x: 8,
      y: 8,
      width: 624,
      height: 464,
    });
  });

  it("yields its minimum size to keep an expanded mobile panel fully reachable", () => {
    expect(
      clampProjectTelemetryPanelGeometry(
        { x: -50, y: -20, width: 352, height: 400 },
        { width: 240, height: 180 },
      ),
    ).toEqual({
      x: 8,
      y: 8,
      width: 224,
      height: 164,
    });
  });

  it("sanitizes non-finite persisted values before applying bounds", () => {
    expect(
      clampProjectTelemetryPanelGeometry(
        {
          x: Number.NaN,
          y: Number.NEGATIVE_INFINITY,
          width: Number.POSITIVE_INFINITY,
          height: Number.NaN,
        },
        { width: 800, height: 600 },
      ),
    ).toEqual({
      x: 440,
      y: 8,
      width: 352,
      height: 400,
    });
  });
});
