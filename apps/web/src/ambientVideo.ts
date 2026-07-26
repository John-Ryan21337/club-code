import type { YouTubeSource } from "@cafecode/contracts/settings";

const MAX_YOUTUBE_SOURCE_INPUT_LENGTH = 2_048;
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PLAYLIST_ID = /^[A-Za-z0-9_-]{10,80}$/;
const YOUTUBE_WATCH_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
]);
const YOUTUBE_EMBED_HOSTS = new Set([
  ...YOUTUBE_WATCH_HOSTS,
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);

function validVideoId(value: string | null | undefined): string | null {
  return value && YOUTUBE_VIDEO_ID.test(value) ? value : null;
}

function validPlaylistId(value: string | null | undefined): string | null {
  return value && YOUTUBE_PLAYLIST_ID.test(value) ? value : null;
}

/**
 * Accept only documented HTTPS YouTube URL shapes and bare video IDs. The
 * normalized result is safe to persist; arbitrary pasted URLs never cross the
 * settings boundary.
 */
export function parseYouTubeSource(input: string): YouTubeSource {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_YOUTUBE_SOURCE_INPUT_LENGTH) {
    return null;
  }

  const bareVideo = validVideoId(trimmed);
  if (bareVideo) {
    return { kind: "video", id: bareVideo };
  }

  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.port.length > 0
    ) {
      return null;
    }

    const hostname = url.hostname.toLowerCase();
    const rawPlaylistId = url.searchParams.get("list");
    const playlistId = validPlaylistId(rawPlaylistId);
    if (rawPlaylistId !== null && playlistId === null) {
      return null;
    }

    if (hostname === "youtu.be") {
      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts.length !== 1) return null;
      const videoId = validVideoId(pathParts[0]);
      if (videoId === null) return null;
      return playlistId
        ? { kind: "playlist", id: playlistId, videoId }
        : { kind: "video", id: videoId };
    }

    if (!YOUTUBE_EMBED_HOSTS.has(hostname)) {
      return null;
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/playlist" && YOUTUBE_WATCH_HOSTS.has(hostname)) {
      return playlistId ? { kind: "playlist", id: playlistId } : null;
    }

    if (url.pathname === "/watch" && YOUTUBE_WATCH_HOSTS.has(hostname)) {
      const videoId = validVideoId(url.searchParams.get("v"));
      if (videoId === null) return null;
      return playlistId
        ? { kind: "playlist", id: playlistId, videoId }
        : { kind: "video", id: videoId };
    }

    if (pathParts.length === 2 && pathParts[0] === "embed" && pathParts[1] === "videoseries") {
      return playlistId ? { kind: "playlist", id: playlistId } : null;
    }

    const supportsVideoPath =
      pathParts.length === 2 &&
      (pathParts[0] === "embed" ||
        (YOUTUBE_WATCH_HOSTS.has(hostname) &&
          (pathParts[0] === "shorts" || pathParts[0] === "live")));
    if (!supportsVideoPath) return null;

    const videoId = validVideoId(pathParts[1]);
    if (videoId === null) return null;
    return playlistId
      ? { kind: "playlist", id: playlistId, videoId }
      : { kind: "video", id: videoId };
  } catch {
    return null;
  }
}

export function youtubeSourceInputValue(source: YouTubeSource): string {
  if (source === null) return "";
  return source.kind === "video"
    ? `https://www.youtube.com/watch?v=${source.id}`
    : source.videoId
      ? `https://www.youtube.com/watch?v=${source.videoId}&list=${source.id}`
      : `https://www.youtube.com/playlist?list=${source.id}`;
}

export function youtubeEmbedUrl(
  source: Exclude<YouTubeSource, null>,
  options: { readonly autoplay?: boolean } = {},
): string {
  const parameters = new URLSearchParams({
    enablejsapi: "1",
    playsinline: "1",
    rel: "0",
  });
  if (options.autoplay === true) {
    // Browsers still enforce their own audible-autoplay policy.
    parameters.set("autoplay", "1");
  }
  if (typeof window !== "undefined" && window.location.origin !== "null") {
    parameters.set("origin", window.location.origin);
  }
  if (source.kind === "video") {
    return `https://www.youtube-nocookie.com/embed/${source.id}?${parameters.toString()}`;
  }
  parameters.set("list", source.id);
  return source.videoId
    ? `https://www.youtube-nocookie.com/embed/${source.videoId}?${parameters.toString()}`
    : `https://www.youtube-nocookie.com/embed/videoseries?${parameters.toString()}`;
}
