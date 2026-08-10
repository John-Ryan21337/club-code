import { RATIO_PRESETS, qualityLimits } from "./config.js";

export const SQRT3 = Math.sqrt(3);

export function cssPixelsPerInch(viewport, display, settings) {
  if (settings.manualCssPixelsPerInch > 0) return settings.manualCssPixelsPerInch;
  const width = Math.max(1, Number(display?.width) || viewport.width);
  const height = Math.max(1, Number(display?.height) || viewport.height);
  return Math.hypot(width, height) / settings.displayDiagonalInches;
}

export function targetTileRadius(viewport, display, settings) {
  const ratio = RATIO_PRESETS[settings.ratioPreset]?.factor ?? 1;
  return Math.max(4, (settings.tripletLongSpanInches * cssPixelsPerInch(viewport, display, settings) * ratio) / 2);
}

function snapRadiusForWholeTiles(width, targetRadius) {
  const approximateColumns = Math.max(1, Math.round((width / targetRadius - 0.5) / 1.5));
  let best = targetRadius;
  let score = Number.POSITIVE_INFINITY;
  for (let columns = Math.max(1, approximateColumns - 4); columns <= approximateColumns + 4; columns += 1) {
    const radius = width / (2 + 1.5 * Math.max(0, columns - 1));
    const candidateScore = Math.abs(Math.log(radius / targetRadius));
    if (candidateScore < score) {
      best = radius;
      score = candidateScore;
    }
  }
  return best;
}

export function resolveTileMetrics(viewport, display, settings) {
  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const requestedRadius = targetTileRadius(viewport, display, settings);
  const radius = settings.alignmentMode === "whole-tiles" && settings.ratioLockOnResize
    ? snapRadiusForWholeTiles(width, requestedRadius)
    : requestedRadius;
  return {
    radius,
    requestedRadius,
    apothem: (SQRT3 * radius) / 2,
    cssPixelsPerInch: cssPixelsPerInch(viewport, display, settings),
  };
}

function hash32(a, b, seed) {
  let value = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ seed) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

export function buildHexGrid(viewport, display, settings) {
  const initialMetrics = resolveTileMetrics(viewport, display, settings);
  const { width, height } = viewport;
  const whole = settings.alignmentMode === "whole-tiles";
  const limit = qualityLimits(settings.quality).tiles;
  const collect = (radius) => {
    const apothem = (SQRT3 * radius) / 2;
    const startColumn = whole ? 0 : -2;
    const columnCount = Math.ceil(width / (1.5 * radius)) + (whole ? 1 : 4);
    const rowCount = Math.ceil(height / (2 * apothem)) + (whole ? 1 : 4);
    const startRow = whole ? 0 : -2;
    const candidates = [];
    for (let column = startColumn; column < startColumn + columnCount; column += 1) {
      const x = radius + column * 1.5 * radius;
      const offsetY = (Math.abs(column) % 2) * apothem;
      for (let row = startRow; row < startRow + rowCount; row += 1) {
        const y = apothem + row * 2 * apothem + offsetY;
        const complete = x - radius >= -0.001 && x + radius <= width + 0.001 && y - apothem >= -0.001 && y + apothem <= height + 0.001;
        if (whole ? complete : x + radius >= 0 && x - radius <= width && y + apothem >= 0 && y - apothem <= height) {
          candidates.push({
            column,
            row,
            x,
            y,
            phase: (hash32(column, row, settings.seed) / 0xffffffff) * Math.PI * 2,
            random: hash32(row, column, settings.seed ^ 0xa5a5a5a5) / 0xffffffff,
          });
        }
      }
    }
    if (whole && candidates.length > 0) {
      const minimumX = Math.min(...candidates.map((tile) => tile.x - radius));
      const maximumX = Math.max(...candidates.map((tile) => tile.x + radius));
      const minimumY = Math.min(...candidates.map((tile) => tile.y - apothem));
      const maximumY = Math.max(...candidates.map((tile) => tile.y + apothem));
      const shiftX = (width - (maximumX - minimumX)) / 2 - minimumX;
      const shiftY = (height - (maximumY - minimumY)) / 2 - minimumY;
      for (const tile of candidates) {
        tile.x += shiftX;
        tile.y += shiftY;
      }
    }
    return { radius, apothem, candidates };
  };

  let radius = initialMetrics.radius;
  let result = collect(radius);
  const limited = result.candidates.length > limit;
  for (let attempt = 0; result.candidates.length > limit && attempt < 4; attempt += 1) {
    radius *= Math.sqrt(result.candidates.length / limit) * 1.025;
    result = collect(radius);
  }
  return {
    ...initialMetrics,
    radius: result.radius,
    apothem: result.apothem,
    tiles: result.candidates,
    limited,
  };
}

export function hexVertices(centerX, centerY, radius, scale = 1, shiftX = 0, shiftY = 0) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index;
    return [centerX + shiftX + Math.cos(angle) * radius * scale, centerY + shiftY + Math.sin(angle) * radius * scale];
  });
}

export function threeRhombi(centerX, centerY, radius, scale = 1, shiftX = 0, shiftY = 0) {
  const vertices = hexVertices(centerX, centerY, radius, scale, shiftX, shiftY);
  const center = [centerX + shiftX, centerY + shiftY];
  return [
    [center, vertices[0], vertices[1], vertices[2]],
    [center, vertices[2], vertices[3], vertices[4]],
    [center, vertices[4], vertices[5], vertices[0]],
  ];
}

export function gridHasOnlyCompleteTiles(grid, viewport) {
  const epsilon = 0.01;
  return grid.tiles.every((tile) =>
    tile.x - grid.radius >= -epsilon && tile.x + grid.radius <= viewport.width + epsilon &&
    tile.y - grid.apothem >= -epsilon && tile.y + grid.apothem <= viewport.height + epsilon,
  );
}
