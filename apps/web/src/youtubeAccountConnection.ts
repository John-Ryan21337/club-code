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
  constructor(readonly code: string) {
    super(
      code === "not-connected"
        ? "Connect your YouTube account before loading owned playlists."
        : code === "unavailable"
          ? "YouTube account connection is unavailable in this Club Code session."
          : code === "invalid-response"
            ? "Club Code received an invalid YouTube account response."
            : "Club Code could not reach the YouTube account connector.",
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

async function request(path: string, init: RequestInit): Promise<Response> {
  return fetch(resolvePrimaryEnvironmentHttpUrl(path), {
    ...init,
    credentials: "include",
  }).catch(() => {
    throw new YouTubeAccountConnectionRequestError("request-failed");
  });
}

async function throwResponseError(response: Response): Promise<never> {
  const value: unknown = await response.json().catch(() => null);
  const code = isRecord(value) && typeof value.error === "string" ? value.error : "request-failed";
  throw new YouTubeAccountConnectionRequestError(code);
}

export async function startYouTubeAccountConnection(): Promise<YouTubeAccountConnectionStatus> {
  const response = await request("/api/ambient-media/youtube/account/start", {
    method: "POST",
  });
  if (!response.ok) return throwResponseError(response);
  return decodeStatus(await response.json().catch(() => null));
}

export async function getYouTubeAccountConnectionStatus(): Promise<YouTubeAccountConnectionStatus> {
  const response = await request("/api/ambient-media/youtube/account/status", {
    method: "GET",
  });
  if (!response.ok) return throwResponseError(response);
  return decodeStatus(await response.json().catch(() => null));
}

export async function listYouTubeOwnedPlaylists(): Promise<readonly YouTubeOwnedPlaylist[]> {
  const response = await request("/api/ambient-media/youtube/account/playlists", {
    method: "GET",
  });
  if (!response.ok) return throwResponseError(response);
  return decodeYouTubeOwnedPlaylistResponse(await response.json().catch(() => null));
}

export async function disconnectYouTubeAccount(): Promise<void> {
  const response = await request("/api/ambient-media/youtube/account", {
    method: "DELETE",
  });
  if (!response.ok) return throwResponseError(response);
}
