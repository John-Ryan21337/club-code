import type {
  AmbientImageAsset,
  AmbientImagePresentationMode,
  AmbientMediaPresetSize,
} from "@cafecode/contracts/settings";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";

import { resolveAmbientImageSrc } from "../../ambientImages";
import { cn } from "~/lib/utils";

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

interface PaneSize {
  readonly width: number;
  readonly height: number;
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
      })
    ) {
      return;
    }
    const delay = Math.min(3_600, Math.max(3, cycleSeconds)) * 1_000;
    const interval = window.setInterval(
      () => setCycleIndex((current) => (current + 1) % cycle.length),
      delay,
    );
    return () => window.clearInterval(interval);
  }, [continueBackgroundAnimations, cycle.length, cycleSeconds, documentInactive]);

  const suspendAnimation =
    activeAsset.mimeType === "image/gif" &&
    (reducedMotion || (!continueBackgroundAnimations && documentInactive));
  const color = glowColor === "auto" ? "#7dd3fc" : glowColor;
  const theater = presentationMode === "theater";

  return (
    <section
      ref={setPanelElement}
      aria-label="Ambient image"
      className={cn(
        "pointer-events-auto absolute z-20 overflow-hidden border border-white/15 bg-black/30 shadow-lg",
        theater ? "inset-0 rounded-none" : "rounded-xl",
        !theater && (preset.placement === "bottom-left" ? "left-3" : "right-3"),
      )}
      data-ambient-image-layout={theater ? "theater" : "preset"}
      style={{
        ...(theater
          ? { inset: 0 }
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
            className={cn("relative block w-full object-contain", theater ? "h-full" : "h-auto")}
            width={activeAsset.width}
            height={activeAsset.height}
            style={theater ? undefined : { maxHeight: "min(50vh, 420px)" }}
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
