import {
  type CSSProperties,
  createContext,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Maximize2Icon, MoveIcon, PanelRightCloseIcon, XIcon } from "lucide-react";
import { cn } from "~/lib/utils";

import {
  clampAmbientMediaGeometry,
  readAmbientMediaGeometry,
  readOrSeedAmbientMediaGeometry,
  writeAmbientMediaGeometry,
  type NormalizedAmbientMediaGeometry,
} from "../../ambientMediaGeometryStorage";
import {
  AMBIENT_VIDEO_PRESET_WIDTHS,
  ambientVideoCinemaLayoutFits,
  ambientVideoPlayerShouldMount,
  youtubeEmbedUrl,
} from "../../ambientVideo";
import { spotifyEmbedUrl } from "../../spotify";
import { localMediaStore, useLocalMediaElement, useLocalMediaState } from "../../localMedia";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../rpc/serverState";
import { LocalMediaPanel } from "../chat/LocalMediaPanel";

const FLOATING_HIDE_PANE_WIDTH = 640;
const FLOATING_MARGIN = 16;
const CUSTOM_MIN_WIDTH = 356;
const CUSTOM_MAX_WIDTH_FRACTION = 0.9;
const VIDEO_ASPECT_RATIO = 16 / 9;
const KEYBOARD_MOVE_STEP = 0.02;
const KEYBOARD_RESIZE_STEP = 0.025;

interface AmbientVideoWorkspaceContextValue {
  readonly registerChatAnchor: (element: HTMLElement | null) => void;
  readonly cinemaEffective: boolean;
  readonly localMediaBackgroundEffective: boolean;
}

const AmbientVideoWorkspaceContext = createContext<AmbientVideoWorkspaceContextValue>({
  registerChatAnchor: () => undefined,
  cinemaEffective: false,
  localMediaBackgroundEffective: false,
});

export function useAmbientVideoWorkspace(): AmbientVideoWorkspaceContextValue {
  return useContext(AmbientVideoWorkspaceContext);
}

interface MeasuredRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function sameRect(left: MeasuredRect | null, right: MeasuredRect): boolean {
  return (
    left !== null &&
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height
  );
}

