import {
  DEFAULT_FALLING_EFFECT_DENSITY,
  DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
  DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP,
  MAX_FALLING_EFFECT_DENSITY,
  MAX_FALLING_EFFECT_JAPANESE_RATIO,
  MAX_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  MAX_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
  MAX_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  MAX_FALLING_EFFECT_SPEED,
  MIN_FALLING_EFFECT_DENSITY,
  MIN_FALLING_EFFECT_JAPANESE_RATIO,
  MIN_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  MIN_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
  MIN_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  MIN_FALLING_EFFECT_SPEED,
  type AmbientColor,
  type FallingEffectKind,
  type FallingEffectMatrixColorMode,
  type FallingEffectMatrixMotionMode,
} from "@cafecode/contracts/settings";
import { hasFreshLocalMediaAudioSignal, type LocalMediaAudioSignal } from "./localMediaAudioSignal";
import type { MatrixWorkVocabulary } from "./matrixWorkVocabulary";

export const MAX_ATMOSPHERE_DPR = 2;
/** Keep the backing canvas bounded even on an ultra-wide high-DPI display. */
export const MAX_ATMOSPHERE_CANVAS_PIXELS = 8_388_608;
export const MAX_ATMOSPHERE_FRAME_DELTA_SECONDS = 0.1;
export const MATRIX_RAINBOW_CYCLE_MS = 18_000;
export const REDUCED_MOTION_ATMOSPHERE_OPACITY_SCALE = 0.55;
export const MATRIX_MIN_AUDIO_REACTIVE_LEVEL = 0.015;
/** Avoid synchronized full-field rainbow cycling in the 3–30 Hz flash-sensitive range. */
export const MATRIX_MAX_UNIFORM_RAINBOW_CYCLES_PER_SECOND = 3;
export const MATRIX_MAX_UNIFORM_RAINBOW_SPEED =
  (MATRIX_RAINBOW_CYCLE_MS / 1_000) * MATRIX_MAX_UNIFORM_RAINBOW_CYCLES_PER_SECOND;
const MATRIX_MAX_HUE_CHANGE_PER_SECOND = 110;
const MATRIX_MAX_LIGHTNESS_CHANGE_PER_SECOND = 42;
const MATRIX_AUDIO_BEAT_HUE_IMPULSE_DEGREES = 22;

/**
 * Hard per-scene limits. Matrix's 640-stream source pool is four times the
 * previous ceiling; the Walk renderer separately caps visible streams and
 * rejects glyph bounds that would overlap.
 */
export const MAX_ATMOSPHERE_PARTICLES_BY_KIND = {
  snow: 320,
  rain: 440,
  matrix: 640,
} as const satisfies Record<FallingEffectKind, number>;

/** Reviewed decorative Roman glyph pool; it intentionally contains no words or phrases. */
export const MATRIX_ROMAN_GLYPHS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@#$%&*+-=<>[]{}";
/** Reviewed Japanese terms whose individual kanji fit a coding/AI atmosphere. */
export const MATRIX_JAPANESE_CODING_AI_TERMS = [
  "電脳",
  "機械",
  "知能",
  "学習",
  "推論",
  "生成",
  "言語",
  "符号",
  "解析",
  "演算",
  "回路",
  "未来",
  "創造",
  "対話",
  "探索",
  "深層",
  "神経",
  "仮想",
  "現実",
  "夢",
  "夜",
  "光",
  "影",
  "零",
  "無限",
] as const;
/** Reviewed decorative kana and coding/AI-context kanji; rendering selects individual glyphs. */
export const MATRIX_JAPANESE_GLYPHS = `アイウエオカキクケコサシスセソタチツテトナニヌネノマミムメモヤユヨラリルレロワヲン${MATRIX_JAPANESE_CODING_AI_TERMS.join("")}`;
/** Optional tasteful 2ch/net-culture glyphs, without hateful, sexual, or slur content. */
export const MATRIX_2CH_ENRICHED_GLYPHS = `${MATRIX_JAPANESE_GLYPHS}ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾅﾆﾇﾈﾉﾏﾐﾑﾒﾓﾗﾘﾙﾚﾛﾜﾝｰｯ､｡･「」()ｗ草乙神ｷﾀ`;
/** Rare, intact, reviewed 2ch-style cat AA tokens; they are never split into pseudo-phrases. */
export const MATRIX_2CH_AA_TOKENS = [
  "∧＿∧",
  "( ´∀｀)",
  "(・∀・)",
  "(=ﾟωﾟ)ﾉ",
  "（´・ω・｀）",
  "∧∧",
  "(,,ﾟДﾟ)",
] as const;
export const MAX_MATRIX_TOKEN_FONT_SIZE = 18;
export const MAX_MATRIX_TOKEN_WIDTH_PX = 144;
const MATRIX_2CH_TOKEN_PROBABILITY = 0.08;
const MATRIX_WORK_TOKEN_PROBABILITY = 0.34;
const MATRIX_WALK_FADE_START_PROGRESS = 0.72;
const MATRIX_CENTER_WIND_MAX_SPEED_PX_PER_SECOND = 60;
const MATRIX_WALK_LABEL_VIEWPORT_WIDTH_RATIO = 0.9;
const MATRIX_WALK_MONOSPACE_ADVANCE_EM = 0.64;
const MATRIX_WALK_WIDE_ADVANCE_EM = 1;
const MATRIX_WALK_GLYPH_GAP_PX = 2;
const MATRIX_WALK_TRAIL_LINE_HEIGHT = 1.08;
const MATRIX_WALK_MIN_OCCUPANCY_BIN_PX = 2;
const MATRIX_WALK_MAX_OCCUPANCY_CELLS = 524_288;
/** Eight trail glyphs per stream keeps the opt-in worst case at 5,120 text draws. */
export const MAX_MATRIX_WALK_VISIBLE_STREAMS = 640;
const MAX_MATRIX_WALK_VISIBLE_GLYPHS = MAX_MATRIX_WALK_VISIBLE_STREAMS * 8;
const MATRIX_PERSPECTIVE_FONT_MIN_PX = 1;
const MATRIX_PERSPECTIVE_FONT_MAX_PX = MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE;
const MATRIX_PERSPECTIVE_FONT_STEP_PX = 0.5;
const MATRIX_FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const MATRIX_PERSPECTIVE_FONTS = Array.from(
  {
    length:
      (MATRIX_PERSPECTIVE_FONT_MAX_PX - MATRIX_PERSPECTIVE_FONT_MIN_PX) /
        MATRIX_PERSPECTIVE_FONT_STEP_PX +
      1,
  },
  (_, index) =>
    `${MATRIX_PERSPECTIVE_FONT_MIN_PX + index * MATRIX_PERSPECTIVE_FONT_STEP_PX}px ${MATRIX_FONT_FAMILY}`,
);
/**
 * Walk modes may address a bounded set of whole-pixel font sizes. Populate
 * that table lazily so ordinary Flat/Forward/Reverse/Warp sessions pay no
 * startup or allocation cost for sizes they never render. Projection depth
 * and position remain continuous; only the browser font strings are bucketed
 * to keep font-cache and canvas pressure bounded.
 */
