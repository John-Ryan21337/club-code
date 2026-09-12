import { type TimestampFormat, type WorldClockLocationId } from "@cafecode/contracts/settings";

import {
  formatWorldClockDate,
  formatWorldClockTime,
  getAnalogHandAngles,
  getWorldClockAnalogParts,
  resolveWorldClockLocation,
  type WorldClockLocation,
} from "../worldClock";
import { type WorldWeatherSnapshot } from "../worldWeather";
import { cn } from "~/lib/utils";

/** Style names come straight from the contract literal union. */
export type WorldClockStyleName = "rainbow" | "nixie" | "analog" | "led";

export interface WeatherView {
  /** The selection the snapshot belongs to; a changed selection invalidates it. */
  readonly key: string;
  readonly snapshot: WorldWeatherSnapshot | null;
  readonly status: "idle" | "loading" | "ready" | "stale" | "unavailable";
}

export function AnalogClock({
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

export function formatWeatherAge(snapshot: WorldWeatherSnapshot, now: Date): string {
  const ageMinutes = Math.max(0, Math.floor((now.getTime() - snapshot.fetchedAtMs) / 60_000));
  if (ageMinutes < 1) return "updated now";
  return `updated ${ageMinutes} minutes ago`;
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
    // Only a fixed string is shown. Endpoint error text never reaches the UI.
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

export function ClockCard({
  locationId,
  now,
  timestampFormat,
  style,
  showWeather,
  weatherView,
}: {
  readonly locationId: WorldClockLocationId;
  readonly now: Date;
  readonly timestampFormat: TimestampFormat;
  readonly style: WorldClockStyleName;
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
