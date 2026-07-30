import { ShuffleIcon, SkipBackIcon, SkipForwardIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import {
  DEFAULT_LOCAL_MEDIA_VISUALIZER_SETTINGS,
  LocalMediaAudioVisualizerController,
  type LocalMediaMilkdropState,
  type LocalMediaVisualizerStyle,
  shouldVisualizeLocalMedia,
} from "../../localMediaAudioVisualizer";
import { useServerConfig } from "../../rpc/serverState";
import { registerAtmosphereControlHandler } from "../../atmosphereControlBus";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export interface LocalMediaAudioVisualizerProps {
  readonly enabled: boolean;
  readonly mediaElement: HTMLMediaElement | null;
  readonly mediaStream?: MediaStream | null;
  readonly style?: LocalMediaVisualizerStyle;
  readonly presetName?: string | null;
  readonly autoCycle?: boolean;
  readonly cycleSeconds?: number;
  readonly blendSeconds?: number;
  readonly showControls?: boolean;
  readonly onPresetChange?: (presetName: string) => void;
  readonly className?: string;
}

const IDLE_MILKDROP_STATE: LocalMediaMilkdropState = {
  status: "idle",
  presetNames: [],
  currentPreset: null,
};

/**
 * Decorative analysis for a renderer-owned local media element or one
 * explicitly approved, session-only display-capture audio stream.
 * Butterchurn and its 395-preset catalog are local lazy chunks; this component
 * never reads an iframe, records audio, uploads audio, or requests a microphone.
 */
export function LocalMediaAudioVisualizer({
  enabled,
  mediaElement,
  mediaStream = null,
  style = DEFAULT_LOCAL_MEDIA_VISUALIZER_SETTINGS.style,
  presetName = DEFAULT_LOCAL_MEDIA_VISUALIZER_SETTINGS.presetName,
  autoCycle = DEFAULT_LOCAL_MEDIA_VISUALIZER_SETTINGS.autoCycle,
  cycleSeconds = DEFAULT_LOCAL_MEDIA_VISUALIZER_SETTINGS.cycleSeconds,
  blendSeconds = DEFAULT_LOCAL_MEDIA_VISUALIZER_SETTINGS.blendSeconds,
  showControls = true,
  onPresetChange,
  className,
}: LocalMediaAudioVisualizerProps) {
  const [spectrumCanvas, setSpectrumCanvas] = useState<HTMLCanvasElement | null>(null);
  const [milkdropCanvas, setMilkdropCanvas] = useState<HTMLCanvasElement | null>(null);
  const [milkdropState, setMilkdropState] = useState<LocalMediaMilkdropState>(IDLE_MILKDROP_STATE);
  const controllerRef = useRef<LocalMediaAudioVisualizerController | null>(null);
  const serverConfig = useServerConfig();
  const musicReactiveMatrix = useSettings(
    (settings) =>
      serverConfig?.ambientExperienceCapabilities.atmosphere === true &&
      settings.fallingEffectsEnabled &&
      settings.fallingEffectKind === "matrix" &&
      (settings.fallingEffectMatrixColorMode === "music-reactive" ||
        settings.fallingEffectMatrixColorMode === "music-reactive-extra"),
  );
  const enabledRef = useRef(enabled);
  const musicReactiveMatrixRef = useRef(musicReactiveMatrix);
  const settingsRef = useRef({
    style,
    presetName,
    autoCycle,
    cycleSeconds,
    blendSeconds,
    onPresetChange,
  });
  const syncRef = useRef<() => void>(() => undefined);
  enabledRef.current = enabled;
  musicReactiveMatrixRef.current = musicReactiveMatrix;
  settingsRef.current = {
    style,
    presetName,
    autoCycle,
    cycleSeconds,
    blendSeconds,
    onPresetChange,
  };

  useEffect(() => {
    const input = mediaElement ?? mediaStream;
    if (!spectrumCanvas || !milkdropCanvas || !input) return;

    const controller = new LocalMediaAudioVisualizerController(
      input,
      spectrumCanvas,
      undefined,
      milkdropCanvas,
    );
    controllerRef.current = controller;
    const motionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    let disposed = false;

    const sync = () => {
      if (disposed) return;
      const settings = settingsRef.current;
      void controller.sync(
        shouldVisualizeLocalMedia({
          enabled: enabledRef.current,
          reducedMotion: motionQuery.matches,
          visible: document.visibilityState === "visible",
          focused: document.hasFocus(),
        }),
        {
          style: settings.style,
          presetName: settings.presetName,
          autoCycle: settings.autoCycle,
          cycleSeconds: settings.cycleSeconds,
          blendSeconds: settings.blendSeconds,
          publishMatrixSignal: shouldVisualizeLocalMedia({
            enabled: musicReactiveMatrixRef.current,
            reducedMotion: motionQuery.matches,
            visible: document.visibilityState === "visible",
            focused: document.hasFocus(),
          }),
          onMilkdropState: (state) => {
            if (disposed) return;
            setMilkdropState(state);
            if (
              state.status === "ready" &&
              state.currentPreset !== settingsRef.current.presetName
            ) {
              settingsRef.current.onPresetChange?.(state.currentPreset);
            }
          },
        },
      );
    };
    syncRef.current = sync;
    const scheduleInitialSync = () => {
      queueMicrotask(() => {
        if (!disposed) sync();
      });
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => controller.resize());

    if (mediaElement) {
      mediaElement.addEventListener("play", sync);
      mediaElement.addEventListener("pause", sync);
      mediaElement.addEventListener("ended", sync);
      mediaElement.addEventListener("emptied", sync);
    }
    for (const track of mediaStream?.getAudioTracks() ?? []) {
      track.addEventListener("ended", sync);
      track.addEventListener("mute", sync);
      track.addEventListener("unmute", sync);
    }
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    window.addEventListener("resize", sync);
    motionQuery.addEventListener("change", sync);
    resizeObserver?.observe(spectrumCanvas);
    resizeObserver?.observe(milkdropCanvas);
    scheduleInitialSync();

    return () => {
      disposed = true;
      controllerRef.current = null;
      syncRef.current = () => undefined;
      if (mediaElement) {
        mediaElement.removeEventListener("play", sync);
        mediaElement.removeEventListener("pause", sync);
        mediaElement.removeEventListener("ended", sync);
        mediaElement.removeEventListener("emptied", sync);
      }
      for (const track of mediaStream?.getAudioTracks() ?? []) {
        track.removeEventListener("ended", sync);
        track.removeEventListener("mute", sync);
        track.removeEventListener("unmute", sync);
      }
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      window.removeEventListener("resize", sync);
      motionQuery.removeEventListener("change", sync);
      resizeObserver?.disconnect();
      setMilkdropState(IDLE_MILKDROP_STATE);
      void controller.destroy();
    };
  }, [mediaElement, mediaStream, milkdropCanvas, spectrumCanvas]);

  useEffect(() => {
    syncRef.current();
  }, [autoCycle, blendSeconds, cycleSeconds, enabled, musicReactiveMatrix, presetName, style]);

  const navigate = (operation: "next" | "previous" | "random") => {
    const controller = controllerRef.current;
    if (!controller) return;
    // The controller publishes the selected preset through its state callback.
    // Calling the prop here as well caused duplicate session-store updates.
    if (operation === "next") {
      controller.nextMilkdropPreset();
    } else if (operation === "previous") {
      controller.previousMilkdropPreset();
    } else {
      controller.randomMilkdropPreset();
    }
  };

  useEffect(
    () =>
      registerAtmosphereControlHandler((command) => {
        if (
          command.kind !== "visualizer" ||
          command.action === "toggle" ||
          !enabled ||
          style !== "milkdrop"
        ) {
          return { handled: false, message: "The visualizer is not ready." };
        }
        const controller = controllerRef.current;
        if (!controller) {
          return { handled: false, message: "The visualizer is still loading." };
        }
        if (command.action === "next") {
          controller.nextMilkdropPreset();
        } else if (command.action === "previous") {
          controller.previousMilkdropPreset();
        } else {
          controller.randomMilkdropPreset();
        }
        return {
          handled: true,
          message:
            command.action === "random"
              ? "Selected a random visualizer."
              : command.action === "next"
                ? "Selected the next visualizer."
                : "Selected the previous visualizer.",
        };
      }),
    [enabled, style],
  );

  const milkdropVisible = enabled && style === "milkdrop";
  return (
    <div
      aria-hidden={!enabled}
      className={cn("pointer-events-none absolute inset-0", className)}
      data-testid="local-media-audio-visualizer"
    >
      <canvas
        ref={setSpectrumCanvas}
        aria-hidden="true"
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-200",
          enabled && style === "spectrum" ? "opacity-100" : "opacity-0",
        )}
      />
      <canvas
        ref={setMilkdropCanvas}
        aria-hidden="true"
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-200",
          milkdropVisible ? "opacity-100" : "opacity-0",
        )}
      />
      {milkdropVisible && showControls ? (
        <div
          role="toolbar"
          aria-label="MilkDrop visualization controls"
          className="pointer-events-auto absolute top-2 left-1/2 z-20 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-white/20 bg-black/70 px-2 py-1 text-[10px] text-white shadow-lg backdrop-blur-sm"
        >
          <button
            type="button"
            aria-label="Previous MilkDrop preset"
            disabled={milkdropState.status !== "ready"}
            className="rounded p-1 hover:bg-white/15 disabled:opacity-40"
            onClick={() => navigate("previous")}
          >
            <SkipBackIcon className="size-3" />
          </button>
          <button
            type="button"
            aria-label="Random MilkDrop preset"
            disabled={milkdropState.status !== "ready"}
            className="rounded p-1 hover:bg-white/15 disabled:opacity-40"
            onClick={() => navigate("random")}
          >
            <ShuffleIcon className="size-3" />
          </button>
          <button
            type="button"
            aria-label="Next MilkDrop preset"
            disabled={milkdropState.status !== "ready"}
            className="rounded p-1 hover:bg-white/15 disabled:opacity-40"
            onClick={() => navigate("next")}
          >
            <SkipForwardIcon className="size-3" />
          </button>
          <span className="max-w-56 truncate" title={milkdropState.currentPreset ?? undefined}>
            {milkdropState.status === "ready"
              ? `${milkdropState.currentPreset} · ${milkdropState.presetNames.length} presets`
              : milkdropState.status === "error"
                ? "MilkDrop unavailable"
                : "Loading MilkDrop…"}
          </span>
        </div>
      ) : null}
    </div>
  );
}
