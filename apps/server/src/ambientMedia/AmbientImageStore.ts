import { createHash } from "node:crypto";

import {
  MAX_AMBIENT_IMAGE_FILE_BYTES,
  type AmbientImageAsset,
  type AmbientImageMimeType,
} from "@cafecode/contracts/settings";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Random from "effect/Random";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../config.ts";
import {
  AMBIENT_IMAGE_EXTENSION_BY_MIME,
  AMBIENT_IMAGE_ID_PATTERN,
  AMBIENT_IMAGE_MIME_BY_EXTENSION,
  type AmbientImageHeader,
  validateAmbientImageContent,
} from "./ambientImageContent.ts";

export const AMBIENT_IMAGE_ROUTE_PREFIX = "/api/ambient-media/image/";
const AMBIENT_IMAGE_SUBDIR = "ambient-media/images";
/**
 * A desktop folder selection may contain 24 individually validated images
 * totaling 80 MiB. Settings intentionally keep the old cycle referenced until
 * the entire replacement has uploaded and the settings write succeeds, so the
 * profile must hold two maximum cycles during that short rollback window.
 *
 * This is a storage quota only: request bodies remain capped at 10 MiB, image
 * dimensions/animation work are still validated, and HTTP accepts only two
 * bounded uploads concurrently.
 */
export const MAX_AMBIENT_IMAGE_PROFILE_BYTES = 160 * 1024 * 1024;
const MAX_AMBIENT_IMAGE_PROFILE_ASSETS = 256;
export const AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1_000;
export const AMBIENT_IMAGE_ORPHAN_SWEEP_MAX_ASSETS = 32;
const AMBIENT_IMAGE_TEMP_ENTRY_PATTERN = /^sha256-[a-f0-9]{64}\.(?:gif|jpe?g|png|webp)\..+$/;

export type AmbientImageErrorCode =
  | "invalid-id"
  | "invalid-image"
  | "not-found"
  | "storage-failed"
  | "too-large"
  | "unsupported-type";

export class AmbientImageError extends Data.TaggedError("AmbientImageError")<{
  readonly code: AmbientImageErrorCode;
  readonly message: string;
  readonly status: 400 | 404 | 408 | 413 | 415 | 500;
  readonly cause?: unknown;
}> {}

export interface StoredAmbientImage {
  readonly id: string;
  readonly filePath: string;
  readonly mimeType: AmbientImageMimeType;
}

export interface AmbientImageStoreShape {
  readonly storeUploadedImage: (input: {
    readonly bytes: Uint8Array;
    readonly declaredMimeType?: string;
  }) => Effect.Effect<AmbientImageAsset, AmbientImageError>;
  readonly resolveStoredImage: (id: string) => Effect.Effect<StoredAmbientImage, AmbientImageError>;
  /** Removal is only exposed through the HTTP route after a settings-reference check. */
  readonly removeStoredImage: (id: string) => Effect.Effect<void, AmbientImageError>;
  /**
   * Bounded startup maintenance. The caller must keep the reference source
   * quiescent while this runs; each candidate is checked again immediately
   * before deletion.
   */
  readonly sweepUnreferencedImages: (input: {
    readonly isReferenced: (id: string) => Effect.Effect<boolean>;
    readonly now?: Date;
    readonly maxAssets?: number;
  }) => Effect.Effect<{ readonly eligible: number; readonly removed: number }, AmbientImageError>;
}

export class AmbientImageStore extends Context.Service<AmbientImageStore, AmbientImageStoreShape>()(
  "cafecode/ambientMedia/AmbientImageStore",
) {}