const MATRIX_WALK_FONTS: Array<string | undefined> = [];
interface MatrixWalkOccupancy {
  bins: Uint32Array;
  columns: number;
  rows: number;
  binSize: number;
  generation: number;
  selectedGlyphs: number;
}
const matrixWalkOccupancyByScene = new WeakMap<AtmosphereScene, MatrixWalkOccupancy>();

export interface AtmosphereParticle {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  size: number;
  phase: number;
  glyphOffset: number;
  glyphs: string;
  matrixLanguage: "english" | "japanese" | null;
  matrixToken: string | null;
  matrixWorkToken: string | null;
  /** Viewport Y where the current bounded Matrix Walk lifecycle began. */
  matrixLifecycleStartY: number;
  /** Normalized 0..1 travel/font lifecycle, independent from viewport Y. */
  matrixLifecycleProgress: number;
  /** Current lifecycle alpha; it fades to zero before the next spawn. */
  matrixLifecycleOpacity: number;
  /** Increments on respawn so deterministic positions do not repeat. */
  matrixLifecycleGeneration: number;
}

export interface AtmosphereScene {
  readonly kind: FallingEffectKind;
  readonly width: number;
  readonly height: number;
  readonly particles: AtmosphereParticle[];
}

export interface AtmosphereAnimationState {
  readonly enabled: boolean;
  readonly reducedMotion: boolean;
  readonly documentVisible: boolean;
  readonly windowFocused: boolean;
  readonly continueBackgroundAnimations: boolean;
}

export interface MatrixColorAnimationState {
  hue: number | null;
  lightness: number | null;
  lastUpdatedAt: number | null;
  lastSignalSampledAt: number | null;
}

export interface MatrixColorFrame {
  /** Uniform/fallback color and the color used by non-extra modes. */
  readonly color: string;
  /** Extra modes resolve one deterministic hue phase for each Matrix stream. */
  readonly perStream: boolean;
  readonly baseHue: number | null;
  readonly saturation: number | null;
  readonly lightness: number | null;
}

export interface AtmosphereProjectedPoint {
  x: number;
  y: number;
  /** Absolute particle/glyph scaling relative to this particle's intrinsic size. */
  scale: number;
  /** Normalized perspective ratio used by bounded connector decorations. */
  depthScale: number;
}

export function createMatrixColorAnimationState(): MatrixColorAnimationState {
  return { hue: null, lightness: null, lastUpdatedAt: null, lastSignalSampledAt: null };
}

export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function clampAtmosphereDpr(devicePixelRatio: number): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    return 1;
  }
  return Math.min(MAX_ATMOSPHERE_DPR, devicePixelRatio);
}

export function fitAtmosphereDpr(devicePixelRatio: number, width: number, height: number): number {
  const requestedDpr = clampAtmosphereDpr(devicePixelRatio);
  const cssPixels = Math.max(1, width) * Math.max(1, height);
  return Math.min(requestedDpr, Math.sqrt(MAX_ATMOSPHERE_CANVAS_PIXELS / cssPixels));
}

export function calculateAtmosphereParticleCount(
  kind: FallingEffectKind,
  width: number,
  height: number,
  requestedDensity = DEFAULT_FALLING_EFFECT_DENSITY,
): number {
  const safeWidth = Math.max(0, width);
  const safeHeight = Math.max(0, height);
  if (safeWidth === 0 || safeHeight === 0) {
    return 0;
  }

  const requested =
    kind === "matrix"
      ? Math.ceil(safeWidth / 24)
      : Math.ceil((safeWidth * safeHeight) / (kind === "rain" ? 10_000 : 14_000));
  const minimum = kind === "matrix" ? 12 : 24;
  const density = clampFallingEffectDensity(requestedDensity);
  return Math.min(
    MAX_ATMOSPHERE_PARTICLES_BY_KIND[kind],
    Math.max(minimum, Math.ceil(requested * density)),
  );
}

export function createAtmosphereScene(
  kind: FallingEffectKind,
  width: number,
  height: number,
  random: () => number,
  density = DEFAULT_FALLING_EFFECT_DENSITY,
  japaneseRatio = DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
  enriched2ch = false,
  workVocabulary: MatrixWorkVocabulary = { english: [], japanese: [] },
  motionMode: FallingEffectMatrixMotionMode = "flat",
  matrixWalkLifecyclePercent = DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  matrixCenterWindIntensity = DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
): AtmosphereScene {
  const count = calculateAtmosphereParticleCount(kind, width, height, density);
  const particles = Array.from({ length: count }, (_, index): AtmosphereParticle => {
    const matrixX = count > 0 ? ((index + 0.5) / count) * width : 0;

    if (kind === "rain") {
      return {
        x: random() * width,
        y: random() * height,
        velocityX: -18 - random() * 18,
        velocityY: 360 + random() * 260,
        size: 10 + random() * 16,
        phase: random() * Math.PI * 2,
        glyphOffset: 0,
        glyphs: "",
        matrixLanguage: null,
        matrixToken: null,
        matrixWorkToken: null,
        matrixLifecycleStartY: 0,
        matrixLifecycleProgress: 0,
        matrixLifecycleOpacity: 1,
        matrixLifecycleGeneration: 0,
      };
    }

    if (kind === "matrix") {
      const usesJapanese = random() < clampFallingEffectJapaneseRatio(japaneseRatio);
      const glyphs = usesJapanese
        ? enriched2ch
          ? MATRIX_2CH_ENRICHED_GLYPHS
          : MATRIX_JAPANESE_GLYPHS
        : MATRIX_ROMAN_GLYPHS;
      const matrixToken =
        usesJapanese && enriched2ch && random() < MATRIX_2CH_TOKEN_PROBABILITY
          ? (MATRIX_2CH_AA_TOKENS[Math.floor(random() * MATRIX_2CH_AA_TOKENS.length)] ?? null)
          : null;
      const workTokens = usesJapanese ? workVocabulary.japanese : workVocabulary.english;
      const matrixWorkToken =
        matrixToken === null && workTokens.length > 0 && random() < MATRIX_WORK_TOKEN_PROBABILITY
          ? (workTokens[Math.floor(random() * workTokens.length)] ?? null)
          : null;
      const walk = isMatrixWalkMotionMode(motionMode);
      const lifecycleTravel = resolveMatrixWalkLifecycleDistance(
        height,
        matrixWalkLifecyclePercent,
      );
      const lifecycleProgress = walk ? random() : 0;
      const lifecycleStartY = walk ? random() * Math.max(0, height) : 0;
      const walkX =
        count > 0 ? ((index + 0.15 + random() * 0.7) / count) * width : random() * width;
      const x = walk ? walkX : matrixX;
      return {
        x,
        y: walk
          ? resolveMatrixWalkViewportY(lifecycleStartY, lifecycleProgress, lifecycleTravel, height)
          : random() * height,
        velocityX: walk ? resolveMatrixCenterWindVelocity(x, width, matrixCenterWindIntensity) : 0,
        velocityY: 55 + random() * 85,
        size: 12 + Math.round(random() * 5),
        phase: random() * Math.PI * 2,
        glyphOffset: Math.floor(random() * glyphs.length),
        glyphs,
        matrixLanguage: usesJapanese ? "japanese" : "english",
        matrixToken,
        matrixWorkToken,
        matrixLifecycleStartY: lifecycleStartY,
        matrixLifecycleProgress: lifecycleProgress,
        matrixLifecycleOpacity: resolveMatrixLifecycleOpacity(lifecycleProgress),
        matrixLifecycleGeneration: 0,
      };
    }

    return {
      x: random() * width,
      y: random() * height,
      velocityX: (random() - 0.5) * 18,
      velocityY: 18 + random() * 34,
      size: 1.5 + random() * 3,
      phase: random() * Math.PI * 2,
      glyphOffset: 0,
      glyphs: "",
      matrixLanguage: null,
      matrixToken: null,
      matrixWorkToken: null,
      matrixLifecycleStartY: 0,
      matrixLifecycleProgress: 0,
      matrixLifecycleOpacity: 1,
      matrixLifecycleGeneration: 0,
    };
  });

  return {
    kind,
    width,
    height,
    particles,
  };
}

