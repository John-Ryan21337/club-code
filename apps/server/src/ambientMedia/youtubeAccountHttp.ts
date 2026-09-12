import { isIP } from "node:net";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  HttpMiddleware,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { AuthError, ServerAuth } from "../auth/Services/ServerAuth.ts";
import { respondToAuthError } from "../auth/http.ts";
import { ServerConfig } from "../config.ts";
import { staticAndDevHandler } from "../http.ts";
import { browserApiCorsHeaders } from "../httpCors.ts";
import {
  YouTubeAccountConnection,
  YouTubeAccountConnectionError,
} from "./YouTubeAccountConnection.ts";

const privateHeaders = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

// The HTTP tracer reads the URL before route middleware runs. Install this at
// the serving layer, not on the callback handler. Omit all root-query spans,
// including rejected/oversized callbacks, and retain any existing exclusions.
export const youTubeAccountTracePrivacyLayer = Layer.effect(
  HttpMiddleware.TracerDisabledWhen,
  Effect.map(
    Effect.service(HttpMiddleware.TracerDisabledWhen),
    (previous) => (request: HttpServerRequest.HttpServerRequest) =>
      request.url.startsWith("/?") || previous(request),
  ),
);

/** The peer is observed by the server. Forwarded headers can only deny access;
 * they never establish local ownership or native-desktop identity. */
export function isDirectLoopbackAccountRequest(
  request: HttpServerRequest.HttpServerRequest,
): boolean {
  const address = Option.getOrUndefined(request.remoteAddress)?.toLowerCase();
  if (!address || !isIP(address)) return false;
  const loopback =
    address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
  return (
    loopback &&
    !["forwarded", "x-forwarded-for", "x-forwarded-proto", "x-cafe-code-https-proxy"].some(
      (key) => request.headers[key] !== undefined,
    )
  );
}

const requireLocalOwner = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const session = yield* (yield* ServerAuth).authenticateHttpRequest(request);
  if (session.role !== "owner" || !isDirectLoopbackAccountRequest(request))
    return yield* new AuthError({
      message: "YouTube account access requires the local server owner.",
      status: 403,
    });
  if (!(yield* ServerConfig).youtubeAccountConnectionEnabled)
    return yield* new YouTubeAccountConnectionError({ code: "unavailable", status: 503 });
  // A simple cross-origin form must not launch a browser or disconnect an owner.
  if (
    (request.method === "POST" || request.method === "DELETE") &&
    request.headers["content-type"] !== "application/json"
  )
    return yield* new YouTubeAccountConnectionError({ code: "unavailable", status: 400 });
  // These explicit actions accept neither request bodies nor query overrides.
  if (
    request.headers["transfer-encoding"] !== undefined ||
    Number(request.headers["content-length"] ?? "0") !== 0 ||
    request.url.includes("?")
  )
    return yield* new YouTubeAccountConnectionError({ code: "unavailable", status: 400 });
  return session;
});
const respondError = (error: YouTubeAccountConnectionError) =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      { error: error.code },
      { status: error.status, headers: { ...browserApiCorsHeaders, ...privateHeaders } },
    ),
  );
const route = <R>(
  body: Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    AuthError | YouTubeAccountConnectionError,
    R
  >,
) =>
  body.pipe(
    Effect.catchTag("AuthError", respondToAuthError),
    Effect.catchTag("YouTubeAccountConnectionError", respondError),
  );

const start = HttpRouter.add(
  "POST",
  "/api/ambient-media/youtube/account/start",
  route(
    Effect.gen(function* () {
      const session = yield* requireLocalOwner;
      const result = yield* (yield* YouTubeAccountConnection).start(
        session.sessionId,
        session.expiresAt ? DateTime.toEpochMillis(session.expiresAt) : undefined,
      );
      return HttpServerResponse.jsonUnsafe(result, {
        status: 202,
        headers: { ...browserApiCorsHeaders, ...privateHeaders },
      });
    }),
  ),
);
const status = HttpRouter.add(
  "GET",
  "/api/ambient-media/youtube/account/status",
  route(
    Effect.gen(function* () {
      const session = yield* requireLocalOwner;
      const result = yield* (yield* YouTubeAccountConnection).status(session.sessionId);
      return HttpServerResponse.jsonUnsafe(result, {
        headers: { ...browserApiCorsHeaders, ...privateHeaders },
      });
    }),
  ),
);
const playlists = HttpRouter.add(
  "GET",
  "/api/ambient-media/youtube/account/playlists",
  route(
    Effect.gen(function* () {
      const session = yield* requireLocalOwner;
      const playlists = yield* (yield* YouTubeAccountConnection).listOwnedPlaylists(
        session.sessionId,
      );
      return HttpServerResponse.jsonUnsafe(
        { playlists },
        { headers: { ...browserApiCorsHeaders, ...privateHeaders } },
      );
    }),
  ),
);
const disconnect = HttpRouter.add(
  "DELETE",
  "/api/ambient-media/youtube/account",
  route(
    Effect.gen(function* () {
      const session = yield* requireLocalOwner;
      yield* (yield* YouTubeAccountConnection).disconnect(session.sessionId);
      return HttpServerResponse.empty({
        status: 204,
        headers: { ...browserApiCorsHeaders, ...privateHeaders },
      });
    }),
  ),
);

const callback = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const parsed = yield* Effect.try({
    try: () => {
      if (request.url.length > 8192) throw new Error("oversized");
      return new URL(request.url, "http://127.0.0.1");
    },
    catch: () => new YouTubeAccountConnectionError({ code: "invalid-callback", status: 400 }),
  });
  if (
    !isDirectLoopbackAccountRequest(request) ||
    !(yield* ServerConfig).youtubeAccountConnectionEnabled ||
    parsed.searchParams.getAll("state").length !== 1 ||
    parsed.searchParams.getAll("code").length !== 1 ||
    parsed.searchParams.has("error")
  )
    return yield* new YouTubeAccountConnectionError({ code: "invalid-callback", status: 400 });
  yield* (yield* YouTubeAccountConnection).complete({
    state: parsed.searchParams.get("state")!,
    code: parsed.searchParams.get("code")!,
  });
  return HttpServerResponse.text("YouTube connected. Close this tab and return to Cafe Code.", {
    headers: privateHeaders,
  });
}).pipe(
  Effect.catchTag("YouTubeAccountConnectionError", (error) =>
    Effect.succeed(
      HttpServerResponse.text(
        error.code === "invalid-callback"
          ? "This YouTube connection request is invalid or has expired."
          : "YouTube could not be connected. Return to Cafe Code and try again.",
        { status: error.status, headers: privateHeaders },
      ),
    ),
  ),
);

// Google Desktop OAuth redirects to the loopback origin, without an app path.
// Reserve these root query fields and suppress URL logging before handling a
// callback; ordinary root requests retain the existing SPA/dev behavior.
const root = HttpRouter.add(
  "GET",
  "/",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (request.url.length > 8192)
      return HttpServerResponse.text("This request is too long.", {
        status: 400,
        headers: privateHeaders,
      });
    const query = request.url.split("?", 2)[1];
    const parameters = new URLSearchParams(query);
    if (["state", "code", "error"].some((key) => parameters.has(key))) return yield* callback;
    return yield* staticAndDevHandler;
  }),
).pipe(Layer.provide(HttpRouter.disableLogger));

export const youTubeAccountRoutesLayer = Layer.mergeAll(start, status, playlists, disconnect, root);
