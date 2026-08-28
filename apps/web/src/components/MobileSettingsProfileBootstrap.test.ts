import { describe, expect, it } from "vitest";

import { DEFAULT_CLIENT_SETTINGS } from "@cafecode/contracts/settings";

import {
  mobileSettingsProfileBootstrapPayload,
  shouldSeedMobileSettingsProfile,
} from "./MobileSettingsProfileBootstrap";

describe("mobile settings profile bootstrap", () => {
  it("seeds only a hydrated mobile renderer with no explicit profiles", () => {
    expect(
      shouldSeedMobileSettingsProfile({
        isMobile: true,
        settingsHydrated: true,
        profileCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldSeedMobileSettingsProfile({
        isMobile: false,
        settingsHydrated: true,
        profileCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldSeedMobileSettingsProfile({
        isMobile: true,
        settingsHydrated: false,
        profileCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldSeedMobileSettingsProfile({
        isMobile: true,
        settingsHydrated: true,
        profileCount: 1,
      }),
    ).toBe(false);
  });

  it("stores a mobile presentation profile from a desktop-valued responsive snapshot", () => {
    const payload = mobileSettingsProfileBootstrapPayload(
      { ...DEFAULT_CLIENT_SETTINGS, mobileOptimizedPresentation: false },
      "dark",
    );

    expect(payload.clientSettings.mobileOptimizedPresentation).toBe(true);
    expect(payload.theme).toBe("dark");
  });
});