/**
 * Refresh the opt-in work terms without rebuilding or teleporting the falling
 * scene. A deterministic caller-provided random source keeps tests and visual
 * updates reproducible.
 */
export function applyMatrixWorkVocabularyInPlace(
  scene: AtmosphereScene,
  vocabulary: MatrixWorkVocabulary,
  random: () => number,
): void {
  if (scene.kind !== "matrix") return;
  for (const particle of scene.particles) {
    const terms = particle.matrixLanguage === "japanese" ? vocabulary.japanese : vocabulary.english;
    particle.matrixWorkToken =
      particle.matrixToken === null && terms.length > 0 && random() < MATRIX_WORK_TOKEN_PROBABILITY
        ? (terms[Math.floor(random() * terms.length)] ?? null)
        : null;
  }
}

export function clampFallingEffectSpeed(speed: number): number {
  if (!Number.isFinite(speed)) {
    return 1;
  }
  return Math.min(MAX_FALLING_EFFECT_SPEED, Math.max(MIN_FALLING_EFFECT_SPEED, speed));
}

export function clampMatrixColorCycleSpeed(speed: number): number {
  if (!Number.isFinite(speed)) {
    return DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED;
  }
  return Math.min(
    MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
    Math.max(MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED, speed),
  );
}

export function clampFallingEffectDensity(density: number): number {
  if (!Number.isFinite(density)) {
    return DEFAULT_FALLING_EFFECT_DENSITY;
  }
  return Math.min(MAX_FALLING_EFFECT_DENSITY, Math.max(MIN_FALLING_EFFECT_DENSITY, density));
}

export function clampFallingEffectJapaneseRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return DEFAULT_FALLING_EFFECT_JAPANESE_RATIO;
  }
  return Math.min(
    MAX_FALLING_EFFECT_JAPANESE_RATIO,
    Math.max(MIN_FALLING_EFFECT_JAPANESE_RATIO, ratio),
  );
}

export function clampMatrixWalkLifecyclePercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT;
  }
  return Math.min(
    MAX_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
    Math.max(MIN_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT, Math.round(percent)),
  );
}

export function clampMatrixCenterWindIntensity(intensity: number): number {
  if (!Number.isFinite(intensity)) {
    return DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY;
  }
  return Math.min(
    MAX_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
    Math.max(MIN_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY, Math.round(intensity)),
  );
}

export function isMatrixWalkMotionMode(mode: FallingEffectMatrixMotionMode): boolean {
  return mode === "walk-forward" || mode === "walk-reverse";
}

function resolveMatrixWalkLifecycleDistance(height: number, requestedPercent: number): number {
  return Math.max(
    1,
    Math.max(0, height) * (clampMatrixWalkLifecyclePercent(requestedPercent) / 100),
  );
}

/**
 * Walk lifecycle distance is independent from the spawn point. Wrapping only
 * the display coordinate lets a stream spawn anywhere in the viewport and
 * still travel the exact configured percentage before it fades and reconnects.
 */
function resolveMatrixWalkViewportY(
  lifecycleStartY: number,
  lifecycleProgress: number,
  lifecycleDistance: number,
  height: number,
): number {
  const safeHeight = Math.max(0, height);
  if (safeHeight === 0) return 0;
  const unwrappedY = lifecycleStartY + lifecycleProgress * lifecycleDistance;
  return ((unwrappedY % safeHeight) + safeHeight) % safeHeight;
}

function resolveMatrixCenterWindVelocity(
  x: number,
  width: number,
  requestedIntensity: number,
): number {
  const halfWidth = Math.max(1, width * 0.5);
  const normalizedDistanceFromCenter = Math.min(1, Math.max(-1, (x - width * 0.5) / halfWidth));
  return (
    normalizedDistanceFromCenter *
    (clampMatrixCenterWindIntensity(requestedIntensity) /
      MAX_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY) *
    MATRIX_CENTER_WIND_MAX_SPEED_PX_PER_SECOND
  );
}

function resolveMatrixLifecycleOpacity(progress: number): number {
  const fadeProgress = Math.min(
    1,
    Math.max(
      0,
      (progress - MATRIX_WALK_FADE_START_PROGRESS) / (1 - MATRIX_WALK_FADE_START_PROGRESS),
    ),
  );
  return 1 - fadeProgress * fadeProgress * (3 - fadeProgress * 2);
}

export function resolveMatrixWalkLifecycleOpacity(
  particle: AtmosphereParticle,
  motionMode: FallingEffectMatrixMotionMode,
): number {
  return isMatrixWalkMotionMode(motionMode)
    ? Math.min(1, Math.max(0, particle.matrixLifecycleOpacity))
    : 1;
}

function matrixLifecycleRandom(particle: AtmosphereParticle, salt: number): number {
  const value =
    Math.sin(
      (particle.phase + 1) * 12.9898 +
        (particle.matrixLifecycleGeneration + 1) * 78.233 +
        salt * 37.719,
    ) * 43_758.5453;
  return value - Math.floor(value);
}

