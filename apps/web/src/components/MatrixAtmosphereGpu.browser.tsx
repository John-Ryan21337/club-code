import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@cafecode/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { MatrixGpuFrameCollector } from "../matrixGpuFrameCollector";
import {
  createMatrixWebGl2Renderer,
  detectMatrixWebGl2Capability,
  type MatrixWebGl2Renderer,
} from "../matrixWebGlRenderer";
import {
  createAtmosphereScene,
  createSeededRandom,
  MATRIX_JAPANESE_GLYPHS,
  MATRIX_ROMAN_GLYPHS,
  resolveMatrixAtmosphereColorFrame,
} from "../windowAtmosphere";
import { WindowAtmosphere } from "./WindowAtmosphere";

const testState = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  atmosphereAvailable: true,
  /**
   * Narrow seam for the fallback-specific component gates: it refuses the
   * WebGL2 context request and changes nothing else. Left off, the component
   * runs its real production acquisition, so a host with a working GPU takes
   * the GPU path here instead of failing a hard-coded fallback expectation.
   */
  forceGpuUnavailable: false,
}));

vi.mock("../matrixWebGlRenderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../matrixWebGlRenderer")>();
  return {
    ...actual,
    createMatrixWebGl2Renderer: ((canvas, glyphs, options = {}) =>
      actual.createMatrixWebGl2Renderer(
        canvas,
        glyphs,
        testState.forceGpuUnavailable ? { ...options, acquireContext: () => null } : options,
      )) satisfies typeof actual.createMatrixWebGl2Renderer,
  };
});

vi.mock("../hooks/useSettings", () => ({
  useSettings: <T,>(selector: (settings: UnifiedSettings) => T) =>
    selector(testState.settings ?? DEFAULT_UNIFIED_SETTINGS),
}));

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark" as const }),
}));

vi.mock("../rpc/serverState", () => ({
  useServerConfig: () => ({
    ambientExperienceCapabilities: { atmosphere: testState.atmosphereAvailable },
  }),
}));

const GLYPH_POOL = [...Array.from(MATRIX_ROMAN_GLYPHS), ...Array.from(MATRIX_JAPANESE_GLYPHS)];

/**
 * Acquires a real WebGL2 context with `failIfMajorPerformanceCaveat` relaxed,
 * so the renderer gates exercise the GL contract (program link, instancing,
 * single draw, error-free frame, visible pixels) on any host with a WebGL2
 * driver, hardware or software. Whether a given host accelerates that driver is
 * not observable here and is never asserted. `preserveDrawingBuffer` is enabled
 * only so the assertions can read back the frame they just drew.
 */
function acquireTestContext(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  return canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    desynchronized: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: true,
    stencil: false,
  });
}

function createMatrixFrame(motionMode: "flat" | "walk-forward") {
  const scene = createAtmosphereScene(
    "matrix",
    640,
    480,
    createSeededRandom(11),
    1,
    0.5,
    motionMode,
    30,
    4,
  );
  const collector = new MatrixGpuFrameCollector(8_192);
  return collector.collect({
    scene,
    color: "#4ade80",
    opacity: 1,
    matrixColorFrame: resolveMatrixAtmosphereColorFrame("rainbow", "auto", true, 1_000, 1),
    motionMode,
    walkStartFontSize: 12,
    walkEndFontSize: 48,
    matrixBaseFontSize: 18,
    devicePixelRatio: 1,
  });
}

function attachCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 480;
  document.body.append(canvas);
  return canvas;
}

