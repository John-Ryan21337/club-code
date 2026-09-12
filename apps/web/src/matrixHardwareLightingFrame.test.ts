import { describe, expect, it } from "vitest";

import { matrixHardwareLightingColors } from "./matrixHardwareLightingFrame";

describe("matrixHardwareLightingColors", () => {
  it("preserves the exact resolved uniform Matrix color", () => {
    expect(
      matrixHardwareLightingColors({
        color: "#123456",
        perStream: false,
        baseHue: null,
        saturation: null,
        lightness: null,
      }),
    ).toEqual([{ red: 18, green: 52, blue: 86 }]);
  });

  it("samples a bounded deterministic palette for per-stream modes", () => {
    const colors = matrixHardwareLightingColors({
      color: "hsl(0 100% 50%)",
      perStream: true,
      baseHue: 0,
      saturation: 100,
      lightness: 50,
    });
    expect(colors).toHaveLength(32);
    expect(colors[0]).toEqual({ red: 255, green: 0, blue: 0 });
    expect(new Set(colors.map((color) => `${color.red},${color.green},${color.blue}`)).size).toBe(
      32,
    );
  });
});
