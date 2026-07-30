import { createHash, randomBytes } from "node:crypto";

import type { AuthSessionId } from "@cafecode/contracts/auth";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../config.ts";
import { ExternalLauncher } from "../process/externalLauncher.ts";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const YOUTUBE_PLAYLISTS_ENDPOINT = "https://www.googleapis.com/youtube/v3/playlists";
const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const PENDING_TTL_MS = 10 * 60 * 1_000;
const MAX_PENDING_CONNECTIONS = 32;
const MAX_SESSION_GRANTS = 32;
const TOKEN_RESPONSE_MAX_BYTES = 16 * 1_024;
const PLAYLIST_RESPONSE_MAX_BYTES = 128 * 1_024;
const UPSTREAM_TIMEOUT_MS = 10_000;
const REFRESH_SKEW_MS = 60_000;
const MAX_PLAYLISTS = 50;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

interface PendingAuthorization {
  readonly sessionId: AuthSessionId;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly expiresAt: number;
  readonly ownerSessionExpiresAt?: number;
}

interface SessionGrant {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly grantedScopes: ReadonlySet<string>;
  readonly expiresAt: number;
  readonly connectedAt: number;
  readonly ownerSessionExpiresAt?: number;
}

export interface YouTubeOwnedPlaylist {
  readonly id: string;
  readonly title: string;
  readonly itemCount: number;
}

export interface YouTubeAccountConnectionStatus {
  readonly status: "disconnected" | "pending" | "connected";
}

export class YouTubeAccountConnectionError extends Data.TaggedError(
  "YouTubeAccountConnectionError",
)<{
  readonly code: "unavailable" | "invalid-callback" | "not-connected" | "upstream-unavailable";
  readonly status: 400 | 409 | 502 | 503;
}> {}

export interface YouTubeAccountConnectionShape {
  readonly start: (
    sessionId: AuthSessionId,
    ownerSessionExpiresAt?: number,
  ) => Effect.Effect<YouTubeAccountConnectionStatus, YouTubeAccountConnectionError>;
  readonly complete: (input: {
    readonly state: string;
    readonly code: string;
  }) => Effect.Effect<void, YouTubeAccountConnectionError>;
  readonly status: (sessionId: AuthSessionId) => Effect.Effect<YouTubeAccountConnectionStatus>;
  readonly listOwnedPlaylists: (
    sessionId: AuthSessionId,
  ) => Effect.Effect<ReadonlyArray<YouTubeOwnedPlaylist>, YouTubeAccountConnectionError>;
  readonly disconnect: (sessionId: AuthSessionId) => Effect.Effect<void>;
  readonly shutdown: () => Effect.Effect<void>;
}

export class YouTubeAccountConnection extends Context.Service<
  YouTubeAccountConnection,
  YouTubeAccountConnectionShape
>()("cafecode/ambientMedia/YouTubeAccountConnection") {}

function connectionError(
  code: YouTubeAccountConnectionError["code"],
): YouTubeAccountConnectionError {
  switch (code) {
    case "invalid-callback":
      return new YouTubeAccountConnectionError({ code, status: 400 });
    case "not-connected":
      return new YouTubeAccountConnectionError({ code, status: 409 });
    case "upstream-unavailable":
      return new YouTubeAccountConnectionError({ code, status: 502 });
    case "unavailable":
      return new YouTubeAccountConnectionError({ code, status: 503 });
  }
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

function stateDigest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
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
      const point = character.codePointAt(0) ?? 0;
      return point <= 0x1f || point === 0x7f;
    })
  ) {
    return null;
  }
  return normalized;
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RangeError("upstream response is too large");
  }
  if (!response.body) throw new TypeError("upstream response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new RangeError("upstream response is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

interface DecodedTokenResponse {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresInSeconds: number;
  readonly grantedScopes?: ReadonlySet<string>;
}

function decodeTokenResponse(value: unknown): DecodedTokenResponse | null {
  if (!isRecord(value)) return null;
  const accessToken = safeText(value.access_token, 4_096);
  const refreshToken =
    value.refresh_token === undefined ? undefined : safeText(value.refresh_token, 4_096);
  const expiresIn = value.expires_in;
  if (
    !accessToken ||
    (value.refresh_token !== undefined && !refreshToken) ||
    typeof expiresIn !== "number" ||
    !Number.isInteger(expiresIn) ||
    expiresIn < 60 ||
    expiresIn > 86_400
  ) {
    return null;
  }
  const scopeText = value.scope === undefined ? undefined : safeText(value.scope, 2_048);
  if (value.scope !== undefined && !scopeText) return null;
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    expiresInSeconds: expiresIn,
    ...(scopeText ? { grantedScopes: new Set(scopeText.split(/\s+/u)) } : {}),
  };
}