function useElementRect(
  element: HTMLElement | null,
  relativeTo: HTMLElement | null,
): MeasuredRect | null {
  const [rect, setRect] = useState<MeasuredRect | null>(null);

  useLayoutEffect(() => {
    if (!element || !relativeTo) {
      setRect(null);
      return;
    }

    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const elementRect = element.getBoundingClientRect();
        const rootRect = relativeTo.getBoundingClientRect();
        const next = {
          left: elementRect.left - rootRect.left,
          top: elementRect.top - rootRect.top,
          width: elementRect.width,
          height: elementRect.height,
        };
        setRect((current) => (sameRect(current, next) ? current : next));
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(relativeTo);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [element, relativeTo]);

  return rect;
}

function presetGeometry(input: {
  readonly anchor: MeasuredRect;
  readonly placement: "bottom-left" | "bottom-right";
  readonly width: number;
}): NormalizedAmbientMediaGeometry {
  const width = Math.min(input.width, Math.max(CUSTOM_MIN_WIDTH, input.anchor.width - 32));
  const normalizedWidth = width / input.anchor.width;
  const normalizedHeight = width / VIDEO_ASPECT_RATIO / input.anchor.height;
  return {
    x:
      input.placement === "bottom-left"
        ? FLOATING_MARGIN / input.anchor.width
        : 1 - normalizedWidth - FLOATING_MARGIN / input.anchor.width,
    y: Math.max(0, 1 - normalizedHeight - FLOATING_MARGIN / input.anchor.height),
    width: normalizedWidth,
  };
}

function geometryStyle(
  anchor: MeasuredRect,
  geometry: NormalizedAmbientMediaGeometry,
): CSSProperties {
  const width = geometry.width * anchor.width;
  return {
    left: anchor.left + geometry.x * anchor.width,
    top: anchor.top + geometry.y * anchor.height,
    width,
    height: width / VIDEO_ASPECT_RATIO,
  };
}

function clampGeometryForAnchor(
  value: NormalizedAmbientMediaGeometry,
  anchor: MeasuredRect,
): NormalizedAmbientMediaGeometry {
  return (
    clampAmbientMediaGeometry(value, {
      mediaAspectRatio: VIDEO_ASPECT_RATIO,
      paneAspectRatio: anchor.width / anchor.height,
      minimumWidth: Math.min(1, CUSTOM_MIN_WIDTH / anchor.width),
      maximumWidth: CUSTOM_MAX_WIDTH_FRACTION,
    }) ?? value
  );
}

interface PointerInteraction {
  readonly kind: "move" | "resize";
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startGeometry: NormalizedAmbientMediaGeometry;
}

function resolveGlowColor(value: "auto" | string): string {
  return value === "auto" ? "var(--primary)" : value;
}

// oxlint-disable react/iframe-missing-sandbox -- Iframe origins are constructed only for
// youtube-nocookie.com or open.spotify.com; neither accepts a user-controlled origin.
export function AmbientVideoWorkspace({ children }: { readonly children: ReactNode }) {
  const settings = useSettings();
  const localMedia = useLocalMediaState();
  const { updateSettings } = useUpdateSettings();
  const serverConfig = useServerConfig();
  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  const [chatAnchor, setChatAnchor] = useState<HTMLElement | null>(null);
  const [customGeometry, setCustomGeometry] = useState<NormalizedAmbientMediaGeometry | null>(() =>
    readAmbientMediaGeometry("video"),
  );
  const customGeometryRef = useRef(customGeometry);
  const pendingGeometryRef = useRef<NormalizedAmbientMediaGeometry | null>(null);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const animationFrameRef = useRef(0);
  const streamingCinemaHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const localCinemaHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const previousCinemaModeRef = useRef<"local" | "streaming" | null>(null);
  const [playerReadiness, setPlayerReadiness] = useState<{
    readonly sourceKey: string;
    readonly element: HTMLIFrameElement;
  } | null>(null);
  const rootRect = useElementRect(rootElement, rootElement);
  const anchorRect = useElementRect(chatAnchor, rootElement);
  const localMediaElement = useLocalMediaElement();
  const [localMediaPaused, setLocalMediaPaused] = useState(true);

  const source = settings.ambientVideoSource;
  const spotifySource = source?.kind === "spotify" ? source : null;
  const capabilityEnabled =
    source !== null &&
    (spotifySource
      ? serverConfig?.ambientExperienceCapabilities.spotifyEmbed === true
      : serverConfig?.ambientExperienceCapabilities.youtubePlayer === true);
  const sourceKey =
    source === null
      ? null
      : source.kind === "spotify"
        ? `spotify:${source.entityType}:${source.id}`
        : `${source.kind}:${source.id}`;
  const playerReady =
    sourceKey !== null &&
    playerReadiness?.sourceKey === sourceKey &&
    playerReadiness.element.isConnected;
  const locallyRenderable =
    capabilityEnabled && settings.ambientVideoEnabled && source !== null && anchorRect !== null;
  const cinemaRequested = settings.ambientVideoPresentationMode === "cinema";
  const cinemaLayoutFits =
    rootRect !== null && ambientVideoCinemaLayoutFits(rootRect.width, rootRect.height);
  const localCinemaRequested =
    localMedia.source !== null && localMedia.presentationMode === "cinema";
  const localCinemaEffective = localCinemaRequested && cinemaLayoutFits;
  const localMediaBackgroundEffective =
    localMedia.source?.kind === "video" && localMedia.presentationMode === "background";
  const localPresentationDominant = localCinemaRequested || localMediaBackgroundEffective;
  const streamingCinemaEffective =
    !localPresentationDominant &&
    locallyRenderable &&
    playerReady &&
    cinemaRequested &&
    cinemaLayoutFits;
  const cinemaEffective = localCinemaEffective || streamingCinemaEffective;
  const effectiveCinemaMode = localCinemaEffective
    ? "local"
    : streamingCinemaEffective
      ? "streaming"
      : null;

  const registerChatAnchor = useCallback((element: HTMLElement | null) => {
    setChatAnchor((current) => (current === element ? current : element));
  }, []);
  const registerRootElement = useCallback((element: HTMLDivElement | null) => {
    setRootElement((current) => (current === element ? current : element));
  }, []);
  const registerPlayerFrame = useCallback((element: HTMLIFrameElement | null) => {
    if (element === null) {
      setPlayerReadiness(null);
    }
  }, []);

  useEffect(() => {
    if (!localMediaElement) {
      setLocalMediaPaused(true);
      return;
    }
    const syncPlaybackState = () => setLocalMediaPaused(localMediaElement.paused);
    syncPlaybackState();
    localMediaElement.addEventListener("play", syncPlaybackState);
    localMediaElement.addEventListener("pause", syncPlaybackState);
    localMediaElement.addEventListener("ended", syncPlaybackState);
    localMediaElement.addEventListener("emptied", syncPlaybackState);
    return () => {
      localMediaElement.removeEventListener("play", syncPlaybackState);
      localMediaElement.removeEventListener("pause", syncPlaybackState);
      localMediaElement.removeEventListener("ended", syncPlaybackState);
      localMediaElement.removeEventListener("emptied", syncPlaybackState);
    };
  }, [localMediaElement]);

  const preset = useMemo(() => {
    if (!anchorRect) {
      return null;
    }
    return presetGeometry({
      anchor: anchorRect,
      placement: settings.ambientVideoPresetPlacement,
      width: AMBIENT_VIDEO_PRESET_WIDTHS[settings.ambientVideoPresetSize],
    });
  }, [anchorRect, settings.ambientVideoPresetPlacement, settings.ambientVideoPresetSize]);

  useEffect(() => {
    if (
      settings.ambientVideoLayoutMode !== "custom" ||
      !anchorRect ||
      customGeometry !== null ||
      preset === null
    ) {
      return;
    }
    const seeded = readOrSeedAmbientMediaGeometry("video", () => preset);
    customGeometryRef.current = seeded ?? preset;
    setCustomGeometry(seeded ?? preset);
  }, [anchorRect, customGeometry, preset, settings.ambientVideoLayoutMode]);

  const effectiveGeometry = useMemo(() => {
    if (!anchorRect || !preset) {
      return null;
    }
    if (settings.ambientVideoLayoutMode !== "custom") {
      return clampGeometryForAnchor(preset, anchorRect);
    }
    return clampGeometryForAnchor(customGeometry ?? preset, anchorRect);
  }, [anchorRect, customGeometry, preset, settings.ambientVideoLayoutMode]);

  const floatingVisible =
    locallyRenderable &&
    !cinemaEffective &&
    !localPresentationDominant &&
    anchorRect !== null &&
    anchorRect.width >= FLOATING_HIDE_PANE_WIDTH &&
    effectiveGeometry !== null;
  const playerShouldMount = ambientVideoPlayerShouldMount(
    locallyRenderable,
    floatingVisible,
    streamingCinemaEffective,
  );

  const commitGeometry = useCallback(
    (geometry: NormalizedAmbientMediaGeometry) => {
      if (!anchorRect) {
        return;
      }
      const clamped = clampGeometryForAnchor(geometry, anchorRect);
      customGeometryRef.current = clamped;
      setCustomGeometry(clamped);
      writeAmbientMediaGeometry("video", clamped);
    },
    [anchorRect],
  );

  const updateInteraction = useCallback(
    (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction || !anchorRect || event.pointerId !== interaction.pointerId) {
        return;
      }
      const deltaX = (event.clientX - interaction.startClientX) / anchorRect.width;
      const deltaY = (event.clientY - interaction.startClientY) / anchorRect.height;
      const next =
        interaction.kind === "move"
          ? {
              ...interaction.startGeometry,
              x: interaction.startGeometry.x + deltaX,
              y: interaction.startGeometry.y + deltaY,
            }
          : {
              ...interaction.startGeometry,
              width: interaction.startGeometry.width + deltaX,
            };

      const clamped = clampGeometryForAnchor(next, anchorRect);
      pendingGeometryRef.current = clamped;
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = window.requestAnimationFrame(() => {
        const pendingGeometry = pendingGeometryRef.current;
        if (!pendingGeometry) {
          return;
        }
        customGeometryRef.current = pendingGeometry;
        setCustomGeometry(pendingGeometry);
      });
    },
    [anchorRect],
  );

  const finishInteraction = useCallback(
    (pointerId?: number) => {
      const interaction = interactionRef.current;
      if (!interaction || (pointerId !== undefined && pointerId !== interaction.pointerId)) {
        return;
      }
      interactionRef.current = null;
      window.cancelAnimationFrame(animationFrameRef.current);
      const latestGeometry = pendingGeometryRef.current ?? customGeometryRef.current;
      pendingGeometryRef.current = null;
      if (latestGeometry) {
        customGeometryRef.current = latestGeometry;
        setCustomGeometry(latestGeometry);
        commitGeometry(latestGeometry);
      }
    },
    [commitGeometry],
  );

  useEffect(() => {
    const finishPointerInteraction = (event: PointerEvent) => {
      finishInteraction(event.pointerId);
    };
    const finishBlurredInteraction = () => {
      finishInteraction();
    };
    window.addEventListener("pointermove", updateInteraction);
    window.addEventListener("pointerup", finishPointerInteraction);
    window.addEventListener("pointercancel", finishPointerInteraction);
    window.addEventListener("blur", finishBlurredInteraction);
    return () => {
      window.cancelAnimationFrame(animationFrameRef.current);
      window.removeEventListener("pointermove", updateInteraction);
      window.removeEventListener("pointerup", finishPointerInteraction);
      window.removeEventListener("pointercancel", finishPointerInteraction);
      window.removeEventListener("blur", finishBlurredInteraction);
    };
  }, [finishInteraction, updateInteraction]);

  const beginInteraction = useCallback(
    (kind: PointerInteraction["kind"], event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!effectiveGeometry || !anchorRect) {
        return;
      }
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      pendingGeometryRef.current = null;
      interactionRef.current = {
        kind,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startGeometry: effectiveGeometry,
      };
      if (settings.ambientVideoLayoutMode !== "custom") {
        updateSettings({ ambientVideoLayoutMode: "custom" });
        customGeometryRef.current = effectiveGeometry;
        setCustomGeometry(effectiveGeometry);
      }
    },
    [anchorRect, effectiveGeometry, settings.ambientVideoLayoutMode, updateSettings],
  );

  useEffect(() => {
    const previousMode = previousCinemaModeRef.current;
    previousCinemaModeRef.current = effectiveCinemaMode;
    if (effectiveCinemaMode !== null && previousMode === null) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (effectiveCinemaMode !== null) {
      const frame = window.requestAnimationFrame(() => {
        const heading =
          effectiveCinemaMode === "local"
            ? localCinemaHeadingRef.current
            : streamingCinemaHeadingRef.current;
        heading?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (effectiveCinemaMode === null && previousMode !== null) {
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    }
  }, [effectiveCinemaMode]);

  useEffect(() => {
    if (!cinemaEffective) {
      return;
    }
    const exitCinemaOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.fullscreenElement !== null) {
        return;
      }
      event.preventDefault();
      if (localCinemaEffective) {
        localMediaStore.update({ presentationMode: "floating" });
      } else {
        updateSettings({ ambientVideoPresentationMode: "floating" });
      }
    };
    window.addEventListener("keydown", exitCinemaOnEscape);
    return () => window.removeEventListener("keydown", exitCinemaOnEscape);
  }, [cinemaEffective, localCinemaEffective, updateSettings]);

  const nudgeGeometry = useCallback(
    (kind: PointerInteraction["kind"], key: string) => {
      if (!effectiveGeometry || !anchorRect) {
        return;
      }
      const moveDelta =
        key === "ArrowLeft"
          ? { x: -KEYBOARD_MOVE_STEP, y: 0 }
          : key === "ArrowRight"
            ? { x: KEYBOARD_MOVE_STEP, y: 0 }
            : key === "ArrowUp"
              ? { x: 0, y: -KEYBOARD_MOVE_STEP }
              : key === "ArrowDown"
                ? { x: 0, y: KEYBOARD_MOVE_STEP }
                : null;
      if (!moveDelta) {
        return;
      }
      const next =
        kind === "move"
          ? {
              ...effectiveGeometry,
              x: effectiveGeometry.x + moveDelta.x,
              y: effectiveGeometry.y + moveDelta.y,
            }
          : {
              ...effectiveGeometry,
              width:
                effectiveGeometry.width +
                (moveDelta.x + moveDelta.y > 0 ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP),
            };
      updateSettings({ ambientVideoLayoutMode: "custom" });
      commitGeometry(next);
    },
    [anchorRect, commitGeometry, effectiveGeometry, updateSettings],
  );

  const frameStyle = useMemo<CSSProperties>(() => {
    if (streamingCinemaEffective) {
      return {};
    }
    if (!floatingVisible || !anchorRect || !effectiveGeometry) {
      return { display: "none" };
    }
    return geometryStyle(anchorRect, effectiveGeometry);
  }, [anchorRect, effectiveGeometry, floatingVisible, streamingCinemaEffective]);

  const contextValue = useMemo(
    () => ({ registerChatAnchor, cinemaEffective, localMediaBackgroundEffective }),
    [cinemaEffective, localMediaBackgroundEffective, registerChatAnchor],
  );

  return (
    <AmbientVideoWorkspaceContext.Provider value={contextValue}>
      <div
        ref={registerRootElement}
        className={cn(
          "relative grid min-h-0 min-w-0 flex-1 overflow-hidden",
          cinemaEffective
            ? "grid-cols-[minmax(356px,1fr)_minmax(320px,40rem)] gap-3 p-3"
            : "grid-cols-1",
        )}
        data-ambient-video-presentation={cinemaEffective ? "cinema" : "floating"}
        data-local-media-presentation={
          localCinemaEffective
            ? "cinema"
            : localMediaBackgroundEffective
              ? "background"
              : "floating"
        }
      >
        {localCinemaRequested && !localCinemaEffective ? (
          <div
            role="status"
            className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-border/80 bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-lg"
          >
            Local Media Cinema needs more window space; using the floating layout.
          </div>
        ) : null}
        {cinemaRequested && locallyRenderable && !localPresentationDominant && !cinemaEffective ? (
          <div
            role="status"
            className="pointer-events-none absolute top-3 left-1/2 z-30 -translate-x-1/2 rounded-full border border-border/80 bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-lg"
          >
            {!cinemaLayoutFits
              ? "Cinema needs more window space; using the floating layout."
              : "Loading the player before entering cinema."}
          </div>
        ) : null}
        <div
          className={cn(
            "min-h-0 min-w-0",
            cinemaEffective
              ? "col-start-2 row-start-1 overflow-hidden rounded-xl border"
              : "col-start-1 row-start-1",
            localMediaBackgroundEffective && "relative z-10",
          )}
          data-ambient-chat-rail={cinemaEffective ? "true" : undefined}
        >
          {children}
        </div>
        <LocalMediaPanel
          backgroundEffective={localMediaBackgroundEffective}
          cinemaEffective={localCinemaEffective}
          cinemaHeadingRef={localCinemaHeadingRef}
          floatingAnchor={anchorRect}
        />
        {localMediaBackgroundEffective ? (
          <div
            role="toolbar"
            aria-label="Local video background controls"
            className="absolute top-3 left-1/2 z-30 flex h-8 -translate-x-1/2 items-center gap-2 rounded-full border border-white/20 bg-black/75 px-3 text-xs text-white shadow-lg"
          >
            <span>Local video background</span>
            <button
              type="button"
              aria-label={
                localMediaPaused ? "Play local video background" : "Pause local video background"
              }
              aria-pressed={!localMediaPaused}
              disabled={localMediaElement === null}
              className="rounded px-1.5 py-1 text-[10px] hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                if (!localMediaElement) {
                  return;
                }
                if (localMediaElement.paused) {
                  void localMediaElement.play().catch(() => {
                    // Browser media policy/decoder failures remain recoverable
                    // through the normal floating native controls.
                  });
                } else {
                  localMediaElement.pause();
                }
              }}
            >
              {localMediaPaused ? "Play" : "Pause"}
            </button>
            <button
              type="button"
              aria-pressed={localMedia.visualizerEnabled}
              className="rounded px-1.5 py-1 text-[10px] hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              onClick={() =>
                localMediaStore.update({
                  visualizerEnabled: !localMedia.visualizerEnabled,
                })
              }
            >
              Visualizer
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              onClick={() => localMediaStore.update({ presentationMode: "floating" })}
            >
              <PanelRightCloseIcon className="size-3.5" />
              Exit
            </button>
            <button
              type="button"
              aria-label="Clear local video background"
              className="rounded p-1 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              onClick={() => localMediaStore.clear()}
            >
              <XIcon className="size-3.5" />
            </button>
          </div>
        ) : null}

        <section
          aria-label="Ambient streaming player"
          className={cn(
            "group/ambient-video overflow-hidden rounded-xl border border-border/80 bg-black shadow-2xl",
            streamingCinemaEffective
              ? "relative z-40 col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col self-center"
              : "absolute z-20",
            settings.ambientVideoGlowEnabled && "ambient-media-glow",
          )}
          data-ambient-protected-player={streamingCinemaEffective ? "true" : undefined}
          style={
            {
              ...frameStyle,
              ...(settings.ambientVideoGlowEnabled
                ? {
                    "--ambient-media-glow-color": resolveGlowColor(settings.ambientVideoGlowColor),
                    "--ambient-media-glow-opacity": settings.ambientVideoGlowOpacity,
                  }
                : {}),
            } as CSSProperties
          }
        >
          {source !== null && playerShouldMount ? (
            <iframe
              allow={
                spotifySource
                  ? "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  : "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              }
              allowFullScreen
              className={cn(
                "block w-full border-0 bg-black",
                streamingCinemaEffective ? "aspect-video" : "h-full",
              )}
              ref={registerPlayerFrame}
              referrerPolicy="strict-origin-when-cross-origin"
              sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
              src={source.kind === "spotify" ? spotifyEmbedUrl(source) : youtubeEmbedUrl(source)}
              onLoad={(event) => {
                if (sourceKey !== null) {
                  setPlayerReadiness({ sourceKey, element: event.currentTarget });
                }
              }}
              title={
                spotifySource
                  ? `Ambient Spotify ${spotifySource.entityType} player`
                  : source.kind === "video"
                    ? "Ambient YouTube video player"
                    : "Ambient YouTube playlist player"
              }
            />
          ) : null}

          {streamingCinemaEffective ? (
            <div className="order-first flex h-10 shrink-0 items-center justify-between border-b border-white/15 bg-card px-3 text-xs text-foreground">
              <h2
                ref={streamingCinemaHeadingRef}
                tabIndex={-1}
                className="rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cinema workspace
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => updateSettings({ ambientVideoPresentationMode: "floating" })}
                >
                  <PanelRightCloseIcon className="size-3.5" />
                  Exit cinema
                </button>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => updateSettings({ ambientVideoEnabled: false })}
                >
                  <XIcon className="size-3.5" />
                  Disable video
                </button>
              </div>
            </div>
          ) : null}

          {!streamingCinemaEffective && floatingVisible ? (
            <>
              <button
                type="button"
                aria-label="Move ambient video"
                className="absolute top-1 left-1 z-10 flex size-8 touch-none items-center justify-center rounded-md bg-black/65 text-white opacity-0 shadow-sm transition-opacity group-focus-within/ambient-video:opacity-100 group-hover/ambient-video:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onPointerDown={(event) => beginInteraction("move", event)}
                onLostPointerCapture={(event) => finishInteraction(event.pointerId)}
                onKeyDown={(event) => {
                  if (event.key.startsWith("Arrow")) {
                    event.preventDefault();
                    nudgeGeometry("move", event.key);
                  }
                }}
              >
                <MoveIcon className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Resize ambient video"
                className="absolute right-1 bottom-1 z-10 flex size-8 touch-none items-center justify-center rounded-md bg-black/65 text-white opacity-0 shadow-sm transition-opacity group-focus-within/ambient-video:opacity-100 group-hover/ambient-video:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onPointerDown={(event) => beginInteraction("resize", event)}
                onLostPointerCapture={(event) => finishInteraction(event.pointerId)}
                onKeyDown={(event) => {
                  if (event.key.startsWith("Arrow")) {
                    event.preventDefault();
                    nudgeGeometry("resize", event.key);
                  }
                }}
              >
                <Maximize2Icon className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Disable ambient video"
                className="absolute top-1 right-1 z-10 flex size-8 items-center justify-center rounded-md bg-black/65 text-white opacity-0 shadow-sm transition-opacity group-focus-within/ambient-video:opacity-100 group-hover/ambient-video:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={() => updateSettings({ ambientVideoEnabled: false })}
              >
                <XIcon className="size-4" />
              </button>
            </>
          ) : null}
        </section>
      </div>
    </AmbientVideoWorkspaceContext.Provider>
  );
}
// oxlint-enable react/iframe-missing-sandbox
