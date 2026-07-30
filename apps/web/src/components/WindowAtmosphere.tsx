import type { ScopedThreadRef } from "@cafecode/contracts";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { useSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import {
  EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL,
  localMediaAudioSignalStore,
} from "../localMediaAudioSignal";
import { MatrixGpuFrameCollector } from "../matrixGpuFrameCollector";
import { matrixColorFrameStore } from "../matrixColorFrameStore";
import { createMatrixWebGl2Renderer, type MatrixWebGl2Renderer } from "../matrixWebGlRenderer";
import {
  createMatrixActivityAnimationState,
  decodeMatrixActivityEvents,
  drawMatrixActivityAnimation,
  MATRIX_ACTIVITY_TTL_MS,
  selectMatrixActivityEventsKey,
  updateMatrixActivityAnimationInPlace,
} from "../matrixActivityOverlay";
import { decodeMatrixWorkVocabulary, selectMatrixWorkVocabularyKey } from "../matrixWorkVocabulary";
import { useServerConfig } from "../rpc/serverState";
import { useStore } from "../store";
import {
  advanceAtmosphereSceneInPlace,
  applyMatrixWorkVocabularyInPlace,
  createMatrixColorAnimationState,
  createAtmosphereScene,
  createSeededRandom,
  drawAtmosphereScene,
  fitAtmosphereDpr,
  MATRIX_2CH_AA_TOKENS,
  MATRIX_2CH_ENRICHED_GLYPHS,
  MATRIX_JAPANESE_GLYPHS,
  MATRIX_ROMAN_GLYPHS,
  resolveAtmosphereColor,
  resolveAtmosphereRenderOpacity,
  resolveMatrixAtmosphereColorFrame,
  shouldAnimateAtmosphere,
  shouldShowAtmosphere,
  type AtmosphereScene,
  type MatrixColorFrame,
} from "../windowAtmosphere";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const CINEMA_MEDIA_SELECTOR = [
  '[data-ambient-protected-player="true"] iframe',
  'section[aria-label="Local media player"][data-local-media-presentation="cinema"] video',
].join(", ");
const HIDDEN_CINEMA_CLIP_PATH = "inset(0 0 100% 0)";
const ATMOSPHERE_CONSOLE_SELECTOR = '[data-atmosphere-console-surface="true"]';
const HIDDEN_CONSOLE_CLIP_PATH = "inset(0 0 100% 0)";
const ATMOSPHERE_CONTEXT_OPTIONS = {
  alpha: true,
  // Keep the browser's synchronized Canvas2D presentation path. A
  // desynchronized full-window alpha canvas may expose an incomplete or
  // newly reallocated bitmap before the detached frame commit is presented.
} as const satisfies CanvasRenderingContext2DSettings;

export interface WindowAtmosphereProps {
  readonly selectedThreadRef?: ScopedThreadRef | null;
}

function sceneSeed(kind: "snow" | "rain" | "matrix", width: number, height: number): number {
  const kindSeed = kind === "snow" ? 0x534e4f57 : kind === "rain" ? 0x5241494e : 0x4d415458;
  return (kindSeed ^ Math.round(width * 31) ^ Math.round(height * 131)) >>> 0;
}

function textSeed(value: string): number {
  let seed = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    seed = Math.imul(seed ^ value.charCodeAt(index), 0x01000193);
  }
  return seed >>> 0;
}

function findCinemaVideoSurface(): HTMLElement | null {
  return document.querySelector<HTMLElement>(CINEMA_MEDIA_SELECTOR);
}

function syncCinemaOverlayClip(canvas: HTMLCanvasElement, surface: HTMLElement | null): boolean {
  if (surface === null || !surface.isConnected) {
    canvas.style.clipPath = HIDDEN_CINEMA_CLIP_PATH;
    canvas.style.visibility = "hidden";
    canvas.dataset.cinemaAtmosphereVisible = "false";
    return false;
  }

  const bounds = surface.getBoundingClientRect();
  const viewportWidth = Math.max(0, window.innerWidth);
  const viewportHeight = Math.max(0, window.innerHeight);
  const left = Math.min(viewportWidth, Math.max(0, bounds.left));
  const top = Math.min(viewportHeight, Math.max(0, bounds.top));
  const right = Math.min(viewportWidth, Math.max(left, bounds.right));
  const bottom = Math.min(viewportHeight, Math.max(top, bounds.bottom));
  if (right <= left || bottom <= top) {
    canvas.style.clipPath = HIDDEN_CINEMA_CLIP_PATH;
    canvas.style.visibility = "hidden";
    canvas.dataset.cinemaAtmosphereVisible = "false";
    return false;
  }

  canvas.style.clipPath = `inset(${String(top)}px ${String(viewportWidth - right)}px ${String(
    viewportHeight - bottom,
  )}px ${String(left)}px)`;
  canvas.style.visibility = "visible";
  canvas.dataset.cinemaAtmosphereVisible = "true";
  return true;
}

