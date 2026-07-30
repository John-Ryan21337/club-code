const DEFAULT_MAX_GLYPH_INSTANCES = 8_192;
const MAX_GLYPH_INSTANCES = 16_384;
const DEFAULT_MAX_ATLAS_GLYPHS = 1_024;
const MAX_ATLAS_GLYPHS = 2_048;
const MAX_ATLAS_TOKEN_CODEPOINTS = 16;
const DEFAULT_ATLAS_FONT_SIZE_PX = 48;
const DEFAULT_ATLAS_PADDING_PX = 4;
const DEFAULT_MAX_DEVICE_PIXEL_RATIO = 2;
const DEFAULT_MAX_BACKING_PIXELS = 8_388_608;
const INSTANCE_FLOATS = 12;
const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const REPLACEMENT_GLYPH = "?";

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_rect;
layout(location = 2) in vec4 a_uv_rect;
layout(location = 3) in vec4 a_color;

uniform vec2 u_resolution;

out vec2 v_uv;
out vec4 v_color;

void main() {
  vec2 pixel = a_rect.xy + a_corner * a_rect.zw;
  vec2 clip = pixel / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  v_uv = mix(a_uv_rect.xy, a_uv_rect.zw, a_corner);
  v_color = a_color;
}`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

uniform sampler2D u_atlas;

in vec2 v_uv;
in vec4 v_color;

out vec4 out_color;

void main() {
  float coverage = texture(u_atlas, v_uv).a;
  out_color = vec4(v_color.rgb, v_color.a * coverage);
}`;

interface MatrixAtlasCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): CanvasRenderingContext2D | null;
}

export interface MatrixGlyphAtlasEntry {
  readonly glyph: string;
  readonly index: number;
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  readonly aspectRatio: number;
}

export interface MatrixGlyphAtlas {
  readonly source: TexImageSource;
  readonly width: number;
  readonly height: number;
  readonly entries: readonly MatrixGlyphAtlasEntry[];
  readonly entryByGlyph: ReadonlyMap<string, MatrixGlyphAtlasEntry>;
  readonly replacementEntry: MatrixGlyphAtlasEntry;
}

export interface CreateMatrixGlyphAtlasOptions {
  readonly fontFamily?: string;
  readonly fontWeight?: string;
  readonly referenceFontSizePx?: number;
  readonly paddingPx?: number;
  readonly maxTextureSize?: number;
  readonly maxGlyphs?: number;
  readonly createCanvas?: () => MatrixAtlasCanvas;
}