describe("Matrix WebGL2 glyph renderer in Chromium", () => {
  const disposables: Array<() => void> = [];

  afterEach(() => {
    while (disposables.length > 0) disposables.pop()?.();
    for (const canvas of Array.from(document.querySelectorAll("canvas"))) {
      canvas.remove();
    }
  });

  it("reports a real WebGL2 capability for this browser", () => {
    const capability = detectMatrixWebGl2Capability(attachCanvas(), acquireTestContext);
    expect(capability.supported).toBe(true);
    expect(capability.maxTextureSize).toBeGreaterThanOrEqual(256);
    expect(capability.maxVertexAttributes).toBeGreaterThanOrEqual(4);
  });

  it("draws the collected Matrix frame once with no GL error and visible pixels", () => {
    const canvas = attachCanvas();
    const selection = createMatrixWebGl2Renderer(canvas, GLYPH_POOL, {
      acquireContext: acquireTestContext,
      maxGlyphInstances: 8_192,
    });
    expect(selection.kind).toBe("webgl2");
    if (selection.kind !== "webgl2") return;
    const renderer: MatrixWebGl2Renderer = selection.renderer;
    disposables.push(() => {
      renderer.dispose();
    });

    const frame = createMatrixFrame("flat");
    expect(frame.glyphs.length).toBeGreaterThan(0);

    const result = renderer.render(frame);
    expect(result.status).toBe("rendered");
    expect(result.renderedGlyphs).toBeGreaterThan(0);
    expect(result.drawCalls).toBe(1);

    const gl = acquireTestContext(canvas)!;
    expect(gl.getError()).toBe(gl.NO_ERROR);

    // A nonzero instance count alone does not prove the frame reached the
    // default framebuffer, so read the drawing buffer back and require pixels.
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let litPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index]! > 0) litPixels += 1;
    }
    expect(litPixels).toBeGreaterThan(0);
  });

  it("keeps Walk Forward instances inside the bounded viewport budget", () => {
    const canvas = attachCanvas();
    const selection = createMatrixWebGl2Renderer(canvas, GLYPH_POOL, {
      acquireContext: acquireTestContext,
      maxGlyphInstances: 2_048,
    });
    expect(selection.kind).toBe("webgl2");
    if (selection.kind !== "webgl2") return;
    disposables.push(() => {
      selection.renderer.dispose();
    });

    const result = selection.renderer.render(createMatrixFrame("walk-forward"));
    expect(result.status).toBe("rendered");
    expect(result.renderedGlyphs).toBeGreaterThan(0);
    expect(result.renderedGlyphs).toBeLessThanOrEqual(2_048);
    expect(result.drawCalls).toBe(1);
  });

  it("reports a typed fallback instead of throwing when WebGL2 is unavailable", () => {
    const selection = createMatrixWebGl2Renderer(attachCanvas(), GLYPH_POOL, {
      acquireContext: () => null,
    });
    expect(selection.kind).toBe("canvas2d-fallback");
    if (selection.kind !== "canvas2d-fallback") return;
    expect(selection.reason).toBe("webgl2-unavailable");
  });

  it("reports a real driver context loss through a typed status", async () => {
    const canvas = attachCanvas();
    const availabilities: string[] = [];
    const selection = createMatrixWebGl2Renderer(canvas, GLYPH_POOL, {
      acquireContext: acquireTestContext,
      onAvailabilityChange: (availability) => {
        availabilities.push(availability);
      },
    });
    expect(selection.kind).toBe("webgl2");
    if (selection.kind !== "webgl2") return;
    disposables.push(() => {
      selection.renderer.dispose();
    });
    expect(selection.renderer.render(createMatrixFrame("flat")).status).toBe("rendered");

    const loseContext = acquireTestContext(canvas)!.getExtension("WEBGL_lose_context");
    expect(loseContext).not.toBeNull();

    // A real driver loss, not a synthesized event: the renderer must keep
    // answering with a typed status and leave Canvas2D in charge.
    loseContext!.loseContext();
    await vi.waitFor(() => {
      expect(availabilities.at(-1)).toBe("context-lost");
    });
    expect(selection.renderer.render(createMatrixFrame("flat")).status).toBe("context-lost");
  });

  it("rebuilds real GPU resources and draws again when restoration reacquires a context", () => {
    const canvas = attachCanvas();
    const availabilities: string[] = [];
    const selection = createMatrixWebGl2Renderer(canvas, GLYPH_POOL, {
      acquireContext: acquireTestContext,
      onAvailabilityChange: (availability) => {
        availabilities.push(availability);
      },
    });
    expect(selection.kind).toBe("webgl2");
    if (selection.kind !== "webgl2") return;
    disposables.push(() => {
      selection.renderer.dispose();
    });

    // Whether a host's driver hands a working context back after a real loss
    // varies by machine, so the restoration outcome is driven deterministically
    // instead: the renderer sees the same lifecycle events and rebuilds against
    // a real, live WebGL2 context.
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(availabilities.at(-1)).toBe("context-lost");
    expect(selection.renderer.render(createMatrixFrame("flat")).status).toBe("context-lost");

    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(availabilities.at(-1)).toBe("available");
    const result = selection.renderer.render(createMatrixFrame("flat"));
    expect(result.status).toBe("rendered");
    expect(result.drawCalls).toBe(1);

    const gl = acquireTestContext(canvas)!;
    expect(gl.getError()).toBe(gl.NO_ERROR);
    const pixels = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let litPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index]! > 0) litPixels += 1;
    }
    expect(litPixels).toBeGreaterThan(0);
  });

  it("reports GPU unavailability when restoration cannot reacquire a context", () => {
    const canvas = attachCanvas();
    const availabilities: string[] = [];
    let acquisitions = 0;
    const selection = createMatrixWebGl2Renderer(canvas, GLYPH_POOL, {
      acquireContext: (target) => (acquisitions++ === 0 ? acquireTestContext(target) : null),
      onAvailabilityChange: (availability) => {
        availabilities.push(availability);
      },
    });
    expect(selection.kind).toBe("webgl2");
    if (selection.kind !== "webgl2") return;
    disposables.push(() => {
      selection.renderer.dispose();
    });

    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));

    expect(availabilities).toEqual(["context-lost", "unavailable"]);
    expect(selection.renderer.render(createMatrixFrame("flat")).status).toBe("context-lost");
  });
});

