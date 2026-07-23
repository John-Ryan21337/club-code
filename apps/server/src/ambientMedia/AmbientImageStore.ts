import { createHash } from "node:crypto";

import {
  MAX_AMBIENT_IMAGE_DIMENSION,
  MAX_AMBIENT_IMAGE_FILE_BYTES,
  MAX_AMBIENT_IMAGE_PIXEL_COUNT,
  type AmbientImageAsset,
  type AmbientImageMimeType,
} from "@cafecode/contracts/settings";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Random from "effect/Random";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../config.ts";

export const AMBIENT_IMAGE_ROUTE_PREFIX = "/api/ambient-media/image/";
const AMBIENT_IMAGE_SUBDIR = "ambient-media/images";
/** Per-profile cap. Individual uploads have the separate contract byte cap. */
const MAX_AMBIENT_IMAGE_PROFILE_BYTES = 10 * 1024 * 1024;
const MAX_AMBIENT_IMAGE_PROFILE_ASSETS = 256;
const AMBIENT_IMAGE_ID_PATTERN = /^sha256-[a-f0-9]{64}\.(?:gif|jpe?g|png|webp)$/;
const MAX_GIF_FRAMES = 240;
const MAX_GIF_CUMULATIVE_PIXELS = 64_000_000;
const MAX_GIF_DURATION_CENTISECONDS = 12_000;

const MIME_BY_EXTENSION = {
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
} as const satisfies Record<string, AmbientImageMimeType>;
const EXTENSION_BY_MIME = {
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} as const satisfies Record<AmbientImageMimeType, string>;

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
  readonly status: 400 | 404 | 413 | 415 | 500;
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
}

export class AmbientImageStore extends Context.Service<AmbientImageStore, AmbientImageStoreShape>()(
  "cafecode/ambientMedia/AmbientImageStore",
) {}

interface ParsedHeader {
  readonly mimeType: AmbientImageMimeType;
  readonly width: number;
  readonly height: number;
}

const ascii = (bytes: Uint8Array, offset: number, length: number): string | null =>
  offset + length <= bytes.byteLength
    ? String.fromCharCode(...bytes.subarray(offset, offset + length))
    : null;
const u16le = (bytes: Uint8Array, offset: number): number | null =>
  offset + 2 <= bytes.byteLength ? bytes[offset]! | (bytes[offset + 1]! << 8) : null;
const u16be = (bytes: Uint8Array, offset: number): number | null =>
  offset + 2 <= bytes.byteLength ? (bytes[offset]! << 8) | bytes[offset + 1]! : null;
const u32be = (bytes: Uint8Array, offset: number): number | null =>
  offset + 4 <= bytes.byteLength
    ? bytes[offset]! * 0x1000000 +
      ((bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!)
    : null;
const u32le = (bytes: Uint8Array, offset: number): number | null =>
  offset + 4 <= bytes.byteLength
    ? bytes[offset]! +
      bytes[offset + 1]! * 0x100 +
      bytes[offset + 2]! * 0x10000 +
      bytes[offset + 3]! * 0x1000000
    : null;

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset++) {
    crc ^= bytes[offset]!;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseGif(bytes: Uint8Array): ParsedHeader | null {
  if ((ascii(bytes, 0, 6) !== "GIF87a" && ascii(bytes, 0, 6) !== "GIF89a") || bytes.byteLength < 14)
    return null;
  const width = u16le(bytes, 6);
  const height = u16le(bytes, 8);
  if (!width || !height) return null;
  // Fully walk GIF block framing. This rejects truncated data and bounds the
  // cumulative decoded work; browsers must not be asked to discover it later.
  let offset = 13 + (bytes[10]! & 0x80 ? 3 * (1 << ((bytes[10]! & 7) + 1)) : 0);
  let frames = 0;
  let cumulativePixels = 0;
  let cumulativeDuration = 0;
  let pendingDelay = 0;
  while (offset < bytes.byteLength) {
    const introducer = bytes[offset++]!;
    if (introducer === 0x3b)
      return frames > 0 && offset === bytes.byteLength
        ? { mimeType: "image/gif", width, height }
        : null;
    if (introducer === 0x21) {
      if (offset >= bytes.byteLength) return null;
      const label = bytes[offset++]!;
      if (label === 0xf9) {
        if (offset + 6 > bytes.byteLength || bytes[offset] !== 4 || bytes[offset + 5] !== 0)
          return null;
        const disposalMethod = (bytes[offset + 1]! >>> 2) & 0x07;
        const delay = u16le(bytes, offset + 2);
        if (disposalMethod > 3 || delay === null) return null;
        pendingDelay = delay;
      }
    } else if (introducer === 0x2c) {
      if (offset + 9 > bytes.byteLength) return null;
      const frameLeft = u16le(bytes, offset);
      const frameTop = u16le(bytes, offset + 2);
      const frameWidth = u16le(bytes, offset + 4);
      const frameHeight = u16le(bytes, offset + 6);
      if (
        frameLeft === null ||
        frameTop === null ||
        !frameWidth ||
        !frameHeight ||
        frameLeft + frameWidth > width ||
        frameTop + frameHeight > height
      )
        return null;
      frames += 1;
      cumulativePixels += frameWidth * frameHeight;
      cumulativeDuration += Math.max(pendingDelay, 2);
      pendingDelay = 0;
      if (
        frames > MAX_GIF_FRAMES ||
        cumulativePixels > MAX_GIF_CUMULATIVE_PIXELS ||
        cumulativeDuration > MAX_GIF_DURATION_CENTISECONDS
      )
        return null;
      const packed = bytes[offset + 8]!;
      offset += 9 + (packed & 0x80 ? 3 * (1 << ((packed & 7) + 1)) : 0);
      if (offset >= bytes.byteLength) return null;
      offset += 1; // LZW minimum code size
    } else return null;
    // Image and extension blocks are terminated by a zero-sized sub-block.
    while (offset < bytes.byteLength) {
      const size = bytes[offset++]!;
      if (size === 0) break;
      if (offset + size > bytes.byteLength) return null;
      offset += size;
    }
  }
  return null;
}

function parsePng(bytes: Uint8Array): ParsedHeader | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    bytes.byteLength < 33 ||
    !signature.every((value, index) => bytes[index] === value) ||
    ascii(bytes, 12, 4) !== "IHDR"
  )
    return null;
  let sawImageData = false;
  let sawEnd = false;
  // APNG has an acTL animation-control chunk after IHDR; it is deliberately unsupported.
  for (let offset = 8; offset + 12 <= bytes.byteLength; ) {
    const length = u32be(bytes, offset);
    if (length === null || offset + 12 + length > bytes.byteLength) return null;
    const type = ascii(bytes, offset + 4, 4);
    const expectedCrc = u32be(bytes, offset + 8 + length);
    if (expectedCrc === null || expectedCrc !== crc32(bytes, offset + 4, offset + 8 + length))
      return null;
    if (offset === 8 && (type !== "IHDR" || length !== 13)) return null;
    if (type === "acTL") return null;
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      if (length !== 0 || offset + 12 !== bytes.byteLength) return null;
      sawEnd = true;
      break;
    }
    offset += 12 + length;
  }
  const width = u32be(bytes, 16),
    height = u32be(bytes, 20);
  return width && height && sawImageData && sawEnd
    ? { mimeType: "image/png", width, height }
    : null;
}

