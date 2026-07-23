import type {
  AmbientMediaPresetPlacement,
  AmbientMediaPresetSize,
  YouTubeSource,
} from "@cafecode/contracts/settings";

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_PLAYLIST_ID = /^[A-Za-z0-9_-]{10,80}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
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
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    const hostname = url.hostname.toLowerCase();
    if (hostname === "youtu.be") {
      const videoId = validVideoId(url.pathname.split("/").find((part) => part.length > 0));
      return videoId ? { kind: "video", id: videoId } : null;
    }
    if (!YOUTUBE_HOSTS.has(hostname)) {
      return null;
    }

    const playlistId = validPlaylistId(url.searchParams.get("list"));
    const pathParts = url.pathname.split("/").filter(Boolean);
    const pathVideoId =
      pathParts[0] === "embed" || pathParts[0] === "shorts" || pathParts[0] === "live"
        ? validVideoId(pathParts[1])
        : null;
    const queryVideoId = url.pathname === "/watch" ? validVideoId(url.searchParams.get("v")) : null;
    const videoId = queryVideoId ?? pathVideoId;

    // An explicit playlist URL represents the playlist. A watch URL with both
    // values represents the selected video, matching what the user pasted.
    if (url.pathname === "/playlist") {
      return playlistId ? { kind: "playlist", id: playlistId } : null;
    }
    if (videoId) {
      return { kind: "video", id: videoId };
    }
    return playlistId ? { kind: "playlist", id: playlistId } : null;
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
    : `https://www.youtube.com/playlist?list=${source.id}`;
}

export function youtubeEmbedUrl(source: Exclude<YouTubeSource, null>): string {
  const base = "https://www.youtube-nocookie.com";
  const parameters = new URLSearchParams({
    enablejsapi: "1",
    playsinline: "1",
    rel: "0",
  });
  if (typeof window !== "undefined" && window.location.origin !== "null") {
    parameters.set("origin", window.location.origin);
  }
  return source.kind === "video"
    ? `${base}/embed/${source.id}?${parameters.toString()}`
    : `${base}/embed/videoseries?list=${source.id}&${parameters.toString()}`;
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

export function ambientVideoPresetPosition(
  placement: AmbientMediaPresetPlacement,
): Readonly<Record<string, string>> {
  return placement === "bottom-left"
    ? { left: "1rem", bottom: "1rem" }
    : { right: "1rem", bottom: "1rem" };
}
