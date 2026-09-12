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
                ? "YouTube search is not available on this server right now."
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

const MAX_RESPONSE_BYTES = 32 * 1024;
const DEADLINE_MS = 20_000;

async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted || response.redirected) {
    void response.body?.cancel().catch(() => undefined);
    throw new YouTubeDiscoveryError("request-failed");
  }
  const declared = Number(response.headers.get("content-length"));
  if (!response.body || (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)) {
    void response.body?.cancel().catch(() => undefined);
    throw new YouTubeDiscoveryError("invalid-response");
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new YouTubeDiscoveryError("invalid-response");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    cancel();
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function searchYouTube(
  query: string,
  options?: { readonly signal?: AbortSignal; readonly maxResults?: number },
): Promise<readonly YouTubeDiscoveryResult[]> {
  const normalizedQuery = query.trim();
  const maxResults = options?.maxResults ?? 8;
  if (
    !isSafeText(normalizedQuery, MAX_QUERY_LENGTH) ||
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > MAX_RESULTS
  )
    throw new YouTubeDiscoveryError("invalid-query");
  if (options?.signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options?.signal?.addEventListener("abort", cancel, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DEADLINE_MS);
  let rejectAbort!: (error: Error) => void;
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const onAbort = () =>
    rejectAbort(
      timedOut
        ? new YouTubeDiscoveryError("request-failed")
        : new DOMException("Search cancelled.", "AbortError"),
    );
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const work = async () => {
    const response = await fetch(
      resolvePrimaryEnvironmentHttpUrl("/api/ambient-media/youtube/search"),
      {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        referrerPolicy: "no-referrer",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: normalizedQuery, maxResults }),
        signal: controller.signal,
      },
    );
    const payload = await readResponse(response, controller.signal);
    if (!response.ok) throw new YouTubeDiscoveryError(decodeErrorCode(payload));
    return decodeYouTubeDiscoveryResults(payload);
  };
  try {
    return await Promise.race([work(), interrupted]);
  } catch (cause) {
    if (cause instanceof YouTubeDiscoveryError || isYouTubeDiscoveryAbort(cause)) throw cause;
    throw new YouTubeDiscoveryError("request-failed");
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
