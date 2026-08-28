import "../index.css";

import { EnvironmentId, ThreadId, type UsageStatsSnapshot } from "@cafecode/contracts";
import type { UnifiedSettings } from "@cafecode/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { matrixColorFrameStore } from "../matrixColorFrameStore";

const TEST_SELECTED_THREAD_REF = {
  environmentId: EnvironmentId.make("environment-matrix-test"),
  threadId: ThreadId.make("thread-matrix-test"),
} as const;

const mocks = vi.hoisted(() => ({
  activityEventsKey: "activity-1",
  activityObservedAtMs: 10_000,
  workVocabularyKey: "",
  selectedActivityThreadRefs: [] as unknown[],
  selectedActivityInputSelections: [] as unknown[],
  selectedVocabularyThreadRefs: [] as unknown[],
  drawnActivityLinkCounts: [] as number[],
  matrixColorCycleSpeeds: [] as number[],
  matrixColorTimestamps: [] as number[],
  drawnMatrixColors: [] as string[],
  gpuRendererEnabled: false,
  gpuRender: vi.fn(() => ({
    status: "rendered" as const,
    renderedGlyphs: 1,
    droppedGlyphs: 0,
    drawCalls: 1 as const,
  })),
  gpuDispose: vi.fn(),
  usageStatsSubscriber: null as ((snapshot: UsageStatsSnapshot) => void) | null,
  usageStatsUnsubscribe: vi.fn(),
  settings: {
    fallingEffectsEnabled: true as boolean,
    fallingEffectsOverCinemaEnabled: false as boolean,
    fallingEffectKind: "matrix" as "snow" | "rain" | "matrix",
    fallingEffectColor: "auto" as const,
    fallingEffectMatrixColorMode: "rainbow-extra" as const,
    fallingEffectMatrixColorCycleSpeed: 32,
    fallingEffectMatrixBaseFontSize: 14,
    fallingEffectMatrixMotionMode: "flat" as
      | "flat"
      | "forward"
      | "reverse"
      | "tunnel"
      | "walk-forward"
      | "walk-reverse",
    fallingEffectMatrixWalkStartFontSize: 1,
    fallingEffectMatrixWalkEndFontSize: 72,
    fallingEffectMatrixWalkLifecyclePercent: 30,
    fallingEffectMatrixCenterWindIntensity: 4,
    fallingEffectOpacity: 0.35,
    fallingEffectSpeed: 1,
    fallingEffectDensity: 1,
    fallingEffectUsageReactive: false as boolean,
    fallingEffectJapaneseRatio: 0.5,
    fallingEffect2chEnriched: true,
    fallingEffectLiveWorkVocabulary: true,
    fallingEffectActivityLinks: true as boolean,
    fallingEffectActivityLinkNetworkEnabled: true as boolean,
    fallingEffectActivityLinkDatabaseEnabled: true as boolean,
    fallingEffectActivityLinkBuildEnabled: true as boolean,
    fallingEffectActivityLinkAgentEnabled: true as boolean,
    fallingEffectActivityLinkColorMode: "matrix" as const,
    fallingEffectActivityLinkRetentionSeconds: 30,
    continueBackgroundAnimations: false,
  } satisfies Partial<UnifiedSettings>,
  createAtmosphereScene: vi.fn((kind: "snow" | "rain" | "matrix" = "matrix") => ({
    kind,
    width: 1_024,
    height: 768,
    particles: Array.from({ length: 12 }, () => ({})),
  })),
  updateMatrixActivityAnimationInPlace: vi.fn(),
  drawMatrixActivityAnimation: vi.fn(),
  drawAtmosphereScene: vi.fn(),
  applyMatrixWorkVocabularyInPlace: vi.fn(),
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: <T,>(selector: (settings: typeof mocks.settings) => T) => selector(mocks.settings),
}));

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

vi.mock("../rpc/serverState", () => ({
  useServerConfig: () => ({
    ambientExperienceCapabilities: { atmosphere: true },
  }),
}));

vi.mock("../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    client: {
      server: {
        subscribeUsageStats: (subscriber: (snapshot: UsageStatsSnapshot) => void) => {
          mocks.usageStatsSubscriber = subscriber;
          return mocks.usageStatsUnsubscribe;
        },
      },
    },
  }),
}));

vi.mock("../store", () => ({
  useStore: <T,>(
    selector: (state: { activityEventsKey: string; workVocabularyKey: string }) => T,
  ) =>
    selector({
      activityEventsKey: mocks.activityEventsKey,
      workVocabularyKey: mocks.workVocabularyKey,
    }),
}));

vi.mock("../matrixWorkVocabulary", () => ({
  selectMatrixWorkVocabularyKey: (
    state: { workVocabularyKey: string },
    selectedThreadRef: unknown,
  ) => {
    mocks.selectedVocabularyThreadRefs.push(selectedThreadRef);
    return selectedThreadRef === null ? "" : state.workVocabularyKey;
  },
  decodeMatrixWorkVocabulary: (key: string) => ({
    english: key ? [key] : [],
    japanese: [],
  }),
}));

vi.mock("../matrixActivityOverlay", () => ({
  MATRIX_ACTIVITY_TTL_MS: 8_000,
  selectMatrixActivityEventsKey: (
    state: { activityEventsKey: string },
    selectedThreadRef: unknown,
    inputSelection: { network: boolean; database: boolean; build: boolean; agent: boolean },
  ) => {
    mocks.selectedActivityThreadRefs.push(selectedThreadRef);
    mocks.selectedActivityInputSelections.push(inputSelection);
    return selectedThreadRef === null || !Object.values(inputSelection).some(Boolean)
      ? ""
      : state.activityEventsKey;
  },
  decodeMatrixActivityEvents: (key: string) =>
    key
      ? [
          {
            anchorSeed: key === "activity-2" ? 2 : 0,
            category: "network",
            observedAtMs: mocks.activityObservedAtMs,
            relationHashes: [7],
          },
          {
            anchorSeed: key === "activity-2" ? 3 : 1,
            category: "network",
            observedAtMs: mocks.activityObservedAtMs,
            relationHashes: [7],
          },
        ]
      : [],
  createMatrixActivityAnimationState: () => ({ pulseCount: 0, linkCount: 0 }),
  updateMatrixActivityAnimationInPlace: mocks.updateMatrixActivityAnimationInPlace,
  drawMatrixActivityAnimation: mocks.drawMatrixActivityAnimation,
}));