function syncConsoleOverlayClip(canvas: HTMLCanvasElement, surface: HTMLElement | null): boolean {
  if (surface === null || !surface.isConnected) {
    canvas.style.clipPath = HIDDEN_CONSOLE_CLIP_PATH;
    canvas.style.visibility = "hidden";
    canvas.dataset.atmosphereConsoleOverlayVisible = "false";
    delete canvas.dataset.atmosphereConsoleOverlayLeft;
    delete canvas.dataset.atmosphereConsoleOverlayTop;
    delete canvas.dataset.atmosphereConsoleOverlayRight;
    delete canvas.dataset.atmosphereConsoleOverlayBottom;
    return false;
  }

  const bounds = surface.getBoundingClientRect();
  const viewportWidth = Math.max(0, window.innerWidth);
  const viewportHeight = Math.max(0, window.innerHeight);
  const left = Math.min(viewportWidth, Math.max(0, bounds.left));
  const top = Math.min(viewportHeight, Math.max(0, bounds.top));
  const right = Math.min(viewportWidth, Math.max(left, bounds.right));
  const bottom = Math.min(viewportHeight, Math.max(top, bounds.bottom));
  if (right <= left || bottom <= top) {
    canvas.style.clipPath = HIDDEN_CONSOLE_CLIP_PATH;
    canvas.style.visibility = "hidden";
    canvas.dataset.atmosphereConsoleOverlayVisible = "false";
    return false;
  }

  canvas.style.clipPath = `inset(${String(top)}px ${String(viewportWidth - right)}px ${String(
    viewportHeight - bottom,
  )}px ${String(left)}px)`;
  canvas.style.visibility = "visible";
  canvas.dataset.atmosphereConsoleOverlayVisible = "true";
  canvas.dataset.atmosphereConsoleOverlayLeft = String(left);
  canvas.dataset.atmosphereConsoleOverlayTop = String(top);
  canvas.dataset.atmosphereConsoleOverlayRight = String(right);
  canvas.dataset.atmosphereConsoleOverlayBottom = String(bottom);
  return true;
}

function supportsWorkerOffscreenCanvas(canvas: HTMLCanvasElement): boolean {
  return (
    typeof OffscreenCanvas === "function" &&
    typeof Worker === "function" &&
    typeof canvas.transferControlToOffscreen === "function"
  );
}

function getAtmosphereCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  return canvas.getContext("2d", ATMOSPHERE_CONTEXT_OPTIONS) as CanvasRenderingContext2D | null;
}

export function resizeAtmosphereCanvasBitmap(
  canvas: HTMLCanvasElement,
  bitmapWidth: number,
  bitmapHeight: number,
): boolean {
  if (canvas.width === bitmapWidth && canvas.height === bitmapHeight) {
    return false;
  }
  canvas.width = bitmapWidth;
  canvas.height = bitmapHeight;
  return true;
}

/**
 * Publish a fully drawn detached frame in one compositor-visible operation.
 * `copy` replaces the previous transparent bitmap without exposing an
 * intermediate clearRect frame on the full-window canvas.
 */
export function commitAtmosphereCanvasBitmap(
  targetCanvas: HTMLCanvasElement,
  targetContext: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
): void {
  targetContext.save();
  targetContext.setTransform(1, 0, 0, 1, 0, 0);
  targetContext.globalAlpha = 1;
  targetContext.globalCompositeOperation = "copy";
  targetContext.drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
  targetContext.restore();
}

function publishAtmosphereRendererDiagnostics(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D | null,
  atomicFrameCommit: boolean,
): void {
  canvas.dataset.atmosphereRenderer = context === null ? "unavailable" : "canvas2d";
  canvas.dataset.atmosphereRendererAcceleration = "browser-managed";
  canvas.dataset.atmosphereOffscreenCanvas =
    context !== null && supportsWorkerOffscreenCanvas(canvas)
      ? "available-not-active"
      : "unavailable";
  canvas.dataset.atmosphereTextRasterization = "main-thread";
  canvas.dataset.atmosphereFrameCommit = atomicFrameCommit ? "atomic-copy" : "direct-fallback";
}