export interface MatrixGpuColor {
  /** Linearized color is not required; values are bounded normalized sRGB channels. */
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/**
 * One glyph head or trail cell. Coordinates and font size use CSS pixels.
 * `x` and `y` are the center of the glyph, matching Canvas2D text positioning.
 */
export interface MatrixGpuGlyph {
  readonly glyph: string | number;
  readonly x: number;
  readonly y: number;
  readonly fontSizePx: number;
  readonly scale: number;
  /** Canvas2D-compatible horizontal fit for bounded multi-character tokens. */
  readonly maxWidthPx?: number;
  readonly opacity: number;
  readonly color: MatrixGpuColor;
}

export interface MatrixGpuFrame {
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly glyphs: readonly MatrixGpuGlyph[];
}

export interface MatrixGpuRenderResult {
  readonly status: "rendered" | "empty" | "context-lost" | "disposed";
  readonly renderedGlyphs: number;
  readonly droppedGlyphs: number;
  readonly drawCalls: 0 | 1;
}

export type MatrixGpuAvailability = "available" | "context-lost" | "unavailable";

export interface CreateMatrixWebGl2RendererOptions extends CreateMatrixGlyphAtlasOptions {
  readonly maxGlyphInstances?: number;
  readonly maxDevicePixelRatio?: number;
  readonly maxBackingPixels?: number;
  readonly onAvailabilityChange?: (availability: MatrixGpuAvailability) => void;
  /** Test seam; production callers should use the canvas WebGL2 context. */
  readonly acquireContext?: (canvas: HTMLCanvasElement) => WebGL2RenderingContext | null;
}

export type MatrixWebGl2FallbackReason =
  | "webgl2-unavailable"
  | "insufficient-capability"
  | "atlas-unavailable"
  | "gpu-initialization-failed";

export interface MatrixCanvas2dFallback {
  readonly kind: "canvas2d-fallback";
  readonly reason: MatrixWebGl2FallbackReason;
  /**
   * The caller owns the existing Canvas2D renderer. If WebGL acquisition was
   * attempted on a dedicated canvas, discard that canvas before falling back:
   * browsers do not allow one canvas to switch context types reliably.
   */
  readonly requiresFreshCanvas: boolean;
}

export interface MatrixWebGl2Selection {
  readonly kind: "webgl2";
  readonly renderer: MatrixWebGl2Renderer;
}

export type MatrixRendererSelection = MatrixWebGl2Selection | MatrixCanvas2dFallback;

export interface MatrixWebGl2Capability {
  readonly supported: boolean;
  readonly reason: MatrixWebGl2FallbackReason | null;
  readonly maxTextureSize: number;
  readonly maxVertexAttributes: number;
}

interface MatrixGpuResources {
  readonly program: WebGLProgram;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly quadBuffer: WebGLBuffer;
  readonly instanceBuffer: WebGLBuffer;
  readonly texture: WebGLTexture;
  readonly resolutionLocation: WebGLUniformLocation;
  readonly atlasLocation: WebGLUniformLocation;
}

interface MatrixAtlasPlacement {
  readonly glyph: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

function toPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.max(1, Math.min(maximum, Math.floor(value)));
}

function defaultAtlasCanvas(): MatrixAtlasCanvas | null {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(1, 1) as unknown as MatrixAtlasCanvas;
  }
  if (typeof document === "undefined") return null;
  return document.createElement("canvas");
}

function boundedGlyphs(glyphs: Iterable<string>, maxGlyphs: number): string[] {
  const result = [REPLACEMENT_GLYPH];
  const seen = new Set(result);
  for (const rawGlyph of glyphs) {
    if (result.length >= maxGlyphs) break;
    const glyph = Array.from(rawGlyph).slice(0, MAX_ATLAS_TOKEN_CODEPOINTS).join("");
    if (glyph.length === 0 || seen.has(glyph)) continue;
    seen.add(glyph);
    result.push(glyph);
  }
  return result;
}

/**
 * Rasterizes a bounded immutable glyph atlas on the CPU. The resulting source
 * remains alive so a lost WebGL context can re-upload it without rerasterizing
 * or consulting application state.
 */
