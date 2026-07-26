import type {
  AmbientImageAsset,
  AmbientImagePresentationMode,
  AmbientMediaLayoutMode,
  AmbientMediaPresetSize,
} from "@cafecode/contracts/settings";
import { ChevronLeftIcon, ChevronRightIcon, MoveIcon, ScalingIcon, XIcon } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  readAmbientMediaGeometry,
  readOrSeedAmbientMediaGeometry,
  writeAmbientMediaGeometry,
  type NormalizedAmbientMediaGeometry,
} from "../../ambientMediaGeometryStorage";
import { resolveAmbientImageSrc } from "../../ambientImages";
import { cn } from "~/lib/utils";
import {
  clampAmbientImageGeometryForPane,
  resolveAmbientImageKeyboardMove,
  resolveAmbientImageKeyboardResize,
  resolveAmbientImagePointerMove,
  resolveAmbientImagePointerResize,
  type AmbientImagePaneSize,
} from "./ambientImageGeometryController";

const IMAGE_WIDTH_BY_SIZE: Readonly<Record<AmbientMediaPresetSize, number>> = {
  small: 180,
  medium: 260,
  large: 360,
};
const VIDEO_WIDTH_BY_SIZE: Readonly<Record<AmbientMediaPresetSize, number>> = {
  small: 360,
  medium: 480,
  large: 640,
};
const SIZE_ORDER: readonly AmbientMediaPresetSize[] = ["small", "medium", "large"];
const PANEL_MARGIN = 12;
const STACK_GAP = 12;
const VIDEO_MARGIN = 16;
const VIDEO_ASPECT_RATIO = 16 / 9;
const VIDEO_MINIMUM_PANE_WIDTH = 640;
const CUSTOM_MINIMUM_WIDTH = 120;
const CUSTOM_MAXIMUM_WIDTH_FRACTION = 0.9;
const KEYBOARD_MOVE_STEP = 0.02;
const KEYBOARD_RESIZE_STEP = 0.025;
const CUSTOM_GEOMETRY_LIMITS = {
  minimumWidthPixels: CUSTOM_MINIMUM_WIDTH,
  maximumWidthFraction: CUSTOM_MAXIMUM_WIDTH_FRACTION,
} as const;

interface GeometryInteraction {
  readonly kind: "move" | "resize";
  readonly pointerId: number;
  moved: boolean;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startGeometry: NormalizedAmbientMediaGeometry;
  readonly captureTarget: HTMLButtonElement;
}

function samePaneSize(left: AmbientImagePaneSize | null, right: AmbientImagePaneSize): boolean {
  return left?.width === right.width && left.height === right.height;
}

