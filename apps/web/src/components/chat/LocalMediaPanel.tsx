import { Maximize2Icon, MoveIcon, PanelRightCloseIcon, XIcon } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  clampAmbientMediaGeometry,
  type NormalizedAmbientMediaGeometry,
} from "../../ambientMediaGeometryStorage";
import {
  localMediaStore,
  registerLocalMediaElement,
  type LocalMediaKind,
  type LocalMediaPresetSize,
  useLocalMediaElement,
  useLocalMediaState,
} from "../../localMedia";
import { cn } from "~/lib/utils";
import { LocalMediaAudioVisualizer } from "./LocalMediaAudioVisualizer";

const WIDTH_BY_SIZE: Record<LocalMediaPresetSize, number> = {
  small: 360,
  medium: 480,
  large: 640,
};
const PANEL_MARGIN = 12;
const MINIMUM_WIDTH = 240;
const MAXIMUM_WIDTH_FRACTION = 0.9;
const KEYBOARD_MOVE_STEP = 0.02;
const KEYBOARD_RESIZE_STEP = 0.025;

export interface LocalMediaAnchorRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface PointerInteraction {
  readonly kind: "move" | "resize";
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startGeometry: NormalizedAmbientMediaGeometry;
}

function aspectRatio(kind: LocalMediaKind): number {
  // Audio still needs room for its controls, toolbar, and optional visualizer.
  return kind === "video" ? 16 / 9 : 2;
}

function clampGeometry(
  geometry: NormalizedAmbientMediaGeometry,
  pane: LocalMediaAnchorRect,
  mediaAspectRatio: number,
): NormalizedAmbientMediaGeometry | null {
  if (
    !Number.isFinite(pane.width) ||
    !Number.isFinite(pane.height) ||
    pane.width <= PANEL_MARGIN * 2 ||
    pane.height <= PANEL_MARGIN * 2
  ) {
    return null;
  }
  const paneAspectRatio = pane.width / pane.height;
  const maximumReachableWidth = Math.min(
    MAXIMUM_WIDTH_FRACTION,
    mediaAspectRatio / paneAspectRatio,
  );
  return clampAmbientMediaGeometry(geometry, {
    mediaAspectRatio,
    paneAspectRatio,
    minimumWidth: Math.min(MINIMUM_WIDTH / pane.width, maximumReachableWidth),
    maximumWidth: MAXIMUM_WIDTH_FRACTION,
  });
}

function geometryStyle(
  pane: LocalMediaAnchorRect,
  geometry: NormalizedAmbientMediaGeometry,
  mediaAspectRatio: number,
): CSSProperties {
  const width = geometry.width * pane.width;
  return {
    left: pane.left + geometry.x * pane.width,
    top: pane.top + geometry.y * pane.height,
    width,
    height: width / mediaAspectRatio,
  };
}

function presetGeometry(
  pane: LocalMediaAnchorRect | null,
  placement: "bottom-left" | "bottom-right",
  size: LocalMediaPresetSize,
  mediaAspectRatio: number,
): NormalizedAmbientMediaGeometry | null {
  if (
    !pane ||
    !Number.isFinite(pane.width) ||
    !Number.isFinite(pane.height) ||
    pane.width <= PANEL_MARGIN * 2 ||
    pane.height <= PANEL_MARGIN * 2
  ) {
    return null;
  }
  const width = Math.min(WIDTH_BY_SIZE[size], pane.width - PANEL_MARGIN * 2);
  const normalizedWidth = width / pane.width;
  const normalizedHeight = width / mediaAspectRatio / pane.height;
  return clampGeometry(
    {
      x:
        placement === "bottom-left"
          ? PANEL_MARGIN / pane.width
          : 1 - normalizedWidth - PANEL_MARGIN / pane.width,
      y: Math.max(0, 1 - normalizedHeight - PANEL_MARGIN / pane.height),
      width: normalizedWidth,
    },
    pane,
    mediaAspectRatio,
  );
}

