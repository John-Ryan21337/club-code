import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  type BundledAmbientAssetValidationIssueCode,
  inspectBundledAmbientAssetManifest,
  validateBundledAmbientAssetManifest,
} from "./bundled-ambient-asset-validator.ts";

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "cafecode-ambient-assets-"));
  const bytes = Buffer.from("bounded-gif-fixture");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const mediaPath = `media/sha256-${sha256}.gif`;
  const evidencePath = "licenses/example.md";
  const manifest = {
    schemaVersion: 1,
    assets: [
      {
        id: "example",
        file: mediaPath,
        sha256,
        encodedBytes: bytes.length,
        media: {
          mimeType: "image/gif",
          width: 1,
          height: 1,
          gif: { frameCount: 1, durationMs: 0, cumulativeDecodedPixels: 1 },
        },
        provenance: {
          sourceUrl: "https://example.test/original.gif",
          creator: "Example Artist",
          rightsholder: "Example Artist",
          originalFileName: "original.gif",
          retrievedAt: "2026-07-26T12:00:00Z",
        },
        license: {
          licenseId: "CC0-1.0",
          evidencePath,
          redistributionAllowed: true,
          modificationAllowed: true,
          attributionRequired: false,
          attributionText: null,
        },
        approval: {
          productDistributionApproved: true,
          reviewedBy: "Release reviewer",
          reviewedAt: "2026-07-26T13:00:00Z",
        },
      },
    ],
  };

  mkdirSync(join(root, "media"), { recursive: true });
  mkdirSync(join(root, "licenses"), { recursive: true });
  writeFileSync(join(root, ...mediaPath.split("/")), bytes);
  writeFileSync(join(root, ...evidencePath.split("/")), "License evidence\n");
  const manifestPath = join(root, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return { bytes, evidencePath, manifest, manifestPath, mediaPath, root };
}

function issueCodes(
  result: Awaited<ReturnType<typeof inspectBundledAmbientAssetManifest>>,
): ReadonlyArray<BundledAmbientAssetValidationIssueCode> {
  return result.issues.map((issue) => issue.code);
}

async function expectSymlinkedAssetToBeRejected(linkKind: "directory" | "file"): Promise<void> {
  const fixture = makeFixture();
  const outside = mkdtempSync(join(tmpdir(), "cafecode-ambient-outside-"));
  try {
    const target =
      linkKind === "file" ? join(outside, "outside.gif") : join(outside, "outside-media");
    if (linkKind === "file") {
      writeFileSync(target, fixture.bytes);
      rmSync(join(fixture.root, ...fixture.mediaPath.split("/")));
    } else {
      mkdirSync(target);
      writeFileSync(join(target, fixture.mediaPath.split("/").at(-1)!), fixture.bytes);
      rmSync(join(fixture.root, "media"), { recursive: true });
    }

    const link =
      linkKind === "file"
        ? join(fixture.root, ...fixture.mediaPath.split("/"))
        : join(fixture.root, "media");
    try {
      symlinkSync(target, link, linkKind === "directory" ? "junction" : "file");
    } catch (cause) {
      if (
        typeof cause === "object" &&
        cause !== null &&
        "code" in cause &&
        cause.code === "EPERM"
      ) {
        return;
      }
      throw cause;
    }

    expect(issueCodes(await inspectBundledAmbientAssetManifest(fixture.manifestPath))).toContain(
      "symlink",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

describe("bundled ambient asset filesystem validator", () => {
  it("validates the repository's intentionally empty canonical manifest", async () => {
    const manifestPath = fileURLToPath(
      new URL("../../assets/ambient/manifest.json", import.meta.url),
    );
    await expect(validateBundledAmbientAssetManifest(manifestPath)).resolves.toEqual({
      schemaVersion: 1,
      assets: [],
    });
  });

  it("accepts documented regular files with matching size and SHA-256", async () => {
    const fixture = makeFixture();
    try {
      await expect(validateBundledAmbientAssetManifest(fixture.manifestPath)).resolves.toEqual(
        fixture.manifest,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects size and hash mismatches without reading outside the asset root", async () => {
    const sizeFixture = makeFixture();
    const hashFixture = makeFixture();
    try {
      sizeFixture.manifest.assets[0]!.encodedBytes += 1;
      writeFileSync(sizeFixture.manifestPath, `${JSON.stringify(sizeFixture.manifest, null, 2)}\n`);
      const tamperedBytes = Buffer.from(hashFixture.bytes);
      tamperedBytes[0] = tamperedBytes[0]! ^ 0xff;
      writeFileSync(join(hashFixture.root, ...hashFixture.mediaPath.split("/")), tamperedBytes);

      expect(
        issueCodes(await inspectBundledAmbientAssetManifest(sizeFixture.manifestPath)),
      ).toContain("size-mismatch");
      expect(
        issueCodes(await inspectBundledAmbientAssetManifest(hashFixture.manifestPath)),
      ).toContain("hash-mismatch");
    } finally {
      rmSync(sizeFixture.root, { recursive: true, force: true });
      rmSync(hashFixture.root, { recursive: true, force: true });
    }
  });

  it("rejects malformed metadata, duplicate ids, traversal, and absolute paths", async () => {
    const mutations: ReadonlyArray<(fixture: ReturnType<typeof makeFixture>) => void> = [
      (fixture) => {
        delete (fixture.manifest.assets[0] as Partial<(typeof fixture.manifest.assets)[number]>)
          .license;
      },
      (fixture) => {
        fixture.manifest.assets.push({ ...fixture.manifest.assets[0]! });
      },
      (fixture) => {
        fixture.manifest.assets[0]!.file = "../outside.gif";
      },
      (fixture) => {
        fixture.manifest.assets[0]!.file = "C:/outside.gif";
      },
      (fixture) => {
        fixture.manifest.assets[0]!.provenance.creator = "unknown";
      },
    ];

    for (const mutate of mutations) {
      const fixture = makeFixture();
      try {
        mutate(fixture);
        writeFileSync(fixture.manifestPath, `${JSON.stringify(fixture.manifest, null, 2)}\n`);
        expect(
          issueCodes(await inspectBundledAmbientAssetManifest(fixture.manifestPath)),
        ).toContain("invalid-manifest");
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    }
  });

  it("rejects unlisted files", async () => {
    const fixture = makeFixture();
    try {
      writeFileSync(join(fixture.root, "media", "unlisted.gif"), "not declared");
      const result = await inspectBundledAmbientAssetManifest(fixture.manifestPath);
      expect(result.issues).toContainEqual({
        code: "unlisted-file",
        path: "media/unlisted.gif",
        message: "is not declared by manifest.json",
      });
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked asset file", () => expectSymlinkedAssetToBeRejected("file"));

  it("rejects a symlinked containing directory", () =>
    expectSymlinkedAssetToBeRejected("directory"));

  it("rejects a symlinked manifest", async () => {
    const fixture = makeFixture();
    const linkPath = join(dirname(fixture.manifestPath), "linked-manifest.json");
    try {
      try {
        symlinkSync(fixture.manifestPath, linkPath, "file");
      } catch (cause) {
        if (
          typeof cause === "object" &&
          cause !== null &&
          "code" in cause &&
          cause.code === "EPERM"
        ) {
          return;
        }
        throw cause;
      }
      expect(issueCodes(await inspectBundledAmbientAssetManifest(linkPath))).toContain(
        "manifest-not-regular",
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});