function respawnMatrixWalkParticle(
  scene: AtmosphereScene,
  particle: AtmosphereParticle,
  particleIndex: number,
  windIntensity: number,
): void {
  particle.matrixLifecycleGeneration += 1;
  particle.matrixLifecycleProgress = 0;
  particle.matrixLifecycleOpacity = 1;
  const horizontalBandCount = Math.max(1, scene.particles.length);
  particle.x =
    ((particleIndex + 0.15 + matrixLifecycleRandom(particle, 1) * 0.7) / horizontalBandCount) *
    scene.width;
  particle.matrixLifecycleStartY = matrixLifecycleRandom(particle, 2) * Math.max(0, scene.height);
  particle.y = particle.matrixLifecycleStartY;
  particle.velocityX = resolveMatrixCenterWindVelocity(particle.x, scene.width, windIntensity);
  particle.glyphOffset =
    (particle.glyphOffset +
      17 +
      Math.floor(matrixLifecycleRandom(particle, 3) * particle.glyphs.length)) %
    particle.glyphs.length;
}

export function advanceAtmosphereSceneInPlace(
  scene: AtmosphereScene,
  elapsedSeconds: number,
  requestedSpeed: number,
  motionMode: FallingEffectMatrixMotionMode = "flat",
  matrixWalkLifecyclePercent = DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  matrixCenterWindIntensity = DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
): void {
  const deltaSeconds = Math.min(MAX_ATMOSPHERE_FRAME_DELTA_SECONDS, Math.max(0, elapsedSeconds));
  const speed = clampFallingEffectSpeed(requestedSpeed);

  for (const [particleIndex, particle] of scene.particles.entries()) {
    if (scene.kind === "matrix" && isMatrixWalkMotionMode(motionMode)) {
      const lifecycleDistance = resolveMatrixWalkLifecycleDistance(
        scene.height,
        matrixWalkLifecyclePercent,
      );
      const verticalDistance = particle.velocityY * deltaSeconds * speed;
      particle.matrixLifecycleProgress += verticalDistance / lifecycleDistance;
      if (particle.matrixLifecycleProgress >= 1) {
        respawnMatrixWalkParticle(scene, particle, particleIndex, matrixCenterWindIntensity);
        continue;
      }
      particle.y = resolveMatrixWalkViewportY(
        particle.matrixLifecycleStartY,
        particle.matrixLifecycleProgress,
        lifecycleDistance,
        scene.height,
      );
      particle.velocityX = resolveMatrixCenterWindVelocity(
        particle.x,
        scene.width,
        matrixCenterWindIntensity,
      );
      particle.x += particle.velocityX * deltaSeconds * speed;
      particle.matrixLifecycleOpacity = resolveMatrixLifecycleOpacity(
        particle.matrixLifecycleProgress,
      );
      continue;
    }

    if (scene.kind === "snow") {
      particle.x +=
        (particle.velocityX + Math.sin(particle.phase + particle.y * 0.01) * 8) *
        deltaSeconds *
        speed;
      particle.y += particle.velocityY * deltaSeconds * speed;
    } else {
      particle.x += particle.velocityX * deltaSeconds * speed;
      particle.y += particle.velocityY * deltaSeconds * speed;
    }

    const horizontalMargin = scene.kind === "rain" ? particle.size : particle.size * 2;
    if (particle.x < -horizontalMargin) {
      particle.x = scene.width + horizontalMargin;
    } else if (particle.x > scene.width + horizontalMargin) {
      particle.x = -horizontalMargin;
    }

    const verticalMargin = scene.kind === "matrix" ? particle.size * 8 : particle.size * 2;
    if (particle.y > scene.height + verticalMargin) {
      particle.y = -verticalMargin - ((particle.phase * 37) % Math.max(1, scene.height * 0.2));
      if (scene.kind === "matrix") {
        particle.glyphOffset = (particle.glyphOffset + 17) % particle.glyphs.length;
      }
    }
  }
}

export function resolveAtmosphereColor(
  kind: FallingEffectKind,
  configuredColor: AmbientColor,
  darkTheme: boolean,
): string {
  if (configuredColor !== "auto") {
    return configuredColor;
  }

  if (kind === "matrix") {
    return darkTheme ? "#4ade80" : "#15803d";
  }
  if (kind === "rain") {
    return darkTheme ? "#38bdf8" : "#0369a1";
  }
  return darkTheme ? "#f8fafc" : "#64748b";
}

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

function approach(current: number | null, target: number, maximumDelta: number): number {
  if (current === null) return target;
  return current + Math.min(maximumDelta, Math.max(-maximumDelta, target - current));
}

