import { describe, expect, it, vi } from "vitest";

import {
  createMatrixGlyphAtlas,
  createMatrixWebGl2Renderer,
  detectMatrixWebGl2Capability,
  type MatrixGpuFrame,
} from "./matrixWebGlRenderer";

interface FakeAtlasCanvas {
  width: number;
  height: number;
  readonly fillText: ReturnType<typeof vi.fn>;
  readonly measureText: ReturnType<typeof vi.fn>;
  getContext(contextId: "2d"): CanvasRenderingContext2D;
}

function createAtlasCanvas(): FakeAtlasCanvas {
  const fillText = vi.fn();
  const measureText = vi.fn((glyph: string) => ({ width: Math.max(24, glyph.length * 24) }));
  const context = {
    clearRect: vi.fn(),
    fillStyle: "",
    fillText,
    font: "",
    measureText,
    textAlign: "start",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
  return {
    width: 0,
    height: 0,
    fillText,
    measureText,
    getContext: () => context,
  };
}

interface FakeCanvas {
  width: number;
  height: number;
  getContext: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatch(type: "webglcontextlost" | "webglcontextrestored", event?: Event): void;
}

function createCanvas(): FakeCanvas {
  const listeners = new Map<string, EventListener>();
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => null),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    }),
    removeEventListener: vi.fn((type: string) => {
      listeners.delete(type);
    }),
    dispatch(type, event = new Event(type)) {
      listeners.get(type)?.(event);
    },
  };
}

function createWebGl2Context() {
  const constants = {
    ACTIVE_TEXTURE: 0x84e0,
    ARRAY_BUFFER: 0x8892,
    BLEND: 0x0be2,
    CLAMP_TO_EDGE: 0x812f,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8b81,
    CULL_FACE: 0x0b44,
    DEPTH_TEST: 0x0b71,
    DYNAMIC_DRAW: 0x88e8,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8b30,
    LINEAR: 0x2601,
    LINK_STATUS: 0x8b82,
    MAX_TEXTURE_SIZE: 0x0d33,
    MAX_VERTEX_ATTRIBS: 0x8869,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    RGBA: 0x1908,
    SRC_ALPHA: 0x0302,
    STATIC_DRAW: 0x88e4,
    TEXTURE0: 0x84c0,
    TEXTURE_2D: 0x0de1,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLES: 0x0004,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
    UNSIGNED_BYTE: 0x1401,
    VERTEX_SHADER: 0x8b31,
  };
  const gl = {
    ...constants,
    activeTexture: vi.fn(),
    attachShader: vi.fn(),
    bindBuffer: vi.fn(),
    bindTexture: vi.fn(),
    bindVertexArray: vi.fn(),
    blendFuncSeparate: vi.fn(),
    bufferData: vi.fn(),
    bufferSubData: vi.fn(),
    clear: vi.fn(),
    clearColor: vi.fn(),
    compileShader: vi.fn(),
    createBuffer: vi.fn(() => ({})),
    createProgram: vi.fn(() => ({})),
    createShader: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({})),
    createVertexArray: vi.fn(() => ({})),
    deleteBuffer: vi.fn(),
    deleteProgram: vi.fn(),
    deleteShader: vi.fn(),
    deleteTexture: vi.fn(),
    deleteVertexArray: vi.fn(),
    disable: vi.fn(),
    drawArraysInstanced: vi.fn(),
    enable: vi.fn(),
    enableVertexAttribArray: vi.fn(),
    getParameter: vi.fn((parameter: number) =>
      parameter === constants.MAX_TEXTURE_SIZE ? 4_096 : 16,
    ),
    getProgramInfoLog: vi.fn(() => ""),
    getProgramParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ""),
    getShaderParameter: vi.fn(() => true),
    getUniformLocation: vi.fn(() => ({})),
    isContextLost: vi.fn(() => false),
    linkProgram: vi.fn(),
    pixelStorei: vi.fn(),
    shaderSource: vi.fn(),
    texImage2D: vi.fn(),
    texParameteri: vi.fn(),
    uniform1i: vi.fn(),
    uniform2f: vi.fn(),
    useProgram: vi.fn(),
    vertexAttribDivisor: vi.fn(),
    vertexAttribPointer: vi.fn(),
    viewport: vi.fn(),
  };
  return gl as unknown as WebGL2RenderingContext & {
    bufferSubData: ReturnType<typeof vi.fn>;
    blendFuncSeparate: ReturnType<typeof vi.fn>;
    drawArraysInstanced: ReturnType<typeof vi.fn>;
    pixelStorei: ReturnType<typeof vi.fn>;
    texImage2D: ReturnType<typeof vi.fn>;
  };
}

