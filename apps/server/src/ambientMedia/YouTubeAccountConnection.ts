import { createHash, randomBytes } from "node:crypto";

import type { AuthSessionId } from "@cafecode/contracts/auth";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as DateTime from "effect/DateTime";
import { SessionCredentialService } from "../auth/Services/SessionCredentialService.ts";

import { ServerConfig } from "../config.ts";
import { ExternalLauncher } from "../process/externalLauncher.ts";

const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
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

interface SessionEpoch {
  readonly controller: AbortController;
  readonly expiresAt: number;
}

interface PendingAuthorization {
  readonly epoch: SessionEpoch;
  readonly sessionId: AuthSessionId;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly expiresAt: number;
}

interface SessionGrant {
  readonly epoch: SessionEpoch;
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly grantedScopes: ReadonlySet<string>;
  readonly expiresAt: number;
  readonly connectedAt: number;
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
  readonly status: (
    sessionId: AuthSessionId,
  ) => Effect.Effect<YouTubeAccountConnectionStatus, YouTubeAccountConnectionError>;
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

async function readBoundedJson(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new RangeError("upstream response is too large");
  }
  if (!response.body) throw new TypeError("upstream response body is missing");
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        cancel();
        throw new RangeError("upstream response is too large");
      }
      chunks.push(value);
    }
  } finally {
    cancel();
    signal.removeEventListener("abort", cancel);
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
    value.token_type !== "Bearer" ||
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

/** Memory-only, session-bound OAuth. Google revocation is project-wide, so
 * replacement, disconnect and shutdown only retire this server's local grants.
 * Protocol reference: https://developers.google.com/identity/protocols/oauth2/native-app */
export function makeYouTubeAccountConnection(input: {
  readonly enabled: boolean;
  readonly clientId: string | undefined;
  readonly redirectUri: string;
  readonly fetch?: FetchLike;
  readonly launchBrowser: (target: string) => Effect.Effect<void, unknown>;
  readonly isOwnerSessionActive?: (sessionId: AuthSessionId) => Effect.Effect<boolean, unknown>;
  readonly now?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
}): YouTubeAccountConnectionShape {
  const clientId = input.clientId?.trim();
  const fetch = input.fetch ?? globalThis.fetch.bind(globalThis);
  const now = input.now ?? Date.now;
  const random = input.randomBytes ?? randomBytes;
  const pending = new Map<string, PendingAuthorization>();
  const grants = new Map<AuthSessionId, SessionGrant>();
  const epochs = new Map<AuthSessionId, SessionEpoch>();
  const startRates = new Map<AuthSessionId, { started: number; count: number }>();
  const shutdownController = new AbortController();
  let closed = false;
  let busy = false;
  let activeUpstream = false;
  let globalStarts = { started: now(), count: 0 };
  let validRedirect = false;
  try {
    const redirect = new URL(input.redirectUri);
    validRedirect =
      redirect.protocol === "http:" &&
      redirect.hostname === "127.0.0.1" &&
      !redirect.username &&
      !redirect.password &&
      !redirect.search &&
      !redirect.hash &&
      redirect.pathname === "/" &&
      Number(redirect.port) > 0;
  } catch {
    /* Invalid configuration leaves connection disabled. */
  }
  const available =
    input.enabled &&
    validRedirect &&
    typeof clientId === "string" &&
    /^[A-Za-z0-9_-]{1,220}\.apps\.googleusercontent\.com$/u.test(clientId);

  const removePending = (sessionId: AuthSessionId) => {
    for (const [digest, entry] of pending)
      if (entry.sessionId === sessionId) pending.delete(digest);
  };
  const retire = (sessionId: AuthSessionId) => {
    epochs.get(sessionId)?.controller.abort();
    epochs.delete(sessionId);
    grants.delete(sessionId);
    removePending(sessionId);
  };
  const sweep = () => {
    for (const [id, epoch] of epochs) if (epoch.expiresAt <= now()) retire(id);
    for (const [digest, entry] of pending) {
      if (entry.expiresAt <= now()) {
        pending.delete(digest);
        if (!grants.has(entry.sessionId)) retire(entry.sessionId);
      }
    }
  };
  const current = (sessionId: AuthSessionId, epoch: SessionEpoch) =>
    !closed &&
    epochs.get(sessionId) === epoch &&
    epoch.expiresAt > now() &&
    !epoch.controller.signal.aborted;
  const verifyEpoch = (sessionId: AuthSessionId, epoch: SessionEpoch) =>
    Effect.gen(function* () {
      if (!current(sessionId, epoch)) return yield* connectionError("not-connected");
      const owner = yield* (input.isOwnerSessionActive?.(sessionId) ?? Effect.succeed(true)).pipe(
        Effect.orElseSucceed(() => false),
      );
      if (!owner || !current(sessionId, epoch)) {
        if (epochs.get(sessionId) === epoch) retire(sessionId);
        return yield* connectionError("not-connected");
      }
    });
  const operation = <A>(body: Effect.Effect<A, YouTubeAccountConnectionError, Scope.Scope>) =>
    Effect.gen(function* () {
      if (closed || busy) return yield* connectionError("unavailable");
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          busy = true;
        }),
        () =>
          Effect.sync(() => {
            busy = false;
          }),
      );
      return yield* body.pipe(
        Effect.timeoutOrElse({
          duration: 15_000,
          orElse: () => Effect.fail(connectionError("upstream-unavailable")),
        }),
      );
    }).pipe(Effect.scoped);

  // Keep actual fetch/body ownership until settlement even if injected fetch
  // ignores AbortSignal. This prevents repeated deadlines from creating workers.
  const requestJson = (url: string, init: RequestInit, maxBytes: number, epoch: SessionEpoch) =>
    Effect.tryPromise({
      try: async (effectSignal) => {
        if (activeUpstream) throw connectionError("unavailable");
        activeUpstream = true;
        const signal = AbortSignal.any([
          effectSignal,
          epoch.controller.signal,
          shutdownController.signal,
        ]);
        try {
          const response = await fetch(url, {
            ...init,
            credentials: "omit",
            referrerPolicy: "no-referrer",
            redirect: "error",
            signal,
          });
          if (response.redirected || signal.aborted) {
            void response.body?.cancel().catch(() => undefined);
            throw connectionError("upstream-unavailable");
          }
          const body = await readBoundedJson(response, maxBytes, signal);
          if (!response.ok || signal.aborted) throw connectionError("upstream-unavailable");
          return body;
        } finally {
          activeUpstream = false;
        }
      },
      catch: () => connectionError("upstream-unavailable"),
    }).pipe(
      Effect.timeoutOrElse({
        duration: UPSTREAM_TIMEOUT_MS,
        orElse: () => Effect.fail(connectionError("upstream-unavailable")),
      }),
    );
  const exchange = (parameters: URLSearchParams, epoch: SessionEpoch) =>
    Effect.gen(function* () {
      const body = yield* requestJson(
        GOOGLE_TOKEN_ENDPOINT,
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: parameters.toString(),
        },
        TOKEN_RESPONSE_MAX_BYTES,
        epoch,
      );
      const token = decodeTokenResponse(body);
      if (!token) return yield* connectionError("upstream-unavailable");
      return token;
    });
  const takeStartRate = (sessionId: AuthSessionId) => {
    const timestamp = now();
    if (timestamp - globalStarts.started >= 60_000) globalStarts = { started: timestamp, count: 0 };
    let rate = startRates.get(sessionId);
    if (!rate || timestamp - rate.started >= 60_000) rate = { started: timestamp, count: 0 };
    if (globalStarts.count >= 16 || rate.count >= 4) return false;
    rate.count += 1;
    globalStarts.count += 1;
    startRates.set(sessionId, rate);
    while (startRates.size > 64) startRates.delete(startRates.keys().next().value!);
    return true;
  };

  return {
    start: (sessionId, ownerSessionExpiresAt) =>
      operation(
        Effect.gen(function* () {
          if (
            !available ||
            !clientId ||
            (ownerSessionExpiresAt !== undefined &&
              (!Number.isFinite(ownerSessionExpiresAt) || ownerSessionExpiresAt <= now()))
          )
            return yield* connectionError("unavailable");
          sweep();
          if (
            (!epochs.has(sessionId) && epochs.size >= MAX_SESSION_GRANTS) ||
            pending.size >= MAX_PENDING_CONNECTIONS ||
            !takeStartRate(sessionId)
          )
            return yield* connectionError("unavailable");
          retire(sessionId);
          const epoch: SessionEpoch = {
            controller: new AbortController(),
            expiresAt: ownerSessionExpiresAt ?? now() + 24 * 60 * 60_000,
          };
          epochs.set(sessionId, epoch);
          yield* verifyEpoch(sessionId, epoch);
          const state = base64Url(random(32));
          const verifier = base64Url(random(32));
          const digest = stateDigest(state);
          pending.set(digest, {
            sessionId,
            epoch,
            codeVerifier: verifier,
            redirectUri: input.redirectUri,
            expiresAt: Math.min(now() + PENDING_TTL_MS, epoch.expiresAt),
          });
          const authorization = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
          for (const [key, value] of Object.entries({
            client_id: clientId,
            redirect_uri: input.redirectUri,
            response_type: "code",
            scope: YOUTUBE_READONLY_SCOPE,
            access_type: "offline",
            prompt: "consent",
            code_challenge: sha256Base64Url(verifier),
            code_challenge_method: "S256",
            state,
          }))
            authorization.searchParams.set(key, value);
          // Launcher spans may retain failed command arguments, including OAuth state.
          yield* input.launchBrowser(authorization.toString()).pipe(
            Effect.withTracerEnabled(false),
            Effect.mapError(() => connectionError("unavailable")),
            Effect.onExit((exit) =>
              Effect.sync(() => {
                if (exit._tag === "Failure" && epochs.get(sessionId) === epoch) retire(sessionId);
              }),
            ),
          );
          yield* verifyEpoch(sessionId, epoch);
          return { status: "pending" } as const;
        }),
      ),
    complete: ({ state, code }) =>
      operation(
        Effect.gen(function* () {
          if (
            !available ||
            !clientId ||
            !/^[A-Za-z0-9_-]{43}$/u.test(state) ||
            !safeText(code, 2048)
          )
            return yield* connectionError("invalid-callback");
          sweep();
          const digest = stateDigest(state);
          const authorization = pending.get(digest);
          if (!authorization) return yield* connectionError("invalid-callback");
          pending.delete(digest);
          const { sessionId, epoch } = authorization;
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              if (epochs.get(sessionId) === epoch && !grants.has(sessionId)) retire(sessionId);
            }),
          );
          yield* verifyEpoch(sessionId, epoch);
          const token = yield* exchange(
            new URLSearchParams({
              client_id: clientId,
              code,
              code_verifier: authorization.codeVerifier,
              grant_type: "authorization_code",
              redirect_uri: authorization.redirectUri,
            }),
            epoch,
          );
          yield* verifyEpoch(sessionId, epoch);
          if (!token.refreshToken || !token.grantedScopes?.has(YOUTUBE_READONLY_SCOPE))
            return yield* connectionError("upstream-unavailable");
          grants.set(sessionId, {
            epoch,
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            grantedScopes: token.grantedScopes,
            expiresAt: now() + token.expiresInSeconds * 1000,
            connectedAt: now(),
          });
        }),
      ),
    status: (sessionId) =>
      operation(
        Effect.gen(function* () {
          sweep();
          const epoch = epochs.get(sessionId);
          if (epoch) yield* verifyEpoch(sessionId, epoch);
          if (grants.has(sessionId)) return { status: "connected" } as const;
          if ([...pending.values()].some((entry) => entry.sessionId === sessionId))
            return { status: "pending" } as const;
          return { status: "disconnected" } as const;
        }),
      ),
    listOwnedPlaylists: (sessionId) =>
      operation(
        Effect.gen(function* () {
          if (!available || !clientId) return yield* connectionError("unavailable");
          sweep();
          let grant = grants.get(sessionId);
          if (!grant) return yield* connectionError("not-connected");
          const epoch = grant.epoch;
          yield* verifyEpoch(sessionId, epoch);
          if (grant.expiresAt <= now() + REFRESH_SKEW_MS) {
            const token = yield* exchange(
              new URLSearchParams({
                client_id: clientId,
                grant_type: "refresh_token",
                refresh_token: grant.refreshToken,
              }),
              epoch,
            );
            yield* verifyEpoch(sessionId, epoch);
            const grantedScopes = token.grantedScopes ?? grant.grantedScopes;
            if (!grantedScopes.has(YOUTUBE_READONLY_SCOPE)) {
              retire(sessionId);
              return yield* connectionError("not-connected");
            }
            grant = {
              ...grant,
              accessToken: token.accessToken,
              refreshToken: token.refreshToken ?? grant.refreshToken,
              grantedScopes,
              expiresAt: now() + token.expiresInSeconds * 1000,
            };
            grants.set(sessionId, grant);
          }
          const url = new URL(YOUTUBE_PLAYLISTS_ENDPOINT);
          url.searchParams.set("part", "snippet,contentDetails");
          url.searchParams.set("mine", "true");
          url.searchParams.set("maxResults", String(MAX_PLAYLISTS));
          const body = yield* requestJson(
            url.toString(),
            {
              method: "GET",
              headers: { Accept: "application/json", Authorization: "Bearer " + grant.accessToken },
            },
            PLAYLIST_RESPONSE_MAX_BYTES,
            epoch,
          );
          yield* verifyEpoch(sessionId, epoch);
          const playlists = decodeYouTubeOwnedPlaylists(body);
          if (!playlists) return yield* connectionError("upstream-unavailable");
          return playlists;
        }),
      ),
    // Disconnect and shutdown do not queue behind network work. Aborting the
    // exact epoch prevents late completions from restoring its private tokens.
    disconnect: (sessionId) => Effect.sync(() => retire(sessionId)),
    shutdown: () =>
      Effect.sync(() => {
        closed = true;
        shutdownController.abort();
        for (const id of epochs.keys()) retire(id);
        pending.clear();
        grants.clear();
        startRates.clear();
      }),
  };
}

export const YouTubeAccountConnectionLive = Layer.effect(
  YouTubeAccountConnection,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const launcher = yield* ExternalLauncher;
    const sessions = yield* SessionCredentialService;
    const service = makeYouTubeAccountConnection({
      enabled: config.youtubeAccountConnectionEnabled === true,
      clientId: config.youtubeOAuthDesktopClientId,
      redirectUri: "http://127.0.0.1:" + config.port,
      launchBrowser: launcher.launchBrowser,
      isOwnerSessionActive: (sessionId) =>
        sessions
          .listActive()
          .pipe(
            Effect.map((active) =>
              active.some(
                (session) =>
                  session.sessionId === sessionId &&
                  session.role === "owner" &&
                  DateTime.toEpochMillis(session.expiresAt) > Date.now(),
              ),
            ),
          ),
    });
    yield* Effect.addFinalizer(() => service.shutdown());
    return service;
  }),
);
