import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@cafecode/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { MAX_ATMOSPHERE_CANVAS_PIXELS } from "../windowAtmosphere";
import { matrixColorFrameStore } from "../matrixColorFrameStore";
import { WindowAtmosphere } from "./WindowAtmosphere";

const testState = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  atmosphereAvailable: true,
}));

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

function createCanvasContext() {
  return {
    arc: vi.fn(),
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    restore: vi.fn(),
    save: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    fillStyle: "",
    font: "",
    globalAlpha: 1,
    lineCap: "butt",
    lineWidth: 1,
    strokeStyle: "",
    textAlign: "start",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

/**
 * A scripted WebGL2 context. The GL contract itself is proven against real
 * drivers in `MatrixAtmosphereGpu.browser.tsx`; this double exists so the
 * component's loss and restoration behaviour is deterministic on every host,
 * including machines whose real context would survive or refuse restoration.
 * Constants come from the browser's own interface prototype.
 */
function createScriptedWebGl2Context() {
  const gl = Object.create(WebGL2RenderingContext.prototype) as Record<string, unknown>;
  const allocating = [
    "createBuffer",
    "createProgram",
    "createShader",
    "createTexture",
    "createVertexArray",
    "getUniformLocation",
  ];
  const commands = [
    "activeTexture",
    "attachShader",
    "bindBuffer",
    "bindTexture",
    "bindVertexArray",
    "blendFuncSeparate",
    "bufferData",
    "bufferSubData",
    "clear",
    "clearColor",
    "compileShader",
    "deleteBuffer",
    "deleteProgram",
    "deleteShader",
    "deleteTexture",
    "deleteVertexArray",
    "disable",
    "drawArraysInstanced",
    "enable",
    "enableVertexAttribArray",
    "linkProgram",
    "pixelStorei",
    "shaderSource",
    "texImage2D",
    "texParameteri",
    "uniform1i",
    "uniform2f",
    "useProgram",
    "vertexAttribDivisor",
    "vertexAttribPointer",
    "viewport",
  ];
  for (const name of commands) gl[name] = vi.fn();
  for (const name of allocating) gl[name] = vi.fn(() => ({}));
  gl.getShaderParameter = vi.fn(() => true);
  gl.getProgramParameter = vi.fn(() => true);
  gl.getShaderInfoLog = vi.fn(() => "");
  gl.getProgramInfoLog = vi.fn(() => "");
  gl.isContextLost = vi.fn(() => false);
  gl.getParameter = vi.fn((parameter: number) =>
    parameter === WebGL2RenderingContext.MAX_TEXTURE_SIZE ? 4_096 : 16,
  );
  return gl as unknown as WebGL2RenderingContext & { bufferSubData: ReturnType<typeof vi.fn> };
}

/** Last instance payload the renderer uploaded, copied out of its reused buffer. */
function lastUploadedInstances(
  gl: WebGL2RenderingContext & { bufferSubData: ReturnType<typeof vi.fn> },
): Float32Array {
  const call = gl.bufferSubData.mock.calls.at(-1);
  const data = call?.[2] as Float32Array | undefined;
  const length = (call?.[4] as number | undefined) ?? 0;
  return data ? new Float32Array(data.subarray(0, length)) : new Float32Array();
}

describe("WindowAtmosphere", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalGetBoundingClientRect = HTMLCanvasElement.prototype.getBoundingClientRect;
  const originalDevicePixelRatio = window.devicePixelRatio;
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;
  let context: CanvasRenderingContext2D;
  let reducedMotion = false;
  let mediaChange: (() => void) | null = null;
  let removeMediaChangeListener: ReturnType<typeof vi.fn>;
  let frames = new Map<number, FrameRequestCallback>();
  let nextFrameId = 1;
  let webgl2Contexts: Array<WebGL2RenderingContext & { bufferSubData: ReturnType<typeof vi.fn> }> =
    [];
  let scriptedGpu = false;
  let documentVisibility: DocumentVisibilityState = "visible";
  let windowFocused = true;

  beforeEach(() => {
    testState.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
      continueBackgroundAnimations: true,
    };
    testState.atmosphereAvailable = true;
    context = createCanvasContext();
    reducedMotion = false;
    mediaChange = null;
    removeMediaChangeListener = vi.fn();
    frames = new Map();
    nextFrameId = 1;
    webgl2Contexts = [];
    scriptedGpu = false;
    documentVisibility = "visible";
    windowFocused = true;

    // Most cases exercise the Canvas2D backend only, so "webgl2" resolves to
    // null and the GPU renderer reports its typed unavailable fallback. The
    // backend-change cases opt into a scripted context instead.
    HTMLCanvasElement.prototype.getContext = vi.fn((contextId: string) => {
      if (contextId !== "webgl2") return context;
      if (!scriptedGpu) return null;
      const gl = createScriptedWebGl2Context();
      webgl2Contexts.push(gl);
      return gl;
    }) as unknown as typeof originalGetContext;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => documentVisibility,
    });
    vi.spyOn(document, "hasFocus").mockImplementation(() => windowFocused);
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(
      () =>
        ({
          width: 8_000,
          height: 4_000,
        }) as DOMRect,
    );
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 4 });
    vi.spyOn(window, "matchMedia").mockImplementation(
      () =>
        ({
          get matches() {
            return reducedMotion;
          },
          addEventListener: (_type: string, listener: () => void) => {
            mediaChange = listener;
          },
          removeEventListener: removeMediaChangeListener,
        }) as unknown as MediaQueryList,
    );
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "visibilityState");
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    Object.defineProperty(window, "devicePixelRatio", {
      configurable: true,
      value: originalDevicePixelRatio,
    });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalInnerHeight,
    });
    vi.restoreAllMocks();
  });

  it("mounts a bounded canvas and schedules base Matrix rendering", async () => {
    const screen = await render(<WindowAtmosphere />);
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="window-atmosphere"]');

    expect(canvas).not.toBeNull();
    expect((canvas?.width ?? 0) * (canvas?.height ?? 0)).toBeLessThanOrEqual(
      MAX_ATMOSPHERE_CANVAS_PIXELS,
    );
    expect(frames.size).toBe(1);

    const frame = Array.from(frames.values())[0];
    frames.clear();
    frame?.(1_000);
    expect(context.fillText).toHaveBeenCalled();
    expect(frames.size).toBe(1);

    await screen.unmount();
    expect(frames.size).toBe(0);
  });

  it.each([
    [1, 100_000_000],
    [100_000_000, 1],
  ])("keeps the Canvas backing cap for a %s by %s viewport", async (width, height) => {
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(() => ({ width, height }) as DOMRect);
    const screen = await render(<WindowAtmosphere />);
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="window-atmosphere"]')!;
    expect(canvas.width).toBeGreaterThan(0);
    expect(canvas.height).toBeGreaterThan(0);
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(MAX_ATMOSPHERE_CANVAS_PIXELS);
    await screen.unmount();
  });

  it("keeps the advanced scene when only its palette changes", async () => {
    const screen = await render(<WindowAtmosphere />);
    const drawAt = (timestamp: number) => {
      const frame = Array.from(frames.values())[0]!;
      frames.clear();
      frame(timestamp);
    };
    drawAt(1_000);
    vi.mocked(context.fillText).mockClear();
    drawAt(1_100);
    const positions = vi.mocked(context.fillText).mock.calls.map((call) => [...call]);
    expect(positions.length).toBeGreaterThan(0);
    testState.settings = { ...testState.settings!, fallingEffectColor: "#ff0000" };
    await screen.rerender(<WindowAtmosphere />);
    vi.mocked(context.fillText).mockClear();
    drawAt(1_100);
    expect(vi.mocked(context.fillText).mock.calls).toEqual(positions);
    expect(context.fillStyle).toBe("#ff0000");
    expect(matrixColorFrameStore.getSnapshot()).toMatchObject({
      frame: { color: "#ff0000", perStream: false },
      motion: "animated",
    });
    await screen.unmount();
  });

  it("draws one dimmed static frame and schedules no animation under reduced motion", async () => {
    reducedMotion = true;
    const screen = await render(<WindowAtmosphere />);

    // Reduced motion is a supported presentation, not a blank surface: the
    // scene is painted exactly once at the dimmed opacity and no animation
    // frame is scheduled.
    expect(context.fillText).toHaveBeenCalled();
    const staticFrameDraws = (context.fillText as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    expect((context.fillText as ReturnType<typeof vi.fn>).mock.calls.length).toBe(staticFrameDraws);

    reducedMotion = false;
    mediaChange?.();
    expect(frames.size).toBe(1);

    await screen.unmount();
    expect(removeMediaChangeListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("repaints a reduced-motion palette change without creating a loop", async () => {
    reducedMotion = true;
    const screen = await render(<WindowAtmosphere />);
    const positions = vi.mocked(context.fillText).mock.calls.map((call) => [...call]);
    vi.mocked(context.fillText).mockClear();
    vi.mocked(context.clearRect).mockClear();
    testState.settings = { ...testState.settings!, fallingEffectColor: "#ff0000" };
    await screen.rerender(<WindowAtmosphere />);
    expect(vi.mocked(context.fillText).mock.calls).toEqual(positions);
    expect(context.fillStyle).toBe("#ff0000");
    expect(context.clearRect).toHaveBeenCalledTimes(1);
    expect(matrixColorFrameStore.getSnapshot()).toMatchObject({
      frame: { color: "#ff0000", perStream: false },
      motion: "frozen",
    });
    expect(frames.size).toBe(0);
    await screen.unmount();
  });

  it("cancels a running frame when reduced motion becomes active", async () => {
    const screen = await render(<WindowAtmosphere />);
    expect(frames.size).toBe(1);

    reducedMotion = true;
    mediaChange?.();

    expect(frames.size).toBe(0);
    expect(context.clearRect).toHaveBeenCalled();

    await screen.unmount();
  });

  it("falls back to finite viewport dimensions for invalid layout measurements", async () => {
    HTMLCanvasElement.prototype.getBoundingClientRect = vi.fn(
      () =>
        ({
          width: Number.NaN,
          height: Number.POSITIVE_INFINITY,
        }) as DOMRect,
    );
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 640 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 360 });

    const screen = await render(<WindowAtmosphere />);
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="window-atmosphere"]');

    expect(canvas?.width).toBe(1_280);
    expect(canvas?.height).toBe(720);

    await screen.unmount();
  });

  it("recommits the current scene to Canvas2D when the GPU context is lost under reduced motion", async () => {
    scriptedGpu = true;
    reducedMotion = true;
    const screen = await render(<WindowAtmosphere />);
    const gpuCanvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="window-atmosphere-matrix-gpu"]',
    )!;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="window-atmosphere"]')!;
    const fillText = context.fillText as ReturnType<typeof vi.fn>;

    expect(webgl2Contexts).toHaveLength(1);
    expect(gpuCanvas.dataset.matrixGpuAvailability).toBe("available");
    expect(gpuCanvas.style.visibility).toBe("visible");
    expect(canvas.dataset.atmosphereRenderer).toBe("webgl2-glyph-atlas");
    expect(canvas.dataset.atmosphereFrameCommit).toBe("rendered");
    expect(fillText).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    const instancesBeforeLoss = lastUploadedInstances(webgl2Contexts[0]!);
    expect(instancesBeforeLoss.length).toBeGreaterThan(0);

    gpuCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));

    // Reduced motion schedules no loop, so without an out-of-band repaint the
    // window would keep showing the abandoned GPU layer and never paint a
    // fallback frame.
    expect(gpuCanvas.dataset.matrixGpuAvailability).toBe("context-lost");
    expect(gpuCanvas.style.visibility).toBe("hidden");
    expect(canvas.dataset.atmosphereRenderer).toBe("canvas2d");
    expect(canvas.dataset.atmosphereTextRasterization).toBe("main-thread");
    expect(canvas.dataset.atmosphereFrameCommit).toBe("canvas2d");
    expect(fillText).toHaveBeenCalled();
    expect(frames.size).toBe(0);

    gpuCanvas.dispatchEvent(new Event("webglcontextrestored"));

    expect(webgl2Contexts).toHaveLength(2);
    expect(gpuCanvas.dataset.matrixGpuAvailability).toBe("available");
    expect(gpuCanvas.style.visibility).toBe("visible");
    expect(canvas.dataset.atmosphereRenderer).toBe("webgl2-glyph-atlas");
    expect(canvas.dataset.atmosphereFrameCommit).toBe("rendered");
    expect(frames.size).toBe(0);
    // The rebuilt backend replays the same scene: the simulation was neither
    // advanced nor reseeded by the backend change.
    expect(Array.from(lastUploadedInstances(webgl2Contexts[1]!))).toEqual(
      Array.from(instancesBeforeLoss),
    );

    await screen.unmount();
  });

  it("withholds the backend repaint while hidden and unfocused without background continuation", async () => {
    scriptedGpu = true;
    testState.settings = { ...testState.settings!, continueBackgroundAnimations: false };
    const screen = await render(<WindowAtmosphere />);
    const gpuCanvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="window-atmosphere-matrix-gpu"]',
    )!;
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="window-atmosphere"]')!;
    const fillText = context.fillText as ReturnType<typeof vi.fn>;

    expect(frames.size).toBe(1);
    const scheduled = Array.from(frames.values())[0]!;
    frames.clear();
    scheduled(1_000);
    expect(canvas.dataset.atmosphereFrameCommit).toBe("rendered");
    expect(frames.size).toBe(1);

    documentVisibility = "hidden";
    windowFocused = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(0);
    expect(gpuCanvas.style.visibility).toBe("hidden");
    const drawsWhileHidden = fillText.mock.calls.length;

    gpuCanvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(gpuCanvas.dataset.matrixGpuAvailability).toBe("context-lost");
    expect(fillText.mock.calls.length).toBe(drawsWhileHidden);
    expect(frames.size).toBe(0);

    gpuCanvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(gpuCanvas.dataset.matrixGpuAvailability).toBe("available");
    // A regained backend does not overrule the background policy, and an
    // uncommitted GPU layer stays hidden.
    expect(gpuCanvas.style.visibility).toBe("hidden");
    expect(fillText.mock.calls.length).toBe(drawsWhileHidden);
    expect(frames.size).toBe(0);

    documentVisibility = "visible";
    windowFocused = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(1);

    await screen.unmount();
  });

  it("does not mount when the server does not expose atmosphere support", async () => {
    testState.atmosphereAvailable = false;
    const screen = await render(<WindowAtmosphere />);

    expect(document.querySelector('[data-testid="window-atmosphere"]')).toBeNull();
    expect(frames.size).toBe(0);

    await screen.unmount();
  });
});
