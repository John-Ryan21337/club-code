import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import { MAX_AMBIENT_IMAGE_FILE_BYTES } from "@cafecode/contracts/settings";

import { ServerConfig } from "../config.ts";
import {
  AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS,
  AmbientImageStore,
  AmbientImageStoreLive,
  MAX_AMBIENT_IMAGE_PROFILE_BYTES,
} from "./AmbientImageStore.ts";
import {
  gifWithEncodedSize,
  oversizedGif,
  tinyGif,
  tinyJpeg,
  tinyPng,
  tinyWebp,
} from "./ambientImageTestFixtures.ts";

const layer = () =>
  AmbientImageStoreLive.pipe(
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3-ambient-image-store-" })),
    ),
  );

const disappearingSweepId = `sha256-${"0".repeat(64)}.png`;
const StatMissFileSystemLayer = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return {
      ...fileSystem,
      stat: (path) =>
        String(path).endsWith(disappearingSweepId)
          ? Effect.fail(
              PlatformError.systemError({
                _tag: "NotFound",
                module: "FileSystem",
                method: "stat",
                pathOrDescriptor: String(path),
                description: "The sweep candidate disappeared after directory enumeration.",
              }),
            )
          : fileSystem.stat(path),
    } satisfies FileSystem.FileSystem;
  }),
).pipe(Layer.provide(NodeServices.layer));

const statMissLayer = () =>
  AmbientImageStoreLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-ambient-image-store-stat-miss-" }),
      ),
    ),
    Layer.provideMerge(StatMissFileSystemLayer),
  );

