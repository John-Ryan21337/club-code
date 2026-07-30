import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";

/** The only upstream origin this feature may contact. */
const YOUTUBE_SEARCH_ORIGIN = "https://www.googleapis.com";
const YOUTUBE_SEARCH_PATH = "/youtube/v3/search";
const SEARCH_CACHE_TTL_MS = 30_000;
const SEARCH_CACHE_LIMIT = 64;
const CLIENT_RATE_LIMIT_WINDOW_MS = 60_000;
const CLIENT_RATE_LIMIT_MAX_REQUESTS = 12;
const GLOBAL_RATE_LIMIT_MAX_REQUESTS = 120;
const CLIENT_RATE_LIMIT_BUCKETS = 256;
const UPSTREAM_RESPONSE_MAX_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 8_000;

export const YOUTUBE_DISCOVERY_MAX_QUERY_CHARS = 120;
export const YOUTUBE_DISCOVERY_MAX_RESULTS = 12;
export const YOUTUBE_DISCOVERY_DEFAULT_RESULTS = 8;

export interface YouTubeDiscoveryResult {
  readonly kind: "video" | "playlist";
  readonly id: string;
  readonly title: string;
  readonly thumbnail: {
    readonly url: string;
    readonly width: number;
    readonly height: number;
  } | null;
}

export class YouTubePublicDiscoveryError extends Data.TaggedError("YouTubePublicDiscoveryError")<{
  readonly code:
    | "invalid-query"
    | "payload-too-large"
    | "unavailable"
    | "rate-limited"
    | "quota-exhausted";
  readonly status: 400 | 413 | 429 | 503;
}> {}

export interface YouTubePublicDiscoveryShape {
  readonly search: (input: {
    readonly query: string;
    readonly maxResults: number;
    /** An authenticated transport identity; never logged or returned. */
    readonly clientId: string;
  }) => Effect.Effect<ReadonlyArray<YouTubeDiscoveryResult>, YouTubePublicDiscoveryError>;
}

export class YouTubePublicDiscovery extends Context.Service<
  YouTubePublicDiscovery,
  YouTubePublicDiscoveryShape
>()("cafecode/ambientMedia/YouTubePublicDiscovery") {}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface RateLimitBucket {
  readonly startedAt: number;
  readonly count: number;
}

interface CachedSearch {
  readonly expiresAt: number;
  readonly results: ReadonlyArray<YouTubeDiscoveryResult>;
}

function error(code: YouTubePublicDiscoveryError["code"]): YouTubePublicDiscoveryError {
  switch (code) {
    case "invalid-query":
      return new YouTubePublicDiscoveryError({ code, status: 400 });
    case "payload-too-large":
      return new YouTubePublicDiscoveryError({ code, status: 413 });
    case "rate-limited":
    case "quota-exhausted":
      return new YouTubePublicDiscoveryError({ code, status: 429 });
    case "unavailable":
      return new YouTubePublicDiscoveryError({ code, status: 503 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    normalized.length > maxLength ||
    Array.from(normalized).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    return null;
  }
  return normalized;
}

export function parseYouTubeDiscoveryInput(input: {
  readonly query: string | null;
  readonly maxResults: string | null;
}): { readonly query: string; readonly maxResults: number } | null {
  const query = safeText(input.query, YOUTUBE_DISCOVERY_MAX_QUERY_CHARS);
  if (!query) return null;
  if (input.maxResults === null) {
    return { query, maxResults: YOUTUBE_DISCOVERY_DEFAULT_RESULTS };
  }
  if (!/^(?:[1-9]|1[0-2])$/u.test(input.maxResults)) return null;
  return { query, maxResults: Number(input.maxResults) };
}

function isSafeThumbnailUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 512) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "i.ytimg.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      /^\/vi\/[A-Za-z0-9_-]{11}\/[A-Za-z0-9._-]{1,64}\.(?:jpg|webp)$/u.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function decodeThumbnail(value: unknown): YouTubeDiscoveryResult["thumbnail"] {
  if (!isRecord(value)) return null;
  const url = value.url;
  const width = value.width;
  const height = value.height;
  if (
    !isSafeThumbnailUrl(url) ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    width > 4096 ||
    height < 1 ||
    height > 4096
  ) {
    return null;
  }
  return { url, width, height };
}

/**
 * This deliberately decodes only selection data. In particular it discards
 * descriptions, channel identifiers, pagination tokens, and all upstream error
 * fields, which may be large or contain data the renderer does not need.
 */
