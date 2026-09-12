import {
  DEFAULT_AMBIENT_OPACITY,
  DEFAULT_FALLING_EFFECT_DENSITY,
  DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
  DEFAULT_FALLING_EFFECT_SPEED,
  MAX_AMBIENT_OPACITY,
  MAX_FALLING_EFFECT_DENSITY,
  MAX_FALLING_EFFECT_JAPANESE_RATIO,
  MAX_FALLING_EFFECT_SPEED,
  MIN_AMBIENT_OPACITY,
  MIN_FALLING_EFFECT_DENSITY,
  MIN_FALLING_EFFECT_JAPANESE_RATIO,
  MIN_FALLING_EFFECT_SPEED,
  DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP,
  MAX_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  MAX_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
  MAX_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  MIN_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  MIN_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
  MIN_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
} from "@cafecode/contracts/settings";

export function clampAtmosphereSpeedSetting(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return DEFAULT_FALLING_EFFECT_SPEED;
  return Math.min(MAX_FALLING_EFFECT_SPEED, Math.max(MIN_FALLING_EFFECT_SPEED, value));
}

export function clampAtmosphereDensitySetting(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return DEFAULT_FALLING_EFFECT_DENSITY;
  return Math.min(MAX_FALLING_EFFECT_DENSITY, Math.max(MIN_FALLING_EFFECT_DENSITY, value));
}

export function clampAtmosphereJapanesePercentSetting(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return DEFAULT_FALLING_EFFECT_JAPANESE_RATIO;
  return Math.min(
    MAX_FALLING_EFFECT_JAPANESE_RATIO,
    Math.max(MIN_FALLING_EFFECT_JAPANESE_RATIO, value / 100),
  );
}

export function clampAtmosphereOpacityPercentSetting(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return DEFAULT_AMBIENT_OPACITY;
  return Math.min(MAX_AMBIENT_OPACITY, Math.max(MIN_AMBIENT_OPACITY, value / 100));
}

export function clampAtmosphereMatrixColorCycleSpeedSetting(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED;
  }
  return Math.min(
    MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
    Math.max(MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED, value),
  );
}

export function clampAtmosphereMatrixBaseFontSizeSetting(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE;
  }
  return Math.min(
    MAX_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
    Math.max(MIN_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE, Math.round(value)),
  );
}

/**
 * The stored schema still decodes Club Code's legacy two-decimal endpoints, but
 * new edits are normalized onto the whole-pixel grid the glyph cache addresses.
 */
export function clampAtmosphereMatrixWalkFontSizeSetting(
  value: number | null,
  fallback: number,
): number {
  const requested = value === null || !Number.isFinite(value) ? fallback : value;
  const bounded = Math.min(
    MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
    Math.max(MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE, requested),
  );
  return (
    Math.round(bounded / FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP) *
    FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP
  );
}

export function clampAtmosphereMatrixWalkLifecyclePercentSetting(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT;
  }
  return Math.min(
    MAX_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
    Math.max(MIN_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT, Math.round(value)),
  );
}

export function clampAtmosphereMatrixCenterWindIntensitySetting(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY;
  }
  return Math.min(
    MAX_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
    Math.max(MIN_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY, Math.round(value)),
  );
}
