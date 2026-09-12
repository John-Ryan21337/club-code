const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_ARTWORK_ORIGIN = "https://i.ytimg.com";
const MAX_ARTWORK_BYTES = 2_000_000;
const PALETTE_WIDTH = 32;
const PALETTE_HEIGHT = 18;

export interface AmbientEdgePalette {
  readonly top: string;
  readonly right: string;
  readonly bottom: string;
  readonly left: string;
}

interface PaletteImage {
  readonly width: number;
  readonly height: number;
  close?: () => void;
}

interface PaletteCanvasContext {
  drawImage(image: PaletteImage, x: number, y: number, width: number, height: number): void;
  getImageData(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { readonly data: Uint8ClampedArray<ArrayBufferLike> };
}

interface PaletteCanvas {
  width: number;
  height: number;
  getContext(
    contextId: "2d",
    options?: CanvasRenderingContext2DSettings,
  ): PaletteCanvasContext | null;
}

export interface LoadYouTubeEdgePaletteOptions {
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
  readonly createImageBitmap?: (blob: Blob) => Promise<PaletteImage>;
  readonly createCanvas?: () => PaletteCanvas;
}

function validVideoId(value: unknown): value is string {
  return typeof value === "string" && YOUTUBE_VIDEO_ID.test(value);
}

function byteToHex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");
}

function averageRegion(
  pixels: Uint8ClampedArray,
  width: number,
  startX: number,
  endX: number,
  startY: number,
  endY: number,
): string {
  let red = 0;
  let green = 0;
  let blue = 0;
  let weightTotal = 0;
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = pixels[offset + 3]! / 255;
      if (alpha <= 0) {
        continue;
      }
      const pixelRed = pixels[offset]!;
      const pixelGreen = pixels[offset + 1]!;
      const pixelBlue = pixels[offset + 2]!;
      const colorRange =
        Math.max(pixelRed, pixelGreen, pixelBlue) - Math.min(pixelRed, pixelGreen, pixelBlue);
      // Preserve vivid edge colors without allowing a single saturated pixel
      // to dominate an entire edge.
      const weight = alpha * (1 + colorRange / 255);
      red += pixelRed * pixelRed * weight;
      green += pixelGreen * pixelGreen * weight;
      blue += pixelBlue * pixelBlue * weight;
      weightTotal += weight;
    }
  }
  if (weightTotal === 0) {
    return "#000000";
  }
  return `#${byteToHex(Math.sqrt(red / weightTotal))}${byteToHex(
    Math.sqrt(green / weightTotal),
  )}${byteToHex(Math.sqrt(blue / weightTotal))}`;
}

/** Extract four edge colors from an already bounded RGBA raster. */
export function extractAmbientEdgePalette(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): AmbientEdgePalette | null {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 2 ||
    height < 2 ||
    width > PALETTE_WIDTH ||
    height > PALETTE_HEIGHT ||
    pixels.length !== width * height * 4
  ) {
    return null;
  }
  const horizontalBand = Math.max(1, Math.min(2, Math.floor(height / 4)));
  const verticalBand = Math.max(1, Math.min(2, Math.floor(width / 4)));
  return {
    top: averageRegion(pixels, width, 0, width, 0, horizontalBand),
    right: averageRegion(pixels, width, width - verticalBand, width, 0, height),
    bottom: averageRegion(pixels, width, 0, width, height - horizontalBand, height),
    left: averageRegion(pixels, width, 0, verticalBand, 0, height),
  };
}

function isSupportedArtworkContentType(value: string | null): boolean {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "image/jpeg" || mediaType === "image/png" || mediaType === "image/webp";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Aborted", "AbortError");
  }
}

async function readBoundedArtwork(response: Response, signal?: AbortSignal): Promise<Blob> {
  if (!response.ok || !isSupportedArtworkContentType(response.headers.get("content-type"))) {
    throw new Error("YouTube artwork was unavailable.");
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_ARTWORK_BYTES) {
    throw new Error("YouTube artwork exceeded the palette budget.");
  }
  // A stream is required so the budget is enforced before an unbounded body is
  // buffered. Browser fetch responses expose one; fail closed for unusual
  // polyfills rather than falling back to Response.blob().
  if (!response.body) throw new Error("YouTube artwork was unavailable.");

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let total = 0;
  const cancelForAbort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener("abort", cancelForAbort, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const result = await reader.read();
      throwIfAborted(signal);
      if (result.done) {
        break;
      }
      total += result.value.byteLength;
      if (total > MAX_ARTWORK_BYTES) {
        await reader.cancel();
        throw new Error("YouTube artwork exceeded the palette budget.");
      }
      const chunk = new Uint8Array(result.value.byteLength);
      chunk.set(result.value);
      chunks.push(chunk.buffer);
    }
  } finally {
    signal?.removeEventListener("abort", cancelForAbort);
    reader.releaseLock();
  }
  return new Blob(chunks, { type: response.headers.get("content-type") ?? "image/jpeg" });
}

export async function loadYouTubeEdgePalette(
  videoId: string,
  options: LoadYouTubeEdgePaletteOptions = {},
): Promise<AmbientEdgePalette> {
  if (!validVideoId(videoId)) {
    throw new Error("Invalid YouTube video ID.");
  }
  const fetchArtwork = options.fetch ?? globalThis.fetch;
  const createBitmap = options.createImageBitmap ?? globalThis.createImageBitmap;
  const createCanvas: () => PaletteCanvas =
    options.createCanvas ?? (() => document.createElement("canvas") as unknown as PaletteCanvas);
  if (typeof fetchArtwork !== "function" || typeof createBitmap !== "function") {
    throw new Error("Adaptive artwork sampling is unsupported.");
  }

  throwIfAborted(options.signal);
  const artworkUrl = `${YOUTUBE_ARTWORK_ORIGIN}/vi/${videoId}/hqdefault.jpg`;
  const response = await fetchArtwork(artworkUrl, {
    credentials: "omit",
    mode: "cors",
    redirect: "error",
    referrerPolicy: "no-referrer",
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const artwork = await readBoundedArtwork(response, options.signal);
  throwIfAborted(options.signal);
  const bitmap = await createBitmap(artwork);
  try {
    throwIfAborted(options.signal);
    const canvas: PaletteCanvas = createCanvas();
    canvas.width = PALETTE_WIDTH;
    canvas.height = PALETTE_HEIGHT;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("Adaptive artwork sampling is unsupported.");
    }
    context.drawImage(bitmap, 0, 0, PALETTE_WIDTH, PALETTE_HEIGHT);
    const imageData = context.getImageData(0, 0, PALETTE_WIDTH, PALETTE_HEIGHT);
    const palette = extractAmbientEdgePalette(imageData.data, PALETTE_WIDTH, PALETTE_HEIGHT);
    if (palette === null) {
      throw new Error("YouTube artwork could not be sampled.");
    }
    return palette;
  } finally {
    bitmap.close?.();
  }
}