export function decodeYouTubeSearchResponse(
  body: unknown,
  maxResults: number,
): ReadonlyArray<YouTubeDiscoveryResult> | null {
  if (!isRecord(body) || !Array.isArray(body.items)) return null;
  const results: YouTubeDiscoveryResult[] = [];
  const seen = new Set<string>();
  for (const item of body.items) {
    if (results.length >= maxResults || !isRecord(item)) continue;
    const id = isRecord(item.id) ? item.id : null;
    const snippet = isRecord(item.snippet) ? item.snippet : null;
    const kind =
      id?.kind === "youtube#video" ? "video" : id?.kind === "youtube#playlist" ? "playlist" : null;
    const sourceId = kind === "video" ? id?.videoId : kind === "playlist" ? id?.playlistId : null;
    const validId =
      typeof sourceId === "string" &&
      (kind === "video"
        ? /^[A-Za-z0-9_-]{11}$/u.test(sourceId)
        : /^[A-Za-z0-9_-]{10,80}$/u.test(sourceId));
    const title = safeText(snippet?.title, 200);
    if (!kind || !validId || !title) continue;
    const identity = `${kind}:${sourceId}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const thumbnails = isRecord(snippet?.thumbnails) ? snippet.thumbnails : null;
    results.push({
      kind,
      id: sourceId,
      title,
      thumbnail:
        decodeThumbnail(thumbnails?.medium) ??
        decodeThumbnail(thumbnails?.high) ??
        decodeThumbnail(thumbnails?.default),
    });
  }
  return results;
}

function classifyUpstreamFailure(
  status: number,
  body: unknown,
): YouTubePublicDiscoveryError["code"] {
  if (status === 429) return "quota-exhausted";
  if (
    status !== 403 ||
    !isRecord(body) ||
    !isRecord(body.error) ||
    !Array.isArray(body.error.errors)
  ) {
    return "unavailable";
  }
  return body.error.errors.some(
    (entry) =>
      isRecord(entry) &&
      (entry.reason === "quotaExceeded" || entry.reason === "dailyLimitExceeded"),
  )
    ? "quota-exhausted"
    : "unavailable";
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > UPSTREAM_RESPONSE_MAX_BYTES) {
    throw new RangeError("upstream response is too large");
  }
  if (!response.body) throw new TypeError("upstream response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > UPSTREAM_RESPONSE_MAX_BYTES) {
        await reader.cancel();
        throw new RangeError("upstream response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function safeClientId(value: string): string {
  return value.length > 0 && value.length <= 128 ? value : "unknown";
}

export function makeYouTubePublicDiscovery(input: {
  readonly apiKey: string | undefined;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
}): YouTubePublicDiscoveryShape {
  const apiKey = input.apiKey?.trim() || undefined;
  const fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  const now = input.now ?? Date.now;
  const cache = new Map<string, CachedSearch>();
  const clients = new Map<string, RateLimitBucket>();
  let globalBucket: RateLimitBucket = { startedAt: now(), count: 0 };

  const takeRateLimit = (clientId: string): boolean => {
    const timestamp = now();
    if (timestamp - globalBucket.startedAt >= CLIENT_RATE_LIMIT_WINDOW_MS) {
      globalBucket = { startedAt: timestamp, count: 0 };
    }
    const previous = clients.get(clientId);
    const client =
      previous && timestamp - previous.startedAt < CLIENT_RATE_LIMIT_WINDOW_MS
        ? previous
        : { startedAt: timestamp, count: 0 };
    if (
      globalBucket.count >= GLOBAL_RATE_LIMIT_MAX_REQUESTS ||
      client.count >= CLIENT_RATE_LIMIT_MAX_REQUESTS
    ) {
      return false;
    }
    globalBucket = { ...globalBucket, count: globalBucket.count + 1 };
    clients.delete(clientId);
    clients.set(clientId, { ...client, count: client.count + 1 });
    while (clients.size > CLIENT_RATE_LIMIT_BUCKETS) {
      const oldest = clients.keys().next().value;
      if (oldest === undefined) break;
      clients.delete(oldest);
    }
    return true;
  };

  return {
    search: ({ query, maxResults, clientId }) =>
      Effect.gen(function* () {
        if (!apiKey) return yield* error("unavailable");
        const normalizedQuery = safeText(query, YOUTUBE_DISCOVERY_MAX_QUERY_CHARS);
        if (
          !normalizedQuery ||
          !Number.isInteger(maxResults) ||
          maxResults < 1 ||
          maxResults > YOUTUBE_DISCOVERY_MAX_RESULTS
        ) {
          return yield* error("invalid-query");
        }
        const parsed = { query: normalizedQuery, maxResults };
        if (!takeRateLimit(safeClientId(clientId))) return yield* error("rate-limited");

        const cacheKey = `${parsed.maxResults}:${parsed.query.toLocaleLowerCase("en-US")}`;
        const cached = cache.get(cacheKey);
        const timestamp = now();
        if (cached && cached.expiresAt > timestamp) {
          cache.delete(cacheKey);
          cache.set(cacheKey, cached);
          return cached.results;
        }
        cache.delete(cacheKey);

        const upstreamUrl = new URL(YOUTUBE_SEARCH_PATH, YOUTUBE_SEARCH_ORIGIN);
        upstreamUrl.searchParams.set("part", "snippet");
        upstreamUrl.searchParams.set("type", "video,playlist");
        upstreamUrl.searchParams.set("q", parsed.query);
        upstreamUrl.searchParams.set("maxResults", String(parsed.maxResults));

        // Do not log this request, its URL, or its body: the query is
        // user-provided. Keep the server-only key out of the URL so HTTP URL
        // telemetry and intermediary request lines cannot capture it.
        // Redirects are rejected so the header cannot be forwarded elsewhere.
        const response = yield* Effect.tryPromise({
          try: () =>
            fetch(upstreamUrl.toString(), {
              method: "GET",
              headers: {
                Accept: "application/json",
                "X-Goog-Api-Key": apiKey,
              },
              redirect: "error",
              signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
            }),
          catch: () => error("unavailable"),
        });
        const body = yield* Effect.tryPromise({
          try: () => readBoundedJson(response),
          catch: () => error("unavailable"),
        });
        if (!response.ok) return yield* error(classifyUpstreamFailure(response.status, body));
        const results = decodeYouTubeSearchResponse(body, parsed.maxResults);
        if (results === null) return yield* error("unavailable");

        const cachedResult = { expiresAt: timestamp + SEARCH_CACHE_TTL_MS, results };
        cache.set(cacheKey, cachedResult);
        while (cache.size > SEARCH_CACHE_LIMIT) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
        return results;
      }),
  };
}

export const YouTubePublicDiscoveryLive = Layer.effect(
  YouTubePublicDiscovery,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return makeYouTubePublicDiscovery({ apiKey: config.youtubePublicDiscoveryApiKey });
  }),
);
