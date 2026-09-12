import { isWindowsPlatform } from "./utils";

const WCO_CLASS_NAME = "wco";

interface WindowControlsOverlayLike {
  readonly visible: boolean;
  getTitlebarAreaRect?(): { readonly y: number; readonly height: number };
  addEventListener(type: "geometrychange", listener: EventListener): void;
  removeEventListener(type: "geometrychange", listener: EventListener): void;
}

interface NavigatorWithWindowControlsOverlay extends Navigator {
  readonly windowControlsOverlay?: WindowControlsOverlayLike;
}

export function getWindowControlsOverlay(): WindowControlsOverlayLike | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  return (navigator as NavigatorWithWindowControlsOverlay).windowControlsOverlay ?? null;
}

export function getDesktopTitlebarInset(): number {
  if (
    typeof window === "undefined" ||
    !window.desktopBridge ||
    !isWindowsPlatform(navigator.platform)
  )
    return 0;
  const overlay = getWindowControlsOverlay();
  if (!overlay?.visible) return 0;
  const rect = overlay.getTitlebarAreaRect?.();
  const bottom = rect ? rect.y + rect.height : 0;
  // Match Cafe's native caption band when the overlay has no usable geometry.
  return Number.isFinite(bottom) && bottom > 0 ? Math.ceil(bottom) : 40;
}

export function syncDocumentWindowControlsOverlayClass(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }

  const overlay = getWindowControlsOverlay();
  const update = () => {
    document.documentElement.classList.toggle(WCO_CLASS_NAME, overlay !== null && overlay.visible);
  };

  update();
  if (!overlay) {
    return () => {};
  }

  overlay.addEventListener("geometrychange", update);
  return () => {
    overlay.removeEventListener("geometrychange", update);
  };
}
