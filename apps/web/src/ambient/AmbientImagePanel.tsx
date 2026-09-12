import type {
  AmbientImageAsset,
  AmbientImageGlowColor,
  AmbientImageLayoutMode,
  AmbientImagePresetPlacement,
  AmbientImagePresetSize,
} from "@cafecode/contracts/settings";
import { Maximize2Icon, MoveIcon, RotateCcwIcon, XIcon } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  readAmbientImageGeometry,
  readOrSeedAmbientImageGeometry,
  resetAmbientImageGeometry,
  writeAmbientImageGeometry,
  type AmbientImageGeometry,
} from "../ambientImageGeometry";
import {
  clampAmbientImageGeometryForPane,
  DEFAULT_GLOW_COLOR,
  KEYBOARD_MOVE_STEP,
  KEYBOARD_RESIZE_STEP,
  PANEL_MARGIN_PX,
  PRESET_WIDTH_PX,
  resolveAmbientImagePresetGeometry,
  resolveAmbientImagePanelAspectRatio,
  usablePane,
  type AmbientImagePaneSize,
} from "../ambientImagePanelLayout";
import { resolveAmbientImageSrc } from "../ambientImages";

/**
 * The floating ambient image panel.
 *
 * The panel is a decorative overlay with a small set of real controls: move,
 * resize, reset position and hide. Every control changes what the window shows
 * immediately. Move and resize also promote the layout from `preset` to
 * `custom`, because a dragged panel that snapped back to its corner on the next
 * render would be an inert control.
 *
 * Stacking rule, and the one deliberate difference from the Club Code source:
 * only the four handles take pointer events. The panel frame and the image stay
 * click-through, so an ambient image never blocks a button, a link or a menu
 * underneath it. The Club panel makes its whole frame interactive; that choice
 * is not portable to this runtime, where the layer is a full-window fixed
 * overlay above the app shell rather than a child of the message pane.
 *
 * The bounded sizing rules live in `ambientImagePanelLayout.ts`.
 */

type InteractionKind = "move" | "resize";

interface PointerInteraction {
  readonly kind: InteractionKind;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startGeometry: AmbientImageGeometry;
  readonly target: HTMLButtonElement;
}

