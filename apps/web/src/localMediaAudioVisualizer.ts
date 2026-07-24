import {
  activateMilkdropVisualizer,
  type MilkdropVisualizerController,
  type MilkdropVisualizerFailure,
} from "./milkdropVisualizer";
import { localMediaAudioSignalStore, type LocalMediaAudioFeatures } from "./localMediaAudioSignal";

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

export type LocalMediaVisualizerStyle = "milkdrop" | "spectrum";

export interface LocalMediaVisualizerSettings {
  readonly style: LocalMediaVisualizerStyle;
  readonly presetName: string | null;
  readonly autoCycle: boolean;
  readonly cycleSeconds: number;
  readonly blendSeconds: number;
  /**
   * Publishes one bounded feature sample for Matrix color. MediaStream input is
   * admitted only when it is the explicit, session-approved display-audio
   * stream; there is no microphone or arbitrary stream fallback.
   */
  readonly publishMatrixSignal?: boolean;
  readonly onMilkdropState?: (state: LocalMediaMilkdropState) => void;
}

export type LocalMediaMilkdropState =
  | { readonly status: "idle"; readonly presetNames: readonly []; readonly currentPreset: null }
  | {
      readonly status: "loading";
      readonly presetNames: readonly [];
      readonly currentPreset: string | null;
    }
  | {
      readonly status: "ready";
      readonly presetNames: readonly string[];
      readonly currentPreset: string;
    }
  | {
      readonly status: "error";
      readonly presetNames: readonly [];
      readonly currentPreset: string | null;
      readonly failure: MilkdropVisualizerFailure;
    };

export const DEFAULT_LOCAL_MEDIA_VISUALIZER_SETTINGS: LocalMediaVisualizerSettings = {
  style: "spectrum",
  presetName: null,
  autoCycle: false,
  cycleSeconds: 30,
  blendSeconds: 4,
};

const approvedSessionCaptureStreams = new WeakSet<MediaStream>();

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
 * Marks one user-approved, session-only display-capture stream as eligible for
 * local analysis. This does not persist, record, upload, or echo its audio.
 */
export function approveSessionAudioCaptureStream(stream: MediaStream): void {
  approvedSessionCaptureStreams.add(stream);
}

export function revokeSessionAudioCaptureStream(stream: MediaStream): void {
  approvedSessionCaptureStreams.delete(stream);
}

export function isApprovedSessionAudioCaptureStream(stream: MediaStream): boolean {
  return (
    approvedSessionCaptureStreams.has(stream) &&
    stream.getAudioTracks().some((track) => track.readyState === "live")
  );
}

/**
 * Visualizer admission is deliberately narrower than general media playback.
 * Browser media must be a renderer-created object URL. Desktop VLC media must
 * use the owner-bound custom protocol. Remote URLs and iframe elements never
 * enter this direct media-element path.
 */
