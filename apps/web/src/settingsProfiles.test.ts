import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@cafecode/contracts/settings";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captureSettingsProfilePayload,
  createSettingsProfileLibraryStore,
  SETTINGS_PROFILE_CLIENT_FIELD_POLICY,
  SETTINGS_PROFILE_CLIENT_KEYS,
  SETTINGS_PROFILE_LIBRARY_STORAGE_KEY,
  SETTINGS_PROFILE_LIBRARY_VERSION,
  SETTINGS_PROFILE_MAX_COUNT,
  SETTINGS_PROFILE_MAX_STORAGE_BYTES,
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

afterEach(() => {
  vi.useRealTimers();
});

describe("settings profile library", () => {
  it("captures only the explicit local preference allowlist", () => {
    const settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectsEnabled: true,
      atmosphereConsoleEnabled: true,
      fallingEffectsOverCinemaEnabled: true,
      ambianceEnabled: true,
      ambianceReactMode: "live",
      fallingEffectLiveWorkVocabulary: true,
      fallingEffectActivityLinks: true,
      fallingEffectActivityLinkNetworkEnabled: true,
      fallingEffectActivityLinkDatabaseEnabled: true,
      fallingEffectActivityLinkBuildEnabled: true,
      fallingEffectActivityLinkAgentEnabled: true,
      ambientVideoLayoutMode: "custom",
      ambientImageGlowOpacity: 0.42,
      mobileOptimizedPresentation: true,
      timestampFormat: "24-hour",
      notificationsEnabled: true,
      completionAlertSoundEnabled: true,
      completionAlertSpeechEnabled: true,
      confirmThreadArchive: false,
      confirmThreadDelete: false,
      worldClockWeatherEnabled: true,
      ambientVideoEnabled: true,
      ambientVideoSource: { kind: "video", id: "private-video" },
      ambientImageEnabled: true,
      ambientImageAsset: { url: "file:///private/image.gif" },
      ambientImageCycleAssets: [{ url: "file:///private/second.gif" }],
      ambientImageCycleEnabled: true,
      providerUsageWidgetEnabled: true,
      providerUsagePollMinutes: 1,
      defaultEditor: "vscode",
      powerSaveBlockerMode: "always",
      sidebarBrandImage: { url: "file:///private/brand.png" },
      sidebarBrandImageDataUrl: "data:image/png;base64,private",
      dismissedProviderUpdateNotificationKeys: ["private-account:model"],
      autoNudgeMode: "prompt",
      autoNudgeBackgroundContinuation: true,
      autoNudgeMaxRounds: 99,
      idleThreadGuardEnabled: true,
      idleThreadGuardHours: 1,
      cameraCaptureGranted: true,
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
    } as unknown as UnifiedSettings;

    const payload = captureSettingsProfilePayload(settings, "dark");

    expect(payload.theme).toBe("dark");
    expect(payload.clientSettings.ambientVideoLayoutMode).toBe("custom");
    expect(payload.clientSettings.ambientImageGlowOpacity).toBe(0.42);
    expect(payload.clientSettings.mobileOptimizedPresentation).toBe(true);
    expect(payload.clientSettings.timestampFormat).toBe("24-hour");
    expect(Object.keys(payload.clientSettings)).toEqual([...SETTINGS_PROFILE_CLIENT_KEYS]);
    expect(payload.clientSettings).not.toHaveProperty("fallingEffectsEnabled");
    expect(payload.clientSettings).not.toHaveProperty("atmosphereConsoleEnabled");
    expect(payload.clientSettings).not.toHaveProperty("fallingEffectsOverCinemaEnabled");
    expect(payload.clientSettings).not.toHaveProperty("ambianceEnabled");
    expect(payload.clientSettings).not.toHaveProperty("ambianceReactMode");
    expect(payload.clientSettings).not.toHaveProperty("fallingEffectLiveWorkVocabulary");
    expect(payload.clientSettings).not.toHaveProperty("fallingEffectActivityLinks");
    expect(payload.clientSettings).not.toHaveProperty("fallingEffectActivityLinkNetworkEnabled");
    expect(payload.clientSettings).not.toHaveProperty("fallingEffectActivityLinkDatabaseEnabled");
    expect(payload.clientSettings).not.toHaveProperty("fallingEffectActivityLinkBuildEnabled");
    expect(payload.clientSettings).not.toHaveProperty("fallingEffectActivityLinkAgentEnabled");
    expect(payload.clientSettings).not.toHaveProperty("notificationsEnabled");
    expect(payload.clientSettings).not.toHaveProperty("completionAlertSoundEnabled");
    expect(payload.clientSettings).not.toHaveProperty("completionAlertSpeechEnabled");
    expect(payload.clientSettings).not.toHaveProperty("confirmThreadArchive");
    expect(payload.clientSettings).not.toHaveProperty("confirmThreadDelete");
    expect(payload.clientSettings).not.toHaveProperty("worldClockWeatherEnabled");
    expect(payload.clientSettings).not.toHaveProperty("ambientVideoEnabled");
    expect(payload.clientSettings).not.toHaveProperty("ambientVideoSource");
    expect(payload.clientSettings).not.toHaveProperty("ambientImageEnabled");
    expect(payload.clientSettings).not.toHaveProperty("ambientImageAsset");
    expect(payload.clientSettings).not.toHaveProperty("ambientImageCycleAssets");
    expect(payload.clientSettings).not.toHaveProperty("ambientImageCycleEnabled");
    expect(payload.clientSettings).not.toHaveProperty("providerUsageWidgetEnabled");
    expect(payload.clientSettings).not.toHaveProperty("providerUsagePollMinutes");
    expect(payload.clientSettings).not.toHaveProperty("defaultEditor");
    expect(payload.clientSettings).not.toHaveProperty("powerSaveBlockerMode");
    expect(payload.clientSettings).not.toHaveProperty("sidebarBrandImage");
    expect(payload.clientSettings).not.toHaveProperty("sidebarBrandImageDataUrl");
    expect(payload.clientSettings).not.toHaveProperty("dismissedProviderUpdateNotificationKeys");
    expect(payload.clientSettings).not.toHaveProperty("autoNudgeMode");
    expect(payload.clientSettings).not.toHaveProperty("autoNudgeBackgroundContinuation");
    expect(payload.clientSettings).not.toHaveProperty("autoNudgeMaxRounds");
    expect(payload.clientSettings).not.toHaveProperty("idleThreadGuardEnabled");
    expect(payload.clientSettings).not.toHaveProperty("idleThreadGuardHours");
    expect(payload.clientSettings).not.toHaveProperty("cameraCaptureGranted");
    expect(payload.clientSettings).not.toHaveProperty("modelPacingEnabled");
    expect(payload.clientSettings).not.toHaveProperty("providerModelPreferences");
    expect(payload.clientSettings).not.toHaveProperty("sidebarProjectGroupingOverrides");
    expect(payload.clientSettings).not.toHaveProperty("providerInstances");
    expect(payload.clientSettings).not.toHaveProperty("defaultProviderInstanceId");
    expect(payload.clientSettings).not.toHaveProperty("observability");
    expect(payload.clientSettings).not.toHaveProperty("addProjectBaseDirectory");
  });

  it("derives the capture allowlist only from fields classified as presentation-safe", () => {
    const expectedKeys = Object.entries(SETTINGS_PROFILE_CLIENT_FIELD_POLICY)
      .filter(([, policy]) => policy === "include")
      .map(([key]) => key);

    expect(SETTINGS_PROFILE_CLIENT_KEYS).toEqual(expectedKeys);
    expect(SETTINGS_PROFILE_CLIENT_FIELD_POLICY).toMatchObject({
      notificationsEnabled: "consent",
      completionAlertSoundEnabled: "event-output-activation",
      completionAlertSpeechEnabled: "event-output-activation",
      confirmThreadArchive: "destructive-action-safety",
      confirmThreadDelete: "destructive-action-safety",
      projectTelemetryHideUnavailableGraphs: "include",
      worldClockWeatherEnabled: "consent",
      fallingEffectsEnabled: "ambient-activation",
      atmosphereConsoleEnabled: "ambient-activation",
      fallingEffectsOverCinemaEnabled: "ambient-activation",
      fallingEffectLiveWorkVocabulary: "live-operational-input",
      fallingEffectActivityLinks: "live-operational-input",
      fallingEffectActivityLinkNetworkEnabled: "live-operational-input",
      fallingEffectActivityLinkDatabaseEnabled: "live-operational-input",
      fallingEffectActivityLinkBuildEnabled: "live-operational-input",
      fallingEffectActivityLinkAgentEnabled: "live-operational-input",
      ambianceEnabled: "ambient-activation",
      ambianceReactMode: "live-operational-input",
      ambientVideoEnabled: "external-media-activation",
      ambientVideoSource: "external-media-activation",
      ambientImageEnabled: "external-media-activation",
      ambientImageAsset: "local-asset-reference",
      ambientImageCycleAssets: "local-asset-reference",
      ambientImageCycleEnabled: "external-media-activation",
      sidebarBrandImage: "local-asset-reference",
      sidebarBrandImageDataUrl: "local-asset-reference",
      providerUsageWidgetEnabled: "provider-operation",
      providerUsagePollMinutes: "provider-operation",
      autoNudgeMode: "exact-thread-authority",
      autoNudgeBackgroundContinuation: "exact-thread-authority",
      autoNudgeMaxRounds: "exact-thread-authority",
      favorites: "provider-model-state",
      providerModelPreferences: "provider-model-state",
      defaultEditor: "native-machine-control",
      powerSaveBlockerMode: "native-machine-control",
      sidebarProjectGroupingOverrides: "project-specific",
    });

    const excludedDefaults = Object.fromEntries(
      Object.entries(SETTINGS_PROFILE_CLIENT_FIELD_POLICY)
        .filter(([, policy]) => policy !== "include")
        .map(([key]) => [
          key,
          DEFAULT_UNIFIED_SETTINGS[key as keyof typeof DEFAULT_UNIFIED_SETTINGS],
        ]),
    );
    expect(captureSettingsProfilePayload(excludedDefaults as never, "dark").clientSettings).toEqual(
      {},
    );
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
        mobileOptimizedPresentation: true,
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
    expect(document.profiles[0].clientSettings.mobileOptimizedPresentation).toBe(true);

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
    expect(Object.isFrozen(updated.profile)).toBe(true);
    expect(store.resolve(updated.profile.id)).toBe(updated.profile);

    const renamed = store.rename(updated.profile.id, "Large Screen");
    expect(renamed.profile.id).toBe("profile:large%20screen");
    expect(Object.isFrozen(renamed.profile)).toBe(true);
    expect(store.resolve(renamed.profile.id)).toBe(renamed.profile);
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
    expect(futureStorage.read(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY)).toContain(
      `"version":${SETTINGS_PROFILE_LIBRARY_VERSION + 1}`,
    );
  });

  it("rewrites a malformed supported-version document without overwriting a future version", () => {
    const supportedStorage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: SETTINGS_PROFILE_LIBRARY_VERSION,
        profiles: { serverPassword: "do-not-retain" },
      }),
    });
    const futureDocument = JSON.stringify({
      version: SETTINGS_PROFILE_LIBRARY_VERSION + 1,
      profiles: { futureShape: true },
    });
    const futureStorage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: futureDocument,
    });

    expect(createSettingsProfileLibraryStore(supportedStorage).getSnapshot().profiles).toEqual([]);
    expect(JSON.parse(supportedStorage.read(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY) ?? "{}")).toEqual(
      {
        version: SETTINGS_PROFILE_LIBRARY_VERSION,
        activeProfileId: null,
        profiles: [],
      },
    );
    expect(createSettingsProfileLibraryStore(futureStorage).getSnapshot().profiles).toEqual([]);
    expect(futureStorage.read(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY)).toBe(futureDocument);
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
              atmosphereConsoleEnabled: true,
              fallingEffectsOverCinemaEnabled: true,
              ambianceEnabled: true,
              completionAlertSoundEnabled: true,
              completionAlertSpeechEnabled: true,
              fallingEffectOpacity: 0.42,
              fallingEffectDensity: 999,
              timestampFormat: "24-hour",
              notificationsEnabled: true,
              worldClockWeatherEnabled: true,
              ambientVideoEnabled: true,
              ambientVideoSource: { kind: "video", id: "private-video" },
              ambientImageEnabled: true,
              ambientImageAsset: { url: "file:///private/image.gif" },
              ambientImageCycleAssets: [{ url: "file:///private/second.gif" }],
              ambientImageCycleEnabled: true,
              providerUsageWidgetEnabled: true,
              providerUsagePollMinutes: 1,
              defaultEditor: "vscode",
              powerSaveBlockerMode: "always",
              autoNudgeMode: "prompt",
              autoNudgeBackgroundContinuation: true,
              autoNudgeMaxRounds: 999,
              idleThreadGuardEnabled: true,
              cameraCaptureGranted: true,
              modelPacingReservePercent: 99,
              providerModelPreferences: {
                "private-account": { hiddenModels: [], modelOrder: [] },
              },
              serverPassword: "do-not-retain",
              futureCompatiblePreference: "ignored-for-now",
            },
          },
        ],
      }),
    });

    const profile = createSettingsProfileLibraryStore(storage).getSnapshot().profiles[0];

    expect(profile?.clientSettings).toEqual({
      fallingEffectOpacity: 0.42,
      timestampFormat: "24-hour",
    });
    expect(profile?.clientSettings).not.toHaveProperty("fallingEffectsEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("atmosphereConsoleEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("fallingEffectsOverCinemaEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("ambianceEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("completionAlertSoundEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("completionAlertSpeechEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("notificationsEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("worldClockWeatherEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("ambientVideoEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("ambientVideoSource");
    expect(profile?.clientSettings).not.toHaveProperty("ambientImageEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("ambientImageAsset");
    expect(profile?.clientSettings).not.toHaveProperty("ambientImageCycleAssets");
    expect(profile?.clientSettings).not.toHaveProperty("ambientImageCycleEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("providerUsageWidgetEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("providerUsagePollMinutes");
    expect(profile?.clientSettings).not.toHaveProperty("defaultEditor");
    expect(profile?.clientSettings).not.toHaveProperty("powerSaveBlockerMode");
    expect(profile?.clientSettings).not.toHaveProperty("autoNudgeMode");
    expect(profile?.clientSettings).not.toHaveProperty("autoNudgeBackgroundContinuation");
    expect(profile?.clientSettings).not.toHaveProperty("idleThreadGuardEnabled");
    expect(profile?.clientSettings).not.toHaveProperty("cameraCaptureGranted");
    expect(profile?.clientSettings).not.toHaveProperty("modelPacingReservePercent");
    expect(profile?.clientSettings).not.toHaveProperty("providerModelPreferences");
    expect(profile?.clientSettings).not.toHaveProperty("serverPassword");
    expect(profile?.clientSettings).not.toHaveProperty("futureCompatiblePreference");
  });

  it("migrates legacy documents and scrubs unsafe fields from durable storage", () => {
    const storage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: 1,
        activeProfileId: "profile:mobile",
        profiles: [
          {
            name: "Mobile",
            theme: "dark",
            clientSettings: {
              timestampFormat: "24-hour",
              completionAlertSpeechEnabled: true,
              fallingEffectsEnabled: true,
              fallingEffectLiveWorkVocabulary: true,
              fallingEffectActivityLinks: true,
              fallingEffectActivityLinkNetworkEnabled: true,
              ambianceReactMode: "live",
              confirmThreadDelete: false,
              ambientVideoSource: { kind: "video", id: "private-video" },
              autoNudgeMode: "hardcore-fanout",
              idleThreadGuardEnabled: true,
              providerModelPreferences: {
                "private-account": { hiddenModels: ["secret-model"], modelOrder: [] },
              },
            },
            createdAt: "2026-07-29T08:00:00.000Z",
            updatedAt: "2026-07-29T08:00:00.000Z",
          },
        ],
      }),
    });

    const restored = createSettingsProfileLibraryStore(storage);
    const persisted = JSON.parse(storage.read(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY) ?? "{}");

    expect(restored.resolve("profile:mobile")?.clientSettings).toEqual({
      timestampFormat: "24-hour",
    });
    expect(persisted.version).toBe(SETTINGS_PROFILE_LIBRARY_VERSION);
    expect(persisted.profiles[0].clientSettings).toEqual({ timestampFormat: "24-hour" });
  });

  it("migrates the immediately previous document version through the current scrub boundary", () => {
    const storage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: SETTINGS_PROFILE_LIBRARY_VERSION - 1,
        activeProfileId: "profile:desktop",
        profiles: [
          {
            name: "Desktop",
            theme: "system",
            clientSettings: {
              chatCopyFormat: "markdown",
              confirmThreadDelete: false,
              fallingEffectLiveWorkVocabulary: true,
              fallingEffectActivityLinks: true,
              ambianceReactMode: "live",
            },
            createdAt: "2026-07-29T08:00:00.000Z",
            updatedAt: "2026-07-29T08:00:00.000Z",
          },
        ],
      }),
    });

    const restored = createSettingsProfileLibraryStore(storage);
    const persisted = JSON.parse(storage.read(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY) ?? "{}");

    expect(restored.resolve("profile:desktop")?.clientSettings).toEqual({
      chatCopyFormat: "markdown",
    });
    expect(persisted).toMatchObject({
      version: SETTINGS_PROFILE_LIBRARY_VERSION,
      profiles: [{ clientSettings: { chatCopyFormat: "markdown" } }],
    });
  });

  it("re-scrubs unsafe fields injected into a current-version storage document", () => {
    const storage = createStorage({
      [SETTINGS_PROFILE_LIBRARY_STORAGE_KEY]: JSON.stringify({
        version: SETTINGS_PROFILE_LIBRARY_VERSION,
        activeProfileId: "profile:desktop",
        profiles: [
          {
            name: "Desktop",
            theme: "system",
            clientSettings: {
              chatCopyFormat: "plainText",
              ambientImageEnabled: true,
              serverPassword: "do-not-retain",
            },
            createdAt: "2026-07-29T08:00:00.000Z",
            updatedAt: "2026-07-29T08:00:00.000Z",
          },
        ],
      }),
    });

    const restored = createSettingsProfileLibraryStore(storage);
    const persisted = JSON.parse(storage.read(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY) ?? "{}");

    expect(restored.resolve("profile:desktop")?.clientSettings).toEqual({
      chatCopyFormat: "plainText",
    });
    expect(persisted.profiles[0].clientSettings).toEqual({ chatCopyFormat: "plainText" });
  });

  it("exposes immutable profile boundaries so callers cannot inject authority fields", () => {
    const storage = createStorage();
    const store = createSettingsProfileLibraryStore(storage);
    const saved = store.upsert(
      "Desktop",
      captureSettingsProfilePayload(DEFAULT_UNIFIED_SETTINGS, "dark"),
    );
    const resolved = store.resolve(saved.profile.id);
    if (resolved === null) throw new Error("Expected the saved profile to resolve.");

    expect(Object.isFrozen(store.getSnapshot())).toBe(true);
    expect(Object.isFrozen(store.getSnapshot().profiles)).toBe(true);
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.clientSettings)).toBe(true);
    expect(Object.isFrozen(saved.profile)).toBe(true);
    expect(saved.profile).toBe(resolved);
    expect(Object.isFrozen(resolved.clientSettings.worldClockLocationIds)).toBe(true);
    expect(() => {
      (resolved.clientSettings as Record<string, unknown>).autoNudgeMode = "hardcore-fanout";
    }).toThrow();
    expect(() => {
      (resolved.clientSettings.worldClockLocationIds as string[]).push("seoul");
    }).toThrow();
    expect(store.resolve(saved.profile.id)?.clientSettings).not.toHaveProperty("autoNudgeMode");
  });

  it("copies nested safe values so capture input cannot mutate a saved profile", () => {
    const locations: Array<UnifiedSettings["worldClockLocationIds"][number]> = ["tokyo", "london"];
    const payload = captureSettingsProfilePayload(
      {
        ...DEFAULT_UNIFIED_SETTINGS,
        worldClockLocationIds: locations,
      },
      "dark",
    );
    locations[0] = "seoul";

    expect(payload.clientSettings.worldClockLocationIds).toEqual(["tokyo", "london"]);
    expect(Object.isFrozen(payload.clientSettings.worldClockLocationIds)).toBe(true);
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