it.layer(NodeServices.layer)("ambient image store", (it) => {
  it.effect("stores verified raster bytes by content hash and deduplicates them", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      const first = yield* store.storeUploadedImage({
        bytes: tinyPng,
        declaredMimeType: "image/png",
      });
      const second = yield* store.storeUploadedImage({
        bytes: tinyPng,
        declaredMimeType: "image/png",
      });
      const stored = yield* store.resolveStoredImage(first.id);
      const [gif, concurrentGif] = yield* Effect.all(
        [
          store.storeUploadedImage({
            bytes: tinyGif,
            declaredMimeType: "image/gif",
          }),
          store.storeUploadedImage({
            bytes: tinyGif,
            declaredMimeType: "image/gif",
          }),
        ],
        { concurrency: "unbounded" },
      );
      const webp = yield* store.storeUploadedImage({
        bytes: tinyWebp,
        declaredMimeType: "image/webp",
      });
      const jpeg = yield* store.storeUploadedImage({
        bytes: tinyJpeg,
        declaredMimeType: "image/jpeg",
      });

      assert.equal(first.id, second.id);
      assert.equal(first.url, `/api/ambient-media/image/${first.id}`);
      assert.equal(first.mimeType, "image/png");
      assert.equal(first.width, 1);
      assert.equal(stored.mimeType, "image/png");
      assert.equal(gif.width, 1);
      assert.equal(gif.height, 1);
      assert.equal(concurrentGif.id, gif.id);
      assert.equal(webp.width, 1);
      assert.equal(webp.height, 1);
      assert.equal(jpeg.width, 1);
      assert.equal(jpeg.height, 1);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("rejects traversal and malformed identifiers before resolving storage paths", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      for (const id of [
        "../outside.png",
        "..%2foutside.png",
        "C:\\outside.png",
        `/tmp/sha256-${"a".repeat(64)}.png`,
        `sha256-${"A".repeat(64)}.png`,
        `sha256-${"a".repeat(64)}.svg`,
      ]) {
        const resolveError = yield* store.resolveStoredImage(id).pipe(Effect.flip);
        const removeError = yield* store.removeStoredImage(id).pipe(Effect.flip);
        assert.equal(resolveError.code, "invalid-id");
        assert.equal(removeError.code, "invalid-id");
      }
    }).pipe(Effect.provide(layer())),
  );

  it.effect("keeps the 80 MiB cycle replacement budget while rejecting an oversized upload", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      const firstAtLimit = yield* store.storeUploadedImage({
        bytes: gifWithEncodedSize(MAX_AMBIENT_IMAGE_FILE_BYTES),
        declaredMimeType: "image/gif",
      });
      const replacementAtLimit = yield* store.storeUploadedImage({
        bytes: gifWithEncodedSize(MAX_AMBIENT_IMAGE_FILE_BYTES, 0x62),
        declaredMimeType: "image/gif",
      });
      const thirdAsset = yield* store.storeUploadedImage({
        bytes: tinyPng,
        declaredMimeType: "image/png",
      });
      const fileOverflow = yield* Effect.exit(
        store.storeUploadedImage({
          bytes: oversizedGif(),
          declaredMimeType: "image/gif",
        }),
      );

      assert.notEqual(firstAtLimit.id, replacementAtLimit.id);
      assert.equal(firstAtLimit.sizeBytes, MAX_AMBIENT_IMAGE_FILE_BYTES);
      assert.equal(replacementAtLimit.sizeBytes, MAX_AMBIENT_IMAGE_FILE_BYTES);
      assert.equal(MAX_AMBIENT_IMAGE_PROFILE_BYTES, 160 * 1024 * 1024);
      assert.equal(thirdAsset.mimeType, "image/png");
      assert.equal(fileOverflow._tag, "Failure");
      if (fileOverflow._tag === "Failure") {
        assert.include(String(fileOverflow.cause), "Ambient image is too large");
      }
    }).pipe(Effect.provide(layer())),
  );

  it.effect("enforces the profile asset-count bound without undercounting directory entries", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      const config = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = path.join(config.stateDir, "ambient-media/images");
      yield* fs.makeDirectory(directory, { recursive: true });
      for (let index = 0; index < 256; index++) {
        const id = `sha256-${index.toString(16).padStart(64, "0")}.png`;
        yield* fs.writeFile(path.join(directory, id), Uint8Array.of(index & 0xff));
      }

      const result = yield* Effect.exit(
        store.storeUploadedImage({ bytes: tinyPng, declaredMimeType: "image/png" }),
      );
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.include(String(result.cause), "profile quota is full");
      }
    }).pipe(Effect.provide(layer())),
  );

  it.effect("sweeps only old unreferenced assets after a final reference recheck", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      const fs = yield* FileSystem.FileSystem;
      const referenced = yield* store.storeUploadedImage({
        bytes: tinyPng,
        declaredMimeType: "image/png",
      });
      const orphan = yield* store.storeUploadedImage({
        bytes: tinyGif,
        declaredMimeType: "image/gif",
      });
      const recent = yield* store.storeUploadedImage({
        bytes: tinyWebp,
        declaredMimeType: "image/webp",
      });
      const referencedFile = yield* store.resolveStoredImage(referenced.id);
      const orphanFile = yield* store.resolveStoredImage(orphan.id);
      const now = new Date("2026-07-23T12:00:00.000Z");
      const old = new Date(now.getTime() - AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS - 1);
      yield* fs.utimes(referencedFile.filePath, old, old);
      yield* fs.utimes(orphanFile.filePath, old, old);

      const checked: string[] = [];
      const result = yield* store.sweepUnreferencedImages({
        now,
        isReferenced: (id) =>
          Effect.sync(() => {
            checked.push(id);
            return id === referenced.id;
          }),
      });

      assert.deepEqual(result, { eligible: 2, removed: 1 });
      assert.deepEqual(checked.toSorted(), [orphan.id, orphan.id, referenced.id].toSorted());
      assert.equal((yield* store.resolveStoredImage(referenced.id)).id, referenced.id);
      assert.equal((yield* store.resolveStoredImage(recent.id)).id, recent.id);
      const removed = yield* Effect.exit(store.resolveStoredImage(orphan.id));
      assert.equal(removed._tag, "Failure");
    }).pipe(Effect.provide(layer())),
  );

  it.effect("rechecks a candidate and preserves it when it becomes referenced", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      const fs = yield* FileSystem.FileSystem;
      const asset = yield* store.storeUploadedImage({
        bytes: tinyPng,
        declaredMimeType: "image/png",
      });
      const stored = yield* store.resolveStoredImage(asset.id);
      const now = new Date("2026-07-23T12:00:00.000Z");
      const old = new Date(now.getTime() - AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS - 1);
      yield* fs.utimes(stored.filePath, old, old);
      let checks = 0;

      const result = yield* store.sweepUnreferencedImages({
        now,
        isReferenced: () =>
          Effect.sync(() => {
            checks += 1;
            return checks === 2;
          }),
      });

      assert.deepEqual(result, { eligible: 1, removed: 0 });
      assert.equal(checks, 2);
      assert.equal((yield* store.resolveStoredImage(asset.id)).id, asset.id);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("continues sweeping after a candidate disappears before stat", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      const config = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = path.join(config.stateDir, "ambient-media/images");
      const laterId = `sha256-${"1".repeat(64)}.png`;
      const disappearingPath = path.join(directory, disappearingSweepId);
      const laterPath = path.join(directory, laterId);
      yield* fs.makeDirectory(directory, { recursive: true });
      yield* fs.writeFile(disappearingPath, tinyPng);
      yield* fs.writeFile(laterPath, tinyPng);
      const now = new Date("2026-07-23T12:00:00.000Z");
      const old = new Date(now.getTime() - AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS - 1);
      yield* fs.utimes(disappearingPath, old, old);
      yield* fs.utimes(laterPath, old, old);

      const result = yield* store.sweepUnreferencedImages({
        now,
        isReferenced: () => Effect.succeed(false),
      });

      assert.deepEqual(result, { eligible: 1, removed: 1 });
      assert.isTrue(yield* fs.exists(disappearingPath));
      assert.isFalse(yield* fs.exists(laterPath));
    }).pipe(Effect.provide(statMissLayer())),
  );

  it.effect("accounts for and sweeps upload directories stranded by a crash", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      const config = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = path.join(config.stateDir, "ambient-media/images");
      const leakedDirectory = path.join(directory, `sha256-${"c".repeat(64)}.png.crashed-upload`);
      yield* fs.makeDirectory(leakedDirectory, { recursive: true });
      yield* fs.writeFile(path.join(leakedDirectory, "payload.tmp"), tinyPng);
      const now = new Date("2026-07-23T12:00:00.000Z");
      const old = new Date(now.getTime() - AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS - 1);
      yield* fs.utimes(leakedDirectory, old, old);
      let referenceChecks = 0;

      const result = yield* store.sweepUnreferencedImages({
        now,
        isReferenced: () =>
          Effect.sync(() => {
            referenceChecks += 1;
            return true;
          }),
      });

      assert.deepEqual(result, { eligible: 1, removed: 1 });
      assert.equal(referenceChecks, 0);
      assert.isFalse(yield* fs.exists(leakedDirectory));
    }).pipe(Effect.provide(layer())),
  );

  it.effect("prioritizes a stranded upload directory beyond the full asset quota", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      const config = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = path.join(config.stateDir, "ambient-media/images");
      yield* fs.makeDirectory(directory, { recursive: true });
      for (let index = 0; index < 255; index++) {
        const id = `sha256-${index.toString(16).padStart(64, "0")}.png`;
        yield* fs.writeFile(path.join(directory, id), Uint8Array.of(index & 0xff));
      }
      const finalId = `sha256-${"f".repeat(64)}.png`;
      yield* fs.writeFile(path.join(directory, finalId), tinyPng);
      const leakedDirectory = path.join(directory, `${finalId}.crashed-upload`);
      yield* fs.makeDirectory(leakedDirectory, { recursive: true });
      yield* fs.writeFile(path.join(leakedDirectory, "payload.tmp"), tinyPng);
      const now = new Date("2026-07-23T12:00:00.000Z");
      const old = new Date(now.getTime() - AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS - 1);
      yield* fs.utimes(leakedDirectory, old, old);
      let referenceChecks = 0;

      const result = yield* store.sweepUnreferencedImages({
        now,
        isReferenced: () =>
          Effect.sync(() => {
            referenceChecks += 1;
            return true;
          }),
      });

      assert.deepEqual(result, { eligible: 1, removed: 1 });
      assert.equal(referenceChecks, 0);
      assert.isFalse(yield* fs.exists(leakedDirectory));
      assert.isTrue(yield* fs.exists(path.join(directory, finalId)));
    }).pipe(Effect.provide(layer())),
  );

  it.effect("recovers an upload slot after sweeping a stranded upload directory", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      const config = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = path.join(config.stateDir, "ambient-media/images");
      yield* fs.makeDirectory(directory, { recursive: true });
      for (let index = 0; index < 255; index++) {
        const id = `sha256-${index.toString(16).padStart(64, "0")}.png`;
        yield* fs.writeFile(path.join(directory, id), Uint8Array.of(index & 0xff));
      }
      const leakedDirectory = path.join(directory, `sha256-${"f".repeat(64)}.png.crashed-upload`);
      yield* fs.makeDirectory(leakedDirectory, { recursive: true });
      yield* fs.writeFile(path.join(leakedDirectory, "payload.tmp"), tinyPng);
      const now = new Date("2026-07-23T12:00:00.000Z");
      const old = new Date(now.getTime() - AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS - 1);
      yield* fs.utimes(leakedDirectory, old, old);

      const result = yield* store.sweepUnreferencedImages({
        now,
        isReferenced: () => Effect.succeed(false),
      });
      const uploaded = yield* store.storeUploadedImage({
        bytes: tinyPng,
        declaredMimeType: "image/png",
      });

      assert.deepEqual(result, { eligible: 1, removed: 1 });
      assert.equal(uploaded.mimeType, "image/png");
      assert.isFalse(yield* fs.exists(leakedDirectory));
    }).pipe(Effect.provide(layer())),
  );

  it.effect("honors a zero work limit and rejects non-finite sweep input", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      let checks = 0;
      const noWork = yield* store.sweepUnreferencedImages({
        maxAssets: 0,
        isReferenced: () =>
          Effect.sync(() => {
            checks += 1;
            return false;
          }),
      });
      const invalid = yield* Effect.exit(
        store.sweepUnreferencedImages({
          maxAssets: Number.NaN,
          isReferenced: () => Effect.succeed(false),
        }),
      );

      assert.deepEqual(noWork, { eligible: 0, removed: 0 });
      assert.equal(checks, 0);
      assert.equal(invalid._tag, "Failure");
    }).pipe(Effect.provide(layer())),
  );
});
