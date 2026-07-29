import { describe, expect, it, vi } from "vitest";

import {
  buildWorldWeatherUrl,
  createWorldWeatherClient,
  describeWorldWeatherCode,
  WORLD_WEATHER_CACHE_TTL_MS,
  WORLD_WEATHER_FAILURE_RETRY_MS,
  WORLD_WEATHER_MAX_RESPONSE_BYTES,
  worldWeatherErrorDiscriminator,
} from "./worldWeather";

function weatherPayload(temperatureC = 24) {
  return {
    current: {
      time: "2026-07-29T12:00",
      temperature_2m: temperatureC,
      weather_code: 2,
      wind_speed_10m: 12.5,
    },
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("world weather client", () => {
  it("builds one keyless HTTPS request for all selected coordinates and timezones", () => {
    const url = new URL(buildWorldWeatherUrl(["tokyo", "los-angeles"]));
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("api.open-meteo.com");
    expect(url.username).toBe("");
    expect(url.password).toBe("");
    expect(url.searchParams.get("latitude")?.split(",")).toHaveLength(2);
    expect(url.searchParams.get("longitude")?.split(",")).toHaveLength(2);
    expect(url.searchParams.get("timezone")).toBe("Asia/Tokyo,America/Los_Angeles");
    expect(url.searchParams.get("current")).toBe("temperature_2m,weather_code,wind_speed_10m");
    expect(url.searchParams.has("apikey")).toBe(false);
  });

  it("maps the documented WMO groups to readable conditions", () => {
    expect(describeWorldWeatherCode(0)).toEqual({ condition: "Clear sky", icon: "☀" });
    expect(describeWorldWeatherCode(63).condition).toBe("Rain");
    expect(describeWorldWeatherCode(75).condition).toBe("Snow");
    expect(describeWorldWeatherCode(96).condition).toBe("Thunderstorm");
    expect(describeWorldWeatherCode(42).condition).toBe("Unknown conditions");
  });

  it("coalesces in-flight reads and serves a bounded fresh cache", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    ) as unknown as typeof fetch;
    let nowMs = 1_000;
    const client = createWorldWeatherClient({ fetchImpl, now: () => nowMs });

    const first = client.read(["tokyo", "london"]);
    const duplicate = client.read(["tokyo", "london"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/api\.open-meteo\.com\//),
      expect.objectContaining({
        cache: "no-store",
        credentials: "omit",
        method: "GET",
        referrerPolicy: "no-referrer",
      }),
    );
    resolveFetch(jsonResponse([weatherPayload(27), weatherPayload(18)]));
    await expect(first).resolves.toMatchObject({
      stale: false,
      byLocation: {
        tokyo: { temperatureC: 27, condition: "Partly cloudy" },
        london: { temperatureC: 18 },
      },
    });
    await expect(duplicate).resolves.toMatchObject({ stale: false });

    nowMs += WORLD_WEATHER_CACHE_TTL_MS - 1;
    await expect(client.read(["tokyo", "london"])).resolves.toMatchObject({ stale: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("labels an expired cached reading stale when refresh fails", async () => {
    let nowMs = 1_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(weatherPayload(22)))
      .mockRejectedValueOnce(new TypeError("private network detail")) as unknown as typeof fetch;
    const client = createWorldWeatherClient({ fetchImpl, now: () => nowMs });
    await client.read(["tokyo"]);
    nowMs += WORLD_WEATHER_CACHE_TTL_MS + 1;

    await expect(client.read(["tokyo"])).resolves.toMatchObject({
      stale: true,
      byLocation: { tokyo: { temperatureC: 22 } },
    });
    await expect(client.read(["tokyo"])).resolves.toMatchObject({ stale: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    nowMs += WORLD_WEATHER_FAILURE_RETRY_MS;
    await client.read(["tokyo"]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("enforces the failure cooldown independently for each request key", async () => {
    let nowMs = 1_000;
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("private network detail"))
      .mockResolvedValueOnce(jsonResponse(weatherPayload(18)))
      .mockResolvedValueOnce(jsonResponse(weatherPayload(25))) as unknown as typeof fetch;
    const client = createWorldWeatherClient({ fetchImpl, now: () => nowMs });

    await expect(
      client.read(["tokyo"]).catch((error: unknown) => {
        throw new Error(worldWeatherErrorDiscriminator(error));
      }),
    ).rejects.toThrow("network");
    await expect(
      client.read(["tokyo"]).catch((error: unknown) => {
        throw new Error(worldWeatherErrorDiscriminator(error));
      }),
    ).rejects.toThrow("cooldown");
    await expect(client.read(["london"])).resolves.toMatchObject({
      byLocation: { london: { temperatureC: 18 } },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    nowMs += WORLD_WEATHER_FAILURE_RETRY_MS;
    await expect(client.read(["tokyo"])).resolves.toMatchObject({
      byLocation: { tokyo: { temperatureC: 25 } },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("aborts and invalidates in-flight work when cleared", async () => {
    let resolveFirst!: (response: Response) => void;
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(jsonResponse(weatherPayload(31))) as unknown as typeof fetch;
    const client = createWorldWeatherClient({ fetchImpl });

    const obsolete = client.read(["tokyo"]);
    client.clear();
    resolveFirst(jsonResponse(weatherPayload(12)));
    await expect(
      obsolete.catch((error: unknown) => {
        throw new Error(worldWeatherErrorDiscriminator(error));
      }),
    ).rejects.toThrow("aborted");

    await expect(client.read(["tokyo"])).resolves.toMatchObject({
      stale: false,
      byLocation: { tokyo: { temperatureC: 31 } },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("propagates caller cancellation without starting a retry cooldown", async () => {
    const resolvers: Array<(response: Response) => void> = [];
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          resolvers.push(resolve);
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("cancelled", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;
    const client = createWorldWeatherClient({ fetchImpl });
    const abortController = new AbortController();
    const cancelled = client.read(["tokyo"], { signal: abortController.signal });
    abortController.abort();
    const replacement = client.read(["tokyo"]);

    await expect(
      cancelled.catch((error: unknown) => {
        throw new Error(worldWeatherErrorDiscriminator(error));
      }),
    ).rejects.toThrow("aborted");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    resolvers[1]!(jsonResponse(weatherPayload(31)));
    await expect(replacement).resolves.toMatchObject({
      byLocation: { tokyo: { temperatureC: 31 } },
    });
    client.clear();
  });

  it("keeps a coalesced transport alive while another subscriber still needs it", async () => {
    let resolveFetch!: (response: Response) => void;
    const transport = { signal: null as AbortSignal | null };
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          resolveFetch = resolve;
          transport.signal = init?.signal ?? null;
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("cancelled", "AbortError"));
          });
        }),
    ) as unknown as typeof fetch;
    const client = createWorldWeatherClient({ fetchImpl });
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = client.read(["tokyo"], { signal: firstController.signal });
    const second = client.read(["tokyo"], { signal: secondController.signal });

    firstController.abort();
    await expect(
      first.catch((error: unknown) => {
        throw new Error(worldWeatherErrorDiscriminator(error));
      }),
    ).rejects.toThrow("aborted");
    expect(transport.signal?.aborted).toBe(false);

    resolveFetch(jsonResponse(weatherPayload(19)));
    await expect(second).resolves.toMatchObject({
      byLocation: { tokyo: { temperatureC: 19 } },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed and oversized provider responses without exposing response text", async () => {
    const malformedClient = createWorldWeatherClient({
      fetchImpl: vi.fn(async () =>
        jsonResponse({ current: { temperature_2m: "hot" } }),
      ) as unknown as typeof fetch,
    });
    await expect(
      malformedClient.read(["tokyo"]).catch((error: unknown) => {
        throw new Error(worldWeatherErrorDiscriminator(error));
      }),
    ).rejects.toThrow("invalid-response");

    const oversizedClient = createWorldWeatherClient({
      fetchImpl: vi.fn(
        async () =>
          new Response("{}", {
            status: 200,
            headers: {
              "content-type": "application/json",
              "content-length": String(WORLD_WEATHER_MAX_RESPONSE_BYTES + 1),
            },
          }),
      ) as unknown as typeof fetch,
    });
    await expect(
      oversizedClient.read(["tokyo"]).catch((error: unknown) => {
        throw new Error(worldWeatherErrorDiscriminator(error));
      }),
    ).rejects.toThrow("response-too-large");
  });
});
