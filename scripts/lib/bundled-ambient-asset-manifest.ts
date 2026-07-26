import * as path from "node:path";

import * as Schema from "effect/Schema";

export const BUNDLED_AMBIENT_ASSET_MANIFEST_VERSION = 1;
export const MAX_BUNDLED_AMBIENT_ASSETS = 64;
export const MAX_BUNDLED_AMBIENT_ASSET_BYTES = 10 * 1024 * 1024;
export const MAX_BUNDLED_AMBIENT_ASSET_DIMENSION = 4_096;
export const MAX_BUNDLED_AMBIENT_ASSET_PIXELS = 16_777_216;
export const MAX_BUNDLED_AMBIENT_GIF_FRAMES = 240;
export const MAX_BUNDLED_AMBIENT_GIF_DURATION_MS = 120_000;
export const MAX_BUNDLED_AMBIENT_GIF_DECODED_PIXELS = 64_000_000;

const UNKNOWN_METADATA = /^(?:n\/?a|none|tbd|unknown|unverified)$/iu;
const UNKNOWN_LICENSE_TOKEN = /(?:^|[-_.])(?:none|noassertion|tbd|unknown|unverified)(?:$|[-_.])/iu;
const WINDOWS_RESERVED_BASENAME = /^(?:aux|com[1-9]|con|lpt[1-9]|nul|prn)(?:\.|$)/iu;
const WINDOWS_FORBIDDEN_PATH_CHARACTERS = '<>:"|?*';
const SHA256 = /^[a-f0-9]{64}$/u;
const ASSET_ID = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const LICENSE_ID =
  /^(?:[A-Za-z0-9][A-Za-z0-9.+-]{0,95}|LicenseRef-[A-Za-z0-9][A-Za-z0-9.-]{0,84})$/u;
const ISO_UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

const boundedKnownText = (maximum: number) =>
  Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(maximum),
    Schema.makeFilter((value) =>
      value === value.trim() && !UNKNOWN_METADATA.test(value)
        ? undefined
        : "must be trimmed, non-empty, and known",
    ),
  );

const StrictStruct = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.Struct(fields).annotate({ parseOptions: { onExcessProperty: "error" } });

function containsWindowsForbiddenPathCharacter(value: string): boolean {
  return [...value].some(
    (character) =>
      WINDOWS_FORBIDDEN_PATH_CHARACTERS.includes(character) || character.charCodeAt(0) < 0x20,
  );
}

export function portableManifestPathIssue(
  value: string,
  requiredTopLevelDirectory: "licenses" | "media",
): string | undefined {
  if (value.length === 0 || value.length > 240) return "must contain 1 to 240 characters";
  if (value.includes("\0")) return "must not contain a NUL byte";
  if (value.includes("\\")) return "must use forward slashes on every platform";
  if (
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.win32.parse(value).root !== ""
  ) {
    return "must be relative on POSIX and Windows";
  }

  const segments = value.split("/");
  if (
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    segments.some(
      (segment) =>
        containsWindowsForbiddenPathCharacter(segment) ||
        WINDOWS_RESERVED_BASENAME.test(segment) ||
        segment.endsWith(".") ||
        segment.endsWith(" "),
    ) ||
    segments[0] !== requiredTopLevelDirectory ||
    path.posix.normalize(value) !== value
  ) {
    return `must be a normalized path below ${requiredTopLevelDirectory}/`;
  }
  return undefined;
}

function httpsSourceUrlIssue(value: string): string | undefined {
  if (value.length > 2_048 || value !== value.trim()) {
    return "must be a trimmed HTTPS URL no longer than 2,048 characters";
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.username === "" && parsed.password === ""
      ? undefined
      : "must be an HTTPS URL without embedded credentials";
  } catch {
    return "must be a valid HTTPS URL";
  }
}

function isoUtcDateTimeIssue(value: string): string | undefined {
  if (!ISO_UTC_DATE_TIME.test(value)) return "must be an ISO 8601 UTC timestamp";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "must be a valid calendar timestamp";
  const canonical = new Date(timestamp).toISOString();
  return canonical === value || canonical.replace(".000Z", "Z") === value
    ? undefined
    : "must be a valid calendar timestamp";
}

const ManifestMediaPath = Schema.String.check(
  Schema.makeFilter((value) => portableManifestPathIssue(value, "media")),
);
const ManifestLicensePath = Schema.String.check(
  Schema.makeFilter((value) => portableManifestPathIssue(value, "licenses")),
);
const HttpsSourceUrl = Schema.String.check(Schema.makeFilter(httpsSourceUrlIssue));
const IsoUtcDateTime = Schema.String.check(Schema.makeFilter(isoUtcDateTimeIssue));