vi.mock("../windowAtmosphere", () => ({
  MATRIX_2CH_AA_TOKENS: ["(^^)"],
  MATRIX_2CH_ENRICHED_GLYPHS: "仮",
  MATRIX_JAPANESE_GLYPHS: "雨",
  MATRIX_ROMAN_GLYPHS: "01",
  createSeededRandom: () => () => 0.5,
  calculateAtmosphereParticleCount: () => 4,
  createAtmosphereScene: mocks.createAtmosphereScene,
  createMatrixColorAnimationState: () => ({}),
  fitAtmosphereDpr: () => 1,
  advanceAtmosphereSceneInPlace: vi.fn(),
  applyMatrixWorkVocabularyInPlace: mocks.applyMatrixWorkVocabularyInPlace,
  resolveMatrixAtmosphereColorFrame: (...args: unknown[]) => {
    mocks.matrixColorCycleSpeeds.push(args[6] as number);
    mocks.matrixColorTimestamps.push(args[3] as number);
    return {
      color: `hsl(${String(args[3])})`,
      perStream: true,
      baseHue: 120,
      saturation: 88,
      lightness: 62,
    };
  },
  resolveAtmosphereColor: () => "#4ade80",
  resolveAtmosphereRenderOpacity: (opacity: number, staticFrame: boolean) =>
    staticFrame ? opacity * 0.55 : opacity,
  drawAtmosphereScene: mocks.drawAtmosphereScene,
  shouldShowAtmosphere: (state: {
    enabled: boolean;
    documentVisible: boolean;
    windowFocused: boolean;
    continueBackgroundAnimations: boolean;
  }) =>
    state.enabled &&
    (state.continueBackgroundAnimations || (state.documentVisible && state.windowFocused)),
  shouldAnimateAtmosphere: (state: {
    enabled: boolean;
    reducedMotion: boolean;
    documentVisible: boolean;
    windowFocused: boolean;
    continueBackgroundAnimations: boolean;
  }) =>
    !state.reducedMotion &&
    state.enabled &&
    (state.continueBackgroundAnimations || (state.documentVisible && state.windowFocused)),
}));

vi.mock("../matrixWebGlRenderer", () => ({
  createMatrixWebGl2Renderer: () =>
    mocks.gpuRendererEnabled
      ? {
          kind: "webgl2",
          renderer: {
            render: mocks.gpuRender,
            dispose: mocks.gpuDispose,
          },
        }
      : {
          kind: "canvas2d-fallback",
          reason: "webgl2-unavailable",
          requiresFreshCanvas: true,
        },
}));

import {
  commitAtmosphereCanvasBitmap,
  resizeAtmosphereCanvasBitmap,
  WindowAtmosphere,
} from "./WindowAtmosphere";

let mounted: Awaited<ReturnType<typeof render>> | null = null;
let nextFrameId = 1;
let frameCallbacks = new Map<number, FrameRequestCallback>();
let reducedMotionQuery: MediaQueryList;

function runNextFrame(timestamp: number): void {
  const next = frameCallbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
  expect(next).toBeDefined();
  if (!next) return;
  frameCallbacks.delete(next[0]);
  next[1](timestamp);
}

