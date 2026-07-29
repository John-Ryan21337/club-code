import { type TimestampFormat, type WorldClockLocationId } from "@cafecode/contracts/settings";

import { getTimestampFormatOptions } from "./timestampFormat";

export interface WorldClockLocation {
  readonly id: WorldClockLocationId;
  readonly city: string;
  readonly country: string;
  readonly timeZone: string;
  readonly latitude: number;
  readonly longitude: number;
}

export const WORLD_CLOCK_LOCATIONS = [
  {
    id: "tokyo",
    city: "Tokyo",
    country: "Japan",
    timeZone: "Asia/Tokyo",
    latitude: 35.6762,
    longitude: 139.6503,
  },
  {
    id: "los-angeles",
    city: "Los Angeles",
    country: "United States",
    timeZone: "America/Los_Angeles",
    latitude: 34.0522,
    longitude: -118.2437,
  },
  {
    id: "new-york",
    city: "New York",
    country: "United States",
    timeZone: "America/New_York",
    latitude: 40.7128,
    longitude: -74.006,
  },
  {
    id: "london",
    city: "London",
    country: "United Kingdom",
    timeZone: "Europe/London",
    latitude: 51.5074,
    longitude: -0.1278,
  },
  {
    id: "paris",
    city: "Paris",
    country: "France",
    timeZone: "Europe/Paris",
    latitude: 48.8566,
    longitude: 2.3522,
  },
  {
    id: "berlin",
    city: "Berlin",
    country: "Germany",
    timeZone: "Europe/Berlin",
    latitude: 52.52,
    longitude: 13.405,
  },
  {
    id: "seoul",
    city: "Seoul",
    country: "South Korea",
    timeZone: "Asia/Seoul",
    latitude: 37.5665,
    longitude: 126.978,
  },
  {
    id: "singapore",
    city: "Singapore",
    country: "Singapore",
    timeZone: "Asia/Singapore",
    latitude: 1.3521,
    longitude: 103.8198,
  },
  {
    id: "sydney",
    city: "Sydney",
    country: "Australia",
    timeZone: "Australia/Sydney",
    latitude: -33.8688,
    longitude: 151.2093,
  },
  {
    id: "honolulu",
    city: "Honolulu",
    country: "United States",
    timeZone: "Pacific/Honolulu",
    latitude: 21.3069,
    longitude: -157.8583,
  },
  {
    id: "dubai",
    city: "Dubai",
    country: "United Arab Emirates",
    timeZone: "Asia/Dubai",
    latitude: 25.2048,
    longitude: 55.2708,
  },
  {
    id: "sao-paulo",
    city: "São Paulo",
    country: "Brazil",
    timeZone: "America/Sao_Paulo",
    latitude: -23.5505,
    longitude: -46.6333,
  },
] as const satisfies readonly WorldClockLocation[];

const locationsById = new Map(
  WORLD_CLOCK_LOCATIONS.map((location) => [location.id, location] as const),
);

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(undefined, options);
  formatterCache.set(key, formatter);
  return formatter;
}

export function resolveWorldClockLocation(locationId: WorldClockLocationId): WorldClockLocation {
  const location = locationsById.get(locationId);
  if (!location) {
    // The contract schema makes this unreachable. Keeping the lookup total
    // means a catalog edit cannot silently render the browser's local zone.
    throw new Error(`Missing world clock location: ${locationId}`);
  }
  return location;
}

export function formatWorldClockTime(
  date: Date,
  location: WorldClockLocation,
  timestampFormat: TimestampFormat,
): string {
  return cachedFormatter(`time:${location.timeZone}:${timestampFormat}`, {
    ...getTimestampFormatOptions(timestampFormat, true),
    timeZone: location.timeZone,
  }).format(date);
}

export function formatWorldClockDate(date: Date, location: WorldClockLocation): string {
  return cachedFormatter(`date:${location.timeZone}`, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: location.timeZone,
  }).format(date);
}

export interface WorldClockAnalogParts {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export function getWorldClockAnalogParts(
  date: Date,
  location: WorldClockLocation,
): WorldClockAnalogParts {
  const parts = cachedFormatter(`parts:${location.timeZone}`, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: location.timeZone,
  }).formatToParts(date);
  const partValue = (type: Intl.DateTimeFormatPartTypes) => {
    const value = Number(parts.find((part) => part.type === type)?.value);
    return Number.isFinite(value) ? value : 0;
  };
  return {
    hour: partValue("hour"),
    minute: partValue("minute"),
    second: partValue("second"),
  };
}

export function getAnalogHandAngles(parts: WorldClockAnalogParts): {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
} {
  return {
    hour: ((parts.hour % 12) + parts.minute / 60 + parts.second / 3_600) * 30,
    minute: (parts.minute + parts.second / 60) * 6,
    second: parts.second * 6,
  };
}
