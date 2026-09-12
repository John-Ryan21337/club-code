import type { SpotifyEntityType, SpotifySource } from "@cafecode/contracts/settings";

export const SPOTIFY_ENTITY_TYPES: ReadonlyArray<SpotifyEntityType> = [
  "album",
  "artist",
  "episode",
  "playlist",
  "show",
  "track",
] as const;

const SPOTIFY_HOSTS = new Set(["open.spotify.com", "play.spotify.com"]);
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_INTL_PATH_SEGMENT = /^intl-[a-z]{2}(?:-[a-z]{2})?$/i;
const SPOTIFY_ENTITY_TYPE_SET = new Set<string>(SPOTIFY_ENTITY_TYPES);

function spotifyEntityType(value: unknown): SpotifyEntityType | null {
  return typeof value === "string" && SPOTIFY_ENTITY_TYPE_SET.has(value)
    ? (value as SpotifyEntityType)
    : null;
}

function spotifyId(value: unknown): string | null {
  return typeof value === "string" && SPOTIFY_ID.test(value) ? value : null;
}

function checkedSpotifySource(source: SpotifySource): SpotifySource {
  const entityType = spotifyEntityType(source?.entityType);
  const id = spotifyId(source?.id);
  if (source?.kind !== "spotify" || !entityType || !id) {
    // This protects the final iframe/source construction boundary even if a
    // caller bypasses the contracts decoder with an unsound type assertion.
    throw new TypeError("Invalid Spotify source");
  }
  return { kind: "spotify", entityType, id };
}

/**
 * Accept only canonical Spotify entity URLs/URIs, then discard every pasted
 * query parameter. The embed never receives arbitrary user-controlled paths.
 */
export function parseSpotifySource(input: string): SpotifySource | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const uriParts = trimmed.split(":");
  if (uriParts.length === 3 && uriParts[0] === "spotify") {
    const entityType = spotifyEntityType(uriParts[1]);
    const id = spotifyId(uriParts[2]);
    return entityType && id ? { kind: "spotify", entityType, id } : null;
  }

  try {
    const url = new URL(trimmed);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !SPOTIFY_HOSTS.has(url.hostname.toLowerCase()) ||
      url.pathname.includes("//")
    ) {
      return null;
    }
    const pathParts = url.pathname.split("/").filter(Boolean);
    const entityOffset = SPOTIFY_INTL_PATH_SEGMENT.test(pathParts[0] ?? "") ? 1 : 0;
    if (pathParts[entityOffset] === "embed") {
      pathParts.splice(entityOffset, 1);
    }
    const entityType = spotifyEntityType(pathParts[entityOffset]);
    const id = spotifyId(pathParts[entityOffset + 1]);
    return entityType && id && pathParts.length === entityOffset + 2
      ? { kind: "spotify", entityType, id }
      : null;
  } catch {
    return null;
  }
}

export function spotifySourceInputValue(source: SpotifySource): string {
  const normalized = checkedSpotifySource(source);
  return `https://open.spotify.com/${normalized.entityType}/${normalized.id}`;
}

export function spotifyEmbedUrl(source: SpotifySource): string {
  const normalized = checkedSpotifySource(source);
  return `https://open.spotify.com/embed/${normalized.entityType}/${normalized.id}`;
}
