import { describe, it, expect } from "vitest";
import { DEFAULT_UNIFIED_SETTINGS } from "@cafecode/contracts";
import {
  captureSettingsProfilePayload,
  createSettingsProfileLibraryStore,
  SETTINGS_PROFILE_LIBRARY_STORAGE_KEY,
} from "./settingsProfiles";
import {
  captureProfileExtras,
  sanitizeProfileExtras,
  decodeProfileServerPatch,
} from "./settingsProfileExtras";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
describe("complete, recoverable profiles", () => {
  it("restores feature switches, model choices, and hardware preferences after a fresh store opens", () => {
    const storage = memoryStorage();
    const values = {
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectsEnabled: true,
      hexagonsBackgroundEnabled: true,
      ambientVideoEnabled: true,
      providerUsageWidgetEnabled: false,
      hardwareLightingSyncEnabled: true,
      hardwareLightingBrightness: 0.63,
      completionAlertSoundEnabled: true,
      providerModelPreferences: { codex: { hiddenModels: ["model-a"], modelOrder: ["model-b"] } },
    };
    const saved = createSettingsProfileLibraryStore(storage).upsert(
      "Desktop Profile",
      captureSettingsProfilePayload(values, "dark"),
    );
    expect(saved.persisted).toBe(true);
    const restored = createSettingsProfileLibraryStore(storage).resolve(saved.profile.id)!;
    expect(restored.clientSettings).toMatchObject({
      fallingEffectsEnabled: true,
      hexagonsBackgroundEnabled: true,
      ambientVideoEnabled: true,
      providerUsageWidgetEnabled: false,
      hardwareLightingSyncEnabled: true,
      hardwareLightingBrightness: 0.63,
      completionAlertSoundEnabled: true,
      providerModelPreferences: values.providerModelPreferences,
    });
    expect(restored.clientSettings).not.toHaveProperty("autoNudgeMode");
    expect(restored.clientSettings).not.toHaveProperty("agentBrowserDisabledThreadIds");
  });
  it("rebases a stale window write without losing another window's saved profile", () => {
    const storage = memoryStorage();
    const a = createSettingsProfileLibraryStore(storage);
    const b = createSettingsProfileLibraryStore(storage);
    a.upsert("Desktop", { theme: "dark", clientSettings: { fallingEffectSpeed: 4 } });
    b.upsert("Mobile", { theme: "light", clientSettings: {} });
    expect(
      createSettingsProfileLibraryStore(storage)
        .getSnapshot()
        .profiles.map((p) => p.name),
    ).toEqual(["Desktop", "Mobile"]);
    a.updateActive({ theme: "dark", clientSettings: { fallingEffectSpeed: 2 } });
    expect(a.resolve("profile:desktop")?.clientSettings.fallingEffectSpeed).toBe(2);
    expect(a.resolve("profile:mobile")?.theme).toBe("light");
    expect(storage.getItem(`${SETTINGS_PROFILE_LIBRARY_STORAGE_KEY}:previous`)).toContain(
      '"fallingEffectSpeed":4',
    );
  });
  it("captures panel geometry and general server preferences without capturing connection credentials", () => {
    const storage = memoryStorage();
    storage.setItem("chat_thread_sidebar_width", "425");
    storage.setItem(
      "cafe-code:ambient-media-geometry",
      JSON.stringify({ version: 1, slots: { video: { x: 0.2, y: 0.3, width: 0.4 } } }),
    );
    const captured = captureProfileExtras(DEFAULT_UNIFIED_SETTINGS, storage);
    expect(captured.localPreferences?.chat_thread_sidebar_width).toBe("425");
    expect(captured.localPreferences?.["cafe-code:ambient-media-geometry"]).toContain(
      '"width":0.4',
    );
    expect(decodeProfileServerPatch(captured).automaticGitFetchInterval).toEqual(
      DEFAULT_UNIFIED_SETTINGS.automaticGitFetchInterval,
    );
    const sanitized = sanitizeProfileExtras({
      localPreferences: {
        "cafe-code:saved-environment-session-secrets:v1": "private",
        chat_thread_sidebar_width: "not-json",
      },
      serverPreferences: { providers: { token: "private" }, enableAssistantStreaming: false },
    });
    expect(sanitized.localPreferences).toEqual({});
    expect(sanitized.serverPreferences).toEqual({ enableAssistantStreaming: false });
  });
});
