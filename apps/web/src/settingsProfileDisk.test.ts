import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
const key = "cafe-code:settings-profile-library:v1";
const document = JSON.stringify({
  version: 5,
  activeProfileId: "profile:desktop",
  profiles: [
    {
      name: "Desktop",
      theme: "dark",
      clientSettings: { fallingEffectsEnabled: true },
      createdAt: "2026-10-15T00:00:00Z",
      updatedAt: "2026-10-15T00:00:00Z",
    },
  ],
});
function setup(initial: string | null, disk: string | null) {
  const data = new Map<string, string>(initial ? [[key, initial]] : []);
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, value: string) => {
      data.set(k, value);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
  const writer = vi.fn(async (_value: string) => {});
  vi.stubGlobal("window", {
    localStorage: storage,
    desktopBridge: {
      getSettingsProfileLibrary: vi.fn(async () => disk),
      setSettingsProfileLibrary: writer,
    },
  });
  return { storage, writer };
}
describe("desktop profile persistence", () => {
  it("keeps a newer renderer save when a prior disk write was interrupted", async () => {
    const newer = JSON.parse(document);
    newer.savedAt = "2026-10-16T00:00:00Z";
    newer.profiles[0].clientSettings.fallingEffectsEnabled = false;
    const raw = JSON.stringify(newer);
    const { writer } = setup(raw, document);
    const module = await import("./settingsProfiles");
    await module.hydrateSettingsProfileLibrary();
    expect(
      module.settingsProfileLibraryStore.resolve("profile:desktop")?.clientSettings
        .fallingEffectsEnabled,
    ).toBe(false);
    expect(writer).toHaveBeenCalledWith(raw);
  });
  it("uses the disk copy when the browser cache is full", async () => {
    const { storage } = setup(null, document);
    storage.setItem = () => {
      throw new Error("quota");
    };
    const module = await import("./settingsProfiles");
    await module.hydrateSettingsProfileLibrary();
    expect(
      module.settingsProfileLibraryStore.resolve("profile:desktop")?.clientSettings
        .fallingEffectsEnabled,
    ).toBe(true);
    const saved = module.settingsProfileLibraryStore.updateActive({
      theme: "light",
      clientSettings: {},
    });
    expect(saved.persisted).toBe(false);
    expect(await module.flushSettingsProfileLibrary(saved.persisted)).toBe(true);
  });
  it("recovers profiles from disk when the renderer storage is empty", async () => {
    const { storage } = setup(null, document);
    const module = await import("./settingsProfiles");
    await module.hydrateSettingsProfileLibrary();
    expect(
      module.settingsProfileLibraryStore.resolve("profile:desktop")?.clientSettings
        .fallingEffectsEnabled,
    ).toBe(true);
    expect(storage.getItem(key)).toBe(document);
  });
  it("migrates an existing renderer library to disk before reporting ready", async () => {
    const { writer } = setup(document, null);
    const module = await import("./settingsProfiles");
    await module.hydrateSettingsProfileLibrary();
    expect(writer).toHaveBeenCalledTimes(1);
    expect(JSON.parse(writer.mock.calls[0]![0]).profiles[0].name).toBe("Desktop");
  });
  it("reports disk failures and allows a later save to retry", async () => {
    const { writer } = setup(document, document);
    const module = await import("./settingsProfiles");
    await module.hydrateSettingsProfileLibrary();
    writer.mockRejectedValueOnce(new Error("disk unavailable"));
    expect(await module.flushSettingsProfileLibrary()).toBe(false);
    expect(await module.flushSettingsProfileLibrary()).toBe(true);
    expect(module.settingsProfileLibraryStore.getSnapshot().profiles).toHaveLength(1);
  });
});
