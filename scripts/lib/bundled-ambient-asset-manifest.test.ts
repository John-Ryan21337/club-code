import { describe, expect, it } from "vitest";

import {
  decodeBundledAmbientAssetManifest,
  portableManifestPathIssue,
} from "./bundled-ambient-asset-manifest.ts";

const SHA256 = "a".repeat(64);

function validAsset() {
  return {
    id: "matrix-rain",
    file: `media/sha256-${SHA256}.gif`,
    sha256: SHA256,
    encodedBytes: 1_024,
    media: {
      mimeType: "image/gif",
      width: 16,
      height: 16,
      gif: {
        frameCount: 4,
        durationMs: 400,
        cumulativeDecodedPixels: 1_024,
      },
    },
    provenance: {
      sourceUrl: "https://example.test/original.gif",
      creator: "Example Artist",
      rightsholder: "Example Artist",
      originalFileName: "original.gif",
      retrievedAt: "2026-07-26T12:00:00Z",
    },
    license: {
      licenseId: "CC-BY-4.0",
      evidencePath: "licenses/matrix-rain.md",
      redistributionAllowed: true,
      modificationAllowed: true,
      attributionRequired: true,
      attributionText: "Example Artist, CC BY 4.0",
    },
    approval: {
      productDistributionApproved: true,
      reviewedBy: "Release reviewer",
      reviewedAt: "2026-07-26T13:00:00Z",
    },
  };
}

const manifestWith = (...assets: ReadonlyArray<ReturnType<typeof validAsset>>) => ({
  schemaVersion: 1,
  assets,
});

describe("bundled ambient asset manifest", () => {
  it("decodes a fully documented, content-addressed asset", () => {
    expect(decodeBundledAmbientAssetManifest(manifestWith(validAsset()))).toEqual(
      manifestWith(validAsset()),
    );
  });

  it("rejects missing, unknown, and non-redistributable license metadata", () => {
    const missing = validAsset();
    const unknown = validAsset();
    const blocked = validAsset();
    delete (missing as Partial<typeof missing>).license;
    unknown.license.licenseId = "unknown";
    blocked.license.redistributionAllowed = false as true;

    expect(() => decodeBundledAmbientAssetManifest(manifestWith(missing))).toThrow();
    expect(() => decodeBundledAmbientAssetManifest(manifestWith(unknown))).toThrow();
    expect(() => decodeBundledAmbientAssetManifest(manifestWith(blocked))).toThrow();
  });

  it("rejects malformed or internally inconsistent metadata", () => {
    const cases = [
      { mutate: (asset: ReturnType<typeof validAsset>) => (asset.encodedBytes = 0) },
      { mutate: (asset: ReturnType<typeof validAsset>) => (asset.media.width = 99_999) },
      {
        mutate: (asset: ReturnType<typeof validAsset>) =>
          ((asset.media as { gif: typeof asset.media.gif | null }).gif = null),
      },
      {
        mutate: (asset: ReturnType<typeof validAsset>) =>
          (asset.media.gif!.cumulativeDecodedPixels = 0),
      },
      {
        mutate: (asset: ReturnType<typeof validAsset>) =>
          (asset.file = "media/not-content-addressed.gif"),
      },
      { mutate: (asset: ReturnType<typeof validAsset>) => (asset.provenance.creator = "unknown") },
      {
        mutate: (asset: ReturnType<typeof validAsset>) =>
          (asset.provenance.retrievedAt = "2026-02-31T12:00:00Z"),
      },
      {
        mutate: (asset: ReturnType<typeof validAsset>) =>
          ((asset.license as { attributionText: string | null }).attributionText = null),
      },
      {
        mutate: (asset: ReturnType<typeof validAsset>) =>
          ((asset as typeof asset & { surprise?: boolean }).surprise = true),
      },
    ];

    for (const { mutate } of cases) {
      const asset = validAsset();
      mutate(asset);
      expect(() => decodeBundledAmbientAssetManifest(manifestWith(asset))).toThrow();
    }
  });

  it("rejects duplicate ids and content hashes deterministically", () => {
    for (const field of ["id", "sha256"] as const) {
      const first = validAsset();
      const second = validAsset();
      second.id = "second-asset";
      second.sha256 = "b".repeat(64);
      second.file = `media/sha256-${second.sha256}.gif`;
      second[field] = first[field];
      if (field === "sha256") second.file = first.file;

      expect(() => decodeBundledAmbientAssetManifest(manifestWith(first, second))).toThrow(
        `duplicate asset ${field}`,
      );
    }
  });

  it("applies the same portable path policy to POSIX and Windows spellings", () => {
    expect(portableManifestPathIssue("media/asset.gif", "media")).toBeUndefined();
    expect(portableManifestPathIssue("licenses/asset.md", "licenses")).toBeUndefined();

    for (const candidate of [
      "/media/asset.gif",
      "C:/media/asset.gif",
      "C:media/asset.gif",
      "C:\\media\\asset.gif",
      "\\\\server\\share\\asset.gif",
      "media\\asset.gif",
      "media/../licenses/asset.md",
      "media//asset.gif",
      "media/./asset.gif",
      "media/con.gif",
      "media/asset.gif.",
      "media/asset:stream.gif",
    ]) {
      expect(portableManifestPathIssue(candidate, "media")).toBeDefined();
    }
  });
});