function parseJpeg(bytes: Uint8Array): ParsedHeader | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let dimensions: { readonly width: number; readonly height: number } | null = null;
  for (let offset = 2; offset + 4 <= bytes.byteLength; ) {
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++]!;
    if (marker === 0xd9) return null;
    if (marker === 0xda) {
      const length = u16be(bytes, offset);
      if (!length || length < 2 || offset + length > bytes.byteLength || !dimensions) return null;
      // Entropy-coded scan data uses FF 00 byte stuffing. An unescaped FF D9
      // is the required end-of-image marker; do not accept a header-only or
      // truncated JPEG merely because it advertised dimensions.
      for (let scanOffset = offset + length; scanOffset + 1 < bytes.byteLength; scanOffset++) {
        if (bytes[scanOffset] !== 0xff) continue;
        let next = scanOffset + 1;
        while (next < bytes.byteLength && bytes[next] === 0xff) next++;
        if (bytes[next] === 0xd9)
          return { mimeType: "image/jpeg", width: dimensions.width, height: dimensions.height };
        scanOffset = next;
      }
      return null;
    }
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    const length = u16be(bytes, offset);
    if (!length || length < 2 || offset + length > bytes.byteLength) return null;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = u16be(bytes, offset + 3),
        width = u16be(bytes, offset + 5);
      if (!width || !height || length < 7) return null;
      dimensions = { width, height };
    }
    offset += length;
  }
  return null;
}

