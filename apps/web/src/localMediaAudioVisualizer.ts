export const LOCAL_MEDIA_VISUALIZER_FFT_SIZE = 256;
export const LOCAL_MEDIA_VISUALIZER_MAX_BARS = 48;
export const LOCAL_MEDIA_VISUALIZER_MAX_DPR = 1.5;
export const LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_EDGE = 2_048;
export const LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_PIXELS = 1_048_576;
export const LOCAL_MEDIA_VISUALIZER_MAX_FPS = 30;
export const LOCAL_MEDIA_VISUALIZER_MAX_LEVEL_STEP = 0.055;

export interface LocalMediaVisualizerActivity {
  readonly enabled: boolean;
  readonly reducedMotion: boolean;
  readonly visible: boolean;
  readonly focused: boolean;
}

export interface LocalMediaVisualizerCanvasSize {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
}

export interface LocalMediaVisualizerPlatform {
  readonly createAudioContext: () => AudioContext;
  readonly requestAnimationFrame: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame: (handle: number) => void;
  readonly devicePixelRatio: () => number;
}

const defaultPlatform: LocalMediaVisualizerPlatform = {
  createAudioContext: () => new AudioContext({ latencyHint: "playback" }),
  requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
  cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  devicePixelRatio: () => window.devicePixelRatio,
};

export function shouldVisualizeLocalMedia(activity: LocalMediaVisualizerActivity): boolean {
  return activity.enabled && !activity.reducedMotion && activity.visible && activity.focused;
}

/**
 * Visualizer admission is deliberately narrower than general media playback.
 * Only a renderer-created object URL for a user-selected file is accepted.
 * Remote URLs, iframe players, MediaStreams, and system audio are not inputs.
 */
export function isApprovedLocalMediaVisualizerElement(element: HTMLMediaElement): boolean {
  if (
    (element.tagName !== "AUDIO" && element.tagName !== "VIDEO") ||
    element.dataset.localMediaSource !== "selected-file"
  ) {
    return false;
  }
  const effectiveSource = element.currentSrc || element.src;
  try {
    return new URL(effectiveSource, document.baseURI).protocol === "blob:";
  } catch {
    return false;
  }
}

export function fitLocalMediaVisualizerCanvas(
  cssWidth: number,
  cssHeight: number,
  requestedDpr: number,
): LocalMediaVisualizerCanvasSize {
  if (
    !Number.isFinite(cssWidth) ||
    !Number.isFinite(cssHeight) ||
    cssWidth <= 0 ||
    cssHeight <= 0
  ) {
    return { width: 1, height: 1, dpr: 1 };
  }
  const boundedDpr = Math.min(
    LOCAL_MEDIA_VISUALIZER_MAX_DPR,
    Math.max(1, Number.isFinite(requestedDpr) ? requestedDpr : 1),
  );
  const edgeDpr = Math.min(
    boundedDpr,
    LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_EDGE / cssWidth,
    LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_EDGE / cssHeight,
  );
  const pixelDpr = Math.sqrt(LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_PIXELS / (cssWidth * cssHeight));
  // Do not impose a positive DPR floor: on an adversarially or accidentally
  // enormous CSS box, a floor can override the edge/pixel ceilings.
  const dpr = Math.min(edgeDpr, pixelDpr);
  return {
    width: Math.max(1, Math.floor(cssWidth * dpr)),
    height: Math.max(1, Math.floor(cssHeight * dpr)),
    dpr,
  };
}

/**
 * Updates a reused level buffer without allocating. The per-frame delta cap
 * keeps sudden audio transients from becoming full-frame luminance flashes.
 */
export function updateLocalMediaVisualizerLevels(
  levels: Float32Array,
  frequencyData: Uint8Array,
  maxStep = LOCAL_MEDIA_VISUALIZER_MAX_LEVEL_STEP,
): void {
  if (levels.length === 0 || frequencyData.length === 0) return;
  const boundedStep = Math.min(0.1, Math.max(0.001, maxStep));
  for (let index = 0; index < levels.length; index += 1) {
    const start = Math.floor((index * frequencyData.length) / levels.length);
    const end = Math.max(
      start + 1,
      Math.floor(((index + 1) * frequencyData.length) / levels.length),
    );
    let peak = 0;
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      peak = Math.max(peak, frequencyData[sampleIndex] ?? 0);
    }
    const target = Math.pow(peak / 255, 1.35);
    const previous = levels[index] ?? 0;
    levels[index] = previous + Math.min(boundedStep, Math.max(-boundedStep, target - previous));
  }
}

