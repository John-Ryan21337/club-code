import { type WorldClockLocationId } from "@cafecode/contracts/settings";
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
  useSyncExternalStore,
} from "react";

import {
  readCafeDocumentVisibilitySnapshot,
  subscribeCafeDocumentVisibility,
} from "../documentVisibility";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useSettings } from "../hooks/useSettings";
import { matrixColorFrameStore } from "../matrixColorFrameStore";
import {
  formatWorldClockDate,
  formatWorldClockTime,
  getAnalogHandAngles,
  getWorldClockAnalogParts,
  resolveWorldClockLocation,
  type WorldClockLocation,
} from "../worldClock";
import {
  WORLD_WEATHER_ATTRIBUTION_URL,
  WORLD_WEATHER_CACHE_TTL_MS,
  WORLD_WEATHER_FAILURE_RETRY_MS,
  type WorldWeatherClient,
  type WorldWeatherSnapshot,
  worldWeatherClient,
  worldWeatherErrorDiscriminator,
} from "../worldWeather";
import {
  clampWorldClockPanelGeometry,
  WORLD_CLOCK_PANEL_COLLAPSED_HEIGHT,
  WORLD_CLOCK_PANEL_DEFAULT_GEOMETRY,
  WORLD_CLOCK_PANEL_STORAGE_KEY,
  WorldClockPanelGeometrySchema,
  type WorldClockPanelBounds,
  type WorldClockPanelGeometry,
} from "../worldClockPanelGeometry";
import { cn } from "~/lib/utils";
import { Button } from "./ui/button";

interface PointerInteraction {
  readonly kind: "move" | "resize";
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly geometry: WorldClockPanelGeometry;
}

interface WeatherView {
  readonly key: string;
  readonly snapshot: WorldWeatherSnapshot | null;
  readonly status: "idle" | "loading" | "ready" | "stale" | "unavailable";
}

export interface WorldClockWidgetProps {
  readonly weatherClient?: WorldWeatherClient;
}

function useDocumentVisible(): boolean {
  return (
    useSyncExternalStore(
      subscribeCafeDocumentVisibility,
      readCafeDocumentVisibilitySnapshot,
      () => "hidden",
    ) === "visible"
  );
}

