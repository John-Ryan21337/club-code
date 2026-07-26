import {
  clampAmbientMediaGeometry,
  type NormalizedAmbientMediaGeometry,
} from "../../ambientMediaGeometryStorage";

export interface AmbientImagePaneSize {
  readonly width: number;
  readonly height: number;
}

export interface AmbientImageGeometryLimits {
  readonly minimumWidthPixels: number;
  readonly maximumWidthFraction: number;
}

export interface AmbientImagePointerPosition {
  readonly clientX: number;
  readonly clientY: number;
}

function hasUsablePane(pane: AmbientImagePaneSize): boolean {
  return (
    Number.isFinite(pane.width) && Number.isFinite(pane.height) && pane.width > 0 && pane.height > 0
  );
}

export function clampAmbientImageGeometryForPane(input: {
  readonly geometry: NormalizedAmbientMediaGeometry;
  readonly pane: AmbientImagePaneSize;
  readonly mediaAspectRatio: number;
  readonly limits: AmbientImageGeometryLimits;
}): NormalizedAmbientMediaGeometry | null {
  if (
    !hasUsablePane(input.pane) ||
    !Number.isFinite(input.mediaAspectRatio) ||
    input.mediaAspectRatio <= 0 ||
    !Number.isFinite(input.limits.minimumWidthPixels) ||
    input.limits.minimumWidthPixels < 0
  ) {
    return null;
  }

  const paneAspectRatio = input.pane.width / input.pane.height;
  const maximumReachableWidth = Math.min(
    input.limits.maximumWidthFraction,
    input.mediaAspectRatio / paneAspectRatio,
  );
  return clampAmbientMediaGeometry(input.geometry, {
    mediaAspectRatio: input.mediaAspectRatio,
    paneAspectRatio,
    minimumWidth: Math.min(
      input.limits.minimumWidthPixels / input.pane.width,
      maximumReachableWidth,
    ),
    maximumWidth: input.limits.maximumWidthFraction,
  });
}

export function resolveAmbientImagePointerMove(input: {
  readonly startGeometry: NormalizedAmbientMediaGeometry;
  readonly startPointer: AmbientImagePointerPosition;
  readonly currentPointer: AmbientImagePointerPosition;
  readonly pane: AmbientImagePaneSize;
  readonly mediaAspectRatio: number;
  readonly limits: AmbientImageGeometryLimits;
}): NormalizedAmbientMediaGeometry | null {
  if (!hasUsablePane(input.pane)) {
    return null;
  }

  return clampAmbientImageGeometryForPane({
    geometry: {
      ...input.startGeometry,
      x:
        input.startGeometry.x +
        (input.currentPointer.clientX - input.startPointer.clientX) / input.pane.width,
      y:
        input.startGeometry.y +
        (input.currentPointer.clientY - input.startPointer.clientY) / input.pane.height,
    },
    pane: input.pane,
    mediaAspectRatio: input.mediaAspectRatio,
    limits: input.limits,
  });
}

export function resolveAmbientImageKeyboardMove(input: {
  readonly geometry: NormalizedAmbientMediaGeometry;
  readonly key: string;
  readonly step: number;
  readonly pane: AmbientImagePaneSize;
  readonly mediaAspectRatio: number;
  readonly limits: AmbientImageGeometryLimits;
}): NormalizedAmbientMediaGeometry | null {
  const delta =
    input.key === "ArrowLeft"
      ? { x: -input.step, y: 0 }
      : input.key === "ArrowRight"
        ? { x: input.step, y: 0 }
        : input.key === "ArrowUp"
          ? { x: 0, y: -input.step }
          : input.key === "ArrowDown"
            ? { x: 0, y: input.step }
            : null;
  if (delta === null || !Number.isFinite(input.step) || input.step <= 0) {
    return null;
  }

  return clampAmbientImageGeometryForPane({
    geometry: {
      ...input.geometry,
      x: input.geometry.x + delta.x,
      y: input.geometry.y + delta.y,
    },
    pane: input.pane,
    mediaAspectRatio: input.mediaAspectRatio,
    limits: input.limits,
  });
}

export function resolveAmbientImagePointerResize(input: {
  readonly startGeometry: NormalizedAmbientMediaGeometry;
  readonly startPointer: AmbientImagePointerPosition;
  readonly currentPointer: AmbientImagePointerPosition;
  readonly pane: AmbientImagePaneSize;
  readonly mediaAspectRatio: number;
  readonly limits: AmbientImageGeometryLimits;
}): NormalizedAmbientMediaGeometry | null {
  if (!hasUsablePane(input.pane)) {
    return null;
  }

  return clampAmbientImageGeometryForPane({
    geometry: {
      ...input.startGeometry,
      width: Math.max(
        input.limits.minimumWidthPixels / input.pane.width,
        input.startGeometry.width +
          (input.currentPointer.clientX - input.startPointer.clientX) / input.pane.width,
      ),
    },
    pane: input.pane,
    mediaAspectRatio: input.mediaAspectRatio,
    limits: input.limits,
  });
}

export function resolveAmbientImageKeyboardResize(input: {
  readonly geometry: NormalizedAmbientMediaGeometry;
  readonly key: string;
  readonly step: number;
  readonly pane: AmbientImagePaneSize;
  readonly mediaAspectRatio: number;
  readonly limits: AmbientImageGeometryLimits;
}): NormalizedAmbientMediaGeometry | null {
  const direction =
    input.key === "ArrowRight" || input.key === "ArrowDown"
      ? 1
      : input.key === "ArrowLeft" || input.key === "ArrowUp"
        ? -1
        : null;
  if (direction === null || !Number.isFinite(input.step) || input.step <= 0) {
    return null;
  }

  return clampAmbientImageGeometryForPane({
    geometry: {
      ...input.geometry,
      width: Math.max(
        input.limits.minimumWidthPixels / input.pane.width,
        input.geometry.width + direction * input.step,
      ),
    },
    pane: input.pane,
    mediaAspectRatio: input.mediaAspectRatio,
    limits: input.limits,
  });
}