function setReducedMotionPreference(matches: boolean): void {
  (reducedMotionQuery as unknown as { matches: boolean }).matches = matches;
  const listener = vi
    .mocked(reducedMotionQuery.addEventListener)
    .mock.calls.find(([eventName]) => eventName === "change")?.[1] as (() => void) | undefined;
  expect(listener).toBeTypeOf("function");
  listener?.();
}

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.activityEventsKey = "activity-1";
  mocks.activityObservedAtMs = Date.now();
  mocks.workVocabularyKey = "";
  mocks.settings.fallingEffectsEnabled = true;
  mocks.settings.fallingEffectsOverCinemaEnabled = false;
  mocks.settings.fallingEffectKind = "matrix";
  mocks.settings.fallingEffectMatrixColorCycleSpeed = 32;
  mocks.settings.fallingEffectMatrixBaseFontSize = 14;
  mocks.settings.fallingEffectMatrixMotionMode = "flat";
  mocks.settings.fallingEffectMatrixWalkStartFontSize = 1;
  mocks.settings.fallingEffectMatrixWalkEndFontSize = 72;
  mocks.settings.fallingEffectMatrixWalkLifecyclePercent = 30;
  mocks.settings.fallingEffectMatrixCenterWindIntensity = 4;
  mocks.settings.fallingEffectActivityLinks = true;
  mocks.settings.fallingEffectActivityLinkNetworkEnabled = true;
  mocks.settings.fallingEffectActivityLinkDatabaseEnabled = true;
  mocks.settings.fallingEffectActivityLinkBuildEnabled = true;
  mocks.settings.fallingEffectActivityLinkAgentEnabled = true;
  mocks.settings.fallingEffectActivityLinkRetentionSeconds = 30;
  mocks.settings.fallingEffectUsageReactive = false;
  mocks.selectedActivityThreadRefs = [];
  mocks.selectedActivityInputSelections = [];
  mocks.selectedVocabularyThreadRefs = [];
  mocks.drawnActivityLinkCounts = [];
  mocks.matrixColorCycleSpeeds = [];
  mocks.matrixColorTimestamps = [];
  mocks.drawnMatrixColors = [];
  mocks.gpuRendererEnabled = false;
  mocks.gpuRender.mockClear();
  mocks.gpuDispose.mockClear();
  mocks.usageStatsSubscriber = null;
  mocks.usageStatsUnsubscribe.mockReset();
  mocks.createAtmosphereScene.mockReset();
  mocks.createAtmosphereScene.mockImplementation((kind = "matrix") => ({
    kind,
    width: 1_024,
    height: 768,
    particles: Array.from({ length: 12 }, () => ({})),
  }));
  mocks.updateMatrixActivityAnimationInPlace.mockReset();
  mocks.updateMatrixActivityAnimationInPlace.mockImplementation(
    (
      state: { pulseCount: number; linkCount: number },
      events: readonly { observedAtMs: number }[],
      nowMs: number,
      _particleCount: number,
      _reducedMotion: boolean,
      ttlMs: number,
    ) => {
      const liveEventCount = events.filter((event) => nowMs - event.observedAtMs < ttlMs).length;
      state.pulseCount = liveEventCount;
      state.linkCount = liveEventCount >= 2 ? 1 : 0;
      return state;
    },
  );
  mocks.drawMatrixActivityAnimation.mockReset();
  mocks.drawMatrixActivityAnimation.mockImplementation((...args: unknown[]) => {
    const state = args[2] as { linkCount: number };
    mocks.drawnActivityLinkCounts.push(state.linkCount);
  });
  mocks.drawAtmosphereScene.mockReset();
  mocks.drawAtmosphereScene.mockImplementation((...args: unknown[]) => {
    mocks.drawnMatrixColors.push(args[2] as string);
  });
  mocks.applyMatrixWorkVocabularyInPlace.mockClear();
  nextFrameId = 1;
  frameCallbacks = new Map();

  reducedMotionQuery = {
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  };
  vi.spyOn(window, "matchMedia").mockReturnValue(reducedMotionQuery);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const frameId = nextFrameId;
    nextFrameId += 1;
    frameCallbacks.set(frameId, callback);
    return frameId;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId) => {
    frameCallbacks.delete(frameId);
  });
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  frameCallbacks.clear();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("WindowAtmosphere", () => {
  it("publishes completed frame bitmaps without clearing the visible surface", () => {
    const targetCanvas = document.createElement("canvas");
    targetCanvas.width = 320;
    targetCanvas.height = 180;
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = 320;
    sourceCanvas.height = 180;
    const visibleContext = targetCanvas.getContext("2d");
    expect(visibleContext).not.toBeNull();
    if (visibleContext === null) return;
    const clearRect = vi.spyOn(visibleContext, "clearRect");
    const drawImage = vi.spyOn(visibleContext, "drawImage");

    commitAtmosphereCanvasBitmap(targetCanvas, visibleContext, sourceCanvas);

    expect(clearRect).not.toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalledWith(sourceCanvas, 0, 0, 320, 180);
  });

  it("does not reset an unchanged canvas bitmap", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d");
    expect(context).not.toBeNull();
    if (context === null) return;
    context.fillStyle = "#ff0000";
    context.fillRect(0, 0, 1, 1);

    expect(resizeAtmosphereCanvasBitmap(canvas, 320, 180)).toBe(false);
    expect(context.getImageData(0, 0, 1, 1).data[3]).toBe(255);
    expect(resizeAtmosphereCanvasBitmap(canvas, 321, 180)).toBe(true);
    expect(context.getImageData(0, 0, 1, 1).data[3]).toBe(0);
  });

  it("covers the viewport without intercepting or exposing decorative content", async () => {
    mounted = await render(<WindowAtmosphere />);

    const canvasLocator = page.getByTestId("window-atmosphere");
    await expect.element(canvasLocator).toBeInTheDocument();
    const canvas = canvasLocator.element();
    const style = getComputedStyle(canvas);
    const bounds = canvas.getBoundingClientRect();

    expect(canvas.getAttribute("aria-hidden")).toBe("true");
    expect(style.pointerEvents).toBe("none");
    expect(style.position).toBe("fixed");
    expect(style.transform).toBe("none");
    expect(style.willChange).toBe("auto");
    expect(bounds.left).toBe(0);
    expect(bounds.top).toBe(0);
    expect(bounds.width).toBe(window.innerWidth);
    expect(bounds.height).toBe(window.innerHeight);
    await expect.element(canvasLocator).toHaveAttribute("data-atmosphere-renderer", "canvas2d");
    await expect
      .element(canvasLocator)
      .toHaveAttribute("data-atmosphere-renderer-acceleration", "browser-managed");
    await expect
      .element(canvasLocator)
      .toHaveAttribute("data-atmosphere-text-rasterization", "main-thread");
    await expect
      .element(canvasLocator)
      .toHaveAttribute("data-atmosphere-frame-commit", "atomic-copy");
    expect(["available-not-active", "unavailable"]).toContain(
      canvas.getAttribute("data-atmosphere-offscreen-canvas"),
    );
    const context = (canvas as HTMLCanvasElement).getContext("2d");
    expect(context).not.toBeNull();
    expect(context?.getContextAttributes().desynchronized).toBe(false);
    expect(document.querySelector('[data-testid="cinema-falling-atmosphere"]')).toBeNull();
  });

  it("turns aggregate output-token throughput into bounded rain density", async () => {
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(0);
    mocks.settings.fallingEffectKind = "rain";
    mocks.settings.fallingEffectUsageReactive = true;

    mounted = await render(<WindowAtmosphere />);
    await expect.poll(() => mocks.usageStatsSubscriber).toBeTypeOf("function");
    const sceneCreationCall = mocks.createAtmosphereScene.mock.calls[0] as
      | readonly unknown[]
      | undefined;
    expect(sceneCreationCall?.[4]).toBe(2.5);

    mocks.usageStatsSubscriber?.({
      totals: { generatingMs: 1_000, outputTokens: 1_000, userMessages: 1 },
      today: {
        day: "2026-08-09",
        generatingMs: 1_000,
        outputTokens: 1_000,
        userMessages: 1,
      },
      activeSessionCount: 2,
      collectionEnabled: true,
      asOfMs: 0,
    });
    dateNow.mockReturnValue(1_000);
    mocks.usageStatsSubscriber?.({
      totals: { generatingMs: 2_000, outputTokens: 1_150, userMessages: 1 },
      today: {
        day: "2026-08-09",
        generatingMs: 2_000,
        outputTokens: 1_150,
        userMessages: 1,
      },
      activeSessionCount: 2,
      collectionEnabled: true,
      asOfMs: 1_000,
    });

    runNextFrame(1_000);
    const canvas = page.getByTestId("window-atmosphere");
    await expect.element(canvas).toHaveAttribute("data-atmosphere-usage-reactive", "true");
    await expect.element(canvas).toHaveAttribute("data-atmosphere-usage-tokens-per-second", "30.0");
    await expect.element(canvas).toHaveAttribute("data-atmosphere-usage-intensity", "0.500");
    await expect.element(canvas).toHaveAttribute("data-atmosphere-usage-active-sessions", "2");
    await expect.element(canvas).toHaveAttribute("data-atmosphere-active-particle-count", "8");

    await mounted.unmount();
    mounted = null;
    expect(mocks.usageStatsUnsubscribe).toHaveBeenCalledOnce();
  });

  it("activates the WebGL2 glyph atlas while retaining the Canvas2D activity overlay", async () => {
    mocks.gpuRendererEnabled = true;
    const drawImage = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
    const clearRect = vi.spyOn(CanvasRenderingContext2D.prototype, "clearRect");

    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    const canvasLocator = page.getByTestId("window-atmosphere");
    const gpuCanvasLocator = page.getByTestId("window-atmosphere-gpu");
    await expect
      .element(canvasLocator)
      .toHaveAttribute("data-atmosphere-renderer", "webgl2-glyph-atlas");
    await expect
      .element(canvasLocator)
      .toHaveAttribute("data-atmosphere-renderer-acceleration", "gpu");
    await expect
      .element(canvasLocator)
      .toHaveAttribute("data-atmosphere-text-rasterization", "gpu-glyph-atlas");
    await expect
      .element(gpuCanvasLocator)
      .toHaveAttribute("data-matrix-gpu-availability", "available");
    expect(getComputedStyle(gpuCanvasLocator.element()).visibility).toBe("visible");
    expect(mocks.gpuRender).toHaveBeenCalledTimes(1);
    expect(mocks.drawMatrixActivityAnimation).toHaveBeenCalledTimes(1);
    expect(clearRect).toHaveBeenCalled();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it.each(["flat", "forward", "reverse", "walk-forward", "walk-reverse"] as const)(
    "repaints %s activity immediately without clearing the full-window surface",
    async (motionMode) => {
      mocks.settings.fallingEffectMatrixMotionMode = motionMode;
      mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
      const canvas = page.getByTestId("window-atmosphere").element() as HTMLCanvasElement;
      const visibleContext = canvas.getContext("2d");
      expect(visibleContext).not.toBeNull();
      if (visibleContext === null) return;
      const clearRect = vi.spyOn(visibleContext, "clearRect");
      mocks.drawAtmosphereScene.mockClear();

      mocks.activityEventsKey = "activity-2";
      await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

      expect(mocks.drawAtmosphereScene).toHaveBeenCalledTimes(1);
      expect(clearRect).not.toHaveBeenCalled();
      expect(canvas.dataset.atmosphereFrameCommit).toBe("atomic-copy");
    },
  );

  it("clips only falling particles over streaming cinema media without intercepting controls", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    mocks.settings.fallingEffectsOverCinemaEnabled = true;
    const player = document.createElement("section");
    player.dataset.ambientProtectedPlayer = "true";
    const iframe = document.createElement("iframe");
    vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue({
      x: 120,
      y: 80,
      width: 640,
      height: 360,
      top: 80,
      right: 760,
      bottom: 440,
      left: 120,
      toJSON: () => ({}),
    });
    player.append(iframe);
    document.body.append(player);

    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    const overlay = page.getByTestId("cinema-falling-atmosphere");
    await expect.element(overlay).toHaveAttribute("data-cinema-atmosphere-visible", "true");
    const overlayElement = overlay.element();
    expect(getComputedStyle(overlayElement).pointerEvents).toBe("none");
    expect(overlayElement.style.clipPath).toBe(
      `inset(80px ${String(Math.max(0, window.innerWidth - 760))}px ${String(
        window.innerHeight - 440,
      )}px 120px)`,
    );
    await expect.poll(() => mocks.drawAtmosphereScene.mock.calls.length).toBe(1);
    expect(mocks.drawMatrixActivityAnimation).toHaveBeenCalledTimes(1);
    expect(mocks.drawMatrixActivityAnimation.mock.calls[0]?.[0]).not.toBe(
      mocks.drawAtmosphereScene.mock.calls[0]?.[0],
    );
  });

  it("clips a pointer-transparent Matrix copy above only the Atmosphere console", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    const drawImage = vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage");
    const consoleSurface = document.createElement("section");
    consoleSurface.dataset.atmosphereConsoleSurface = "true";
    vi.spyOn(consoleSurface, "getBoundingClientRect").mockReturnValue({
      x: 120,
      y: 90,
      width: 360,
      height: 240,
      top: 90,
      left: 120,
      right: 480,
      bottom: 330,
      toJSON: () => ({}),
    });
    document.body.append(consoleSurface);

    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    const overlay = page.getByTestId("atmosphere-console-matrix-overlay");
    await expect
      .element(overlay)
      .toHaveAttribute("data-atmosphere-console-overlay-visible", "true");
    const overlayElement = overlay.element();
    expect(getComputedStyle(overlayElement).pointerEvents).toBe("none");
    expect(getComputedStyle(overlayElement).zIndex).toBe("86");
    expect(getComputedStyle(overlayElement).opacity).toBe("0.4");
    expect(overlayElement.style.clipPath).toBe(
      `inset(90px ${String(Math.max(0, window.innerWidth - 480))}px ${String(
        window.innerHeight - 330,
      )}px 120px)`,
    );
    await expect.poll(() => drawImage.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(mocks.drawAtmosphereScene).toHaveBeenCalledTimes(1);

    mocks.settings.fallingEffectKind = "rain";
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    expect(document.querySelector('[data-testid="atmosphere-console-matrix-overlay"]')).toBeNull();
  });

  it("does not repaint the hidden cinema copy until a video surface appears", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    mocks.settings.fallingEffectsOverCinemaEnabled = true;

    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    const overlay = page.getByTestId("cinema-falling-atmosphere");
    await expect.element(overlay).toHaveAttribute("data-cinema-atmosphere-visible", "false");
    await expect.poll(() => mocks.drawAtmosphereScene.mock.calls.length).toBe(1);

    const player = document.createElement("section");
    player.dataset.ambientProtectedPlayer = "true";
    const iframe = document.createElement("iframe");
    vi.spyOn(iframe, "getBoundingClientRect").mockReturnValue({
      x: 120,
      y: 80,
      width: 640,
      height: 360,
      top: 80,
      right: 760,
      bottom: 440,
      left: 120,
      toJSON: () => ({}),
    });
    player.append(iframe);
    document.body.append(player);

    await expect.element(overlay).toHaveAttribute("data-cinema-atmosphere-visible", "true");
    await expect.poll(() => mocks.drawAtmosphereScene.mock.calls.length).toBe(2);
  });

  it("tracks a local cinema video surface but remains hidden for cinema audio", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    mocks.settings.fallingEffectsOverCinemaEnabled = true;
    const player = document.createElement("section");
    player.setAttribute("aria-label", "Local media player");
    player.dataset.localMediaPresentation = "cinema";
    const video = document.createElement("video");
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
      x: 40,
      y: 64,
      width: 800,
      height: 450,
      top: 64,
      right: 840,
      bottom: 514,
      left: 40,
      toJSON: () => ({}),
    });
    player.append(video);
    document.body.append(player);

    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    const overlay = page.getByTestId("cinema-falling-atmosphere");
    await expect.element(overlay).toHaveAttribute("data-cinema-atmosphere-visible", "true");

    video.remove();
    player.append(document.createElement("audio"));
    await expect.element(overlay).toHaveAttribute("data-cinema-atmosphere-visible", "false");
    expect(overlay.element().style.visibility).toBe("hidden");
  });

  it("scopes both Matrix signals to the selected routed thread without reseeding", async () => {
    const environmentId = EnvironmentId.make("environment-matrix");
    const firstThreadId = ThreadId.make("thread-first");
    const secondThreadId = ThreadId.make("thread-second");
    mounted = await render(
      <WindowAtmosphere selectedThreadRef={{ environmentId, threadId: firstThreadId }} />,
    );
    await expect.poll(() => mocks.createAtmosphereScene.mock.calls.length).toBe(1);

    expect(mocks.selectedActivityThreadRefs.at(-1)).toEqual({
      environmentId,
      threadId: firstThreadId,
    });
    expect(mocks.selectedActivityInputSelections.at(-1)).toEqual({
      network: true,
      database: true,
      build: true,
      agent: true,
    });
    expect(mocks.selectedVocabularyThreadRefs.at(-1)).toEqual({
      environmentId,
      threadId: firstThreadId,
    });

    await mounted.rerender(
      <WindowAtmosphere selectedThreadRef={{ environmentId, threadId: secondThreadId }} />,
    );

    expect(mocks.selectedActivityThreadRefs.at(-1)).toEqual({
      environmentId,
      threadId: secondThreadId,
    });
    expect(mocks.selectedVocabularyThreadRefs.at(-1)).toEqual({
      environmentId,
      threadId: secondThreadId,
    });
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);
  });

  it("forwards color-cycle speed changes without reseeding the Matrix scene", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    await expect.poll(() => mocks.matrixColorCycleSpeeds.at(-1)).toBe(32);

    mocks.settings.fallingEffectMatrixColorCycleSpeed = 64;
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    expect(mocks.matrixColorCycleSpeeds.at(-1)).toBe(64);
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);
  });

  it("applies verified-route retention changes without reseeding the Matrix scene", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    await expect
      .poll(() => mocks.updateMatrixActivityAnimationInPlace.mock.calls.at(-1)?.[5])
      .toBe(30_000);

    mocks.settings.fallingEffectActivityLinkRetentionSeconds = 60;
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    expect(mocks.updateMatrixActivityAnimationInPlace).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.any(Array),
      expect.any(Number),
      12,
      true,
      60_000,
    );
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);
  });

  it("filters all unchecked activity inputs and repaints without reseeding", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    await expect.poll(() => mocks.drawAtmosphereScene.mock.calls.length).toBeGreaterThan(0);

    mocks.drawAtmosphereScene.mockClear();
    mocks.updateMatrixActivityAnimationInPlace.mockClear();
    mocks.settings.fallingEffectActivityLinkNetworkEnabled = false;
    mocks.settings.fallingEffectActivityLinkDatabaseEnabled = false;
    mocks.settings.fallingEffectActivityLinkBuildEnabled = false;
    mocks.settings.fallingEffectActivityLinkAgentEnabled = false;
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    expect(mocks.selectedActivityInputSelections.at(-1)).toEqual({
      network: false,
      database: false,
      build: false,
      agent: false,
    });
    expect(mocks.updateMatrixActivityAnimationInPlace).toHaveBeenLastCalledWith(
      expect.anything(),
      [],
      expect.any(Number),
      12,
      true,
      30_000,
    );
    expect(mocks.drawAtmosphereScene).toHaveBeenCalledTimes(1);
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);
  });

  it("clears committed thread signals before a reduced-motion null-route paint", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    mocks.workVocabularyKey = "work-first";
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    await expect.poll(() => mocks.drawAtmosphereScene.mock.calls.length).toBeGreaterThan(0);

    mocks.applyMatrixWorkVocabularyInPlace.mockClear();
    mocks.drawAtmosphereScene.mockClear();
    mocks.updateMatrixActivityAnimationInPlace.mockClear();
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={null} />);

    expect(mocks.selectedActivityThreadRefs.at(-1)).toBeNull();
    expect(mocks.selectedVocabularyThreadRefs.at(-1)).toBeNull();
    expect(mocks.applyMatrixWorkVocabularyInPlace).toHaveBeenLastCalledWith(
      expect.anything(),
      { english: [], japanese: [] },
      expect.any(Function),
    );
    expect(mocks.updateMatrixActivityAnimationInPlace).toHaveBeenLastCalledWith(
      expect.anything(),
      [],
      expect.any(Number),
      12,
      true,
      30_000,
    );
    expect(mocks.applyMatrixWorkVocabularyInPlace.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.drawAtmosphereScene.mock.invocationCallOrder[0]!,
    );
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);
  });

  it("repaints reduced-motion vocabulary before paint when activity links are disabled", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    mocks.settings.fallingEffectActivityLinks = false;
    mocks.workVocabularyKey = "work-first";
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    await expect.poll(() => mocks.drawAtmosphereScene.mock.calls.length).toBeGreaterThan(0);

    mocks.applyMatrixWorkVocabularyInPlace.mockClear();
    mocks.drawAtmosphereScene.mockClear();
    mocks.updateMatrixActivityAnimationInPlace.mockClear();
    mocks.workVocabularyKey = "work-second";
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    expect(mocks.applyMatrixWorkVocabularyInPlace).toHaveBeenLastCalledWith(
      expect.anything(),
      { english: ["work-second"], japanese: [] },
      expect.any(Function),
    );
    expect(mocks.drawAtmosphereScene).toHaveBeenCalledTimes(1);
    expect(mocks.applyMatrixWorkVocabularyInPlace.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.drawAtmosphereScene.mock.invocationCallOrder[0]!,
    );
    expect(mocks.updateMatrixActivityAnimationInPlace).not.toHaveBeenCalled();

    mocks.applyMatrixWorkVocabularyInPlace.mockClear();
    mocks.drawAtmosphereScene.mockClear();
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={null} />);

    expect(mocks.applyMatrixWorkVocabularyInPlace).toHaveBeenLastCalledWith(
      expect.anything(),
      { english: [], japanese: [] },
      expect.any(Function),
    );
    expect(mocks.drawAtmosphereScene).toHaveBeenCalledTimes(1);
    expect(mocks.applyMatrixWorkVocabularyInPlace.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.drawAtmosphereScene.mock.invocationCallOrder[0]!,
    );
    expect(mocks.updateMatrixActivityAnimationInPlace).not.toHaveBeenCalled();
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);
  });

  it("updates live activity with the current wall clock and coalesces resize bursts", async () => {
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(10_000);
    mocks.activityObservedAtMs = 9_000;
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    await expect.poll(() => mocks.createAtmosphereScene.mock.calls.length).toBe(1);

    runNextFrame(1_000);
    expect(matrixColorFrameStore.getSnapshot()).toMatchObject({
      frame: { color: "hsl(1000)" },
      motion: "animated",
    });
    expect(mocks.updateMatrixActivityAnimationInPlace).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ observedAtMs: 9_000 })]),
      10_000,
      12,
      false,
      30_000,
    );

    mocks.activityEventsKey = "activity-2";
    mocks.activityObservedAtMs = 19_000;
    dateNow.mockReturnValue(20_000);
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);

    runNextFrame(1_016);
    expect(matrixColorFrameStore.getSnapshot()).toMatchObject({
      frame: { color: "hsl(1016)" },
      motion: "animated",
    });
    expect(mocks.updateMatrixActivityAnimationInPlace).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ observedAtMs: 19_000 })]),
      20_000,
      12,
      false,
      30_000,
    );
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);

    const scheduledBeforeResize = frameCallbacks.size;
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new Event("resize"));
    expect(frameCallbacks.size).toBe(scheduledBeforeResize + 1);
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);

    // The animation frame was queued first; its successor remains ahead of the
    // coalesced resize callback, so advance both in queue order.
    runNextFrame(1_032);
    runNextFrame(1_033);
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(2);
  });

  it("repaints static reduced-motion activity and work terms without reseeding", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    await expect.poll(() => mocks.drawAtmosphereScene.mock.calls.length).toBe(1);
    expect(frameCallbacks.size).toBe(0);
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);
    // Initial vocabulary is injected while creating the scene. The in-place
    // updater is reserved for later exact-thread vocabulary changes.
    expect(mocks.applyMatrixWorkVocabularyInPlace).toHaveBeenCalledTimes(0);

    mocks.drawAtmosphereScene.mockClear();
    mocks.activityEventsKey = "activity-2";
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    expect(mocks.drawAtmosphereScene).toHaveBeenCalledTimes(1);
    expect(mocks.updateMatrixActivityAnimationInPlace).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ observedAtMs: mocks.activityObservedAtMs }),
      ]),
      expect.any(Number),
      12,
      true,
      30_000,
    );
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);

    mocks.drawAtmosphereScene.mockClear();
    mocks.applyMatrixWorkVocabularyInPlace.mockClear();
    mocks.workVocabularyKey = "work-2";
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    expect(mocks.applyMatrixWorkVocabularyInPlace).toHaveBeenCalledTimes(1);
    expect(mocks.drawAtmosphereScene).toHaveBeenCalledTimes(1);
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);
  });

  it("keeps the reduced-motion Matrix palette static through unrelated repaints", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    const performanceNow = vi.spyOn(performance, "now").mockReturnValue(1_000);
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    await expect.poll(() => mocks.drawnMatrixColors.length).toBeGreaterThan(0);
    const initialColor = mocks.drawnMatrixColors.at(-1);
    expect(matrixColorFrameStore.getSnapshot()).toMatchObject({
      frame: { color: initialColor },
      motion: "frozen",
    });

    performanceNow.mockReturnValue(2_000);
    mocks.activityEventsKey = "activity-2";
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    expect(mocks.matrixColorTimestamps).toEqual([1_000]);
    expect(mocks.drawnMatrixColors.at(-1)).toBe(initialColor);
    expect(matrixColorFrameStore.getSnapshot()).toMatchObject({
      frame: { color: initialColor },
      motion: "frozen",
    });
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);
  });

  it("freezes the exact animated Matrix frame when reduced motion turns on", async () => {
    vi.spyOn(performance, "now").mockReturnValue(9_000);
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    runNextFrame(1_000);
    expect(matrixColorFrameStore.getSnapshot()).toMatchObject({
      frame: { color: "hsl(1000)" },
      motion: "animated",
    });

    setReducedMotionPreference(true);

    expect(mocks.matrixColorTimestamps).toEqual([9_000, 1_000]);
    expect(mocks.drawnMatrixColors.at(-1)).toBe("hsl(1000)");
    expect(matrixColorFrameStore.getSnapshot()).toMatchObject({
      frame: { color: "hsl(1000)" },
      motion: "frozen",
    });
    expect(frameCallbacks.size).toBe(0);
  });

  it("freezes the exact animated Matrix frame when falling effects turn off", async () => {
    vi.spyOn(performance, "now").mockReturnValue(9_000);
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    runNextFrame(1_000);

    mocks.settings.fallingEffectsEnabled = false;
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    expect(mocks.matrixColorTimestamps).toEqual([9_000, 1_000]);
    expect(matrixColorFrameStore.getSnapshot()).toMatchObject({
      frame: { color: "hsl(1000)" },
      motion: "frozen",
    });
    expect(document.querySelector('[data-testid="window-atmosphere"]')).toBeNull();
    expect(frameCallbacks.size).toBe(0);
  });

  it("publishes one frozen Matrix palette while falling effects are disabled", async () => {
    mocks.settings.fallingEffectsEnabled = false;
    const performanceNow = vi.spyOn(performance, "now").mockReturnValue(5_000);

    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    await expect.poll(() => matrixColorFrameStore.getSnapshot()?.frame.color).toBe("hsl(5000)");
    expect(matrixColorFrameStore.getSnapshot()?.motion).toBe("frozen");
    expect(document.querySelector('[data-testid="window-atmosphere"]')).toBeNull();
    expect(frameCallbacks.size).toBe(0);

    performanceNow.mockReturnValue(9_000);
    mocks.settings.fallingEffectMatrixColorCycleSpeed = 64;
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    expect(matrixColorFrameStore.getSnapshot()).toMatchObject({
      frame: { color: "hsl(9000)" },
      motion: "frozen",
    });
    expect(mocks.matrixColorCycleSpeeds).toEqual([32, 64]);
    expect(mocks.matrixColorTimestamps).toEqual([5_000, 9_000]);

    performanceNow.mockReturnValue(12_000);
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    expect(matrixColorFrameStore.getSnapshot()?.frame.color).toBe("hsl(9000)");
    expect(mocks.matrixColorTimestamps).toEqual([5_000, 9_000]);
    expect(frameCallbacks.size).toBe(0);
  });

  it("seeds and refreshes one frozen Matrix frame while visible but unfocused", async () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const performanceNow = vi.spyOn(performance, "now").mockReturnValue(5_000);
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    await expect.poll(() => matrixColorFrameStore.getSnapshot()?.frame.color).toBe("hsl(5000)");
    expect(matrixColorFrameStore.getSnapshot()?.motion).toBe("frozen");
    expect(frameCallbacks.size).toBe(0);

    performanceNow.mockReturnValue(9_000);
    mocks.settings.fallingEffectMatrixColorCycleSpeed = 64;
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    expect(matrixColorFrameStore.getSnapshot()).toMatchObject({
      frame: { color: "hsl(9000)" },
      motion: "frozen",
    });
    expect(mocks.matrixColorCycleSpeeds).toEqual([32, 64]);
    expect(mocks.matrixColorTimestamps).toEqual([5_000, 9_000]);
    expect(frameCallbacks.size).toBe(0);
  });

  it("passes Flat, Forward, Reverse, and Warp through for snow, rain, and Matrix", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    for (const kind of ["snow", "rain", "matrix"] as const) {
      for (const motionMode of [
        "flat",
        "forward",
        "reverse",
        "tunnel",
        "walk-forward",
        "walk-reverse",
      ] as const) {
        mocks.settings.fallingEffectKind = kind;
        mocks.settings.fallingEffectMatrixMotionMode = motionMode;
        await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

        expect(mocks.createAtmosphereScene).toHaveBeenLastCalledWith(
          kind,
          expect.any(Number),
          expect.any(Number),
          expect.any(Function),
          expect.any(Number),
          expect.any(Number),
          expect.any(Boolean),
          expect.any(Object),
          motionMode,
          30,
          4,
        );
        expect(mocks.drawAtmosphereScene.mock.calls.at(-1)?.[5]).toBe(motionMode);
        expect(frameCallbacks.size).toBe(0);
      }
    }
  });

  it("forwards Walk endpoints to glyphs/connectors and the Matrix baseline only to glyphs", async () => {
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    mocks.settings.fallingEffectMatrixMotionMode = "walk-forward";
    mocks.settings.fallingEffectMatrixWalkStartFontSize = 12.3;
    mocks.settings.fallingEffectMatrixWalkEndFontSize = 24.6;
    mocks.settings.fallingEffectMatrixBaseFontSize = 28;
    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    await expect
      .poll(() => mocks.drawAtmosphereScene.mock.calls.at(-1)?.slice(5, 9))
      .toEqual(["walk-forward", 12.3, 24.6, 28]);
    expect(mocks.drawMatrixActivityAnimation.mock.calls.at(-1)?.slice(6, 9)).toEqual([
      "walk-forward",
      12.3,
      24.6,
    ]);

    mocks.settings.fallingEffectMatrixMotionMode = "walk-reverse";
    mocks.settings.fallingEffectMatrixWalkStartFontSize = 8.1;
    mocks.settings.fallingEffectMatrixWalkEndFontSize = 48.2;
    mocks.settings.fallingEffectMatrixBaseFontSize = 36;
    await mounted.rerender(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);

    expect(mocks.drawAtmosphereScene.mock.calls.at(-1)?.slice(5, 9)).toEqual([
      "walk-reverse",
      8.1,
      48.2,
      36,
    ]);
    expect(mocks.drawMatrixActivityAnimation.mock.calls.at(-1)?.slice(6, 9)).toEqual([
      "walk-reverse",
      8.1,
      48.2,
    ]);
  });

  it("expires a reduced-motion static activity link with one bounded timer", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    type WindowTimer = ReturnType<typeof window.setTimeout>;
    const timerCallbacks = new Map<WindowTimer, () => void>();
    let nextTimerId = 1;
    const setTimeout = vi.spyOn(window, "setTimeout").mockImplementation((handler) => {
      if (typeof handler !== "function") {
        throw new TypeError("Expected a function timer handler");
      }
      const timerId = nextTimerId as unknown as WindowTimer;
      nextTimerId += 1;
      timerCallbacks.set(timerId, handler);
      return timerId;
    });
    vi.spyOn(window, "clearTimeout").mockImplementation((timerId) => {
      if (timerId !== undefined) {
        timerCallbacks.delete(timerId as WindowTimer);
      }
    });
    (reducedMotionQuery as unknown as { matches: boolean }).matches = true;
    mocks.activityObservedAtMs = 100_000;

    mounted = await render(<WindowAtmosphere selectedThreadRef={TEST_SELECTED_THREAD_REF} />);
    expect(mocks.drawnActivityLinkCounts).toEqual([1]);
    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(setTimeout.mock.calls[0]?.[1]).toBe(8_001);
    expect(timerCallbacks.size).toBe(1);

    now.mockReturnValue(108_001);
    const [pulseTimerId, expirePulse] = timerCallbacks.entries().next().value as [
      WindowTimer,
      () => void,
    ];
    timerCallbacks.delete(pulseTimerId);
    expirePulse();

    expect(mocks.drawnActivityLinkCounts).toEqual([1, 1]);
    expect(timerCallbacks.size).toBe(1);
    expect(setTimeout).toHaveBeenCalledTimes(2);
    expect(setTimeout.mock.calls[1]?.[1]).toBe(22_000);

    now.mockReturnValue(130_001);
    const [routeTimerId, expireRoute] = timerCallbacks.entries().next().value as [
      WindowTimer,
      () => void,
    ];
    timerCallbacks.delete(routeTimerId);
    expireRoute();

    expect(mocks.drawnActivityLinkCounts).toEqual([1, 1, 0]);
    expect(timerCallbacks.size).toBe(0);
    expect(setTimeout).toHaveBeenCalledTimes(2);
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);
  });

  it("cancels frames and removes its reduced-motion listener on unmount", async () => {
    const windowAddEventListener = vi.spyOn(window, "addEventListener");
    const windowRemoveEventListener = vi.spyOn(window, "removeEventListener");
    const documentAddEventListener = vi.spyOn(document, "addEventListener");
    const documentRemoveEventListener = vi.spyOn(document, "removeEventListener");
    const cancelAnimationFrame = vi.mocked(window.cancelAnimationFrame);
    mounted = await render(<WindowAtmosphere />);
    window.dispatchEvent(new Event("resize"));
    const pendingFrameIds = [...frameCallbacks.keys()];
    const resizeListener = windowAddEventListener.mock.calls.find(
      ([eventName]) => eventName === "resize",
    )?.[1];
    const focusListener = windowAddEventListener.mock.calls.find(
      ([eventName]) => eventName === "focus",
    )?.[1];
    const blurListener = windowAddEventListener.mock.calls.find(
      ([eventName]) => eventName === "blur",
    )?.[1];
    const visibilityListener = documentAddEventListener.mock.calls.find(
      ([eventName]) => eventName === "visibilitychange",
    )?.[1];

    await mounted.unmount();
    mounted = null;

    for (const frameId of pendingFrameIds) {
      expect(cancelAnimationFrame).toHaveBeenCalledWith(frameId);
    }
    expect(frameCallbacks.size).toBe(0);
    expect(resizeListener).toBeDefined();
    expect(focusListener).toBeDefined();
    expect(blurListener).toBeDefined();
    expect(visibilityListener).toBeDefined();
    expect(windowRemoveEventListener).toHaveBeenCalledWith("resize", resizeListener);
    expect(windowRemoveEventListener).toHaveBeenCalledWith("focus", focusListener);
    expect(windowRemoveEventListener).toHaveBeenCalledWith("blur", blurListener);
    expect(documentRemoveEventListener).toHaveBeenCalledWith(
      "visibilitychange",
      visibilityListener,
    );
    expect(reducedMotionQuery.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });
});
