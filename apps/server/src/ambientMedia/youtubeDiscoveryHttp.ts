import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { ServerAuth } from "../auth/Services/ServerAuth.ts";
import { respondToAuthError } from "../auth/http.ts";
import { ServerConfig } from "../config.ts";
import { browserApiCorsHeaders } from "../httpCors.ts";
import {
  YouTubePublicDiscovery,
  YouTubePublicDiscoveryError,
  parseYouTubeDiscoveryInput,
} from "./YouTubePublicDiscovery.ts";

const YOUTUBE_DISCOVERY_REQUEST_MAX_BYTES = 4096;
let activeRequests = 0;

function respondToYouTubePublicDiscoveryError(error: YouTubePublicDiscoveryError) {
  return Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      { error: error.code },
      { status: error.status, headers: { ...browserApiCorsHeaders, "cache-control": "no-store" } },
    ),
  );
}

export const youTubePublicDiscoveryRouteLayer = HttpRouter.add(
  "POST",
  "/api/ambient-media/youtube/search",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const session = yield* (yield* ServerAuth).authenticateHttpRequest(request);
    const config = yield* ServerConfig;
    if (!config.youtubePublicDiscoveryEnabled) {
      return yield* new YouTubePublicDiscoveryError({ code: "unavailable", status: 503 });
    }
    yield* Effect.acquireRelease(
      Effect.suspend(() =>
        activeRequests >= 4
          ? Effect.fail(new YouTubePublicDiscoveryError({ code: "rate-limited", status: 429 }))
          : Effect.sync(() => {
              activeRequests += 1;
            }),
      ),
      () =>
        Effect.sync(() => {
          activeRequests -= 1;
        }),
    );
    const contentLength = Number.parseInt(request.headers["content-length"] ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > YOUTUBE_DISCOVERY_REQUEST_MAX_BYTES) {
      return yield* new YouTubePublicDiscoveryError({
        code: "payload-too-large",
        status: 413,
      });
    }
    const bodyBytes = yield* request.arrayBuffer.pipe(
      Effect.timeoutOrElse({
        duration: 8_000,
        orElse: () =>
          Effect.fail(new YouTubePublicDiscoveryError({ code: "unavailable", status: 503 })),
      }),
      // Read one byte beyond the accepted size so chunked and underreported
      // requests get the same explicit 413 as Content-Length fast rejects.
      Effect.provideService(
        HttpServerRequest.MaxBodySize,
        FileSystem.Size(YOUTUBE_DISCOVERY_REQUEST_MAX_BYTES + 1),
      ),
      Effect.mapError((error) =>
        error instanceof YouTubePublicDiscoveryError
          ? error
          : new YouTubePublicDiscoveryError({
              code: "payload-too-large",
              status: 413,
            }),
      ),
    );
    if (bodyBytes.byteLength > YOUTUBE_DISCOVERY_REQUEST_MAX_BYTES) {
      return yield* new YouTubePublicDiscoveryError({
        code: "payload-too-large",
        status: 413,
      });
    }
    const body = yield* Effect.try({
      try: () => JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes)) as unknown,
      catch: () => new YouTubePublicDiscoveryError({ code: "invalid-query", status: 400 }),
    });
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return yield* new YouTubePublicDiscoveryError({ code: "invalid-query", status: 400 });
    }
    const record = body as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "query" && key !== "maxResults"))
      return yield* new YouTubePublicDiscoveryError({ code: "invalid-query", status: 400 });
    const maxResults =
      record.maxResults === undefined
        ? null
        : typeof record.maxResults === "number" && Number.isInteger(record.maxResults)
          ? String(record.maxResults)
          : "";
    const input = parseYouTubeDiscoveryInput({
      query: typeof record.query === "string" ? record.query : null,
      maxResults,
    });
    if (!input)
      return yield* new YouTubePublicDiscoveryError({ code: "invalid-query", status: 400 });
    const results = yield* (yield* YouTubePublicDiscovery).search({
      query: input.query,
      maxResults: input.maxResults,
      // The authenticated session fixes the rate-limit identity; forwarding
      // headers and client-provided identifiers are never used.
      clientId: session.sessionId,
    });
    return HttpServerResponse.jsonUnsafe(
      { results },
      { status: 200, headers: { ...browserApiCorsHeaders, "cache-control": "no-store" } },
    );
  }).pipe(
    Effect.scoped,
    Effect.catchTag("AuthError", respondToAuthError),
    Effect.catchTag("YouTubePublicDiscoveryError", respondToYouTubePublicDiscoveryError),
  ),
);
