import { type WorldClockLocationId } from "@cafecode/contracts/settings";

import { resolveWorldClockLocation } from "./worldClock";

export const WORLD_WEATHER_ATTRIBUTION_URL = "https://open-meteo.com/";
export const WORLD_WEATHER_CACHE_TTL_MS = 15 * 60 * 1_000;
export const WORLD_WEATHER_FAILURE_RETRY_MS = 5 * 60 * 1_000;
export const WORLD_WEATHER_REQUEST_TIMEOUT_MS = 8_000;
export const WORLD_WEATHER_MAX_RESPONSE_BYTES = 64 * 1_024;
const WORLD_WEATHER_MAX_CACHE_KEYS = 8;
const WORLD_WEATHER_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

export interface WorldWeatherObservation {
  readonly condition: string;
  readonly icon: string;
  readonly sourceTime: string;
  readonly temperatureC: number;
  readonly weatherCode: number;
  readonly windKph: number;
}

export interface WorldWeatherSnapshot {
  readonly byLocation: Partial<Record<WorldClockLocationId, WorldWeatherObservation>>;
  readonly fetchedAtMs: number;
  readonly stale: boolean;
}

export interface WorldWeatherClient {
  readonly read: (
    locationIds: readonly WorldClockLocationId[],
    options?: { readonly signal?: AbortSignal },
  ) => Promise<WorldWeatherSnapshot>;
  readonly clear: () => void;
}

interface WorldWeatherClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly timeoutMs?: number;
}

interface WeatherCacheEntry {
  readonly snapshot: WorldWeatherSnapshot;
}

interface InFlightWeatherRequest {
  readonly controller: AbortController;
  readonly promise: Promise<WorldWeatherSnapshot>;
  settled: boolean;
  subscribers: number;
}

class WorldWeatherError extends Error {
  constructor(
    readonly category:
      | "aborted"
      | "cooldown"
      | "http"
      | "invalid-response"
      | "network"
      | "response-too-large"
      | "timeout",
  ) {
    super(category);
    this.name = "WorldWeatherError";
  }
}

export function worldWeatherErrorDiscriminator(error: unknown): string {
  if (error instanceof WorldWeatherError) return error.category;
  if (error instanceof DOMException && error.name === "AbortError") return "aborted";
  if (error instanceof TypeError) return "network";
  return "unknown";
}

export function describeWorldWeatherCode(weatherCode: number): {
  readonly condition: string;
  readonly icon: string;
} {
  if (weatherCode === 0) return { condition: "Clear sky", icon: "☀" };
  if (weatherCode === 1) return { condition: "Mainly clear", icon: "🌤" };
  if (weatherCode === 2) return { condition: "Partly cloudy", icon: "⛅" };
  if (weatherCode === 3) return { condition: "Overcast", icon: "☁" };
  if (weatherCode === 45 || weatherCode === 48) {
    return { condition: "Fog", icon: "🌫" };
  }
  if (weatherCode >= 51 && weatherCode <= 57) {
    return { condition: "Drizzle", icon: "🌦" };
  }
  if (weatherCode >= 61 && weatherCode <= 67) {
    return { condition: "Rain", icon: "🌧" };
  }
  if ((weatherCode >= 71 && weatherCode <= 77) || weatherCode === 85 || weatherCode === 86) {
    return { condition: "Snow", icon: "❄" };
  }
  if (weatherCode >= 80 && weatherCode <= 82) {
    return { condition: "Rain showers", icon: "🌦" };
  }
  if (weatherCode >= 95 && weatherCode <= 99) {
    return { condition: "Thunderstorm", icon: "⛈" };
  }
  return { condition: "Unknown conditions", icon: "·" };
}

