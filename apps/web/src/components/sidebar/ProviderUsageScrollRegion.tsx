import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/utils";
export const PROVIDER_USAGE_HEIGHT_STORAGE_KEY = "cafe-code:provider-usage-height:v1";
export const DEFAULT_PROVIDER_USAGE_HEIGHT_PX = 448;
export const MIN_PROVIDER_USAGE_HEIGHT_PX = 128;
export const MIN_THREAD_REGION_HEIGHT_PX = 192;

export function clampProviderUsageHeight(height: number, viewportHeight: number): number {
  const maximum = Math.max(
    MIN_PROVIDER_USAGE_HEIGHT_PX,
    viewportHeight - MIN_THREAD_REGION_HEIGHT_PX,
  );
  return Math.round(Math.min(maximum, Math.max(MIN_PROVIDER_USAGE_HEIGHT_PX, height)));
}

function readStoredProviderUsageHeight(): number {
  if (typeof window === "undefined") return DEFAULT_PROVIDER_USAGE_HEIGHT_PX;
  try {
    const stored = Number.parseInt(
      window.localStorage.getItem(PROVIDER_USAGE_HEIGHT_STORAGE_KEY) ?? "",
      10,
    );
    return Number.isFinite(stored) ? stored : DEFAULT_PROVIDER_USAGE_HEIGHT_PX;
  } catch {
    return DEFAULT_PROVIDER_USAGE_HEIGHT_PX;
  }
}

function currentViewportHeight(): number {
  return typeof window === "undefined" ? 800 : window.innerHeight;
}

export function ProviderUsageScrollRegion({ children }: { readonly children: ReactNode }) {
  const isMobile = useIsMobile();
  const regionRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ readonly pointerY: number; readonly height: number } | null>(null);
  const [height, setHeight] = useState(readStoredProviderUsageHeight);

  useEffect(() => {
    const clampToViewport = () => {
      setHeight((current) => clampProviderUsageHeight(current, window.innerHeight));
    };
    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  const persistHeight = useCallback((nextHeight: number) => {
    try {
      window.localStorage.setItem(PROVIDER_USAGE_HEIGHT_STORAGE_KEY, String(nextHeight));
    } catch {
      // Resizing remains available when browser privacy settings disable local storage.
    }
  }, []);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      dragRef.current = {
        pointerY: event.clientY,
        height: regionRef.current?.getBoundingClientRect().height ?? height,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [height],
  );

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setHeight(
      clampProviderUsageHeight(drag.height + event.clientY - drag.pointerY, window.innerHeight),
    );
  }, []);

  const finishPointerResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setHeight((current) => {
        persistHeight(current);
        return current;
      });
    },
    [persistHeight],
  );

  const handleSeparatorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const delta = event.key === "ArrowUp" ? -32 : event.key === "ArrowDown" ? 32 : 0;
      if (delta === 0) return;
      event.preventDefault();
      setHeight((current) => {
        const next = clampProviderUsageHeight(current + delta, window.innerHeight);
        persistHeight(next);
        return next;
      });
    },
    [persistHeight],
  );

  const regionStyle = {
    "--provider-usage-height": `${height}px`,
  } as CSSProperties;

  return (
    <div className="mx-2 mb-1 shrink-0 group-data-[collapsible=icon]:hidden" style={regionStyle}>
      <section
        ref={regionRef}
        aria-label="Provider usage limits"
        className={cn(
          "overflow-y-auto overscroll-contain rounded-lg border border-sidebar-border/70 bg-sidebar-accent/25 p-2.5",
          isMobile
            ? "max-h-[min(30svh,14rem)]"
            : "max-h-[min(var(--provider-usage-height),calc(100svh-12rem))]",
        )}
        data-slot="provider-usage-widget"
      >
        {children}
      </section>
      {!isMobile ? (
        <div
          aria-label="Resize provider usage and thread sections"
          aria-orientation="horizontal"
          aria-valuemax={Math.max(
            MIN_PROVIDER_USAGE_HEIGHT_PX,
            currentViewportHeight() - MIN_THREAD_REGION_HEIGHT_PX,
          )}
          aria-valuemin={MIN_PROVIDER_USAGE_HEIGHT_PX}
          aria-valuenow={height}
          className="group/resizer relative flex h-2 cursor-row-resize touch-none items-center justify-center"
          data-slot="provider-usage-resizer"
          onKeyDown={handleSeparatorKeyDown}
          onPointerCancel={finishPointerResize}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerResize}
          role="separator"
          tabIndex={0}
        >
          <span className="h-px w-full bg-sidebar-border/70 transition-colors group-hover/resizer:bg-sidebar-ring group-focus-visible/resizer:bg-sidebar-ring" />
        </div>
      ) : null}
    </div>
  );
}