export function WindowAtmosphere({ selectedThreadRef = null }: WindowAtmosphereProps = {}) {
  const enabled = useSettings((settings) => settings.fallingEffectsEnabled);
  const cinemaOverlayEnabled = useSettings((settings) => settings.fallingEffectsOverCinemaEnabled);
  const kind = useSettings((settings) => settings.fallingEffectKind);
  const matrixBaseFontSize = useSettings((settings) => settings.fallingEffectMatrixBaseFontSize);
  const configuredColor = useSettings((settings) => settings.fallingEffectColor);
  const matrixColorMode = useSettings((settings) => settings.fallingEffectMatrixColorMode);
  const matrixColorCycleSpeed = useSettings(
    (settings) => settings.fallingEffectMatrixColorCycleSpeed,
  );
  const matrixColorCycleSpeedRef = useRef(matrixColorCycleSpeed);
  const motionMode = useSettings((settings) => settings.fallingEffectMatrixMotionMode);
  const walkStartFontSize = useSettings(
    (settings) => settings.fallingEffectMatrixWalkStartFontSize,
  );
  const walkEndFontSize = useSettings((settings) => settings.fallingEffectMatrixWalkEndFontSize);
  const matrixWalkLifecyclePercent = useSettings(
    (settings) => settings.fallingEffectMatrixWalkLifecyclePercent,
  );
  const matrixCenterWindIntensity = useSettings(
    (settings) => settings.fallingEffectMatrixCenterWindIntensity,
  );
  const opacity = useSettings((settings) => settings.fallingEffectOpacity);
  const speed = useSettings((settings) => settings.fallingEffectSpeed);
  const density = useSettings((settings) => settings.fallingEffectDensity);
  const japaneseRatio = useSettings((settings) => settings.fallingEffectJapaneseRatio);
  const enriched2ch = useSettings((settings) => settings.fallingEffect2chEnriched);
  const liveWorkVocabularyEnabled = useSettings(
    (settings) => settings.fallingEffectLiveWorkVocabulary,
  );
  const activityLinksEnabled = useSettings((settings) => settings.fallingEffectActivityLinks);
  const activityLinkNetworkEnabled = useSettings(
    (settings) => settings.fallingEffectActivityLinkNetworkEnabled,
  );
  const activityLinkDatabaseEnabled = useSettings(
    (settings) => settings.fallingEffectActivityLinkDatabaseEnabled,
  );
  const activityLinkBuildEnabled = useSettings(
    (settings) => settings.fallingEffectActivityLinkBuildEnabled,
  );
  const activityLinkAgentEnabled = useSettings(
    (settings) => settings.fallingEffectActivityLinkAgentEnabled,
  );
  const activityLinkColorMode = useSettings(
    (settings) => settings.fallingEffectActivityLinkColorMode,
  );
  const activityLinkRetentionSeconds = useSettings(
    (settings) => settings.fallingEffectActivityLinkRetentionSeconds,
  );
  const activityLinkRetentionMsRef = useRef(activityLinkRetentionSeconds * 1_000);
  const continueBackgroundAnimations = useSettings(
    (settings) => settings.continueBackgroundAnimations,
  );
  const { resolvedTheme } = useTheme();
  const serverConfig = useServerConfig();
  const atmosphereAvailable = serverConfig?.ambientExperienceCapabilities.atmosphere === true;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const matrixGpuCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cinemaOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const consoleOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const matrixGpuRendererRef = useRef<MatrixWebGl2Renderer | null>(null);
  const matrixGpuAvailableRef = useRef(false);
  const matrixGpuFrameCollector = useMemo(() => new MatrixGpuFrameCollector(), []);
  const sceneRef = useRef<AtmosphereScene | null>(null);
  const matrixPaletteOwnerRef = useRef<object>({});
  const lastMatrixColorFrameRef = useRef<MatrixColorFrame | null>(null);
  const lastMatrixPaletteDefinitionRef = useRef<string | null>(null);
  const invalidateCommittedFrameRef = useRef<(() => void) | null>(null);
  const invalidateStaticMatrixColorFrameRef = useRef<(() => void) | null>(null);
  const matrixWorkVocabularyKey = useStore((state) =>
    liveWorkVocabularyEnabled && kind === "matrix"
      ? selectMatrixWorkVocabularyKey(state, selectedThreadRef)
      : "",
  );
  const matrixWorkVocabulary = useMemo(
    () => decodeMatrixWorkVocabulary(matrixWorkVocabularyKey),
    [matrixWorkVocabularyKey],
  );
  const matrixWorkVocabularyRef = useRef(matrixWorkVocabulary);
  const matrixGpuGlyphPool = useMemo(
    () => [
      ...Array.from(MATRIX_ROMAN_GLYPHS),
      ...Array.from(MATRIX_JAPANESE_GLYPHS),
      ...(enriched2ch ? Array.from(MATRIX_2CH_ENRICHED_GLYPHS) : []),
      ...MATRIX_2CH_AA_TOKENS,
      ...matrixWorkVocabulary.english,
      ...matrixWorkVocabulary.japanese,
    ],
    [enriched2ch, matrixWorkVocabulary],
  );
  const matrixActivityEventsKey = useStore((state) =>
    activityLinksEnabled && kind === "matrix"
      ? selectMatrixActivityEventsKey(
          state,
          selectedThreadRef,
          {
            network: activityLinkNetworkEnabled,
            database: activityLinkDatabaseEnabled,
            build: activityLinkBuildEnabled,
            agent: activityLinkAgentEnabled,
          },
          {
            nowMs: Date.now(),
            requestedTtlMs: activityLinkRetentionSeconds * 1_000,
          },
        )
      : "",
  );
  const matrixActivityEvents = useMemo(
    () => decodeMatrixActivityEvents(matrixActivityEventsKey),
    [matrixActivityEventsKey],
  );
  const matrixActivityEventsRef = useRef(matrixActivityEvents);

  // Publish route-scoped signals only after React commits the route, then
  // update the existing scene before the browser can paint it. Mutating these
  // refs during render can expose an uncommitted destination thread to the
  // independent animation loop; a passive effect can leave the prior thread's
  // work terms visible for one frame.
  useLayoutEffect(() => {
    matrixWorkVocabularyRef.current = matrixWorkVocabulary;
    matrixActivityEventsRef.current = matrixActivityEvents;
  }, [matrixActivityEvents, matrixWorkVocabulary]);

  useLayoutEffect(() => {
    matrixColorCycleSpeedRef.current = matrixColorCycleSpeed;
    invalidateStaticMatrixColorFrameRef.current?.();
    invalidateCommittedFrameRef.current?.();
  }, [matrixColorCycleSpeed]);

  useLayoutEffect(() => {
    activityLinkRetentionMsRef.current = activityLinkRetentionSeconds * 1_000;
    invalidateCommittedFrameRef.current?.();
  }, [activityLinkRetentionSeconds]);

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    applyMatrixWorkVocabularyInPlace(
      scene,
      matrixWorkVocabulary,
      createSeededRandom(textSeed(matrixWorkVocabularyKey)),
    );
    invalidateCommittedFrameRef.current?.();
  }, [matrixWorkVocabulary, matrixWorkVocabularyKey]);

  useLayoutEffect(() => {
    invalidateCommittedFrameRef.current?.();
  }, [matrixActivityEvents]);

  useLayoutEffect(() => {
    const canvas = cinemaOverlayCanvasRef.current;
    if (!atmosphereAvailable || !enabled || !cinemaOverlayEnabled || canvas === null) {
      return;
    }

    let observedSurface: HTMLElement | null = null;
    let observedWorkspace: HTMLElement | null = null;
    const syncObservedClip = () => {
      const wasVisible = canvas.dataset.cinemaAtmosphereVisible === "true";
      const isVisible = syncCinemaOverlayClip(canvas, observedSurface);
      if (!wasVisible && isVisible) {
        // A reduced-motion or background-paused atmosphere has no running
        // animation frame to populate an overlay that appears later. Reuse
        // the existing invalidation boundary so the newly exposed canvas is
        // painted once without introducing a second animation loop.
        invalidateCommittedFrameRef.current?.();
      }
    };
    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(syncObservedClip) : null;
    const syncTarget = () => {
      const surface = findCinemaVideoSurface();
      const workspace = surface?.closest<HTMLElement>("[data-ambient-video-presentation]") ?? null;
      if (surface !== observedSurface || workspace !== observedWorkspace) {
        resizeObserver?.disconnect();
        observedSurface = surface;
        observedWorkspace = workspace;
        if (observedSurface !== null) {
          resizeObserver?.observe(observedSurface);
        }
        if (observedWorkspace !== null && observedWorkspace !== observedSurface) {
          resizeObserver?.observe(observedWorkspace);
        }
      }
      syncObservedClip();
    };

    const mutationObserver = new MutationObserver(syncTarget);
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-ambient-protected-player", "data-local-media-presentation"],
    });
    window.addEventListener("resize", syncTarget);
    window.addEventListener("scroll", syncTarget, true);
    syncTarget();

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncTarget);
      window.removeEventListener("scroll", syncTarget, true);
    };
  }, [atmosphereAvailable, cinemaOverlayEnabled, enabled]);

  useLayoutEffect(() => {
    const canvas = consoleOverlayCanvasRef.current;
    if (!atmosphereAvailable || !enabled || kind !== "matrix" || canvas === null) {
      return;
    }

    let observedSurface: HTMLElement | null = null;
    const syncTarget = () => {
      const surface = document.querySelector<HTMLElement>(ATMOSPHERE_CONSOLE_SELECTOR);
      if (surface !== observedSurface) {
        resizeObserver?.disconnect();
        observedSurface = surface;
        if (observedSurface !== null) {
          resizeObserver?.observe(observedSurface);
        }
      }
      const wasVisible = canvas.dataset.atmosphereConsoleOverlayVisible === "true";
      const isVisible = syncConsoleOverlayClip(canvas, observedSurface);
      if (!wasVisible && isVisible) {
        invalidateCommittedFrameRef.current?.();
      }
    };
    const resizeObserver =
      typeof ResizeObserver === "function" ? new ResizeObserver(syncTarget) : null;
    const mutationObserver = new MutationObserver(syncTarget);
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-atmosphere-console-surface", "style"],
    });
    window.addEventListener("resize", syncTarget);
    window.addEventListener("scroll", syncTarget, true);
    syncTarget();

    return () => {
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncTarget);
      window.removeEventListener("scroll", syncTarget, true);
    };
  }, [atmosphereAvailable, enabled, kind]);

  useLayoutEffect(() => {
    const gpuCanvas = matrixGpuCanvasRef.current;
    if (!atmosphereAvailable || !enabled || kind !== "matrix" || gpuCanvas === null) {
      matrixGpuRendererRef.current = null;
      matrixGpuAvailableRef.current = false;
      return;
    }

    const selection = createMatrixWebGl2Renderer(gpuCanvas, matrixGpuGlyphPool, {
      maxGlyphInstances: 8_192,
      onAvailabilityChange: (availability) => {
        const available = availability === "available";
        matrixGpuAvailableRef.current = available;
        gpuCanvas.style.visibility = available ? "visible" : "hidden";
        gpuCanvas.dataset.matrixGpuAvailability = availability;
        const diagnosticsCanvas = canvasRef.current;
        if (diagnosticsCanvas !== null) {
          diagnosticsCanvas.dataset.atmosphereRenderer = available
            ? "webgl2-glyph-atlas"
            : "canvas2d";
          diagnosticsCanvas.dataset.atmosphereRendererAcceleration = available
            ? "gpu"
            : "browser-managed";
          diagnosticsCanvas.dataset.atmosphereTextRasterization = available
            ? "gpu-glyph-atlas"
            : "main-thread";
        }
        invalidateCommittedFrameRef.current?.();
      },
    });
    if (selection.kind !== "webgl2") {
      gpuCanvas.style.visibility = "hidden";
      gpuCanvas.dataset.matrixGpuAvailability = "unavailable";
      gpuCanvas.dataset.matrixGpuFallbackReason = selection.reason;
      matrixGpuRendererRef.current = null;
      matrixGpuAvailableRef.current = false;
      return;
    }

    delete gpuCanvas.dataset.matrixGpuFallbackReason;
    gpuCanvas.dataset.matrixGpuAvailability = "available";
    gpuCanvas.style.visibility = "visible";
    matrixGpuRendererRef.current = selection.renderer;
    matrixGpuAvailableRef.current = true;
    invalidateCommittedFrameRef.current?.();
    return () => {
      selection.renderer.dispose();
      if (matrixGpuRendererRef.current === selection.renderer) {
        matrixGpuRendererRef.current = null;
        matrixGpuAvailableRef.current = false;
      }
      gpuCanvas.style.visibility = "hidden";
    };
  }, [atmosphereAvailable, enabled, kind, matrixGpuGlyphPool]);

  useEffect(() => {
    const matrixPaletteOwner = matrixPaletteOwnerRef.current;
    const matrixColorState = createMatrixColorAnimationState();
    matrixColorFrameStore.claim(matrixPaletteOwner);
    let definedColorCycleSpeed = matrixColorCycleSpeedRef.current;
    let definedMatrixPalette = JSON.stringify([
      matrixColorMode,
      configuredColor,
      resolvedTheme === "dark",
      definedColorCycleSpeed,
    ]);
    const matrixPaletteDefinition = () => {
      const currentColorCycleSpeed = matrixColorCycleSpeedRef.current;
      if (!Object.is(definedColorCycleSpeed, currentColorCycleSpeed)) {
        definedColorCycleSpeed = currentColorCycleSpeed;
        definedMatrixPalette = JSON.stringify([
          matrixColorMode,
          configuredColor,
          resolvedTheme === "dark",
          currentColorCycleSpeed,
        ]);
      }
      return definedMatrixPalette;
    };
    const resolveSharedMatrixPalette = (
      timestamp: number,
      signal: typeof EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL,
    ) =>
      resolveMatrixAtmosphereColorFrame(
        matrixColorMode,
        configuredColor,
        resolvedTheme === "dark",
        timestamp,
        signal,
        matrixColorState,
        matrixColorCycleSpeedRef.current,
      );
    const publishMatrixPalette = (frame: MatrixColorFrame, motion: "animated" | "frozen") => {
      lastMatrixColorFrameRef.current = frame;
      lastMatrixPaletteDefinitionRef.current = matrixPaletteDefinition();
      matrixColorFrameStore.publish(matrixPaletteOwner, frame, motion);
    };
    const publishFrozenMatrixPalette = () => {
      const definition = matrixPaletteDefinition();
      const lastFrame =
        lastMatrixPaletteDefinitionRef.current === definition
          ? lastMatrixColorFrameRef.current
          : null;
      publishMatrixPalette(
        lastFrame ?? resolveSharedMatrixPalette(performance.now(), EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL),
        "frozen",
      );
    };
    const installFrozenMatrixPalette = () => {
      invalidateStaticMatrixColorFrameRef.current = publishFrozenMatrixPalette;
      publishFrozenMatrixPalette();
      return () => {
        if (invalidateStaticMatrixColorFrameRef.current === publishFrozenMatrixPalette) {
          invalidateStaticMatrixColorFrameRef.current = null;
        }
        matrixColorFrameStore.release(matrixPaletteOwner);
      };
    };
    const canvas = canvasRef.current;
    if (!atmosphereAvailable || !enabled || !canvas) {
      return installFrozenMatrixPalette();
    }

    const context = getAtmosphereCanvasContext(canvas);
    const matrixGpuCanvas = matrixGpuCanvasRef.current;
    const frameCanvas = document.createElement("canvas");
    const frameContext = getAtmosphereCanvasContext(frameCanvas);
    publishAtmosphereRendererDiagnostics(canvas, context, frameContext !== null);
    if (!context) {
      return installFrozenMatrixPalette();
    }
    const cinemaOverlayCanvas = cinemaOverlayCanvasRef.current;
    const cinemaOverlayContext =
      cinemaOverlayCanvas === null ? null : getAtmosphereCanvasContext(cinemaOverlayCanvas);
    const consoleOverlayCanvas = consoleOverlayCanvasRef.current;
    const consoleOverlayContext =
      consoleOverlayCanvas === null ? null : getAtmosphereCanvasContext(consoleOverlayCanvas);

    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    let scene: AtmosphereScene | null = null;
    const matrixActivityState = createMatrixActivityAnimationState();
    let animationFrame: number | null = null;
    let resizeFrame: number | null = null;
    let staticActivityExpiryTimer: number | null = null;
    let lastFrameTime: number | null = null;
    let staticReducedMotionMatrixColorFrame: MatrixColorFrame | null = null;
    let staticColorTimestamp: number | null = null;
    let hasCommittedFrame = false;

    const clearBitmap = (
      targetCanvas: HTMLCanvasElement,
      targetContext: CanvasRenderingContext2D,
    ) => {
      targetContext.save();
      targetContext.setTransform(1, 0, 0, 1, 0, 0);
      targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
      targetContext.restore();
    };

    const clearCanvasBitmap = () => {
      clearBitmap(canvas, context);
      if (matrixGpuCanvas !== null) {
        matrixGpuCanvas.style.visibility = "hidden";
      }
      if (cinemaOverlayCanvas !== null && cinemaOverlayContext !== null) {
        clearBitmap(cinemaOverlayCanvas, cinemaOverlayContext);
      }
      if (consoleOverlayCanvas !== null && consoleOverlayContext !== null) {
        clearBitmap(consoleOverlayCanvas, consoleOverlayContext);
      }
    };

    const cancelAnimation = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      lastFrameTime = null;
    };

    const cancelStaticActivityExpiry = () => {
      if (staticActivityExpiryTimer !== null) {
        window.clearTimeout(staticActivityExpiryTimer);
        staticActivityExpiryTimer = null;
      }
    };

    const invalidateStaticMatrixColorFrame = () => {
      staticReducedMotionMatrixColorFrame = null;
    };

    const scheduleStaticActivityExpiry = (nowMs: number) => {
      cancelStaticActivityExpiry();
      if (
        !scene ||
        !reducedMotion.matches ||
        kind !== "matrix" ||
        !activityLinksEnabled ||
        matrixActivityState.pulseCount === 0
      ) {
        return;
      }

      let nearestExpiryAtMs = Number.POSITIVE_INFINITY;
      for (const event of matrixActivityEventsRef.current) {
        const pulseExpiryAtMs = event.observedAtMs + MATRIX_ACTIVITY_TTL_MS;
        if (Number.isFinite(pulseExpiryAtMs) && pulseExpiryAtMs > nowMs) {
          nearestExpiryAtMs = Math.min(nearestExpiryAtMs, pulseExpiryAtMs);
        }
        if (matrixActivityState.linkCount > 0) {
          const routeExpiryAtMs = event.observedAtMs + activityLinkRetentionMsRef.current;
          if (Number.isFinite(routeExpiryAtMs) && routeExpiryAtMs > nowMs) {
            nearestExpiryAtMs = Math.min(nearestExpiryAtMs, routeExpiryAtMs);
          }
        }
      }
      if (!Number.isFinite(nearestExpiryAtMs)) {
        return;
      }

      // The extra millisecond keeps the redraw on the expired side of the
      // overlay's `age >= TTL` boundary even when the delay is integral.
      const delayMs = Math.max(1, Math.ceil(nearestExpiryAtMs - nowMs) + 1);
      staticActivityExpiryTimer = window.setTimeout(() => {
        staticActivityExpiryTimer = null;
        if (scene && reducedMotion.matches && kind === "matrix" && activityLinksEnabled) {
          staticColorTimestamp ??= performance.now();
          renderScene(staticColorTimestamp, true);
        }
      }, delayMs);
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(1, bounds.width || window.innerWidth);
      const height = Math.max(1, bounds.height || window.innerHeight);
      const requestedDpr = fitAtmosphereDpr(window.devicePixelRatio, width, height);
      // Floor the bitmap dimensions so rounding cannot sneak past the pixel budget.
      const bitmapWidth = Math.max(1, Math.floor(width * requestedDpr));
      const bitmapHeight = Math.max(1, Math.floor(height * requestedDpr));
      const dpr = Math.min(bitmapWidth / width, bitmapHeight / height);
      resizeAtmosphereCanvasBitmap(canvas, bitmapWidth, bitmapHeight);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (frameContext !== null) {
        resizeAtmosphereCanvasBitmap(frameCanvas, bitmapWidth, bitmapHeight);
        frameContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (cinemaOverlayCanvas !== null && cinemaOverlayContext !== null) {
        resizeAtmosphereCanvasBitmap(cinemaOverlayCanvas, bitmapWidth, bitmapHeight);
        cinemaOverlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (consoleOverlayCanvas !== null && consoleOverlayContext !== null) {
        resizeAtmosphereCanvasBitmap(consoleOverlayCanvas, bitmapWidth, bitmapHeight);
        consoleOverlayContext.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      scene = createAtmosphereScene(
        kind,
        width,
        height,
        createSeededRandom(sceneSeed(kind, width, height)),
        density,
        japaneseRatio,
        enriched2ch,
        matrixWorkVocabularyRef.current,
        motionMode,
        matrixWalkLifecyclePercent,
        matrixCenterWindIntensity,
      );
      sceneRef.current = scene;
      hasCommittedFrame = false;
    };

    const renderScene = (timestamp: number, reducedMotionActive: boolean) => {
      if (!scene) {
        return;
      }
      const elapsedSeconds =
        reducedMotionActive || lastFrameTime === null ? 0 : (timestamp - lastFrameTime) / 1_000;
      if (!reducedMotionActive) {
        lastFrameTime = timestamp;
      }
      advanceAtmosphereSceneInPlace(
        scene,
        elapsedSeconds,
        speed,
        motionMode,
        matrixWalkLifecyclePercent,
        matrixCenterWindIntensity,
      );
      if (!reducedMotionActive) {
        staticReducedMotionMatrixColorFrame = null;
      }
      const renderOpacity = resolveAtmosphereRenderOpacity(opacity, reducedMotionActive);
      const sharedMatrixColorFrame =
        reducedMotionActive && staticReducedMotionMatrixColorFrame !== null
          ? staticReducedMotionMatrixColorFrame
          : resolveSharedMatrixPalette(
              timestamp,
              reducedMotionActive
                ? EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL
                : localMediaAudioSignalStore.getSnapshot(),
            );
      if (reducedMotionActive) {
        staticReducedMotionMatrixColorFrame = sharedMatrixColorFrame;
      }
      publishMatrixPalette(sharedMatrixColorFrame, reducedMotionActive ? "frozen" : "animated");
      const matrixColorFrame = kind === "matrix" ? sharedMatrixColorFrame : undefined;
      const color =
        matrixColorFrame?.color ??
        resolveAtmosphereColor(kind, configuredColor, resolvedTheme === "dark");
      const sceneContext = frameContext ?? context;
      const matrixGpuRenderer = matrixGpuRendererRef.current;
      let matrixGpuRendered = false;
      if (
        kind === "matrix" &&
        matrixGpuCanvas !== null &&
        matrixGpuRenderer !== null &&
        matrixGpuAvailableRef.current
      ) {
        const gpuFrame = matrixGpuFrameCollector.collect({
          scene,
          color,
          opacity: renderOpacity,
          matrixColorFrame,
          motionMode,
          walkStartFontSize,
          walkEndFontSize,
          matrixBaseFontSize,
          devicePixelRatio: window.devicePixelRatio,
        });
        const result = matrixGpuRenderer.render(gpuFrame);
        matrixGpuRendered = result.status === "rendered" || result.status === "empty";
        matrixGpuCanvas.style.visibility = matrixGpuRendered ? "visible" : "hidden";
      }
      if (matrixGpuRendered) {
        sceneContext.clearRect(0, 0, scene.width, scene.height);
        if (frameContext !== null) {
          commitAtmosphereCanvasBitmap(canvas, context, frameCanvas);
        }
        canvas.dataset.atmosphereRenderer = "webgl2-glyph-atlas";
        canvas.dataset.atmosphereRendererAcceleration = "gpu";
        canvas.dataset.atmosphereTextRasterization = "gpu-glyph-atlas";
      } else {
        drawAtmosphereScene(
          sceneContext,
          scene,
          color,
          renderOpacity,
          matrixColorFrame,
          motionMode,
          walkStartFontSize,
          walkEndFontSize,
          matrixBaseFontSize,
        );
        if (frameContext !== null) {
          commitAtmosphereCanvasBitmap(canvas, context, frameCanvas);
        }
        if (kind === "matrix") {
          canvas.dataset.atmosphereRenderer = "canvas2d";
          canvas.dataset.atmosphereRendererAcceleration = "browser-managed";
          canvas.dataset.atmosphereTextRasterization = "main-thread";
        }
      }
      hasCommittedFrame = true;
      const committedSceneCanvas =
        matrixGpuRendered && matrixGpuCanvas !== null ? matrixGpuCanvas : canvas;
      if (
        consoleOverlayCanvas?.dataset.atmosphereConsoleOverlayVisible === "true" &&
        consoleOverlayContext !== null
      ) {
        const left = Number(consoleOverlayCanvas.dataset.atmosphereConsoleOverlayLeft);
        const top = Number(consoleOverlayCanvas.dataset.atmosphereConsoleOverlayTop);
        const right = Number(consoleOverlayCanvas.dataset.atmosphereConsoleOverlayRight);
        const bottom = Number(consoleOverlayCanvas.dataset.atmosphereConsoleOverlayBottom);
        if ([left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top) {
          // WebGL and Canvas2D independently fit their backing DPR to a pixel
          // budget. Crop in the source surface's own pixel coordinates so a
          // capped GPU backing store does not shift or truncate the console
          // overlay on high-DPR/large displays.
          const scaleX = committedSceneCanvas.width / scene.width;
          const scaleY = committedSceneCanvas.height / scene.height;
          const sourceLeft = left * scaleX;
          const sourceTop = top * scaleY;
          const sourceWidth = (right - left) * scaleX;
          const sourceHeight = (bottom - top) * scaleY;
          consoleOverlayContext.save();
          consoleOverlayContext.setTransform(1, 0, 0, 1, 0, 0);
          consoleOverlayContext.clearRect(sourceLeft, sourceTop, sourceWidth, sourceHeight);
          // Copy only the console rectangle from the base bitmap before
          // provider activity lines are painted. This keeps the lift
          // glyph-only without iterating the Matrix scene a second time.
          consoleOverlayContext.drawImage(
            committedSceneCanvas,
            sourceLeft,
            sourceTop,
            sourceWidth,
            sourceHeight,
            sourceLeft,
            sourceTop,
            sourceWidth,
            sourceHeight,
          );
          consoleOverlayContext.restore();
        }
      }
      if (
        cinemaOverlayCanvas?.dataset.cinemaAtmosphereVisible === "true" &&
        cinemaOverlayContext !== null
      ) {
        // The elevated canvas receives only the falling scene. Provider
        // activity packets/connectors remain on the ordinary window canvas,
        // behind cinema media, so the opt-in does not imply provider activity
        // over the video.
        if (frameContext !== null) {
          commitAtmosphereCanvasBitmap(
            cinemaOverlayCanvas,
            cinemaOverlayContext,
            matrixGpuRendered && matrixGpuCanvas !== null ? matrixGpuCanvas : frameCanvas,
          );
        } else {
          drawAtmosphereScene(
            cinemaOverlayContext,
            scene,
            color,
            renderOpacity,
            matrixColorFrame,
            motionMode,
            walkStartFontSize,
            walkEndFontSize,
            matrixBaseFontSize,
          );
        }
      }
      if (matrixColorFrame && activityLinksEnabled) {
        const activityNow = Date.now();
        updateMatrixActivityAnimationInPlace(
          matrixActivityState,
          matrixActivityEventsRef.current,
          activityNow,
          scene.particles.length,
          reducedMotionActive,
          activityLinkRetentionMsRef.current,
        );
        drawMatrixActivityAnimation(
          context,
          scene,
          matrixActivityState,
          renderOpacity,
          activityLinkColorMode,
          matrixColorFrame,
          motionMode,
          walkStartFontSize,
          walkEndFontSize,
        );
        if (reducedMotionActive) {
          scheduleStaticActivityExpiry(activityNow);
        }
      }
    };

    const drawFrame = (timestamp: number) => {
      animationFrame = null;
      renderScene(timestamp, false);
      animationFrame = window.requestAnimationFrame(drawFrame);
    };

    const readAnimationState = () => ({
      enabled,
      reducedMotion: reducedMotion.matches,
      documentVisible: document.visibilityState === "visible",
      windowFocused: document.hasFocus(),
      continueBackgroundAnimations,
    });

    const syncAnimation = () => {
      const animationState = readAnimationState();

      if (!shouldShowAtmosphere(animationState)) {
        cancelAnimation();
        cancelStaticActivityExpiry();
        staticColorTimestamp = null;
        publishFrozenMatrixPalette();
        clearCanvasBitmap();
        hasCommittedFrame = false;
        return;
      }

      if (!shouldAnimateAtmosphere(animationState)) {
        cancelAnimation();
        if (
          staticReducedMotionMatrixColorFrame === null &&
          lastMatrixPaletteDefinitionRef.current === matrixPaletteDefinition()
        ) {
          staticReducedMotionMatrixColorFrame = lastMatrixColorFrameRef.current;
        }
        staticColorTimestamp ??= performance.now();
        renderScene(staticColorTimestamp, true);
        return;
      }

      cancelStaticActivityExpiry();
      staticColorTimestamp = null;
      if (!hasCommittedFrame) {
        renderScene(performance.now(), false);
      }
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(drawFrame);
      }
    };

    const invalidateCommittedFrame = () => {
      if (scene && reducedMotion.matches) {
        staticColorTimestamp ??= performance.now();
        renderScene(staticColorTimestamp, true);
      } else if (scene) {
        // Replace a prior route/activity frame synchronously. Clearing here
        // exposed the full transparent window canvas until the next RAF,
        // which appeared as periodic black/white flashes under active work.
        const animationState = readAnimationState();
        if (shouldShowAtmosphere(animationState)) {
          renderScene(performance.now(), !shouldAnimateAtmosphere(animationState));
        } else {
          clearCanvasBitmap();
          hasCommittedFrame = false;
          publishFrozenMatrixPalette();
        }
      }
    };
    invalidateCommittedFrameRef.current = invalidateCommittedFrame;
    invalidateStaticMatrixColorFrameRef.current = invalidateStaticMatrixColorFrame;

    const handleResize = () => {
      if (resizeFrame !== null) {
        return;
      }
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        resize();
        syncAnimation();
      });
    };

    resize();
    syncAnimation();
    document.addEventListener("visibilitychange", syncAnimation);
    window.addEventListener("focus", syncAnimation);
    window.addEventListener("blur", syncAnimation);
    window.addEventListener("resize", handleResize);
    reducedMotion.addEventListener("change", syncAnimation);

    return () => {
      cancelAnimation();
      cancelStaticActivityExpiry();
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      if (invalidateCommittedFrameRef.current === invalidateCommittedFrame) {
        invalidateCommittedFrameRef.current = null;
      }
      if (invalidateStaticMatrixColorFrameRef.current === invalidateStaticMatrixColorFrame) {
        invalidateStaticMatrixColorFrameRef.current = null;
      }
      sceneRef.current = null;
      matrixColorFrameStore.release(matrixPaletteOwner);
      document.removeEventListener("visibilitychange", syncAnimation);
      window.removeEventListener("focus", syncAnimation);
      window.removeEventListener("blur", syncAnimation);
      window.removeEventListener("resize", handleResize);
      reducedMotion.removeEventListener("change", syncAnimation);
    };
  }, [
    atmosphereAvailable,
    activityLinkColorMode,
    activityLinksEnabled,
    configuredColor,
    continueBackgroundAnimations,
    cinemaOverlayEnabled,
    density,
    enabled,
    enriched2ch,
    japaneseRatio,
    kind,
    matrixColorMode,
    matrixBaseFontSize,
    matrixCenterWindIntensity,
    matrixWalkLifecyclePercent,
    motionMode,
    opacity,
    resolvedTheme,
    speed,
    walkEndFontSize,
    walkStartFontSize,
    matrixGpuFrameCollector,
  ]);

  if (!enabled || !atmosphereAvailable) {
    return null;
  }

  return (
    <>
      {kind === "matrix" ? (
        <canvas
          ref={matrixGpuCanvasRef}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-40 h-full w-full overflow-hidden [contain:strict]"
          data-matrix-gpu-availability="pending"
          data-testid="window-atmosphere-gpu"
          style={{ visibility: "hidden" }}
        />
      ) : null}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-40 h-full w-full overflow-hidden [contain:strict]"
        data-atmosphere-offscreen-canvas="pending"
        data-atmosphere-frame-commit="pending"
        data-atmosphere-renderer="pending"
        data-atmosphere-renderer-acceleration="browser-managed"
        data-atmosphere-text-rasterization="main-thread"
        data-testid="window-atmosphere"
      />
      {cinemaOverlayEnabled ? (
        <canvas
          ref={cinemaOverlayCanvasRef}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-50 h-full w-full overflow-hidden [contain:strict]"
          data-cinema-atmosphere-visible="false"
          data-testid="cinema-falling-atmosphere"
          style={{
            clipPath: HIDDEN_CINEMA_CLIP_PATH,
            visibility: "hidden",
          }}
        />
      ) : null}
      {kind === "matrix" ? (
        <canvas
          ref={consoleOverlayCanvasRef}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-[86] h-full w-full overflow-hidden opacity-40 [contain:strict]"
          data-atmosphere-console-overlay-visible="false"
          data-testid="atmosphere-console-matrix-overlay"
          style={{
            clipPath: HIDDEN_CONSOLE_CLIP_PATH,
            visibility: "hidden",
          }}
        />
      ) : null}
    </>
  );
}