function readViewportBounds(): WorldClockPanelBounds {
  if (typeof window === "undefined") return { width: 0, height: 0 };
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

function useViewportBounds(): WorldClockPanelBounds {
  const [bounds, setBounds] = useState(readViewportBounds);
  useEffect(() => {
    const update = () => {
      const next = readViewportBounds();
      setBounds((current) =>
        current.width === next.width && current.height === next.height ? current : next,
      );
    };
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return bounds;
}

function useVisibleClockTick(active: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!active) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

function AnalogClock({
  date,
  location,
}: {
  readonly date: Date;
  readonly location: WorldClockLocation;
}) {
  const angles = getAnalogHandAngles(getWorldClockAnalogParts(date, location));
  return (
    <svg
      aria-label={`Analog clock for ${location.city}`}
      className="cafe-world-clock-analog-face size-20 shrink-0"
      role="img"
      viewBox="0 0 100 100"
    >
      <title>{`${location.city} analog clock`}</title>
      <circle className="cafe-world-clock-analog-ring" cx="50" cy="50" r="46" />
      {Array.from({ length: 12 }, (_, index) => {
        const angle = (index * Math.PI) / 6;
        const outerX = 50 + Math.sin(angle) * 40;
        const outerY = 50 - Math.cos(angle) * 40;
        const innerX = 50 + Math.sin(angle) * (index % 3 === 0 ? 33 : 36);
        const innerY = 50 - Math.cos(angle) * (index % 3 === 0 ? 33 : 36);
        return (
          <line
            className="cafe-world-clock-analog-mark"
            key={index}
            x1={innerX}
            x2={outerX}
            y1={innerY}
            y2={outerY}
          />
        );
      })}
      <line
        className="cafe-world-clock-analog-hour"
        x1="50"
        x2="50"
        y1="53"
        y2="28"
        transform={`rotate(${angles.hour} 50 50)`}
      />
      <line
        className="cafe-world-clock-analog-minute"
        x1="50"
        x2="50"
        y1="55"
        y2="17"
        transform={`rotate(${angles.minute} 50 50)`}
      />
      <line
        className="cafe-world-clock-analog-second"
        x1="50"
        x2="50"
        y1="58"
        y2="14"
        transform={`rotate(${angles.second} 50 50)`}
      />
      <circle className="cafe-world-clock-analog-pin" cx="50" cy="50" r="3" />
    </svg>
  );
}

function formatWeatherAge(snapshot: WorldWeatherSnapshot, now: Date): string {
  const ageMinutes = Math.max(0, Math.floor((now.getTime() - snapshot.fetchedAtMs) / 60_000));
  if (ageMinutes < 1) return "updated now";
  return `updated ${ageMinutes}m ago`;
}

function WeatherLine({
  locationId,
  view,
  now,
}: {
  readonly locationId: WorldClockLocationId;
  readonly view: WeatherView;
  readonly now: Date;
}) {
  if (view.status === "loading") {
    return <div className="cafe-world-clock-weather text-muted-foreground">Loading weather…</div>;
  }
  const snapshot = view.snapshot;
  const observation = snapshot?.byLocation[locationId];
  if (!snapshot || !observation) {
    return (
      <div className="cafe-world-clock-weather text-muted-foreground">Weather unavailable</div>
    );
  }
  return (
    <div
      className="cafe-world-clock-weather"
      title={`${observation.condition}; wind ${observation.windKph} km/h; ${formatWeatherAge(
        snapshot,
        now,
      )}${snapshot.stale ? "; stale cached reading" : ""}`}
    >
      <span aria-hidden>{observation.icon}</span>
      <span>{Number(observation.temperatureC.toFixed(1))}°C</span>
      <span className="truncate">{observation.condition}</span>
      <span className="ml-auto whitespace-nowrap text-muted-foreground">
        {Math.round(observation.windKph)} km/h
      </span>
      {snapshot.stale ? (
        <span className="rounded border border-amber-400/50 px-1 text-[9px] uppercase tracking-wide text-amber-500">
          stale
        </span>
      ) : null}
    </div>
  );
}

function ClockCard({
  locationId,
  now,
  timestampFormat,
  style,
  showWeather,
  weatherView,
}: {
  readonly locationId: WorldClockLocationId;
  readonly now: Date;
  readonly timestampFormat: "locale" | "12-hour" | "24-hour";
  readonly style: "rainbow" | "nixie" | "analog" | "led";
  readonly showWeather: boolean;
  readonly weatherView: WeatherView;
}) {
  const location = resolveWorldClockLocation(locationId);
  return (
    <article
      className={cn("cafe-world-clock-card", style === "analog" && "cafe-world-clock-card-analog")}
      data-world-clock-city={locationId}
    >
      {style === "analog" ? <AnalogClock date={now} location={location} /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="truncate text-[11px] font-semibold uppercase tracking-[0.16em]">
            {location.city}
          </h3>
          <span className="truncate text-[9px] text-muted-foreground">{location.timeZone}</span>
        </div>
        <time className="cafe-world-clock-time" dateTime={now.toISOString()}>
          {formatWorldClockTime(now, location, timestampFormat)}
        </time>
        <div className="cafe-world-clock-date">{formatWorldClockDate(now, location)}</div>
        {showWeather ? <WeatherLine locationId={locationId} now={now} view={weatherView} /> : null}
      </div>
    </article>
  );
}

export function WorldClockWidget({
  weatherClient: selectedWeatherClient = worldWeatherClient,
}: WorldClockWidgetProps) {
  const enabled = useSettings((settings) => settings.worldClockEnabled);
  const style = useSettings((settings) => settings.worldClockStyle);
  const locationIds = useSettings((settings) => settings.worldClockLocationIds);
  const showWeather = useSettings((settings) => settings.worldClockWeatherEnabled);
  const timestampFormat = useSettings((settings) => settings.timestampFormat);
  const panelBounds = useViewportBounds();
  const documentVisible = useDocumentVisible();
  const [storedGeometry, setStoredGeometry] = useLocalStorage(
    WORLD_CLOCK_PANEL_STORAGE_KEY,
    WORLD_CLOCK_PANEL_DEFAULT_GEOMETRY,
    WorldClockPanelGeometrySchema,
  );
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
  };

  const updateGeometry = useCallback(
    (geometry: WorldClockPanelGeometry) => {
      setStoredGeometry(clampWorldClockPanelGeometry(geometry, panelBounds));
    },
    [panelBounds, setStoredGeometry],
  );

  useEffect(() => {
    const panel = panelRef.current;
    if (!active || panel === null) return;
    const applyMatrixFrame = () => {
      const snapshot = matrixColorFrameStore.getSnapshot();
      if (!snapshot) return;
      panel.style.setProperty("--cafe-world-clock-accent", snapshot.frame.color);
      panel.dataset.matrixPaletteColor = snapshot.frame.color;
      panel.dataset.matrixPaletteMotion = snapshot.motion;
    };
    applyMatrixFrame();
    return matrixColorFrameStore.subscribe(applyMatrixFrame);
  }, [active]);

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
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
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
          "cafe-world-clock-widget pointer-events-auto absolute flex min-w-0 flex-col overflow-hidden rounded-xl border border-border/55 bg-transparent text-foreground",
          `cafe-world-clock-${style}`,
        )}
        data-collapsed={renderedGeometry.collapsed ? "true" : "false"}
        style={panelStyle}
      >
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border/45 px-1.5">
          <Button
            aria-label="Move world clock; use arrow keys, or Shift plus arrows for fine movement"
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
          <Clock3Icon className="ml-0.5 size-3.5 text-[var(--cafe-world-clock-accent,#53f59f)]" />
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
              aria-label="Resize world clock; use arrow keys, or Shift plus arrows for fine resizing"
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
