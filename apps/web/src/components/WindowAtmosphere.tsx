import { useEffect, useMemo, useRef } from "react";

import { useSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { localMediaAudioSignalStore } from "../localMediaAudioSignal";
import { useServerConfig } from "../rpc/serverState";
import { localMediaAudioSignalStore } from "../localMediaAudioSignal";
import {
  advanceAtmosphereSceneInPlace,
  createMatrixColorAnimationState,
  createAtmosphereScene,
  createSeededRandom,
  drawAtmosphereScene,
  fitAtmosphereDpr,
  resolveAtmosphereColor,
  resolveMatrixAtmosphereColor,
  shouldAnimateAtmosphere,
  type AtmosphereScene,
} from "../windowAtmosphere";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

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

export function WindowAtmosphere() {
  const enabled = useSettings((settings) => settings.fallingEffectsEnabled);
  const kind = useSettings((settings) => settings.fallingEffectKind);
  const configuredColor = useSettings((settings) => settings.fallingEffectColor);
  const matrixColorMode = useSettings((settings) => settings.fallingEffectMatrixColorMode);
  const opacity = useSettings((settings) => settings.fallingEffectOpacity);
  const speed = useSettings((settings) => settings.fallingEffectSpeed);
  const density = useSettings((settings) => settings.fallingEffectDensity);
  const japaneseRatio = useSettings((settings) => settings.fallingEffectJapaneseRatio);
  const matrixEnriched = useSettings((settings) => settings.fallingEffectMatrixEnriched);
  const continueBackgroundAnimations = useSettings(
    (settings) => settings.continueBackgroundAnimations,
  );
  const { resolvedTheme } = useTheme();
  const serverConfig = useServerConfig();
  const atmosphereAvailable = serverConfig?.ambientExperienceCapabilities.atmosphere === true;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<AtmosphereScene | null>(null);
  const invalidateStaticFrameRef = useRef<(() => void) | null>(null);
  const matrixWorkVocabularyKey = useStore((state) =>
    liveWorkVocabularyEnabled && kind === "matrix" ? selectMatrixWorkVocabularyKey(state) : "",
  );
  const matrixWorkVocabulary = useMemo(
    () => decodeMatrixWorkVocabulary(matrixWorkVocabularyKey),
    [matrixWorkVocabularyKey],
  );
  const matrixWorkVocabularyRef = useRef(matrixWorkVocabulary);
  matrixWorkVocabularyRef.current = matrixWorkVocabulary;
  const matrixActivityEventsKey = useStore((state) =>
    activityLinksEnabled && kind === "matrix" ? selectMatrixActivityEventsKey(state) : "",
  );
  const matrixActivityEvents = useMemo(
    () => decodeMatrixActivityEvents(matrixActivityEventsKey),
    [matrixActivityEventsKey],
  );
  const matrixActivityEventsRef = useRef(matrixActivityEvents);
  matrixActivityEventsRef.current = matrixActivityEvents;

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    applyMatrixWorkVocabularyInPlace(
      scene,
      matrixWorkVocabulary,
      createSeededRandom(textSeed(matrixWorkVocabularyKey)),
    );
    invalidateStaticFrameRef.current?.();
  }, [matrixWorkVocabulary, matrixWorkVocabularyKey]);

  useEffect(() => {
    invalidateStaticFrameRef.current?.();
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
    let animationFrame: number | null = null;
    let resizeFrame: number | null = null;
    let staticActivityExpiryTimer: number | null = null;
    let lastFrameTime: number | null = null;

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
        const expiryAtMs = event.observedAtMs + MATRIX_ACTIVITY_TTL_MS;
        if (Number.isFinite(expiryAtMs) && expiryAtMs > nowMs) {
          nearestExpiryAtMs = Math.min(nearestExpiryAtMs, expiryAtMs);
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
          renderScene(performance.now(), true);
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
        matrixEnriched,
      );
      sceneRef.current = scene;
    };

    const renderScene = (timestamp: number, reducedMotionActive: boolean) => {
      if (!scene) {
        return;
      }
      const elapsedSeconds =
        reducedMotionActive || lastFrameTime === null ? 0 : (timestamp - lastFrameTime) / 1_000;
      lastFrameTime = timestamp;
      advanceAtmosphereSceneInPlace(scene, elapsedSeconds, speed);
      const matrixColorFrame =
        kind === "matrix"
          ? resolveMatrixAtmosphereColorFrame(
              matrixColorMode,
              configuredColor,
              resolvedTheme === "dark",
              timestamp,
              localMediaAudioSignalStore.getSnapshot(),
              matrixColorState,
            )
          : undefined;
      const color =
        matrixColorFrame?.color ??
        resolveAtmosphereColor(kind, configuredColor, resolvedTheme === "dark");
      drawAtmosphereScene(context, scene, color, opacity, matrixColorFrame);
      if (matrixColorFrame && activityLinksEnabled) {
        const activityNow = Date.now();
        updateMatrixActivityAnimationInPlace(
          matrixActivityState,
          matrixActivityEventsRef.current,
          activityNow,
          scene.particles.length,
          reducedMotionActive,
        );
        drawMatrixActivityAnimation(
          context,
          scene,
          matrixActivityState,
          opacity,
          activityLinkColorMode,
          matrixColorFrame,
        );
        if (reducedMotionActive) {
          scheduleStaticActivityExpiry(activityNow);
        }
      }
    };

    const drawFrame = (timestamp: number) => {
      animationFrame = null;
      if (!scene) {
        return;
      }
      const elapsedSeconds = lastFrameTime === null ? 0 : (timestamp - lastFrameTime) / 1_000;
      lastFrameTime = timestamp;
      advanceAtmosphereSceneInPlace(scene, elapsedSeconds, speed);
      const color =
        kind === "matrix"
          ? resolveMatrixAtmosphereColor(
              matrixColorMode,
              configuredColor,
              resolvedTheme === "dark",
              timestamp,
              localMediaAudioSignalStore.getSnapshot(),
              matrixColorState,
            )
          : resolveAtmosphereColor(kind, configuredColor, resolvedTheme === "dark");
      drawAtmosphereScene(context, scene, color, opacity);
      animationFrame = window.requestAnimationFrame(drawFrame);
    };

    const syncAnimation = () => {
      const canAnimate = shouldAnimateAtmosphere({
        enabled,
        reducedMotion: reducedMotion.matches,
        documentVisible: document.visibilityState === "visible",
        windowFocused: document.hasFocus(),
        continueBackgroundAnimations,
      });

      if (!canAnimate) {
        cancelAnimation();
        if (scene && reducedMotion.matches && kind === "matrix" && activityLinksEnabled) {
          renderScene(performance.now(), true);
        } else if (scene) {
          cancelStaticActivityExpiry();
          context.clearRect(0, 0, scene.width, scene.height);
        }
        return;
      }

      cancelStaticActivityExpiry();
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(drawFrame);
      }
    };

    const invalidateStaticFrame = () => {
      if (scene && reducedMotion.matches && kind === "matrix" && activityLinksEnabled) {
        renderScene(performance.now(), true);
      }
    };
    invalidateStaticFrameRef.current = invalidateStaticFrame;

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
      if (invalidateStaticFrameRef.current === invalidateStaticFrame) {
        invalidateStaticFrameRef.current = null;
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
    japaneseRatio,
    matrixEnriched,
    enabled,
    enriched2ch,
    japaneseRatio,
    kind,
    matrixColorMode,
    opacity,
    resolvedTheme,
    speed,
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