function panelStyle(
  pane: AmbientImagePaneSize,
  geometry: AmbientImageGeometry,
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

function samePane(left: AmbientImagePaneSize | null, right: AmbientImagePaneSize): boolean {
  return left?.width === right.width && left.height === right.height;
}

/**
 * Measures the element that hosts the panel. The host is the full-window
 * ambient layer, so this reports the viewport and re-reports it on every
 * viewport change. The observer and the listener are released on unmount.
 */
function usePaneSize(element: HTMLElement | null): AmbientImagePaneSize | null {
  const [pane, setPane] = useState<AmbientImagePaneSize | null>(null);
  useLayoutEffect(() => {
    const host = element?.parentElement;
    if (!host) {
      setPane(null);
      return;
    }
    const measure = () => {
      const rect = host.getBoundingClientRect();
      const next = { width: rect.width, height: rect.height };
      setPane((current) => (samePane(current, next) ? current : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [element]);
  return pane;
}

/** Reports the reduced-motion preference and keeps following its changes. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

const HANDLE_CLASS =
  "pointer-events-auto absolute z-10 flex size-6 touch-none items-center justify-center rounded-md border border-white/20 bg-black/65 text-white hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white";

export function AmbientImagePanel({
  asset,
  layoutMode,
  presetSize,
  presetPlacement,
  glowEnabled,
  glowColor,
  glowOpacity,
  onRequestCustomLayout,
  onResetLayout,
  onDisable,
}: {
  readonly asset: AmbientImageAsset;
  readonly layoutMode: AmbientImageLayoutMode;
  readonly presetSize: AmbientImagePresetSize;
  readonly presetPlacement: AmbientImagePresetPlacement;
  readonly glowEnabled: boolean;
  readonly glowColor: AmbientImageGlowColor;
  readonly glowOpacity: number;
  readonly onRequestCustomLayout: () => void;
  readonly onResetLayout: () => void;
  readonly onDisable: () => void;
}) {
  const [panelElement, setPanelElement] = useState<HTMLElement | null>(null);
  const pane = usePaneSize(panelElement);
  const reducedMotion = usePrefersReducedMotion();
  const [storedGeometry, setStoredGeometry] = useState<AmbientImageGeometry | null>(() =>
    readAmbientImageGeometry(),
  );
  const [interacting, setInteracting] = useState(false);
  const geometryRef = useRef<AmbientImageGeometry | null>(storedGeometry);
  const interactionRef = useRef<PointerInteraction | null>(null);

  const aspectRatio = resolveAmbientImagePanelAspectRatio(asset.width / asset.height, pane);
  const presetGeometry = useMemo(
    () =>
      resolveAmbientImagePresetGeometry({
        pane,
        size: presetSize,
        placement: presetPlacement,
        aspectRatio,
      }),
    [aspectRatio, pane, presetPlacement, presetSize],
  );

  // A drag that started from the preset layout must be visible before the
  // settings write lands, so an active interaction counts as custom too.
  const custom = layoutMode === "custom" || interacting;

  // Seed the stored geometry from the preset the first time custom layout is
  // used, so the panel starts exactly where the preset already drew it.
  useEffect(() => {
    if (!custom || !usablePane(pane) || presetGeometry === null || storedGeometry !== null) return;
    const seeded = readOrSeedAmbientImageGeometry(() => presetGeometry) ?? presetGeometry;
    const next = clampAmbientImageGeometryForPane(seeded, pane, aspectRatio) ?? presetGeometry;
    geometryRef.current = next;
    setStoredGeometry(next);
  }, [aspectRatio, custom, pane, presetGeometry, storedGeometry]);

  // Every render re-clamps against the current pane. A window resize, a
  // sidebar change or a switch to a differently shaped image therefore
  // recovers an off-screen panel without any user action.
  const geometry = useMemo(() => {
    if (!usablePane(pane) || presetGeometry === null) return null;
    if (!custom) return presetGeometry;
    return (
      clampAmbientImageGeometryForPane(storedGeometry ?? presetGeometry, pane, aspectRatio) ??
      presetGeometry
    );
  }, [aspectRatio, custom, pane, presetGeometry, storedGeometry]);

  const commitGeometry = useCallback(
    (value: AmbientImageGeometry) => {
      if (!usablePane(pane)) return;
      const next = clampAmbientImageGeometryForPane(value, pane, aspectRatio);
      if (next === null) return;
      geometryRef.current = next;
      setStoredGeometry(next);
      writeAmbientImageGeometry(next);
    },
    [aspectRatio, pane],
  );

  const finishInteraction = useCallback(
    (pointerId?: number) => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      if (pointerId !== undefined && interaction.pointerId !== pointerId) return;
      interactionRef.current = null;
      if (interaction.target.hasPointerCapture(interaction.pointerId)) {
        interaction.target.releasePointerCapture(interaction.pointerId);
      }
      setInteracting(false);
      if (geometryRef.current) commitGeometry(geometryRef.current);
    },
    [commitGeometry],
  );

  // One window-level listener set for the whole panel. Pointer capture keeps
  // the events coming while the pointer leaves the handle, and `blur` ends a
  // drag that the window lost, so no interaction can survive unmount.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction || !usablePane(pane)) return;
      if (event.pointerId !== interaction.pointerId) return;
      const deltaX = (event.clientX - interaction.startClientX) / pane.width;
      const deltaY = (event.clientY - interaction.startClientY) / pane.height;
      const candidate =
        interaction.kind === "move"
          ? {
              ...interaction.startGeometry,
              x: interaction.startGeometry.x + deltaX,
              y: interaction.startGeometry.y + deltaY,
            }
          : { ...interaction.startGeometry, width: interaction.startGeometry.width + deltaX };
      const next = clampAmbientImageGeometryForPane(candidate, pane, aspectRatio);
      if (next === null) return;
      geometryRef.current = next;
      setStoredGeometry(next);
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
      const interaction = interactionRef.current;
      interactionRef.current = null;
      if (interaction?.target.hasPointerCapture(interaction.pointerId)) {
        interaction.target.releasePointerCapture(interaction.pointerId);
      }
      setInteracting(false);
    };
  }, [aspectRatio, finishInteraction, pane]);

  const promoteToCustom = useCallback(
    (startGeometry: AmbientImageGeometry) => {
      if (layoutMode === "custom") return;
      geometryRef.current = startGeometry;
      setStoredGeometry(startGeometry);
      writeAmbientImageGeometry(startGeometry);
      onRequestCustomLayout();
    },
    [layoutMode, onRequestCustomLayout],
  );

  const beginInteraction = useCallback(
    (kind: InteractionKind, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      const startGeometry = geometry;
      if (startGeometry === null) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      promoteToCustom(startGeometry);
      setInteracting(true);
      interactionRef.current = {
        kind,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startGeometry,
        target: event.currentTarget,
      };
    },
    [geometry, promoteToCustom],
  );

  const nudge = useCallback(
    (kind: InteractionKind, key: string) => {
      const startGeometry = geometry;
      if (startGeometry === null) return;
      const step =
        key === "ArrowLeft" || key === "ArrowUp"
          ? -1
          : key === "ArrowRight" || key === "ArrowDown"
            ? 1
            : 0;
      if (step === 0) return;
      promoteToCustom(startGeometry);
      if (kind === "resize") {
        commitGeometry({
          ...startGeometry,
          width: startGeometry.width + step * KEYBOARD_RESIZE_STEP,
        });
        return;
      }
      const horizontal = key === "ArrowLeft" || key === "ArrowRight";
      commitGeometry({
        ...startGeometry,
        x: startGeometry.x + (horizontal ? step * KEYBOARD_MOVE_STEP : 0),
        y: startGeometry.y + (horizontal ? 0 : step * KEYBOARD_MOVE_STEP),
      });
    },
    [commitGeometry, geometry, promoteToCustom],
  );

  /** Forgets the dragged position and returns the panel to its preset corner. */
  const recoverPosition = useCallback(() => {
    interactionRef.current = null;
    setInteracting(false);
    resetAmbientImageGeometry();
    geometryRef.current = null;
    setStoredGeometry(null);
    onResetLayout();
  }, [onResetLayout]);

  const handleKey = (kind: InteractionKind) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Home") {
      event.preventDefault();
      recoverPosition();
      return;
    }
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault();
    nudge(kind, event.key);
  };

  const adjustable = geometry !== null && usablePane(pane);
  const color = glowColor === "auto" ? DEFAULT_GLOW_COLOR : glowColor;
  return (
    <div
      ref={setPanelElement}
      data-testid="ambient-image-panel"
      data-ambient-image-layout={custom ? "custom" : "preset"}
      data-ambient-image-reduced-motion={reducedMotion ? "true" : "false"}
      // No pointer-events rule here: the frame inherits `none` from the layer,
      // so only the handles below can be clicked.
      className={
        reducedMotion
          ? "absolute overflow-hidden rounded-xl border border-border shadow-lg"
          : "absolute overflow-hidden rounded-xl border border-border shadow-lg transition-[box-shadow,opacity] duration-200"
      }
      style={{
        ...(adjustable
          ? panelStyle(pane, geometry, aspectRatio)
          : {
              right: PANEL_MARGIN_PX,
              bottom: PANEL_MARGIN_PX,
              width: PRESET_WIDTH_PX[presetSize],
            }),
        opacity: 0.8,
        boxShadow: glowEnabled
          ? `0 0 28px color-mix(in srgb, ${color} ${Math.round(glowOpacity * 100)}%, transparent)`
          : undefined,
      }}
    >
      <img
        key={asset.id}
        src={resolveAmbientImageSrc(asset)}
        alt=""
        decoding="async"
        draggable={false}
        aria-hidden="true"
        data-ambient-image-id={asset.id}
        width={asset.width}
        height={asset.height}
        // GIFs animate natively here; the decode budget was bounded at upload.
        className="block h-full w-full object-contain"
      />
      {adjustable ? (
        <>
          <button
            type="button"
            className={`${HANDLE_CLASS} top-1 left-1 cursor-move`}
            data-testid="ambient-image-move-handle"
            aria-label="Move the ambient image. Use the arrow keys for small steps."
            title="Drag to move. Arrow keys move in small steps. Home resets the position."
            onPointerDown={(event) => beginInteraction("move", event)}
            onKeyDown={handleKey("move")}
          >
            <MoveIcon className="size-3" />
          </button>
          <button
            type="button"
            className={`${HANDLE_CLASS} top-1 right-1`}
            data-testid="ambient-image-hide-button"
            aria-label="Hide the ambient image"
            title="Hide the ambient image"
            onClick={onDisable}
          >
            <XIcon className="size-3" />
          </button>
          <button
            type="button"
            className={`${HANDLE_CLASS} bottom-1 left-1`}
            data-testid="ambient-image-reset-button"
            aria-label="Reset the ambient image position"
            title="Reset the ambient image position"
            onClick={recoverPosition}
          >
            <RotateCcwIcon className="size-3" />
          </button>
          <button
            type="button"
            className={`${HANDLE_CLASS} right-1 bottom-1 cursor-nwse-resize`}
            data-testid="ambient-image-resize-handle"
            aria-label="Resize the ambient image. Use the arrow keys for small steps."
            title="Drag to resize. Arrow keys resize in small steps. Home resets the position."
            onPointerDown={(event) => beginInteraction("resize", event)}
            onKeyDown={handleKey("resize")}
          >
            <Maximize2Icon className="size-3" />
          </button>
        </>
      ) : null}
    </div>
  );
}
