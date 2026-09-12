import * as NodeFs from "node:fs/promises";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import { MAX_AMBIENT_IMAGE_FILE_BYTES } from "@cafecode/contracts/settings";

import { ServerConfig } from "../config.ts";
import {
  AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS,
  AMBIENT_IMAGE_SWEEP_MAX_CANDIDATES,
  AMBIENT_IMAGE_SWEEP_MAX_SCANNED,
  AMBIENT_IMAGE_SWEEP_MAX_DELETIONS,
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
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3-ambient-image-store-",
        }),
      ),
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
        store.storeUploadedImage({
          bytes: tinyPng,
          declaredMimeType: "image/gif",
        }),
      );
      const corrupt = yield* Effect.exit(
        store.storeUploadedImage({
          bytes: Uint8Array.from([1, 2, 3]),
          declaredMimeType: "image/png",
        }),
      );
      const apng = Uint8Array.from([...tinyPng.subarray(0, 8), 0, 0, 0, 0, 0x61, 0x63, 0x54, 0x4c]);
      const animatedPng = yield* Effect.exit(
        store.storeUploadedImage({
          bytes: apng,
          declaredMimeType: "image/png",
        }),
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
        store.storeUploadedImage({
          bytes: headerOnlyWebp,
          declaredMimeType: "image/webp",
        }),
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
        store.storeUploadedImage({
          bytes: tinyPng,
          declaredMimeType: "image/png",
        }),
      );
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") {
        assert.include(String(result.cause), "profile quota is full");
      }
    }).pipe(Effect.provide(layer())),
  );

  // ── Bounded orphan maintenance ───────────────────────────────────────
  //
  // These run against a real temporary directory with real modification times.
  // Age is made real with `utimes` rather than by shortening the grace period,
  // because the grace period is the safety property under test.

  const AMBIENT_IMAGE_DIR = "ambient-media/images";
  const ORPHAN_AGE_MS = AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS + 60_000;

  /**
   * `it.effect` supplies a TestClock that starts at the epoch, while the files
   * these tests create carry real modification times. Aligning the test clock
   * with the wall clock lets the sweep run on its production code path — the
   * ambient `Clock` — instead of having the age injected around it.
   */
  const alignClockWithFileTimes = TestClock.setTime(Date.now());

  const imageDirectory = Effect.gen(function* () {
    const config = yield* ServerConfig;
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const directory = path.join(config.stateDir, AMBIENT_IMAGE_DIR);
    yield* fs.makeDirectory(directory, { recursive: true });
    return directory;
  });

  const idFor = (index: number, extension = "png") =>
    `sha256-${index.toString(16).padStart(64, "0")}.${extension}`;

  /** Write a file and age it, so the sweep sees a genuinely old modification time. */
  const writeAged = (directory: string, name: string, bytes: Uint8Array, ageMs: number) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const filePath = path.join(directory, name);
      yield* fs.writeFile(filePath, bytes);
      if (ageMs > 0) {
        const at = new Date(Date.now() - ageMs);
        yield* Effect.promise(() => NodeFs.utimes(filePath, at, at));
      }
      return filePath;
    });

  const directorySizeBytes = (directory: string) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const entries = yield* fs.readDirectory(directory, { recursive: false });
      let total = 0;
      for (const entry of entries) {
        const info = yield* fs.stat(path.join(directory, entry)).pipe(Effect.option);
        if (info._tag === "Some" && info.value.type === "File") total += Number(info.value.size);
      }
      return total;
    });

  it.effect("reclaims quota from aged unreferenced bytes and keeps everything else", () =>
    Effect.gen(function* () {
      yield* alignClockWithFileTimes;
      const store = yield* AmbientImageStore;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* imageDirectory;

      const orphanBytes = new Uint8Array(4096).fill(7);
      const referencedId = idFor(1);
      const orphanId = idFor(2);
      const freshId = idFor(3);
      const foreignName = "not-a-minted-id.png";

      yield* writeAged(directory, referencedId, orphanBytes, ORPHAN_AGE_MS);
      yield* writeAged(directory, orphanId, orphanBytes, ORPHAN_AGE_MS);
      yield* writeAged(directory, freshId, orphanBytes, 0);
      yield* writeAged(directory, foreignName, orphanBytes, ORPHAN_AGE_MS);

      const before = yield* directorySizeBytes(directory);
      const result = yield* store.sweepUnreferencedImages({
        referencedIds: new Set([referencedId]),
      });
      const after = yield* directorySizeBytes(directory);

      assert.equal(result.removed, 1);
      assert.equal(result.reclaimedBytes, orphanBytes.byteLength);
      assert.equal(result.retained.referenced, 1);
      assert.equal(result.retained.withinGrace, 1);
      assert.equal(result.retained.foreign, 1);
      assert.equal(result.retained.failed, 0);
      assert.equal(result.stoppedBecause, "scan-complete");

      // Quota recovery is observed on storage, not just reported.
      assert.equal(before - after, orphanBytes.byteLength);
      assert.isFalse(yield* fs.exists(path.join(directory, orphanId)));
      assert.isTrue(yield* fs.exists(path.join(directory, referencedId)));
      assert.isTrue(yield* fs.exists(path.join(directory, freshId)));
      assert.isTrue(yield* fs.exists(path.join(directory, foreignName)));
    }).pipe(Effect.provide(layer())),
  );

  it.effect("holds the 24 hour grace period at its boundary", () =>
    Effect.gen(function* () {
      yield* alignClockWithFileTimes;
      const store = yield* AmbientImageStore;
      const directory = yield* imageDirectory;
      const bytes = new Uint8Array(64).fill(1);
      const justInside = idFor(10);
      const justOutside = idFor(11);

      yield* writeAged(directory, justInside, bytes, AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS - 5_000);
      yield* writeAged(directory, justOutside, bytes, AMBIENT_IMAGE_ORPHAN_GRACE_PERIOD_MS + 5_000);

      // The only test that injects `now`, covering the seam the ambient clock
      // fills in everywhere else.
      const result = yield* store.sweepUnreferencedImages({
        referencedIds: new Set<string>(),
        now: Date.now(),
      });
      assert.equal(result.removed, 1);
      assert.equal(result.retained.withinGrace, 1);

      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      assert.isTrue(yield* fs.exists(path.join(directory, justInside)));
      assert.isFalse(yield* fs.exists(path.join(directory, justOutside)));
    }).pipe(Effect.provide(layer())),
  );

  it.effect("never follows a link planted under a minted name", () =>
    Effect.gen(function* () {
      yield* alignClockWithFileTimes;
      const store = yield* AmbientImageStore;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* imageDirectory;

      // The target is a file this test owns, inside the same temporary tree.
      const targetPath = yield* writeAged(
        directory,
        "link-target.bin",
        new Uint8Array(2048).fill(9),
        ORPHAN_AGE_MS,
      );
      const linkName = idFor(20);
      const linkPath = path.join(directory, linkName);
      const linked = yield* Effect.promise(() =>
        NodeFs.symlink(targetPath, linkPath).then(
          () => true,
          // Windows refuses symlink creation without the right privilege. The
          // assertion below is skipped rather than silently reported as a pass.
          () => false,
        ),
      );

      const result = yield* store.sweepUnreferencedImages({ referencedIds: new Set<string>() });

      assert.equal(result.removed, 0);
      assert.isTrue(yield* fs.exists(targetPath));
      if (linked) {
        assert.equal(result.retained.foreign, 2);
        assert.isTrue(yield* Effect.promise(() => NodeFs.lstat(linkPath).then(() => true)));
      }
    }).pipe(Effect.provide(layer())),
  );

  it.effect("bounds deletions and candidates per run and resumes on the next run", () =>
    Effect.gen(function* () {
      yield* alignClockWithFileTimes;
      const store = yield* AmbientImageStore;
      const directory = yield* imageDirectory;
      const bytes = new Uint8Array(16).fill(3);
      const total = AMBIENT_IMAGE_SWEEP_MAX_DELETIONS + 5;
      for (let index = 0; index < total; index++) {
        yield* writeAged(directory, idFor(100 + index), bytes, ORPHAN_AGE_MS);
      }

      const first = yield* store.sweepUnreferencedImages({ referencedIds: new Set<string>() });
      assert.equal(first.removed, AMBIENT_IMAGE_SWEEP_MAX_DELETIONS);
      assert.equal(first.stoppedBecause, "deletion-limit");

      const second = yield* store.sweepUnreferencedImages({ referencedIds: new Set<string>() });
      assert.equal(second.removed, 5);
      assert.equal(second.stoppedBecause, "scan-complete");

      const third = yield* store.sweepUnreferencedImages({ referencedIds: new Set<string>() });
      assert.equal(third.removed, 0);
      assert.equal(third.scanned, 0);
    }).pipe(Effect.provide(layer())),
  );

  it.effect("clamps a caller asking for more work than the compiled bounds allow", () =>
    Effect.gen(function* () {
      yield* alignClockWithFileTimes;
      const store = yield* AmbientImageStore;
      const directory = yield* imageDirectory;
      const bytes = new Uint8Array(8).fill(5);
      const total = AMBIENT_IMAGE_SWEEP_MAX_CANDIDATES + 3;
      for (let index = 0; index < total; index++) {
        yield* writeAged(directory, idFor(1_000 + index), bytes, ORPHAN_AGE_MS);
      }

      // Every asset is referenced, so nothing is deleted and the candidate
      // bound is the one that ends the run rather than the deletion bound.
      const referencedIds = new Set<string>();
      for (let index = 0; index < total; index++) referencedIds.add(idFor(1_000 + index));
      const capped = yield* store.sweepUnreferencedImages({
        referencedIds,
        maxCandidates: Number.POSITIVE_INFINITY,
        maxDeletions: 10_000,
      });
      assert.equal(capped.candidates, AMBIENT_IMAGE_SWEEP_MAX_CANDIDATES);
      assert.equal(capped.removed, 0);
      assert.equal(capped.retained.referenced, AMBIENT_IMAGE_SWEEP_MAX_CANDIDATES);
      assert.equal(capped.stoppedBecause, "candidate-limit");

      const unreferenced = yield* store.sweepUnreferencedImages({
        referencedIds: new Set<string>(),
        maxDeletions: 10_000,
      });
      assert.equal(unreferenced.removed, AMBIENT_IMAGE_SWEEP_MAX_DELETIONS);
      assert.equal(unreferenced.stoppedBecause, "deletion-limit");
    }).pipe(Effect.provide(layer())),
  );

  it.effect("retains every other asset when one entry cannot be read or unlinked", () =>
    Effect.gen(function* () {
      yield* alignClockWithFileTimes;
      const store = yield* AmbientImageStore;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* imageDirectory;
      const bytes = new Uint8Array(32).fill(4);

      // A directory wearing a minted name cannot be unlinked as a file. It
      // stands in for any unlink that fails: the run must continue and the rest
      // of the assets must survive, and nothing may escalate to a blanket wipe.
      const wedgedName = idFor(200);
      yield* fs.makeDirectory(path.join(directory, wedgedName), { recursive: true });
      yield* fs.writeFile(path.join(directory, wedgedName, "inner"), bytes);
      const deletableName = idFor(201);
      yield* writeAged(directory, deletableName, bytes, ORPHAN_AGE_MS);

      const result = yield* store.sweepUnreferencedImages({ referencedIds: new Set<string>() });

      assert.equal(result.removed, 1);
      assert.equal(result.retained.foreign, 1);
      assert.isTrue(yield* fs.exists(path.join(directory, wedgedName, "inner")));
      assert.isFalse(yield* fs.exists(path.join(directory, deletableName)));
    }).pipe(Effect.provide(layer())),
  );

  it.effect("does nothing when the profile directory cannot be listed", () =>
    Effect.gen(function* () {
      yield* alignClockWithFileTimes;
      const store = yield* AmbientImageStore;
      const result = yield* store.sweepUnreferencedImages({ referencedIds: new Set<string>() });
      assert.deepStrictEqual(result, {
        scanned: 0,
        candidates: 0,
        removed: 0,
        reclaimedBytes: 0,
        retained: { foreign: 0, withinGrace: 0, referenced: 0, failed: 0 },
        stoppedBecause: "scan-complete",
      });
    }).pipe(Effect.provide(layer())),
  );

  it.effect("bounds directory enumeration even when every entry is foreign", () =>
    Effect.gen(function* () {
      const store = yield* AmbientImageStore;
      const directory = yield* imageDirectory;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      for (let index = 0; index < AMBIENT_IMAGE_SWEEP_MAX_SCANNED + 4; index++) {
        yield* fs.writeFile(path.join(directory, `foreign-${index}.txt`), Uint8Array.of(1));
      }
      const result = yield* store.sweepUnreferencedImages({ referencedIds: new Set() });
      assert.equal(result.scanned, AMBIENT_IMAGE_SWEEP_MAX_SCANNED);
      assert.equal(result.retained.foreign, AMBIENT_IMAGE_SWEEP_MAX_SCANNED);
      assert.equal(result.removed, 0);
      assert.equal(result.stoppedBecause, "scan-limit");
      assert.equal(
        (yield* fs.readDirectory(directory)).length,
        AMBIENT_IMAGE_SWEEP_MAX_SCANNED + 4,
      );
    }).pipe(Effect.provide(layer())),
  );
});