export function createMatrixGlyphAtlas(
  glyphs: Iterable<string>,
  options: CreateMatrixGlyphAtlasOptions = {},
): MatrixGlyphAtlas | null {
  const maxTextureSize = toPositiveInteger(options.maxTextureSize, 4_096, 16_384);
  const maxGlyphs = toPositiveInteger(
    options.maxGlyphs,
    DEFAULT_MAX_ATLAS_GLYPHS,
    MAX_ATLAS_GLYPHS,
  );
  const fontSize = toPositiveInteger(options.referenceFontSizePx, DEFAULT_ATLAS_FONT_SIZE_PX, 128);
  const padding = toPositiveInteger(options.paddingPx, DEFAULT_ATLAS_PADDING_PX, 16);
  const fontFamily =
    options.fontFamily ?? "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  const fontWeight = options.fontWeight ?? "400";
  const canvas = options.createCanvas?.() ?? defaultAtlasCanvas();
  if (!canvas) return null;

  canvas.width = 1;
  canvas.height = 1;
  const scratchContext = canvas.getContext("2d");
  if (!scratchContext) return null;
  scratchContext.font = `${fontWeight} ${fontSize}px ${fontFamily}`;

  const candidates = boundedGlyphs(glyphs, maxGlyphs);
  const cellHeight = Math.min(maxTextureSize, fontSize + padding * 2);
  const glyphWidths = candidates.map((glyph) =>
    Math.min(
      maxTextureSize,
      Math.max(1, Math.ceil(scratchContext.measureText(glyph).width + padding * 2)),
    ),
  );
  const maximumGlyphWidth = Math.max(...glyphWidths);
  const totalArea = glyphWidths.reduce((area, width) => area + width * cellHeight, 0);
  const rowWidth = Math.min(
    maxTextureSize,
    Math.max(maximumGlyphWidth, Math.ceil(Math.sqrt(totalArea))),
  );
  const placements: MatrixAtlasPlacement[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let usedWidth = 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const width = glyphWidths[index]!;
    if (cursorX > 0 && cursorX + width > rowWidth) {
      cursorX = 0;
      cursorY += cellHeight;
    }
    if (cursorY + cellHeight > maxTextureSize) break;
    placements.push({ glyph: candidates[index]!, x: cursorX, y: cursorY, width });
    cursorX += width;
    usedWidth = Math.max(usedWidth, cursorX);
  }
  if (placements.length === 0) return null;

  canvas.width = usedWidth;
  canvas.height = cursorY + cellHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#ffffff";
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  const entries: MatrixGlyphAtlasEntry[] = [];
  const entryByGlyph = new Map<string, MatrixGlyphAtlasEntry>();
  placements.forEach((placement, index) => {
    context.fillText(
      placement.glyph,
      placement.x + placement.width / 2,
      placement.y + cellHeight / 2,
    );
    const entry: MatrixGlyphAtlasEntry = {
      glyph: placement.glyph,
      index,
      u0: placement.x / canvas.width,
      v0: placement.y / canvas.height,
      u1: (placement.x + placement.width) / canvas.width,
      v1: (placement.y + cellHeight) / canvas.height,
      aspectRatio: placement.width / cellHeight,
    };
    entries.push(entry);
    entryByGlyph.set(placement.glyph, entry);
  });

  const replacementEntry = entries[0];
  if (!replacementEntry) return null;
  return {
    source: canvas as unknown as TexImageSource,
    width: canvas.width,
    height: canvas.height,
    entries,
    entryByGlyph,
    replacementEntry,
  };
}

function acquireDefaultContext(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
  return canvas.getContext("webgl2", {
    alpha: true,
    antialias: false,
    depth: false,
    // Ordinary double-buffered presentation is intentional. Front-buffer
    // desynchronization can expose incomplete clears during compositor churn.
    desynchronized: false,
    failIfMajorPerformanceCaveat: true,
    powerPreference: "high-performance",
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    stencil: false,
  });
}