function makeStore() {
  return Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const mutationSemaphore = yield* Semaphore.make(1);
    const directory = path.join(config.stateDir, AMBIENT_IMAGE_SUBDIR);
    const assetFor = (
      id: string,
      header: AmbientImageHeader,
      bytes: Uint8Array,
    ): AmbientImageAsset => ({
      id: id as AmbientImageAsset["id"],
      url: `${AMBIENT_IMAGE_ROUTE_PREFIX}${id}`,
      mimeType: header.mimeType,
      width: header.width,
      height: header.height,
      sizeBytes: bytes.byteLength,
    });
    const resolvePath = (id: string) => path.join(directory, id);
    const isStoredFile = (filePath: string) =>
      fs.stat(filePath).pipe(
        Effect.map((stat) => stat.type === "File"),
        Effect.catch(() => Effect.succeed(false)),
      );
    const profileUsage = Effect.gen(function* () {
      const entries = yield* fs
        .readDirectory(directory, { recursive: false })
        .pipe(Effect.catch(() => Effect.succeed([] as string[])));
      let total = 0;
      let assetCount = 0;
      for (const entry of entries) {
        const stat = yield* fs.stat(path.join(directory, entry)).pipe(Effect.option);
        if (
          stat._tag === "Some" &&
          stat.value.type === "File" &&
          AMBIENT_IMAGE_ID_PATTERN.test(entry)
        ) {
          assetCount += 1;
          total += Number(stat.value.size);
        } else if (
          stat._tag === "Some" &&
          stat.value.type === "Directory" &&
          AMBIENT_IMAGE_TEMP_ENTRY_PATTERN.test(entry)
        ) {
          // A crash can strand the scoped upload directory. Account for it
          // conservatively until bounded startup maintenance removes it.
          assetCount += 1;
          total += MAX_AMBIENT_IMAGE_FILE_BYTES;
        }
      }
      return { total, assetCount };
    });
    const storeUploadedImage: AmbientImageStoreShape["storeUploadedImage"] = (input) =>
      mutationSemaphore
        .withPermits(1)(
          Effect.gen(function* () {
            const validation = validateAmbientImageContent(input);
            if (!validation.ok) {
              return yield* new AmbientImageError(validation.error);
            }
            const { header } = validation;
            const id = `sha256-${createHash("sha256").update(input.bytes).digest("hex")}${AMBIENT_IMAGE_EXTENSION_BY_MIME[header.mimeType]}`;
            const filePath = resolvePath(id);
            if (!(yield* isStoredFile(filePath))) {
              const usage = yield* profileUsage;
              if (
                usage.assetCount >= MAX_AMBIENT_IMAGE_PROFILE_ASSETS ||
                usage.total + input.bytes.byteLength > MAX_AMBIENT_IMAGE_PROFILE_BYTES
              )
                return yield* new AmbientImageError({
                  code: "too-large",
                  status: 413,
                  message: "Ambient image profile quota is full.",
                });
              yield* fs.makeDirectory(directory, { recursive: true });
              const tempDir = yield* fs.makeTempDirectoryScoped({ directory, prefix: `${id}.` });
              const tempPath = path.join(tempDir, `${yield* Random.nextUUIDv4}.tmp`);
              yield* fs.writeFile(tempPath, input.bytes);
              yield* fs
                .rename(tempPath, filePath)
                .pipe(
                  Effect.catch((cause) =>
                    isStoredFile(filePath).pipe(
                      Effect.flatMap((exists) => (exists ? Effect.void : Effect.fail(cause))),
                    ),
                  ),
                );
            }
            return assetFor(id, header, input.bytes);
          }).pipe(Effect.scoped),
        )
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof AmbientImageError
              ? cause
              : new AmbientImageError({
                  code: "storage-failed",
                  status: 500,
                  message: "Ambient image could not be stored.",
                  cause,
                }),
          ),
        );
    return {
      storeUploadedImage,
      resolveStoredImage: (id) =>
        Effect.gen(function* () {
          if (!AMBIENT_IMAGE_ID_PATTERN.test(id))
            return yield* new AmbientImageError({
              code: "invalid-id",
              status: 404,
              message: "Ambient image was not found.",
            });
          const extension = id.slice(id.lastIndexOf("."));
          const mimeType =
            AMBIENT_IMAGE_MIME_BY_EXTENSION[
              extension as keyof typeof AMBIENT_IMAGE_MIME_BY_EXTENSION
            ];
          const filePath = resolvePath(id);
          if (!mimeType || !(yield* isStoredFile(filePath)))
            return yield* new AmbientImageError({
              code: "not-found",
              status: 404,
              message: "Ambient image was not found.",
            });
          return { id, filePath, mimeType };
        }),
      removeStoredImage: (id) =>
        mutationSemaphore.withPermits(1)(
          Effect.gen(function* () {
            if (!AMBIENT_IMAGE_ID_PATTERN.test(id)) {
              return yield* new AmbientImageError({
                code: "invalid-id",
                status: 404,
                message: "Ambient image was not found.",
              });
            }
            yield* fs.remove(resolvePath(id), { force: true }).pipe(
              Effect.mapError(
                (cause) =>
                  new AmbientImageError({
                    code: "storage-failed",
                    status: 500,
                    message: "Ambient image could not be removed.",
                    cause,
                  }),
              ),
            );
          }),
        ),
      sweepUnreferencedImages: (input) =>
        mutationSemaphore
          .withPermits(1)(
            Effect.gen(function* () {
              const now = input.now?.getTime() ?? Date.now();
              if (!Number.isFinite(now)) {
                return yield* Effect.fail(new Error("Ambient image sweep time must be finite."));
              }
              const requestedMax =
                input.maxAssets === undefined
                  ? AMBIENT_IMAGE_ORPHAN_SWEEP_MAX_ASSETS
                  : Math.floor(input.maxAssets);
              if (!Number.isFinite(requestedMax) || requestedMax < 0) {
                return yield* Effect.fail(
                  new Error("Ambient image sweep asset limit must be a finite positive number."),
                );
              }
              const maxAssets = Math.min(AMBIENT_IMAGE_ORPHAN_SWEEP_MAX_ASSETS, requestedMax);
              if (maxAssets === 0) return { eligible: 0, removed: 0 };
              yield* fs.makeDirectory(directory, { recursive: true });
              const directoryEntries = yield* fs.readDirectory(directory, { recursive: false });
              // A crash after the final rename but before scoped cleanup can
              // leave 256 valid assets plus a 257th upload directory. Put
              // stranded directories first so lexical truncation cannot hide
              // the entry that is preventing every future upload.
              const entries = [
                ...directoryEntries
                  .filter((entry) => AMBIENT_IMAGE_TEMP_ENTRY_PATTERN.test(entry))
                  .toSorted(),
                ...directoryEntries
                  .filter((entry) => AMBIENT_IMAGE_ID_PATTERN.test(entry))
                  .toSorted(),
              ].slice(0, MAX_AMBIENT_IMAGE_PROFILE_ASSETS);
              let eligible = 0;
              let removed = 0;

              for (const entry of entries) {
                if (eligible >= maxAssets) break;
                const filePath = resolvePath(entry);
                const stat = yield* fs.stat(filePath).pipe(Effect.option);
                if (Option.isNone(stat)) continue;
                const leakedUploadDirectory =
                  stat.value.type === "Directory" && AMBIENT_IMAGE_TEMP_ENTRY_PATTERN.test(entry);
                if (
                  (!leakedUploadDirectory && stat.value.type !== "File") ||
                  Option.isNone(stat.value.mtime) ||
                  now - stat.value.mtime.value.getTime() < AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS
                ) {
                  continue;
                }

                eligible += 1;
                if (leakedUploadDirectory) {
                  yield* fs.remove(filePath, { recursive: true, force: true });
                  removed += 1;
                  continue;
                }
                if (yield* input.isReferenced(entry)) continue;
                // Give an in-flight reference update a chance to settle, then
                // fail closed with a final fresh read immediately before removal.
                yield* Effect.yieldNow;
                if (yield* input.isReferenced(entry)) continue;
                yield* fs.remove(filePath, { force: true });
                removed += 1;
              }
              return { eligible, removed };
            }),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new AmbientImageError({
                  code: "storage-failed",
                  status: 500,
                  message: "Ambient image maintenance could not be completed.",
                  cause,
                }),
            ),
          ),
    } satisfies AmbientImageStoreShape;
  });
}

export const AmbientImageStoreLive = Layer.effect(AmbientImageStore, makeStore());
