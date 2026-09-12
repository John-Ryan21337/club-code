import { describe, expect, it } from "vitest";
import {
  canManageHardwareLighting,
  changesHardwareLightingSettings,
} from "./HardwareLightingAuthority.ts";

describe("hardware lighting authority", () => {
  it("requires both authenticated owner role and observed secure transport", () => {
    expect(canManageHardwareLighting("owner", true)).toBe(true);
    expect(canManageHardwareLighting("owner", false)).toBe(false);
    expect(canManageHardwareLighting("client", true)).toBe(false);
    expect(canManageHardwareLighting("client", false)).toBe(false);
    expect(canManageHardwareLighting("Electron", true)).toBe(false);
  });
  it("gates explicit disable, empty selection, brightness and restore changes", () => {
    expect(changesHardwareLightingSettings({ hardwareLightingSyncEnabled: false })).toBe(true);
    expect(changesHardwareLightingSettings({ hardwareLightingControllerIds: [] })).toBe(true);
    expect(changesHardwareLightingSettings({ hardwareLightingBrightness: 0.5 })).toBe(true);
    expect(changesHardwareLightingSettings({ hardwareLightingRestoreOnDisable: false })).toBe(true);
    expect(changesHardwareLightingSettings({ fallingEffectsEnabled: false })).toBe(false);
    expect(changesHardwareLightingSettings({})).toBe(false);
  });
});
