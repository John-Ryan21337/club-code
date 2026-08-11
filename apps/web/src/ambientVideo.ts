import type {
  AmbientVideoGlowMode,
  AmbientVideoSource,
  AmbientMediaPresetPlacement,
  AmbientMediaPresetSize,
  YouTubeSource,
} from "@cafecode/contracts/settings";

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
 * Parse only documented YouTube URL shapes and bare IDs. The result is the
 * complete atomic settings value; callers never persist an arbitrary URL.
 */
export function parseYouTubeSource(input: string): YouTubeSource {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
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
    if (rawPlaylistId !== null && playlistId === null) return null;

    if (hostname === "youtu.be") {
      const pathParts = url.pathname.split("/").filter(Boolean);
      if (pathParts.length !== 1) return null;
      const videoId = validVideoId(pathParts[0]);
      if (videoId === null) return null;
      if (playlistId) {
        return { kind: "playlist", id: playlistId, videoId };
      }
      return { kind: "video", id: videoId };
    }
    if (!YOUTUBE_EMBED_HOSTS.has(hostname)) {
      return null;
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/playlist" && YOUTUBE_WATCH_HOSTS.has(hostname)) {
      return playlistId ? { kind: "playlist", id: playlistId } : null;
    }

    if (url.pathname === "/watch" && YOUTUBE_WATCH_HOSTS.has(hostname)) {
      const rawVideoId = url.searchParams.get("v");
      const videoId = validVideoId(rawVideoId);
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
  if (source === null) {
    return "";
  }
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
  const base = "https://www.youtube-nocookie.com";
  const parameters = new URLSearchParams({
    enablejsapi: "1",
    playsinline: "1",
    rel: "0",
  });
  if (options.autoplay === true) {
    // This is a playback request, not a policy bypass. Browsers may still
    // require the user to start audible playback.
    parameters.set("autoplay", "1");
  }
  if (typeof window !== "undefined" && window.location.origin !== "null") {
    parameters.set("origin", window.location.origin);
  }
  if (source.kind === "video") {
    return `${base}/embed/${source.id}?${parameters.toString()}`;
  }
  parameters.set("list", source.id);
  return source.videoId
    ? `${base}/embed/${source.videoId}?${parameters.toString()}`
    : `${base}/embed/videoseries?${parameters.toString()}`;
}

export function ambientVideoSourceSupportsPlaylistNavigation(source: AmbientVideoSource): boolean {
  return source?.kind === "playlist";
}

export const AMBIENT_VIDEO_PRESET_WIDTHS: Readonly<Record<AmbientMediaPresetSize, number>> = {
  small: 360,
  medium: 480,
  large: 640,
};

export const AMBIENT_VIDEO_CINEMA_MIN_WIDTH = 712;
export const AMBIENT_VIDEO_CINEMA_MIN_HEIGHT = 264;

export function ambientVideoCinemaLayoutFits(width: number, height: number): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width >= AMBIENT_VIDEO_CINEMA_MIN_WIDTH &&
    height >= AMBIENT_VIDEO_CINEMA_MIN_HEIGHT
  );
}

export function ambientVideoPlayerShouldMount(
  locallyRenderable: boolean,
  floatingVisible: boolean,
  cinemaEffective: boolean,
): boolean {
  return locallyRenderable && (floatingVisible || cinemaEffective);
}

/**
 * Artwork sampling is an external media request. Keep it behind the same
 * explicit playback toggle as the player so changing a saved source or glow
 * style cannot contact YouTube while ambient video is off.
 */
export function ambientVideoAdaptiveArtworkShouldLoad(
  videoEnabled: boolean,
  glowEnabled: boolean,
  glowMode: AmbientVideoGlowMode,
  source: AmbientVideoSource,
): boolean {
  return (
    videoEnabled &&
    glowEnabled &&
    glowMode === "adaptive" &&
    source !== null &&
    source.kind !== "spotify"
  );
}

export function ambientVideoPresetPosition(
  placement: AmbientMediaPresetPlacement,
): Readonly<Record<string, string>> {
  return placement === "bottom-left"
    ? { left: "1rem", bottom: "1rem" }
    : { right: "1rem", bottom: "1rem" };
}
