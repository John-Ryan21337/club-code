import {
  DEFAULT_FALLING_EFFECT_DENSITY,
  DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
  MAX_FALLING_EFFECT_DENSITY,
  MAX_FALLING_EFFECT_SPEED,
  MIN_FALLING_EFFECT_DENSITY,
  MIN_FALLING_EFFECT_JAPANESE_RATIO,
  MAX_FALLING_EFFECT_JAPANESE_RATIO,
  MIN_FALLING_EFFECT_SPEED,
  type AmbientColor,
  type FallingEffectKind,
  type FallingEffectMatrixColorMode,
} from "@cafecode/contracts/settings";
import { hasFreshLocalMediaAudioSignal, type LocalMediaAudioSignal } from "./localMediaAudioSignal";
import type { MatrixWorkVocabulary } from "./matrixWorkVocabulary";

export const MAX_ATMOSPHERE_DPR = 2;
/** Keep the backing canvas bounded even on an ultra-wide high-DPI display. */
export const MAX_ATMOSPHERE_CANVAS_PIXELS = 8_388_608;
export const MAX_ATMOSPHERE_FRAME_DELTA_SECONDS = 0.1;
export const MATRIX_RAINBOW_CYCLE_MS = 18_000;
export const MATRIX_MIN_AUDIO_REACTIVE_LEVEL = 0.015;
const MATRIX_MAX_HUE_CHANGE_PER_SECOND = 110;
const MATRIX_MAX_LIGHTNESS_CHANGE_PER_SECOND = 24;

/** Hard per-scene limits: snow 320, rain 440, and Matrix 160 columns. */
export const MAX_ATMOSPHERE_PARTICLES_BY_KIND = {
  snow: 320,
  rain: 440,
  matrix: 160,
} as const satisfies Record<FallingEffectKind, number>;

/** Reviewed decorative Roman glyph pool; it intentionally contains no words or phrases. */
export const MATRIX_ROMAN_GLYPHS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@#$%&*+-=<>[]{}";
/** Reviewed decorative kana and code/AI-context kanji; glyphs are never composed into phrases. */
export const MATRIX_JAPANESE_GLYPHS =
  "アイウエオカキクケコサシスセソタチツテトナニヌネノマミムメモヤユヨラリルレロワヲン電脳機械知能学習推論生成言語符号解析演算回路未来創造対話探索深層神経仮想現実夢夜光影零無限";
