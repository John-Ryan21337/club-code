import { describe, expect, it } from "vitest";
import { profileLibraryMayReferenceImage } from "./settingsProfileAssets.ts";

describe("profile image retention", () => {
  it("retains images used by an inactive profile or cycle", () => {
    const document = JSON.stringify({
      version: 5,
      profiles: [
        {
          clientSettings: {
            ambientImageAsset: { id: "saved" },
            ambientImageCycleAssets: [{ id: "cycle" }],
          },
        },
      ],
    });
    expect(profileLibraryMayReferenceImage(document, "saved")).toBe(true);
    expect(profileLibraryMayReferenceImage(document, "cycle")).toBe(true);
    expect(profileLibraryMayReferenceImage(document, "unused")).toBe(false);
  });
  it("fails closed when the library has not migrated, is damaged, or comes from a newer version", () => {
    for (const raw of [
      null,
      "{broken",
      '{"version":6,"profiles":[]}',
      '{"version":5,"profiles":[null]}',
    ])
      expect(profileLibraryMayReferenceImage(raw, "image")).toBe(true);
  });
});
