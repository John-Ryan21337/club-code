import * as Crypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as PlatformError from "effect/PlatformError";

import { ServerConfig } from "../../config.ts";
import {
  SecretStoreError,
  ServerSecretStore,
  type ServerSecretStoreShape,
} from "../Services/ServerSecretStore.ts";

export const makeServerSecretStore = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig;

  yield* fileSystem.makeDirectory(serverConfig.secretsDir, { recursive: true });
  yield* fileSystem.chmod(serverConfig.secretsDir, 0o700).pipe(
    Effect.mapError(
      (cause) =>
        new SecretStoreError({
          message: `Failed to secure secrets directory ${serverConfig.secretsDir}.`,
          cause,
        }),
    ),
  );

  const resolveSecretPath = (name: string) => path.join(serverConfig.secretsDir, `${name}.bin`);

  const isPlatformError = (u: unknown): u is PlatformError.PlatformError =>
    Predicate.isTagged(u, "PlatformError");

  const get: ServerSecretStoreShape["get"] = (name) =>
    fileSystem.readFile(resolveSecretPath(name)).pipe(
      Effect.map((bytes) => Uint8Array.from(bytes)),
      Effect.catch((cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed(null)
          : Effect.fail(
              new SecretStoreError({
                message: `Failed to read secret ${name}.`,
                cause,
              }),
            ),
      ),
    );

  const set: ServerSecretStoreShape["set"] = (name, value) => {
    const secretPath = resolveSecretPath(name);
    const tempPath = `${secretPath}.${Crypto.randomUUID()}.tmp`;
    return Effect.gen(function* () {
      yield* fileSystem.writeFile(tempPath, value);
      yield* fileSystem.chmod(tempPath, 0o600);
      yield* fileSystem.rename(tempPath, secretPath);
      yield* fileSystem.chmod(secretPath, 0o600);
    }).pipe(
      Effect.catch((cause) =>
        fileSystem.remove(tempPath).pipe(
          Effect.ignore,
          Effect.flatMap(() =>
            Effect.fail(
              new SecretStoreError({
                message: `Failed to persist secret ${name}.`,
                cause,
              }),
            ),
          ),
        ),
      ),
    );
  };

  const create: ServerSecretStoreShape["set"] = (name, value) => {
    const secretPath = resolveSecretPath(name);
    const tempPath = `${secretPath}.${Crypto.randomUUID()}.tmp`;
    return Effect.gen(function* () {
      // Publish only a fully written file. Opening the final path with `wx`
      // makes the name visible before writeAll completes, so a concurrent
      // creator can observe an empty or partial secret. A same-directory hard
      // link is atomic and fails with AlreadyExists when another creator wins.
      yield* Effect.scoped(
        Effect.gen(function* () {
          const file = yield* fileSystem.open(tempPath, {
            flag: "wx",
            mode: 0o600,
          });
          yield* file.writeAll(value);
          yield* file.sync;
        }),
      );
      yield* fileSystem.chmod(tempPath, 0o600);
      yield* fileSystem.link(tempPath, secretPath);
    }).pipe(
      Effect.ensuring(fileSystem.remove(tempPath).pipe(Effect.ignore)),
      Effect.mapError(
        (cause) =>
          new SecretStoreError({
            message: `Failed to persist secret ${name}.`,
            cause,
          }),
      ),
    );
  };

  const getOrCreateRandom: ServerSecretStoreShape["getOrCreateRandom"] = (name, bytes) =>
    get(name).pipe(
      Effect.flatMap((existing) => {
        if (existing) {
          return Effect.succeed(existing);
        }

        const generated = Crypto.randomBytes(bytes);
        return create(name, generated).pipe(
          Effect.map(() => Uint8Array.from(generated)),
          Effect.catchTag("SecretStoreError", (error) =>
            isPlatformError(error.cause) && error.cause.reason._tag === "AlreadyExists"
              ? get(name).pipe(
                  Effect.flatMap((created) =>
                    created !== null
                      ? Effect.succeed(created)
                      : Effect.fail(
                          new SecretStoreError({
                            message: `Failed to read secret ${name} after concurrent creation.`,
                          }),
                        ),
                  ),
                )
              : Effect.fail(error),
          ),
          // The random candidate is internal scratch memory. Callers receive a
          // copy on success, while a losing candidate is never returned.
          Effect.ensuring(
            Effect.sync(() => {
              generated.fill(0);
            }),
          ),
        );
      }),
    );

  const remove: ServerSecretStoreShape["remove"] = (name) =>
    fileSystem.remove(resolveSecretPath(name)).pipe(
      Effect.catch((cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.void
          : Effect.fail(
              new SecretStoreError({
                message: `Failed to remove secret ${name}.`,
                cause,
              }),
            ),
      ),
    );

  return {
    get,
    set,
    getOrCreateRandom,
    remove,
  } satisfies ServerSecretStoreShape;
});

export const ServerSecretStoreLive = Layer.effect(ServerSecretStore, makeServerSecretStore);