describe("WindowAtmosphere Matrix backends", () => {
  beforeEach(() => {
    testState.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
      fallingEffectMatrixMotionMode: "walk-forward",
      continueBackgroundAnimations: true,
    };
    testState.atmosphereAvailable = true;
    testState.forceGpuUnavailable = false;
  });

  afterEach(() => {
    testState.settings = null;
    testState.forceGpuUnavailable = false;
    vi.restoreAllMocks();
  });

  it("mounts pointer-transparent GPU and Canvas layers and resolves a truthful renderer", async () => {
    const screen = await render(<WindowAtmosphere />);
    const gpuCanvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="window-atmosphere-matrix-gpu"]',
    );
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="window-atmosphere"]');

    expect(gpuCanvas).not.toBeNull();
    expect(canvas).not.toBeNull();
    expect(gpuCanvas!.style.pointerEvents).toBe("none");
    expect(canvas!.style.pointerEvents).toBe("none");

    // This host runs the real production acquisition, which may succeed or be
    // refused. Either is a supported mode; what the component may not do is
    // report a backend it did not commit a frame with.
    await vi.waitFor(() => {
      expect(["available", "unavailable"]).toContain(gpuCanvas!.dataset.matrixGpuAvailability);
      expect(canvas!.dataset.atmosphereFrameCommit).not.toBe("pending");
    });
    if (gpuCanvas!.dataset.matrixGpuAvailability === "available") {
      await vi.waitFor(() => {
        expect(canvas!.dataset.atmosphereRenderer).toBe("webgl2-glyph-atlas");
        expect(canvas!.dataset.atmosphereTextRasterization).toBe("gpu-glyph-atlas");
        expect(["rendered", "empty"]).toContain(canvas!.dataset.atmosphereFrameCommit);
      });
      expect(gpuCanvas!.dataset.matrixGpuFallbackReason).toBeUndefined();
    } else {
      expect(gpuCanvas!.dataset.matrixGpuFallbackReason).toBe("webgl2-unavailable");
      await vi.waitFor(() => {
        expect(canvas!.dataset.atmosphereRenderer).toBe("canvas2d");
        expect(canvas!.dataset.atmosphereTextRasterization).toBe("main-thread");
        expect(canvas!.dataset.atmosphereFrameCommit).toBe("canvas2d");
      });
    }

    await screen.unmount();
    expect(document.querySelector('[data-testid="window-atmosphere-matrix-gpu"]')).toBeNull();
  });

  it("reports the Canvas fallback truthfully when the GPU context is refused", async () => {
    testState.forceGpuUnavailable = true;
    const screen = await render(<WindowAtmosphere />);
    const gpuCanvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="window-atmosphere-matrix-gpu"]',
    )!;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="window-atmosphere"]')!;

    await vi.waitFor(() => {
      expect(gpuCanvas.dataset.matrixGpuAvailability).toBe("unavailable");
      expect(gpuCanvas.dataset.matrixGpuFallbackReason).toBe("webgl2-unavailable");
    });
    expect(gpuCanvas.style.visibility).toBe("hidden");
    await vi.waitFor(() => {
      expect(canvas.dataset.atmosphereRenderer).toBe("canvas2d");
      expect(canvas.dataset.atmosphereTextRasterization).toBe("main-thread");
      expect(canvas.dataset.atmosphereFrameCommit).toBe("canvas2d");
    });

    await screen.unmount();
  });

  it("paints visible Canvas fallback pixels for the shared Walk Forward scene", async () => {
    // Forced onto the fallback: with a working GPU the glyphs land on the
    // WebGL layer and the Canvas2D bitmap is intentionally transparent.
    testState.forceGpuUnavailable = true;
    const screen = await render(<WindowAtmosphere />);
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="window-atmosphere"]')!;

    await vi.waitFor(() => {
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let litPixels = 0;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index]! > 0) litPixels += 1;
      }
      expect(litPixels).toBeGreaterThan(0);
    });

    await screen.unmount();
  });
});