function readPositiveLimit(gl: WebGL2RenderingContext, parameter: number): number {
  const value: unknown = gl.getParameter(parameter);
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function inspectContext(gl: WebGL2RenderingContext): MatrixWebGl2Capability {
  const maxTextureSize = readPositiveLimit(gl, gl.MAX_TEXTURE_SIZE);
  const maxVertexAttributes = readPositiveLimit(gl, gl.MAX_VERTEX_ATTRIBS);
  const supported = maxTextureSize >= 256 && maxVertexAttributes >= 4;
  return {
    supported,
    reason: supported ? null : "insufficient-capability",
    maxTextureSize,
    maxVertexAttributes,
  };
}

/**
 * Capability probing is intentionally separate from renderer creation so an
 * integration can probe a disposable canvas and leave its Canvas2D surface
 * untouched when WebGL2 is unavailable.
 */
export function detectMatrixWebGl2Capability(
  canvas: HTMLCanvasElement,
  acquireContext: (
    canvas: HTMLCanvasElement,
  ) => WebGL2RenderingContext | null = acquireDefaultContext,
): MatrixWebGl2Capability {
  const gl = acquireContext(canvas);
  if (!gl) {
    return {
      supported: false,
      reason: "webgl2-unavailable",
      maxTextureSize: 0,
      maxVertexAttributes: 0,
    };
  }
  return inspectContext(gl);
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Matrix WebGL shader allocation failed.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const diagnostic = gl.getShaderInfoLog(shader) ?? "unknown shader error";
    gl.deleteShader(shader);
    throw new Error(`Matrix WebGL shader compilation failed: ${diagnostic}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  let fragmentShader: WebGLShader;
  try {
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
  } catch (error) {
    gl.deleteShader(vertexShader);
    throw error;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error("Matrix WebGL program allocation failed.");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const diagnostic = gl.getProgramInfoLog(program) ?? "unknown link error";
    gl.deleteProgram(program);
    throw new Error(`Matrix WebGL program link failed: ${diagnostic}`);
  }
  return program;
}

function deleteResources(gl: WebGL2RenderingContext, resources: MatrixGpuResources | null): void {
  if (!resources) return;
  gl.deleteTexture(resources.texture);
  gl.deleteBuffer(resources.instanceBuffer);
  gl.deleteBuffer(resources.quadBuffer);
  gl.deleteVertexArray(resources.vertexArray);
  gl.deleteProgram(resources.program);
}

function initializeResources(
  gl: WebGL2RenderingContext,
  atlas: MatrixGlyphAtlas,
  maxGlyphInstances: number,
): MatrixGpuResources {
  const program = createProgram(gl);
  const vertexArray = gl.createVertexArray();
  const quadBuffer = gl.createBuffer();
  const instanceBuffer = gl.createBuffer();
  const texture = gl.createTexture();
  const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
  const atlasLocation = gl.getUniformLocation(program, "u_atlas");
  if (
    !vertexArray ||
    !quadBuffer ||
    !instanceBuffer ||
    !texture ||
    !resolutionLocation ||
    !atlasLocation
  ) {
    if (texture) gl.deleteTexture(texture);
    if (instanceBuffer) gl.deleteBuffer(instanceBuffer);
    if (quadBuffer) gl.deleteBuffer(quadBuffer);
    if (vertexArray) gl.deleteVertexArray(vertexArray);
    gl.deleteProgram(program);
    throw new Error("Matrix WebGL resource allocation failed.");
  }

  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, maxGlyphInstances * INSTANCE_STRIDE_BYTES, gl.DYNAMIC_DRAW);
  for (let attribute = 1; attribute <= 3; attribute += 1) {
    gl.enableVertexAttribArray(attribute);
    gl.vertexAttribPointer(
      attribute,
      4,
      gl.FLOAT,
      false,
      INSTANCE_STRIDE_BYTES,
      (attribute - 1) * 4 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.vertexAttribDivisor(attribute, 1);
  }

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.source);

  gl.useProgram(program);
  gl.uniform1i(atlasLocation, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.bindVertexArray(null);

  return {
    program,
    vertexArray,
    quadBuffer,
    instanceBuffer,
    texture,
    resolutionLocation,
    atlasLocation,
  };
}

function resolveAtlasEntry(atlas: MatrixGlyphAtlas, glyph: string | number): MatrixGlyphAtlasEntry {
  if (typeof glyph === "number") {
    return atlas.entries[Math.floor(glyph)] ?? atlas.replacementEntry;
  }
  return atlas.entryByGlyph.get(glyph) ?? atlas.replacementEntry;
}

function isRenderableGlyph(glyph: MatrixGpuGlyph): boolean {
  return (
    Number.isFinite(glyph.x) &&
    Number.isFinite(glyph.y) &&
    Number.isFinite(glyph.fontSizePx) &&
    glyph.fontSizePx > 0 &&
    Number.isFinite(glyph.scale) &&
    glyph.scale > 0 &&
    Number.isFinite(glyph.opacity) &&
    glyph.opacity > 0
  );
}

export class MatrixWebGl2Renderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #atlas: MatrixGlyphAtlas;
  readonly #maxGlyphInstances: number;
  readonly #maxDevicePixelRatio: number;
  readonly #maxBackingPixels: number;
  readonly #instanceData: Float32Array;
  readonly #acquireContext: (canvas: HTMLCanvasElement) => WebGL2RenderingContext | null;
  readonly #onAvailabilityChange: ((availability: MatrixGpuAvailability) => void) | undefined;
  #gl: WebGL2RenderingContext;
  #resources: MatrixGpuResources | null;
  #contextLost = false;
  #disposed = false;

  readonly #handleContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.#disposed) return;
    this.#contextLost = true;
    this.#resources = null;
    this.#onAvailabilityChange?.("context-lost");
  };

  readonly #handleContextRestored = (): void => {
    if (this.#disposed) return;
    const gl = this.#acquireContext(this.#canvas);
    if (!gl) {
      this.#contextLost = true;
      this.#onAvailabilityChange?.("unavailable");
      return;
    }
    try {
      this.#gl = gl;
      this.#resources = initializeResources(gl, this.#atlas, this.#maxGlyphInstances);
      this.#contextLost = false;
      this.#onAvailabilityChange?.("available");
    } catch {
      this.#resources = null;
      this.#contextLost = true;
      this.#onAvailabilityChange?.("unavailable");
    }
  };

  constructor(
    canvas: HTMLCanvasElement,
    gl: WebGL2RenderingContext,
    atlas: MatrixGlyphAtlas,
    maxGlyphInstances: number,
    maxDevicePixelRatio: number,
    maxBackingPixels: number,
    acquireContext: (canvas: HTMLCanvasElement) => WebGL2RenderingContext | null,
    onAvailabilityChange?: (availability: MatrixGpuAvailability) => void,
  ) {
    this.#canvas = canvas;
    this.#gl = gl;
    this.#atlas = atlas;
    this.#maxGlyphInstances = maxGlyphInstances;
    this.#maxDevicePixelRatio = maxDevicePixelRatio;
    this.#maxBackingPixels = maxBackingPixels;
    this.#instanceData = new Float32Array(maxGlyphInstances * INSTANCE_FLOATS);
    this.#acquireContext = acquireContext;
    this.#onAvailabilityChange = onAvailabilityChange;
    this.#resources = initializeResources(gl, atlas, maxGlyphInstances);
    canvas.addEventListener("webglcontextlost", this.#handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.#handleContextRestored);
  }

  get maxGlyphInstances(): number {
    return this.#maxGlyphInstances;
  }

  get atlas(): MatrixGlyphAtlas {
    return this.#atlas;
  }

  render(frame: MatrixGpuFrame): MatrixGpuRenderResult {
    if (this.#disposed) {
      return {
        status: "disposed",
        renderedGlyphs: 0,
        droppedGlyphs: frame.glyphs.length,
        drawCalls: 0,
      };
    }
    if (this.#contextLost || this.#gl.isContextLost() || !this.#resources) {
      return {
        status: "context-lost",
        renderedGlyphs: 0,
        droppedGlyphs: frame.glyphs.length,
        drawCalls: 0,
      };
    }

    const width = Math.max(1, Number.isFinite(frame.width) ? frame.width : 1);
    const height = Math.max(1, Number.isFinite(frame.height) ? frame.height : 1);
    const requestedDpr = clamp(frame.devicePixelRatio, 1, this.#maxDevicePixelRatio);
    const fittedDpr = Math.min(
      requestedDpr,
      Math.sqrt(this.#maxBackingPixels / Math.max(1, width * height)),
    );
    const backingWidth = Math.max(1, Math.round(width * fittedDpr));
    const backingHeight = Math.max(1, Math.round(height * fittedDpr));
    if (this.#canvas.width !== backingWidth) this.#canvas.width = backingWidth;
    if (this.#canvas.height !== backingHeight) this.#canvas.height = backingHeight;

    let renderedGlyphs = 0;
    let droppedGlyphs = 0;
    for (const glyph of frame.glyphs) {
      if (renderedGlyphs >= this.#maxGlyphInstances || !isRenderableGlyph(glyph)) {
        droppedGlyphs += 1;
        continue;
      }
      const entry = resolveAtlasEntry(this.#atlas, glyph.glyph);
      const fontSize = glyph.fontSizePx * glyph.scale;
      const naturalGlyphWidth = fontSize * entry.aspectRatio;
      const glyphWidth =
        Number.isFinite(glyph.maxWidthPx) && (glyph.maxWidthPx ?? 0) > 0
          ? Math.min(naturalGlyphWidth, glyph.maxWidthPx!)
          : naturalGlyphWidth;
      const offset = renderedGlyphs * INSTANCE_FLOATS;
      this.#instanceData[offset] = glyph.x - glyphWidth / 2;
      this.#instanceData[offset + 1] = glyph.y - fontSize / 2;
      this.#instanceData[offset + 2] = glyphWidth;
      this.#instanceData[offset + 3] = fontSize;
      this.#instanceData[offset + 4] = entry.u0;
      this.#instanceData[offset + 5] = entry.v0;
      this.#instanceData[offset + 6] = entry.u1;
      this.#instanceData[offset + 7] = entry.v1;
      this.#instanceData[offset + 8] = clamp(glyph.color.red, 0, 1);
      this.#instanceData[offset + 9] = clamp(glyph.color.green, 0, 1);
      this.#instanceData[offset + 10] = clamp(glyph.color.blue, 0, 1);
      this.#instanceData[offset + 11] = clamp(glyph.color.alpha, 0, 1) * clamp(glyph.opacity, 0, 1);
      renderedGlyphs += 1;
    }

    const gl = this.#gl;
    const resources = this.#resources;
    gl.viewport(0, 0, backingWidth, backingHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (renderedGlyphs === 0) {
      return { status: "empty", renderedGlyphs: 0, droppedGlyphs, drawCalls: 0 };
    }

    gl.useProgram(resources.program);
    gl.uniform2f(resources.resolutionLocation, width, height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resources.texture);
    gl.bindVertexArray(resources.vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.#instanceData, 0, renderedGlyphs * INSTANCE_FLOATS);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, renderedGlyphs);
    gl.bindVertexArray(null);
    return { status: "rendered", renderedGlyphs, droppedGlyphs, drawCalls: 1 };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#canvas.removeEventListener("webglcontextlost", this.#handleContextLost);
    this.#canvas.removeEventListener("webglcontextrestored", this.#handleContextRestored);
    if (!this.#contextLost) deleteResources(this.#gl, this.#resources);
    this.#resources = null;
  }
}

export function createMatrixWebGl2Renderer(
  canvas: HTMLCanvasElement,
  glyphs: Iterable<string>,
  options: CreateMatrixWebGl2RendererOptions = {},
): MatrixRendererSelection {
  const acquireContext = options.acquireContext ?? acquireDefaultContext;
  const gl = acquireContext(canvas);
  if (!gl) {
    return {
      kind: "canvas2d-fallback",
      reason: "webgl2-unavailable",
      requiresFreshCanvas: false,
    };
  }

  const capability = inspectContext(gl);
  if (!capability.supported) {
    return {
      kind: "canvas2d-fallback",
      reason: "insufficient-capability",
      requiresFreshCanvas: true,
    };
  }
  const atlas = createMatrixGlyphAtlas(glyphs, {
    ...options,
    maxTextureSize: Math.min(
      capability.maxTextureSize,
      toPositiveInteger(options.maxTextureSize, capability.maxTextureSize, 16_384),
    ),
  });
  if (!atlas) {
    return {
      kind: "canvas2d-fallback",
      reason: "atlas-unavailable",
      requiresFreshCanvas: true,
    };
  }

  const maxGlyphInstances = toPositiveInteger(
    options.maxGlyphInstances,
    DEFAULT_MAX_GLYPH_INSTANCES,
    MAX_GLYPH_INSTANCES,
  );
  const maxDevicePixelRatio = clamp(
    options.maxDevicePixelRatio ?? DEFAULT_MAX_DEVICE_PIXEL_RATIO,
    1,
    4,
  );
  const maxBackingPixels = toPositiveInteger(
    options.maxBackingPixels,
    DEFAULT_MAX_BACKING_PIXELS,
    33_554_432,
  );
  try {
    return {
      kind: "webgl2",
      renderer: new MatrixWebGl2Renderer(
        canvas,
        gl,
        atlas,
        maxGlyphInstances,
        maxDevicePixelRatio,
        maxBackingPixels,
        acquireContext,
        options.onAvailabilityChange,
      ),
    };
  } catch {
    return {
      kind: "canvas2d-fallback",
      reason: "gpu-initialization-failed",
      requiresFreshCanvas: true,
    };
  }
}
