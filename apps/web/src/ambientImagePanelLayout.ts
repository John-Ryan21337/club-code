import type {
  AmbientImagePresetPlacement,
  AmbientImagePresetSize,
} from "@cafecode/contracts/settings";

import { clampAmbientImageGeometry, type AmbientImageGeometry } from "./ambientImageGeometry";

/**
 * Bounded layout math for the floating ambient image panel.
 *
 * This module holds no React and no DOM access, so the limits that keep the
 * panel on screen can be tested directly.
 *
 * Sizing follows the silver ratio, `delta_s = 1 + sqrt(2)` (about 2.414): the
 * `large` preset is `delta_s` times the `small` preset, and `medium` is the
 * geometric mean of the two.
 */
export interface AmbientImagePaneSize {
  readonly width: number;
  readonly height: number;
}

export function usablePane(pane: AmbientImagePaneSize | null): pane is AmbientImagePaneSize {
  return (
    pane !== null &&
    Number.isFinite(pane.width) &&
    Number.isFinite(pane.height) &&
    pane.width > 0 &&
    pane.height > 0
  );
}

export const DEFAULT_GLOW_COLOR = "#7dd3fc";

/** Pixel widths of the three preset sizes. `large` is `delta_s x small`. */
export const PRESET_WIDTH_PX: Record<AmbientImagePresetSize, number> = {
  small: 150,
  medium: 233,
  large: 362,
};
export const PRESET_SIZE_ORDER: readonly AmbientImagePresetSize[] = ["small", "medium", "large"];
/** Gap between the panel and the window edge, and half of the handle size. */
export const PANEL_MARGIN_PX = 12;
/** Smallest usable custom width. Below this the handles overlap each other. */
export const CUSTOM_MINIMUM_WIDTH_PX = 120;
/**
 * Silver-ratio major share: `delta_s / (1 + delta_s)`, which is exactly
 * `1 / sqrt(2)`. The panel therefore always leaves the complementary 29.3% of
 * the window width clear.
 */
export const CUSTOM_MAXIMUM_WIDTH_FRACTION = Math.SQRT1_2;
/**
 * Silver-ratio minor share: `1 / (1 + delta_s)`, about 29.3%. A preset panel is
 * an unobtrusive corner panel, so it never takes more than this share of the
 * window width. Without this bound a fixed pixel width would cover most of a
 * narrow window. Only a deliberate custom resize may pass it.
 */
export const PRESET_MAXIMUM_WIDTH_FRACTION = 1 - Math.SQRT1_2;
const MINIMUM_HANDLE_FRAME_PX = 60;

/** Letterbox extreme images inside a frame that keeps the four handles apart. */
export function resolveAmbientImagePanelAspectRatio(
  mediaAspectRatio: number,
  pane: AmbientImagePaneSize | null,
): number {
  const minimum = usablePane(pane) ? Math.max(1 / 3, MINIMUM_HANDLE_FRAME_PX / pane.height) : 1 / 3;
  const maximum = usablePane(pane)
    ? Math.min(
        2,
        Math.max(MINIMUM_HANDLE_FRAME_PX, pane.width * PRESET_MAXIMUM_WIDTH_FRACTION) /
          MINIMUM_HANDLE_FRAME_PX,
      )
    : 2;
  return Math.max(Math.min(minimum, maximum), Math.min(maximum, mediaAspectRatio));
}
/** Normalized step for one arrow key press on the move handle. */
export const KEYBOARD_MOVE_STEP = 0.02;
/** Normalized step for one arrow key press on the resize handle. */
export const KEYBOARD_RESIZE_STEP = 0.025;

/**
 * Applies the product limits for one pane, then the reachability clamp. The
 * minimum never exceeds the reachable maximum, so a very tall image in a short
 * window still produces a rectangle instead of `null`.
 */
export function clampAmbientImageGeometryForPane(
  value: unknown,
  pane: AmbientImagePaneSize,
  aspectRatio: number,
): AmbientImageGeometry | null {
  if (!usablePane(pane) || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;
  const paneAspectRatio = pane.width / pane.height;
  // Compute the reachable maximum with the exact expression that
  // `clampAmbientImageGeometry` uses. Two algebraically equal expressions can
  // differ in the last bit, and a minimum one bit above the maximum makes the
  // clamp report "no reachable rectangle" for a panel that does fit.
  const reachableMaximum = Math.min(
    CUSTOM_MAXIMUM_WIDTH_FRACTION,
    1 / (paneAspectRatio / aspectRatio),
  );
  return clampAmbientImageGeometry(value, {
    mediaAspectRatio: aspectRatio,
    paneAspectRatio,
    minimumWidth: Math.min(CUSTOM_MINIMUM_WIDTH_PX / pane.width, reachableMaximum),
    maximumWidth: CUSTOM_MAXIMUM_WIDTH_FRACTION,
  });
}

/**
 * Resolves the bounded preset rectangle. If the requested size does not fit in
 * the window at the image aspect ratio, the next smaller preset is tried. If no
 * preset fits, the clamp reduces the width until the panel is completely on
 * screen. Returns `null` only when the pane is not measurable yet.
 */
export function resolveAmbientImagePresetGeometry(input: {
  readonly pane: AmbientImagePaneSize | null;
  readonly size: AmbientImagePresetSize;
  readonly placement: AmbientImagePresetPlacement;
  readonly aspectRatio: number;
}): AmbientImageGeometry | null {
  const { pane, placement, aspectRatio } = input;
  if (!usablePane(pane) || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;

  const marginX = PANEL_MARGIN_PX / pane.width;
  const marginY = PANEL_MARGIN_PX / pane.height;
  const requestedIndex = Math.max(0, PRESET_SIZE_ORDER.indexOf(input.size));
  const place = (widthPx: number): AmbientImageGeometry => {
    const width = Math.max(
      1,
      Math.min(
        widthPx,
        pane.width - PANEL_MARGIN_PX * 2,
        pane.width * PRESET_MAXIMUM_WIDTH_FRACTION,
      ),
    );
    const normalizedWidth = width / pane.width;
    const normalizedHeight = width / aspectRatio / pane.height;
    return {
      x: placement.endsWith("left") ? marginX : 1 - normalizedWidth - marginX,
      y: placement.startsWith("top") ? marginY : 1 - normalizedHeight - marginY,
      width: normalizedWidth,
    };
  };

  for (let index = requestedIndex; index >= 0; index--) {
    const size = PRESET_SIZE_ORDER[index] ?? "small";
    const candidate = place(PRESET_WIDTH_PX[size]);
    const fits = candidate.y >= 0 && candidate.x >= 0;
    const clamped = clampAmbientImageGeometry(candidate, {
      mediaAspectRatio: aspectRatio,
      paneAspectRatio: pane.width / pane.height,
      maximumWidth: PRESET_MAXIMUM_WIDTH_FRACTION,
    });
    if (fits && clamped !== null) return clamped;
  }
  return clampAmbientImageGeometry(place(PRESET_WIDTH_PX.small), {
    mediaAspectRatio: aspectRatio,
    paneAspectRatio: pane.width / pane.height,
    maximumWidth: PRESET_MAXIMUM_WIDTH_FRACTION,
  });
}
