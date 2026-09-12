import { resolvePrimaryEnvironmentHttpUrl } from "./environments/primary/target";

const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,80}$/u;
const MAX_PLAYLISTS = 50;
const MAX_TITLE_LENGTH = 200;

export type YouTubeAccountConnectionStatus = "disconnected" | "pending" | "connected";

export interface YouTubeOwnedPlaylist {
  readonly id: string;
  readonly title: string;
  readonly itemCount: number;
}

export class YouTubeAccountConnectionRequestError extends Error {
  constructor(
    readonly code: "not-connected" | "unavailable" | "invalid-response" | "request-failed",
  ) {
    super(
      code === "not-connected"
        ? "Connect your YouTube account before loading owned playlists."
        : code === "unavailable"
          ? "YouTube account connection is unavailable in this Cafe session."
          : code === "invalid-response"
            ? "Cafe received an invalid YouTube account response."
            : "Cafe could not reach the YouTube account connector.",
    );
    this.name = "YouTubeAccountConnectionRequestError";
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
      const point = character.codePointAt(0) ?? 0;
      return point <= 0x1f || point === 0x7f;
    })
  );
}

function decodeStatus(value: unknown): YouTubeAccountConnectionStatus {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    (value.status !== "disconnected" && value.status !== "pending" && value.status !== "connected")
  ) {
    throw new YouTubeAccountConnectionRequestError("invalid-response");
  }
  return value.status;
}

export function decodeYouTubeOwnedPlaylistResponse(
  value: unknown,
): readonly YouTubeOwnedPlaylist[] {
  if (
    !isRecord(value) ||
    !Array.isArray(value.playlists) ||
    value.playlists.length > MAX_PLAYLISTS
  ) {
    throw new YouTubeAccountConnectionRequestError("invalid-response");
  }
  const seen = new Set<string>();
  return value.playlists.map((candidate) => {
    if (!isRecord(candidate)) {
      throw new YouTubeAccountConnectionRequestError("invalid-response");
    }
    const { id, title, itemCount } = candidate;
    if (
      typeof id !== "string" ||
      !PLAYLIST_ID.test(id) ||
      !isSafeText(title, MAX_TITLE_LENGTH) ||
      typeof itemCount !== "number" ||
      !Number.isSafeInteger(itemCount) ||
      itemCount < 0 ||
      seen.has(id)
    ) {
      throw new YouTubeAccountConnectionRequestError("invalid-response");
    }
    seen.add(id);
    return { id, title, itemCount };
  });
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEADLINE_MS = 20_000;

async function readResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted || response.redirected) {
    void response.body?.cancel().catch(() => undefined);
    throw new YouTubeAccountConnectionRequestError("request-failed");
  }
  const declared = Number(response.headers.get("content-length"));
  if (!response.body || (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES)) {
    void response.body?.cancel().catch(() => undefined);
    throw new YouTubeAccountConnectionRequestError("invalid-response");
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
      if (bytes > MAX_RESPONSE_BYTES)
        throw new YouTubeAccountConnectionRequestError("invalid-response");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    cancel();
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export function isYouTubeAccountAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Deadline covers fetch and body consumption; late fetches still cancel their body. */
async function request(path: string, method: string, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw new DOMException("Request cancelled.", "AbortError");
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
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
        ? new YouTubeAccountConnectionRequestError("request-failed")
        : new DOMException("Request cancelled.", "AbortError"),
    );
  controller.signal.addEventListener("abort", onAbort, { once: true });
  const work = async () => {
    const response = await fetch(resolvePrimaryEnvironmentHttpUrl(path), {
      method,
      headers: { "content-type": "application/json" },
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (controller.signal.aborted || response.redirected) {
      void response.body?.cancel().catch(() => undefined);
      throw new YouTubeAccountConnectionRequestError("request-failed");
    }
    if (method === "DELETE" && response.status === 204) {
      void response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const payload = await readResponse(response, controller.signal);
    if (!response.ok) {
      const error = isRecord(payload) ? payload.error : undefined;
      throw new YouTubeAccountConnectionRequestError(
        error === "not-connected" || error === "unavailable" ? error : "request-failed",
      );
    }
    if (method === "DELETE") throw new YouTubeAccountConnectionRequestError("invalid-response");
    return payload;
  };
  try {
    return await Promise.race([work(), interrupted]);
  } catch (error) {
    if (error instanceof YouTubeAccountConnectionRequestError || isYouTubeAccountAbort(error))
      throw error;
    throw new YouTubeAccountConnectionRequestError("request-failed");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

export async function startYouTubeAccountConnection(
  signal?: AbortSignal,
): Promise<YouTubeAccountConnectionStatus> {
  const status = decodeStatus(
    await request("/api/ambient-media/youtube/account/start", "POST", signal),
  );
  if (status !== "pending") throw new YouTubeAccountConnectionRequestError("invalid-response");
  return status;
}
export async function getYouTubeAccountConnectionStatus(
  signal?: AbortSignal,
): Promise<YouTubeAccountConnectionStatus> {
  return decodeStatus(await request("/api/ambient-media/youtube/account/status", "GET", signal));
}
export async function listYouTubeOwnedPlaylists(
  signal?: AbortSignal,
): Promise<readonly YouTubeOwnedPlaylist[]> {
  return decodeYouTubeOwnedPlaylistResponse(
    await request("/api/ambient-media/youtube/account/playlists", "GET", signal),
  );
}
export async function disconnectYouTubeAccount(signal?: AbortSignal): Promise<void> {
  await request("/api/ambient-media/youtube/account", "DELETE", signal);
}
