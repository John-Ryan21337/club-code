import { describe, expect, it, vi } from "vitest";

import { extractAmbientEdgePalette, loadYouTubeEdgePalette } from "./ambientVideoGlow";

function edgeFixture(width = 8, height = 8): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const paint = (x: number, y: number, red: number, green: number, blue: number) => {
    const offset = (y * width + x) * 4;
    pixels.set([red, green, blue, 255], offset);
  };
  for (let offset = 2; offset < 6; offset += 1) {
    for (let depth = 0; depth < 2; depth += 1) {
      paint(offset, depth, 255, 0, 0);
      paint(7 - depth, offset, 255, 255, 0);
      paint(offset, 7 - depth, 0, 0, 255);
      paint(depth, offset, 0, 255, 0);
    }
  }
  return pixels;
}

async function createPaletteImageBitmap() {
  return { width: 320, height: 180 };
}

describe("adaptive ambient video glow", () => {
  it("extracts an independently bounded color for every artwork edge", () => {
    expect(extractAmbientEdgePalette(edgeFixture(), 8, 8)).toEqual({
      top: "#ff0000",
      right: "#ffff00",
      bottom: "#0000ff",
      left: "#00ff00",
    });
    expect(extractAmbientEdgePalette(new Uint8ClampedArray(8), 8, 8)).toBeNull();
    expect(extractAmbientEdgePalette(new Uint8ClampedArray(33 * 18 * 4), 33, 18)).toBeNull();
  });

  it("loads only the fixed CORS artwork URL into a tiny canvas and closes the bitmap", async () => {
    const fetchArtwork = vi.fn(async () => {
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg", "content-length": "3" },
      });
    });
    const close = vi.fn();
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({
      data: new Uint8ClampedArray(32 * 18 * 4),
    }));
    const createCanvas = vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, getImageData }),
    }));

    await loadYouTubeEdgePalette("dQw4w9WgXcQ", {
      fetch: fetchArtwork as typeof fetch,
      createImageBitmap: async () => ({ width: 320, height: 180, close }),
      createCanvas,
    });

    expect(fetchArtwork).toHaveBeenCalledWith(
      "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      expect.objectContaining({
        credentials: "omit",
        mode: "cors",
        redirect: "error",
        referrerPolicy: "no-referrer",
      }),
    );
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 32, 18);
    expect(close).toHaveBeenCalledOnce();
    await expect(
      loadYouTubeEdgePalette("../not-safe", { fetch: fetchArtwork as typeof fetch }),
    ).rejects.toThrow("Invalid YouTube video ID");
  });

  it("fails closed for unsafe responses and aborts before starting a new artwork request", async () => {
    const fetchArtwork = vi.fn(
      async () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg; charset=binary", "content-length": "2000001" },
        }),
    );
    await expect(
      loadYouTubeEdgePalette("dQw4w9WgXcQ", {
        fetch: fetchArtwork as typeof fetch,
        createImageBitmap: createPaletteImageBitmap,
      }),
    ).rejects.toThrow("palette budget");

    const controller = new AbortController();
    controller.abort();
    await expect(
      loadYouTubeEdgePalette("dQw4w9WgXcQ", {
        fetch: fetchArtwork as typeof fetch,
        createImageBitmap: createPaletteImageBitmap,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(fetchArtwork).toHaveBeenCalledOnce();

    await expect(
      loadYouTubeEdgePalette("dQw4w9WgXcQ", {
        fetch: (async () =>
          new Response(null, {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          })) as typeof fetch,
        createImageBitmap: createPaletteImageBitmap,
      }),
    ).rejects.toThrow("unavailable");
  });
});