function normalizedAudioFeature(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function hslColor(hue: number, saturation: number, lightness: number): string {
  return `hsl(${wrapHue(hue).toFixed(1)} ${saturation.toFixed(1)}% ${lightness.toFixed(1)}%)`;
}

export function isMusicReactiveMatrixColorMode(mode: FallingEffectMatrixColorMode): boolean {
  return mode === "music-reactive" || mode === "music-reactive-extra";
}

/**
 * Resolves one Matrix frame palette from the atmosphere's existing clock.
 * Music modes accept only a fresh, bounded feature sample from an approved
 * direct/VLC analyser or an explicitly shared display-audio analyser. Absent,
 * stale, quiet, microphone, and direct iframe paths retain the fixed fallback.
 */
export function resolveMatrixAtmosphereColorFrame(
  mode: FallingEffectMatrixColorMode,
  configuredColor: AmbientColor,
  darkTheme: boolean,
  timestamp: number,
  signal: LocalMediaAudioSignal,
  state: MatrixColorAnimationState,
  requestedColorCycleSpeed = DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
): MatrixColorFrame {
  const fallback = resolveAtmosphereColor("matrix", configuredColor, darkTheme);
  const safeTimestamp = Number.isFinite(timestamp) ? Math.max(0, timestamp) : 0;
  const colorCycleSpeed = clampMatrixColorCycleSpeed(requestedColorCycleSpeed);
  if (mode === "fixed") {
    return {
      color: fallback,
      perStream: false,
      baseHue: null,
      saturation: null,
      lightness: null,
    };
  }

  if (mode === "rainbow" || mode === "rainbow-extra") {
    const hue = wrapHue((safeTimestamp / MATRIX_RAINBOW_CYCLE_MS) * 360 * colorCycleSpeed);
    const saturation = 88;
    const lightness = darkTheme ? 62 : 40;
    return {
      color: hslColor(hue, saturation, lightness),
      // Keep a requested 64x shimmer visibly fast, but distribute it across
      // the scene instead of synchronizing a large-area color transition.
      // The seeded stream phases preserve the same color distribution while
      // its hues move, rather than flashing the entire field in lockstep.
      perStream: mode === "rainbow-extra" || colorCycleSpeed > MATRIX_MAX_UNIFORM_RAINBOW_SPEED,
      baseHue: hue,
      saturation,
      lightness,
    };
  }

  const level = normalizedAudioFeature(signal.level);
  const bass = normalizedAudioFeature(signal.bass);
  const mid = normalizedAudioFeature(signal.mid);
  const treble = normalizedAudioFeature(signal.treble);
  const beat = normalizedAudioFeature(signal.beat);
  if (
    !hasFreshLocalMediaAudioSignal(signal, safeTimestamp) ||
    Math.max(level, bass, mid, treble) < MATRIX_MIN_AUDIO_REACTIVE_LEVEL
  ) {
    state.hue = null;
    state.lightness = null;
    state.lastUpdatedAt = safeTimestamp;
    state.lastSignalSampledAt = null;
    return {
      color: fallback,
      perStream: false,
      baseHue: null,
      saturation: null,
      lightness: null,
    };
  }

  const elapsedSeconds =
    state.lastUpdatedAt === null
      ? 0
      : Math.min(
          MAX_ATMOSPHERE_FRAME_DELTA_SECONDS,
          Math.max(0, (safeTimestamp - state.lastUpdatedAt) / 1_000),
        );
  const totalBandEnergy = bass + mid + treble;
  const spectralHue =
    totalBandEnergy <= 0 ? 110 : wrapHue((bass * 18 + mid * 150 + treble * 286) / totalBandEnergy);
  const cycleRate = Math.min(
    MATRIX_MAX_HUE_CHANGE_PER_SECOND,
    14 + level * 30 + bass * 18 + mid * 28 + treble * 42,
  );
  const continuousHueRate = Math.min(MATRIX_MAX_HUE_CHANGE_PER_SECOND, cycleRate * colorCycleSpeed);
  const newSignalSample =
    state.lastSignalSampledAt === null || signal.sampledAt > state.lastSignalSampledAt;
  const beatImpulse = newSignalSample ? beat * MATRIX_AUDIO_BEAT_HUE_IMPULSE_DEGREES : 0;
  state.hue =
    state.hue === null
      ? spectralHue
      : // The operator controls continuous color motion; one-shot beat energy
        // remains signal-defined so a fast shimmer cannot amplify beat jumps.
        wrapHue(state.hue + continuousHueRate * elapsedSeconds + beatImpulse);
  const targetLightness = (darkTheme ? 45 : 33) + level * 22 + bass * 4 + beat * 10;
  state.lightness = approach(
    state.lightness,
    targetLightness,
    MATRIX_MAX_LIGHTNESS_CHANGE_PER_SECOND * elapsedSeconds,
  );
  state.lastUpdatedAt = safeTimestamp;
  state.lastSignalSampledAt = signal.sampledAt;
  const saturation = Math.min(96, 70 + level * 15 + treble * 11);
  const lightness = state.lightness;
  return {
    color: hslColor(state.hue, saturation, lightness),
    perStream: mode === "music-reactive-extra",
    baseHue: state.hue,
    saturation,
    lightness,
  };
}

/** Backward-compatible single-color resolver for callers that do not draw streams. */
export function resolveMatrixAtmosphereColor(
  mode: FallingEffectMatrixColorMode,
  configuredColor: AmbientColor,
  darkTheme: boolean,
  timestamp: number,
  signal: LocalMediaAudioSignal,
  state: MatrixColorAnimationState,
  requestedColorCycleSpeed = DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
): string {
  return resolveMatrixAtmosphereColorFrame(
    mode,
    configuredColor,
    darkTheme,
    timestamp,
    signal,
    state,
    requestedColorCycleSpeed,
  ).color;
}

export function resolveMatrixStreamColor(
  frame: MatrixColorFrame,
  particle: AtmosphereParticle,
): string {
  if (
    !frame.perStream ||
    frame.baseHue === null ||
    frame.saturation === null ||
    frame.lightness === null
  ) {
    return frame.color;
  }
  // Scene generation seeds `phase` once, so each stream has a stable,
  // reproducible offset while the shared frame hue continues to advance.
  const phaseDegrees = (particle.phase / (Math.PI * 2)) * 360;
  return hslColor(frame.baseHue + phaseDegrees, frame.saturation, frame.lightness);
}

export function shouldShowAtmosphere(state: AtmosphereAnimationState): boolean {
  if (!state.enabled) return false;
  return state.continueBackgroundAnimations || (state.documentVisible && state.windowFocused);
}

export function shouldAnimateAtmosphere(state: AtmosphereAnimationState): boolean {
  if (state.reducedMotion) return false;
  return shouldShowAtmosphere(state);
}

export function resolveAtmosphereRenderOpacity(opacity: number, staticFrame: boolean): number {
  if (!staticFrame) return opacity;
  const normalized = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0;
  return normalized * REDUCED_MOTION_ATMOSPHERE_OPACITY_SCALE;
}

function resolveMatrixPerspectiveFont(size: number, scale: number): string {
  const scaledSize = Math.min(
    MATRIX_PERSPECTIVE_FONT_MAX_PX,
    Math.max(MATRIX_PERSPECTIVE_FONT_MIN_PX, size * scale),
  );
  const index = Math.round(
    (scaledSize - MATRIX_PERSPECTIVE_FONT_MIN_PX) / MATRIX_PERSPECTIVE_FONT_STEP_PX,
  );
  return MATRIX_PERSPECTIVE_FONTS[index]!;
}

function resolveMatrixBaseFontScale(requestedSize: number): number {
  const safeSize = Number.isFinite(requestedSize)
    ? requestedSize
    : DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE;
  const boundedSize = Math.min(
    MAX_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
    Math.max(MIN_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE, safeSize),
  );
  return boundedSize / DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE;
}

function clampMatrixWalkFontSize(requestedSize: number, fallbackSize: number): number {
  const safeSize = Number.isFinite(requestedSize) ? requestedSize : fallbackSize;
  return Math.min(
    MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
    Math.max(MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE, safeSize),
  );
}

function quantizeMatrixWalkFontSize(requestedSize: number, fallbackSize: number): number {
  const boundedSize = clampMatrixWalkFontSize(requestedSize, fallbackSize);
  return (
    Math.round(boundedSize / FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP) *
    FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP
  );
}

function isMatrixWalkWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

function estimateMatrixWalkTextAdvanceEm(text: string): number {
  let advance = 0;
  for (const character of Array.from(text)) {
    advance += isMatrixWalkWideCodePoint(character.codePointAt(0) ?? 0)
      ? MATRIX_WALK_WIDE_ADVANCE_EM
      : MATRIX_WALK_MONOSPACE_ADVANCE_EM;
  }
  return Math.max(0.72, advance);
}

function hasMultipleMatrixCodePoints(text: string): boolean {
  let foundFirst = false;
  for (const _character of text) {
    if (foundFirst) return true;
    foundFirst = true;
  }
  return false;
}

export interface MatrixWalkTextLayout {
  readonly fontSizePx: number;
  readonly widthPx: number;
}

/**
 * Keeps multi-character Walk heads readable without Canvas2D's horizontal
 * `maxWidth` squeeze. Long, privacy-filtered work tokens are fitted uniformly
 * in both dimensions to a bounded viewport fraction, so their natural
 * monospace proportions survive at every projected depth. Single glyphs keep
 * the existing Walk font size and occupancy width.
 */
export function resolveMatrixWalkTextLayout(
  text: string,
  requestedFontSizePx: number,
  sceneWidth: number,
): MatrixWalkTextLayout {
  const requestedFontSize = clampMatrixWalkFontSize(
    requestedFontSizePx,
    DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  );
  if (!hasMultipleMatrixCodePoints(text)) {
    return { fontSizePx: requestedFontSize, widthPx: requestedFontSize * 0.72 };
  }
  const advanceEm = estimateMatrixWalkTextAdvanceEm(text);
  const safeSceneWidth = Number.isFinite(sceneWidth) ? Math.max(1, sceneWidth) : 1;
  const availableWidth = safeSceneWidth * MATRIX_WALK_LABEL_VIEWPORT_WIDTH_RATIO;
  const fittedFontSize = Math.min(requestedFontSize, availableWidth / advanceEm);
  // The cached Canvas/GPU collector font is quantized to the public 1px
  // setting grid. Never round a fitted value back above the viewport budget.
  const fontSizePx =
    fittedFontSize < requestedFontSize
      ? Math.max(
          MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
          Math.floor(fittedFontSize / FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP) *
            FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP,
        )
      : requestedFontSize;
  return {
    fontSizePx,
    widthPx: Math.min(safeSceneWidth, fontSizePx * advanceEm),
  };
}

function resolveMatrixWalkTextCenterX(
  projectedX: number,
  textWidthPx: number,
  sceneWidth: number,
): number {
  const halfWidth = Math.min(sceneWidth, Math.max(0, textWidthPx)) * 0.5;
  return Math.min(sceneWidth - halfWidth, Math.max(halfWidth, projectedX));
}

function resolveMatrixWalkTargetFontSize(
  particle: AtmosphereParticle,
  motionMode: FallingEffectMatrixMotionMode,
  requestedWalkStartFontSize: number,
  requestedWalkEndFontSize: number,
): number {
  const lifecycleProgress = Math.min(1, Math.max(0, particle.matrixLifecycleProgress));
  const projectedDepth = motionMode === "walk-reverse" ? 1 - lifecycleProgress : lifecycleProgress;
  const walkStartFontSize = clampMatrixWalkFontSize(
    requestedWalkStartFontSize,
    DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  );
  const walkEndFontSize = clampMatrixWalkFontSize(
    requestedWalkEndFontSize,
    DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
  );
  return walkStartFontSize + projectedDepth * (walkEndFontSize - walkStartFontSize);
}

function beginMatrixWalkOccupancy(scene: AtmosphereScene): MatrixWalkOccupancy {
  const sceneArea = Math.max(1, scene.width * scene.height);
  const binSize = Math.max(
    MATRIX_WALK_MIN_OCCUPANCY_BIN_PX,
    Math.sqrt(sceneArea / MATRIX_WALK_MAX_OCCUPANCY_CELLS),
  );
  const columns = Math.max(1, Math.ceil(scene.width / binSize));
  const rows = Math.max(1, Math.ceil(scene.height / binSize));
  const requiredBins = columns * rows;
  let occupancy = matrixWalkOccupancyByScene.get(scene);
  if (
    occupancy === undefined ||
    occupancy.bins.length < requiredBins ||
    occupancy.columns !== columns ||
    occupancy.rows !== rows
  ) {
    occupancy = {
      bins: new Uint32Array(requiredBins),
      columns,
      rows,
      binSize,
      generation: 1,
      selectedGlyphs: 0,
    };
    matrixWalkOccupancyByScene.set(scene, occupancy);
    return occupancy;
  }

  occupancy.generation += 1;
  if (occupancy.generation >= 0xffff_fffe) {
    occupancy.bins.fill(0);
    occupancy.generation = 1;
  }
  occupancy.binSize = binSize;
  occupancy.selectedGlyphs = 0;
  return occupancy;
}

/**
 * Claims one currently projected glyph rectangle. The former one-dimensional
 * occupancy reserved an entire viewport-height stripe for every accepted head,
 * rejecting streams whose X ranges intersected even when their glyphs were
 * hundreds of pixels apart vertically. The reusable two-dimensional grid
 * rejects only actual projected rectangle contention, so high-density Walk
 * scenes can use the full viewport without allowing glyph overlap.
 */
function claimMatrixWalkProjectedBounds(
  occupancy: MatrixWalkOccupancy,
  sceneWidth: number,
  sceneHeight: number,
  projectedX: number,
  projectedY: number,
  fontSize: number,
  glyphWidthRatio: number,
): boolean {
  if (
    occupancy.selectedGlyphs >= MAX_MATRIX_WALK_VISIBLE_GLYPHS ||
    !Number.isFinite(projectedX) ||
    !Number.isFinite(projectedY) ||
    !Number.isFinite(fontSize) ||
    !Number.isFinite(glyphWidthRatio) ||
    sceneWidth <= 0 ||
    sceneHeight <= 0
  ) {
    return false;
  }
  const glyphGap = Math.min(MATRIX_WALK_GLYPH_GAP_PX * 0.5, Math.max(0.25, fontSize * 0.05));
  const halfWidth =
    (Math.min(
      sceneWidth,
      Math.max(MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE, fontSize) *
        Math.max(0.72, glyphWidthRatio),
    ) +
      glyphGap) *
    0.5;
  const halfHeight =
    (Math.max(MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE, fontSize) + glyphGap) * 0.5;
  const left = Math.max(0, projectedX - halfWidth);
  const right = Math.min(sceneWidth, projectedX + halfWidth);
  const top = Math.max(0, projectedY - halfHeight);
  const bottom = Math.min(sceneHeight, projectedY + halfHeight);
  if (
    right <= 0 ||
    left >= sceneWidth ||
    bottom <= 0 ||
    top >= sceneHeight ||
    right <= left ||
    bottom <= top
  ) {
    return false;
  }

  const firstColumn = Math.max(0, Math.floor(left / occupancy.binSize));
  const lastColumn = Math.min(occupancy.columns - 1, Math.ceil(right / occupancy.binSize) - 1);
  const firstRow = Math.max(0, Math.floor(top / occupancy.binSize));
  const lastRow = Math.min(occupancy.rows - 1, Math.ceil(bottom / occupancy.binSize) - 1);
  for (let row = firstRow; row <= lastRow; row += 1) {
    const rowOffset = row * occupancy.columns;
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      if (occupancy.bins[rowOffset + column] === occupancy.generation) {
        return false;
      }
    }
  }
  for (let row = firstRow; row <= lastRow; row += 1) {
    const rowOffset = row * occupancy.columns;
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      occupancy.bins[rowOffset + column] = occupancy.generation;
    }
  }
  occupancy.selectedGlyphs += 1;
  return true;
}

