import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  getClientSettings,
  useClientSettingsHydrated,
  useSettings,
  useUpdateSettings,
} from "./hooks/useSettings";
import { useTheme } from "./hooks/useTheme";
import { createMobileOptimizedPresentationPatch } from "./mobilePresentation";
import {
  settingsProfileLibraryStore,
  type SettingsProfile,
  useSettingsProfileLibrary,
} from "./settingsProfiles";
import { toastManager } from "./components/ui/toast";

export type PresentationProfileMode = "desktop" | "mobile";

export interface PresentationSwitchSnapshot {
  readonly busy: boolean;
  readonly targetMode: PresentationProfileMode | null;
}

export interface PresentationSwitchCoordinator {
  readonly getSnapshot: () => PresentationSwitchSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly run: (
    mode: PresentationProfileMode,
    operation: () => Promise<boolean>,
  ) => Promise<boolean>;
}

const IDLE_PRESENTATION_SWITCH = Object.freeze({
  busy: false,
  targetMode: null,
}) satisfies PresentationSwitchSnapshot;

/**
 * A presentation change replaces responsive component branches, so a lock
 * owned by one hook instance disappears midway through the change. Keep the
 * single-flight authority outside React component lifetime and expose it as an
 * external store so every prompt/splash control remains disabled together.
 */
export function createPresentationSwitchCoordinator(): PresentationSwitchCoordinator {
  let snapshot: PresentationSwitchSnapshot = IDLE_PRESENTATION_SWITCH;
  let activeOperation: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: PresentationSwitchSnapshot) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    run: (mode, operation) => {
      if (activeOperation !== null) {
        return snapshot.targetMode === mode ? activeOperation : Promise.resolve(false);
      }

      publish({ busy: true, targetMode: mode });
      const pending = Promise.resolve()
        .then(operation)
        .finally(() => {
          if (activeOperation === pending) {
            activeOperation = null;
            publish(IDLE_PRESENTATION_SWITCH);
          }
        });
      activeOperation = pending;
      return pending;
    },
  };
}

const presentationSwitchCoordinator = createPresentationSwitchCoordinator();

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

export function presentationProfilePatchMatches(
  current: Record<string, unknown>,
  patch: SettingsProfile["clientSettings"],
): boolean {
  return Object.entries(patch).every(
    ([key, value]) =>
      Object.is(current[key], value) || JSON.stringify(current[key]) === JSON.stringify(value),
  );
}

export function usePresentationProfiles() {
  const library = useSettingsProfileLibrary();
  const hydrated = useClientSettingsHydrated();
  const mobileOptimized = useSettings((settings) => settings.mobileOptimizedPresentation);
  const { updateClientSettingsConfirmed } = useUpdateSettings();
  const { theme, setTheme } = useTheme();
  const transition = useSyncExternalStore(
    presentationSwitchCoordinator.subscribe,
    presentationSwitchCoordinator.getSnapshot,
    presentationSwitchCoordinator.getSnapshot,
  );
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
      if (!hydrated) return false;
      return presentationSwitchCoordinator.run(mode, async () => {
        const profile = mode === "mobile" ? mobileProfile : desktopProfile;
        if (!profile) {
          try {
            await updateClientSettingsConfirmed(
              createMobileOptimizedPresentationPatch(mode === "mobile"),
            );
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
          }
        }

        const previousTheme = theme;
        const patch = buildPresentationProfilePatch(profile, mode);
        try {
          if (profile.theme !== previousTheme) setTheme(profile.theme);
          // Commit the shared profile values and renderer-local mode through
          // one confirmed write. Publishing the layout in a separate first
          // write remounted this hook and discarded its lock before the visual
          // payload had committed, allowing the opposite profile to win.
          await updateClientSettingsConfirmed(patch);
          if (!presentationProfilePatchMatches(getClientSettings(), patch)) {
            // A second renderer can finish an older profile write just after
            // this renderer's first response. Reassert the explicit click
            // once; continuing contention remains visible instead of looping.
            await updateClientSettingsConfirmed(patch);
            if (!presentationProfilePatchMatches(getClientSettings(), patch)) {
              throw new Error(
                "Another settings update superseded the selected profile while it was loading.",
              );
            }
          }
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
            description:
              error instanceof Error ? error.message : "The profile could not be loaded.",
          });
          return false;
        }
      });
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
    activeMode:
      transition.targetMode ?? (mobileOptimized ? ("mobile" as const) : ("desktop" as const)),
    busy: transition.busy,
    desktopProfile,
    mobileProfile,
    switchTo,
  };
}
