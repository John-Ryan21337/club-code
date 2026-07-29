export interface ProjectTelemetryPanelGeometry {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ProjectTelemetryPanelBounds {
  readonly width: number;
  readonly height: number;
}

export const PROJECT_TELEMETRY_PANEL_MARGIN = 8;
export const PROJECT_TELEMETRY_PANEL_MIN_WIDTH = 280;
export const PROJECT_TELEMETRY_PANEL_MIN_HEIGHT = 220;
export const PROJECT_TELEMETRY_PANEL_DEFAULT_GEOMETRY: ProjectTelemetryPanelGeometry = {
  // A deliberately large finite x value makes a fresh panel start at the
  // right edge after clamping without persisting a viewport-specific offset.
  x: Number.MAX_SAFE_INTEGER,
  y: PROJECT_TELEMETRY_PANEL_MARGIN,
  width: 352,
  height: 400,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Keep the panel fully inside its chat anchor. The minimum dimensions yield
 * when the anchor itself is smaller, which keeps an explicitly expanded
 * narrow/mobile panel reachable instead of overflowing the viewport.
 */
export function clampProjectTelemetryPanelGeometry(
  geometry: ProjectTelemetryPanelGeometry,
  bounds: ProjectTelemetryPanelBounds,
): ProjectTelemetryPanelGeometry {
  const boundsWidth = Math.max(0, finiteOr(bounds.width, 0));
  const boundsHeight = Math.max(0, finiteOr(bounds.height, 0));
  const horizontalMargin = Math.min(PROJECT_TELEMETRY_PANEL_MARGIN, boundsWidth / 2);
  const verticalMargin = Math.min(PROJECT_TELEMETRY_PANEL_MARGIN, boundsHeight / 2);
  const maximumWidth = Math.max(0, boundsWidth - horizontalMargin * 2);
  const maximumHeight = Math.max(0, boundsHeight - verticalMargin * 2);
  const minimumWidth = Math.min(PROJECT_TELEMETRY_PANEL_MIN_WIDTH, maximumWidth);
  const minimumHeight = Math.min(PROJECT_TELEMETRY_PANEL_MIN_HEIGHT, maximumHeight);
  const width = clamp(
    finiteOr(geometry.width, PROJECT_TELEMETRY_PANEL_DEFAULT_GEOMETRY.width),
    minimumWidth,
    maximumWidth,
  );
  const height = clamp(
    finiteOr(geometry.height, PROJECT_TELEMETRY_PANEL_DEFAULT_GEOMETRY.height),
    minimumHeight,
    maximumHeight,
  );
  const maximumX = Math.max(horizontalMargin, boundsWidth - width - horizontalMargin);
  const maximumY = Math.max(verticalMargin, boundsHeight - height - verticalMargin);

  return {
    x: clamp(
      finiteOr(geometry.x, PROJECT_TELEMETRY_PANEL_DEFAULT_GEOMETRY.x),
      horizontalMargin,
      maximumX,
    ),
    y: clamp(
      finiteOr(geometry.y, PROJECT_TELEMETRY_PANEL_DEFAULT_GEOMETRY.y),
      verticalMargin,
      maximumY,
    ),
    width,
    height,
  };
}
