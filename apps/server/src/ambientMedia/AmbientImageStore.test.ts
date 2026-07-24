import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { MAX_AMBIENT_IMAGE_FILE_BYTES } from "@cafecode/contracts/settings";

import { ServerConfig } from "../config.ts";
import {
  AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS,
  AmbientImageStore,
  AmbientImageStoreLive,
  MAX_AMBIENT_IMAGE_PROFILE_BYTES,
} from "./AmbientImageStore.ts";

const tinyPng = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=",
    "base64",
  ),
);
const tinyGif = Uint8Array.from(
  Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64"),
);
const gifWithEncodedSize = (sizeBytes: number, fillByte = 0x61): Uint8Array => {
  const prefix = tinyGif.subarray(0, tinyGif.byteLength - 1);
  if (sizeBytes < tinyGif.byteLength + 5) {
    throw new Error("Padded GIF fixture must have room for a comment extension.");
  }

  const bytes = new Uint8Array(sizeBytes);
  bytes.set(prefix);
  let offset = prefix.byteLength;
  bytes[offset++] = 0x21;
  bytes[offset++] = 0xfe;

  // A GIF data sub-block contributes one length byte plus 1..255 data bytes.
  // Avoid leaving a one-byte remainder, which cannot form a valid sub-block.
  let subBlockBudget = sizeBytes - offset - 2;
  while (subBlockBudget > 0) {
    let blockBytes = Math.min(256, subBlockBudget);
    if (subBlockBudget - blockBytes === 1) blockBytes -= 1;
    if (blockBytes < 2) throw new Error("Invalid padded GIF fixture budget.");
    bytes[offset++] = blockBytes - 1;
    bytes.fill(fillByte, offset, offset + blockBytes - 1);
    offset += blockBytes - 1;
    subBlockBudget -= blockBytes;
  }
  bytes[offset++] = 0;
  bytes[offset++] = 0x3b;
  if (offset !== sizeBytes) throw new Error("Padded GIF fixture has the wrong encoded size.");
  return bytes;
};
const tinyWebp = Uint8Array.from(
  Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64"),
);
const tinyJpeg = Uint8Array.from(
  Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
    "base64",
  ),
);

const layer = () =>
  AmbientImageStoreLive.pipe(
    Layer.provideMerge(
      Layer.fresh(ServerConfig.layerTest(process.cwd(), { prefix: "t3-ambient-image-store-" })),
    ),
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

  it.effect("rejects forged MIME, animation containers, and corrupt bytes", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      const forged = yield* Effect.exit(
        store.storeUploadedImage({ bytes: tinyPng, declaredMimeType: "image/gif" }),
      );
      const corrupt = yield* Effect.exit(
        store.storeUploadedImage({
          bytes: Uint8Array.from([1, 2, 3]),
          declaredMimeType: "image/png",
        }),
      );
      const apng = Uint8Array.from([...tinyPng.subarray(0, 8), 0, 0, 0, 0, 0x61, 0x63, 0x54, 0x4c]);
      const animatedPng = yield* Effect.exit(
        store.storeUploadedImage({ bytes: apng, declaredMimeType: "image/png" }),
      );
      const truncatedPng = yield* Effect.exit(
        store.storeUploadedImage({
          bytes: tinyPng.subarray(0, tinyPng.byteLength - 12),
          declaredMimeType: "image/png",
        }),
      );
      const badPngCrcBytes = tinyPng.slice();
      badPngCrcBytes[52] = badPngCrcBytes[52]! ^ 0xff;
      const badPngCrc = yield* Effect.exit(
        store.storeUploadedImage({
          bytes: badPngCrcBytes,
          declaredMimeType: "image/png",
        }),
      );
      const headerOnlyJpeg = yield* Effect.exit(
        store.storeUploadedImage({
          bytes: Uint8Array.from([
            0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          ]),
          declaredMimeType: "image/jpeg",
        }),
      );
      const headerOnlyWebp = Uint8Array.from([
        0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
        0x58, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      const incompleteWebp = yield* Effect.exit(
        store.storeUploadedImage({ bytes: headerOnlyWebp, declaredMimeType: "image/webp" }),
      );
      const excessiveDurationGif = Uint8Array.from([
        ...tinyGif.subarray(0, 19),
        0x21,
        0xf9,
        0x04,
        0x00,
        0xff,
        0xff,
        0x00,
        0x00,
        ...tinyGif.subarray(19),
      ]);
      const durationBomb = yield* Effect.exit(
        store.storeUploadedImage({
          bytes: excessiveDurationGif,
          declaredMimeType: "image/gif",
        }),
      );
      const repeatedFrame = tinyGif.subarray(19, tinyGif.byteLength - 1);
      const excessiveFramesGif = Uint8Array.from([
        ...tinyGif.subarray(0, 19),
        ...Array.from({ length: 241 }, () => Array.from(repeatedFrame)).flat(),
        0x3b,
      ]);
      const frameBomb = yield* Effect.exit(
        store.storeUploadedImage({
          bytes: excessiveFramesGif,
          declaredMimeType: "image/gif",
        }),
      );
      assert.equal(forged._tag, "Failure");
      assert.equal(corrupt._tag, "Failure");
      assert.equal(animatedPng._tag, "Failure");
      assert.equal(truncatedPng._tag, "Failure");
      assert.equal(badPngCrc._tag, "Failure");
      assert.equal(headerOnlyJpeg._tag, "Failure");
      assert.equal(incompleteWebp._tag, "Failure");
      assert.equal(durationBomb._tag, "Failure");
      assert.equal(frameBomb._tag, "Failure");
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
          bytes: new Uint8Array(MAX_AMBIENT_IMAGE_FILE_BYTES + 1),
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
