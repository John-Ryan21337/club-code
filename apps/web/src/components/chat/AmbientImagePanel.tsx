import type {
  AmbientImageAsset,
  AmbientMediaLayoutMode,
  AmbientMediaPresetSize,
} from "@cafecode/contracts/settings";
import { Maximize2Icon, MoveIcon, XIcon } from "lucide-react";
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
  clampAmbientMediaGeometry,
  readAmbientMediaGeometry,
  readOrSeedAmbientMediaGeometry,
  writeAmbientMediaGeometry,
  type NormalizedAmbientMediaGeometry,
} from "../../ambientMediaGeometryStorage";
import { AMBIENT_VIDEO_PRESET_WIDTHS } from "../../ambientVideo";
import { resolveAmbientImageSrc } from "../../ambientImages";
import { cn } from "~/lib/utils";

const WIDTH_BY_SIZE: Record<AmbientMediaPresetSize, number> = {
  small: 180,
  medium: 260,
  large: 360,
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

interface PaneSize {
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

function samePaneSize(left: PaneSize | null, right: PaneSize): boolean {
  return left?.width === right.width && left.height === right.height;
}

function useParentSize(element: HTMLElement | null): PaneSize | null {
  const [size, setSize] = useState<PaneSize | null>(null);
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

function clampForPane(
  value: NormalizedAmbientMediaGeometry,
  pane: PaneSize,
  aspectRatio: number,
): NormalizedAmbientMediaGeometry | null {
  const paneAspectRatio = pane.width / pane.height;
  const maximumReachableWidth = Math.min(
    CUSTOM_MAXIMUM_WIDTH_FRACTION,
    aspectRatio / paneAspectRatio,
  );
  return clampAmbientMediaGeometry(value, {
    mediaAspectRatio: aspectRatio,
    paneAspectRatio,
    minimumWidth: Math.min(CUSTOM_MINIMUM_WIDTH / pane.width, maximumReachableWidth),
    maximumWidth: CUSTOM_MAXIMUM_WIDTH_FRACTION,
  });
}

function customStyle(
  pane: PaneSize,
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
  readonly pane: PaneSize | null;
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
    width: WIDTH_BY_SIZE[input.requestedSize],
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
    AMBIENT_VIDEO_PRESET_WIDTHS[input.stackedVideoSize],
    input.pane.width - VIDEO_MARGIN * 2,
  );
  const bottom = VIDEO_MARGIN + videoWidth / VIDEO_ASPECT_RATIO + STACK_GAP;
  const requestedIndex = SIZE_ORDER.indexOf(input.requestedSize);
  for (let index = requestedIndex; index >= 0; index--) {
    const width = Math.min(WIDTH_BY_SIZE[SIZE_ORDER[index]!], input.pane.width - PANEL_MARGIN * 2);
    if (bottom + width / input.aspectRatio + PANEL_MARGIN <= input.pane.height) {
      return { width, placement: input.requestedPlacement, bottom };
    }
  }

  // If even the smallest upper panel does not fit, keep both controls
  // reachable by moving the image to the free corner instead of overlapping.
  return {
    ...base,
    placement: input.requestedPlacement === "bottom-left" ? "bottom-right" : "bottom-left",
  };
}

export function AmbientImagePanel({
  asset,
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
  const [panelElement, setPanelElement] = useState<HTMLElement | null>(null);
  const pane = useParentSize(panelElement);
  const [customGeometry, setCustomGeometry] = useState<NormalizedAmbientMediaGeometry | null>(() =>
    readAmbientMediaGeometry("image"),
  );
  const geometryRef = useRef(customGeometry);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [documentInactive, setDocumentInactive] = useState(() =>
    typeof document === "undefined" ? false : document.hidden || !document.hasFocus(),
  );
  const aspectRatio = asset.width / asset.height;
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
    if (!pane) return null;
    const width = Math.min(preset.width, pane.width - PANEL_MARGIN * 2);
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

  useEffect(() => {
    if (layoutMode !== "custom" || !pane || !presetGeometry || customGeometry !== null) return;
    const seeded = readOrSeedAmbientMediaGeometry("image", () => presetGeometry);
    const next = clampForPane(seeded ?? presetGeometry, pane, aspectRatio) ?? presetGeometry;
    geometryRef.current = next;
    setCustomGeometry(next);
  }, [aspectRatio, customGeometry, layoutMode, pane, presetGeometry]);

  const effectiveGeometry = useMemo(() => {
    if (layoutMode !== "custom" || !pane || !presetGeometry) return null;
    return clampForPane(customGeometry ?? presetGeometry, pane, aspectRatio) ?? presetGeometry;
  }, [aspectRatio, customGeometry, layoutMode, pane, presetGeometry]);

  const commitGeometry = useCallback(
    (value: NormalizedAmbientMediaGeometry) => {
      if (!pane) return;
      const next = clampForPane(value, pane, aspectRatio);
      if (!next) return;
      geometryRef.current = next;
      setCustomGeometry(next);
      writeAmbientMediaGeometry("image", next);
    },
    [aspectRatio, pane],
  );

  const finishInteraction = useCallback(
    (pointerId?: number) => {
      const interaction = interactionRef.current;
      if (!interaction || (pointerId !== undefined && interaction.pointerId !== pointerId)) return;
      interactionRef.current = null;
      if (geometryRef.current) commitGeometry(geometryRef.current);
    },
    [commitGeometry],
  );

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction || !pane || event.pointerId !== interaction.pointerId) return;
      const deltaX = (event.clientX - interaction.startClientX) / pane.width;
      const deltaY = (event.clientY - interaction.startClientY) / pane.height;
      const candidate =
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
      const next = clampForPane(candidate, pane, aspectRatio);
      if (!next) return;
      geometryRef.current = next;
      setCustomGeometry(next);
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
  }, [aspectRatio, finishInteraction, pane]);

  const beginInteraction = useCallback(
    (kind: PointerInteraction["kind"], event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!effectiveGeometry) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      interactionRef.current = {
        kind,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startGeometry: effectiveGeometry,
      };
    },
    [effectiveGeometry],
  );

  const nudge = useCallback(
    (kind: PointerInteraction["kind"], key: string) => {
      if (!effectiveGeometry) return;
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
      commitGeometry(
        kind === "move"
          ? {
              ...effectiveGeometry,
              x: effectiveGeometry.x + delta.x,
              y: effectiveGeometry.y + delta.y,
            }
          : {
              ...effectiveGeometry,
              width:
                effectiveGeometry.width +
                (delta.x + delta.y > 0 ? KEYBOARD_RESIZE_STEP : -KEYBOARD_RESIZE_STEP),
            },
      );
    },
    [commitGeometry, effectiveGeometry],
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

  const suspendAnimation =
    asset.mimeType === "image/gif" &&
    (reducedMotion || (!continueBackgroundAnimations && documentInactive));
  const color = glowColor === "auto" ? "#7dd3fc" : glowColor;
  const custom = layoutMode === "custom" && pane !== null && effectiveGeometry !== null;
  return (
    <section
      ref={setPanelElement}
      aria-label="Ambient image"
      className={cn(
        "pointer-events-auto absolute z-20 overflow-hidden rounded-xl border border-white/15 bg-black/30 shadow-lg",
        !custom && (preset.placement === "bottom-left" ? "left-3" : "right-3"),
      )}
      data-ambient-image-layout={custom ? "custom" : "preset"}
      style={{
        ...(custom
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
          className="absolute top-1 left-1 z-10 rounded bg-black/65 p-1 text-white hover:bg-black focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Move ambient image; use arrow keys for precise movement"
          onPointerDown={(event) => beginInteraction("move", event)}
          onKeyDown={(event) => {
            if (event.key.startsWith("Arrow")) {
              event.preventDefault();
              nudge("move", event.key);
            }
          }}
        >
          <MoveIcon className="size-3" />
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
        <img
          src={resolveAmbientImageSrc(asset)}
          alt=""
          className={cn("block w-full object-contain", custom ? "h-full" : "h-auto")}
          width={asset.width}
          height={asset.height}
          style={custom ? undefined : { maxHeight: "min(50vh, 420px)" }}
        />
      )}
      {custom ? (
        <button
          type="button"
          className="absolute right-1 bottom-1 z-10 cursor-nwse-resize rounded bg-black/65 p-1 text-white hover:bg-black focus-visible:ring-2 focus-visible:ring-white"
          aria-label="Resize ambient image; use arrow keys for precise resizing"
          onPointerDown={(event) => beginInteraction("resize", event)}
          onKeyDown={(event) => {
            if (event.key.startsWith("Arrow")) {
              event.preventDefault();
              nudge("resize", event.key);
            }
          }}
        >
          <Maximize2Icon className="size-3" />
        </button>
      ) : null}
    </section>
  );
}
