import type { SettingsProfile } from "./settingsProfiles";
import { describe, expect, it } from "vitest";

import { resolvePresentationProfile } from "./presentationProfiles";

function profile(name: string, mobileOptimizedPresentation: boolean): SettingsProfile {
  return {
    id: `profile:${name}`,
    name,
    theme: "dark",
    clientSettings: { mobileOptimizedPresentation },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("resolvePresentationProfile", () => {
  it("wires canonical Desktop Profile and Mobile Profile names", () => {
    const profiles = [profile("Desktop Profile", false), profile("Mobile Profile", true)];
    expect(resolvePresentationProfile(profiles, "desktop")?.name).toBe("Desktop Profile");
    expect(resolvePresentationProfile(profiles, "mobile")?.name).toBe("Mobile Profile");
  });

  it("uses an unambiguous presentation setting when profiles have custom names", () => {
    const profiles = [profile("Workstation", false), profile("Phone", true)];
    expect(resolvePresentationProfile(profiles, "desktop")?.name).toBe("Workstation");
    expect(resolvePresentationProfile(profiles, "mobile")?.name).toBe("Phone");
  });

  it("fails closed when multiple profiles could own one presentation button", () => {
    const profiles = [profile("Workstation", false), profile("Laptop", false)];
    expect(resolvePresentationProfile(profiles, "desktop")).toBeNull();
  });
});
