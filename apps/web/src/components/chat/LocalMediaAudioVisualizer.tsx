import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { useSettings } from "../../hooks/useSettings";
import {
  LocalMediaAudioVisualizerController,
  shouldVisualizeLocalMedia,
} from "../../localMediaAudioVisualizer";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface LocalMediaAudioVisualizerProps {
  readonly enabled: boolean;
  readonly mediaElement: HTMLMediaElement | null;
  readonly className?: string;
}

/**
 * Decorative analysis for the renderer-owned Local Media element only.
 * This component has no iframe, URL-fetch, MediaStream, or system-audio input.
 */
export function LocalMediaAudioVisualizer({
  enabled,
  mediaElement,
  className,
}: LocalMediaAudioVisualizerProps) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const musicReactiveMatrix = useSettings(
    (settings) =>
      settings.fallingEffectsEnabled &&
      settings.fallingEffectKind === "matrix" &&
      settings.fallingEffectMatrixColorMode === "music-reactive",
  );
  const enabledRef = useRef(enabled);
  const musicReactiveMatrixRef = useRef(musicReactiveMatrix);
  const syncRef = useRef<() => void>(() => undefined);
  enabledRef.current = enabled;
  musicReactiveMatrixRef.current = musicReactiveMatrix;

  useEffect(() => {
    if (!canvas || !mediaElement) return;

    const controller = new LocalMediaAudioVisualizerController(mediaElement, canvas);
    const motionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    let disposed = false;

    const sync = () => {
      if (disposed) return;
      const visualizerRequested = shouldVisualizeLocalMedia({
        enabled: enabledRef.current,
        reducedMotion: motionQuery.matches,
        visible: document.visibilityState === "visible",
        focused: document.hasFocus(),
      });
      // Matrix color can consume only this already-approved selected-file
      // analyser. It never opens a microphone or reaches into iframe players.
      const colorAnalysisRequested = shouldVisualizeLocalMedia({
        enabled: musicReactiveMatrixRef.current,
        reducedMotion: motionQuery.matches,
        visible: document.visibilityState === "visible",
        focused: document.hasFocus(),
      });
      void controller.sync(visualizerRequested, colorAnalysisRequested);
    };
    syncRef.current = sync;
    const scheduleInitialSync = () => {
      queueMicrotask(() => {
        if (!disposed) sync();
      });
    };
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);

    mediaElement.addEventListener("play", sync);
    mediaElement.addEventListener("pause", sync);
    mediaElement.addEventListener("ended", sync);
    mediaElement.addEventListener("emptied", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    window.addEventListener("resize", sync);
    motionQuery.addEventListener("change", sync);
    resizeObserver?.observe(canvas);
    scheduleInitialSync();

    return () => {
      disposed = true;
      syncRef.current = () => undefined;
      mediaElement.removeEventListener("play", sync);
      mediaElement.removeEventListener("pause", sync);
      mediaElement.removeEventListener("ended", sync);
      mediaElement.removeEventListener("emptied", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      window.removeEventListener("resize", sync);
      motionQuery.removeEventListener("change", sync);
      resizeObserver?.disconnect();
      void controller.destroy();
    };
  }, [canvas, mediaElement]);

  useEffect(() => {
    syncRef.current();
  }, [enabled, musicReactiveMatrix]);

  return (
    <canvas
      ref={setCanvas}
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
      data-testid="local-media-audio-visualizer"
    />
  );
}
