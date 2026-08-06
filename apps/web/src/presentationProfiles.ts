import { useCallback, useMemo, useRef, useState } from "react";

import { useClientSettingsHydrated, useSettings, useUpdateSettings } from "./hooks/useSettings";
import { useTheme } from "./hooks/useTheme";
import {
  settingsProfileLibraryStore,
  type SettingsProfile,
  useSettingsProfileLibrary,
} from "./settingsProfiles";
import { toastManager } from "./components/ui/toast";

export type PresentationProfileMode = "desktop" | "mobile";

function canonicalPresentationProfileName(mode: PresentationProfileMode): string {
  return `${mode} profile`;
}

export function resolvePresentationProfile(
  profiles: readonly SettingsProfile[],
  mode: PresentationProfileMode,
): SettingsProfile | null {
  const named = profiles.find(
    (profile) => profile.name.trim().toLocaleLowerCase() === canonicalPresentationProfileName(mode),
  );
  if (named) return named;
  const mobile = mode === "mobile";
  const matching = profiles.filter(
    (profile) => profile.clientSettings.mobileOptimizedPresentation === mobile,
  );
  return matching.length === 1 ? matching[0]! : null;
}

export function usePresentationProfiles() {
  const library = useSettingsProfileLibrary();
  const hydrated = useClientSettingsHydrated();
  const mobileOptimized = useSettings((settings) => settings.mobileOptimizedPresentation);
  const { updateClientSettingsConfirmed } = useUpdateSettings();
  const { theme, setTheme } = useTheme();
  const [busy, setBusy] = useState(false);
  const switchingRef = useRef(false);
  const desktopProfile = useMemo(
    () => resolvePresentationProfile(library.profiles, "desktop"),
    [library.profiles],
  );
  const mobileProfile = useMemo(
    () => resolvePresentationProfile(library.profiles, "mobile"),
    [library.profiles],
  );

  const switchTo = useCallback(
    async (mode: PresentationProfileMode): Promise<boolean> => {
      if (!hydrated || switchingRef.current) return false;
      const profile = mode === "mobile" ? mobileProfile : desktopProfile;
      if (!profile) {
        switchingRef.current = true;
        setBusy(true);
        try {
          await updateClientSettingsConfirmed({
            mobileOptimizedPresentation: mode === "mobile",
          });
          settingsProfileLibraryStore.activate(null);
          return true;
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Presentation was not switched",
            description:
              error instanceof Error ? error.message : "The layout could not be changed.",
          });
          return false;
        } finally {
          switchingRef.current = false;
          setBusy(false);
        }
      }
      switchingRef.current = true;
      setBusy(true);
      const previousTheme = theme;
      try {
        if (profile.theme !== previousTheme) setTheme(profile.theme);
        await updateClientSettingsConfirmed(profile.clientSettings);
        if (!settingsProfileLibraryStore.activate(profile.id)) {
          toastManager.add({
            type: "warning",
            title: `${profile.name} loaded for this session`,
            description: "The active profile marker could not be saved in this browser.",
          });
        }
        return true;
      } catch (error) {
        if (profile.theme !== previousTheme) setTheme(previousTheme);
        toastManager.add({
          type: "error",
          title: "Profile was not switched",
          description: error instanceof Error ? error.message : "The profile could not be loaded.",
        });
        return false;
      } finally {
        switchingRef.current = false;
        setBusy(false);
      }
    },
    [desktopProfile, hydrated, mobileProfile, setTheme, theme, updateClientSettingsConfirmed],
  );

  return {
    activeMode: mobileOptimized ? ("mobile" as const) : ("desktop" as const),
    busy,
    desktopProfile,
    mobileProfile,
    switchTo,
  };
}
