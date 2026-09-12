import * as Schema from "effect/Schema";

export interface WorldClockPanelBounds {
  readonly width: number;
  readonly height: number;
  readonly topInset?: number;
}

export interface WorldClockPanelGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly collapsed: boolean;
}

/**
 * Panel placement is per-renderer window state, not an account preference, so
 * it stays in this renderer's local storage. A stored geometry is never trusted
 * directly: `clampWorldClockPanelGeometry` runs on every render, so a corrupted
 * or stale value cannot put the panel outside the viewport where the user can
 * no longer reach its move, resize, or collapse controls.
 */
export const WORLD_CLOCK_PANEL_STORAGE_KEY = "cafe-code:world-clock-panel:v1";
export const WORLD_CLOCK_PANEL_MARGIN = 8;
export const WORLD_CLOCK_PANEL_MIN_WIDTH = 280;
export const WORLD_CLOCK_PANEL_MIN_HEIGHT = 180;
export const WORLD_CLOCK_PANEL_COLLAPSED_HEIGHT = 44;

export const WORLD_CLOCK_PANEL_DEFAULT_GEOMETRY: WorldClockPanelGeometry = {
  x: 441,
  y: 125,
  width: 532,
  height: 277,
  collapsed: false,
};

export const WorldClockPanelGeometrySchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  collapsed: Schema.Boolean,
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Fit a requested geometry inside the current viewport.
 *
 * The minimum size yields to the viewport, because a narrow phone window is
 * smaller than the desktop minimum and a panel wider than the screen would push
 * its own controls off-screen. A collapsed panel is clamped against its header
 * height only, so collapsing near the bottom edge does not move the panel.
 */
export function clampWorldClockPanelGeometry(
  geometry: WorldClockPanelGeometry,
  bounds: WorldClockPanelBounds,
): WorldClockPanelGeometry {
  const boundsWidth = Math.max(0, finiteOr(bounds.width, 0));
  const boundsHeight = Math.max(0, finiteOr(bounds.height, 0));
  const topInset = clamp(finiteOr(bounds.topInset ?? 0, 0), 0, boundsHeight);
  const horizontalMargin = Math.min(WORLD_CLOCK_PANEL_MARGIN, boundsWidth / 2);
  const verticalMargin = Math.min(WORLD_CLOCK_PANEL_MARGIN, (boundsHeight - topInset) / 2);
  const maximumWidth = Math.max(0, boundsWidth - horizontalMargin * 2);
  const maximumHeight = Math.max(0, boundsHeight - topInset - verticalMargin * 2);
  const minimumWidth = Math.min(WORLD_CLOCK_PANEL_MIN_WIDTH, maximumWidth);
  const minimumHeight = Math.min(WORLD_CLOCK_PANEL_MIN_HEIGHT, maximumHeight);
  const width = clamp(
    finiteOr(geometry.width, WORLD_CLOCK_PANEL_DEFAULT_GEOMETRY.width),
    minimumWidth,
    maximumWidth,
  );
  const height = clamp(
    finiteOr(geometry.height, WORLD_CLOCK_PANEL_DEFAULT_GEOMETRY.height),
    minimumHeight,
    maximumHeight,
  );
  const renderedHeight = geometry.collapsed
    ? Math.min(WORLD_CLOCK_PANEL_COLLAPSED_HEIGHT, height)
    : height;
  const maximumX = Math.max(horizontalMargin, boundsWidth - width - horizontalMargin);
  const minimumY = topInset + verticalMargin;
  const maximumY = Math.max(minimumY, boundsHeight - renderedHeight - verticalMargin);

  return {
    x: clamp(
      finiteOr(geometry.x, WORLD_CLOCK_PANEL_DEFAULT_GEOMETRY.x),
      horizontalMargin,
      maximumX,
    ),
    y: clamp(finiteOr(geometry.y, WORLD_CLOCK_PANEL_DEFAULT_GEOMETRY.y), minimumY, maximumY),
    width,
    height,
    collapsed: Boolean(geometry.collapsed),
  };
}
