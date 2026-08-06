import { describe, expect, it } from "vitest";

import { shouldSeedMobileSettingsProfile } from "./MobileSettingsProfileBootstrap";

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
});