export function buildWorldWeatherUrl(locationIds: readonly WorldClockLocationId[]): string {
  const locations = locationIds.map(resolveWorldClockLocation);
  const url = new URL(WORLD_WEATHER_FORECAST_URL);
  url.searchParams.set("latitude", locations.map((location) => location.latitude).join(","));
  url.searchParams.set("longitude", locations.map((location) => location.longitude).join(","));
  url.searchParams.set("current", "temperature_2m,weather_code,wind_speed_10m");
  url.searchParams.set("timezone", locations.map((location) => location.timeZone).join(","));
  url.searchParams.set("forecast_days", "1");
  return url.toString();
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > WORLD_WEATHER_MAX_RESPONSE_BYTES) {
    throw new WorldWeatherError("response-too-large");
  }

  if (response.body === null) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > WORLD_WEATHER_MAX_RESPONSE_BYTES) {
      throw new WorldWeatherError("response-too-large");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > WORLD_WEATHER_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new WorldWeatherError("response-too-large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

function finiteNumber(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function parseWeatherObservation(value: unknown): WorldWeatherObservation | null {
  if (typeof value !== "object" || value === null) return null;
  const current = Reflect.get(value, "current");
  if (typeof current !== "object" || current === null) return null;
  const temperatureC = finiteNumber(Reflect.get(current, "temperature_2m"), -100, 80);
  const windKph = finiteNumber(Reflect.get(current, "wind_speed_10m"), 0, 500);
  const weatherCode = finiteNumber(Reflect.get(current, "weather_code"), 0, 99);
  const sourceTime = Reflect.get(current, "time");
  if (
    temperatureC === null ||
    windKph === null ||
    weatherCode === null ||
    !Number.isInteger(weatherCode) ||
    typeof sourceTime !== "string" ||
    sourceTime.length === 0 ||
    sourceTime.length > 64
  ) {
    return null;
  }
  const description = describeWorldWeatherCode(weatherCode);
  return {
    ...description,
    sourceTime,
    temperatureC,
    weatherCode,
    windKph,
  };
}

export function parseWorldWeatherResponse(
  value: unknown,
  locationIds: readonly WorldClockLocationId[],
  fetchedAtMs: number,
): WorldWeatherSnapshot {
  const responses = Array.isArray(value) ? value : [value];
  if (responses.length !== locationIds.length) {
    throw new WorldWeatherError("invalid-response");
  }

  const byLocation: Partial<Record<WorldClockLocationId, WorldWeatherObservation>> = {};
  let observationCount = 0;
  for (const [index, locationId] of locationIds.entries()) {
    const observation = parseWeatherObservation(responses[index]);
    if (observation === null) continue;
    byLocation[locationId] = observation;
    observationCount += 1;
  }
  if (observationCount === 0) {
    throw new WorldWeatherError("invalid-response");
  }
  return { byLocation, fetchedAtMs, stale: false };
}

export function createWorldWeatherClient(
  options: WorldWeatherClientOptions = {},
): WorldWeatherClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? WORLD_WEATHER_REQUEST_TIMEOUT_MS;
  const cache = new Map<string, WeatherCacheEntry>();
  const failures = new Map<string, number>();
  const inFlight = new Map<string, InFlightWeatherRequest>();
  let generation = 0;

  const rememberFailure = (cacheKey: string, retryAtMs: number): void => {
    if (!failures.has(cacheKey) && failures.size >= WORLD_WEATHER_MAX_CACHE_KEYS) {
      const oldestKey = failures.keys().next().value as string | undefined;
      if (oldestKey !== undefined) failures.delete(oldestKey);
    }
    failures.set(cacheKey, retryAtMs);
  };

  const subscribeToRequest = (
    request: InFlightWeatherRequest,
    signal?: AbortSignal,
  ): Promise<WorldWeatherSnapshot> => {
    if (signal?.aborted) {
      return Promise.reject(new WorldWeatherError("aborted"));
    }

    request.subscribers += 1;
    return new Promise<WorldWeatherSnapshot>((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        signal?.removeEventListener("abort", abortSubscriber);
        request.subscribers = Math.max(0, request.subscribers - 1);
        if (request.subscribers === 0 && !request.settled) {
          request.controller.abort();
        }
      };
      const abortSubscriber = () => {
        release();
        reject(new WorldWeatherError("aborted"));
      };

      signal?.addEventListener("abort", abortSubscriber, { once: true });
      request.promise.then(
        (snapshot) => {
          release();
          resolve(snapshot);
        },
        (error: unknown) => {
          release();
          reject(error);
        },
      );
    });
  };

  const read = async (
    locationIds: readonly WorldClockLocationId[],
    readOptions: { readonly signal?: AbortSignal } = {},
  ): Promise<WorldWeatherSnapshot> => {
    if (readOptions.signal?.aborted) {
      throw new WorldWeatherError("aborted");
    }
    const cacheKey = locationIds.join(",");
    const cached = cache.get(cacheKey);
    const nowMs = now();
    if (cached && nowMs - cached.snapshot.fetchedAtMs < WORLD_WEATHER_CACHE_TTL_MS) {
      return cached.snapshot;
    }
    const retryAtMs = failures.get(cacheKey);
    if (retryAtMs !== undefined && nowMs < retryAtMs) {
      if (cached) return { ...cached.snapshot, stale: true };
      throw new WorldWeatherError("cooldown");
    }
    if (retryAtMs !== undefined) failures.delete(cacheKey);

    const pending = inFlight.get(cacheKey);
    if (pending && !pending.controller.signal.aborted) {
      return subscribeToRequest(pending, readOptions.signal);
    }
    if (pending) {
      // A StrictMode cleanup can release the last subscriber immediately
      // before the replacement effect subscribes. Never make that replacement
      // inherit a transport which has already been aborted.
      inFlight.delete(cacheKey);
    }

    const requestGeneration = generation;
    const abortController = new AbortController();
    let timedOut = false;
    const requestPromise = (async () => {
      const timeout = setTimeout(() => {
        timedOut = true;
        abortController.abort();
      }, timeoutMs);
      try {
        const response = await fetchImpl(buildWorldWeatherUrl(locationIds), {
          cache: "no-store",
          credentials: "omit",
          headers: { Accept: "application/json" },
          method: "GET",
          mode: "cors",
          referrerPolicy: "no-referrer",
          signal: abortController.signal,
        });
        if (abortController.signal.aborted || requestGeneration !== generation) {
          throw new WorldWeatherError("aborted");
        }
        if (!response.ok) throw new WorldWeatherError("http");
        if (!(response.headers.get("content-type") ?? "").toLowerCase().includes("json")) {
          throw new WorldWeatherError("invalid-response");
        }
        const text = await readBoundedResponseBody(response);
        let decoded: unknown;
        try {
          decoded = JSON.parse(text);
        } catch {
          throw new WorldWeatherError("invalid-response");
        }
        const snapshot = parseWorldWeatherResponse(decoded, locationIds, now());
        if (abortController.signal.aborted || requestGeneration !== generation) {
          throw new WorldWeatherError("aborted");
        }
        if (!cache.has(cacheKey) && cache.size >= WORLD_WEATHER_MAX_CACHE_KEYS) {
          const oldestKey = cache.keys().next().value as string | undefined;
          if (oldestKey !== undefined) cache.delete(oldestKey);
        }
        cache.set(cacheKey, { snapshot });
        failures.delete(cacheKey);
        return snapshot;
      } catch (error) {
        const lifecycleAbort =
          (abortController.signal.aborted && !timedOut) || requestGeneration !== generation;
        const normalizedError = lifecycleAbort
          ? new WorldWeatherError("aborted")
          : timedOut
            ? new WorldWeatherError("timeout")
            : error instanceof WorldWeatherError
              ? error
              : error instanceof TypeError
                ? new WorldWeatherError("network")
                : new WorldWeatherError("invalid-response");
        if (!lifecycleAbort && requestGeneration === generation) {
          rememberFailure(cacheKey, now() + WORLD_WEATHER_FAILURE_RETRY_MS);
        }
        if (cached && !lifecycleAbort && requestGeneration === generation) {
          return { ...cached.snapshot, stale: true };
        }
        throw normalizedError;
      } finally {
        clearTimeout(timeout);
      }
    })();
    const request: InFlightWeatherRequest = {
      controller: abortController,
      promise: requestPromise,
      settled: false,
      subscribers: 0,
    };
    inFlight.set(cacheKey, request);
    void requestPromise.then(
      () => {
        request.settled = true;
        if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
      },
      () => {
        request.settled = true;
        if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
      },
    );
    return subscribeToRequest(request, readOptions.signal);
  };

  return {
    read,
    clear: () => {
      generation += 1;
      for (const request of inFlight.values()) {
        request.controller.abort();
      }
      cache.clear();
      failures.clear();
      inFlight.clear();
    },
  };
}

export const worldWeatherClient = createWorldWeatherClient();