export function isApprovedLocalMediaVisualizerElement(element: HTMLMediaElement): boolean {
  if (element.tagName !== "AUDIO" && element.tagName !== "VIDEO") {
    return false;
  }
  const provenance = element.dataset.localMediaSource;
  const effectiveSource = element.currentSrc || element.src;
  try {
    const url = new URL(effectiveSource, document.baseURI);
    if (provenance === "browser" || provenance === "selected-file") {
      return url.protocol === "blob:";
    }
    return (
      provenance === "vlc" &&
      url.protocol === "cafecode-media:" &&
      url.hostname === "stream" &&
      url.port.length === 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.search.length === 0 &&
      url.hash.length === 0 &&
      /^\/[A-Za-z0-9_-]{32,128}$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function isMediaStream(input: HTMLMediaElement | MediaStream): input is MediaStream {
  return typeof (input as MediaStream).getAudioTracks === "function";
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
 * Reduces the already-approved spectrum to one bounded ephemeral activity
 * level. No PCM, frequency bins, or analysis history crosses this boundary.
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

export interface LocalMediaAudioFeatureState {
  beatBaseline: number | null;
  previousBass: number;
  previousLevel: number;
}

export function createLocalMediaAudioFeatureState(): LocalMediaAudioFeatureState {
  return { beatBaseline: null, previousBass: 0, previousLevel: 0 };
}

function calculateBandEnergy(
  frequencyData: Uint8Array,
  sampleRate: number,
  fftSize: number,
  minimumHz: number,
  maximumHz: number,
): number {
  if (frequencyData.length === 0) return 0;
  const safeSampleRate =
    Number.isFinite(sampleRate) && sampleRate > 0 ? Math.min(384_000, sampleRate) : 48_000;
  const safeFftSize =
    Number.isFinite(fftSize) && fftSize >= 32 ? Math.min(32_768, Math.floor(fftSize)) : 256;
  const binWidth = safeSampleRate / safeFftSize;
  const start = Math.min(
    frequencyData.length - 1,
    Math.max(0, Math.floor(Math.max(0, minimumHz) / binWidth)),
  );
  const end = Math.min(
    frequencyData.length,
    Math.max(start + 1, Math.ceil(Math.max(minimumHz, maximumHz) / binWidth)),
  );
  let sumSquares = 0;
  for (let index = start; index < end; index += 1) {
    const normalized = (frequencyData[index] ?? 0) / 255;
    sumSquares += normalized * normalized;
  }
  return Math.min(1, Math.sqrt(sumSquares / Math.max(1, end - start)));
}

/**
 * Reduces the approved analyser frame to five normalized scalars. The store
 * receives no PCM, bins, FFT buffer, or history. Three controller-local scalars
 * supply transient/beat strength and are reset on controller teardown.
 */
export function calculateLocalMediaAudioFeatures(
  frequencyData: Uint8Array,
  sampleRate: number,
  fftSize: number,
  state: LocalMediaAudioFeatureState,
): LocalMediaAudioFeatures {
  const level = calculateLocalMediaAudioSignalLevel(frequencyData);
  const bass = calculateBandEnergy(frequencyData, sampleRate, fftSize, 0, 250);
  const mid = calculateBandEnergy(frequencyData, sampleRate, fftSize, 250, 4_000);
  const treble = calculateBandEnergy(frequencyData, sampleRate, fftSize, 4_000, 12_000);
  const previousBaseline = state.beatBaseline;
  const positiveBassOnset =
    previousBaseline === null
      ? 0
      : Math.max(0, bass - Math.max(previousBaseline, state.previousBass));
  const positiveLevelOnset = Math.max(0, level - state.previousLevel);
  const beat = Math.min(1, positiveBassOnset * 3.6 + positiveLevelOnset * 1.8);
  state.beatBaseline =
    previousBaseline === null
      ? bass
      : previousBaseline + (bass - previousBaseline) * (bass > previousBaseline ? 0.08 : 0.18);
  state.previousBass = bass;
  state.previousLevel = level;
  return { level, bass, mid, treble, beat };
}

function clearCanvas(canvas: HTMLCanvasElement): void {
  canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
}

export class LocalMediaAudioVisualizerController {
  readonly #mediaElement: HTMLMediaElement | null;
  readonly #mediaStream: MediaStream | null;
  readonly #canvas: HTMLCanvasElement;
  readonly #milkdropCanvas: HTMLCanvasElement;
  readonly #platform: LocalMediaVisualizerPlatform;

  #context: AudioContext | null = null;
  #source: AudioNode | null = null;
  #analyser: AnalyserNode | null = null;
  #frequencyData: Uint8Array<ArrayBuffer> | null = null;
  #levels = new Float32Array(LOCAL_MEDIA_VISUALIZER_MAX_BARS);
  #frameHandle: number | null = null;
  #lastRenderedAt = Number.NEGATIVE_INFINITY;
  #lastSignalSampledAt = Number.NEGATIVE_INFINITY;
  #analyserConnected = false;
  #requested = false;
  #spectrumRequested = false;
  #signalRequested = false;
  #destroyed = false;
  #activationGeneration = 0;
  #milkdrop: MilkdropVisualizerController | null = null;
  #milkdropStateCallback: ((state: LocalMediaMilkdropState) => void) | undefined;
  readonly #audioFeatureState = createLocalMediaAudioFeatureState();
  readonly #signalOwner = {};

  constructor(
    input: HTMLMediaElement | MediaStream,
    canvas: HTMLCanvasElement,
    platform: LocalMediaVisualizerPlatform = defaultPlatform,
    milkdropCanvas: HTMLCanvasElement = canvas,
  ) {
    this.#mediaElement = isMediaStream(input) ? null : input;
    this.#mediaStream = isMediaStream(input) ? input : null;
    this.#canvas = canvas;
    this.#milkdropCanvas = milkdropCanvas;
    this.#platform = platform;
  }

  resize(): void {
    if (this.#milkdrop !== null) {
      this.#milkdrop.resize();
      return;
    }
    const bounds = this.#canvas.getBoundingClientRect();
    const size = fitLocalMediaVisualizerCanvas(
      bounds.width,
      bounds.height,
      this.#platform.devicePixelRatio(),
    );
    if (this.#canvas.width !== size.width) this.#canvas.width = size.width;
    if (this.#canvas.height !== size.height) this.#canvas.height = size.height;
  }

  async sync(
    requested: boolean,
    settings: LocalMediaVisualizerSettings = DEFAULT_LOCAL_MEDIA_VISUALIZER_SETTINGS,
  ): Promise<void> {
    if (this.#destroyed) return;
    this.#milkdropStateCallback = settings.onMilkdropState;
    const approved = this.#mediaElement
      ? isApprovedLocalMediaVisualizerElement(this.#mediaElement)
      : this.#mediaStream
        ? isApprovedSessionAudioCaptureStream(this.#mediaStream)
        : false;
    this.#requested = requested && approved;
    this.#spectrumRequested = this.#requested && settings.style === "spectrum";
    this.#signalRequested = settings.publishMatrixSignal === true && approved;
    if (this.#signalRequested) {
      localMediaAudioSignalStore.claim(this.#signalOwner);
    } else {
      localMediaAudioSignalStore.release(this.#signalOwner);
    }
    const generation = ++this.#activationGeneration;
    const playing = this.#mediaElement
      ? !this.#mediaElement.paused && !this.#mediaElement.ended
      : (this.#mediaStream?.getAudioTracks().some((track) => track.readyState === "live") ?? false);

    if (!playing) {
      this.#stopFrames();
      this.#disconnectAnalyser();
      this.#milkdrop?.stop();
      localMediaAudioSignalStore.release(this.#signalOwner);
      clearCanvas(this.#canvas);
      if (this.#context?.state === "running") {
        await this.#context.suspend().catch(() => undefined);
      }
      return;
    }

    if (!this.#context && (this.#requested || this.#signalRequested)) {
      await this.#initializeGraph(generation);
    }
    if (this.#destroyed || generation !== this.#activationGeneration) return;
    if (!this.#context) {
      localMediaAudioSignalStore.release(this.#signalOwner);
      return;
    }

    // Once a media element is attached to Web Audio, its audible path remains
    // context-owned. Resume it for playback even when visualization is paused.
    if (this.#context.state !== "running") {
      await this.#context.resume().catch(() => undefined);
    }
    if (this.#destroyed || generation !== this.#activationGeneration) return;

    if (this.#requested && this.#context.state === "running") {
      if (settings.style === "milkdrop") {
        if (this.#signalRequested) {
          this.#connectAnalyser();
        } else {
          this.#stopFrames();
          this.#disconnectAnalyser();
        }
        clearCanvas(this.#canvas);
        await this.#syncMilkdrop(settings, generation);
        if (this.#signalRequested && this.#milkdrop?.running !== true) {
          this.#requestFrame();
        } else {
          this.#stopFrames();
        }
      } else {
        this.#destroyMilkdrop();
        this.#connectAnalyser();
        this.resize();
        this.#requestFrame();
      }
    } else if (this.#signalRequested && this.#context.state === "running") {
      this.#destroyMilkdrop();
      this.#connectAnalyser();
      clearCanvas(this.#canvas);
      this.#requestFrame();
    } else {
      this.#stopFrames();
      this.#disconnectAnalyser();
      this.#milkdrop?.stop();
      localMediaAudioSignalStore.release(this.#signalOwner);
      clearCanvas(this.#canvas);
      if (this.#mediaStream && this.#context.state === "running") {
        await this.#context.suspend().catch(() => undefined);
      }
    }
  }

  async destroy(): Promise<void> {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#requested = false;
    this.#spectrumRequested = false;
    this.#signalRequested = false;
    this.#activationGeneration += 1;
    this.#stopFrames();
    this.#disconnectAnalyser();
    this.#destroyMilkdrop();
    this.#source?.disconnect();
    this.#analyser?.disconnect();
    this.#frequencyData?.fill(0);
    this.#levels.fill(0);
    this.#audioFeatureState.beatBaseline = null;
    this.#audioFeatureState.previousBass = 0;
    this.#audioFeatureState.previousLevel = 0;
    localMediaAudioSignalStore.release(this.#signalOwner);
    clearCanvas(this.#canvas);
    const context = this.#context;
    this.#context = null;
    this.#source = null;
    this.#analyser = null;
    this.#frequencyData = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }
    this.#publishMilkdropState({
      status: "idle",
      presetNames: [],
      currentPreset: null,
    });
  }

  selectMilkdropPreset(name: string): boolean {
    return this.#milkdrop?.selectPreset(name) ?? false;
  }

  nextMilkdropPreset(): string | null {
    return this.#milkdrop?.next() ?? null;
  }

  previousMilkdropPreset(): string | null {
    return this.#milkdrop?.previous() ?? null;
  }

  randomMilkdropPreset(): string | null {
    return this.#milkdrop?.random() ?? null;
  }

  async #syncMilkdrop(settings: LocalMediaVisualizerSettings, generation: number): Promise<void> {
    const context = this.#context;
    const source = this.#source;
    if (!context || !source || this.#destroyed || generation !== this.#activationGeneration) return;

    if (this.#milkdrop === null) {
      this.#publishMilkdropState({
        status: "loading",
        presetNames: [],
        currentPreset: settings.presetName,
      });
      const activation = await activateMilkdropVisualizer({
        audioContext: context,
        audioSource: source,
        canvas: this.#milkdropCanvas,
        ...(settings.presetName === null ? {} : { initialPresetName: settings.presetName }),
        blendDurationSeconds: settings.blendSeconds,
        autoCycle: settings.autoCycle,
        cycleIntervalSeconds: settings.cycleSeconds,
        autoStart: false,
        onPresetChange: (presetName) => {
          const controller = this.#milkdrop;
          if (controller === null) return;
          this.#publishMilkdropState({
            status: "ready",
            presetNames: controller.presetNames,
            currentPreset: presetName,
          });
        },
        onError: (failure) => {
          this.#publishMilkdropState({
            status: "error",
            presetNames: [],
            currentPreset: this.#milkdrop?.currentPresetName ?? settings.presetName,
            failure,
          });
        },
        onRenderFrame: (timestamp) => this.#sampleSignal(timestamp),
      });
      if (this.#destroyed || generation !== this.#activationGeneration || !this.#requested) {
        if (activation.ok) activation.controller.destroy();
        return;
      }
      if (!activation.ok) {
        this.#publishMilkdropState({
          status: "error",
          presetNames: [],
          currentPreset: settings.presetName,
          failure: activation.error,
        });
        return;
      }
      this.#milkdrop = activation.controller;
    }

    const milkdrop = this.#milkdrop;
    if (settings.presetName && settings.presetName !== milkdrop.currentPresetName) {
      milkdrop.selectPreset(settings.presetName, settings.blendSeconds);
    }
    milkdrop.setAutoCycle({
      enabled: settings.autoCycle,
      intervalSeconds: settings.cycleSeconds,
      blendDurationSeconds: settings.blendSeconds,
    });
    milkdrop.resize();
    if (!milkdrop.failed && milkdrop.start()) {
      this.#publishMilkdropState({
        status: "ready",
        presetNames: milkdrop.presetNames,
        currentPreset: milkdrop.currentPresetName,
      });
    }
  }

  #destroyMilkdrop(): void {
    if (this.#milkdrop === null) return;
    this.#milkdrop.destroy();
    this.#milkdrop = null;
    this.#publishMilkdropState({
      status: "idle",
      presetNames: [],
      currentPreset: null,
    });
  }

  #publishMilkdropState(state: LocalMediaMilkdropState): void {
    try {
      this.#milkdropStateCallback?.(state);
    } catch {
      // Renderer state observers never own the audio or GPU lifecycle.
    }
  }

  async #initializeGraph(generation: number): Promise<void> {
    if (
      this.#destroyed ||
      (!this.#requested && !this.#signalRequested) ||
      (this.#mediaElement
        ? !isApprovedLocalMediaVisualizerElement(this.#mediaElement)
        : this.#mediaStream
          ? !isApprovedSessionAudioCaptureStream(this.#mediaStream)
          : true)
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
      (!this.#requested && !this.#signalRequested) ||
      context.state !== "running"
    ) {
      await context.close().catch(() => undefined);
      return;
    }

    try {
      const source = this.#mediaElement
        ? context.createMediaElementSource(this.#mediaElement)
        : context.createMediaStreamSource(this.#mediaStream!);
      const analyser = context.createAnalyser();
      analyser.fftSize = LOCAL_MEDIA_VISUALIZER_FFT_SIZE;
      analyser.smoothingTimeConstant = 0.82;
      analyser.minDecibels = -90;
      analyser.maxDecibels = -18;
      if (this.#mediaElement) {
        // MediaElementAudioSourceNode takes ownership of the element's audible
        // path, so reconnect it to the destination. Display capture must never
        // be echoed: doing so can cause feedback and duplicate system audio.
        source.connect(context.destination);
      }
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
      (!this.#spectrumRequested && !this.#signalRequested) ||
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
    if (this.#signalRequested) {
      this.#publishSignal(frequencyData, timestamp);
    }

    if (!this.#spectrumRequested) return;
    updateLocalMediaVisualizerLevels(this.#levels, frequencyData);
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

  #sampleSignal(timestamp: number): void {
    const analyser = this.#analyser;
    const frequencyData = this.#frequencyData;
    if (
      !this.#signalRequested ||
      !this.#analyserConnected ||
      !analyser ||
      !frequencyData ||
      timestamp - this.#lastSignalSampledAt < 1_000 / LOCAL_MEDIA_VISUALIZER_MAX_FPS
    ) {
      return;
    }
    analyser.getByteFrequencyData(frequencyData);
    this.#publishSignal(frequencyData, timestamp);
  }

  #publishSignal(frequencyData: Uint8Array, timestamp: number): void {
    this.#lastSignalSampledAt = timestamp;
    localMediaAudioSignalStore.publish(
      this.#signalOwner,
      calculateLocalMediaAudioFeatures(
        frequencyData,
        this.#context?.sampleRate ?? 48_000,
        this.#analyser?.fftSize ?? LOCAL_MEDIA_VISUALIZER_FFT_SIZE,
        this.#audioFeatureState,
      ),
      timestamp,
    );
  }
}