/**
 * Converts the already-approved, bounded spectrum into one ephemeral level.
 * This deliberately exposes no PCM, frequency bins, or analysis history to
 * other renderer components.
 */
export function calculateLocalMediaAudioSignalLevel(frequencyData: Uint8Array): number {
  if (frequencyData.length === 0) return 0;
  let sumSquares = 0;
  for (const sample of frequencyData) {
    const normalized = sample / 255;
    sumSquares += normalized * normalized;
  }
  return Math.min(1, Math.sqrt(sumSquares / frequencyData.length));
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}

export class LocalMediaAudioVisualizerController {
  readonly #mediaElement: HTMLMediaElement;
  readonly #canvas: HTMLCanvasElement;
  readonly #platform: LocalMediaVisualizerPlatform;

  #context: AudioContext | null = null;
  #source: MediaElementAudioSourceNode | null = null;
  #analyser: AnalyserNode | null = null;
  #frequencyData: Uint8Array<ArrayBuffer> | null = null;
  #levels = new Float32Array(LOCAL_MEDIA_VISUALIZER_MAX_BARS);
  #frameHandle: number | null = null;
  #lastRenderedAt = Number.NEGATIVE_INFINITY;
  #analyserConnected = false;
  #requested = false;
  #analysisRequested = false;
  #destroyed = false;
  #activationGeneration = 0;
  readonly #signalOwner = {};

  constructor(
    mediaElement: HTMLMediaElement,
    canvas: HTMLCanvasElement,
    platform: LocalMediaVisualizerPlatform = defaultPlatform,
  ) {
    this.#mediaElement = mediaElement;
    this.#canvas = canvas;
    this.#platform = platform;
  }

