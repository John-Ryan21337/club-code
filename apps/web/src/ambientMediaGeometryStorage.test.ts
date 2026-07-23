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

  it("validates normalized geometry and clamps it to supplied pane bounds", () => {
    expect(isNormalizedAmbientMediaGeometry({ x: 0.2, y: 0.3, width: 0.4 })).toBe(true);
    expect(isNormalizedAmbientMediaGeometry({ x: 0.8, y: 0.3, width: 0.4 })).toBe(false);
    expect(isNormalizedAmbientMediaGeometry({ x: 0, y: 0, width: 0 })).toBe(false);

    expect(
      clampAmbientMediaGeometry(
        { x: 0.95, y: -0.2, width: 0.9 },
        {
          mediaAspectRatio: 2,
          paneAspectRatio: 1,
          minimumWidth: 0.2,
          maximumWidth: 0.6,
        },
      ),
    ).toEqual({
      x: 0.4,
      y: 0,
      width: 0.6,
    });
    expect(clampAmbientMediaGeometry({ x: 0, y: 0, width: Number.NaN })).toBeNull();
  });

  it("derives height from the final width after minimum, maximum, and pane clamping", () => {
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
        { x: 0.8, y: 0.8, width: 0.9 },
        {
          mediaAspectRatio: 1,
          paneAspectRatio: 1,
          minimumWidth: 0.2,
          maximumWidth: 0.6,
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

  it("stores independent normalized geometry for the video and image slots", () => {
    const storage = createLocalStorageStub();

    expect(writeAmbientMediaGeometry("video", { x: 0.85, y: 0.2, width: 0.4 }, storage)).toBe(true);
    expect(writeAmbientMediaGeometry("image", { x: 0.1, y: 0.7, width: 0.2 }, storage)).toBe(true);

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
    expect(JSON.parse(storage.getItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY)!)).toEqual({
      version: 1,
      slots: {
        video: { x: 0.6, y: 0.2, width: 0.4 },
        image: { x: 0.1, y: 0.7, width: 0.2 },
      },
    });
  });

  it("migrates legacy slot maps while clamping recoverable data and resetting corrupt slots", () => {
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

  it("migrates an unversioned V0 slot map", () => {
    const storage = createLocalStorageStub();
    storage.setItem(
      AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY,
      JSON.stringify({
        video: { x: 0.2, y: 0.3, width: 0.4 },
      }),
    );

    expect(readAmbientMediaGeometry("video", storage)).toEqual({
      x: 0.2,
      y: 0.3,
      width: 0.4,
    });
    expect(JSON.parse(storage.getItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY)!)).toEqual({
      version: 1,
      slots: {
        video: { x: 0.2, y: 0.3, width: 0.4 },
      },
    });
  });

  it("repairs one corrupt current slot without deleting the other slot", () => {
    const storage = createLocalStorageStub();
    storage.setItem(
      AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        slots: {
          video: "corrupt",
          image: { x: 0.15, y: 0.25, width: 0.3 },
        },
      }),
    );

    expect(readAmbientMediaGeometry("video", storage)).toBeNull();
    expect(readAmbientMediaGeometry("image", storage)).toEqual({
      x: 0.15,
      y: 0.25,
      width: 0.3,
    });
    expect(JSON.parse(storage.getItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY)!)).toEqual({
      version: 1,
      slots: {
        image: { x: 0.15, y: 0.25, width: 0.3 },
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

  it("fails closed without mutating storage when the current document cannot be read", () => {
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
    const createSeed = vi.fn<() => unknown>().mockReturnValue({ x: 0, y: 0, width: 0.3 });

    expect(readAmbientMediaGeometry("video", storage)).toBeNull();
    expect(writeAmbientMediaGeometry("video", { x: 0, y: 0, width: 0.3 }, storage)).toBe(false);
    expect(resetAmbientMediaGeometry("video", storage)).toBe(false);
    expect(readOrSeedAmbientMediaGeometry("video", createSeed, storage)).toBeNull();
    expect(createSeed).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("reports write and remove failures without throwing or claiming persistence", () => {
    const writeBlockedStorage: Storage = {
      ...createLocalStorageStub(),
      setItem: () => {
        throw new Error("write blocked");
      },
    };
    const createSeed = vi.fn<() => unknown>().mockReturnValue({ x: 0, y: 0, width: 0.3 });

    expect(
      writeAmbientMediaGeometry(
        "video",
        {
          x: 0,
          y: 0,
          width: 0.3,
        },
        writeBlockedStorage,
      ),
    ).toBe(false);
    expect(readOrSeedAmbientMediaGeometry("video", createSeed, writeBlockedStorage)).toBeNull();
    expect(createSeed).toHaveBeenCalledTimes(1);

    const removeBlockedStorage: Storage = {
      ...createLocalStorageStub(),
      removeItem: () => {
        throw new Error("remove blocked");
      },
    };
    expect(resetAmbientMediaGeometry("video", removeBlockedStorage)).toBe(false);
    expect(resetAllAmbientMediaGeometry(removeBlockedStorage)).toBe(false);
  });

  it("is inert without a browser window or when the localStorage getter throws", () => {
    const createSeed = vi.fn<() => unknown>().mockReturnValue({ x: 0, y: 0, width: 0.3 });
    vi.stubGlobal("window", undefined);

    expect(readAmbientMediaGeometry("video")).toBeNull();
    expect(writeAmbientMediaGeometry("video", { x: 0, y: 0, width: 0.3 })).toBe(false);
    expect(resetAmbientMediaGeometry("video")).toBe(false);
    expect(resetAllAmbientMediaGeometry()).toBe(false);
    expect(readOrSeedAmbientMediaGeometry("video", createSeed)).toBeNull();
    expect(createSeed).not.toHaveBeenCalled();

    const windowWithBlockedStorage = {};
    Object.defineProperty(windowWithBlockedStorage, "localStorage", {
      get() {
        throw new Error("storage getter blocked");
      },
    });
    vi.stubGlobal("window", windowWithBlockedStorage);

    expect(readAmbientMediaGeometry("image")).toBeNull();
    expect(writeAmbientMediaGeometry("image", { x: 0, y: 0, width: 0.3 })).toBe(false);
    expect(resetAmbientMediaGeometry("image")).toBe(false);
    expect(resetAllAmbientMediaGeometry()).toBe(false);
    expect(readOrSeedAmbientMediaGeometry("image", createSeed)).toBeNull();
    expect(createSeed).not.toHaveBeenCalled();
  });

  it("seeds a missing slot once and retains that local geometry across later entries", () => {
    const storage = createLocalStorageStub();
    const createSeed = vi
      .fn<() => unknown>()
      .mockReturnValueOnce({ x: 0.8, y: 0.7, width: 0.3 })
      .mockReturnValueOnce({ x: 0, y: 0, width: 0.2 });

    expect(readOrSeedAmbientMediaGeometry("video", createSeed, storage)).toEqual({
      x: 0.7,
      y: 0.7,
      width: 0.3,
    });
    expect(readOrSeedAmbientMediaGeometry("video", createSeed, storage)).toEqual({
      x: 0.7,
      y: 0.7,
      width: 0.3,
    });
    expect(createSeed).toHaveBeenCalledTimes(1);
  });

  it("resets one slot without disturbing the other and can reset the whole document", () => {
    const storage = createLocalStorageStub();
    writeAmbientMediaGeometry("video", { x: 0, y: 0, width: 0.4 }, storage);
    writeAmbientMediaGeometry("image", { x: 0.6, y: 0.6, width: 0.4 }, storage);

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