function frame(glyphs: MatrixGpuFrame["glyphs"]): MatrixGpuFrame {
  return {
    width: 800,
    height: 600,
    devicePixelRatio: 2,
    glyphs,
  };
}

const green = { red: 0, green: 1, blue: 0.25, alpha: 0.8 };

describe("Matrix WebGL2 glyph atlas", () => {
  it("deduplicates and bounds CPU-rasterized glyphs with a replacement entry", () => {
    const canvas = createAtlasCanvas();
    const atlas = createMatrixGlyphAtlas(["A", "A", "B", "", "long-token"], {
      createCanvas: () => canvas,
      maxGlyphs: 4,
      maxTextureSize: 256,
    });

    expect(atlas?.entries.map((entry) => entry.glyph)).toEqual(["?", "A", "B", "long-token"]);
    expect(atlas?.width).toBeLessThanOrEqual(256);
    expect(atlas?.height).toBeLessThanOrEqual(256);
    expect(canvas.fillText).toHaveBeenCalledTimes(4);
  });
});

describe("Matrix WebGL2 renderer", () => {
  it("reports a typed Canvas2D fallback without claiming GPU support", () => {
    const canvas = createCanvas();
    expect(
      detectMatrixWebGl2Capability(canvas as unknown as HTMLCanvasElement, () => null),
    ).toEqual({
      supported: false,
      reason: "webgl2-unavailable",
      maxTextureSize: 0,
      maxVertexAttributes: 0,
    });
    expect(
      createMatrixWebGl2Renderer(canvas as unknown as HTMLCanvasElement, ["0", "1"], {
        acquireContext: () => null,
        createCanvas: createAtlasCanvas,
      }),
    ).toEqual({
      kind: "canvas2d-fallback",
      reason: "webgl2-unavailable",
      requiresFreshCanvas: false,
    });
  });

  it("uploads one atlas and renders bounded heads and trails in one instanced GPU draw", () => {
    const canvas = createCanvas();
    const gl = createWebGl2Context();
    const selection = createMatrixWebGl2Renderer(
      canvas as unknown as HTMLCanvasElement,
      ["0", "1"],
      {
        acquireContext: () => gl,
        createCanvas: createAtlasCanvas,
        maxGlyphInstances: 2,
      },
    );
    expect(selection.kind).toBe("webgl2");
    if (selection.kind !== "webgl2") return;

    const result = selection.renderer.render(
      frame([
        { glyph: "0", x: 100, y: 100, fontSizePx: 24, scale: 1, opacity: 1, color: green },
        { glyph: "1", x: 100, y: 124, fontSizePx: 18, scale: 0.75, opacity: 0.5, color: green },
        { glyph: "0", x: 100, y: 148, fontSizePx: 12, scale: 1, opacity: 1, color: green },
      ]),
    );

    expect(result).toEqual({
      status: "rendered",
      renderedGlyphs: 2,
      droppedGlyphs: 1,
      drawCalls: 1,
    });
    expect(gl.texImage2D).toHaveBeenCalledOnce();
    expect(gl.drawArraysInstanced).toHaveBeenCalledWith(gl.TRIANGLES, 0, 6, 2);
    expect(gl.bufferSubData).toHaveBeenCalledWith(
      gl.ARRAY_BUFFER,
      0,
      expect.any(Float32Array),
      0,
      24,
    );
    expect(canvas.width).toBe(1_600);
    expect(canvas.height).toBe(1_200);
  });

  it("uses double-buffered presentation and preserves the Canvas2D token-width bound", () => {
    const canvas = createCanvas();
    const gl = createWebGl2Context();
    canvas.getContext.mockReturnValue(gl);
    const selection = createMatrixWebGl2Renderer(
      canvas as unknown as HTMLCanvasElement,
      ["long-token"],
      {
        createCanvas: createAtlasCanvas,
      },
    );
    expect(canvas.getContext).toHaveBeenCalledWith(
      "webgl2",
      expect.objectContaining({
        desynchronized: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      }),
    );
    expect(selection.kind).toBe("webgl2");
    if (selection.kind !== "webgl2") return;

    selection.renderer.render(
      frame([
        {
          glyph: "long-token",
          x: 100,
          y: 100,
          fontSizePx: 48,
          scale: 1,
          maxWidthPx: 30,
          opacity: 1,
          color: green,
        },
      ]),
    );
    const uploadedInstances = gl.bufferSubData.mock.calls[0]?.[2] as Float32Array;
    // Fake metrics measure this token at 240px in a 48px reference em. The
    // 30px Canvas maxWidth therefore applies a 0.125 horizontal fit to the
    // padded 248px atlas cell, while vertical padding does not shrink the em.
    expect(uploadedInstances[0]).toBeCloseTo(84.5);
    expect(uploadedInstances[1]).toBe(72);
    expect(uploadedInstances[2]).toBeCloseTo(31);
    expect(uploadedInstances[3]).toBe(56);
    expect(gl.pixelStorei).toHaveBeenCalledWith(gl.UNPACK_FLIP_Y_WEBGL, false);
    expect(gl.blendFuncSeparate).toHaveBeenCalledWith(
      gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
      gl.ONE,
      gl.ONE_MINUS_SRC_ALPHA,
    );
  });

  it("keeps bounded 32-codepoint live-work tokens addressable in the atlas", () => {
    const canvas = createCanvas();
    const gl = createWebGl2Context();
    const longToken = "1234567890abcdefghijklmnopqrstuv";
    const selection = createMatrixWebGl2Renderer(
      canvas as unknown as HTMLCanvasElement,
      [longToken],
      {
        acquireContext: () => gl,
        createCanvas: createAtlasCanvas,
      },
    );
    expect(selection.kind).toBe("webgl2");
    if (selection.kind !== "webgl2") return;

    expect(selection.renderer.atlas.entryByGlyph.has(longToken)).toBe(true);
    selection.renderer.render(
      frame([
        {
          glyph: longToken,
          x: 100,
          y: 100,
          fontSizePx: 18,
          scale: 1,
          maxWidthPx: 144,
          opacity: 1,
          color: green,
        },
      ]),
    );
    const uploadedInstances = gl.bufferSubData.mock.calls[0]?.[2] as Float32Array;
    expect(uploadedInstances[2]).toBeGreaterThan(144);
    // The visible glyph body, excluding the padded atlas cell, is 144px.
    expect(uploadedInstances[2]).toBeLessThan(148);
  });

  it("renders an unconstrained Walk label at its natural atlas aspect ratio", () => {
    const canvas = createCanvas();
    const gl = createWebGl2Context();
    const label = "very-long-file-name.ts";
    const selection = createMatrixWebGl2Renderer(canvas as unknown as HTMLCanvasElement, [label], {
      acquireContext: () => gl,
      createCanvas: createAtlasCanvas,
    });
    expect(selection.kind).toBe("webgl2");
    if (selection.kind !== "webgl2") return;

    selection.renderer.render(
      frame([
        {
          glyph: label,
          x: 200,
          y: 100,
          fontSizePx: 18,
          scale: 1,
          opacity: 1,
          color: green,
        },
      ]),
    );

    const uploadedInstances = gl.bufferSubData.mock.calls[0]?.[2] as Float32Array;
    const renderedWidth = uploadedInstances[2]!;
    const renderedHeight = uploadedInstances[3]!;
    expect(renderedWidth).toBeGreaterThan(180);
    expect(renderedHeight).toBe(21);
    expect(renderedWidth / renderedHeight).toBeGreaterThan(8);
  });

  it("prevents default context loss and rebuilds GPU resources after restoration", () => {
    const canvas = createCanvas();
    const firstContext = createWebGl2Context();
    const restoredContext = createWebGl2Context();
    const acquireContext = vi
      .fn<() => WebGL2RenderingContext | null>()
      .mockReturnValueOnce(firstContext)
      .mockReturnValue(restoredContext);
    const availability = vi.fn();
    const selection = createMatrixWebGl2Renderer(canvas as unknown as HTMLCanvasElement, ["0"], {
      acquireContext,
      createCanvas: createAtlasCanvas,
      onAvailabilityChange: availability,
    });
    expect(selection.kind).toBe("webgl2");
    if (selection.kind !== "webgl2") return;

    const preventDefault = vi.fn();
    canvas.dispatch("webglcontextlost", { preventDefault } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(selection.renderer.render(frame([])).status).toBe("context-lost");
    expect(availability).toHaveBeenLastCalledWith("context-lost");

    canvas.dispatch("webglcontextrestored");
    expect(restoredContext.texImage2D).toHaveBeenCalledOnce();
    expect(availability).toHaveBeenLastCalledWith("available");
    expect(selection.renderer.render(frame([])).status).toBe("empty");

    selection.renderer.dispose();
    expect(canvas.removeEventListener).toHaveBeenCalledTimes(2);
    expect(selection.renderer.render(frame([])).status).toBe("disposed");
  });
});