function resolveMatrixWalkFont(size: number, scale: number): string {
  const fontSize = quantizeMatrixWalkFontSize(
    size * scale,
    DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  );
  const index = Math.round(
    (fontSize - MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE) /
      FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP,
  );
  return (MATRIX_WALK_FONTS[index] ??= `${fontSize.toFixed(0)}px ${MATRIX_FONT_FAMILY}`);
}

function resolveMatrixWalkFontFromSize(size: number): string {
  return resolveMatrixWalkFont(size, 1);
}

/**
 * Keep Matrix's generated outer columns on the viewport edges while retaining
 * the reviewed center convergence/expansion cue for interior columns.
 *
 * Matrix columns are generated at half-column insets rather than x=0/width.
 * Applying the old center-linear perspective scale directly to those bounded
 * coordinates created triangular empty bands at the far top/bottom plane. We
 * first normalize that generated column domain onto [-1, 1], then blend the
 * perspective scale back to 1 at the edges. The derivative remains positive
 * for the reviewed 0.58..1.30 range, so columns keep their order and density
 * changes smoothly without extra particles, tiling, or draw calls.
 */
function resolveDirectionalPerspectiveX(
  scene: AtmosphereScene,
  sourceX: number,
  perspectiveScale: number,
): number {
  const centerX = scene.width * 0.5;
  if (scene.kind !== "matrix" || scene.width <= 0 || scene.particles.length < 2) {
    return centerX + (sourceX - centerX) * perspectiveScale;
  }

  const outerColumnInset = scene.width / (scene.particles.length * 2);
  const generatedColumnSpan = scene.width - outerColumnInset * 2;
  if (generatedColumnSpan <= 0) {
    return centerX;
  }

  const rawNormalizedColumnX = ((sourceX - outerColumnInset) / generatedColumnSpan) * 2 - 1;
  const normalizedColumnX = Math.min(1, Math.max(-1, rawNormalizedColumnX));
  const edgePreservingScale =
    perspectiveScale + (1 - perspectiveScale) * Math.abs(normalizedColumnX);
  const overflowX = (rawNormalizedColumnX - normalizedColumnX) * (generatedColumnSpan * 0.5);
  return centerX + normalizedColumnX * centerX * edgePreservingScale + overflowX;
}