export const BundledAmbientAssetLicenseSchema = StrictStruct({
  licenseId: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(96),
    Schema.isPattern(LICENSE_ID),
    Schema.makeFilter((value) =>
      UNKNOWN_METADATA.test(value) || UNKNOWN_LICENSE_TOKEN.test(value)
        ? "must identify a reviewed SPDX license or documented LicenseRef"
        : undefined,
    ),
  ),
  evidencePath: ManifestLicensePath,
  redistributionAllowed: Schema.Literal(true),
  modificationAllowed: Schema.Boolean,
  attributionRequired: Schema.Boolean,
  attributionText: Schema.NullOr(boundedKnownText(2_048)),
}).check(
  Schema.makeFilter((license) =>
    license.attributionRequired === (license.attributionText !== null)
      ? undefined
      : "attributionText must be present exactly when attributionRequired is true",
  ),
);
export type BundledAmbientAssetLicense = typeof BundledAmbientAssetLicenseSchema.Type;

export const BundledAmbientGifMetadataSchema = StrictStruct({
  frameCount: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: MAX_BUNDLED_AMBIENT_GIF_FRAMES }),
  ),
  durationMs: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: MAX_BUNDLED_AMBIENT_GIF_DURATION_MS }),
  ),
  cumulativeDecodedPixels: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: MAX_BUNDLED_AMBIENT_GIF_DECODED_PIXELS }),
  ),
});
export type BundledAmbientGifMetadata = typeof BundledAmbientGifMetadataSchema.Type;

export const BundledAmbientAssetSchema = StrictStruct({
  id: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(80),
    Schema.isPattern(ASSET_ID),
  ),
  file: ManifestMediaPath,
  sha256: Schema.String.check(Schema.isPattern(SHA256)),
  encodedBytes: Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: MAX_BUNDLED_AMBIENT_ASSET_BYTES }),
  ),
  media: StrictStruct({
    mimeType: Schema.Literals(["image/gif", "image/jpeg", "image/png", "image/webp"]),
    width: Schema.Int.check(
      Schema.isBetween({ minimum: 1, maximum: MAX_BUNDLED_AMBIENT_ASSET_DIMENSION }),
    ),
    height: Schema.Int.check(
      Schema.isBetween({ minimum: 1, maximum: MAX_BUNDLED_AMBIENT_ASSET_DIMENSION }),
    ),
    gif: Schema.NullOr(BundledAmbientGifMetadataSchema),
  }),
  provenance: StrictStruct({
    sourceUrl: HttpsSourceUrl,
    creator: boundedKnownText(256),
    rightsholder: boundedKnownText(256),
    originalFileName: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(255),
      Schema.makeFilter((value) =>
        value === value.trim() &&
        !UNKNOWN_METADATA.test(value) &&
        !value.includes("/") &&
        !value.includes("\\") &&
        value !== "." &&
        value !== ".."
          ? undefined
          : "must be a known basename without path separators",
      ),
    ),
    retrievedAt: IsoUtcDateTime,
  }),
  license: BundledAmbientAssetLicenseSchema,
  approval: StrictStruct({
    productDistributionApproved: Schema.Literal(true),
    reviewedBy: boundedKnownText(256),
    reviewedAt: IsoUtcDateTime,
  }),
}).check(
  Schema.makeFilter((asset) => {
    const extensionByMimeType = {
      "image/gif": ".gif",
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
    } as const;
    const expectedPath = `media/sha256-${asset.sha256}${extensionByMimeType[asset.media.mimeType]}`;
    if (asset.file !== expectedPath) return `file must equal ${expectedPath}`;
    if (asset.media.width * asset.media.height > MAX_BUNDLED_AMBIENT_ASSET_PIXELS) {
      return "declared dimensions exceed the decoded pixel budget";
    }
    if ((asset.media.mimeType === "image/gif") !== (asset.media.gif !== null)) {
      return "GIF metadata must be present exactly for image/gif assets";
    }
    return undefined;
  }),
);
export type BundledAmbientAsset = typeof BundledAmbientAssetSchema.Type;

export const BundledAmbientAssetManifestSchema = StrictStruct({
  schemaVersion: Schema.Literal(BUNDLED_AMBIENT_ASSET_MANIFEST_VERSION),
  assets: Schema.Array(BundledAmbientAssetSchema).check(
    Schema.isMaxLength(MAX_BUNDLED_AMBIENT_ASSETS),
    Schema.makeFilter((assets) => {
      const duplicateField = (field: "file" | "id" | "sha256") => {
        const values = assets.map((asset) => asset[field]);
        return new Set(values).size === values.length ? undefined : field;
      };
      const duplicate = duplicateField("id") ?? duplicateField("sha256") ?? duplicateField("file");
      return duplicate ? `must not contain duplicate asset ${duplicate} values` : undefined;
    }),
  ),
});
export type BundledAmbientAssetManifest = typeof BundledAmbientAssetManifestSchema.Type;

const decodeManifest = Schema.decodeUnknownSync(BundledAmbientAssetManifestSchema);

export const decodeBundledAmbientAssetManifest = (input: unknown): BundledAmbientAssetManifest =>
  decodeManifest(input, {
    errors: "all",
    onExcessProperty: "error",
  });
