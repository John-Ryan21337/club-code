import {
  ChevronDownIcon,
  ChevronUpIcon,
  Clock3Icon,
  GripHorizontalIcon,
  Maximize2Icon,
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { useLocalStorage } from "../hooks/useLocalStorage";
import { useSettings } from "../hooks/useSettings";
import { normalizeAccentColor } from "../themeAccent";
import {
  WORLD_WEATHER_ATTRIBUTION_URL,
  WORLD_WEATHER_CACHE_TTL_MS,
  WORLD_WEATHER_FAILURE_RETRY_MS,
  type WorldWeatherClient,
  worldWeatherClient,
  worldWeatherErrorDiscriminator,
} from "../worldWeather";
import {
  clampWorldClockPanelGeometry,
  WORLD_CLOCK_PANEL_COLLAPSED_HEIGHT,
  WORLD_CLOCK_PANEL_DEFAULT_GEOMETRY,
  WORLD_CLOCK_PANEL_STORAGE_KEY,
  WorldClockPanelGeometrySchema,
  type WorldClockPanelGeometry,
} from "../worldClockPanelGeometry";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";
import { ClockCard, type WeatherView } from "./WorldClockWidget.parts";
import {
  useDocumentVisible,
  useViewportBounds,
  useVisibleClockTick,
  useWorldClockWeatherConsent,
} from "./WorldClockWidget.hooks";

interface PointerInteraction {
  readonly kind: "move" | "resize";
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly geometry: WorldClockPanelGeometry;
}

export interface WorldClockWidgetProps {
  /** Injected in tests so no test can reach a real network endpoint. */
  readonly weatherClient?: WorldWeatherClient;
}

/**
 * Optional movable world clock panel.
 *
 * Placement in the app: one fixed `pointer-events: none` overlay at z-40, the
 * same band the ambiance canvas uses, so the panel floats above app content but
 * below z-50 dialogs, popovers and toasts. Only the panel itself takes pointer
 * events, so the overlay cannot block a click anywhere else.
 *
 * Accent colour: the panel follows the existing Cafe theme tokens. It resolves
 * the ambiance colour, then the Appearance accent colour, then the sidebar
 * colour, matching the order `AmbianceSettings` already uses; with none set it
 * inherits `--cafe-sidebar-accent` from the stylesheet. Club Code drives the
 * same variable from a live Matrix palette frame store. Cafe has no equivalent
 * reactive colour source today, so this adoption deliberately ships no inert
 * setting for it: if such a store is added later, publish into
 * `--cafe-world-clock-accent` and every style below follows it with no other
 * change.
 */
export function WorldClockWidget({
  weatherClient: selectedWeatherClient = worldWeatherClient,
}: WorldClockWidgetProps) {
  const enabled = useSettings((settings) => settings.worldClockEnabled);
  const style = useSettings((settings) => settings.worldClockStyle);
  const locationIds = useSettings((settings) => settings.worldClockLocationIds);
  const timestampFormat = useSettings((settings) => settings.timestampFormat);
  const ambianceColor = useSettings((settings) => settings.ambianceColor);
  const appAccentColor = useSettings((settings) => settings.appAccentColor);
  const themeAccentColor = useSettings((settings) => settings.themeAccentColor);
  // Weather consent is renderer-local, never a synced setting. See
  // `worldClockWeatherConsent.ts` for why it is outside `ClientSettings`.
  const showWeather = useWorldClockWeatherConsent();
  const panelBounds = useViewportBounds();
  const documentVisible = useDocumentVisible();
  const [storedGeometry, setStoredGeometry] = useLocalStorage(
    WORLD_CLOCK_PANEL_STORAGE_KEY,
    WORLD_CLOCK_PANEL_DEFAULT_GEOMETRY,
    WorldClockPanelGeometrySchema,
  );
  // Live geometry holds the in-progress drag or resize so the persisted value
  // is written once, at the end of the gesture, instead of once per pointer move.
  const [liveGeometry, setLiveGeometry] = useState<WorldClockPanelGeometry | null>(null);
  const [weatherView, setWeatherView] = useState<WeatherView>({
    key: "",
    snapshot: null,
    status: "idle",
  });
  const panelRef = useRef<HTMLElement>(null);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const pendingGeometryRef = useRef<WorldClockPanelGeometry | null>(null);
  const animationFrameRef = useRef(0);
  const panelId = useId();
  const weatherKey = locationIds.join(",");
  const active = enabled && documentVisible && !storedGeometry.collapsed;
  const now = useVisibleClockTick(active);
  const accentColor =
    normalizeAccentColor(ambianceColor) ??
    normalizeAccentColor(appAccentColor) ??
    normalizeAccentColor(themeAccentColor);
  const renderedGeometry = clampWorldClockPanelGeometry(
    liveGeometry ?? storedGeometry,
    panelBounds,
  );
  const panelStyle: CSSProperties = {
    left: renderedGeometry.x,
    top: renderedGeometry.y,
    width: renderedGeometry.width,
    height: renderedGeometry.collapsed
      ? Math.min(WORLD_CLOCK_PANEL_COLLAPSED_HEIGHT, renderedGeometry.height)
      : renderedGeometry.height,
    // Unset when no accent is configured, so the stylesheet default applies.
    ...(accentColor ? { ["--cafe-world-clock-accent" as string]: accentColor } : {}),
  };

  const updateGeometry = useCallback(
    (geometry: WorldClockPanelGeometry) => {
      setStoredGeometry(clampWorldClockPanelGeometry(geometry, panelBounds));
    },
    [panelBounds, setStoredGeometry],
  );

  /**
   * Weather polling.
   *
   * Four independent gates must all hold: the panel is enabled, this renderer
   * consented, the document is visible, and the panel is not collapsed. Losing
   * any of them aborts the in-flight request and clears the view, so a hidden
   * or collapsed panel performs no network work at all.
   *
   * The next poll is scheduled from the result, not from a fixed timer: a fresh
   * reading waits the cache lifetime, and a stale or failed reading waits the
   * failure cooldown. The client itself also coalesces and caches, so a remount
   * during that window issues no new request.
   */
  useEffect(() => {
    if (!enabled || !showWeather || !documentVisible || storedGeometry.collapsed) {
      setWeatherView((current) =>
        current.status === "idle" ? current : { key: "", snapshot: null, status: "idle" },
      );
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failureReported = false;
    const run = () => {
      if (cancelled) return;
      // Keep a previous snapshot on screen while refreshing the same selection;
      // only a changed selection falls back to the loading state.
      setWeatherView((current) =>
        current.key === weatherKey && current.snapshot !== null
          ? current
          : { key: weatherKey, snapshot: null, status: "loading" },
      );
      void selectedWeatherClient
        .read(locationIds, { signal: abortController.signal })
        .then((snapshot) => {
          if (cancelled) return;
          failureReported = false;
          setWeatherView({
            key: weatherKey,
            snapshot,
            status: snapshot.stale ? "stale" : "ready",
          });
          timer = setTimeout(
            run,
            snapshot.stale ? WORLD_WEATHER_FAILURE_RETRY_MS : WORLD_WEATHER_CACHE_TTL_MS,
          );
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          // One diagnostic per failure run, and only the fixed category, so a
          // repeating outage cannot flood the console or log response text.
          if (!failureReported) {
            console.error("[WORLD_WEATHER] read failed", worldWeatherErrorDiscriminator(error));
            failureReported = true;
          }
          setWeatherView({ key: weatherKey, snapshot: null, status: "unavailable" });
          timer = setTimeout(run, WORLD_WEATHER_FAILURE_RETRY_MS);
        });
    };

    queueMicrotask(run);
    return () => {
      cancelled = true;
      abortController.abort();
      if (timer !== null) clearTimeout(timer);
    };
  }, [
    documentVisible,
    enabled,
    locationIds,
    selectedWeatherClient,
    showWeather,
    storedGeometry.collapsed,
    weatherKey,
  ]);

  /**
   * Pointer drag and resize.
   *
   * Listeners live on the window, so a fast drag that leaves the panel keeps
   * tracking. Each move writes into a ref and requests at most one animation
   * frame, which keeps a drag at one state update per frame instead of one per
   * pointer event. `blur` ends the gesture because a pointer release outside
   * the window never reaches this document.
   */
  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (interaction === null || interaction.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      pendingGeometryRef.current = clampWorldClockPanelGeometry(
        interaction.kind === "move"
          ? {
              ...interaction.geometry,
              x: interaction.geometry.x + deltaX,
              y: interaction.geometry.y + deltaY,
            }
          : {
              ...interaction.geometry,
              width: interaction.geometry.width + deltaX,
              height: interaction.geometry.height + deltaY,
            },
        panelBounds,
      );
      if (animationFrameRef.current !== 0) return;
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = 0;
        if (pendingGeometryRef.current !== null) setLiveGeometry(pendingGeometryRef.current);
      });
    };
    const finish = (event?: PointerEvent) => {
      if (
        event &&
        interactionRef.current !== null &&
        interactionRef.current.pointerId !== event.pointerId
      ) {
        return;
      }
      interactionRef.current = null;
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
      const geometry = pendingGeometryRef.current;
      pendingGeometryRef.current = null;
      if (geometry !== null) updateGeometry(geometry);
      setLiveGeometry(null);
    };
    const finishOnBlur = () => finish();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    window.addEventListener("blur", finishOnBlur);
    return () => {
      window.cancelAnimationFrame(animationFrameRef.current);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      window.removeEventListener("blur", finishOnBlur);
    };
  }, [panelBounds, updateGeometry]);

  const beginInteraction = (
    kind: PointerInteraction["kind"],
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const panel = panelRef.current;
    if (!panel) return;
    // Prevent the default so a drag never selects text, then restore the
    // focus that the default would have given: the same handle is the keyboard
    // control, so a pointer user who then reaches for the arrow keys must find
    // it focused.
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Start from the measured rect, not the stored value, so a gesture that
    // begins after a viewport clamp does not jump back to the stored position.
    const rect = panel.getBoundingClientRect();
    const geometry = clampWorldClockPanelGeometry(
      {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: storedGeometry.height,
        collapsed: storedGeometry.collapsed,
      },
      panelBounds,
    );
    pendingGeometryRef.current = geometry;
    setLiveGeometry(geometry);
    interactionRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      geometry,
    };
  };

  /**
   * Keyboard equivalent of the drag and resize handles.
   *
   * Both handles are real focusable buttons, so the panel is fully operable
   * without a pointer. Shift selects a 1px step for fine placement.
   */
  const adjustGeometryWithKeyboard = (
    kind: PointerInteraction["kind"],
    key: string,
    fineAdjustment: boolean,
  ): boolean => {
    if (!key.startsWith("Arrow")) return false;
    const delta = fineAdjustment ? 1 : 8;
    const horizontal = key === "ArrowLeft" ? -delta : key === "ArrowRight" ? delta : 0;
    const vertical = key === "ArrowUp" ? -delta : key === "ArrowDown" ? delta : 0;
    setStoredGeometry((current) => {
      const geometry = clampWorldClockPanelGeometry(current, panelBounds);
      return clampWorldClockPanelGeometry(
        kind === "move"
          ? {
              ...geometry,
              x: geometry.x + horizontal,
              y: geometry.y + vertical,
            }
          : {
              ...geometry,
              width: geometry.width + horizontal,
              height: geometry.height + vertical,
            },
        panelBounds,
      );
    });
    return true;
  };

  if (!enabled) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-40" data-world-clock-overlay>
      <section
        ref={panelRef}
        aria-labelledby={panelId}
        className={cn(
          "cafe-world-clock-widget pointer-events-auto absolute flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/55 bg-transparent text-foreground [-webkit-app-region:no-drag]",
          `cafe-world-clock-${style}`,
        )}
        data-collapsed={renderedGeometry.collapsed ? "true" : "false"}
        data-cafe-window-no-drag="true"
        style={panelStyle}
      >
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border/45 px-1.5">
          <Button
            aria-label="Move world clock. Use the arrow keys. Use Shift and an arrow key for a smaller step."
            className="cursor-grab touch-none active:cursor-grabbing"
            size="icon-xs"
            variant="ghost"
            onKeyDown={(event) => {
              if (adjustGeometryWithKeyboard("move", event.key, event.shiftKey)) {
                event.preventDefault();
              }
            }}
            onPointerDown={(event) => beginInteraction("move", event)}
          >
            <GripHorizontalIcon />
          </Button>
          <Clock3Icon className="ml-0.5 size-3.5 text-[var(--cafe-world-clock-accent)]" />
          <h2 id={panelId} className="truncate text-xs font-semibold uppercase tracking-[0.13em]">
            World clock
          </h2>
          {showWeather && weatherView.status === "stale" ? (
            <span className="ml-auto text-[9px] uppercase tracking-wide text-amber-500">
              stale weather
            </span>
          ) : (
            <span className="ml-auto" />
          )}
          <Button
            aria-controls={`${panelId}-content`}
            aria-expanded={!renderedGeometry.collapsed}
            aria-label={renderedGeometry.collapsed ? "Expand world clock" : "Collapse world clock"}
            size="icon-xs"
            variant="ghost"
            onClick={() =>
              setStoredGeometry((current) =>
                clampWorldClockPanelGeometry(
                  { ...current, collapsed: !current.collapsed },
                  panelBounds,
                ),
              )
            }
          >
            {renderedGeometry.collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
          </Button>
        </header>

        {!renderedGeometry.collapsed ? (
          <>
            <div
              id={`${panelId}-content`}
              className="cafe-world-clock-grid min-h-0 flex-1 overflow-y-auto p-2"
            >
              {locationIds.map((locationId) => (
                <ClockCard
                  key={locationId}
                  locationId={locationId}
                  now={now}
                  showWeather={showWeather}
                  style={style}
                  timestampFormat={timestampFormat}
                  weatherView={
                    // A selection change invalidates the previous snapshot, so
                    // a city can never show another city's reading.
                    weatherView.key === weatherKey
                      ? weatherView
                      : { key: weatherKey, snapshot: null, status: "loading" }
                  }
                />
              ))}
            </div>
            {showWeather ? (
              <footer className="shrink-0 border-t border-border/35 px-2 py-1 text-right text-[9px] text-muted-foreground">
                Weather by{" "}
                <a
                  className="pointer-events-auto underline underline-offset-2 hover:text-foreground"
                  href={WORLD_WEATHER_ATTRIBUTION_URL}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open-Meteo.com
                </a>{" "}
                (CC BY 4.0)
              </footer>
            ) : null}
            <Button
              aria-label="Resize world clock. Use the arrow keys. Use Shift and an arrow key for a smaller step."
              className="absolute right-0 bottom-0 cursor-nwse-resize touch-none rounded-tl-md rounded-tr-none rounded-br-none rounded-bl-none"
              size="icon-xs"
              variant="ghost"
              onKeyDown={(event) => {
                if (adjustGeometryWithKeyboard("resize", event.key, event.shiftKey)) {
                  event.preventDefault();
                }
              }}
              onPointerDown={(event) => beginInteraction("resize", event)}
            >
              <Maximize2Icon className="rotate-90" />
            </Button>
          </>
        ) : null}
      </section>
    </div>
  );
}
