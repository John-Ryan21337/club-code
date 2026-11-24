import { useCallback } from "react";
import type { ClientSettingsPatch } from "@cafecode/contracts";
import type { SettingsProfile } from "../settingsProfiles";
import {
  applyProfileExtras,
  captureProfileExtras,
  decodeProfileServerPatch,
} from "../settingsProfileExtras";
import { useSettings, useUpdateSettings } from "./useSettings";

/** Both profile entry points use the same commit and compensation path. */
export function useApplySettingsProfile() {
  const settings = useSettings();
  const { updateClientSettingsConfirmed, updateSettingsAsync } = useUpdateSettings();
  return useCallback(
    async (profile: SettingsProfile, patch: ClientSettingsPatch = profile.clientSettings) => {
      const previous = captureProfileExtras(settings, window.localStorage);
      const opacity =
        profile.windowOpacity && window.desktopBridge?.getWindowOpacityState
          ? await window.desktopBridge.getWindowOpacityState()
          : null;
      const rollbackExtras = {
        ...previous,
        localPreferences: Object.fromEntries(
          Object.keys(profile.localPreferences ?? {}).map((key) => [
            key,
            previous.localPreferences?.[key] ?? null,
          ]),
        ),
        ...(opacity
          ? { windowOpacity: { enabled: opacity.enabled, opacity: opacity.opacity } }
          : {}),
      };
      const serverPatch = decodeProfileServerPatch(profile);
      const previousServerPatch = decodeProfileServerPatch(previous);
      let serverWritten = false;
      try {
        await applyProfileExtras(profile);
        if (Object.keys(serverPatch).length > 0) {
          await updateSettingsAsync(serverPatch);
          serverWritten = true;
        }
        await updateClientSettingsConfirmed(patch);
      } catch (error) {
        const failures: unknown[] = [];
        if (serverWritten) {
          const rollback = Object.fromEntries(
            Object.keys(serverPatch).map((key) => [
              key,
              previousServerPatch[key as keyof typeof previousServerPatch],
            ]),
          );
          try {
            await updateSettingsAsync(rollback);
          } catch (cause) {
            failures.push(cause);
          }
        }
        try {
          await applyProfileExtras(rollbackExtras);
        } catch (cause) {
          failures.push(cause);
        }
        if (failures.length > 0)
          throw new Error(
            "The profile could not load, and some prior preferences could not be restored. Check your settings.",
            { cause: error },
          );
        throw error;
      }
    },
    [settings, updateClientSettingsConfirmed, updateSettingsAsync],
  );
}
