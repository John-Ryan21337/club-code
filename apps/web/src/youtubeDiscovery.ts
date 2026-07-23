import { resolvePrimaryEnvironmentHttpUrl } from "./environments/primary/target";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,80}$/;
const MAX_RESULTS = 12;
const MAX_QUERY_LENGTH = 120;
const MAX_TITLE_LENGTH = 200;

export interface YouTubeDiscoveryResult {
  readonly kind: "video" | "playlist";
  readonly id: string;
  readonly title: string;
}

export type YouTubeDiscoveryErrorCode =
  | "invalid-query"
  | "payload-too-large"
  | "rate-limited"
  | "quota-exhausted"
  | "unavailable"
  | "invalid-response"
  | "request-failed";

export class YouTubeDiscoveryError extends Error {
  constructor(readonly code: YouTubeDiscoveryErrorCode) {
    super(
      code === "invalid-query"
        ? "Enter a YouTube search between 1 and 120 characters."
        : code === "payload-too-large"
          ? "The YouTube search request was too large."
          : code === "rate-limited"
            ? "YouTube search is being used too quickly. Try again shortly."
            : code === "quota-exhausted"
              ? "YouTube search has reached its current API quota."
              : code === "unavailable"
                ? "In-app YouTube search is not configured on this server."
                : code === "invalid-response"
                  ? "YouTube search returned an invalid response."
                  : "YouTube search could not be reached.",
    );
    this.name = "YouTubeDiscoveryError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  );
}

export function isYouTubeDiscoveryAbort(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError"
  );
}

export function decodeYouTubeDiscoveryResults(value: unknown): readonly YouTubeDiscoveryResult[] {
  if (!isRecord(value) || !Array.isArray(value.results) || value.results.length > MAX_RESULTS) {
    throw new YouTubeDiscoveryError("invalid-response");
  }

  const seen = new Set<string>();
  const results: YouTubeDiscoveryResult[] = [];
  for (const candidate of value.results) {
    if (!isRecord(candidate)) {
      throw new YouTubeDiscoveryError("invalid-response");
    }
    const { kind, id, title } = candidate;
    if (
      (kind !== "video" && kind !== "playlist") ||
      typeof id !== "string" ||
      (kind === "video" ? !VIDEO_ID.test(id) : !PLAYLIST_ID.test(id)) ||
      !isSafeText(title, MAX_TITLE_LENGTH)
    ) {
      throw new YouTubeDiscoveryError("invalid-response");
    }
    const key = `${kind}:${id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push({ kind, id, title });
  }
  return results;
}

function decodeErrorCode(value: unknown): YouTubeDiscoveryErrorCode {
  if (!isRecord(value)) {
    return "request-failed";
  }
  switch (value.error) {
    case "invalid-query":
    case "payload-too-large":
    case "rate-limited":
    case "quota-exhausted":
    case "unavailable":
      return value.error;
    default:
      return "request-failed";
  }
}

export async function searchYouTube(
  query: string,
  options?: { readonly signal?: AbortSignal; readonly maxResults?: number },
): Promise<readonly YouTubeDiscoveryResult[]> {
  const normalizedQuery = query.trim();
  if (!isSafeText(normalizedQuery, MAX_QUERY_LENGTH)) {
    throw new YouTubeDiscoveryError("invalid-query");
  }
  const maxResults = options?.maxResults ?? 8;
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS) {
    throw new YouTubeDiscoveryError("invalid-query");
  }
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/ambient-media/youtube/search"),
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: normalizedQuery, maxResults }),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  ).catch((cause: unknown) => {
    if (isYouTubeDiscoveryAbort(cause)) {
      throw cause;
    }
    throw new YouTubeDiscoveryError("request-failed");
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new YouTubeDiscoveryError(decodeErrorCode(payload));
  }
  const payload = await response.json().catch(() => {
    throw new YouTubeDiscoveryError("invalid-response");
  });
  return decodeYouTubeDiscoveryResults(payload);
}