/** Optional, tasteful Japanese net/board visual-culture glyphs, without hateful or sexual content. */
export const MATRIX_ENRICHED_JAPANESE_GLYPHS = `${MATRIX_JAPANESE_GLYPHS}ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾅﾆﾇﾈﾉﾏﾐﾑﾒﾓﾗﾘﾙﾚﾛﾜﾝｰｯ､｡･「」()ｗ草乙神ｷﾀ`;
/** Rare, intact, reviewed decorative AA tokens; they are never split into pseudo-phrases. */
export const MATRIX_ENRICHED_JAPANESE_TOKENS = [
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
const MATRIX_ENRICHED_TOKEN_PROBABILITY = 0.08;

export interface AtmosphereParticle {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  size: number;
  phase: number;
  glyphOffset: number;
  glyphs: string;
  matrixToken: string | null;
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

/** One bounded level from an approved, direct local-media analyser. */
export interface MatrixAudioSignal {
  readonly active: boolean;
  readonly level: number;
  readonly sampledAt: number;
}

export interface MatrixColorAnimationState {
  hue: number | null;
  lightness: number | null;
  lastUpdatedAt: number | null;
}

export function createMatrixColorAnimationState(): MatrixColorAnimationState {
  return { hue: null, lightness: null, lastUpdatedAt: null };
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
  matrixEnriched = false,
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
        matrixToken: null,
      };
    }

    if (kind === "matrix") {
      const usesJapanese = random() < clampFallingEffectJapaneseRatio(japaneseRatio);
      const glyphs = usesJapanese
        ? matrixEnriched
          ? MATRIX_ENRICHED_JAPANESE_GLYPHS
          : MATRIX_JAPANESE_GLYPHS
        : MATRIX_ROMAN_GLYPHS;
      const matrixToken =
        usesJapanese && matrixEnriched && random() < MATRIX_ENRICHED_TOKEN_PROBABILITY
          ? (MATRIX_ENRICHED_JAPANESE_TOKENS[
              Math.floor(random() * MATRIX_ENRICHED_JAPANESE_TOKENS.length)
            ] ?? null)
          : null;
      return {
        x: matrixX,
        y: random() * height,
        velocityX: 0,
        velocityY: 55 + random() * 85,
        size: 12 + Math.round(random() * 5),
        phase: random() * Math.PI * 2,
        glyphOffset: Math.floor(random() * glyphs.length),
        glyphs,
        matrixToken,
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
      matrixToken: null,
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

export function advanceAtmosphereSceneInPlace(
  scene: AtmosphereScene,
  elapsedSeconds: number,
  requestedSpeed: number,
): void {
  const deltaSeconds = Math.min(MAX_ATMOSPHERE_FRAME_DELTA_SECONDS, Math.max(0, elapsedSeconds));
  const speed = clampFallingEffectSpeed(requestedSpeed);

  for (const particle of scene.particles) {
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

function shortestHueDelta(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

function clampColorTransition(
  current: number | null,
  target: number,
  maximumDelta: number,
): number {
  if (current === null) return target;
  return current + Math.min(maximumDelta, Math.max(-maximumDelta, target - current));
}

/**
 * Resolves Matrix-only palettes without allocating frame data. Music mode is
 * intentionally driven only by a fresh approved local-media analyser sample;
 * stale, absent, or quiet samples retain the configured fixed/auto color.
 */
export function resolveMatrixAtmosphereColor(
  mode: FallingEffectMatrixColorMode,
  configuredColor: AmbientColor,
  darkTheme: boolean,
  timestamp: number,
  signal: MatrixAudioSignal,
  state: MatrixColorAnimationState,
): string {
  const fallback = resolveAtmosphereColor("matrix", configuredColor, darkTheme);
  const safeTimestamp = Number.isFinite(timestamp) ? Math.max(0, timestamp) : 0;
  if (mode === "fixed") return fallback;

  if (mode === "rainbow") {
    const hue = wrapHue((safeTimestamp / MATRIX_RAINBOW_CYCLE_MS) * 360);
    return `hsl(${hue.toFixed(1)} 88% ${darkTheme ? "62" : "40"}%)`;
  }

  const fresh =
    signal.active &&
    Number.isFinite(signal.sampledAt) &&
    safeTimestamp >= signal.sampledAt &&
    safeTimestamp - signal.sampledAt <= 1_500;
  const level = Number.isFinite(signal.level) ? Math.min(1, Math.max(0, signal.level)) : 0;
  if (!fresh || level < MATRIX_MIN_AUDIO_REACTIVE_LEVEL) {
    state.hue = null;
    state.lightness = null;
    state.lastUpdatedAt = safeTimestamp;
    return fallback;
  }

  const elapsedSeconds =
    state.lastUpdatedAt === null
      ? 0
      : Math.min(
          MAX_ATMOSPHERE_FRAME_DELTA_SECONDS,
          Math.max(0, (safeTimestamp - state.lastUpdatedAt) / 1_000),
        );
  const targetHue = wrapHue(110 + level * 230 + Math.sin(safeTimestamp / 430) * level * 18);
  const targetLightness = (darkTheme ? 47 : 35) + level * 30;
  const maximumHueDelta = MATRIX_MAX_HUE_CHANGE_PER_SECOND * elapsedSeconds;
  const maximumLightnessDelta = MATRIX_MAX_LIGHTNESS_CHANGE_PER_SECOND * elapsedSeconds;
  const currentHue = state.hue;
  state.hue =
    currentHue === null
      ? targetHue
      : wrapHue(
          currentHue +
            clampColorTransition(0, shortestHueDelta(currentHue, targetHue), maximumHueDelta),
        );
  state.lightness = clampColorTransition(state.lightness, targetLightness, maximumLightnessDelta);
  state.lastUpdatedAt = safeTimestamp;
  return `hsl(${state.hue.toFixed(1)} ${(68 + level * 25).toFixed(1)}% ${state.lightness.toFixed(1)}%)`;
}

export function shouldAnimateAtmosphere(state: AtmosphereAnimationState): boolean {
  if (!state.enabled || state.reducedMotion) {
    return false;
  }
  return state.continueBackgroundAnimations || (state.documentVisible && state.windowFocused);
}

export function drawAtmosphereScene(
  context: CanvasRenderingContext2D,
  scene: AtmosphereScene,
  color: string,
  opacity: number,
  matrixColorFrame?: MatrixColorFrame,
): void {
  context.clearRect(0, 0, scene.width, scene.height);
  const normalizedOpacity = Math.min(1, Math.max(0, opacity));
  if (normalizedOpacity === 0) {
    return;
  }

  context.save();
  context.fillStyle = color;
  context.strokeStyle = color;

  if (scene.kind === "snow") {
    context.globalAlpha = normalizedOpacity;
    for (const particle of scene.particles) {
      context.beginPath();
      context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      context.fill();
    }
  } else if (scene.kind === "rain") {
    context.globalAlpha = normalizedOpacity;
    context.lineCap = "round";
    for (const particle of scene.particles) {
      context.lineWidth = Math.max(0.75, particle.size / 12);
      context.beginPath();
      context.moveTo(particle.x, particle.y);
      context.lineTo(particle.x + particle.velocityX * 0.025, particle.y + particle.size);
      context.stroke();
    }
  } else {
    context.textAlign = "center";
    context.textBaseline = "middle";
    for (const particle of scene.particles) {
      const fontSize = Math.min(MAX_MATRIX_TOKEN_FONT_SIZE, particle.size);
      context.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      for (let trailIndex = 7; trailIndex >= 0; trailIndex -= 1) {
        const glyphIndex =
          (particle.glyphOffset +
            trailIndex * 7 +
            Math.floor(Math.max(0, particle.y) / particle.size)) %
          particle.glyphs.length;
        context.globalAlpha =
          trailIndex === 0 ? normalizedOpacity : normalizedOpacity * (1 - trailIndex / 8) * 0.7;
        context.fillText(
          particle.matrixToken ?? particle.glyphs[glyphIndex] ?? "0",
          particle.x,
          particle.y - trailIndex * particle.size,
          MAX_MATRIX_TOKEN_WIDTH_PX,
        );
      }
    }
  }

  context.restore();
}
