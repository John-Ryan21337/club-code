import "../index.css";

import type { UnifiedSettings } from "@cafecode/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

const mocks = vi.hoisted(() => ({
  activityEventsKey: "activity-1",
  activityObservedAtMs: 10_000,
  workVocabularyKey: "",
  drawnActivityLinkCounts: [] as number[],
  settings: {
    fallingEffectsEnabled: true,
    fallingEffectKind: "matrix" as const,
    fallingEffectColor: "auto" as const,
    fallingEffectMatrixColorMode: "rainbow-extra" as const,
    fallingEffectOpacity: 0.35,
    fallingEffectSpeed: 1,
    fallingEffectDensity: 1,
    fallingEffectJapaneseRatio: 0.5,
    fallingEffect2chEnriched: true,
    fallingEffectLiveWorkVocabulary: true,
    fallingEffectActivityLinks: true,
    fallingEffectActivityLinkColorMode: "matrix" as const,
    continueBackgroundAnimations: false,
  } satisfies Partial<UnifiedSettings>,
  createAtmosphereScene: vi.fn(() => ({
    kind: "matrix" as const,
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
  selectMatrixWorkVocabularyKey: (state: { workVocabularyKey: string }) => state.workVocabularyKey,
  decodeMatrixWorkVocabulary: () => ({ english: [], japanese: [] }),
}));

vi.mock("../matrixActivityOverlay", () => ({
  MATRIX_ACTIVITY_TTL_MS: 2_200,
  selectMatrixActivityEventsKey: (state: { activityEventsKey: string }) => state.activityEventsKey,
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
  createSeededRandom: () => () => 0.5,
  createAtmosphereScene: mocks.createAtmosphereScene,
  createMatrixColorAnimationState: () => ({}),
  fitAtmosphereDpr: () => 1,
  advanceAtmosphereSceneInPlace: vi.fn(),
  applyMatrixWorkVocabularyInPlace: mocks.applyMatrixWorkVocabularyInPlace,
  resolveMatrixAtmosphereColorFrame: () => ({
    color: "#4ade80",
    perStream: true,
    baseHue: 120,
    saturation: 88,
    lightness: 62,
  }),
  resolveAtmosphereColor: () => "#4ade80",
  drawAtmosphereScene: mocks.drawAtmosphereScene,
  shouldAnimateAtmosphere: (state: { reducedMotion: boolean }) => !state.reducedMotion,
}));

import { WindowAtmosphere } from "./WindowAtmosphere";

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

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.activityEventsKey = "activity-1";
  mocks.activityObservedAtMs = Date.now();
  mocks.workVocabularyKey = "";
  mocks.drawnActivityLinkCounts = [];
  mocks.createAtmosphereScene.mockClear();
  mocks.updateMatrixActivityAnimationInPlace.mockReset();
  mocks.updateMatrixActivityAnimationInPlace.mockImplementation(
    (
      state: { pulseCount: number; linkCount: number },
      events: readonly { observedAtMs: number }[],
      nowMs: number,
    ) => {
      const liveEventCount = events.filter((event) => nowMs - event.observedAtMs < 2_200).length;
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
  mocks.drawAtmosphereScene.mockClear();
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
    expect(bounds.left).toBe(0);
    expect(bounds.top).toBe(0);
    expect(bounds.width).toBe(window.innerWidth);
    expect(bounds.height).toBe(window.innerHeight);
  });

  it("updates live activity with the current wall clock and coalesces resize bursts", async () => {
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(10_000);
    mocks.activityObservedAtMs = 9_000;
    mounted = await render(<WindowAtmosphere />);
    await expect.poll(() => mocks.createAtmosphereScene.mock.calls.length).toBe(1);

    runNextFrame(1_000);
    expect(mocks.updateMatrixActivityAnimationInPlace).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ observedAtMs: 9_000 })]),
      10_000,
      12,
      false,
    );

    mocks.activityEventsKey = "activity-2";
    mocks.activityObservedAtMs = 19_000;
    dateNow.mockReturnValue(20_000);
    await mounted.rerender(<WindowAtmosphere />);
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);

    runNextFrame(1_016);
    expect(mocks.updateMatrixActivityAnimationInPlace).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ observedAtMs: 19_000 })]),
      20_000,
      12,
      false,
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
    mounted = await render(<WindowAtmosphere />);
    await expect.poll(() => mocks.drawAtmosphereScene.mock.calls.length).toBe(1);
    expect(frameCallbacks.size).toBe(0);
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);

    mocks.drawAtmosphereScene.mockClear();
    mocks.activityEventsKey = "activity-2";
    await mounted.rerender(<WindowAtmosphere />);
    expect(mocks.drawAtmosphereScene).toHaveBeenCalledTimes(1);
    expect(mocks.updateMatrixActivityAnimationInPlace).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ observedAtMs: mocks.activityObservedAtMs }),
      ]),
      expect.any(Number),
      12,
      true,
    );
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);

    mocks.drawAtmosphereScene.mockClear();
    mocks.workVocabularyKey = "work-2";
    await mounted.rerender(<WindowAtmosphere />);
    expect(mocks.applyMatrixWorkVocabularyInPlace).toHaveBeenCalledTimes(1);
    expect(mocks.drawAtmosphereScene).toHaveBeenCalledTimes(1);
    expect(mocks.createAtmosphereScene).toHaveBeenCalledTimes(1);
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

    mounted = await render(<WindowAtmosphere />);
    expect(mocks.drawnActivityLinkCounts).toEqual([1]);
    expect(setTimeout).toHaveBeenCalledTimes(1);
    expect(setTimeout.mock.calls[0]?.[1]).toBe(2_201);
    expect(timerCallbacks.size).toBe(1);

    now.mockReturnValue(102_201);
    const [timerId, expire] = timerCallbacks.entries().next().value as [WindowTimer, () => void];
    timerCallbacks.delete(timerId);
    expire();

    expect(mocks.drawnActivityLinkCounts).toEqual([1, 0]);
    expect(timerCallbacks.size).toBe(0);
    expect(setTimeout).toHaveBeenCalledTimes(1);
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
