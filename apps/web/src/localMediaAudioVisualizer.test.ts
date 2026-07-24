import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calculateLocalMediaAudioSignalLevel,
  fitLocalMediaVisualizerCanvas,
  isApprovedLocalMediaVisualizerElement,
  LocalMediaAudioVisualizerController,
  LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_EDGE,
  LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_PIXELS,
  LOCAL_MEDIA_VISUALIZER_MAX_LEVEL_STEP,
  shouldVisualizeLocalMedia,
  updateLocalMediaVisualizerLevels,
} from "./localMediaAudioVisualizer";
import { localMediaAudioSignalStore } from "./localMediaAudioSignal";

afterEach(() => {
  vi.unstubAllGlobals();
});

function mediaElement(input: {
  readonly tagName?: string;
  readonly source?: string;
  readonly provenance?: string;
}): HTMLMediaElement {
  return {
    tagName: input.tagName ?? "AUDIO",
    currentSrc: input.source ?? "blob:http://localhost/local-audio",
    src: "",
    dataset: {
      localMediaSource: input.provenance ?? "selected-file",
    },
  } as unknown as HTMLMediaElement;
}

describe("local media audio visualizer policy", () => {
  it("runs only when explicitly enabled, visible, focused, and motion-safe", () => {
    expect(
      shouldVisualizeLocalMedia({
        enabled: true,
        reducedMotion: false,
        visible: true,
        focused: true,
      }),
    ).toBe(true);
    for (const key of ["enabled", "visible", "focused"] as const) {
      expect(
        shouldVisualizeLocalMedia({
          enabled: true,
          reducedMotion: false,
          visible: true,
          focused: true,
          [key]: false,
        }),
      ).toBe(false);
    }
    expect(
      shouldVisualizeLocalMedia({
        enabled: true,
        reducedMotion: true,
        visible: true,
        focused: true,
      }),
    ).toBe(false);
  });

  it("admits only marked object-URL audio/video elements", () => {
    vi.stubGlobal("document", { baseURI: "http://localhost/" });
    expect(isApprovedLocalMediaVisualizerElement(mediaElement({}))).toBe(true);
    expect(isApprovedLocalMediaVisualizerElement(mediaElement({ tagName: "VIDEO" }))).toBe(true);
    expect(
      isApprovedLocalMediaVisualizerElement(
        mediaElement({ source: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
      ),
    ).toBe(false);
    expect(
      isApprovedLocalMediaVisualizerElement(
        mediaElement({ source: "https://open.spotify.com/track/example" }),
      ),
    ).toBe(false);
    expect(
      isApprovedLocalMediaVisualizerElement(mediaElement({ provenance: "remote-stream" })),
    ).toBe(false);
    expect(isApprovedLocalMediaVisualizerElement(mediaElement({ tagName: "IFRAME" }))).toBe(false);
  });

  it("bounds canvas resolution by DPR, edge length, and total pixels", () => {
    const size = fitLocalMediaVisualizerCanvas(8_000, 4_000, 4);
    expect(size.width).toBeLessThanOrEqual(LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_EDGE);
    expect(size.height).toBeLessThanOrEqual(LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_EDGE);
    expect(size.width * size.height).toBeLessThanOrEqual(LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_PIXELS);
    const extreme = fitLocalMediaVisualizerCanvas(100_000, 50_000, 4);
    expect(extreme.width).toBeLessThanOrEqual(LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_EDGE);
    expect(extreme.height).toBeLessThanOrEqual(LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_EDGE);
    expect(extreme.width * extreme.height).toBeLessThanOrEqual(
      LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_PIXELS,
    );
    expect(fitLocalMediaVisualizerCanvas(0, Number.NaN, 2)).toEqual({
      width: 1,
      height: 1,
      dpr: 1,
    });
  });

  it("updates reused spectrum levels with a temporal flash cap", () => {
    const levels = new Float32Array(4);
    const loud = new Uint8Array(16).fill(255);
    updateLocalMediaVisualizerLevels(levels, loud);
    expect(Array.from(levels)).toEqual(
      Array.from({ length: 4 }, () => expect.closeTo(LOCAL_MEDIA_VISUALIZER_MAX_LEVEL_STEP)),
    );

    const previous = levels.slice();
    updateLocalMediaVisualizerLevels(levels, new Uint8Array(16));
    for (let index = 0; index < levels.length; index += 1) {
      expect(Math.abs((levels[index] ?? 0) - (previous[index] ?? 0))).toBeLessThanOrEqual(
        LOCAL_MEDIA_VISUALIZER_MAX_LEVEL_STEP,
      );
    }
  });

  it("reduces the approved spectrum to one bounded ephemeral activity level", () => {
    expect(calculateLocalMediaAudioSignalLevel(new Uint8Array())).toBe(0);
    expect(calculateLocalMediaAudioSignalLevel(new Uint8Array([0, 0, 0]))).toBe(0);
    expect(calculateLocalMediaAudioSignalLevel(new Uint8Array([255, 255]))).toBe(1);
    expect(calculateLocalMediaAudioSignalLevel(new Uint8Array([128]))).toBeGreaterThan(0.49);
  });

  it("builds one bounded analysis branch, pauses frames, and tears down deterministically", async () => {
    vi.stubGlobal("document", { baseURI: "http://localhost/" });
    const media = mediaElement({}) as HTMLMediaElement & { paused: boolean; ended: boolean };
    Object.assign(media, { paused: false, ended: false });

    const clearRect = vi.fn();
    const fillRect = vi.fn();
    const canvasContext = {
      clearRect,
      fillRect,
      fillStyle: "",
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getBoundingClientRect: () => ({ width: 640, height: 360 }),
      getContext: () => canvasContext,
    } as unknown as HTMLCanvasElement;

    const source = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const analyser = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      fftSize: 0,
      smoothingTimeConstant: 0,
      minDecibels: 0,
      maxDecibels: 0,
      frequencyBinCount: 128,
      getByteFrequencyData: vi.fn((buffer: Uint8Array) => buffer.fill(128)),
    };
    const audioContext = {
      state: "suspended",
      destination: {},
      createMediaElementSource: vi.fn(() => source),
      createAnalyser: vi.fn(() => analyser),
      resume: vi.fn(async () => {
        audioContext.state = "running";
      }),
      suspend: vi.fn(async () => {
        audioContext.state = "suspended";
      }),
      close: vi.fn(async () => {
        audioContext.state = "closed";
      }),
    };
    let nextFrame = 0;
    const frames = new Map<number, FrameRequestCallback>();
    const controller = new LocalMediaAudioVisualizerController(media, canvas, {
      createAudioContext: () => audioContext as unknown as AudioContext,
      requestAnimationFrame: (callback) => {
        const handle = ++nextFrame;
        frames.set(handle, callback);
        return handle;
      },
      cancelAnimationFrame: (handle) => {
        frames.delete(handle);
      },
      devicePixelRatio: () => 4,
    });

    await controller.sync(true);
    expect(audioContext.createMediaElementSource).toHaveBeenCalledOnce();
    expect(source.connect).toHaveBeenCalledWith(audioContext.destination);
    expect(source.connect).toHaveBeenCalledWith(analyser);
    expect(frames.size).toBe(1);
    const firstFrame = [...frames.entries()][0];
    expect(firstFrame).toBeDefined();
    frames.delete(firstFrame![0]);
    firstFrame![1](100);
    expect(analyser.getByteFrequencyData).toHaveBeenCalledOnce();
    expect(fillRect).toHaveBeenCalled();
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(
      LOCAL_MEDIA_VISUALIZER_MAX_CANVAS_PIXELS,
    );

    await controller.sync(false, true);
    expect(frames.size).toBe(1);
    expect(source.disconnect).not.toHaveBeenCalledWith(analyser);
    expect(localMediaAudioSignalStore.getSnapshot().active).toBe(true);

    await controller.sync(false);
    expect(frames.size).toBe(0);
    expect(source.disconnect).toHaveBeenCalledWith(analyser);
    expect(localMediaAudioSignalStore.getSnapshot().active).toBe(false);
    expect(audioContext.suspend).not.toHaveBeenCalled();

    await controller.sync(true);
    expect(audioContext.createMediaElementSource).toHaveBeenCalledOnce();
    media.paused = true;
    await controller.sync(false);
    expect(audioContext.suspend).toHaveBeenCalledOnce();

    media.paused = false;
    Object.defineProperty(media, "currentSrc", {
      configurable: true,
      value: "https://open.spotify.com/track/example",
    });
    await controller.sync(true);
    expect(source.connect).toHaveBeenCalledTimes(3);

    await controller.destroy();
    expect(source.disconnect).toHaveBeenCalledWith();
    expect(analyser.disconnect).toHaveBeenCalledOnce();
    expect(audioContext.close).toHaveBeenCalledOnce();
    expect(clearRect).toHaveBeenCalled();
  });
});
