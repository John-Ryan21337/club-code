import { describe, expect, it } from "vitest";

import {
  AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY,
  AMBIENT_IMAGE_GEOMETRY_STORAGE_VERSION,
  clampAmbientImageGeometry,
  isAmbientImageGeometry,
  readAmbientImageGeometry,
  readOrSeedAmbientImageGeometry,
  resetAmbientImageGeometry,
  writeAmbientImageGeometry,
} from "./ambientImageGeometry";

/** In-memory `Storage` so the tests never touch a real browser profile. */
function createStorage(initial?: string): Storage & { readonly raw: () => string | null } {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY, initial);
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
    raw: () => map.get(AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY) ?? null,
  };
}

/** A `Storage` that refuses every write, as a full or private profile does. */
function createReadOnlyStorage(initial?: string): Storage {
  const storage = createStorage(initial);
  return {
    ...storage,
    setItem: () => {
      throw new Error("quota exceeded");
    },
    removeItem: () => {
      throw new Error("quota exceeded");
    },
  } as Storage;
}

const GEOMETRY = { x: 0.1, y: 0.2, width: 0.3 };
const document = (slot: unknown) =>
  JSON.stringify({ version: AMBIENT_IMAGE_GEOMETRY_STORAGE_VERSION, slots: { image: slot } });

describe("clampAmbientImageGeometry", () => {
  it("accepts geometry that is already inside the pane", () => {
    expect(clampAmbientImageGeometry(GEOMETRY)).toEqual(GEOMETRY);
  });

  it("rejects non-finite and non-numeric values", () => {
    expect(clampAmbientImageGeometry({ x: 0, y: 0, width: Number.POSITIVE_INFINITY })).toBeNull();
    expect(clampAmbientImageGeometry({ x: "0", y: 0, width: 0.2 })).toBeNull();
    expect(clampAmbientImageGeometry(undefined)).toBeNull();
    expect(clampAmbientImageGeometry({ x: 0, y: 0, width: 0 })).toBeNull();
  });

  it("rejects bounds that describe no reachable rectangle", () => {
    // Only one aspect ratio cannot describe a rectangle.
    expect(clampAmbientImageGeometry(GEOMETRY, { mediaAspectRatio: 1.5 })).toBeNull();
    expect(
      clampAmbientImageGeometry(GEOMETRY, { minimumWidth: 0.8, maximumWidth: 0.2 }),
    ).toBeNull();
  });

  it("derives the height from the clamped width", () => {
    // A square image in a 2:1 pane: a full-width panel would be twice the pane
    // height, so the width has to come down to one half.
    const clamped = clampAmbientImageGeometry(
      { x: 0, y: 0, width: 1 },
      { mediaAspectRatio: 1, paneAspectRatio: 2 },
    );
    expect(clamped?.width).toBeCloseTo(0.5, 6);
  });
});

describe("isAmbientImageGeometry", () => {
  it("accepts a rectangle inside the pane and refuses one that overflows", () => {
    expect(isAmbientImageGeometry(GEOMETRY)).toBe(true);
    expect(isAmbientImageGeometry({ x: 0.9, y: 0.2, width: 0.3 })).toBe(false);
    expect(isAmbientImageGeometry({ x: 0.1, y: -0.2, width: 0.3 })).toBe(false);
  });
});

describe("storage round trip", () => {
  it("writes and reads one slot", () => {
    const storage = createStorage();
    expect(writeAmbientImageGeometry(GEOMETRY, "image", storage)).toBe(true);
    expect(readAmbientImageGeometry("image", storage)).toEqual(GEOMETRY);
  });

  it("refuses to store geometry that is not a rectangle", () => {
    const storage = createStorage();
    expect(writeAmbientImageGeometry({ x: 0, y: 0, width: -1 }, "image", storage)).toBe(false);
    expect(storage.raw()).toBeNull();
  });

  it("repairs a stored rectangle that overflows the pane", () => {
    const storage = createStorage(document({ x: 0.95, y: 0.5, width: 0.4 }));
    const read = readAmbientImageGeometry("image", storage);
    expect(read?.x).toBeCloseTo(0.6, 6);
    // The repair is written back, so the next read does not repeat the work.
    expect(storage.raw()).toBe(document({ x: 0.6, y: 0.5, width: 0.4 }));
  });

  it("drops an unreadable document instead of guessing a position", () => {
    const corrupt = createStorage("{not json");
    expect(readAmbientImageGeometry("image", corrupt)).toBeNull();
    expect(corrupt.raw()).toBeNull();

    const wrongVersion = createStorage(JSON.stringify({ version: 99, slots: { image: GEOMETRY } }));
    expect(readAmbientImageGeometry("image", wrongVersion)).toBeNull();

    const badSlot = createStorage(document({ x: "left", y: 0, width: 0.3 }));
    expect(readAmbientImageGeometry("image", badSlot)).toBeNull();
  });

  it("removes the document when the last slot is reset", () => {
    const storage = createStorage(document(GEOMETRY));
    expect(resetAmbientImageGeometry("image", storage)).toBe(true);
    expect(storage.raw()).toBeNull();
    expect(readAmbientImageGeometry("image", storage)).toBeNull();
  });

  it("reports no storage rather than failing when storage is unavailable", () => {
    expect(readAmbientImageGeometry("image", null)).toBeNull();
    expect(writeAmbientImageGeometry(GEOMETRY, "image", null)).toBe(false);
    expect(resetAmbientImageGeometry("image", null)).toBe(false);
    expect(readOrSeedAmbientImageGeometry(() => GEOMETRY, "image", null)).toBeNull();
  });
});

describe("readOrSeedAmbientImageGeometry", () => {
  it("drops an oversized envelope before reading its otherwise valid geometry", () => {
    const storage = createStorage(
      JSON.stringify({ version: 1, slots: { image: GEOMETRY }, padding: "x".repeat(4096) }),
    );
    expect(readAmbientImageGeometry("image", storage)).toBeNull();
    expect(storage.raw()).toBeNull();
  });
  it("returns the stored value and ignores the seed", () => {
    const storage = createStorage(document(GEOMETRY));
    expect(
      readOrSeedAmbientImageGeometry(() => ({ x: 0, y: 0, width: 0.9 }), "image", storage),
    ).toEqual(GEOMETRY);
  });

  it("stores and returns the seed when nothing is stored yet", () => {
    const storage = createStorage();
    expect(readOrSeedAmbientImageGeometry(() => GEOMETRY, "image", storage)).toEqual(GEOMETRY);
    expect(readAmbientImageGeometry("image", storage)).toEqual(GEOMETRY);
  });

  it("returns null when the seed cannot be persisted", () => {
    // The caller must not report a saved position that no storage accepted.
    const storage = createReadOnlyStorage();
    expect(readOrSeedAmbientImageGeometry(() => GEOMETRY, "image", storage)).toBeNull();
  });

  it("returns null for a seed that is not geometry", () => {
    const storage = createStorage();
    expect(readOrSeedAmbientImageGeometry(() => null, "image", storage)).toBeNull();
  });
});
