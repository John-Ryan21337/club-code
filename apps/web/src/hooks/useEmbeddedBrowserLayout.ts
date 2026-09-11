import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent,
} from "react";
import { getDesktopTitlebarInset, getWindowControlsOverlay } from "../lib/windowControlsOverlay";

const DOCK_HEIGHT = 48;
type Rect = { left: number; top: number; width: number; height: number };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export function useEmbeddedBrowserLayout(
  visible: boolean,
  hasTabs: boolean,
  suspend: (hidden: boolean) => void,
) {
  const [mode, setMode] = useState<"floating" | "split" | "maximized">("floating");
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [titlebarInset, setTitlebarInset] = useState(getDesktopTitlebarInset);
  const [rect, setRect] = useState<Rect>({ left: 32, top: 32, width: 1000, height: 720 });
  const [split, setSplit] = useState(50);
  const interacting = useRef(false);
  const drag = useRef<{
    x: number;
    y: number;
    rect: Rect;
    kind: "move" | "resize" | "split";
  } | null>(null);
  const suspendRef = useRef(suspend);
  suspendRef.current = suspend;
  const height = Math.max(1, size.height - (hasTabs ? DOCK_HEIGHT : 0));
  const topInset = Math.min(titlebarInset, Math.max(0, height - 1));
  const contentHeight = Math.max(1, height - topInset);
  const stacked = size.width < 1000;
  const floating: Rect = {
    width: clamp(rect.width, Math.min(480, size.width), size.width),
    height: clamp(rect.height, Math.min(360, contentHeight), contentHeight),
    left: 0,
    top: 0,
  };
  floating.left = clamp(rect.left, 0, size.width - floating.width);
  floating.top = clamp(rect.top, topInset, height - floating.height);
  const splitPosition = stacked
    ? topInset + Math.round((contentHeight * split) / 100)
    : Math.round((size.width * split) / 100);
  const panel: Rect =
    mode === "floating"
      ? floating
      : mode === "maximized"
        ? { left: 0, top: topInset, width: size.width, height: contentHeight }
        : stacked
          ? {
              left: 0,
              top: splitPosition + 4,
              width: size.width,
              height: height - splitPosition - 4,
            }
          : {
              left: splitPosition + 4,
              top: topInset,
              width: size.width - splitPosition - 4,
              height: contentHeight,
            };

  useEffect(() => {
    const resize = () => {
      setSize({ width: window.innerWidth, height: window.innerHeight });
      setTitlebarInset(getDesktopTitlebarInset());
    };
    const overlay = getWindowControlsOverlay();
    overlay?.addEventListener("geometrychange", resize);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      overlay?.removeEventListener("geometrychange", resize);
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement.style;
    const active = visible && mode === "split";
    root.setProperty(
      "--club-browser-chat-width",
      active && !stacked ? `${splitPosition - 4}px` : "100%",
    );
    root.setProperty(
      "--club-browser-chat-height",
      `${active && stacked ? splitPosition - 4 : height}px`,
    );
    return () => {
      root.removeProperty("--club-browser-chat-width");
      root.removeProperty("--club-browser-chat-height");
    };
  }, [height, mode, splitPosition, stacked, visible]);

  const finish = () => {
    if (!drag.current) return;
    drag.current = null;
    interacting.current = false;
    suspendRef.current(false);
  };
  useEffect(() => {
    window.addEventListener("blur", finish);
    return () => window.removeEventListener("blur", finish);
  }, []);

  const controls = (kind: "move" | "resize" | "split") => ({
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (
        kind === "split" ||
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      )
        return;
      event.preventDefault();
      const dx = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
      const dy = event.key === "ArrowUp" ? -16 : event.key === "ArrowDown" ? 16 : 0;
      setRect(
        kind === "move"
          ? { ...floating, left: floating.left + dx, top: floating.top + dy }
          : { ...floating, width: floating.width + dx, height: floating.height + dy },
      );
    },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, y: event.clientY, rect: floating, kind };
      interacting.current = true;
      suspendRef.current(true);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      const start = drag.current;
      if (!start || start.kind !== kind) return;
      if (kind === "split") {
        setSplit(
          clamp(
            (stacked ? (event.clientY - topInset) / contentHeight : event.clientX / size.width) *
              100,
            25,
            75,
          ),
        );
      } else if (kind === "move") {
        setRect({
          ...start.rect,
          left: start.rect.left + event.clientX - start.x,
          top: start.rect.top + event.clientY - start.y,
        });
      } else {
        setRect({
          ...start.rect,
          width: start.rect.width + event.clientX - start.x,
          height: start.rect.height + event.clientY - start.y,
        });
      }
    },
    onPointerUp: finish,
    onPointerCancel: finish,
    onLostPointerCapture: finish,
  });
  return {
    mode,
    setMode,
    panel,
    stacked,
    split,
    setSplit,
    splitPosition,
    height,
    topInset,
    interacting,
    controls,
  };
}
