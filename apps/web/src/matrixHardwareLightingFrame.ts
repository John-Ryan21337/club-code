import type { HardwareLightingColor } from "@cafecode/contracts";

import { parseMatrixGpuColor } from "./matrixGpuFrameCollector";
import type { MatrixColorFrame } from "./windowAtmosphere";

const HARDWARE_MATRIX_PALETTE_SIZE = 32;

function toByte(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 255);
}

function parsedColor(color: string): HardwareLightingColor {
  const parsed = parseMatrixGpuColor(color);
  return {
    red: toByte(parsed.red),
    green: toByte(parsed.green),
    blue: toByte(parsed.blue),
  };
}

/**
 * Project the exact resolved Matrix palette into a bounded hardware palette.
 * Uniform modes preserve their single color; Extra modes sample deterministic
 * hue phases from the same base hue/saturation/lightness as the glyph streams.
 */
export function matrixHardwareLightingColors(
  frame: MatrixColorFrame,
): readonly HardwareLightingColor[] {
  if (
    !frame.perStream ||
    frame.baseHue === null ||
    frame.saturation === null ||
    frame.lightness === null
  ) {
    return [parsedColor(frame.color)];
  }
  const baseHue = frame.baseHue;
  const saturation = frame.saturation;
  const lightness = frame.lightness;
  return Array.from({ length: HARDWARE_MATRIX_PALETTE_SIZE }, (_, index) =>
    parsedColor(
      `hsl(${(baseHue + (index / HARDWARE_MATRIX_PALETTE_SIZE) * 360).toFixed(1)} ${saturation.toFixed(1)}% ${lightness.toFixed(1)}%)`,
    ),
  );
}
