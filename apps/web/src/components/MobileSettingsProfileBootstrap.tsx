import { useEffect, useRef } from "react";

import { useIsMobile } from "../hooks/useMediaQuery";
import { useClientSettingsHydrated, useSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import {
  captureSettingsProfilePayload,
  settingsProfileLibraryStore,
  useSettingsProfileLibrary,
} from "../settingsProfiles";

export const DEFAULT_MOBILE_SETTINGS_PROFILE_NAME = "Mobile Profile";

export function mobileSettingsProfileBootstrapPayload(
  settings: Parameters<typeof captureSettingsProfilePayload>[0],
  theme: Parameters<typeof captureSettingsProfilePayload>[1],
) {
  const payload = captureSettingsProfilePayload(settings, theme);
  return {
    ...payload,
    clientSettings: {
      ...payload.clientSettings,
      mobileOptimizedPresentation: true,
    },
  };
}

export function shouldSeedMobileSettingsProfile(input: {
  readonly isMobile: boolean;
  readonly settingsHydrated: boolean;
  readonly profileCount: number;
}): boolean {
  return input.isMobile && input.settingsHydrated && input.profileCount === 0;
}

export function MobileSettingsProfileBootstrap() {
  const isMobile = useIsMobile();
  const settingsHydrated = useClientSettingsHydrated();
  const settings = useSettings();
  const { theme } = useTheme();
  const library = useSettingsProfileLibrary();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (
      attemptedRef.current ||
      !shouldSeedMobileSettingsProfile({
        isMobile,
        settingsHydrated,
        profileCount: library.profiles.length,
      })
    ) {
      return;
    }
    attemptedRef.current = true;
    settingsProfileLibraryStore.upsert(
      DEFAULT_MOBILE_SETTINGS_PROFILE_NAME,
      mobileSettingsProfileBootstrapPayload(settings, theme),
    );
    // A natural phone viewport does not authorize a persistent presentation
    // override. Keep the new profile available for the Mobile button, but do
    // not let its active marker suppress responsive mobile layout before the
    // operator explicitly selects it.
    if (!settings.mobileOptimizedPresentation) {
      settingsProfileLibraryStore.activate(null);
    }
  }, [isMobile, library.profiles.length, settings, settingsHydrated, theme]);

  return null;
}
