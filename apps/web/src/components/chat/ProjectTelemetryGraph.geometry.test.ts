import { describe, expect, it } from "vitest";
import {
  clampProjectTelemetryPanelGeometry,
  defaultProjectTelemetryPanelGeometry,
} from "./ProjectTelemetryGraph.geometry";

describe("telemetry panel geometry", () => {
  it("starts at the right edge of its own anchor without machine-specific coordinates", () => {
    expect(defaultProjectTelemetryPanelGeometry({ width: 1000, height: 700 })).toEqual({
      x: 640,
      y: 8,
      width: 352,
      height: 400,
    });
    expect(defaultProjectTelemetryPanelGeometry({ width: 5000, height: 1000 }).x).toBe(4640);
  });
  it("clamps restored geometry to a smaller anchor and yields minimum dimensions on mobile", () => {
    expect(
      clampProjectTelemetryPanelGeometry(
        { x: 900, y: 700, width: 900, height: 700 },
        { width: 640, height: 480 },
      ),
    ).toEqual({ x: 8, y: 8, width: 624, height: 464 });
    expect(defaultProjectTelemetryPanelGeometry({ width: 240, height: 180 })).toEqual({
      x: 8,
      y: 8,
      width: 224,
      height: 164,
    });
  });
  it("sanitizes non-finite and empty anchor bounds", () => {
    const result = clampProjectTelemetryPanelGeometry(
      { x: NaN, y: -Infinity, width: Infinity, height: NaN },
      { width: 800, height: 600 },
    );
    expect(result).toEqual({ x: 8, y: 8, width: 352, height: 400 });
    expect(defaultProjectTelemetryPanelGeometry({ width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  });
});
