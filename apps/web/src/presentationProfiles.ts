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

export function buildPresentationProfilePatch(
  profile: SettingsProfile,
  mode: PresentationProfileMode,
): SettingsProfile["clientSettings"] {
  return {
    ...profile.clientSettings,
    mobileOptimizedPresentation: mode === "mobile",
  };
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
      const previousMode = mobileOptimized ? "mobile" : "desktop";
      try {
        // Presentation mode is renderer-local while the rest of a saved
        // profile is shared with the connected environment. Establish the
        // target layout first so shared visual effects cannot render for a
        // frame in the old layout while the split write is in flight.
        await updateClientSettingsConfirmed({
          mobileOptimizedPresentation: mode === "mobile",
        });
        if (profile.theme !== previousTheme) setTheme(profile.theme);
        await updateClientSettingsConfirmed(buildPresentationProfilePatch(profile, mode));
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
        if (previousMode !== mode) {
          try {
            await updateClientSettingsConfirmed({
              mobileOptimizedPresentation: previousMode === "mobile",
            });
          } catch (rollbackError) {
            console.error("[PRESENTATION_PROFILE] mode rollback failed", rollbackError);
          }
        }
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
    [
      desktopProfile,
      hydrated,
      mobileOptimized,
      mobileProfile,
      setTheme,
      theme,
      updateClientSettingsConfirmed,
    ],
  );

  return {
    activeMode: mobileOptimized ? ("mobile" as const) : ("desktop" as const),
    busy,
    desktopProfile,
    mobileProfile,
    switchTo,
  };
}
