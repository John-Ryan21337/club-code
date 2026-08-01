import {
  ClientSettingsSchema,
  DEFAULT_UNIFIED_SETTINGS,
  type UnifiedSettings,
} from "@cafecode/contracts/settings";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureSettingsProfilePayload,
  createSettingsProfileLibraryStore,
  mutateSettingsProfileLibrary,
  SETTINGS_PROFILE_CLIENT_FIELD_POLICY,
  SETTINGS_PROFILE_CLIENT_KEYS,
  SETTINGS_PROFILE_LIBRARY_MUTATION_LOCK_NAME,
  SETTINGS_PROFILE_LIBRARY_STORAGE_KEY,
  SETTINGS_PROFILE_LIBRARY_VERSION,
  SETTINGS_PROFILE_MAX_COUNT,
  SETTINGS_PROFILE_MAX_STORAGE_BYTES,
  type SettingsProfileMutationLock,
  SettingsProfileError,
} from "./settingsProfiles";

function createStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      entries.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      entries.delete(key);
    }),
    read: (key: string) => entries.get(key) ?? null,
  };
}

function createSerialMutationLock(): SettingsProfileMutationLock & {
  readonly requests: readonly string[];
} {
  let tail = Promise.resolve();
  const requests: string[] = [];
  return {
    requests,
    request: async <Value>(name: string, callback: () => Value): Promise<Value> => {
      requests.push(name);
      const previous = tail;
      let release: (() => void) | undefined;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await callback();
      } finally {
        release?.();
      }
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("settings profile library", () => {
  it("classifies every ClientSettings field before it can enter or bypass profiles", () => {
    expect(Object.keys(SETTINGS_PROFILE_CLIENT_FIELD_POLICY)).toEqual(
      Object.keys(ClientSettingsSchema.fields),
    );
    expect(SETTINGS_PROFILE_CLIENT_KEYS).toEqual(
      Object.entries(SETTINGS_PROFILE_CLIENT_FIELD_POLICY)
        .filter(([, policy]) => policy === "include")
        .map(([key]) => key),
    );
    expect(SETTINGS_PROFILE_CLIENT_FIELD_POLICY.notificationsEnabled).toBe("external-operation");
    expect(SETTINGS_PROFILE_CLIENT_FIELD_POLICY.defaultEditor).toBe("native-machine-control");
    expect(SETTINGS_PROFILE_CLIENT_FIELD_POLICY.ambientImageCycleSeconds).toBe("include");
  });

  it("captures only the explicit local preference allowlist", () => {
    const settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectsEnabled: true,
      timestampFormat: "24-hour",
      ambientImageCycleSeconds: 45,
      notificationsEnabled: true,
      ambientVideoEnabled: true,
      ambientVideoSource: { kind: "video", id: "private-video" },
      ambientImageEnabled: true,
      ambientImageAsset: {
        id: "private-image",
        mimeType: "image/png",
        width: 100,
        height: 100,
      },
      ambientImageCycleAssets: [],
      ambientImageCycleEnabled: true,
      sidebarBrandImage: {
        id: "private-brand",
        mimeType: "image/png",
        width: 100,
        height: 100,
      },
      providerUsageWidgetEnabled: true,
      providerUsagePollMinutes: 1,
      powerSaveBlockerMode: "always",
      defaultEditor: "vscode",
      autoNudgeMode: "prompt",
      autoNudgeMaxRounds: 99,
      // Legacy time-based Auto Nudge data must not survive as compatibility payload.
      autoNudgeMaxMinutes: 30,
      modelPacingEnabled: true,
      providerModelPreferences: {
        "claude-private": { hiddenModels: ["secret-model"], modelOrder: [] },
      },
      sidebarProjectGroupingOverrides: {
        "C:\\private\\customer": "separate",
      },
      providerInstances: {
        "claude-private": {
          driver: "claudeAgent",
          label: "Personal account",
          enabled: true,
          config: { token: "never-store-me" },
        },
      },
      defaultProviderInstanceId: "claude-private",
      observability: { otlpTracesUrl: "https://private.example", otlpMetricsUrl: "" },
      addProjectBaseDirectory: "C:\\private",
      serverPassword: "never-store-this-credential",
    } as unknown as UnifiedSettings;

    const payload = captureSettingsProfilePayload(settings, "dark");

    expect(payload.theme).toBe("dark");
    expect(payload.clientSettings.fallingEffectsEnabled).toBe(true);
    expect(payload.clientSettings.timestampFormat).toBe("24-hour");
    expect(payload.clientSettings.ambientImageCycleSeconds).toBe(45);
    expect(Object.keys(payload.clientSettings)).toEqual([...SETTINGS_PROFILE_CLIENT_KEYS]);
    expect(
      Object.values(payload.clientSettings).every((value) =>
        ["boolean", "number", "string"].includes(typeof value),
      ),
    ).toBe(true);
    expect(payload.clientSettings).not.toHaveProperty("autoNudgeMode");
    expect(payload.clientSettings).not.toHaveProperty("autoNudgeMaxRounds");
    expect(payload.clientSettings).not.toHaveProperty("autoNudgeMaxMinutes");
    expect(payload.clientSettings).not.toHaveProperty("modelPacingEnabled");
    expect(payload.clientSettings).not.toHaveProperty("providerModelPreferences");
    expect(payload.clientSettings).not.toHaveProperty("sidebarProjectGroupingOverrides");
    expect(payload.clientSettings).not.toHaveProperty("providerInstances");
    expect(payload.clientSettings).not.toHaveProperty("defaultProviderInstanceId");
    expect(payload.clientSettings).not.toHaveProperty("observability");
    expect(payload.clientSettings).not.toHaveProperty("addProjectBaseDirectory");
    expect(payload.clientSettings).not.toHaveProperty("serverPassword");
    expect(payload.clientSettings).not.toHaveProperty("ambientVideoEnabled");
    expect(payload.clientSettings).not.toHaveProperty("ambientVideoSource");
    expect(payload.clientSettings).not.toHaveProperty("ambientImageEnabled");
    expect(payload.clientSettings).not.toHaveProperty("ambientImageAsset");
    expect(payload.clientSettings).not.toHaveProperty("ambientImageCycleAssets");
    expect(payload.clientSettings).not.toHaveProperty("ambientImageCycleEnabled");
    expect(payload.clientSettings).not.toHaveProperty("sidebarBrandImage");
    expect(payload.clientSettings).not.toHaveProperty("providerUsageWidgetEnabled");
    expect(payload.clientSettings).not.toHaveProperty("providerUsagePollMinutes");
    expect(payload.clientSettings).not.toHaveProperty("powerSaveBlockerMode");
    expect(payload.clientSettings).not.toHaveProperty("notificationsEnabled");
    expect(payload.clientSettings).not.toHaveProperty("defaultEditor");
  });

  it("persists named profiles and the active selection in a versioned local document", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T08:00:00.000Z"));
    const storage = createStorage();
    const store = createSettingsProfileLibraryStore(storage);
    const mobilePayload = captureSettingsProfilePayload(
      {
        ...DEFAULT_UNIFIED_SETTINGS,
        fallingEffectDensity: 1,
        sidebarThreadPreviewCount: 3,
      },
      "dark",
    );

    const saved = store.upsert("  Mobile  ", mobilePayload);

    expect(saved.persisted).toBe(true);
    expect(saved.replaced).toBe(false);
    expect(saved.profile.name).toBe("Mobile");
    expect(store.getSnapshot().activeProfileId).toBe("profile:mobile");

    const document = JSON.parse(storage.read(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY) ?? "{}");
    expect(document.version).toBe(SETTINGS_PROFILE_LIBRARY_VERSION);
    expect(document.activeProfileId).toBe("profile:mobile");
    expect(document.profiles).toHaveLength(1);
    expect(document.profiles[0]).not.toHaveProperty("id");
    expect(document.profiles[0].clientSettings.fallingEffectDensity).toBe(1);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).not.toHaveBeenCalled();

    const restored = createSettingsProfileLibraryStore(storage);
    expect(restored.getSnapshot()).toEqual(store.getSnapshot());
  });

  it("overwrites a case-insensitive name and updates or renames the active profile", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T08:00:00.000Z"));
    const storage = createStorage();
    const store = createSettingsProfileLibraryStore(storage);
    const first = store.upsert(
      "Desktop",
      captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "dark"),
    );
    vi.setSystemTime(new Date("2026-07-29T08:01:00.000Z"));
    const replacement = store.upsert(
      "desktop",
      captureSettingsProfilePayload(
        { ...DEFAULT_UNIFIED_SETTINGS, continueBackgroundAnimations: false },
        "light",
      ),
    );

    expect(replacement.replaced).toBe(true);
    expect(store.getSnapshot().profiles).toHaveLength(1);
    expect(replacement.profile.createdAt).toBe(first.profile.createdAt);
    expect(replacement.profile.updatedAt).not.toBe(first.profile.updatedAt);
    expect(replacement.profile.theme).toBe("light");

    const updated = store.updateActive(
      captureSettingsProfilePayload(
        { ...DEFAULT_UNIFIED_SETTINGS, sidebarThreadPreviewCount: 10 },
        "system",
      ),
    );
    expect(updated.profile.clientSettings.sidebarThreadPreviewCount).toBe(10);

    const renamed = store.rename(updated.profile.id, "Large Screen");
    expect(renamed.profile.id).toBe("profile:large%20screen");
    expect(store.getSnapshot().activeProfileId).toBe(renamed.profile.id);

    const restored = createSettingsProfileLibraryStore(storage);
    expect(restored.getSnapshot().activeProfileId).toBe("profile:large%20screen");
    expect(restored.resolve("profile:large%20screen")?.name).toBe("Large Screen");
  });

  it("keeps profile names unique and removes the active marker with deletion", () => {
    const storage = createStorage();
    const store = createSettingsProfileLibraryStore(storage);
    store.upsert("Mobile", captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "dark"));
    const desktop = store.upsert(
      "Desktop",
      captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "dark"),
    );

    expect(() => store.rename(desktop.profile.id, " mobile ")).toThrow(SettingsProfileError);
    expect(store.remove(desktop.profile.id)).toBe(true);
    expect(store.getSnapshot().activeProfileId).toBeNull();
    expect(createSettingsProfileLibraryStore(storage).getSnapshot().profiles).toHaveLength(1);
  });

  it("normalizes compatible names while rejecting path separators and invisible controls", () => {
    const store = createSettingsProfileLibraryStore(createStorage());
    const payload = captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "dark");

    const first = store.upsert("  Ｍｏｂｉｌｅ\tLayout  ", payload);
    const replacement = store.upsert("mobile layout", payload);

    expect(first.profile.name).toBe("Mobile Layout");
    expect(replacement.replaced).toBe(true);
    expect(store.getSnapshot().profiles).toHaveLength(1);
    expect(() => store.upsert("Desktop/Private", payload)).toThrow(SettingsProfileError);
    expect(() => store.upsert("Desktop\u202ePrivate", payload)).toThrow(SettingsProfileError);
    expect(() => store.upsert("Broken\ud800Name", payload)).toThrow(SettingsProfileError);
    expect(() => store.upsert("x".repeat(257), payload)).toThrow(SettingsProfileError);
  });

  it("resolves normalized names without exposing duplicate persisted profile IDs", () => {
    const storage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: SETTINGS_PROFILE_LIBRARY_VERSION,
        activeProfileId: "profile:mobile",
        profiles: [
          {
            name: "Ｍｏｂｉｌｅ",
            theme: "dark",
            clientSettings: { sidebarThreadPreviewCount: 2 },
            createdAt: "2026-07-29T08:00:00.000Z",
            updatedAt: "2026-07-29T08:00:00.000Z",
          },
          {
            name: "mobile",
            theme: "light",
            clientSettings: { sidebarThreadPreviewCount: 9 },
            createdAt: "2026-07-29T09:00:00.000Z",
            updatedAt: "2026-07-29T09:00:00.000Z",
          },
        ],
      }),
    });

    const store = createSettingsProfileLibraryStore(storage);

    expect(store.getSnapshot().profiles).toHaveLength(1);
    expect(store.resolveByName(" MOBILE ")?.name).toBe("Mobile");
    expect(store.resolveByName("mobile")?.clientSettings.sidebarThreadPreviewCount).toBe(2);
  });

  it("limits the library by valid profile count rather than malformed candidate position", () => {
    const invalidCandidates = Array.from({ length: SETTINGS_PROFILE_MAX_COUNT + 4 }, () => ({
      name: "",
      theme: "dark",
      clientSettings: {},
    }));
    const storage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: SETTINGS_PROFILE_LIBRARY_VERSION,
        activeProfileId: "profile:mobile",
        profiles: [
          ...invalidCandidates,
          {
            name: "Mobile",
            theme: "dark",
            clientSettings: { sidebarThreadPreviewCount: 2 },
            createdAt: "2026-07-29T08:00:00.000Z",
            updatedAt: "2026-07-29T08:00:00.000Z",
          },
        ],
      }),
    });

    const restored = createSettingsProfileLibraryStore(storage);

    expect(restored.resolve("profile:mobile")?.name).toBe("Mobile");
    const payload = captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "dark");
    for (let index = 1; index < SETTINGS_PROFILE_MAX_COUNT; index += 1) {
      restored.upsert(`Profile ${index}`, payload);
    }
    expect(restored.getSnapshot().profiles).toHaveLength(SETTINGS_PROFILE_MAX_COUNT);
    expect(() => restored.upsert("One too many", payload)).toThrow(SettingsProfileError);
  });

  it("fails closed for oversized, malformed, and unsupported persisted documents", () => {
    const oversizedStorage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: "x".repeat(SETTINGS_PROFILE_MAX_STORAGE_BYTES + 1),
    });
    const malformedStorage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: "{not-json",
    });
    const futureStorage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: SETTINGS_PROFILE_LIBRARY_VERSION + 1,
        activeProfileId: null,
        profiles: [],
      }),
    });

    expect(createSettingsProfileLibraryStore(oversizedStorage).getSnapshot().profiles).toEqual([]);
    expect(createSettingsProfileLibraryStore(malformedStorage).getSnapshot().profiles).toEqual([]);
    expect(createSettingsProfileLibraryStore(futureStorage).getSnapshot().profiles).toEqual([]);
  });

  it("repairs non-canonical imported timestamps without retaining attacker-controlled date text", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T10:00:00.000Z"));
    const storage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: SETTINGS_PROFILE_LIBRARY_VERSION,
        activeProfileId: "profile:mobile",
        profiles: [
          {
            name: "Mobile",
            theme: "dark",
            clientSettings: {},
            createdAt: "0",
            updatedAt: "2026-02-31",
          },
        ],
      }),
    });

    const profile = createSettingsProfileLibraryStore(storage).resolve("profile:mobile");

    expect(profile?.createdAt).toBe("2026-07-30T10:00:00.000Z");
    expect(profile?.updatedAt).toBe("2026-07-30T10:00:00.000Z");
  });

  it("drops unknown, secret, execution, and malformed fields independently on restore", () => {
    const storage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: SETTINGS_PROFILE_LIBRARY_VERSION,
        activeProfileId: "profile:mobile",
        profiles: [
          {
            name: "Mobile",
            theme: "system",
            createdAt: "2026-07-29T08:00:00.000Z",
            updatedAt: "2026-07-29T08:01:00.000Z",
            clientSettings: {
              fallingEffectsEnabled: true,
              fallingEffectDensity: 999,
              timestampFormat: "24-hour",
              autoNudgeMode: "prompt",
              autoNudgeMaxRounds: 999,
              autoNudgeMaxMinutes: 30,
              modelPacingReservePercent: 99,
              providerModelPreferences: {
                "private-account": { hiddenModels: [], modelOrder: [] },
              },
              ambientVideoEnabled: true,
              ambientVideoSource: { kind: "video", id: "private-video" },
              ambientImageEnabled: true,
              ambientImageAsset: {
                id: "private-image",
                mimeType: "image/png",
                width: 100,
                height: 100,
              },
              providerUsageWidgetEnabled: true,
              providerUsagePollMinutes: 1,
              powerSaveBlockerMode: "always",
              serverPassword: "do-not-retain",
              weatherCities: ["Tokyo"],
              cameraEnabled: true,
              futureCompatiblePreference: "ignored-for-now",
            },
          },
        ],
      }),
    });

    const profile = createSettingsProfileLibraryStore(storage).getSnapshot().profiles[0];

    expect(profile?.clientSettings).toEqual({
      fallingEffectsEnabled: true,
      timestampFormat: "24-hour",
    });
    expect(profile?.clientSettings).not.toHaveProperty("autoNudgeMode");
    expect(profile?.clientSettings).not.toHaveProperty("autoNudgeMaxMinutes");
    expect(profile?.clientSettings).not.toHaveProperty("modelPacingReservePercent");
    expect(profile?.clientSettings).not.toHaveProperty("providerModelPreferences");
    expect(profile?.clientSettings).not.toHaveProperty("ambientVideoEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("ambientVideoSource");
    expect(profile?.clientSettings).not.toHaveProperty("ambientImageEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("ambientImageAsset");
    expect(profile?.clientSettings).not.toHaveProperty("providerUsageWidgetEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("providerUsagePollMinutes");
    expect(profile?.clientSettings).not.toHaveProperty("powerSaveBlockerMode");
    expect(profile?.clientSettings).not.toHaveProperty("serverPassword");
    expect(profile?.clientSettings).not.toHaveProperty("weatherCities");
    expect(profile?.clientSettings).not.toHaveProperty("cameraEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("futureCompatiblePreference");
  });

  it("ignores inherited settings and accessors without executing caller-owned code", () => {
    const inherited = Object.create({
      fallingEffectsEnabled: true,
      serverPassword: "inherited-secret",
    }) as Record<string, unknown>;
    const getter = vi.fn(() => "24-hour");
    Object.defineProperty(inherited, "timestampFormat", {
      configurable: true,
      enumerable: true,
      get: getter,
    });
    Object.defineProperty(inherited, "sidebarThreadPreviewCount", {
      configurable: true,
      enumerable: true,
      value: 4,
    });

    const sanitized = captureSettingsProfilePayload(
      inherited as unknown as UnifiedSettings,
      "dark",
    );

    expect(sanitized.clientSettings).toEqual({ sidebarThreadPreviewCount: 4 });
    expect(getter).not.toHaveBeenCalled();
    expect(sanitized.clientSettings).not.toHaveProperty("fallingEffectsEnabled");
    expect(sanitized.clientSettings).not.toHaveProperty("serverPassword");
  });

  it("drops prototype-pollution keys from imported profile settings", () => {
    const storage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]:
        '{"version":1,"activeProfileId":"profile:mobile","profiles":[{"name":"Mobile","theme":"dark","clientSettings":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"autoNudgeMaxMinutes":30,"timestampFormat":"24-hour"},"createdAt":"2026-07-29T08:00:00.000Z","updatedAt":"2026-07-29T08:00:00.000Z"}]}',
    });

    const profile = createSettingsProfileLibraryStore(storage).resolve("profile:mobile");

    expect(profile?.clientSettings).toEqual({ timestampFormat: "24-hour" });
    expect(profile?.clientSettings).not.toHaveProperty("__proto__");
    expect(profile?.clientSettings).not.toHaveProperty("constructor");
    expect(profile?.clientSettings).not.toHaveProperty("prototype");
    expect(profile?.clientSettings).not.toHaveProperty("autoNudgeMaxMinutes");
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("keeps retained values scalar and bounded before schema decoding", () => {
    const nestedGetter = vi.fn(() => "surprise");
    const nestedValue = {};
    Object.defineProperty(nestedValue, "toString", {
      get: nestedGetter,
    });
    const payload = captureSettingsProfilePayload(
      {
        ...DEFAULT_UNIFIED_SETTINGS,
        themeAccentColor: "x".repeat(4_097),
        appAccentColor: nestedValue,
      } as unknown as UnifiedSettings,
      "dark",
    );

    expect(payload.clientSettings).not.toHaveProperty("themeAccentColor");
    expect(payload.clientSettings).not.toHaveProperty("appAccentColor");
    expect(nestedGetter).not.toHaveBeenCalled();
  });

  it("rejects accessor-backed payloads without executing them", () => {
    const store = createSettingsProfileLibraryStore(createStorage());
    const themeGetter = vi.fn(() => "dark");
    const settingsGetter = vi.fn(() => ({ fallingEffectsEnabled: true }));
    const payload = {};
    Object.defineProperty(payload, "theme", {
      enumerable: true,
      get: themeGetter,
    });
    Object.defineProperty(payload, "clientSettings", {
      enumerable: true,
      get: settingsGetter,
    });

    expect(() => store.upsert("Hostile", payload as never)).toThrow(SettingsProfileError);
    expect(themeGetter).not.toHaveBeenCalled();
    expect(settingsGetter).not.toHaveBeenCalled();
    expect(store.getSnapshot().profiles).toEqual([]);
  });

  it("does not expose mutable references to its persisted profile document", () => {
    const storage = createStorage();
    const store = createSettingsProfileLibraryStore(storage);
    const saved = store.upsert(
      "Mobile",
      captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "dark"),
    );
    const snapshot = store.getSnapshot();
    const resolved = store.resolve(saved.profile.id);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.profiles)).toBe(true);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved?.clientSettings)).toBe(true);
    expect(Reflect.set(resolved?.clientSettings ?? {}, "serverPassword", "never-store-me")).toBe(
      false,
    );
    expect(Reflect.set(resolved ?? {}, "name", "Mutated")).toBe(false);

    store.rename(saved.profile.id, "Phone");
    const document = JSON.parse(storage.read(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY) ?? "{}");
    expect(document.profiles[0].name).toBe("Phone");
    expect(document.profiles[0].clientSettings).not.toHaveProperty("serverPassword");
  });

  it("loads older sparse profiles as patches without resetting newly supported preferences", () => {
    const storage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: SETTINGS_PROFILE_LIBRARY_VERSION,
        activeProfileId: "profile:mobile",
        profiles: [
          {
            name: "Mobile",
            theme: "dark",
            clientSettings: { sidebarThreadPreviewCount: 2 },
            createdAt: "2026-07-29T08:00:00.000Z",
            updatedAt: "2026-07-29T08:00:00.000Z",
          },
        ],
      }),
    });

    const profile = createSettingsProfileLibraryStore(storage).resolve("profile:mobile");

    expect(profile?.clientSettings).toEqual({ sidebarThreadPreviewCount: 2 });
    expect(profile?.clientSettings).not.toHaveProperty("fallingEffectsEnabled");
  });

  it("keeps an in-memory profile but reports when durable storage is unavailable", () => {
    const storage = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("blocked", "QuotaExceededError");
      },
      removeItem: () => undefined,
    };
    const store = createSettingsProfileLibraryStore(storage);

    const result = store.upsert(
      "Mobile",
      captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "dark"),
    );

    expect(result.persisted).toBe(false);
    expect(store.resolve(result.profile.id)?.name).toBe("Mobile");
  });

  it("leaves the prior durable document intact when a quota failure creates session-only state", () => {
    const durableDocument = JSON.stringify({
      version: SETTINGS_PROFILE_LIBRARY_VERSION,
      activeProfileId: "profile:mobile",
      profiles: [
        {
          name: "Mobile",
          theme: "dark",
          clientSettings: { sidebarThreadPreviewCount: 2 },
          createdAt: "2026-07-29T08:00:00.000Z",
          updatedAt: "2026-07-29T08:00:00.000Z",
        },
      ],
    });
    const baseStorage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: durableDocument,
    });
    const storage = {
      ...baseStorage,
      setItem: vi.fn(() => {
        throw new DOMException("blocked", "QuotaExceededError");
      }),
    };
    const store = createSettingsProfileLibraryStore(storage);

    const result = store.upsert(
      "Desktop",
      captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "light"),
    );

    expect(result.persisted).toBe(false);
    expect(store.getSnapshot().profiles.map((profile) => profile.name)).toEqual([
      "Mobile",
      "Desktop",
    ]);
    expect(baseStorage.read(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY)).toBe(durableDocument);
    expect(createSettingsProfileLibraryStore(baseStorage).getSnapshot().profiles).toHaveLength(1);
  });

  it("retries a session-only active marker and refreshes external storage changes", () => {
    let blocked = true;
    const baseStorage = createStorage();
    const storage = {
      ...baseStorage,
      setItem: vi.fn((key: string, value: string) => {
        if (blocked) throw new DOMException("blocked", "QuotaExceededError");
        baseStorage.setItem(key, value);
      }),
    };
    const store = createSettingsProfileLibraryStore(storage);
    const saved = store.upsert(
      "Mobile",
      captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "dark"),
    );

    expect(saved.persisted).toBe(false);
    expect(store.getSnapshot().activeProfileId).toBe(saved.profile.id);
    store.refreshFromStorage();
    expect(store.resolve(saved.profile.id)?.name).toBe("Mobile");
    blocked = false;
    expect(store.activate(saved.profile.id)).toBe(true);
    expect(
      JSON.parse(baseStorage.read(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY) ?? "{}").activeProfileId,
    ).toBe(saved.profile.id);

    baseStorage.setItem(
      SETTINGS_PROFILE_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        version: SETTINGS_PROFILE_LIBRARY_VERSION,
        activeProfileId: "profile:desktop",
        profiles: [
          {
            name: "Desktop",
            theme: "light",
            clientSettings: { continueBackgroundAnimations: true },
            createdAt: "2026-07-29T09:00:00.000Z",
            updatedAt: "2026-07-29T09:00:00.000Z",
          },
        ],
      }),
    );
    store.refreshFromStorage();

    expect(store.getSnapshot().activeProfileId).toBe("profile:desktop");
    expect(store.resolve("profile:desktop")?.theme).toBe("light");
    expect(store.resolve(saved.profile.id)).toBeNull();
  });

  it("refreshes before an unlocked mutation so a delayed storage event cannot erase a profile", async () => {
    const storage = createStorage();
    const firstWindow = createSettingsProfileLibraryStore(storage);
    const secondWindow = createSettingsProfileLibraryStore(storage);
    const payload = captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "dark");

    firstWindow.upsert("Mobile", payload);
    await mutateSettingsProfileLibrary(
      secondWindow,
      () => secondWindow.upsert("Desktop", payload),
      null,
    );

    expect(
      createSettingsProfileLibraryStore(storage)
        .getSnapshot()
        .profiles.map((profile) => profile.name),
    ).toEqual(["Mobile", "Desktop"]);
  });

  it("serializes same-origin window mutations under one profile-library lock", async () => {
    const storage = createStorage();
    const firstWindow = createSettingsProfileLibraryStore(storage);
    const secondWindow = createSettingsProfileLibraryStore(storage);
    const payload = captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "dark");
    const lock = createSerialMutationLock();

    await Promise.all([
      mutateSettingsProfileLibrary(firstWindow, () => firstWindow.upsert("Mobile", payload), lock),
      mutateSettingsProfileLibrary(
        secondWindow,
        () => secondWindow.upsert("Desktop", payload),
        lock,
      ),
    ]);

    expect(lock.requests).toEqual([
      SETTINGS_PROFILE_LIBRARY_MUTATION_LOCK_NAME,
      SETTINGS_PROFILE_LIBRARY_MUTATION_LOCK_NAME,
    ]);
    expect(
      createSettingsProfileLibraryStore(storage)
        .getSnapshot()
        .profiles.map((profile) => profile.name),
    ).toEqual(["Mobile", "Desktop"]);
  });

  it("rejects invalid runtime theme payloads instead of persisting unusable profiles", () => {
    const store = createSettingsProfileLibraryStore(createStorage());

    expect(() => captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "sepia" as never)).toThrow(
      SettingsProfileError,
    );
    expect(() =>
      store.upsert("Invalid", {
        theme: "sepia",
        clientSettings: {},
      } as never),
    ).toThrow(SettingsProfileError);
    expect(store.getSnapshot().profiles).toEqual([]);
  });
});