  resize(): void {
    const bounds = this.#canvas.getBoundingClientRect();
    const size = fitLocalMediaVisualizerCanvas(
      bounds.width,
      bounds.height,
      this.#platform.devicePixelRatio(),
    );
    if (this.#canvas.width !== size.width) this.#canvas.width = size.width;
    if (this.#canvas.height !== size.height) this.#canvas.height = size.height;
  }

  async sync(requested: boolean, analysisRequested = false): Promise<void> {
    if (this.#destroyed) return;
    const approved = isApprovedLocalMediaVisualizerElement(this.#mediaElement);
    this.#requested = requested && approved;
    this.#analysisRequested = (requested || analysisRequested) && approved;
    const generation = ++this.#activationGeneration;
    const playing = !this.#mediaElement.paused && !this.#mediaElement.ended;

    if (!playing) {
      this.#stopFrames();
      this.#disconnectAnalyser();
      localMediaAudioSignalStore.clear(this.#signalOwner);
      clearCanvas(this.#canvas);
      if (this.#context?.state === "running") {
        await this.#context.suspend().catch(() => undefined);
      }
      return;
    }

    if (!this.#context && this.#analysisRequested) {
      await this.#initializeGraph(generation);
    }
    if (this.#destroyed || generation !== this.#activationGeneration || !this.#context) return;

    // Once a media element is attached to Web Audio, its audible path remains
    // context-owned. Resume it for playback even when visualization is paused.
    if (this.#context.state !== "running") {
      await this.#context.resume().catch(() => undefined);
    }
    if (this.#destroyed || generation !== this.#activationGeneration) return;

    if (this.#analysisRequested && this.#context.state === "running") {
      this.#connectAnalyser();
      if (this.#requested) this.resize();
      else clearCanvas(this.#canvas);
      this.#requestFrame();
    } else {
      this.#stopFrames();
      this.#disconnectAnalyser();
      localMediaAudioSignalStore.clear(this.#signalOwner);
      clearCanvas(this.#canvas);
    }
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#requested = false;
    this.#analysisRequested = false;
    this.#activationGeneration += 1;
    this.#stopFrames();
    this.#disconnectAnalyser();
    this.#source?.disconnect();
    this.#analyser?.disconnect();
    this.#frequencyData?.fill(0);
    this.#levels.fill(0);
    localMediaAudioSignalStore.clear(this.#signalOwner);
    clearCanvas(this.#canvas);
    const context = this.#context;
    this.#context = null;
    this.#source = null;
    this.#analyser = null;
    this.#frequencyData = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }
  }

  async #initializeGraph(generation: number): Promise<void> {
    if (
      this.#destroyed ||
      !this.#analysisRequested ||
      !isApprovedLocalMediaVisualizerElement(this.#mediaElement)
    ) {
      return;
    }

    const context = this.#platform.createAudioContext();
    if (context.state !== "running") {
      await context.resume().catch(() => undefined);
    }
    if (
      this.#destroyed ||
      generation !== this.#activationGeneration ||
      !this.#analysisRequested ||
      context.state !== "running"
    ) {
      await context.close().catch(() => undefined);
      return;
    }

    try {
      const source = context.createMediaElementSource(this.#mediaElement);
      const analyser = context.createAnalyser();
      analyser.fftSize = LOCAL_MEDIA_VISUALIZER_FFT_SIZE;
      analyser.smoothingTimeConstant = 0.82;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -18;
      // Keep audible playback independent of the optional analysis branch.
      source.connect(context.destination);
      this.#context = context;
      this.#source = source;
      this.#analyser = analyser;
      this.#frequencyData = new Uint8Array(analyser.frequencyBinCount);
    } catch {
      await context.close().catch(() => undefined);
    }
  }

  #connectAnalyser(): void {
    if (!this.#source || !this.#analyser || this.#analyserConnected) return;
    this.#source.connect(this.#analyser);
    this.#analyserConnected = true;
  }

  #disconnectAnalyser(): void {
    if (!this.#source || !this.#analyser || !this.#analyserConnected) return;
    try {
      this.#source.disconnect(this.#analyser);
    } catch {
      // The graph is already disconnected; teardown remains idempotent.
    }
    this.#analyserConnected = false;
  }

  #stopFrames(): void {
    if (this.#frameHandle !== null) {
      this.#platform.cancelAnimationFrame(this.#frameHandle);
      this.#frameHandle = null;
    }
  }

  #requestFrame(): void {
    if (
      this.#frameHandle !== null ||
      this.#destroyed ||
      !this.#analysisRequested ||
      !this.#analyserConnected
    ) {
      return;
    }
    this.#frameHandle = this.#platform.requestAnimationFrame((timestamp) => {
      this.#frameHandle = null;
      this.#render(timestamp);
      this.#requestFrame();
    });
  }

  #render(timestamp: number): void {
    const analyser = this.#analyser;
    const frequencyData = this.#frequencyData;
    if (
      !analyser ||
      !frequencyData ||
      timestamp - this.#lastRenderedAt < 1_000 / LOCAL_MEDIA_VISUALIZER_MAX_FPS
    ) {
      return;
    }
    this.#lastRenderedAt = timestamp;
    analyser.getByteFrequencyData(frequencyData);
    updateLocalMediaVisualizerLevels(this.#levels, frequencyData);
    localMediaAudioSignalStore.publish(
      this.#signalOwner,
      calculateLocalMediaAudioSignalLevel(frequencyData),
      timestamp,
    );

    if (!this.#requested) return;

    const context = this.#canvas.getContext("2d");
    if (!context) return;
    const width = this.#canvas.width;
    const height = this.#canvas.height;
    context.clearRect(0, 0, width, height);
    const gap = Math.max(1, width * 0.0025);
    const barWidth = Math.max(1, (width - gap * (this.#levels.length - 1)) / this.#levels.length);
    context.fillStyle = "rgba(78, 205, 218, 0.42)";
    for (let index = 0; index < this.#levels.length; index += 1) {
      const level = this.#levels[index] ?? 0;
      const barHeight = Math.min(height * 0.72, Math.max(1, level * height * 0.72));
      context.fillRect(index * (barWidth + gap), height - barHeight, barWidth, barHeight);
    }
  }
}
import { localMediaAudioSignalStore } from "./localMediaAudioSignal";