/**
 * Applies the reviewed forward/Warp geometry to every atmosphere kind. The
 * output object is caller-owned so the draw loop performs no per-particle
 * allocation. Reverse mirrors the depth ramp while preserving falling motion.
 * Walk modes retain that geometry but expand visual size continuously across
 * the configured endpoints before normal canvas clipping and recycling. Only
 * Matrix font strings are quantized later, at the glyph-cache boundary.
 */
export function resolveAtmosphereProjectedPointInPlace(
  output: AtmosphereProjectedPoint,
  scene: AtmosphereScene,
  particle: AtmosphereParticle,
  sourceX: number,
  sourceY: number,
  motionMode: FallingEffectMatrixMotionMode,
  requestedWalkStartFontSize = DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  requestedWalkEndFontSize = DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
): void {
  const safeX = Number.isFinite(sourceX) ? sourceX : 0;
  const safeY = Number.isFinite(sourceY) ? sourceY : 0;
  if (motionMode === "flat") {
    output.x = safeX;
    output.y = safeY;
    output.scale = 1;
    output.depthScale = 1;
    return;
  }

  const verticalMargin = Math.max(
    1,
    scene.kind === "matrix" ? particle.size * 8 : particle.size * 2,
  );
  const depth = Math.min(
    1,
    Math.max(0, (safeY + verticalMargin) / Math.max(1, scene.height + verticalMargin * 2)),
  );

  if (
    motionMode === "forward" ||
    motionMode === "reverse" ||
    motionMode === "walk-forward" ||
    motionMode === "walk-reverse"
  ) {
    const reverse = motionMode === "reverse" || motionMode === "walk-reverse";
    const walk = motionMode === "walk-forward" || motionMode === "walk-reverse";
    const geometryDepth = walk
      ? scene.kind === "matrix"
        ? Math.min(1, Math.max(0, particle.matrixLifecycleProgress))
        : Math.min(1, Math.max(0, safeY / Math.max(1, scene.height)))
      : depth;
    const projectedDepth = reverse ? 1 - geometryDepth : geometryDepth;
    const perspectiveScale = 0.58 + projectedDepth * 0.72;
    output.x = resolveDirectionalPerspectiveX(scene, safeX, perspectiveScale);
    output.y = safeY;
    if (walk) {
      const walkStartFontSize = clampMatrixWalkFontSize(
        requestedWalkStartFontSize,
        DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
      );
      const walkEndFontSize = clampMatrixWalkFontSize(
        requestedWalkEndFontSize,
        DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
      );
      const targetFontSize =
        walkStartFontSize + projectedDepth * (walkEndFontSize - walkStartFontSize);
      output.scale =
        targetFontSize / Math.max(MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE, particle.size);
      output.depthScale = targetFontSize / walkStartFontSize;
    } else {
      output.scale = 0.72 + projectedDepth * 0.55;
      output.depthScale = output.scale;
    }
    return;
  }

  const centerX = scene.width * 0.5;
  const centerY = scene.height * 0.5;
  const angle =
    (safeX / Math.max(1, scene.width)) * Math.PI * 2 -
    Math.PI * 0.5 +
    Math.sin(particle.phase) * 0.08;
  const radius = Math.max(scene.width, scene.height) * 0.74 * depth * depth;
  output.x = centerX + Math.cos(angle) * radius;
  output.y = centerY + Math.sin(angle) * radius;
  output.scale = 0.4 + depth * 0.95;
  output.depthScale = output.scale;
}

