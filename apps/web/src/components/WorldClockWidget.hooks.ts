import { useEffect, useState, useSyncExternalStore } from "react";

import {
  readCafeDocumentVisibilitySnapshot,
  subscribeCafeDocumentVisibility,
} from "../documentVisibility";
import {
  getServerWorldClockWeatherConsent,
  getWorldClockWeatherConsent,
  subscribeWorldClockWeatherConsent,
} from "../worldClockWeatherConsent";
import { type WorldClockPanelBounds } from "../worldClockPanelGeometry";
import { getDesktopTitlebarInset, getWindowControlsOverlay } from "../lib/windowControlsOverlay";

export function useDocumentVisible(): boolean {
  return (
    useSyncExternalStore(
      subscribeCafeDocumentVisibility,
      readCafeDocumentVisibilitySnapshot,
      () => "hidden",
    ) === "visible"
  );
}

/** Read this renderer's own weather consent. It is never a synced setting. */
export function useWorldClockWeatherConsent(): boolean {
  return useSyncExternalStore(
    subscribeWorldClockWeatherConsent,
    getWorldClockWeatherConsent,
    getServerWorldClockWeatherConsent,
  );
}

export function readViewportBounds(): WorldClockPanelBounds {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return {
    // `visualViewport` is the correct box on mobile: it excludes the on-screen
    // keyboard and the collapsing browser chrome, so the panel stays reachable.
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
    topInset: getDesktopTitlebarInset(),
  };
}

export function useViewportBounds(): WorldClockPanelBounds {
  const [bounds, setBounds] = useState(readViewportBounds);
  useEffect(() => {
    const update = () => {
      const next = readViewportBounds();
      // Deduplicated so an unrelated resize event cannot re-render the panel.
      setBounds((current) =>
        current.width === next.width &&
        current.height === next.height &&
        current.topInset === next.topInset
          ? current
          : next,
      );
    };
    update();
    const overlay = getWindowControlsOverlay();
    overlay?.addEventListener("geometrychange", update);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      overlay?.removeEventListener("geometrychange", update);
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return bounds;
}

/**
 * One-second clock tick that exists only while the panel can be seen.
 *
 * A hidden document, a disabled panel, or a collapsed panel stops the interval
 * entirely rather than throttling it, so a background window does no per-second
 * render work while long provider turns are streaming.
 */
export function useVisibleClockTick(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    // Re-read immediately: a panel that was hidden for an hour must not show
    // the instant it was hidden at for up to a second after it returns.
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}
