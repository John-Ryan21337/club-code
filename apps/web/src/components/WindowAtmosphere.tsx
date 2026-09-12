import type { ScopedThreadRef } from "@cafecode/contracts";
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef } from "react";

import { useSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { MatrixGpuFrameCollector } from "../matrixGpuFrameCollector";
import { createMatrixWebGl2Renderer, type MatrixWebGl2Renderer } from "../matrixWebGlRenderer";
import { useServerConfig } from "../rpc/serverState";
import { useStore } from "../store";
import { decodeMatrixWorkVocabulary, selectMatrixWorkVocabularyKey } from "../matrixWorkVocabulary";
import {
  advanceAtmosphereSceneInPlace,
  applyMatrixWorkVocabularyInPlace,
  applyMatrixEnrichmentInPlace,
  createAtmosphereScene,
  createSeededRandom,
  drawAtmosphereScene,
  fitAtmosphereDpr,
  MATRIX_JAPANESE_GLYPHS,
  MATRIX_2CH_AA_TOKENS,
  MATRIX_2CH_ENRICHED_GLYPHS,
  MATRIX_ROMAN_GLYPHS,
  MAX_ATMOSPHERE_CANVAS_PIXELS,
  resolveAtmosphereColor,
  resolveAtmosphereRenderOpacity,
  resolveMatrixAtmosphereColorFrame,
  shouldAnimateAtmosphere,
  shouldShowAtmosphere,
  type AtmosphereScene,
} from "../windowAtmosphere";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** Bounded instance budget shared by the collector and the GPU renderer. */
const MAX_MATRIX_GPU_GLYPH_INSTANCES = 8_192;

function sceneSeed(kind: "snow" | "rain" | "matrix", width: number, height: number): number {
  const kindSeed = kind === "snow" ? 0x534e4f57 : kind === "rain" ? 0x5241494e : 0x4d415458;
  return (kindSeed ^ Math.round(width * 31) ^ Math.round(height * 131)) >>> 0;
}

function resolveCanvasDimension(measured: number, viewportFallback: number): number {
  if (Number.isFinite(measured) && measured > 0) return measured;
  if (Number.isFinite(viewportFallback) && viewportFallback > 0) return viewportFallback;
  return 1;
}

export function WindowAtmosphere({
  selectedThreadRef = null,
}: { readonly selectedThreadRef?: ScopedThreadRef | null } = {}) {
  const enabled = useSettings((settings) => settings.fallingEffectsEnabled);
  const kind = useSettings((settings) => settings.fallingEffectKind);
  const configuredColor = useSettings((settings) => settings.fallingEffectColor);
  const matrixColorMode = useSettings((settings) => settings.fallingEffectMatrixColorMode);
  const matrixColorCycleSpeed = useSettings(
    (settings) => settings.fallingEffectMatrixColorCycleSpeed,
  );
  const matrixBaseFontSize = useSettings((settings) => settings.fallingEffectMatrixBaseFontSize);
  const motionMode = useSettings((settings) => settings.fallingEffectMatrixMotionMode);
  const walkStartFontSize = useSettings(
    (settings) => settings.fallingEffectMatrixWalkStartFontSize,
  );
  const walkEndFontSize = useSettings((settings) => settings.fallingEffectMatrixWalkEndFontSize);
  const walkLifecyclePercent = useSettings(
    (settings) => settings.fallingEffectMatrixWalkLifecyclePercent,
  );
  const centerWindIntensity = useSettings(
    (settings) => settings.fallingEffectMatrixCenterWindIntensity,
  );
  const opacity = useSettings((settings) => settings.fallingEffectOpacity);
  const speed = useSettings((settings) => settings.fallingEffectSpeed);
  const density = useSettings((settings) => settings.fallingEffectDensity);
  const japaneseRatio = useSettings((settings) => settings.fallingEffectJapaneseRatio);
  const enriched2ch = useSettings((settings) => settings.fallingEffect2chEnriched);
  const enriched2chRef = useRef(enriched2ch);
  const liveWorkVocabularyEnabled = useSettings(
    (settings) => settings.fallingEffectLiveWorkVocabularyEnabled,
  );
  const continueBackgroundAnimations = useSettings(
    (settings) => settings.continueBackgroundAnimations,
  );
  const { resolvedTheme } = useTheme();
  const serverConfig = useServerConfig();
  const atmosphereAvailable = serverConfig?.ambientExperienceCapabilities.atmosphere === true;
  const vocabularyKey = useStore((state) =>
    atmosphereAvailable && enabled && kind === "matrix" && liveWorkVocabularyEnabled
      ? selectMatrixWorkVocabularyKey(state, selectedThreadRef)
      : "",
  );
  const vocabulary = useMemo(() => decodeMatrixWorkVocabulary(vocabularyKey), [vocabularyKey]);
  const vocabularyRef = useRef(vocabulary);
  const updateVocabularyRef = useRef<(() => void) | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const matrixGpuCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const matrixGpuRendererRef = useRef<MatrixWebGl2Renderer | null>(null);
  const matrixGpuAvailableRef = useRef(false);
  /**
   * Set by the draw effect while a scene exists. It repaints that exact scene
   * without advancing, reseeding, or scheduling a frame, so the GPU effect can
   * recover from a backend change it does not own.
   */
  const repaintAtmosphereRef = useRef<(() => void) | null>(null);
  const syncPresentationRef = useRef<(() => void) | null>(null);
  const presentation = useMemo(
    () => ({
      configuredColor,
      continueBackgroundAnimations,
      matrixBaseFontSize,
      matrixColorCycleSpeed,
      matrixColorMode,
      opacity,
      resolvedTheme,
      speed,
      walkEndFontSize,
      walkStartFontSize,
    }),
    [
      configuredColor,
      continueBackgroundAnimations,
      matrixBaseFontSize,
      matrixColorCycleSpeed,
      matrixColorMode,
      opacity,
      resolvedTheme,
      speed,
      walkEndFontSize,
      walkStartFontSize,
    ],
  );
  const readPresentation = useEffectEvent(() => presentation);
  const appliedPresentationRef = useRef(presentation);
  const matrixGpuFrameCollector = useMemo(
    () => new MatrixGpuFrameCollector(MAX_MATRIX_GPU_GLYPH_INSTANCES),
    [],
  );
  /**
   * The atlas is rasterized once per renderer, so it must cover every glyph a
   * Matrix stream can select, including bounded labels from the committed route.
   */
  const matrixGpuGlyphPool = useMemo(
    () => [
      ...Array.from(MATRIX_ROMAN_GLYPHS),
      ...Array.from(MATRIX_JAPANESE_GLYPHS),
      ...(enriched2ch ? [...Array.from(MATRIX_2CH_ENRICHED_GLYPHS), ...MATRIX_2CH_AA_TOKENS] : []),
      ...vocabulary.english,
      ...vocabulary.japanese,
    ],
    [vocabulary, enriched2ch],
  );

  // Clear the old route's pixels before paint, even with a queued RAF or reduced
  // motion. The replacement atlas is installed later; Canvas can draw new labels now.
  useLayoutEffect(() => {
    vocabularyRef.current = vocabulary;
    enriched2chRef.current = enriched2ch;
    matrixGpuAvailableRef.current = false;
    if (matrixGpuCanvasRef.current) matrixGpuCanvasRef.current.style.visibility = "hidden";
    updateVocabularyRef.current?.();
  }, [vocabulary, enriched2ch]);

  // Acquiring the WebGL2 context is independent from the draw loop: a GPU
  // failure must never restart or reseed the shared simulation.
  useEffect(() => {
    const gpuCanvas = matrixGpuCanvasRef.current;
    if (!atmosphereAvailable || !enabled || kind !== "matrix" || gpuCanvas === null) {
      matrixGpuRendererRef.current = null;
      matrixGpuAvailableRef.current = false;
      return;
    }

    const selection = createMatrixWebGl2Renderer(gpuCanvas, matrixGpuGlyphPool, {
      maxGlyphInstances: MAX_MATRIX_GPU_GLYPH_INSTANCES,
      onAvailabilityChange: (availability) => {
        const available = availability === "available";
        matrixGpuAvailableRef.current = available;
        gpuCanvas.dataset.matrixGpuAvailability = availability;
        // A regained context has not drawn anything yet, and a lost one still
        // shows its last frame. Only a committed frame may reveal this layer,
        // so hide it here and let the repaint below decide what is true.
        gpuCanvas.style.visibility = "hidden";
        // Backend availability is not a rendered frame: repaint the current
        // scene through the same commit path so the surviving backend owns the
        // pixels and the diagnostics. Reduced motion and hidden or unfocused
        // windows keep their policy; nothing is reseeded and no loop starts.
        repaintAtmosphereRef.current?.();
      },
    });
    if (selection.kind !== "webgl2") {
      gpuCanvas.style.visibility = "hidden";
      gpuCanvas.dataset.matrixGpuAvailability = "unavailable";
      gpuCanvas.dataset.matrixGpuFallbackReason = selection.reason;
      matrixGpuRendererRef.current = null;
      matrixGpuAvailableRef.current = false;
      repaintAtmosphereRef.current?.();
      return;
    }

    delete gpuCanvas.dataset.matrixGpuFallbackReason;
    gpuCanvas.dataset.matrixGpuAvailability = "available";
    matrixGpuRendererRef.current = selection.renderer;
    matrixGpuAvailableRef.current = true;
    repaintAtmosphereRef.current?.();
    return () => {
      selection.renderer.dispose();
      if (matrixGpuRendererRef.current === selection.renderer) {
        matrixGpuRendererRef.current = null;
        matrixGpuAvailableRef.current = false;
      }
      gpuCanvas.style.visibility = "hidden";
      repaintAtmosphereRef.current?.();
    };
  }, [atmosphereAvailable, enabled, kind, matrixGpuGlyphPool]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!atmosphereAvailable || !enabled || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    let scene: AtmosphereScene | null = null;
    let animationFrame: number | null = null;
    let resizeFrame: number | null = null;
    let lastFrameTime: number | null = null;

    // One policy source for both the animation loop and an out-of-band repaint.
    const atmosphereState = () => ({
      enabled,
      reducedMotion: reducedMotion.matches,
      documentVisible: document.visibilityState === "visible",
      windowFocused: document.hasFocus(),
      continueBackgroundAnimations: readPresentation().continueBackgroundAnimations,
    });

    const cancelAnimation = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      lastFrameTime = null;
    };

    const clearCanvasBitmap = () => {
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.restore();
    };

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = resolveCanvasDimension(bounds.width, window.innerWidth);
      const height = resolveCanvasDimension(bounds.height, window.innerHeight);
      const requestedDpr = fitAtmosphereDpr(window.devicePixelRatio, width, height);
      const bitmapWidth = Math.min(
        MAX_ATMOSPHERE_CANVAS_PIXELS,
        Math.max(1, Math.floor(width * requestedDpr)),
      );
      const bitmapHeight = Math.min(
        Math.floor(MAX_ATMOSPHERE_CANVAS_PIXELS / bitmapWidth),
        Math.max(1, Math.floor(height * requestedDpr)),
      );
      const dpr = Math.min(bitmapWidth / width, bitmapHeight / height);
      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      const gpuCanvas = matrixGpuCanvasRef.current;
      if (gpuCanvas !== null) {
        gpuCanvas.width = bitmapWidth;
        gpuCanvas.height = bitmapHeight;
      }
      scene = createAtmosphereScene(
        kind,
        width,
        height,
        createSeededRandom(sceneSeed(kind, width, height)),
        density,
        japaneseRatio,
        motionMode,
        walkLifecyclePercent,
        centerWindIntensity,
      );
      applyMatrixWorkVocabularyInPlace(
        scene,
        vocabularyRef.current,
        createSeededRandom(0x574f524b),
      );
      applyMatrixEnrichmentInPlace(scene, enriched2chRef.current, createSeededRandom(0x324348));
    };

    const renderScene = (timestamp: number, advance: boolean, dimmed = !advance) => {
      if (!scene) return;
      const {
        configuredColor,
        matrixBaseFontSize,
        matrixColorCycleSpeed,
        matrixColorMode,
        opacity,
        resolvedTheme,
        speed,
        walkEndFontSize,
        walkStartFontSize,
      } = readPresentation();
      const staticFrame = dimmed;
      const elapsedSeconds =
        advance && lastFrameTime !== null ? (timestamp - lastFrameTime) / 1_000 : 0;
      lastFrameTime = advance ? timestamp : null;
      advanceAtmosphereSceneInPlace(
        scene,
        elapsedSeconds,
        speed,
        motionMode,
        walkLifecyclePercent,
        centerWindIntensity,
      );
      const matrixColorFrame =
        kind === "matrix"
          ? resolveMatrixAtmosphereColorFrame(
              matrixColorMode,
              configuredColor,
              resolvedTheme === "dark",
              timestamp,
              matrixColorCycleSpeed,
            )
          : undefined;
      const color =
        matrixColorFrame?.color ??
        resolveAtmosphereColor(kind, configuredColor, resolvedTheme === "dark");
      const renderOpacity = resolveAtmosphereRenderOpacity(opacity, staticFrame);

      const gpuCanvas = matrixGpuCanvasRef.current;
      const gpuRenderer = matrixGpuRendererRef.current;
      let matrixGpuRendered = false;
      if (
        kind === "matrix" &&
        gpuCanvas !== null &&
        gpuRenderer !== null &&
        matrixGpuAvailableRef.current
      ) {
        // One traversal, two backends: the collector replays the authoritative
        // Canvas2D scene function against a recording context, so GPU and
        // fallback share projection, occupancy, alpha, color, and glyph order.
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
        const result = gpuRenderer.render(gpuFrame);
        matrixGpuRendered = result.status === "rendered" || result.status === "empty";
        gpuCanvas.style.visibility = matrixGpuRendered ? "visible" : "hidden";
        canvas.dataset.atmosphereFrameCommit = result.status;
      }

      if (matrixGpuRendered) {
        // The WebGL canvas already holds the complete glyph frame; keep the
        // Canvas2D layer transparent instead of uploading an empty bitmap.
        clearCanvasBitmap();
        canvas.dataset.atmosphereRenderer = "webgl2-glyph-atlas";
        canvas.dataset.atmosphereTextRasterization = "gpu-glyph-atlas";
        return;
      }

      drawAtmosphereScene(
        context,
        scene,
        color,
        renderOpacity,
        matrixColorFrame,
        motionMode,
        walkStartFontSize,
        walkEndFontSize,
        matrixBaseFontSize,
      );
      canvas.dataset.atmosphereRenderer = "canvas2d";
      canvas.dataset.atmosphereTextRasterization = "main-thread";
      canvas.dataset.atmosphereFrameCommit = "canvas2d";
    };

    /**
     * Recommits the current scene after a backend change. The simulation is not
     * advanced and never reseeded, the reduced-motion presentation keeps its
     * dimmed single frame, and no animation frame is scheduled: a hidden or
     * unfocused window without background continuation stays blank until its
     * own policy allows drawing again.
     */
    const repaintCurrentScene = () => {
      if (scene === null) return;
      if (animationFrame !== null) return;
      if (!shouldShowAtmosphere(atmosphereState())) return;
      renderScene(performance.now(), false, reducedMotion.matches);
    };

    const drawFrame = (timestamp: number) => {
      animationFrame = null;
      renderScene(timestamp, true);
      animationFrame = window.requestAnimationFrame(drawFrame);
    };

    const updateVocabulary = () => {
      if (scene === null) return;
      applyMatrixWorkVocabularyInPlace(
        scene,
        vocabularyRef.current,
        createSeededRandom(0x574f524b),
      );
      applyMatrixEnrichmentInPlace(scene, enriched2chRef.current, createSeededRandom(0x324348));
      if (shouldShowAtmosphere(atmosphereState())) {
        renderScene(performance.now(), false, reducedMotion.matches);
      } else {
        clearCanvasBitmap();
      }
    };

    const syncAnimation = () => {
      const state = atmosphereState();
      const visible = shouldShowAtmosphere(state);
      const canAnimate = shouldAnimateAtmosphere(state);
      if (!canAnimate) {
        cancelAnimation();
        // Reduced motion is a supported presentation, not a blank screen: draw
        // exactly one dimmed static frame and schedule no animation loop.
        if (visible && reducedMotion.matches) {
          renderScene(performance.now(), false);
          return;
        }
        clearCanvasBitmap();
        const gpuCanvas = matrixGpuCanvasRef.current;
        if (gpuCanvas !== null) gpuCanvas.style.visibility = "hidden";
        return;
      }
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(drawFrame);
      }
    };

    const handleResize = () => {
      if (resizeFrame !== null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        resize();
        syncAnimation();
      });
    };

    resize();
    repaintAtmosphereRef.current = repaintCurrentScene;
    updateVocabularyRef.current = updateVocabulary;
    syncPresentationRef.current = syncAnimation;
    appliedPresentationRef.current = readPresentation();
    syncAnimation();
    document.addEventListener("visibilitychange", syncAnimation);
    window.addEventListener("focus", syncAnimation);
    window.addEventListener("blur", syncAnimation);
    window.addEventListener("resize", handleResize);
    reducedMotion.addEventListener("change", syncAnimation);

    return () => {
      if (updateVocabularyRef.current === updateVocabulary) updateVocabularyRef.current = null;
      if (repaintAtmosphereRef.current === repaintCurrentScene) {
        repaintAtmosphereRef.current = null;
      }
      if (syncPresentationRef.current === syncAnimation) syncPresentationRef.current = null;
      cancelAnimation();
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      clearCanvasBitmap();
      document.removeEventListener("visibilitychange", syncAnimation);
      window.removeEventListener("focus", syncAnimation);
      window.removeEventListener("blur", syncAnimation);
      window.removeEventListener("resize", handleResize);
      reducedMotion.removeEventListener("change", syncAnimation);
    };
  }, [
    atmosphereAvailable,
    centerWindIntensity,
    density,
    enabled,
    japaneseRatio,
    kind,
    matrixGpuFrameCollector,
    motionMode,
    walkLifecyclePercent,
  ]);

  // Appearance and animation policy change the current scene's presentation.
  // Only geometry and scene-forming inputs above may recreate its particles.
  useEffect(() => {
    if (appliedPresentationRef.current === presentation) return;
    appliedPresentationRef.current = presentation;
    syncPresentationRef.current?.();
  }, [presentation]);

  if (!enabled || !atmosphereAvailable) return null;

  return (
    <>
      {kind === "matrix" ? (
        <canvas
          ref={matrixGpuCanvasRef}
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-40 h-full w-full overflow-hidden"
          data-testid="window-atmosphere-matrix-gpu"
          style={{ pointerEvents: "none", visibility: "hidden" }}
        />
      ) : null}
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-40 h-full w-full overflow-hidden"
        data-atmosphere-renderer="pending"
        data-atmosphere-text-rasterization="main-thread"
        data-atmosphere-frame-commit="pending"
        data-testid="window-atmosphere"
        style={{ pointerEvents: "none" }}
      />
    </>
  );
}