function useParentSize(element: HTMLElement | null): AmbientImagePaneSize | null {
  const [size, setSize] = useState<AmbientImagePaneSize | null>(null);

  useLayoutEffect(() => {
    const parent = element?.parentElement;
    if (!parent) {
      setSize(null);
      return;
    }
    const measure = () => {
      const rect = parent.getBoundingClientRect();
      const next = { width: rect.width, height: rect.height };
      setSize((current) => (samePaneSize(current, next) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [element]);

  return size;
}

function sameGeometry(
  left: NormalizedAmbientMediaGeometry | null,
  right: NormalizedAmbientMediaGeometry,
): boolean {
  return left?.x === right.x && left.y === right.y && left.width === right.width;
}

function customStyle(
  pane: AmbientImagePaneSize,
  geometry: NormalizedAmbientMediaGeometry,
  aspectRatio: number,
): CSSProperties {
  const width = geometry.width * pane.width;
  return {
    left: geometry.x * pane.width,
    top: geometry.y * pane.height,
    width,
    height: width / aspectRatio,
  };
}

export function resolveAmbientImagePresetPresentation(input: {
  readonly pane: AmbientImagePaneSize | null;
  readonly requestedSize: AmbientMediaPresetSize;
  readonly requestedPlacement: "bottom-left" | "bottom-right";
  readonly aspectRatio: number;
  readonly stackedVideoSize: AmbientMediaPresetSize | null;
}): {
  readonly width: number;
  readonly placement: "bottom-left" | "bottom-right";
  readonly bottom: number;
} {
  const base = {
    width: IMAGE_WIDTH_BY_SIZE[input.requestedSize],
    placement: input.requestedPlacement,
    bottom: PANEL_MARGIN,
  };
  if (
    input.pane === null ||
    input.stackedVideoSize === null ||
    input.pane.width < VIDEO_MINIMUM_PANE_WIDTH
  ) {
    return base;
  }

  const videoWidth = Math.min(
    VIDEO_WIDTH_BY_SIZE[input.stackedVideoSize],
    input.pane.width - VIDEO_MARGIN * 2,
  );
  const bottom = VIDEO_MARGIN + videoWidth / VIDEO_ASPECT_RATIO + STACK_GAP;
  const requestedIndex = SIZE_ORDER.indexOf(input.requestedSize);
  for (let index = requestedIndex; index >= 0; index--) {
    const width = Math.min(
      IMAGE_WIDTH_BY_SIZE[SIZE_ORDER[index]!],
      input.pane.width - PANEL_MARGIN * 2,
    );
    if (bottom + width / input.aspectRatio + PANEL_MARGIN <= input.pane.height) {
      return { width, placement: input.requestedPlacement, bottom };
    }
  }

  return {
    ...base,
    placement: input.requestedPlacement === "bottom-left" ? "bottom-right" : "bottom-left",
  };
}

export function shouldAdvanceAmbientImageCycle(input: {
  readonly assetCount: number;
  readonly continueBackgroundAnimations: boolean;
  readonly documentInactive: boolean;
}): boolean {
  return input.assetCount > 1 && (input.continueBackgroundAnimations || !input.documentInactive);
}

export function AmbientImagePanel({
  asset,
  cycleAssets,
  cycleEnabled,
  cycleSeconds,
  presentationMode,
  layoutMode,
  size,
  placement,
  stackedVideoSize,
  glow,
  glowColor,
  glowOpacity,
  continueBackgroundAnimations,
  onDisable,
}: {
  readonly asset: AmbientImageAsset;
  readonly cycleAssets: readonly AmbientImageAsset[];
  readonly cycleEnabled: boolean;
  readonly cycleSeconds: number;
  readonly presentationMode: AmbientImagePresentationMode;
  readonly layoutMode: AmbientMediaLayoutMode;
  readonly size: AmbientMediaPresetSize;
  readonly placement: "bottom-left" | "bottom-right";
  readonly stackedVideoSize: AmbientMediaPresetSize | null;
  readonly glow: boolean;
  readonly glowColor: string;
  readonly glowOpacity: number;
  readonly continueBackgroundAnimations: boolean;
  readonly onDisable: () => void;
}) {
  const cycle = useMemo(() => {
    const requested = cycleEnabled && cycleAssets.length > 0 ? cycleAssets : [asset];
    const seen = new Set<string>();
    return requested.filter((candidate) => {
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    });
  }, [asset, cycleAssets, cycleEnabled]);
  const [cycleIndex, setCycleIndex] = useState(0);
  const cycleKey = cycle.map((candidate) => candidate.id).join("|");
  useEffect(() => setCycleIndex(0), [cycleKey]);
  const activeAsset = cycle[cycleIndex % cycle.length] ?? asset;

  const [panelElement, setPanelElement] = useState<HTMLElement | null>(null);
  const pane = useParentSize(panelElement);
  const [customGeometry, setCustomGeometry] = useState<NormalizedAmbientMediaGeometry | null>(() =>
    readAmbientMediaGeometry("image"),
  );
  const geometryRef = useRef(customGeometry);
  const customLayoutActiveRef = useRef(false);
  const interactionRef = useRef<GeometryInteraction | null>(null);
  const pendingGeometryRef = useRef<NormalizedAmbientMediaGeometry | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [interactionActive, setInteractionActive] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [documentInactive, setDocumentInactive] = useState(() =>
    typeof document === "undefined" ? false : document.hidden || !document.hasFocus(),
  );
  const aspectRatio = activeAsset.width / activeAsset.height;
  const preset = useMemo(
    () =>
      resolveAmbientImagePresetPresentation({
        pane,
        requestedSize: size,
        requestedPlacement: placement,
        aspectRatio,
        stackedVideoSize,
      }),
    [aspectRatio, pane, placement, size, stackedVideoSize],
  );

  const presetGeometry = useMemo<NormalizedAmbientMediaGeometry | null>(() => {
    if (!pane) {
      return null;
    }
    const width = Math.min(preset.width, pane.width - PANEL_MARGIN * 2);
    if (width <= 0 || pane.width <= 0 || pane.height <= 0) {
      return null;
    }
    const normalizedWidth = width / pane.width;
    const normalizedHeight = width / aspectRatio / pane.height;
    return {
      x:
        preset.placement === "bottom-left"
          ? PANEL_MARGIN / pane.width
          : 1 - normalizedWidth - PANEL_MARGIN / pane.width,
      y: Math.max(0, 1 - normalizedHeight - preset.bottom / pane.height),
      width: normalizedWidth,
    };
  }, [aspectRatio, pane, preset]);

  const applyVisualGeometry = useCallback((next: NormalizedAmbientMediaGeometry) => {
    geometryRef.current = next;
    setCustomGeometry((current) => (sameGeometry(current, next) ? current : next));
  }, []);

  const clampForCurrentPane = useCallback(
    (value: NormalizedAmbientMediaGeometry) => {
      if (!pane) {
        return null;
      }
      return clampAmbientImageGeometryForPane({
        geometry: value,
        pane,
        mediaAspectRatio: aspectRatio,
        limits: CUSTOM_GEOMETRY_LIMITS,
      });
    },
    [aspectRatio, pane],
  );

  const persistGeometry = useCallback(
    (value: NormalizedAmbientMediaGeometry) => {
      if (!pane) {
        return false;
      }
      const paneAspectRatio = pane.width / pane.height;
      const maximumReachableWidth = Math.min(
        CUSTOM_MAXIMUM_WIDTH_FRACTION,
        aspectRatio / paneAspectRatio,
      );
      return writeAmbientMediaGeometry("image", value, {
        mediaAspectRatio: aspectRatio,
        paneAspectRatio,
        minimumWidth: Math.min(CUSTOM_MINIMUM_WIDTH / pane.width, maximumReachableWidth),
        maximumWidth: CUSTOM_MAXIMUM_WIDTH_FRACTION,
      });
    },
    [aspectRatio, pane],
  );

  useEffect(() => {
    if (layoutMode !== "custom") {
      customLayoutActiveRef.current = false;
      return;
    }
    if (!pane || !presetGeometry || customLayoutActiveRef.current) {
      return;
    }
    customLayoutActiveRef.current = true;
    const storedOrSeeded = readOrSeedAmbientMediaGeometry("image", () => presetGeometry);
    const next = clampForCurrentPane(storedOrSeeded ?? presetGeometry) ?? presetGeometry;
    applyVisualGeometry(next);
  }, [applyVisualGeometry, clampForCurrentPane, layoutMode, pane, presetGeometry]);

  const effectiveGeometry = useMemo(() => {
    if (layoutMode !== "custom" || !pane || !presetGeometry) {
      return null;
    }
    return clampForCurrentPane(customGeometry ?? presetGeometry) ?? presetGeometry;
  }, [clampForCurrentPane, customGeometry, layoutMode, pane, presetGeometry]);

  const flushPendingGeometry = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    const pending = pendingGeometryRef.current;
    pendingGeometryRef.current = null;
    if (pending) {
      applyVisualGeometry(pending);
      return pending;
    }
    return geometryRef.current;
  }, [applyVisualGeometry]);

  const scheduleVisualGeometry = useCallback(
    (next: NormalizedAmbientMediaGeometry) => {
      pendingGeometryRef.current = next;
      if (animationFrameRef.current !== null) {
        return;
      }
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        const pending = pendingGeometryRef.current;
        pendingGeometryRef.current = null;
        if (pending) {
          applyVisualGeometry(pending);
        }
      });
    },
    [applyVisualGeometry],
  );

  const commitGeometry = useCallback(
    (value: NormalizedAmbientMediaGeometry) => {
      const next = clampForCurrentPane(value);
      if (!next) {
        return;
      }
      applyVisualGeometry(next);
      persistGeometry(next);
    },
    [applyVisualGeometry, clampForCurrentPane, persistGeometry],
  );

  const finishInteraction = useCallback(
    (pointerId?: number) => {
      const interaction = interactionRef.current;
      if (!interaction || (pointerId !== undefined && interaction.pointerId !== pointerId)) {
        return;
      }
      const latest = flushPendingGeometry();
      interactionRef.current = null;
      setInteractionActive(false);
      try {
        if (interaction.captureTarget.hasPointerCapture(interaction.pointerId)) {
          interaction.captureTarget.releasePointerCapture(interaction.pointerId);
        }
      } catch {
        // Capture can already be gone after an OS or compositor cancellation.
      }
      if (latest && interaction.moved) {
        commitGeometry(latest);
      }
    },
    [commitGeometry, flushPendingGeometry],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction || !pane || event.pointerId !== interaction.pointerId) {
        return;
      }
      const input = {
        startGeometry: interaction.startGeometry,
        startPointer: {
          clientX: interaction.startClientX,
          clientY: interaction.startClientY,
        },
        currentPointer: {
          clientX: event.clientX,
          clientY: event.clientY,
        },
        pane,
        mediaAspectRatio: aspectRatio,
        limits: CUSTOM_GEOMETRY_LIMITS,
      };
      const next =
        interaction.kind === "move"
          ? resolveAmbientImagePointerMove(input)
          : resolveAmbientImagePointerResize(input);
      if (next) {
        interaction.moved = true;
        scheduleVisualGeometry(next);
      }
    };
    const finish = (event: PointerEvent) => finishInteraction(event.pointerId);
    const finishOnBlur = () => finishInteraction();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finishOnBlur);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finishOnBlur);
    };
  }, [aspectRatio, finishInteraction, pane, scheduleVisualGeometry]);

  useEffect(
    () => () => {
      interactionRef.current = null;
      pendingGeometryRef.current = null;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    },
    [],
  );

  const beginInteraction = useCallback(
    (kind: GeometryInteraction["kind"], event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!effectiveGeometry || interactionRef.current !== null) {
        return;
      }
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Window-level listeners still provide a bounded fallback.
      }
      interactionRef.current = {
        kind,
        pointerId: event.pointerId,
        moved: false,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startGeometry: effectiveGeometry,
        captureTarget: event.currentTarget,
      };
      setInteractionActive(true);
    },
    [effectiveGeometry],
  );

  const adjustGeometryWithKeyboard = useCallback(
    (kind: GeometryInteraction["kind"], key: string) => {
      if (!effectiveGeometry || !pane) {
        return;
      }
      const input = {
        geometry: effectiveGeometry,
        key,
        step: kind === "move" ? KEYBOARD_MOVE_STEP : KEYBOARD_RESIZE_STEP,
        pane,
        mediaAspectRatio: aspectRatio,
        limits: CUSTOM_GEOMETRY_LIMITS,
      };
      const next =
        kind === "move"
          ? resolveAmbientImageKeyboardMove(input)
          : resolveAmbientImageKeyboardResize(input);
      if (next) {
        commitGeometry(next);
      }
    },
    [aspectRatio, commitGeometry, effectiveGeometry, pane],
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReducedMotion(query.matches);
    const updateActivity = () => setDocumentInactive(document.hidden || !document.hasFocus());
    updateMotion();
    updateActivity();
    query.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateActivity);
    window.addEventListener("focus", updateActivity);
    window.addEventListener("blur", updateActivity);
    return () => {
      query.removeEventListener("change", updateMotion);
      document.removeEventListener("visibilitychange", updateActivity);
      window.removeEventListener("focus", updateActivity);
      window.removeEventListener("blur", updateActivity);
    };
  }, []);

  useEffect(() => {
    if (
      !shouldAdvanceAmbientImageCycle({
        assetCount: cycle.length,
        continueBackgroundAnimations,
        documentInactive,
      }) ||
      interactionActive
    ) {
      return;
    }
    const delay = Math.min(3_600, Math.max(3, cycleSeconds)) * 1_000;
    const interval = window.setInterval(
      () => setCycleIndex((current) => (current + 1) % cycle.length),
      delay,
    );
    return () => window.clearInterval(interval);
  }, [
    continueBackgroundAnimations,
    cycle.length,
    cycleSeconds,
    documentInactive,
    interactionActive,
  ]);

  const suspendAnimation =
    activeAsset.mimeType === "image/gif" &&
    (reducedMotion || (!continueBackgroundAnimations && documentInactive));
  const color = glowColor === "auto" ? "#7dd3fc" : glowColor;
  const theater = presentationMode === "theater";
  const custom = !theater && layoutMode === "custom" && pane !== null && effectiveGeometry !== null;

  return (
    <section
      ref={setPanelElement}
      aria-label="Ambient image"
      className={cn(
        "pointer-events-auto absolute z-20 overflow-hidden border border-white/15 bg-black/30 shadow-lg",
        theater ? "inset-0 rounded-none" : "rounded-xl",
        !theater && !custom && (preset.placement === "bottom-left" ? "left-3" : "right-3"),
      )}
      data-ambient-image-layout={theater ? "theater" : custom ? "custom" : "preset"}
      style={{
        ...(theater
          ? { inset: 0 }
          : custom
            ? customStyle(pane, effectiveGeometry, aspectRatio)
            : {
                bottom: preset.bottom,
                width: preset.width,
                maxWidth: "calc(100% - 24px)",
              }),
        boxShadow: glow
          ? `0 0 28px color-mix(in srgb, ${color} ${Math.round(glowOpacity * 100)}%, transparent)`
          : undefined,
      }}
    >
      {custom ? (
        <button
          type="button"
          className="absolute top-1 left-1 z-10 touch-none cursor-move rounded bg-black/65 p-1 text-white hover:bg-black focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Move ambient image; use arrow keys for precise movement"
          onPointerDown={(event) => beginInteraction("move", event)}
          onLostPointerCapture={(event) => finishInteraction(event.pointerId)}
          onKeyDown={(event) => {
            if (event.key.startsWith("Arrow")) {
              event.preventDefault();
              adjustGeometryWithKeyboard("move", event.key);
            }
          }}
        >
          <MoveIcon className="size-3" />
        </button>
      ) : null}
      {custom ? (
        <button
          type="button"
          className="absolute right-1 bottom-1 z-10 touch-none cursor-nwse-resize rounded bg-black/65 p-1 text-white hover:bg-black focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Resize ambient image; use arrow keys for precise sizing"
          onPointerDown={(event) => beginInteraction("resize", event)}
          onLostPointerCapture={(event) => finishInteraction(event.pointerId)}
          onKeyDown={(event) => {
            if (event.key.startsWith("Arrow")) {
              event.preventDefault();
              adjustGeometryWithKeyboard("resize", event.key);
            }
          }}
        >
          <ScalingIcon className="size-3" />
        </button>
      ) : null}
      <button
        type="button"
        className="absolute top-1 right-1 z-10 rounded bg-black/65 p-1 text-white hover:bg-black focus-visible:ring-2 focus-visible:ring-white"
        aria-label="Disable ambient image"
        onClick={onDisable}
      >
        <XIcon className="size-3" />
      </button>
      {suspendAnimation ? (
        <div className="flex h-full min-h-20 items-center justify-center bg-muted px-6 text-center text-xs text-muted-foreground">
          Animated image paused{" "}
          {reducedMotion ? "for reduced motion" : "while Cafe Code is hidden or unfocused"}.
        </div>
      ) : (
        <>
          {theater ? (
            <img
              src={resolveAmbientImageSrc(activeAsset)}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-35 blur-2xl"
            />
          ) : null}
          <img
            src={resolveAmbientImageSrc(activeAsset)}
            alt=""
            className={cn(
              "relative block w-full object-contain",
              custom || theater ? "h-full" : "h-auto",
            )}
            width={activeAsset.width}
            height={activeAsset.height}
            style={custom || theater ? undefined : { maxHeight: "min(50vh, 420px)" }}
          />
        </>
      )}
      {cycle.length > 1 ? (
        <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/65 p-1 text-xs text-white">
          <button
            type="button"
            className="rounded p-1 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Previous ambient image"
            onClick={() => setCycleIndex((current) => (current - 1 + cycle.length) % cycle.length)}
          >
            <ChevronLeftIcon className="size-4" />
          </button>
          <span aria-live="polite">{`${cycleIndex + 1} / ${cycle.length}`}</span>
          <button
            type="button"
            className="rounded p-1 hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
            aria-label="Next ambient image"
            onClick={() => setCycleIndex((current) => (current + 1) % cycle.length)}
          >
            <ChevronRightIcon className="size-4" />
          </button>
        </div>
      ) : null}
    </section>
  );
}
