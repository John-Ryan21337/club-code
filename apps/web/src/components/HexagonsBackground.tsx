import { useEffect, useMemo, useRef } from "react";

import { parseStoredHexagonsBackground } from "../hexagonsBackgroundPreset";
import { useSettings } from "../hooks/useSettings";
import {
  createHexagonBackground,
  type HexagonsBackgroundController,
  type HexagonsBackgroundState,
  type HexagonsDisplayInfo,
} from "../vendor/the-hexagons-runtime-club-code/runtime/portable.js";

const ACTIVE_ATTRIBUTE = "data-cafe-hexagons-background";
const MANUSCRIPT_OPACITY_PROPERTY = "--cafe-ambient-background-manuscript-opacity";
const SIDEBAR_OPACITY_PROPERTY = "--cafe-ambient-background-sidebar-opacity";

function opacityPercentage(opacity: number): string {
  return `${opacity * 100}%`;
}

function currentDisplayInfo(): HexagonsDisplayInfo {
  return {
    id: "browser-display",
    width: Math.max(1, window.screen?.width || window.innerWidth),
    height: Math.max(1, window.screen?.height || window.innerHeight),
    scaleFactor: Math.max(0.5, window.devicePixelRatio || 1),
  };
}

function setDataValue(container: HTMLElement, key: string, value: string): void {
  if (container.dataset[key] !== value) {
    container.dataset[key] = value;
  }
}

function publishState(container: HTMLElement, state: HexagonsBackgroundState): void {
  setDataValue(container, "hexagonsRenderer", state.activeRenderer);
  setDataValue(container, "hexagonsAnimationAllowed", state.animationAllowed ? "true" : "false");
  setDataValue(container, "hexagonsTileCount", String(state.tileCount));
  if (state.fallbackReason) {
    setDataValue(container, "hexagonsFallbackReason", state.fallbackReason);
  } else if (container.dataset.hexagonsFallbackReason !== undefined) {
    delete container.dataset.hexagonsFallbackReason;
  }
}

export function HexagonsBackground() {
  const enabled = useSettings((settings) => settings.hexagonsBackgroundEnabled);
  const presetJson = useSettings((settings) => settings.hexagonsBackgroundPresetJson);
  const manuscriptOpacity = useSettings((settings) => settings.ambientBackgroundManuscriptOpacity);
  const sidebarOpacity = useSettings((settings) => settings.ambientBackgroundSidebarOpacity);
  const continueBackgroundAnimations = useSettings(
    (settings) => settings.continueBackgroundAnimations,
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const preset = useMemo(() => parseStoredHexagonsBackground(presetJson), [presetJson]);
  const active = enabled && preset !== null;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(MANUSCRIPT_OPACITY_PROPERTY, opacityPercentage(manuscriptOpacity));
    root.style.setProperty(SIDEBAR_OPACITY_PROPERTY, opacityPercentage(sidebarOpacity));
    return () => {
      root.style.removeProperty(MANUSCRIPT_OPACITY_PROPERTY);
      root.style.removeProperty(SIDEBAR_OPACITY_PROPERTY);
    };
  }, [manuscriptOpacity, sidebarOpacity]);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || container === null || preset === null) return;

    let cancelled = false;
    let controller: HexagonsBackgroundController | null = null;
    container.dataset.hexagonsStatus = "loading";

    void createHexagonBackground({
      container,
      position: "absolute",
      zIndex: 0,
      pointerTarget: window,
      getDisplayInfo: async () => currentDisplayInfo(),
      settings: {
        ...preset.document.settings,
        enabled: true,
        fallingEffectsEnabled: false,
        renderer: "auto",
        reducedMotion: "system",
        continueBackgroundAnimations,
      },
      // The runtime reports every completed frame. publishState compares the
      // small diagnostic tuple before touching the DOM, so renderer/focus
      // transitions stay truthful without generating per-frame mutations.
      onState: (state) => publishState(container, state),
    })
      .then((nextController) => {
        if (cancelled) {
          nextController.destroy();
          return;
        }
        controller = nextController;
        container.dataset.hexagonsStatus = "ready";
        publishState(container, nextController.getState());
        document.documentElement.setAttribute(ACTIVE_ATTRIBUTE, "true");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE);
        container.replaceChildren();
        container.dataset.hexagonsStatus = "error";
        container.dataset.hexagonsError =
          error instanceof Error ? error.message : "The background renderer could not start.";
        console.error("[HEXAGONS_BACKGROUND] Renderer start failed", error);
      });

    return () => {
      cancelled = true;
      document.documentElement.removeAttribute(ACTIVE_ATTRIBUTE);
      controller?.destroy();
      container.replaceChildren();
    };
  }, [active, continueBackgroundAnimations, preset]);

  if (!active) return null;

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden [contain:strict]"
      data-hexagons-background-name={preset.document.name}
      data-testid="hexagons-background"
    />
  );
}