function parseWebp(bytes: Uint8Array): ParsedHeader | null {
  const riffSize = u32le(bytes, 4);
  if (
    bytes.byteLength < 20 ||
    ascii(bytes, 0, 4) !== "RIFF" ||
    ascii(bytes, 8, 4) !== "WEBP" ||
    riffSize === null ||
    riffSize + 8 !== bytes.byteLength
  )
    return null;
  let canvasDimensions: { readonly width: number; readonly height: number } | null = null;
  let imageDimensions: { readonly width: number; readonly height: number } | null = null;
  let sawImageData = false;
  for (let offset = 12; offset + 8 <= bytes.byteLength; ) {
    const type = ascii(bytes, offset, 4);
    const length = u32le(bytes, offset + 4);
    if (!type || length === null || offset + 8 + length > bytes.byteLength) return null;
    const dataOffset = offset + 8;
    if (type === "ANIM" || type === "ANMF") return null;
    if (type === "VP8X") {
      if (
        offset !== 12 ||
        canvasDimensions !== null ||
        length !== 10 ||
        (bytes[dataOffset]! & 0xc3) !== 0
      )
        return null;
      const width =
        bytes[dataOffset + 4]! | (bytes[dataOffset + 5]! << 8) | (bytes[dataOffset + 6]! << 16);
      const height =
        bytes[dataOffset + 7]! | (bytes[dataOffset + 8]! << 8) | (bytes[dataOffset + 9]! << 16);
      canvasDimensions = { width: width + 1, height: height + 1 };
    } else if (type === "VP8L") {
      if (sawImageData || length < 5 || bytes[dataOffset] !== 0x2f) return null;
      const bits =
        bytes[dataOffset + 1]! |
        (bytes[dataOffset + 2]! << 8) |
        (bytes[dataOffset + 3]! << 16) |
        (bytes[dataOffset + 4]! << 24);
      imageDimensions = {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      };
      sawImageData = true;
    } else if (
      type === "VP8 " &&
      length >= 10 &&
      bytes[dataOffset + 3] === 0x9d &&
      bytes[dataOffset + 4] === 0x01 &&
      bytes[dataOffset + 5] === 0x2a
    ) {
      if (sawImageData) return null;
      const width = u16le(bytes, dataOffset + 6);
      const height = u16le(bytes, dataOffset + 8);
      if (!width || !height) return null;
      const decodedWidth = width & 0x3fff;
      const decodedHeight = height & 0x3fff;
      if (!decodedWidth || !decodedHeight) return null;
      imageDimensions = { width: decodedWidth, height: decodedHeight };
      sawImageData = true;
    }
    offset += 8 + length + (length % 2);
    if (offset > bytes.byteLength) return null;
  }
  if (!imageDimensions || !sawImageData) return null;
  if (
    canvasDimensions &&
    (imageDimensions.width > canvasDimensions.width ||
      imageDimensions.height > canvasDimensions.height)
  )
    return null;
  return { mimeType: "image/webp", ...(canvasDimensions ?? imageDimensions) };
}

function parseHeader(bytes: Uint8Array): ParsedHeader | null {
  return parsePng(bytes) ?? parseGif(bytes) ?? parseJpeg(bytes) ?? parseWebp(bytes);
}

function normalizeMime(value: string | undefined): AmbientImageMimeType | null {
  const normalized = value?.split(";", 1)[0]?.trim().toLowerCase();
  if (normalized === "image/jpg") return "image/jpeg";
  return normalized === "image/gif" ||
    normalized === "image/jpeg" ||
    normalized === "image/png" ||
    normalized === "image/webp"
    ? normalized
    : null;
}

function makeStore() {
  return Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const mutationSemaphore = yield* Semaphore.make(1);
    const directory = path.join(config.stateDir, AMBIENT_IMAGE_SUBDIR);
    const assetFor = (id: string, header: ParsedHeader, bytes: Uint8Array): AmbientImageAsset => ({
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
        if (!AMBIENT_IMAGE_ID_PATTERN.test(entry)) continue;
        const stat = yield* fs.stat(path.join(directory, entry)).pipe(Effect.option);
        if (stat._tag === "Some" && stat.value.type === "File") {
          assetCount += 1;
          total += Number(stat.value.size);
        }
      }
      return { total, assetCount };
    });
    const storeUploadedImage: AmbientImageStoreShape["storeUploadedImage"] = (input) =>
      mutationSemaphore
        .withPermits(1)(
          Effect.gen(function* () {
            if (input.bytes.byteLength === 0)
              return yield* new AmbientImageError({
                code: "invalid-image",
                status: 400,
                message: "Ambient image is empty.",
              });
            if (input.bytes.byteLength > MAX_AMBIENT_IMAGE_FILE_BYTES)
              return yield* new AmbientImageError({
                code: "too-large",
                status: 413,
                message: "Ambient image is too large.",
              });
            const declared = normalizeMime(input.declaredMimeType);
            if (input.declaredMimeType && !declared)
              return yield* new AmbientImageError({
                code: "unsupported-type",
                status: 415,
                message: "Ambient image type is unsupported.",
              });
            const header = parseHeader(input.bytes);
            if (!header)
              return yield* new AmbientImageError({
                code: "invalid-image",
                status: 400,
                message: "Ambient image data is invalid or unsupported.",
              });
            if (declared && declared !== header.mimeType)
              return yield* new AmbientImageError({
                code: "unsupported-type",
                status: 415,
                message: "Ambient image type does not match the file data.",
              });
            if (
              header.width > MAX_AMBIENT_IMAGE_DIMENSION ||
              header.height > MAX_AMBIENT_IMAGE_DIMENSION ||
              header.width * header.height > MAX_AMBIENT_IMAGE_PIXEL_COUNT
            )
              return yield* new AmbientImageError({
                code: "too-large",
                status: 413,
                message: "Ambient image dimensions are too large.",
              });
            const id = `sha256-${createHash("sha256").update(input.bytes).digest("hex")}${EXTENSION_BY_MIME[header.mimeType]}`;
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
          const mimeType = MIME_BY_EXTENSION[extension as keyof typeof MIME_BY_EXTENSION];
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
    } satisfies AmbientImageStoreShape;
  });
}

export const AmbientImageStoreLive = Layer.effect(AmbientImageStore, makeStore());
