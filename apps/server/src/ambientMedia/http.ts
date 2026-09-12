/**
 * Authenticated HTTP surface for ambient images.
 *
 * Ambient images are decorative renderer assets, so the trust boundary is
 * deliberately narrow: the renderer may only upload bounded bytes, read back a
 * content-addressed id it was given, and delete an id that is no longer
 * referenced by the backend-authoritative client settings document. No client
 * path, filename or remote URL ever reaches the filesystem.
 */
import { MAX_AMBIENT_IMAGE_FILE_BYTES } from "@cafecode/contracts/settings";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { respondToAuthError } from "../auth/http.ts";
import { ServerAuth, AuthError } from "../auth/Services/ServerAuth.ts";
import { browserApiCorsHeaders } from "../httpCors.ts";
import { ServerClientSettingsService } from "../serverClientSettings.ts";
import {
  AMBIENT_IMAGE_ROUTE_PREFIX,
  AmbientImageError,
  AmbientImageStore,
  readStoredAmbientImage,
} from "./AmbientImageStore.ts";

// The shared CORS policy only advertises GET/POST/OPTIONS. Ambient images add a
// DELETE, so these routes advertise it themselves rather than widening the
// allowance for every other browser API route.
const headers = {
  ...browserApiCorsHeaders,
  "access-control-allow-methods": `${browserApiCorsHeaders["access-control-allow-methods"]}, DELETE`,
  "x-content-type-options": "nosniff",
};

// Admission is process-owned, not connection-owned: a renderer reconnect must
// not let a second wave of bodies past the memory bound while the first wave is
// still being read.
let activeUploads = 0;
const MAX_ACTIVE_UPLOADS = 2;

/** Any authenticated session may read bytes it was already handed a reference
 * to. This matches the sidebar branding asset route: client settings are one
 * backend-authoritative document, so a paired non-owner viewer that is told to
 * render an ambient image must be able to load it. */
const requireAuthenticated = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  yield* (yield* ServerAuth).authenticateHttpRequest(request);
});

/** Mutation stays owner-only: writing bytes into the profile and deleting them
 * again are not things a paired viewer should be able to do. */
const requireOwner = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const session = yield* (yield* ServerAuth).authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* new AuthError({
      message: "Owner access required.",
      status: 403,
    });
  }
});

const respondToAmbientImageError = (error: AmbientImageError) =>
  Effect.succeed(
    // Codes are a closed vocabulary and messages are authored here, so nothing
    // derived from the uploaded bytes or from a filesystem path is echoed back.
    HttpServerResponse.jsonUnsafe(
      { error: error.code, message: error.message },
      { status: error.status, headers },
    ),
  );

const requestedImageId = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);
  if (Option.isNone(url)) return null;
  const raw = url.value.pathname.slice(AMBIENT_IMAGE_ROUTE_PREFIX.length);
  if (!raw || raw.includes("/")) return null;
  // The store re-validates the id pattern before it touches the filesystem;
  // decoding here only normalizes a percent-encoded request line.
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
});