export function decodeYouTubeOwnedPlaylists(
  value: unknown,
): ReadonlyArray<YouTubeOwnedPlaylist> | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const playlists: YouTubeOwnedPlaylist[] = [];
  const seen = new Set<string>();
  for (const item of value.items) {
    if (playlists.length >= MAX_PLAYLISTS || !isRecord(item)) continue;
    const id = safeText(item.id, 80);
    const snippet = isRecord(item.snippet) ? item.snippet : null;
    const contentDetails = isRecord(item.contentDetails) ? item.contentDetails : null;
    const title = safeText(snippet?.title, 200);
    const itemCount = contentDetails?.itemCount;
    if (
      !id ||
      !/^[A-Za-z0-9_-]{10,80}$/u.test(id) ||
      !title ||
      typeof itemCount !== "number" ||
      !Number.isSafeInteger(itemCount) ||
      itemCount < 0 ||
      seen.has(id)
    ) {
      continue;
    }
    seen.add(id);
    playlists.push({ id, title, itemCount });
  }
  return playlists;
}

export function makeYouTubeAccountConnection(input: {
  readonly enabled: boolean;
  readonly clientId: string | undefined;
  readonly redirectUri: string;
  readonly fetch?: FetchLike;
  readonly launchBrowser: (target: string) => Effect.Effect<void, unknown>;
  readonly now?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
}): YouTubeAccountConnectionShape {
  const clientId = input.clientId?.trim() || undefined;
  const fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  const now = input.now ?? Date.now;
  const random = input.randomBytes ?? randomBytes;
  const pending = new Map<string, PendingAuthorization>();
  const grants = new Map<AuthSessionId, SessionGrant>();
  const mutationSemaphore = Semaphore.makeUnsafe(1);

  const available = input.enabled && clientId !== undefined;

  const sweepPending = () => {
    const timestamp = now();
    for (const [digest, entry] of pending) {
      if (entry.expiresAt <= timestamp) pending.delete(digest);
    }
  };

  const removePendingForSession = (sessionId: AuthSessionId) => {
    for (const [digest, entry] of pending) {
      if (entry.sessionId === sessionId) pending.delete(digest);
    }
  };

  const revokeToken = (token: string) =>
    Effect.tryPromise({
      try: () =>
        fetch(GOOGLE_REVOKE_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ token }).toString(),
          redirect: "error",
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        }).then(() => undefined),
      catch: () => undefined,
    }).pipe(Effect.ignore);

  const exchangeToken = (parameters: URLSearchParams) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(GOOGLE_TOKEN_ENDPOINT, {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: parameters.toString(),
            redirect: "error",
            signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
          }),
        catch: () => connectionError("upstream-unavailable"),
      });
      const body = yield* Effect.tryPromise({
        try: () => readBoundedJson(response, TOKEN_RESPONSE_MAX_BYTES),
        catch: () => connectionError("upstream-unavailable"),
      });
      if (!response.ok) return yield* connectionError("upstream-unavailable");
      const decoded = decodeTokenResponse(body);
      if (!decoded) return yield* connectionError("upstream-unavailable");
      return decoded;
    });

  const refreshGrant = (
    sessionId: AuthSessionId,
    grant: SessionGrant,
  ): Effect.Effect<SessionGrant, YouTubeAccountConnectionError> =>
    Effect.gen(function* () {
      if (!clientId) return yield* connectionError("unavailable");
      const refreshed = yield* exchangeToken(
        new URLSearchParams({
          client_id: clientId,
          grant_type: "refresh_token",
          refresh_token: grant.refreshToken,
        }),
      ).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            grants.delete(sessionId);
          }),
        ),
      );
      const nextGrant: SessionGrant = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? grant.refreshToken,
        grantedScopes: refreshed.grantedScopes ?? grant.grantedScopes,
        expiresAt: now() + refreshed.expiresInSeconds * 1_000,
        connectedAt: grant.connectedAt,
        ...(grant.ownerSessionExpiresAt !== undefined
          ? { ownerSessionExpiresAt: grant.ownerSessionExpiresAt }
          : {}),
      };
      if (!nextGrant.grantedScopes.has(YOUTUBE_READONLY_SCOPE)) {
        grants.delete(sessionId);
        return yield* connectionError("upstream-unavailable");
      }
      grants.set(sessionId, nextGrant);
      return nextGrant;
    });

  const currentGrant = (sessionId: AuthSessionId) =>
    Effect.gen(function* () {
      const grant = grants.get(sessionId);
      if (!grant) return yield* connectionError("not-connected");
      if (grant.ownerSessionExpiresAt !== undefined && grant.ownerSessionExpiresAt <= now()) {
        grants.delete(sessionId);
        yield* revokeToken(grant.refreshToken);
        return yield* connectionError("not-connected");
      }
      if (grant.expiresAt > now() + REFRESH_SKEW_MS) return grant;
      return yield* refreshGrant(sessionId, grant);
    });

  return {
    start: (sessionId, ownerSessionExpiresAt) =>
      mutationSemaphore.withPermit(
        Effect.gen(function* () {
          if (!available || !clientId) return yield* connectionError("unavailable");
          if (ownerSessionExpiresAt !== undefined && ownerSessionExpiresAt <= now()) {
            return yield* connectionError("unavailable");
          }
          sweepPending();
          removePendingForSession(sessionId);
          if (
            pending.size >= MAX_PENDING_CONNECTIONS ||
            (grants.size >= MAX_SESSION_GRANTS && !grants.has(sessionId))
          ) {
            return yield* connectionError("unavailable");
          }
          const state = base64Url(random(32));
          const verifier = base64Url(random(32));
          const digest = stateDigest(state);
          pending.set(digest, {
            sessionId,
            codeVerifier: verifier,
            redirectUri: input.redirectUri,
            expiresAt: Math.min(
              now() + PENDING_TTL_MS,
              ownerSessionExpiresAt ?? Number.POSITIVE_INFINITY,
            ),
            ...(ownerSessionExpiresAt !== undefined ? { ownerSessionExpiresAt } : {}),
          });
          const authorizationUrl = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
          authorizationUrl.searchParams.set("client_id", clientId);
          authorizationUrl.searchParams.set("redirect_uri", input.redirectUri);
          authorizationUrl.searchParams.set("response_type", "code");
          authorizationUrl.searchParams.set("scope", YOUTUBE_READONLY_SCOPE);
          authorizationUrl.searchParams.set("access_type", "offline");
          // A reconnect must receive a fresh refresh token even when this
          // account previously granted the same scope. The grant is deliberately
          // memory-only, so silently relying on Google's first-consent token
          // would make reconnect-after-restart fail.
          authorizationUrl.searchParams.set("prompt", "consent");
          authorizationUrl.searchParams.set("code_challenge", sha256Base64Url(verifier));
          authorizationUrl.searchParams.set("code_challenge_method", "S256");
          authorizationUrl.searchParams.set("state", state);
          yield* input.launchBrowser(authorizationUrl.toString()).pipe(
            Effect.mapError(() => connectionError("unavailable")),
            Effect.tapError(() =>
              Effect.sync(() => {
                pending.delete(digest);
              }),
            ),
          );
          return { status: "pending" } as const;
        }),
      ),

    complete: ({ state, code }) =>
      mutationSemaphore.withPermit(
        Effect.gen(function* () {
          if (!available || !clientId || !safeText(state, 512) || !safeText(code, 2_048)) {
            return yield* connectionError("invalid-callback");
          }
          sweepPending();
          const digest = stateDigest(state);
          const authorization = pending.get(digest);
          if (!authorization) return yield* connectionError("invalid-callback");
          pending.delete(digest);
          const token = yield* exchangeToken(
            new URLSearchParams({
              client_id: clientId,
              code,
              code_verifier: authorization.codeVerifier,
              grant_type: "authorization_code",
              redirect_uri: authorization.redirectUri,
            }),
          );
          if (!token.refreshToken || !token.grantedScopes?.has(YOUTUBE_READONLY_SCOPE)) {
            yield* revokeToken(token.refreshToken ?? token.accessToken);
            return yield* connectionError("upstream-unavailable");
          }
          if (grants.size >= MAX_SESSION_GRANTS && !grants.has(authorization.sessionId)) {
            yield* revokeToken(token.refreshToken);
            return yield* connectionError("unavailable");
          }
          const previous = grants.get(authorization.sessionId);
          grants.set(authorization.sessionId, {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            grantedScopes: token.grantedScopes,
            expiresAt: now() + token.expiresInSeconds * 1_000,
            connectedAt: now(),
            ...(authorization.ownerSessionExpiresAt !== undefined
              ? { ownerSessionExpiresAt: authorization.ownerSessionExpiresAt }
              : {}),
          });
          if (previous) yield* revokeToken(previous.refreshToken);
        }),
      ),

    status: (sessionId) =>
      mutationSemaphore.withPermit(
        Effect.gen(function* () {
          sweepPending();
          const grant = grants.get(sessionId);
          if (grant) {
            if (grant.ownerSessionExpiresAt !== undefined && grant.ownerSessionExpiresAt <= now()) {
              grants.delete(sessionId);
              yield* revokeToken(grant.refreshToken);
            } else {
              return { status: "connected" } as const;
            }
          }
          for (const entry of pending.values()) {
            if (entry.sessionId === sessionId) return { status: "pending" } as const;
          }
          return { status: "disconnected" } as const;
        }),
      ),

    listOwnedPlaylists: (sessionId) =>
      mutationSemaphore.withPermit(
        Effect.gen(function* () {
          if (!available) return yield* connectionError("unavailable");
          const grant = yield* currentGrant(sessionId);
          const url = new URL(YOUTUBE_PLAYLISTS_ENDPOINT);
          url.searchParams.set("part", "snippet,contentDetails");
          url.searchParams.set("mine", "true");
          url.searchParams.set("maxResults", String(MAX_PLAYLISTS));
          const response = yield* Effect.tryPromise({
            try: () =>
              fetch(url.toString(), {
                method: "GET",
                headers: {
                  Accept: "application/json",
                  Authorization: `Bearer ${grant.accessToken}`,
                },
                redirect: "error",
                signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
              }),
            catch: () => connectionError("upstream-unavailable"),
          });
          const body = yield* Effect.tryPromise({
            try: () => readBoundedJson(response, PLAYLIST_RESPONSE_MAX_BYTES),
            catch: () => connectionError("upstream-unavailable"),
          });
          if (!response.ok) return yield* connectionError("upstream-unavailable");
          const playlists = decodeYouTubeOwnedPlaylists(body);
          if (!playlists) return yield* connectionError("upstream-unavailable");
          return playlists;
        }),
      ),

    disconnect: (sessionId) =>
      mutationSemaphore.withPermit(
        Effect.gen(function* () {
          removePendingForSession(sessionId);
          const grant = grants.get(sessionId);
          grants.delete(sessionId);
          if (grant) yield* revokeToken(grant.refreshToken);
        }),
      ),

    shutdown: () =>
      mutationSemaphore.withPermit(
        Effect.gen(function* () {
          pending.clear();
          const refreshTokens = Array.from(grants.values(), (grant) => grant.refreshToken);
          grants.clear();
          yield* Effect.all(refreshTokens.map(revokeToken), {
            concurrency: 4,
            discard: true,
          });
        }),
      ),
  };
}

export const YouTubeAccountConnectionLive = Layer.effect(
  YouTubeAccountConnection,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const launcher = yield* ExternalLauncher;
    const service = makeYouTubeAccountConnection({
      enabled: config.ambientExperienceCapabilities.youtubeAccountConnection,
      clientId: config.youtubeOAuthDesktopClientId,
      // Google Desktop OAuth clients accept a loopback origin with a dynamic
      // port. Do not append an application path: Google rejects that shape
      // with redirect_uri_mismatch for this client type.
      redirectUri: `http://127.0.0.1:${config.port}`,
      launchBrowser: launcher.launchBrowser,
    });
    yield* Effect.addFinalizer(() => service.shutdown());
    return service;
  }),
);
