import { assert, describe, it } from "@effect/vitest";

import { AMBIENT_IMAGE_ID_PATTERN, validateAmbientImageContent } from "./ambientImageContent.ts";
import { oversizedGif, tinyGif, tinyJpeg, tinyPng, tinyWebp } from "./ambientImageTestFixtures.ts";

describe("ambient image content validation", () => {
  it("validates supported raster bytes and reports their content headers", () => {
    const cases = [
      { bytes: tinyPng, declaredMimeType: "image/png", expectedMimeType: "image/png" },
      { bytes: tinyGif, declaredMimeType: "image/gif", expectedMimeType: "image/gif" },
      { bytes: tinyJpeg, declaredMimeType: "image/jpeg", expectedMimeType: "image/jpeg" },
      { bytes: tinyWebp, declaredMimeType: "image/webp", expectedMimeType: "image/webp" },
    ] as const;

    for (const candidate of cases) {
      const result = validateAmbientImageContent(candidate);
      assert.isTrue(result.ok);
      if (!result.ok) continue;
      assert.equal(result.header.mimeType, candidate.expectedMimeType);
      assert.equal(result.header.width, 1);
      assert.equal(result.header.height, 1);
    }
  });

  it("rejects forged MIME, animation containers, malformed bytes, and work bombs", () => {
    const apng = Uint8Array.from([...tinyPng.subarray(0, 8), 0, 0, 0, 0, 0x61, 0x63, 0x54, 0x4c]);
    const badPngCrc = tinyPng.slice();
    badPngCrc[52] = badPngCrc[52]! ^ 0xff;
    const headerOnlyJpeg = Uint8Array.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const headerOnlyWebp = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
      0x58, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    const webpBeforeTrailingFragment = tinyWebp.slice();
    const webpRiffSize = webpBeforeTrailingFragment.byteLength - 7;
    const malformedWebp = Uint8Array.from([...webpBeforeTrailingFragment, 0x00]);
    malformedWebp[4] = webpRiffSize & 0xff;
    malformedWebp[5] = (webpRiffSize >>> 8) & 0xff;
    malformedWebp[6] = (webpRiffSize >>> 16) & 0xff;
    malformedWebp[7] = (webpRiffSize >>> 24) & 0xff;
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
    const repeatedFrame = tinyGif.subarray(19, tinyGif.byteLength - 1);
    const excessiveFramesGif = Uint8Array.from([
      ...tinyGif.subarray(0, 19),
      ...Array.from({ length: 241 }, () => Array.from(repeatedFrame)).flat(),
      0x3b,
    ]);

    const invalidCandidates = [
      { bytes: new Uint8Array(), declaredMimeType: "image/png" },
      { bytes: Uint8Array.from([1, 2, 3]), declaredMimeType: "image/png" },
      { bytes: apng, declaredMimeType: "image/png" },
      { bytes: tinyPng.subarray(0, tinyPng.byteLength - 12), declaredMimeType: "image/png" },
      { bytes: badPngCrc, declaredMimeType: "image/png" },
      { bytes: headerOnlyJpeg, declaredMimeType: "image/jpeg" },
      { bytes: headerOnlyWebp, declaredMimeType: "image/webp" },
      { bytes: Uint8Array.from([...tinyJpeg, 0x00]), declaredMimeType: "image/jpeg" },
      { bytes: malformedWebp, declaredMimeType: "image/webp" },
      { bytes: excessiveDurationGif, declaredMimeType: "image/gif" },
      { bytes: excessiveFramesGif, declaredMimeType: "image/gif" },
    ];

    for (const candidate of invalidCandidates) {
      assert.isFalse(validateAmbientImageContent(candidate).ok);
    }
    assert.deepEqual(
      validateAmbientImageContent({ bytes: tinyPng, declaredMimeType: "image/gif" }),
      {
        ok: false,
        error: {
          code: "unsupported-type",
          status: 415,
          message: "Ambient image type does not match the file data.",
        },
      },
    );
    assert.deepEqual(
      validateAmbientImageContent({ bytes: tinyPng, declaredMimeType: "text/plain" }),
      {
        ok: false,
        error: {
          code: "unsupported-type",
          status: 415,
          message: "Ambient image type is unsupported.",
        },
      },
    );
    assert.equal(validateAmbientImageContent({ bytes: oversizedGif() }).ok, false);
  });

  it("accepts only canonical content-addressed asset identifiers", () => {
    const canonical = `sha256-${"a".repeat(64)}.png`;
    assert.isTrue(AMBIENT_IMAGE_ID_PATTERN.test(canonical));
    for (const value of [
      "../outside.png",
      "..%2foutside.png",
      "C:\\outside.png",
      `/tmp/${canonical}`,
      `sha256-${"A".repeat(64)}.png`,
      `sha256-${"a".repeat(63)}.png`,
      `sha256-${"a".repeat(64)}.svg`,
    ]) {
      assert.isFalse(AMBIENT_IMAGE_ID_PATTERN.test(value));
    }
  });
});
