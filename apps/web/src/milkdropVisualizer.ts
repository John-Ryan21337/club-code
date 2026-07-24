import type { ButterchurnPreset, ButterchurnVisualizer } from "butterchurn";

export const MILKDROP_MAX_DPR = 2;
export const MILKDROP_MAX_CANVAS_EDGE = 4_096;
export const MILKDROP_MAX_CANVAS_PIXELS = 4_194_304;
export const MILKDROP_DEFAULT_BLEND_SECONDS = 4;
export const MILKDROP_DEFAULT_CYCLE_SECONDS = 30;
export const MILKDROP_DEFAULT_MAX_FPS = 60;

const MIN_CYCLE_SECONDS = 3;
const MAX_CYCLE_SECONDS = 3_600;
const MAX_BLEND_SECONDS = 30;
const MAX_FPS = 60;

export interface MilkdropPresetSource {
  readonly packName: string;
  readonly presets: Readonly<Record<string, ButterchurnPreset>>;
}

export interface MilkdropPresetCatalog {
  readonly names: readonly string[];
  readonly presets: ReadonlyMap<string, ButterchurnPreset>;
  readonly sourceByName: ReadonlyMap<string, string>;
}

export interface MilkdropCanvasSize {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export type MilkdropVisualizerFailureCode =
  | "invalid-input"
  | "unsupported"
  | "load-failed"
  | "initialization-failed"
  | "audio-connection-failed"
  | "preset-failed"
  | "resize-failed"
  | "render-failed"
  | "context-lost";

export interface MilkdropVisualizerFailure {
  readonly code: MilkdropVisualizerFailureCode;
  readonly message: string;
}

export interface MilkdropAutoCycleOptions {
  readonly enabled: boolean;
  readonly intervalSeconds?: number;
  readonly blendDurationSeconds?: number;
}

export interface MilkdropVisualizerPlatform {
  readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame: (handle: number) => void;
  readonly now: () => number;
  readonly devicePixelRatio: () => number;
  readonly random: () => number;
}

export interface ActivateMilkdropVisualizerOptions {
  readonly audioContext: AudioContext;
  /**
   * Any AudioNode in the supplied context is valid, including an AnalyserNode.
   * Butterchurn adds a targeted analysis branch; it does not replace the
   * caller-owned audible graph.
   */
  readonly audioSource: AudioNode;
  readonly canvas: HTMLCanvasElement;
  readonly initialPresetName?: string;
  readonly blendDurationSeconds?: number;
  readonly autoCycle?: boolean;
  readonly cycleIntervalSeconds?: number;
  readonly autoStart?: boolean;
  readonly maxFramesPerSecond?: number;
  readonly onPresetChange?: (presetName: string) => void;
  readonly onError?: (failure: MilkdropVisualizerFailure) => void;
  /** Runs only after a successful frame on MilkDrop's existing RAF. */
  readonly onRenderFrame?: (timestamp: number) => void;
  readonly platform?: MilkdropVisualizerPlatform;
}

export type MilkdropVisualizerActivation =
  | {
      readonly ok: true;
      readonly controller: MilkdropVisualizerController;
    }
  | {
      readonly ok: false;
      readonly error: MilkdropVisualizerFailure;
    };

const defaultPlatform: MilkdropVisualizerPlatform = {
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  now: () => performance.now(),
  devicePixelRatio: () => window.devicePixelRatio,
  random: () => Math.random(),
};

function finiteNumberInRange(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * Locale-independent ordering keeps preset navigation stable across browser,
 * desktop, and test environments.
 */
export function compareMilkdropPresetNames(left: string, right: string): number {
  const foldedLeft = left.toLowerCase();
  const foldedRight = right.toLowerCase();
  if (foldedLeft < foldedRight) return -1;
  if (foldedLeft > foldedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Packs are applied in caller order and the first occurrence wins. A Map is
 * intentional here: preset names are third-party data and must not become
 * magic object keys such as "__proto__".
 */
export function mergeMilkdropPresetPacks(
  sources: readonly MilkdropPresetSource[],
): MilkdropPresetCatalog {
  const presets = new Map<string, ButterchurnPreset>();
  const sourceByName = new Map<string, string>();

  for (const source of sources) {
    for (const [name, preset] of Object.entries(source.presets)) {
      if (name.length === 0 || presets.has(name)) continue;
      presets.set(name, preset);
      sourceByName.set(name, source.packName);
    }
  }

  const names = [...presets.keys()].toSorted(compareMilkdropPresetNames);
  return { names, presets, sourceByName };
}

export function adjacentMilkdropPresetName(
  names: readonly string[],
  currentName: string | null,
  direction: -1 | 1,
): string | null {
  if (names.length === 0) return null;
  const currentIndex = currentName === null ? -1 : names.indexOf(currentName);
  if (currentIndex < 0) {
    return direction === 1 ? (names[0] ?? null) : (names.at(-1) ?? null);
  }
  return names[(currentIndex + direction + names.length) % names.length] ?? null;
}

export function randomMilkdropPresetName(
  names: readonly string[],
  currentName: string | null,
  random: () => number = Math.random,
): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return names[0] ?? null;

  const currentIndex = currentName === null ? -1 : names.indexOf(currentName);
  const rawRandom = random();
  const normalizedRandom = Number.isFinite(rawRandom)
    ? Math.min(0.999_999_999, Math.max(0, rawRandom))
    : 0;

  if (currentIndex < 0) {
    return names[Math.floor(normalizedRandom * names.length)] ?? names[0] ?? null;
  }

  // Select from n - 1 slots, then skip the current slot. Random cycling never
  // spends a full blend reloading the preset that is already visible.
  const candidateIndex = Math.floor(normalizedRandom * (names.length - 1));
  const resolvedIndex = candidateIndex >= currentIndex ? candidateIndex + 1 : candidateIndex;
  return names[resolvedIndex] ?? names[0] ?? null;
}

export function fitMilkdropCanvas(
  cssWidth: number,
  cssHeight: number,
  requestedDpr: number,
): MilkdropCanvasSize {
  if (
    !Number.isFinite(cssWidth) ||
    !Number.isFinite(cssHeight) ||
    cssWidth <= 0 ||
    cssHeight <= 0
  ) {
    return { width: 1, height: 1, dpr: 1 };
  }

  const boundedDpr = Math.min(
    MILKDROP_MAX_DPR,
    Math.max(1, Number.isFinite(requestedDpr) ? requestedDpr : 1),
  );
  const edgeDpr = Math.min(
    boundedDpr,
    MILKDROP_MAX_CANVAS_EDGE / cssWidth,
    MILKDROP_MAX_CANVAS_EDGE / cssHeight,
  );
  const pixelDpr = Math.sqrt(MILKDROP_MAX_CANVAS_PIXELS / (cssWidth * cssHeight));
  // Do not impose a DPR floor after applying resource ceilings: an accidental
  // giant layout must not allocate an equally giant GPU texture.
  const dpr = Math.min(edgeDpr, pixelDpr);
  return {
    width: Math.max(1, Math.floor(cssWidth * dpr)),
    height: Math.max(1, Math.floor(cssHeight * dpr)),
    dpr,
  };
}

function failure(code: MilkdropVisualizerFailureCode, message: string): MilkdropVisualizerFailure {
  // Do not copy arbitrary third-party exception strings into UI-visible state.
  return { code, message };
}

function supportsWebGl2(canvas: HTMLCanvasElement): boolean {
  try {
    const probe = canvas.ownerDocument.createElement("canvas");
    const context = probe.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    });
    if (!context) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function releaseWebGlContext(canvas: HTMLCanvasElement): void {
  try {
    canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    // Cleanup remains safe after browser/GPU teardown.
  }
}

let milkdropRuntimePromise: Promise<{
  readonly createVisualizer: (
    audioContext: AudioContext,
    canvas: HTMLCanvasElement,
    options: { readonly width: number; readonly height: number; readonly pixelRatio: number },
  ) => ButterchurnVisualizer;
  readonly catalog: MilkdropPresetCatalog;
}> | null = null;

async function loadMilkdropRuntime(): Promise<{
  readonly createVisualizer: (
    audioContext: AudioContext,
    canvas: HTMLCanvasElement,
    options: { readonly width: number; readonly height: number; readonly pixelRatio: number },
  ) => ButterchurnVisualizer;
  readonly catalog: MilkdropPresetCatalog;
}> {
  if (milkdropRuntimePromise !== null) return milkdropRuntimePromise;
  milkdropRuntimePromise = loadMilkdropRuntimeUncached().catch((error: unknown) => {
    milkdropRuntimePromise = null;
    throw error;
  });
  return milkdropRuntimePromise;
}

async function loadMilkdropRuntimeUncached(): Promise<{
  readonly createVisualizer: (
    audioContext: AudioContext,
    canvas: HTMLCanvasElement,
    options: { readonly width: number; readonly height: number; readonly pixelRatio: number },
  ) => ButterchurnVisualizer;
  readonly catalog: MilkdropPresetCatalog;
}> {
  // Keep every multi-hundred-kilobyte UMD bundle behind explicit activation.
  // Literal specifiers let Vite produce independently cached local chunks;
  // this path never fetches scripts or presets from the network.
  const [engineModule, main, extra, extra2, md1, minimal, nonMinimal] = await Promise.all([
    import("butterchurn"),
    import("butterchurn-presets"),
    import("butterchurn-presets/lib/butterchurnPresetsExtra.min.js"),
    import("butterchurn-presets/lib/butterchurnPresetsExtra2.min.js"),
    import("butterchurn-presets/lib/butterchurnPresetsMD1.min.js"),
    import("butterchurn-presets/lib/butterchurnPresetsMinimal.min.js"),
    import("butterchurn-presets/lib/butterchurnPresetsNonMinimal.min.js"),
  ]);

  const sources = [
    { packName: "main", presets: main.default.getPresets() },
    { packName: "Extra", presets: extra.default.getPresets() },
    { packName: "Extra2", presets: extra2.default.getPresets() },
    { packName: "MD1", presets: md1.default.getPresets() },
    { packName: "Minimal", presets: minimal.default.getPresets() },
    { packName: "NonMinimal", presets: nonMinimal.default.getPresets() },
  ] satisfies readonly MilkdropPresetSource[];

  return {
    createVisualizer: engineModule.default.createVisualizer,
    catalog: mergeMilkdropPresetPacks(sources),
  };
}

/**
 * Loads only bundled, local chunks and returns a stable read-only name list.
 * Settings can use this for searchable preset selection without creating a
 * WebGL context or attaching to an audio graph.
 */
export async function loadMilkdropPresetNames(): Promise<readonly string[]> {
  return (await loadMilkdropRuntime()).catalog.names;
}

export class MilkdropVisualizerController {
  readonly #visualizer: ButterchurnVisualizer;
  readonly #audioSource: AudioNode;
  readonly #canvas: HTMLCanvasElement;
  readonly #catalog: MilkdropPresetCatalog;
  readonly #platform: MilkdropVisualizerPlatform;
  readonly #onError: ((failure: MilkdropVisualizerFailure) => void) | undefined;
  readonly #onPresetChange: ((presetName: string) => void) | undefined;
  readonly #onRenderFrame: ((timestamp: number) => void) | undefined;
  readonly #contextLostListener: (event: Event) => void;
  readonly #frameIntervalMs: number;

  #frameHandle: number | null = null;
  #lastRenderedAt = Number.NEGATIVE_INFINITY;
  #nextCycleAt = Number.POSITIVE_INFINITY;
  #currentPresetName: string;
  #blendDurationSeconds: number;
  #cycleIntervalSeconds: number;
  #autoCycleEnabled: boolean;
  #connected = false;
  #running = false;
  #failed = false;
  #destroyed = false;

  constructor(
    visualizer: ButterchurnVisualizer,
    catalog: MilkdropPresetCatalog,
    options: ActivateMilkdropVisualizerOptions,
    initialPresetName: string,
  ) {
    this.#visualizer = visualizer;
    this.#audioSource = options.audioSource;
    this.#canvas = options.canvas;
    this.#catalog = catalog;
    this.#platform = options.platform ?? defaultPlatform;
    this.#onError = options.onError;
    this.#onPresetChange = options.onPresetChange;
    this.#onRenderFrame = options.onRenderFrame;
    this.#currentPresetName = initialPresetName;
    this.#blendDurationSeconds = finiteNumberInRange(
      options.blendDurationSeconds,
      MILKDROP_DEFAULT_BLEND_SECONDS,
      0,
      MAX_BLEND_SECONDS,
    );
    this.#cycleIntervalSeconds = finiteNumberInRange(
      options.cycleIntervalSeconds,
      MILKDROP_DEFAULT_CYCLE_SECONDS,
      MIN_CYCLE_SECONDS,
      MAX_CYCLE_SECONDS,
    );
    this.#autoCycleEnabled = options.autoCycle ?? false;
    const maxFramesPerSecond = finiteNumberInRange(
      options.maxFramesPerSecond,
      MILKDROP_DEFAULT_MAX_FPS,
      1,
      MAX_FPS,
    );
    this.#frameIntervalMs = 1_000 / maxFramesPerSecond;
    this.#contextLostListener = () => {
      if (this.#destroyed) return;
      this.#failed = true;
      this.stop();
      this.#report(failure("context-lost", "The MilkDrop WebGL context was lost."));
    };
    this.#canvas.addEventListener("webglcontextlost", this.#contextLostListener);
  }

  get presetNames(): readonly string[] {
    return this.#catalog.names;
  }

  get currentPresetName(): string {
    return this.#currentPresetName;
  }

  get running(): boolean {
    return this.#running;
  }

  get failed(): boolean {
    return this.#failed;
  }

  resize(
    cssWidth = this.#canvas.getBoundingClientRect().width,
    cssHeight = this.#canvas.getBoundingClientRect().height,
    requestedDpr = this.#platform.devicePixelRatio(),
  ): MilkdropCanvasSize {
    const size = fitMilkdropCanvas(cssWidth, cssHeight, requestedDpr);
    if (!this.#destroyed && !this.#failed) {
      // Pass physical dimensions with pixelRatio=1. Butterchurn otherwise
      // multiplies by the global DPR again and bypasses our GPU memory bound.
      try {
        this.#visualizer.setRendererSize(size.width, size.height, { pixelRatio: 1 });
      } catch {
        this.#failed = true;
        this.stop();
        this.#report(failure("resize-failed", "Butterchurn stopped after a resize error."));
      }
    }
    return size;
  }

  selectPreset(name: string, blendDurationSeconds = this.#blendDurationSeconds): boolean {
    if (this.#destroyed) return false;
    const preset = this.#catalog.presets.get(name);
    if (!preset) return false;
    const blend = finiteNumberInRange(
      blendDurationSeconds,
      this.#blendDurationSeconds,
      0,
      MAX_BLEND_SECONDS,
    );
    try {
      this.#visualizer.loadPreset(preset, blend);
      this.#currentPresetName = name;
      this.#scheduleNextCycle();
      try {
        this.#onPresetChange?.(name);
      } catch {
        // A UI callback cannot interrupt preset navigation or rendering.
      }
      return true;
    } catch {
      this.#report(failure("preset-failed", "Butterchurn could not load the selected preset."));
      return false;
    }
  }

  next(blendDurationSeconds?: number): string | null {
    return this.#selectAdjacent(1, blendDurationSeconds);
  }

  previous(blendDurationSeconds?: number): string | null {
    return this.#selectAdjacent(-1, blendDurationSeconds);
  }

  random(blendDurationSeconds?: number): string | null {
    const name = randomMilkdropPresetName(
      this.#catalog.names,
      this.#currentPresetName,
      this.#platform.random,
    );
    return name !== null && this.selectPreset(name, blendDurationSeconds) ? name : null;
  }

  setAutoCycle(options: MilkdropAutoCycleOptions): void {
    if (this.#destroyed) return;
    this.#autoCycleEnabled = options.enabled;
    this.#cycleIntervalSeconds = finiteNumberInRange(
      options.intervalSeconds,
      this.#cycleIntervalSeconds,
      MIN_CYCLE_SECONDS,
      MAX_CYCLE_SECONDS,
    );
    this.#blendDurationSeconds = finiteNumberInRange(
      options.blendDurationSeconds,
      this.#blendDurationSeconds,
      0,
      MAX_BLEND_SECONDS,
    );
    this.#scheduleNextCycle();
  }

  start(): boolean {
    if (this.#destroyed || this.#failed) return false;
    if (this.#running) return true;
    if (!this.#connected) {
      try {
        this.#visualizer.connectAudio(this.#audioSource);
        this.#connected = true;
      } catch {
        this.#report(
          failure(
            "audio-connection-failed",
            "Butterchurn could not attach to the supplied audio source.",
          ),
        );
        return false;
      }
    }
    this.#running = true;
    this.#lastRenderedAt = Number.NEGATIVE_INFINITY;
    this.#scheduleNextCycle();
    this.#requestFrame();
    return true;
  }

  stop(): void {
    this.#running = false;
    this.#nextCycleAt = Number.POSITIVE_INFINITY;
    if (this.#frameHandle !== null) {
      this.#platform.cancelAnimationFrame(this.#frameHandle);
      this.#frameHandle = null;
    }
    if (this.#connected) {
      try {
        // Butterchurn disconnects only its own analyser destination, preserving
        // every audible output and analysis branch owned by the caller.
        this.#visualizer.disconnectAudio(this.#audioSource);
      } catch {
        // The graph may already have been disconnected by context shutdown.
      }
      this.#connected = false;
    }
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.stop();
    this.#destroyed = true;
    this.#canvas.removeEventListener("webglcontextlost", this.#contextLostListener);
    // Butterchurn 2.x exposes no destructor. Explicit context loss releases its
    // textures and framebuffers promptly instead of waiting for canvas GC.
    releaseWebGlContext(this.#canvas);
  }

  #selectAdjacent(direction: -1 | 1, blendDurationSeconds?: number): string | null {
    const name = adjacentMilkdropPresetName(
      this.#catalog.names,
      this.#currentPresetName,
      direction,
    );
    return name !== null && this.selectPreset(name, blendDurationSeconds) ? name : null;
  }

  #scheduleNextCycle(): void {
    this.#nextCycleAt =
      this.#running && this.#autoCycleEnabled
        ? this.#platform.now() + this.#cycleIntervalSeconds * 1_000
        : Number.POSITIVE_INFINITY;
  }

  #requestFrame(): void {
    if (this.#frameHandle !== null || !this.#running || this.#destroyed) return;
    this.#frameHandle = this.#platform.requestAnimationFrame((timestamp) => {
      this.#frameHandle = null;
      if (!this.#running || this.#destroyed) return;

      if (timestamp >= this.#nextCycleAt) {
        this.random(Math.min(this.#blendDurationSeconds, this.#cycleIntervalSeconds));
        this.#nextCycleAt = timestamp + this.#cycleIntervalSeconds * 1_000;
      }
      if (timestamp - this.#lastRenderedAt >= this.#frameIntervalMs) {
        try {
          this.#visualizer.render();
          this.#lastRenderedAt = timestamp;
          try {
            this.#onRenderFrame?.(timestamp);
          } catch {
            // An analysis observer cannot stop GPU rendering or scheduling.
          }
        } catch {
          this.#failed = true;
          this.stop();
          this.#report(failure("render-failed", "Butterchurn stopped after a rendering error."));
          return;
        }
      }
      this.#requestFrame();
    });
  }

  #report(error: MilkdropVisualizerFailure): void {
    try {
      this.#onError?.(error);
    } catch {
      // A consumer diagnostic callback must not escape into the audio/render
      // lifecycle or prevent deterministic teardown.
    }
  }
}

/**
 * Activates the fully local MilkDrop runtime. Failure is returned as data so a
 * missing WebGL2 implementation or blocked GPU cannot interrupt audio playback.
 */
export async function activateMilkdropVisualizer(
  options: ActivateMilkdropVisualizerOptions,
): Promise<MilkdropVisualizerActivation> {
  if (options.audioSource.context !== options.audioContext) {
    return {
      ok: false,
      error: failure(
        "invalid-input",
        "The MilkDrop audio source and AudioContext must belong to the same graph.",
      ),
    };
  }
  if (!supportsWebGl2(options.canvas)) {
    return {
      ok: false,
      error: failure("unsupported", "MilkDrop requires WebGL2 support."),
    };
  }

  let runtime: Awaited<ReturnType<typeof loadMilkdropRuntime>>;
  try {
    runtime = await loadMilkdropRuntime();
  } catch {
    return {
      ok: false,
      error: failure("load-failed", "The bundled MilkDrop runtime could not be loaded."),
    };
  }

  const initialName =
    (options.initialPresetName &&
      runtime.catalog.presets.has(options.initialPresetName) &&
      options.initialPresetName) ||
    runtime.catalog.names[0];
  if (!initialName) {
    return {
      ok: false,
      error: failure("load-failed", "The bundled MilkDrop preset catalog is empty."),
    };
  }

  const bounds = options.canvas.getBoundingClientRect();
  const platform = options.platform ?? defaultPlatform;
  const size = fitMilkdropCanvas(bounds.width, bounds.height, platform.devicePixelRatio());

  try {
    const visualizer = runtime.createVisualizer(options.audioContext, options.canvas, {
      width: size.width,
      height: size.height,
      pixelRatio: 1,
    });
    const initialPreset = runtime.catalog.presets.get(initialName);
    if (!initialPreset) {
      releaseWebGlContext(options.canvas);
      return {
        ok: false,
        error: failure("load-failed", "The initial MilkDrop preset is unavailable."),
      };
    }
    // Load the preset before connecting audio so any malformed third-party
    // preset fails without touching the caller's graph.
    visualizer.loadPreset(initialPreset, 0);
    const controller = new MilkdropVisualizerController(
      visualizer,
      runtime.catalog,
      options,
      initialName,
    );
    if ((options.autoStart ?? true) && !controller.start()) {
      controller.destroy();
      return {
        ok: false,
        error: failure(
          "audio-connection-failed",
          "Butterchurn could not attach to the supplied audio source.",
        ),
      };
    }
    return { ok: true, controller };
  } catch {
    // createVisualizer can fail after allocating some GL resources. Audio is
    // still untouched because connectAudio is deliberately the final step.
    releaseWebGlContext(options.canvas);
    return {
      ok: false,
      error: failure(
        "initialization-failed",
        "Butterchurn could not initialize the MilkDrop renderer.",
      ),
    };
  }
}