export const ambientImageUploadRouteLayer = HttpRouter.add(
  "POST",
  "/api/ambient-media/image",
  Effect.gen(function* () {
    yield* requireOwner;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const contentLengthHeader = request.headers["content-length"];
    if (contentLengthHeader) {
      const contentLength = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(contentLength) && contentLength > MAX_AMBIENT_IMAGE_FILE_BYTES) {
        return yield* new AmbientImageError({
          code: "too-large",
          status: 413,
          message: "Ambient image is too large.",
        });
      }
    }
    // `acquireRelease` takes the admission slot uninterruptibly and registers
    // the release in the same step. A plain increment followed by `ensuring`
    // can leak a slot if the fiber is interrupted at the yield boundary, and a
    // leaked slot never comes back: capacity would decay to zero and every
    // later upload would 429 forever.
    return yield* Effect.gen(function* () {
      const admitted = yield* Effect.acquireRelease(
        Effect.sync(() => {
          if (activeUploads >= MAX_ACTIVE_UPLOADS) return false;
          activeUploads += 1;
          return true;
        }),
        (acquired) =>
          Effect.sync(() => {
            if (acquired) activeUploads -= 1;
          }),
      );
      if (!admitted) {
        return HttpServerResponse.jsonUnsafe(
          { error: "busy", message: "Too many ambient image uploads are in flight." },
          { status: 429, headers },
        );
      }
      const body = yield* request.arrayBuffer.pipe(
        Effect.provideService(
          HttpIncomingMessage.MaxBodySize,
          FileSystem.Size(MAX_AMBIENT_IMAGE_FILE_BYTES),
        ),
        Effect.mapError(
          (cause) =>
            new AmbientImageError({
              code: "invalid-image",
              status: 400,
              message: "Ambient image data is invalid.",
              cause,
            }),
        ),
        // An authenticated slow body must not occupy one of the two slots indefinitely.
        Effect.timeoutOrElse({
          duration: "30 seconds",
          orElse: () =>
            Effect.fail(
              new AmbientImageError({
                code: "invalid-image",
                status: 408,
                message: "Ambient image upload timed out.",
              }),
            ),
        }),
      );
      // The declared content type is only ever used to reject a mismatch; the
      // stored MIME type comes from the parsed header bytes.
      const declaredMimeType = request.headers["content-type"];
      const ambientImage = yield* (yield* AmbientImageStore).storeUploadedImage({
        bytes: new Uint8Array(body),
        ...(declaredMimeType === undefined ? {} : { declaredMimeType }),
      });
      return HttpServerResponse.jsonUnsafe({ ambientImage }, { status: 200, headers });
    }).pipe(Effect.scoped);
  }).pipe(
    Effect.catchTag("AuthError", respondToAuthError),
    Effect.catchTag("AmbientImageError", respondToAmbientImageError),
  ),
);

export const ambientImageServeRouteLayer = HttpRouter.add(
  "GET",
  `${AMBIENT_IMAGE_ROUTE_PREFIX}*`,
  Effect.gen(function* () {
    yield* requireAuthenticated;
    const id = yield* requestedImageId;
    if (!id) {
      return yield* new AmbientImageError({
        code: "invalid-id",
        status: 404,
        message: "Ambient image was not found.",
      });
    }
    const stored = yield* (yield* AmbientImageStore).resolveStoredImage(id);
    const data = yield* readStoredAmbientImage(stored);
    return HttpServerResponse.uint8Array(data, {
      status: 200,
      contentType: stored.mimeType,
      headers: {
        // Content-addressed ids make the bytes immutable, but they are still
        // user content: keep them out of shared caches and inert on display.
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        ...headers,
      },
    });
  }).pipe(
    Effect.catchTag("AuthError", respondToAuthError),
    Effect.catchTag("AmbientImageError", respondToAmbientImageError),
  ),
);

export const ambientImageDeleteRouteLayer = HttpRouter.add(
  "DELETE",
  `${AMBIENT_IMAGE_ROUTE_PREFIX}*`,
  Effect.gen(function* () {
    yield* requireOwner;
    const id = yield* requestedImageId;
    if (!id) {
      return yield* new AmbientImageError({
        code: "invalid-id",
        status: 404,
        message: "Ambient image was not found.",
      });
    }
    // This slice checks the current settings snapshot before deletion. It is
    // not atomic with a concurrent settings write; the maintenance follow-up
    // adds a shared reference lock around both the check and unlink.
    const settings = yield* (yield* ServerClientSettingsService).getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new AmbientImageError({
            code: "storage-failed",
            status: 500,
            message: "Ambient image references could not be read.",
            cause,
          }),
      ),
    );
    const referenced =
      settings.ambientImageAsset?.id === id ||
      settings.ambientImageCycleAssets.some((asset) => asset.id === id);
    if (referenced) {
      return HttpServerResponse.jsonUnsafe(
        { error: "referenced", message: "Ambient image is still in use." },
        { status: 409, headers },
      );
    }
    yield* (yield* AmbientImageStore).removeStoredImage(id);
    return HttpServerResponse.jsonUnsafe({ removed: true }, { status: 200, headers });
  }).pipe(
    Effect.catchTag("AuthError", respondToAuthError),
    Effect.catchTag("AmbientImageError", respondToAmbientImageError),
  ),
);
