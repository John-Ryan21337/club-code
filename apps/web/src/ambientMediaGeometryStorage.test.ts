import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY,
  AMBIENT_MEDIA_GEOMETRY_STORAGE_VERSION,
  clampAmbientMediaGeometry,
  isNormalizedAmbientMediaGeometry,
  readAmbientMediaGeometry,
  readOrSeedAmbientMediaGeometry,
  resetAllAmbientMediaGeometry,
  resetAmbientMediaGeometry,
  writeAmbientMediaGeometry,
} from "./ambientMediaGeometryStorage";

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("ambientMediaGeometryStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the device-local storage key and document version stable", () => {
    expect(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY).toBe("cafe-code:ambient-media-geometry");
    expect(AMBIENT_MEDIA_GEOMETRY_STORAGE_VERSION).toBe(1);
  });

  it("validates and bounds normalized persisted geometry", () => {
    expect(isNormalizedAmbientMediaGeometry({ x: 0.2, y: 0.3, width: 0.4 })).toBe(true);
    expect(isNormalizedAmbientMediaGeometry({ x: 0.8, y: 0.3, width: 0.4 })).toBe(false);
    expect(isNormalizedAmbientMediaGeometry({ x: 0, y: 0, width: 0 })).toBe(false);
    const clamped = clampAmbientMediaGeometry({ x: 0.95, y: -0.2, width: 0.9 });
    expect(clamped?.x).toBeCloseTo(0.1);
    expect(clamped).toMatchObject({ y: 0, width: 0.9 });
    expect(clampAmbientMediaGeometry({ x: 0, y: 0, width: Number.NaN })).toBeNull();
  });

  it("derives height from final width after pane and product size clamping", () => {
    expect(
      clampAmbientMediaGeometry(
        { x: 0.8, y: 0.8, width: 0.2 },
        {
          mediaAspectRatio: 1,
          paneAspectRatio: 1,
          minimumWidth: 0.6,
          maximumWidth: 0.9,
        },
      ),
    ).toEqual({
      x: 0.4,
      y: 0.4,
      width: 0.6,
    });
    expect(
      clampAmbientMediaGeometry(
        { x: 0.8, y: 0.8, width: 0.8 },
        {
          mediaAspectRatio: 1,
          paneAspectRatio: 2,
        },
      ),
    ).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
    });
    expect(
      clampAmbientMediaGeometry(
        { x: 0, y: 0, width: 0.4 },
        {
          mediaAspectRatio: 1,
        },
      ),
    ).toBeNull();
    expect(
      clampAmbientMediaGeometry(
        { x: 0, y: 0, width: 0.4 },
        {
          mediaAspectRatio: 1,
          paneAspectRatio: 2,
          minimumWidth: 0.6,
        },
      ),
    ).toBeNull();
  });

  it("stores independent normalized geometry for video and image slots", () => {
    const storage = createLocalStorageStub();

    expect(writeAmbientMediaGeometry("video", { x: 0.85, y: 0.2, width: 0.4 }, { storage })).toBe(
      true,
    );
    expect(writeAmbientMediaGeometry("image", { x: 0.1, y: 0.7, width: 0.2 }, { storage })).toBe(
      true,
    );

    expect(readAmbientMediaGeometry("video", storage)).toEqual({
      x: 0.6,
      y: 0.2,
      width: 0.4,
    });
    expect(readAmbientMediaGeometry("image", storage)).toEqual({
      x: 0.1,
      y: 0.7,
      width: 0.2,
    });
  });

  it("enforces aspect-aware pane bounds at the persistence boundary", () => {
    const storage = createLocalStorageStub();

    expect(
      writeAmbientMediaGeometry(
        "image",
        { x: 0.8, y: 0.8, width: 0.8 },
        {
          storage,
          mediaAspectRatio: 1,
          paneAspectRatio: 2,
          minimumWidth: 0.1,
          maximumWidth: 0.9,
        },
      ),
    ).toBe(true);
    expect(readAmbientMediaGeometry("image", storage)).toEqual({
      x: 0.5,
      y: 0,
      width: 0.5,
    });
  });

  it("migrates legacy slot maps while repairing corrupt slots independently", () => {
    const storage = createLocalStorageStub();
    storage.setItem(
      AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY,
      JSON.stringify({
        version: 0,
        video: { x: 0.9, y: -0.25, width: 0.4 },
        image: { x: 0.1, y: 0.1, width: 0 },
      }),
    );

    expect(readAmbientMediaGeometry("video", storage)).toEqual({
      x: 0.6,
      y: 0,
      width: 0.4,
    });
    expect(readAmbientMediaGeometry("image", storage)).toBeNull();
    expect(JSON.parse(storage.getItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY)!)).toEqual({
      version: 1,
      slots: {
        video: { x: 0.6, y: 0, width: 0.4 },
      },
    });
  });

  it("migrates an unversioned legacy slot map", () => {
    const storage = createLocalStorageStub();
    storage.setItem(
      AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY,
      JSON.stringify({
        image: { x: 0.2, y: 0.3, width: 0.4 },
      }),
    );

    expect(readAmbientMediaGeometry("image", storage)).toEqual({
      x: 0.2,
      y: 0.3,
      width: 0.4,
    });
    expect(JSON.parse(storage.getItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY)!)).toEqual({
      version: 1,
      slots: {
        image: { x: 0.2, y: 0.3, width: 0.4 },
      },
    });
  });

  it("removes malformed or unsupported documents and recovers as empty", () => {
    const storage = createLocalStorageStub();

    storage.setItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY, "{not-json");
    expect(readAmbientMediaGeometry("video", storage)).toBeNull();
    expect(storage.getItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY)).toBeNull();

    storage.setItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY, JSON.stringify({ version: 99, slots: {} }));
    expect(readAmbientMediaGeometry("image", storage)).toBeNull();
    expect(storage.getItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY)).toBeNull();
  });

  it("fails closed without mutating storage when the document cannot be read", () => {
    const setItem = vi.fn();
    const removeItem = vi.fn();
    const storage: Storage = {
      ...createLocalStorageStub(),
      getItem: () => {
        throw new Error("read blocked");
      },
      setItem,
      removeItem,
    };

    expect(readAmbientMediaGeometry("image", storage)).toBeNull();
    expect(writeAmbientMediaGeometry("image", { x: 0, y: 0, width: 0.3 }, { storage })).toBe(false);
    expect(resetAmbientMediaGeometry("image", storage)).toBe(false);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("is inert when browser storage is unavailable", () => {
    const createSeed = vi.fn<() => unknown>().mockReturnValue({ x: 0, y: 0, width: 0.3 });
    vi.stubGlobal("window", undefined);

    expect(readAmbientMediaGeometry("image")).toBeNull();
    expect(writeAmbientMediaGeometry("image", { x: 0, y: 0, width: 0.3 })).toBe(false);
    expect(resetAmbientMediaGeometry("image")).toBe(false);
    expect(resetAllAmbientMediaGeometry()).toBe(false);
    expect(readOrSeedAmbientMediaGeometry("image", createSeed)).toBeNull();
    expect(createSeed).not.toHaveBeenCalled();
  });

  it("seeds a missing slot once and retains it across later entries", () => {
    const storage = createLocalStorageStub();
    const createSeed = vi
      .fn<() => unknown>()
      .mockReturnValueOnce({ x: 0.8, y: 0.7, width: 0.3 })
      .mockReturnValueOnce({ x: 0, y: 0, width: 0.2 });

    expect(readOrSeedAmbientMediaGeometry("image", createSeed, storage)).toEqual({
      x: 0.7,
      y: 0.7,
      width: 0.3,
    });
    expect(readOrSeedAmbientMediaGeometry("image", createSeed, storage)).toEqual({
      x: 0.7,
      y: 0.7,
      width: 0.3,
    });
    expect(createSeed).toHaveBeenCalledTimes(1);
  });

  it("does not claim a seed when persistence fails", () => {
    const storage: Storage = {
      ...createLocalStorageStub(),
      setItem: () => {
        throw new Error("write blocked");
      },
    };
    const createSeed = vi.fn<() => unknown>().mockReturnValue({ x: 0, y: 0, width: 0.3 });

    expect(readOrSeedAmbientMediaGeometry("image", createSeed, storage)).toBeNull();
    expect(createSeed).toHaveBeenCalledOnce();
  });

  it("resets one slot without disturbing the other and can reset the document", () => {
    const storage = createLocalStorageStub();
    writeAmbientMediaGeometry("video", { x: 0, y: 0, width: 0.4 }, { storage });
    writeAmbientMediaGeometry("image", { x: 0.6, y: 0.6, width: 0.4 }, { storage });

    expect(resetAmbientMediaGeometry("video", storage)).toBe(true);
    expect(readAmbientMediaGeometry("video", storage)).toBeNull();
    expect(readAmbientMediaGeometry("image", storage)).toEqual({
      x: 0.6,
      y: 0.6,
      width: 0.4,
    });

    expect(resetAllAmbientMediaGeometry(storage)).toBe(true);
    expect(storage.getItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY)).toBeNull();
  });
});