/**
 * A current-document HTML media panel. It deliberately accepts only an object
 * URL from the browser file picker; it has no path, network, iframe, server,
 * Electron, or persisted-settings dependency.
 */
export interface LocalMediaPanelProps {
  readonly cinemaEffective: boolean;
  readonly backgroundEffective: boolean;
  readonly floatingAnchor: LocalMediaAnchorRect | null;
  readonly cinemaHeadingRef: Ref<HTMLHeadingElement>;
}

export function LocalMediaPanel({
  cinemaEffective,
  backgroundEffective,
  floatingAnchor,
  cinemaHeadingRef,
}: LocalMediaPanelProps) {
  const state = useLocalMediaState();
  const source = state.source;
  const mediaElement = useLocalMediaElement();
  const [geometry, setGeometry] = useState<NormalizedAmbientMediaGeometry | null>(null);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const pendingGeometryRef = useRef<NormalizedAmbientMediaGeometry | null>(null);
  const animationFrameRef = useRef(0);
  const [playbackError, setPlaybackError] = useState(false);

  const ratio = source ? aspectRatio(source.kind) : 16 / 9;
  const preset = useMemo(
    () =>
      source
        ? presetGeometry(
            floatingAnchor,
            state.presetPlacement,
            state.presetSize,
            aspectRatio(source.kind),
          )
        : null,
    [floatingAnchor, source, state.presetPlacement, state.presetSize],
  );

  useEffect(() => {
    setGeometry(null);
    setPlaybackError(false);
  }, [source?.objectUrl]);

  useEffect(() => {
    if (
      state.layoutMode !== "custom" ||
      geometry !== null ||
      preset === null ||
      floatingAnchor === null
    ) {
      return;
    }
    setGeometry(clampGeometry(preset, floatingAnchor, ratio) ?? preset);
  }, [floatingAnchor, geometry, preset, ratio, state.layoutMode]);

  const effectiveGeometry = useMemo(() => {
    if (
      cinemaEffective ||
      backgroundEffective ||
      state.layoutMode !== "custom" ||
      floatingAnchor === null ||
      preset === null
    ) {
      return null;
    }
    return clampGeometry(geometry ?? preset, floatingAnchor, ratio) ?? preset;
  }, [
    backgroundEffective,
    cinemaEffective,
    floatingAnchor,
    geometry,
    preset,
    ratio,
    state.layoutMode,
  ]);
  const custom = effectiveGeometry !== null;
  const floatingGeometry = effectiveGeometry ?? preset;

  const commitGeometry = useCallback(
    (next: NormalizedAmbientMediaGeometry) => {
      if (!floatingAnchor) return;
      setGeometry(clampGeometry(next, floatingAnchor, ratio));
    },
    [floatingAnchor, ratio],
  );

  const finishInteraction = useCallback((pointerId?: number) => {
    const interaction = interactionRef.current;
    if (!interaction || (pointerId !== undefined && interaction.pointerId !== pointerId)) return;
    interactionRef.current = null;
    window.cancelAnimationFrame(animationFrameRef.current);
    const pendingGeometry = pendingGeometryRef.current;
    pendingGeometryRef.current = null;
    if (pendingGeometry) {
      setGeometry(pendingGeometry);
    }
  }, []);

  useEffect(() => {
    if (!source) {
      return;
    }
    const move = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction || !floatingAnchor || event.pointerId !== interaction.pointerId) return;
      const next =
        interaction.kind === "move"
          ? {
              ...interaction.startGeometry,
              x:
                interaction.startGeometry.x +
                (event.clientX - interaction.startClientX) / floatingAnchor.width,
              y:
                interaction.startGeometry.y +
                (event.clientY - interaction.startClientY) / floatingAnchor.height,
            }
          : {
              ...interaction.startGeometry,
              width:
                interaction.startGeometry.width +
                (event.clientX - interaction.startClientX) / floatingAnchor.width,
            };
      const clamped = clampGeometry(next, floatingAnchor, ratio);
      if (!clamped) {
        return;
      }
      pendingGeometryRef.current = clamped;
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = window.requestAnimationFrame(() => {
        const pendingGeometry = pendingGeometryRef.current;
        if (pendingGeometry) {
          setGeometry(pendingGeometry);
        }
      });
    };
    const finish = (event: PointerEvent) => finishInteraction(event.pointerId);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    const finishOnBlur = () => finishInteraction();
    window.addEventListener("blur", finishOnBlur);
    return () => {
      window.cancelAnimationFrame(animationFrameRef.current);
      pendingGeometryRef.current = null;
      interactionRef.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finishOnBlur);
    };
  }, [finishInteraction, floatingAnchor, ratio, source]);

  const beginInteraction = useCallback(
    (kind: PointerInteraction["kind"], event: ReactPointerEvent<HTMLButtonElement>) => {
      const start = effectiveGeometry ?? preset;
      if (!start) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      localMediaStore.update({ layoutMode: "custom" });
      setGeometry(start);
      pendingGeometryRef.current = null;
      interactionRef.current = {
        kind,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startGeometry: start,
      };
    },
    [effectiveGeometry, preset],
  );

  const nudge = useCallback(
    (kind: PointerInteraction["kind"], key: string) => {
      const start = effectiveGeometry ?? preset;
      if (!start) return;
      const delta =
        key === "ArrowLeft"
          ? { x: -KEYBOARD_MOVE_STEP, y: 0 }
          : key === "ArrowRight"
            ? { x: KEYBOARD_MOVE_STEP, y: 0 }
            : key === "ArrowUp"
              ? { x: 0, y: -KEYBOARD_MOVE_STEP }
              : key === "ArrowDown"
                ? { x: 0, y: KEYBOARD_MOVE_STEP }
                : null;
      if (!delta) return;
      localMediaStore.update({ layoutMode: "custom" });
      commitGeometry(
        kind === "move"
          ? { ...start, x: start.x + delta.x, y: start.y + delta.y }
          : {
              ...start,
              width:
                start.width +
                (delta.x + delta.y > 0 ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP),
            },
      );
    },
    [commitGeometry, effectiveGeometry, preset],
  );

  if (!source) return null;
  return (
    <section
      aria-label="Local media player"
      className={cn(
        "group/local-media overflow-hidden rounded-xl border border-white/15 bg-black/85 shadow-2xl",
        cinemaEffective
          ? "relative z-40 col-start-1 row-start-1 flex min-h-0 min-w-0 self-center"
          : backgroundEffective
            ? "pointer-events-none absolute inset-0 z-0 rounded-none border-0 bg-transparent shadow-none"
            : "pointer-events-auto absolute z-30",
        !cinemaEffective && !backgroundEffective && floatingAnchor === null && "hidden",
      )}
      data-local-media-layout={custom ? "custom" : "preset"}
      data-local-media-presentation={
        cinemaEffective ? "cinema" : backgroundEffective ? "background" : "floating"
      }
      style={{
        ...(cinemaEffective || backgroundEffective
          ? {}
          : floatingAnchor && floatingGeometry
            ? geometryStyle(floatingAnchor, floatingGeometry, ratio)
            : { display: "none" }),
        boxShadow:
          state.glowEnabled && !backgroundEffective
            ? `0 0 28px color-mix(in srgb, ${state.glowColor} ${Math.round(state.glowOpacity * 100)}%, transparent)`
            : undefined,
      }}
    >
      <div
        className={cn(
          "flex h-8 items-center justify-between border-b border-white/15 bg-black/40 px-2 text-xs text-white",
          cinemaEffective && "order-first absolute inset-x-0 top-0 z-20",
          backgroundEffective && "hidden",
        )}
      >
        <h2
          ref={cinemaHeadingRef}
          tabIndex={cinemaEffective ? -1 : undefined}
          className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Local media · {source.displayTitle} · session only
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-pressed={state.visualizerEnabled}
            aria-label="Toggle local media audio visualizer"
            className="rounded px-1.5 py-1 text-[10px] hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={() => localMediaStore.update({ visualizerEnabled: !state.visualizerEnabled })}
          >
            Visualizer
          </button>
          {cinemaEffective || backgroundEffective ? (
            <button
              type="button"
              aria-label="Exit local media presentation"
              className="rounded p-1 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              onClick={() => localMediaStore.update({ presentationMode: "floating" })}
            >
              <PanelRightCloseIcon className="size-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Clear local media"
            className="rounded p-1 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={() => localMediaStore.clear()}
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>
      {playbackError ? (
        <div
          role="alert"
          className="flex min-h-24 items-center justify-center p-4 text-center text-xs text-white/80"
        >
          This browser could not play the selected local media file.
        </div>
      ) : source.kind === "video" ? (
        <div
          className={cn(
            "relative",
            cinemaEffective && "w-full pt-8",
            backgroundEffective && "h-full w-full",
          )}
          style={backgroundEffective ? { opacity: state.backgroundOpacity } : undefined}
        >
          <video
            ref={registerLocalMediaElement}
            {...(backgroundEffective ? { "aria-hidden": true } : {})}
            className={cn(
              "block w-full bg-black",
              cinemaEffective
                ? "aspect-video"
                : backgroundEffective
                  ? "h-full object-cover"
                  : "aspect-video",
            )}
            controls={!backgroundEffective}
            controlsList="nodownload noremoteplayback"
            disablePictureInPicture
            disableRemotePlayback
            onError={() => setPlaybackError(true)}
            preload="metadata"
            src={source.objectUrl}
            data-local-media-source="selected-file"
            tabIndex={backgroundEffective ? -1 : undefined}
          />
          <LocalMediaAudioVisualizer
            {...(!backgroundEffective ? { className: "bottom-12" } : {})}
            enabled={state.visualizerEnabled}
            mediaElement={mediaElement}
          />
        </div>
      ) : (
        <div
          className={cn(
            "relative flex min-h-24 items-center p-4",
            cinemaEffective && "w-full pt-12",
          )}
        >
          <audio
            ref={registerLocalMediaElement}
            className="relative z-10 w-full"
            controls
            controlsList="nodownload noremoteplayback"
            onError={() => setPlaybackError(true)}
            preload="metadata"
            src={source.objectUrl}
            data-local-media-source="selected-file"
          />
          <LocalMediaAudioVisualizer
            enabled={state.visualizerEnabled}
            mediaElement={mediaElement}
          />
        </div>
      )}
      {custom && !cinemaEffective && !backgroundEffective ? (
        <>
          <button
            type="button"
            aria-label="Move local media; use arrow keys for precise movement"
            className="absolute top-10 left-1 rounded bg-black/65 p-1 text-white hover:bg-black focus-visible:ring-2 focus-visible:ring-white"
            onKeyDown={(event) => {
              if (event.key.startsWith("Arrow")) {
                event.preventDefault();
                nudge("move", event.key);
              }
            }}
            onLostPointerCapture={(event) => finishInteraction(event.pointerId)}
            onPointerDown={(event) => beginInteraction("move", event)}
          >
            <MoveIcon className="size-3" />
          </button>
          <button
            type="button"
            aria-label="Resize local media; use arrow keys for precise resizing"
            className={cn(
              "absolute right-1 cursor-nwse-resize rounded bg-black/65 p-1 text-white hover:bg-black focus-visible:ring-2 focus-visible:ring-white",
              source.kind === "video" ? "bottom-12" : "bottom-1",
            )}
            onKeyDown={(event) => {
              if (event.key.startsWith("Arrow")) {
                event.preventDefault();
                nudge("resize", event.key);
              }
            }}
            onLostPointerCapture={(event) => finishInteraction(event.pointerId)}
            onPointerDown={(event) => beginInteraction("resize", event)}
          >
            <Maximize2Icon className="size-3" />
          </button>
        </>
      ) : null}
    </section>
  );
}
