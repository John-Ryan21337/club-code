import { ResearchAction } from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { ServerAuth, AuthError } from "../auth/Services/ServerAuth.ts";
import { ServerSecretStore } from "../auth/Services/ServerSecretStore.ts";
import { ServerSecretStoreLive } from "../auth/Layers/ServerSecretStore.ts";
import { respondToAuthError } from "../auth/http.ts";
import { ResearchService, ResearchError } from "./service.ts";

export const researchRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const secrets = yield* ServerSecretStore;
    const service = new ResearchService({
      get: (name) => Effect.runPromise(secrets.get(name)),
      set: (name, value) => Effect.runPromise(secrets.set(name, value)),
      remove: (name) => Effect.runPromise(secrets.remove(name)),
    });
    return HttpRouter.add(
      "POST",
      "/api/research",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const auth = yield* ServerAuth;
        const session = yield* auth.authenticateHttpRequest(request);
        if (session.role !== "owner")
          return yield* new AuthError({
            message: "Only the server owner can use API research.",
            status: 403,
          });
        // Require JSON so cross-origin HTML forms cannot spend API credits or set a key.
        if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json"))
          return HttpServerResponse.jsonUnsafe(
            { error: "Use a JSON research request." },
            { status: 415 },
          );
        const action = yield* HttpServerRequest.schemaBodyJson(ResearchAction).pipe(
          Effect.provideService(HttpServerRequest.MaxBodySize, FileSystem.Size(192000)),
          Effect.mapError(() => new ResearchError("Invalid research request.")),
        );
        const state = yield* Effect.tryPromise({
          try: () => service.execute(action),
          catch: (error) =>
            error instanceof ResearchError
              ? error
              : new ResearchError("Could not save or load research. Check server storage.", 500),
        });
        return HttpServerResponse.jsonUnsafe(state, { headers: { "cache-control": "no-store" } });
      }).pipe(
        Effect.catchTag("AuthError", respondToAuthError),
        Effect.catch((error) =>
          Effect.succeed(
            HttpServerResponse.jsonUnsafe(
              { error: error.message },
              { status: error.status, headers: { "cache-control": "no-store" } },
            ),
          ),
        ),
      ),
    );
  }),
);
export const researchRoutesLayer = researchRoutes.pipe(Layer.provide(ServerSecretStoreLive));
