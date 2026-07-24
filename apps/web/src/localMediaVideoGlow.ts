import { extractAmbientEdgePalette, type AmbientEdgePalette } from "./ambientVideoGlow";

export const LOCAL_MEDIA_GLOW_SAMPLE_WIDTH = 32;
export const LOCAL_MEDIA_GLOW_SAMPLE_HEIGHT = 18;
export const LOCAL_MEDIA_GLOW_SAMPLE_INTERVAL_MS = 750;
/**
 * A temporarily unavailable frame can recover after decode catches up, but a
 * tainted or denied canvas will not. Keep automatic retries small and let a
 * later explicit media event start a fresh bounded attempt instead.
 */
export const MAX_LOCAL_MEDIA_GLOW_CONSECUTIVE_FALLBACK_SAMPLES = 3;

interface LocalMediaGlowCanvasContext {
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number,
  ): void;
  getImageData(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): { readonly data: Uint8ClampedArray<ArrayBufferLike> };
}

interface LocalMediaGlowCanvas {
  width: number;
  height: number;
  getContext(
    contextId: "2d",
    options?: CanvasRenderingContext2DSettings,
  ): LocalMediaGlowCanvasContext | null;
}

export type LocalMediaGlowCanvasFactory = () => LocalMediaGlowCanvas;

/**
 * Samples only the already approved renderer media element into a tiny,
 * throwaway canvas. No source bytes, frames, paths, or palette history leave
 * the current renderer session.
 */
export function sampleLocalMediaVideoPalette(
  video: HTMLVideoElement,
  createCanvas: LocalMediaGlowCanvasFactory = () =>
    document.createElement("canvas") as unknown as LocalMediaGlowCanvas,
): AmbientEdgePalette | null {
  if (
    video.readyState < 2 ||
    !Number.isFinite(video.videoWidth) ||
    !Number.isFinite(video.videoHeight) ||
    video.videoWidth < 1 ||
    video.videoHeight < 1
  ) {
    return null;
  }

  let canvas: LocalMediaGlowCanvas | null = null;

  try {
    canvas = createCanvas();
    canvas.width = LOCAL_MEDIA_GLOW_SAMPLE_WIDTH;
    canvas.height = LOCAL_MEDIA_GLOW_SAMPLE_HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return null;
    context.drawImage(video, 0, 0, LOCAL_MEDIA_GLOW_SAMPLE_WIDTH, LOCAL_MEDIA_GLOW_SAMPLE_HEIGHT);
    const frame = context.getImageData(
      0,
      0,
      LOCAL_MEDIA_GLOW_SAMPLE_WIDTH,
      LOCAL_MEDIA_GLOW_SAMPLE_HEIGHT,
    );
    return extractAmbientEdgePalette(
      frame.data,
      LOCAL_MEDIA_GLOW_SAMPLE_WIDTH,
      LOCAL_MEDIA_GLOW_SAMPLE_HEIGHT,
    );
  } catch {
    // A tainted, unavailable, or tearing-down frame falls back to the fixed
    // operator color. Callers may retry after a later media event.
    return null;
  } finally {
    // The canvas is deliberately throwaway. Clearing its backing store keeps
    // the one tiny sampled frame from surviving beyond this synchronous read.
    if (canvas !== null) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}

export function localMediaAdaptiveGlowShadow(palette: AmbientEdgePalette, opacity: number): string {
  const percentage = Math.round(Math.min(1, Math.max(0, opacity)) * 100);
  const color = (value: string) => `color-mix(in srgb, ${value} ${percentage}%, transparent)`;
  return [
    `0 -18px 42px ${color(palette.top)}`,
    `22px 0 42px ${color(palette.right)}`,
    `0 18px 42px ${color(palette.bottom)}`,
    `-22px 0 42px ${color(palette.left)}`,
  ].join(", ");
}
