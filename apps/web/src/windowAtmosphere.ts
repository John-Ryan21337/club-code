import {
  MAX_FALLING_EFFECT_SPEED,
  MIN_FALLING_EFFECT_SPEED,
  type AmbientColor,
  type FallingEffectKind,
} from "@cafecode/contracts/settings";

export const MAX_ATMOSPHERE_DPR = 2;
/** Keep the backing canvas bounded even on an ultra-wide high-DPI display. */
export const MAX_ATMOSPHERE_CANVAS_PIXELS = 8_388_608;
export const MAX_ATMOSPHERE_FRAME_DELTA_SECONDS = 0.1;

const MAX_PARTICLES_BY_KIND = {
  snow: 160,
  rain: 220,
  matrix: 80,
} as const satisfies Record<FallingEffectKind, number>;

const MATRIX_GLYPHS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@#$%&*+-=<>[]{}";

export interface AtmosphereParticle {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  size: number;
  phase: number;
  glyphOffset: number;
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
  return Math.min(MAX_PARTICLES_BY_KIND[kind], Math.max(minimum, requested));
}

export function createAtmosphereScene(
  kind: FallingEffectKind,
  width: number,
  height: number,
  random: () => number,
): AtmosphereScene {
  const count = calculateAtmosphereParticleCount(kind, width, height);
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
      };
    }

    if (kind === "matrix") {
      return {
        x: matrixX,
        y: random() * height,
        velocityX: 0,
        velocityY: 55 + random() * 85,
        size: 12 + Math.round(random() * 5),
        phase: random() * Math.PI * 2,
        glyphOffset: Math.floor(random() * MATRIX_GLYPHS.length),
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
    };
  });

  return {
    kind,
    width,
    height,
    particles,
  };
}

export function clampFallingEffectSpeed(speed: number): number {
  if (!Number.isFinite(speed)) {
    return 1;
  }
  return Math.min(MAX_FALLING_EFFECT_SPEED, Math.max(MIN_FALLING_EFFECT_SPEED, speed));
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
        particle.glyphOffset = (particle.glyphOffset + 17) % MATRIX_GLYPHS.length;
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
      context.font = `${particle.size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      for (let trailIndex = 7; trailIndex >= 0; trailIndex -= 1) {
        const glyphIndex =
          (particle.glyphOffset +
            trailIndex * 7 +
            Math.floor(Math.max(0, particle.y) / particle.size)) %
          MATRIX_GLYPHS.length;
        context.globalAlpha =
          trailIndex === 0 ? normalizedOpacity : normalizedOpacity * (1 - trailIndex / 8) * 0.7;
        context.fillText(
          MATRIX_GLYPHS[glyphIndex] ?? "0",
          particle.x,
          particle.y - trailIndex * particle.size,
        );
      }
    }
  }

  context.restore();
}
