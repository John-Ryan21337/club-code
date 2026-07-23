import { useEffect, useRef } from "react";

import { useSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { useServerConfig } from "../rpc/serverState";
import {
  advanceAtmosphereSceneInPlace,
  createAtmosphereScene,
  createSeededRandom,
  drawAtmosphereScene,
  fitAtmosphereDpr,
  resolveAtmosphereColor,
  shouldAnimateAtmosphere,
  type AtmosphereScene,
} from "../windowAtmosphere";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function sceneSeed(kind: "snow" | "rain" | "matrix", width: number, height: number): number {
  const kindSeed = kind === "snow" ? 0x534e4f57 : kind === "rain" ? 0x5241494e : 0x4d415458;
  return (kindSeed ^ Math.round(width * 31) ^ Math.round(height * 131)) >>> 0;
}

export function WindowAtmosphere() {
  const enabled = useSettings((settings) => settings.fallingEffectsEnabled);
  const kind = useSettings((settings) => settings.fallingEffectKind);
  const configuredColor = useSettings((settings) => settings.fallingEffectColor);
  const opacity = useSettings((settings) => settings.fallingEffectOpacity);
  const speed = useSettings((settings) => settings.fallingEffectSpeed);
  const continueBackgroundAnimations = useSettings(
    (settings) => settings.continueBackgroundAnimations,
  );
  const { resolvedTheme } = useTheme();
  const serverConfig = useServerConfig();
  const atmosphereAvailable = serverConfig?.ambientExperienceCapabilities.atmosphere === true;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
    let animationFrame: number | null = null;
    let lastFrameTime: number | null = null;

    const cancelAnimation = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      lastFrameTime = null;
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
      );
    };

    const drawFrame = (timestamp: number) => {
      animationFrame = null;
      if (!scene) {
        return;
      }
      const elapsedSeconds = lastFrameTime === null ? 0 : (timestamp - lastFrameTime) / 1_000;
      lastFrameTime = timestamp;
      advanceAtmosphereSceneInPlace(scene, elapsedSeconds, speed);
      drawAtmosphereScene(
        context,
        scene,
        resolveAtmosphereColor(kind, configuredColor, resolvedTheme === "dark"),
        opacity,
      );
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
        if (scene) {
          context.clearRect(0, 0, scene.width, scene.height);
        }
        return;
      }

      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(drawFrame);
      }
    };

    const handleResize = () => {
      resize();
      syncAnimation();
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
      context.clearRect(0, 0, canvas.width, canvas.height);
      document.removeEventListener("visibilitychange", syncAnimation);
      window.removeEventListener("focus", syncAnimation);
      window.removeEventListener("blur", syncAnimation);
      window.removeEventListener("resize", handleResize);
      reducedMotion.removeEventListener("change", syncAnimation);
    };
  }, [
    atmosphereAvailable,
    configuredColor,
    continueBackgroundAnimations,
    enabled,
    kind,
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
