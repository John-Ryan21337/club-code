import { ShuffleIcon, SkipBackIcon, SkipForwardIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { getClientSettings, useSettings } from "../../hooks/useSettings";
import { subscribeClientSettingsSnapshot } from "../../hooks/clientSettingsState";
import { getServerConfig, onServerConfigUpdated, useServerConfig } from "../../rpc/serverState";
import {
  DEFAULT_LOCAL_MEDIA_VISUALIZER_SETTINGS,
  LocalMediaAudioVisualizerController,
  type LocalMediaMilkdropState,
  type LocalMediaVisualizerStyle,
  shouldVisualizeLocalMedia,
} from "../../localMediaAudioVisualizer";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function matrixAudioRequested(): boolean {
  try {
    const settings = getClientSettings();
    return (
      getServerConfig()?.ambientExperienceCapabilities.atmosphere === true &&
      settings.fallingEffectsEnabled &&
      settings.fallingEffectKind === "matrix" &&
      (settings.fallingEffectMatrixColorMode === "music-reactive" ||
        settings.fallingEffectMatrixColorMode === "music-reactive-extra")
    );
  } catch {
    return false;
  }
}

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

const inputIdentities = new WeakMap<HTMLMediaElement | MediaStream, number>();
let nextInputIdentity = 0;

/** A released WebGL context cannot be reused on the old canvas. */
export function LocalMediaAudioVisualizer(props: LocalMediaAudioVisualizerProps) {
  const input = props.mediaElement ?? props.mediaStream;
  let identity = 0;
  if (input) {
    identity = inputIdentities.get(input) ?? ++nextInputIdentity;
    inputIdentities.set(input, identity);
  }
  return <LocalMediaAudioVisualizerSession key={identity} {...props} />;
}

/**
 * Decorative analysis for a renderer-owned local media element or one
 * explicitly approved, session-only display-capture audio stream.
 * Butterchurn and its 395-preset catalog are local lazy chunks; this component
 * never reads an iframe, records audio, uploads audio, or requests a microphone.
 */
function LocalMediaAudioVisualizerSession({
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
  const selectedStream = mediaElement === null ? mediaStream : null;
  const [spectrumCanvas, setSpectrumCanvas] = useState<HTMLCanvasElement | null>(null);
  const [milkdropCanvas, setMilkdropCanvas] = useState<HTMLCanvasElement | null>(null);
  const [milkdropState, setMilkdropState] = useState<LocalMediaMilkdropState>(IDLE_MILKDROP_STATE);
  const [waitingReason, setWaitingReason] = useState<string | null>(
    "Play media to start the visualizer.",
  );
  const controllerRef = useRef<LocalMediaAudioVisualizerController | null>(null);
  const musicMode = useSettings((settings) => settings.fallingEffectMatrixColorMode);
  const atmosphereEnabled = useSettings((settings) => settings.fallingEffectsEnabled);
  const atmosphereKind = useSettings((settings) => settings.fallingEffectKind);
  const atmosphereAvailable = useServerConfig()?.ambientExperienceCapabilities.atmosphere === true;
  const enabledRef = useRef(enabled);
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
  settingsRef.current = {
    style,
    presetName,
    autoCycle,
    cycleSeconds,
    blendSeconds,
    onPresetChange,
  };

  useEffect(() => {
    const input = mediaElement ?? selectedStream;
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
      setWaitingReason(
        motionQuery.matches
          ? "Visualization is paused for reduced motion."
          : document.visibilityState !== "visible" || !document.hasFocus()
            ? "Visualization is paused while this window is inactive."
            : mediaElement && (mediaElement.paused || mediaElement.ended)
              ? "Play media to start the visualizer."
              : null,
      );
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
            enabled: matrixAudioRequested(),
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
    for (const track of selectedStream?.getAudioTracks() ?? []) {
      track.addEventListener("ended", sync);
      track.addEventListener("mute", sync);
      track.addEventListener("unmute", sync);
    }
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    window.addEventListener("resize", sync);
    motionQuery.addEventListener("change", sync);
    const releaseSettings = subscribeClientSettingsSnapshot(sync);
    const releaseConfig = onServerConfigUpdated(sync);
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
      for (const track of selectedStream?.getAudioTracks() ?? []) {
        track.removeEventListener("ended", sync);
        track.removeEventListener("mute", sync);
        track.removeEventListener("unmute", sync);
      }
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      window.removeEventListener("resize", sync);
      motionQuery.removeEventListener("change", sync);
      releaseSettings();
      releaseConfig();
      resizeObserver?.disconnect();
      setMilkdropState(IDLE_MILKDROP_STATE);
      void controller.destroy();
    };
  }, [mediaElement, selectedStream, milkdropCanvas, spectrumCanvas]);

  useEffect(() => {
    syncRef.current();
  }, [
    autoCycle,
    blendSeconds,
    cycleSeconds,
    enabled,
    presetName,
    style,
    musicMode,
    atmosphereEnabled,
    atmosphereKind,
    atmosphereAvailable,
  ]);

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
      {enabled && style === "spectrum" && (waitingReason || milkdropState.status === "error") ? (
        <p
          role="status"
          className="absolute top-2 inset-x-2 rounded bg-black/70 px-2 py-1 text-center text-xs text-white"
        >
          {waitingReason ??
            (milkdropState.status === "error" ? milkdropState.failure.message : null)}
        </p>
      ) : null}
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
            {waitingReason ??
              (milkdropState.status === "ready"
                ? `${milkdropState.currentPreset} · ${milkdropState.presetNames.length} presets`
                : milkdropState.status === "error"
                  ? milkdropState.failure.message
                  : "Loading MilkDrop…")}
          </span>
        </div>
      ) : null}
    </div>
  );
}
