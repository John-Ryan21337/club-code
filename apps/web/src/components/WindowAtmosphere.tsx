import type { ScopedThreadRef } from "@cafecode/contracts";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { useSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import {
  EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL,
  localMediaAudioSignalStore,
} from "../localMediaAudioSignal";
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
  resolveAtmosphereColor,
  resolveAtmosphereRenderOpacity,
  resolveMatrixAtmosphereColorFrame,
  shouldAnimateAtmosphere,
  shouldShowAtmosphere,
  type AtmosphereScene,
  type MatrixColorFrame,
} from "../windowAtmosphere";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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

export function WindowAtmosphere({ selectedThreadRef = null }: WindowAtmosphereProps = {}) {
  const enabled = useSettings((settings) => settings.fallingEffectsEnabled);
  const kind = useSettings((settings) => settings.fallingEffectKind);
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
  const sceneRef = useRef<AtmosphereScene | null>(null);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!atmosphereAvailable || !enabled || !canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    let scene: AtmosphereScene | null = null;
    const matrixColorState = createMatrixColorAnimationState();
    const matrixActivityState = createMatrixActivityAnimationState();
    let animationFrame: number | null = null;
    let resizeFrame: number | null = null;
    let staticActivityExpiryTimer: number | null = null;
    let lastFrameTime: number | null = null;
    let staticReducedMotionMatrixColorFrame: MatrixColorFrame | null = null;
    let staticColorTimestamp: number | null = null;

    const clearCanvasBitmap = () => {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.restore();
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
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      scene = createAtmosphereScene(
        kind,
        width,
        height,
        createSeededRandom(sceneSeed(kind, width, height)),
        density,
        japaneseRatio,
        enriched2ch,
        matrixWorkVocabularyRef.current,
      );
      sceneRef.current = scene;
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
      advanceAtmosphereSceneInPlace(scene, elapsedSeconds, speed);
      if (!reducedMotionActive) {
        staticReducedMotionMatrixColorFrame = null;
      }
      const renderOpacity = resolveAtmosphereRenderOpacity(opacity, reducedMotionActive);
      const matrixColorFrame =
        kind === "matrix"
          ? reducedMotionActive && staticReducedMotionMatrixColorFrame !== null
            ? staticReducedMotionMatrixColorFrame
            : resolveMatrixAtmosphereColorFrame(
                matrixColorMode,
                configuredColor,
                resolvedTheme === "dark",
                timestamp,
                reducedMotionActive
                  ? EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL
                  : localMediaAudioSignalStore.getSnapshot(),
                matrixColorState,
                matrixColorCycleSpeedRef.current,
              )
          : undefined;
      if (reducedMotionActive && matrixColorFrame !== undefined) {
        staticReducedMotionMatrixColorFrame = matrixColorFrame;
      }
      const color =
        matrixColorFrame?.color ??
        resolveAtmosphereColor(kind, configuredColor, resolvedTheme === "dark");
      drawAtmosphereScene(
        context,
        scene,
        color,
        renderOpacity,
        matrixColorFrame,
        motionMode,
        walkStartFontSize,
        walkEndFontSize,
      );
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

    const syncAnimation = () => {
      const animationState = {
        enabled,
        reducedMotion: reducedMotion.matches,
        documentVisible: document.visibilityState === "visible",
        windowFocused: document.hasFocus(),
        continueBackgroundAnimations,
      };

      if (!shouldShowAtmosphere(animationState)) {
        cancelAnimation();
        cancelStaticActivityExpiry();
        staticColorTimestamp = null;
        clearCanvasBitmap();
        return;
      }

      if (!shouldAnimateAtmosphere(animationState)) {
        cancelAnimation();
        staticColorTimestamp ??= performance.now();
        renderScene(staticColorTimestamp, true);
        return;
      }

      cancelStaticActivityExpiry();
      staticColorTimestamp = null;
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(drawFrame);
      }
    };

    const invalidateCommittedFrame = () => {
      if (scene && reducedMotion.matches) {
        staticColorTimestamp ??= performance.now();
        renderScene(staticColorTimestamp, true);
      } else if (scene) {
        // The bitmap may still contain a prior route's filenames or activity
        // labels. Clear it synchronously at commit; the next permitted
        // animation frame paints only the newly published thread.
        clearCanvasBitmap();
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
      clearCanvasBitmap();
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
    density,
    enabled,
    enriched2ch,
    japaneseRatio,
    kind,
    matrixColorMode,
    motionMode,
    opacity,
    resolvedTheme,
    speed,
    walkEndFontSize,
    walkStartFontSize,
  ]);

  if (!enabled || !atmosphereAvailable) {
    return null;
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40 h-full w-full overflow-hidden"
      data-testid="window-atmosphere"
    />
  );
}
