import {
  ClientSettingsSchema,
  ClientSettingsPatch,
  DEFAULT_CLIENT_SETTINGS,
} from "@cafecode/contracts/settings";
import * as Struct from "effect/Struct";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The consent store is backed by the shared isomorphic local-storage helpers.
 * The test replaces that backing store with an in-memory one it can break on
 * demand, because a real storage quota/permission failure is what the "consent
 * did not persist" path has to survive.
 */
const storageMock = vi.hoisted(() => {
  const entries = new Map<string, string>();
  return {
    entries,
    failWrites: false,
    getLocalStorageItem: (key: string) => {
      const raw = entries.get(key);
      if (raw === undefined) return null;
      // Mirrors the real helper: a malformed value throws on decode.
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "boolean") throw new Error("schema mismatch");
      return parsed;
    },
    setLocalStorageItem: (key: string, value: unknown) => {
      if (storageMock.failWrites) throw new Error("storage unavailable");
      entries.set(key, JSON.stringify(value));
    },
    removeLocalStorageItem: (key: string) => {
      if (storageMock.failWrites) throw new Error("storage unavailable");
      entries.delete(key);
    },
  };
});

vi.mock("./hooks/useLocalStorage", () => ({
  getLocalStorageItem: (key: string) => storageMock.getLocalStorageItem(key),
  setLocalStorageItem: (key: string, value: unknown) => storageMock.setLocalStorageItem(key, value),
  removeLocalStorageItem: (key: string) => storageMock.removeLocalStorageItem(key),
}));

const {
  __resetWorldClockWeatherConsentForTests,
  DEFAULT_WORLD_CLOCK_WEATHER_ENABLED,
  getWorldClockWeatherConsent,
  subscribeWorldClockWeatherConsent,
  WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY,
  writeWorldClockWeatherConsent,
} = await import("./worldClockWeatherConsent");

describe("world clock weather consent", () => {
  beforeEach(() => {
    storageMock.failWrites = false;
    storageMock.entries.clear();
    __resetWorldClockWeatherConsentForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    storageMock.failWrites = false;
    storageMock.entries.clear();
  });

  it("is absent from the synced client settings contract", () => {
    // The enforcement of "never synced through server settings, profiles, or
    // other clients" is that no such field exists for a sync path to copy. A
    // change that adds the key to either schema fails here, before it can
    // reach the settings RPC or the persisted settings file.
    expect(Struct.keys(ClientSettingsSchema.fields)).not.toContain("worldClockWeatherEnabled");
    expect(Struct.keys(ClientSettingsPatch.fields)).not.toContain("worldClockWeatherEnabled");
    expect(DEFAULT_CLIENT_SETTINGS).not.toHaveProperty("worldClockWeatherEnabled");
    // The three shared clock keys are ordinary client settings and stay there.
    for (const key of ["worldClockEnabled", "worldClockStyle", "worldClockLocationIds"]) {
      expect(Struct.keys(ClientSettingsSchema.fields)).toContain(key);
      expect(Struct.keys(ClientSettingsPatch.fields)).toContain(key);
    }
  });

  it("defaults to off and reads back a granted consent", async () => {
    expect(DEFAULT_WORLD_CLOCK_WEATHER_ENABLED).toBe(false);
    expect(getWorldClockWeatherConsent()).toBe(false);

    await writeWorldClockWeatherConsent(true);
    expect(getWorldClockWeatherConsent()).toBe(true);
    expect(storageMock.entries.get(WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY)).toBe("true");
  });

  it("removes the record when consent is withdrawn so a later read fails closed", async () => {
    await writeWorldClockWeatherConsent(true);
    await writeWorldClockWeatherConsent(false);
    expect(getWorldClockWeatherConsent()).toBe(false);
    expect(storageMock.entries.has(WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY)).toBe(false);
  });

  it("treats a corrupted stored value as no consent", () => {
    storageMock.entries.set(WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY, "{not-json");
    __resetWorldClockWeatherConsentForTests();
    storageMock.entries.set(WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY, "{not-json");
    expect(getWorldClockWeatherConsent()).toBe(false);
  });

  it("rejects and keeps the previous value when the write cannot persist", async () => {
    storageMock.failWrites = true;

    await expect(writeWorldClockWeatherConsent(true)).rejects.toThrow();
    // A failed write must never publish consent. The widget reads this value
    // directly to decide whether an outbound third-party request may run.
    expect(getWorldClockWeatherConsent()).toBe(false);
  });

  it("notifies subscribers only after a successful write", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorldClockWeatherConsent(listener);
    try {
      storageMock.failWrites = true;
      await expect(writeWorldClockWeatherConsent(true)).rejects.toThrow();
      expect(listener).not.toHaveBeenCalled();

      storageMock.failWrites = false;
      await writeWorldClockWeatherConsent(true);
      expect(listener).toHaveBeenCalledTimes(1);

      // A no-op write must not churn subscribers.
      await writeWorldClockWeatherConsent(true);
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
    }
  });

  it("keeps cross-tab revocation subscribed after the first consumer unmounts", async () => {
    const target = new EventTarget();
    vi.stubGlobal("window", target);
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeWorldClockWeatherConsent(first);
    const stopSecond = subscribeWorldClockWeatherConsent(second);
    try {
      await writeWorldClockWeatherConsent(true);
      stopFirst();
      first.mockClear();
      second.mockClear();
      storageMock.entries.delete(WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY);
      target.dispatchEvent(
        Object.assign(new Event("storage"), {
          key: WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY,
        }),
      );
      expect(getWorldClockWeatherConsent()).toBe(false);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledOnce();
    } finally {
      stopFirst();
      stopSecond();
    }
  });
});
