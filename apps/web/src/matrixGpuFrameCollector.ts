import type { FallingEffectMatrixMotionMode } from "@cafecode/contracts/settings";

import type { MatrixGpuColor, MatrixGpuFrame, MatrixGpuGlyph } from "./matrixWebGlRenderer";
import {
  drawAtmosphereScene,
  type AtmosphereScene,
  type MatrixColorFrame,
} from "./windowAtmosphere";

const DEFAULT_MAX_GPU_GLYPHS = 8_192;
const FONT_SIZE_PATTERN = /(?:^|\s)(\d+(?:\.\d+)?)px(?:\s|$)/u;
const HSL_PATTERN = /^hsl\(\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*\)$/iu;

interface MutableMatrixGpuGlyph {
  glyph: string | number;
  x: number;
  y: number;
  fontSizePx: number;
  scale: number;
  opacity: number;
  color: MatrixGpuColor;
  maxWidthPx?: number;
}

interface CollectorState {
  fillStyle: string;
  font: string;
  globalAlpha: number;
}

export interface CollectMatrixGpuFrameOptions {
  readonly scene: AtmosphereScene;
  readonly color: string;
  readonly opacity: number;
  readonly matrixColorFrame: MatrixColorFrame | undefined;
  readonly motionMode: FallingEffectMatrixMotionMode;
  readonly walkStartFontSize: number;
  readonly walkEndFontSize: number;
  readonly matrixBaseFontSize: number;
  readonly devicePixelRatio: number;
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function parseHexColor(color: string): MatrixGpuColor | null {
  const value = color.trim().toLowerCase();
  if (!/^#[0-9a-f]{3,8}$/u.test(value)) return null;
  const expanded =
    value.length === 4 || value.length === 5
      ? `#${Array.from(value.slice(1))
          .map((character) => character.repeat(2))
          .join("")}`
      : value;
  if (expanded.length !== 7 && expanded.length !== 9) return null;
  return {
    red: Number.parseInt(expanded.slice(1, 3), 16) / 255,
    green: Number.parseInt(expanded.slice(3, 5), 16) / 255,
    blue: Number.parseInt(expanded.slice(5, 7), 16) / 255,
    alpha: expanded.length === 9 ? Number.parseInt(expanded.slice(7, 9), 16) / 255 : 1,
  };
}

function hueToRgbChannel(p: number, q: number, requestedT: number): number {
  let t = requestedT;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function parseHslColor(color: string): MatrixGpuColor | null {
  const match = HSL_PATTERN.exec(color.trim());
  if (!match) return null;
  const hue = (((Number(match[1]) % 360) + 360) % 360) / 360;
  const saturation = clamp01(Number(match[2]) / 100);
  const lightness = clamp01(Number(match[3]) / 100);
  if (saturation === 0) {
    return { red: lightness, green: lightness, blue: lightness, alpha: 1 };
  }
  const q =
    lightness < 0.5
      ? lightness * (1 + saturation)
      : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return {
    red: hueToRgbChannel(p, q, hue + 1 / 3),
    green: hueToRgbChannel(p, q, hue),
    blue: hueToRgbChannel(p, q, hue - 1 / 3),
    alpha: 1,
  };
}

export function parseMatrixGpuColor(color: string): MatrixGpuColor {
  return (
    parseHexColor(color) ??
    parseHslColor(color) ?? {
      red: 0,
      green: 1,
      blue: 0,
      alpha: 1,
    }
  );
}

/**
 * Reuses the exact Canvas2D geometry/occupancy traversal while intercepting
 * Matrix text cells before rasterization. The resulting bounded frame is fed
 * to the WebGL2 glyph-atlas renderer, so glyph shaping/raster/composition move
 * to one instanced GPU draw without duplicating the motion model.
 */
export class MatrixGpuFrameCollector {
  readonly #context: CanvasRenderingContext2D;
  readonly #glyphs: MutableMatrixGpuGlyph[] = [];
  readonly #pool: MutableMatrixGpuGlyph[] = [];
  readonly #stateStack: CollectorState[] = [];
  readonly #colorCache = new Map<string, MatrixGpuColor>();
  readonly #maxGlyphs: number;
  #fillStyle = "#00ff00";
  #font = "12px monospace";
  #globalAlpha = 1;
  #width = 1;
  #height = 1;
  #devicePixelRatio = 1;

  constructor(maxGlyphs = DEFAULT_MAX_GPU_GLYPHS) {
    this.#maxGlyphs = Math.max(1, Math.floor(maxGlyphs));
    const context = {
      clearRect: () => {
        this.#glyphs.length = 0;
      },
      fillText: (text: string, x: number, y: number, maxWidth?: number) => {
        this.#pushGlyph(text, x, y, maxWidth);
      },
      restore: () => {
        const state = this.#stateStack.pop();
        if (!state) return;
        this.#fillStyle = state.fillStyle;
        this.#font = state.font;
        this.#globalAlpha = state.globalAlpha;
      },
      save: () => {
        this.#stateStack.push({
          fillStyle: this.#fillStyle,
          font: this.#font,
          globalAlpha: this.#globalAlpha,
        });
      },
    } as unknown as CanvasRenderingContext2D;
    Object.defineProperties(context, {
      fillStyle: {
        get: () => this.#fillStyle,
        set: (value: string | CanvasGradient | CanvasPattern) => {
          if (typeof value === "string") this.#fillStyle = value;
        },
      },
      font: {
        get: () => this.#font,
        set: (value: string) => {
          this.#font = value;
        },
      },
      globalAlpha: {
        get: () => this.#globalAlpha,
        set: (value: number) => {
          this.#globalAlpha = clamp01(value);
        },
      },
      strokeStyle: {
        get: () => this.#fillStyle,
        set: () => undefined,
      },
      textAlign: {
        get: () => "center",
        set: () => undefined,
      },
      textBaseline: {
        get: () => "middle",
        set: () => undefined,
      },
    });
    this.#context = context;
  }

  #pushGlyph(text: string, x: number, y: number, maxWidth?: number): void {
    if (
      this.#glyphs.length >= this.#maxGlyphs ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      this.#globalAlpha <= 0
    ) {
      return;
    }
    const fontSize = Number(FONT_SIZE_PATTERN.exec(this.#font)?.[1] ?? 0);
    if (!Number.isFinite(fontSize) || fontSize <= 0) return;
    const index = this.#glyphs.length;
    const glyph =
      this.#pool[index] ??
      ({
        glyph: "0",
        x: 0,
        y: 0,
        fontSizePx: 1,
        scale: 1,
        opacity: 1,
        color: { red: 0, green: 1, blue: 0, alpha: 1 },
      } satisfies MutableMatrixGpuGlyph);
    this.#pool[index] = glyph;
    glyph.glyph = text;
    glyph.x = x;
    glyph.y = y;
    glyph.fontSizePx = fontSize;
    glyph.scale = 1;
    glyph.opacity = this.#globalAlpha;
    glyph.color =
      this.#colorCache.get(this.#fillStyle) ??
      (() => {
        const parsed = parseMatrixGpuColor(this.#fillStyle);
        this.#colorCache.set(this.#fillStyle, parsed);
        return parsed;
      })();
    if (Number.isFinite(maxWidth) && maxWidth !== undefined && maxWidth > 0) {
      glyph.maxWidthPx = maxWidth;
    } else {
      delete glyph.maxWidthPx;
    }
    this.#glyphs.push(glyph);
  }

  collect(options: CollectMatrixGpuFrameOptions): MatrixGpuFrame {
    this.#width = Math.max(1, options.scene.width);
    this.#height = Math.max(1, options.scene.height);
    this.#devicePixelRatio = Math.max(1, options.devicePixelRatio);
    drawAtmosphereScene(
      this.#context,
      options.scene,
      options.color,
      options.opacity,
      options.matrixColorFrame,
      options.motionMode,
      options.walkStartFontSize,
      options.walkEndFontSize,
      options.matrixBaseFontSize,
    );
    return {
      width: this.#width,
      height: this.#height,
      devicePixelRatio: this.#devicePixelRatio,
      glyphs: this.#glyphs as readonly MatrixGpuGlyph[],
    };
  }
}