export function drawAtmosphereScene(
  context: CanvasRenderingContext2D,
  scene: AtmosphereScene,
  color: string,
  opacity: number,
  matrixColorFrame?: MatrixColorFrame,
  motionMode: FallingEffectMatrixMotionMode = "flat",
  walkStartFontSize = DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  walkEndFontSize = DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
  matrixBaseFontSize = DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
): void {
  context.clearRect(0, 0, scene.width, scene.height);
  const normalizedOpacity = Math.min(1, Math.max(0, opacity));
  if (normalizedOpacity === 0) {
    return;
  }

  context.save();
  context.fillStyle = color;
  context.strokeStyle = color;
  const matrixBaseFontScale = resolveMatrixBaseFontScale(matrixBaseFontSize);
  const projectedFrom: AtmosphereProjectedPoint = { x: 0, y: 0, scale: 1, depthScale: 1 };
  const projectedTo: AtmosphereProjectedPoint = { x: 0, y: 0, scale: 1, depthScale: 1 };

  if (scene.kind === "snow") {
    context.globalAlpha = normalizedOpacity;
    for (const particle of scene.particles) {
      resolveAtmosphereProjectedPointInPlace(
        projectedFrom,
        scene,
        particle,
        particle.x,
        particle.y,
        motionMode,
        walkStartFontSize,
        walkEndFontSize,
      );
      context.beginPath();
      context.arc(
        projectedFrom.x,
        projectedFrom.y,
        particle.size * projectedFrom.scale,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  } else if (scene.kind === "rain") {
    context.globalAlpha = normalizedOpacity;
    context.lineCap = "round";
    for (const particle of scene.particles) {
      resolveAtmosphereProjectedPointInPlace(
        projectedFrom,
        scene,
        particle,
        particle.x,
        particle.y,
        motionMode,
        walkStartFontSize,
        walkEndFontSize,
      );
      resolveAtmosphereProjectedPointInPlace(
        projectedTo,
        scene,
        particle,
        particle.x + particle.velocityX * 0.025,
        particle.y + particle.size,
        motionMode,
        walkStartFontSize,
        walkEndFontSize,
      );
      context.lineWidth = Math.max(
        0.75,
        (particle.size / 12) * (projectedFrom.scale + projectedTo.scale) * 0.5,
      );
      context.beginPath();
      context.moveTo(projectedFrom.x, projectedFrom.y);
      context.lineTo(projectedTo.x, projectedTo.y);
      context.stroke();
    }
  } else {
    context.textAlign = "center";
    context.textBaseline = "middle";
    const walk = isMatrixWalkMotionMode(motionMode);
    const walkOccupancy = walk ? beginMatrixWalkOccupancy(scene) : null;
    if (walk && walkOccupancy !== null) {
      // Reserve heads across the entire source pool before tails. This keeps
      // the high-density field populated with independent falling streams;
      // older/fainter trail glyphs fill only the remaining 2D space.
      for (let pass = 0; pass < 2; pass += 1) {
        for (const particle of scene.particles) {
          const lifecycleOpacity = resolveMatrixWalkLifecycleOpacity(particle, motionMode);
          if (lifecycleOpacity <= 0) continue;
          const walkFontSize = quantizeMatrixWalkFontSize(
            resolveMatrixWalkTargetFontSize(
              particle,
              motionMode,
              walkStartFontSize,
              walkEndFontSize,
            ),
            DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
          );
          const trailSpacing = Math.max(
            particle.size,
            walkFontSize * MATRIX_WALK_TRAIL_LINE_HEIGHT,
          );
          context.fillStyle =
            matrixColorFrame === undefined
              ? color
              : resolveMatrixStreamColor(matrixColorFrame, particle);
          const firstTrailIndex = pass === 0 ? 0 : 7;
          const lastTrailIndex = pass === 0 ? 0 : 1;
          for (let trailIndex = firstTrailIndex; trailIndex >= lastTrailIndex; trailIndex -= 1) {
            const sourceY = particle.y - trailIndex * trailSpacing;
            resolveAtmosphereProjectedPointInPlace(
              projectedFrom,
              scene,
              particle,
              particle.x,
              sourceY,
              motionMode,
              walkStartFontSize,
              walkEndFontSize,
            );
            const glyphIndex =
              (particle.glyphOffset +
                trailIndex * 7 +
                Math.floor(Math.max(0, particle.y) / particle.size)) %
              particle.glyphs.length;
            const glyph =
              (trailIndex === 0 ? (particle.matrixToken ?? particle.matrixWorkToken) : null) ??
              particle.glyphs[glyphIndex] ??
              "0";
            const textLayout = resolveMatrixWalkTextLayout(glyph, walkFontSize, scene.width);
            const textCenterX = resolveMatrixWalkTextCenterX(
              projectedFrom.x,
              textLayout.widthPx,
              scene.width,
            );
            if (
              !claimMatrixWalkProjectedBounds(
                walkOccupancy,
                scene.width,
                scene.height,
                textCenterX,
                projectedFrom.y,
                textLayout.fontSizePx,
                textLayout.widthPx / textLayout.fontSizePx,
              )
            ) {
              continue;
            }
            context.font = resolveMatrixWalkFontFromSize(textLayout.fontSizePx);
            context.globalAlpha =
              (trailIndex === 0
                ? normalizedOpacity
                : normalizedOpacity * (1 - trailIndex / 8) * 0.7) * lifecycleOpacity;
            context.fillText(glyph, textCenterX, projectedFrom.y);
          }
        }
      }
    } else {
      for (const particle of scene.particles) {
        const lifecycleOpacity = resolveMatrixWalkLifecycleOpacity(particle, motionMode);
        if (lifecycleOpacity <= 0) continue;
        context.fillStyle =
          matrixColorFrame === undefined
            ? color
            : resolveMatrixStreamColor(matrixColorFrame, particle);
        if (motionMode === "flat") {
          context.font = resolveMatrixPerspectiveFont(particle.size, matrixBaseFontScale);
        }
        const trailSpacing = particle.size;
        for (let trailIndex = 7; trailIndex >= 0; trailIndex -= 1) {
          const sourceY = particle.y - trailIndex * trailSpacing;
          resolveAtmosphereProjectedPointInPlace(
            projectedFrom,
            scene,
            particle,
            particle.x,
            sourceY,
            motionMode,
            walkStartFontSize,
            walkEndFontSize,
          );
          if (motionMode !== "flat") {
            context.font = resolveMatrixPerspectiveFont(
              particle.size,
              projectedFrom.scale * matrixBaseFontScale,
            );
          }
          const glyphIndex =
            (particle.glyphOffset +
              trailIndex * 7 +
              Math.floor(Math.max(0, particle.y) / particle.size)) %
            particle.glyphs.length;
          context.globalAlpha =
            (trailIndex === 0
              ? normalizedOpacity
              : normalizedOpacity * (1 - trailIndex / 8) * 0.7) * lifecycleOpacity;
          context.fillText(
            // An AA token is one intact glyph at the head of a column, not the
            // repeated glyph for every tail position. Repeating it made a single
            // cat appear as a distracting vertical stack and obscured the trail.
            (trailIndex === 0 ? (particle.matrixToken ?? particle.matrixWorkToken) : null) ??
              particle.glyphs[glyphIndex] ??
              "0",
            projectedFrom.x,
            projectedFrom.y,
            MAX_MATRIX_TOKEN_WIDTH_PX * projectedFrom.scale,
          );
        }
      }
    }
  }

  context.restore();
}
