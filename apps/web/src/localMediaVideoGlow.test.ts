import { describe, expect, it, vi } from "vitest";

import {
  LOCAL_MEDIA_GLOW_SAMPLE_HEIGHT,
  LOCAL_MEDIA_GLOW_SAMPLE_WIDTH,
  localMediaAdaptiveGlowShadow,
  sampleLocalMediaVideoPalette,
} from "./localMediaVideoGlow";

function edgeFrame(): Uint8ClampedArray {
  const width = LOCAL_MEDIA_GLOW_SAMPLE_WIDTH;
  const height = LOCAL_MEDIA_GLOW_SAMPLE_HEIGHT;
  const frame = new Uint8ClampedArray(width * height * 4);
  const paint = (x: number, y: number, red: number, green: number, blue: number) => {
    frame.set([red, green, blue, 255], (y * width + x) * 4);
  };
  for (let x = 2; x < width - 2; x += 1) {
    paint(x, 0, 255, 0, 0);
    paint(x, 1, 255, 0, 0);
    paint(x, height - 2, 0, 0, 255);
    paint(x, height - 1, 0, 0, 255);
  }
  for (let y = 2; y < height - 2; y += 1) {
    paint(0, y, 0, 255, 0);
    paint(1, y, 0, 255, 0);
    paint(width - 2, y, 255, 255, 0);
    paint(width - 1, y, 255, 255, 0);
  }
  return frame;
}

describe("local media adaptive video glow", () => {
  it("samples only one tiny current frame and clears the canvas afterward", () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        drawImage,
        getImageData: () => ({ data: edgeFrame() }),
      })),
    };
    const video = {
      readyState: 2,
      videoWidth: 1920,
      videoHeight: 1080,
    } as HTMLVideoElement;

    expect(sampleLocalMediaVideoPalette(video, () => canvas)).toEqual({
      top: "#ff0000",
      right: "#ffff00",
      bottom: "#0000ff",
      left: "#00ff00",
    });
    expect(drawImage).toHaveBeenCalledWith(
      video,
      0,
      0,
      LOCAL_MEDIA_GLOW_SAMPLE_WIDTH,
      LOCAL_MEDIA_GLOW_SAMPLE_HEIGHT,
    );
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("fails closed before a frame is ready or when canvas access is denied", () => {
    const createCanvas = vi.fn(() => ({
      width: 0,
      height: 0,
      getContext: () => {
        throw new DOMException("Blocked", "SecurityError");
      },
    }));
    expect(
      sampleLocalMediaVideoPalette(
        { readyState: 1, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement,
        createCanvas,
      ),
    ).toBeNull();
    expect(createCanvas).not.toHaveBeenCalled();

    expect(
      sampleLocalMediaVideoPalette(
        { readyState: 2, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement,
        createCanvas,
      ),
    ).toBeNull();

    expect(
      sampleLocalMediaVideoPalette(
        { readyState: 2, videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement,
        () => {
          throw new DOMException("Blocked", "SecurityError");
        },
      ),
    ).toBeNull();
  });

  it("builds independently colored edge shadows with bounded opacity", () => {
    expect(
      localMediaAdaptiveGlowShadow(
        { top: "#ff0000", right: "#ffff00", bottom: "#0000ff", left: "#00ff00" },
        2,
      ),
    ).toContain("#ff0000 100%");
    expect(
      localMediaAdaptiveGlowShadow(
        { top: "#ff0000", right: "#ffff00", bottom: "#0000ff", left: "#00ff00" },
        -1,
      ),
    ).toContain("#00ff00 0%");
  });
});
