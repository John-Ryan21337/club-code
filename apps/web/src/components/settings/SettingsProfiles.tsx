import {
  CheckIcon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  UserRoundCogIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useClientSettingsHydrated, useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import {
  captureSettingsProfilePayload,
  settingsProfileLibraryStore,
  settingsProfileMatches,
  SettingsProfileError,
  useSettingsProfileLibrary,
} from "../../settingsProfiles";
import { ensureLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";

type ProfileNotice = {
  readonly tone: "success" | "warning" | "error";
  readonly message: string;
};

function noticeClassName(tone: ProfileNotice["tone"]): string {
  switch (tone) {
    case "success":
      return "text-emerald-600 dark:text-emerald-400";
    case "warning":
      return "text-amber-600 dark:text-amber-400";
    case "error":
      return "text-destructive";
  }
}

function mutationNotice(action: string, profileName: string, persisted: boolean): ProfileNotice {
  if (!persisted) {
    return {
      tone: "warning",
      message: `${action} “${profileName}” for this session, but local browser storage is unavailable.`,
    };
  }
  return {
    tone: "success",
    message: `${action} “${profileName}”.`,
  };
}

export function SettingsProfiles() {
  const library = useSettingsProfileLibrary();
  const settings = useSettings();
  const settingsHydrated = useClientSettingsHydrated();
  const { updateClientSettingsConfirmed } = useUpdateSettings();
  const { theme, setTheme } = useTheme();
  const activeProfile =
    library.activeProfileId === null
      ? null
      : (library.profiles.find((profile) => profile.id === library.activeProfileId) ?? null);
  const [nameDraft, setNameDraft] = useState(activeProfile?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ProfileNotice | null>(null);
  const operationInFlightRef = useRef(false);

  const currentPayload = useMemo(
    () => captureSettingsProfilePayload(settings, theme),
    [settings, theme],
  );
  const activeProfileIsCurrent =
    activeProfile !== null && settingsProfileMatches(activeProfile, currentPayload);

  useEffect(() => {
    setNameDraft(activeProfile?.name ?? "");
  }, [activeProfile?.id, activeProfile?.name]);

  const reportError = useCallback((error: unknown) => {
    setNotice({
      tone: "error",
      message:
        error instanceof SettingsProfileError || error instanceof Error
          ? error.message
          : "The settings profile could not be changed.",
    });
  }, []);

  const handleSave = useCallback(() => {
    if (!settingsHydrated) return;
    try {
      const result = settingsProfileLibraryStore.upsert(nameDraft, currentPayload);
      setNameDraft(result.profile.name);
      setNotice(
        mutationNotice(
          result.replaced ? "Updated" : "Saved",
          result.profile.name,
          result.persisted,
        ),
      );
    } catch (error) {
      reportError(error);
    }
  }, [currentPayload, nameDraft, reportError, settingsHydrated]);

  const handleUpdateActive = useCallback(() => {
    if (!settingsHydrated) return;
    try {
      const result = settingsProfileLibraryStore.updateActive(currentPayload);
      setNotice(mutationNotice("Updated", result.profile.name, result.persisted));
    } catch (error) {
      reportError(error);
    }
  }, [currentPayload, reportError, settingsHydrated]);

  const handleRename = useCallback(() => {
    if (!activeProfile) return;
    try {
      const result = settingsProfileLibraryStore.rename(activeProfile.id, nameDraft);
      setNameDraft(result.profile.name);
      setNotice(mutationNotice("Renamed profile to", result.profile.name, result.persisted));
    } catch (error) {
      reportError(error);
    }
  }, [activeProfile, nameDraft, reportError]);

  const handleDelete = useCallback(async () => {
    if (!activeProfile || operationInFlightRef.current) return;
    operationInFlightRef.current = true;
    setBusy(true);
    try {
      const confirmed = await ensureLocalApi().dialogs.confirm(
        `Delete the local settings profile “${activeProfile.name}”?`,
      );
      if (!confirmed) return;
      if (settingsProfileLibraryStore.resolve(activeProfile.id) === null) {
        setNotice({
          tone: "warning",
          message: `“${activeProfile.name}” was already removed or renamed in another window.`,
        });
        return;
      }
      const persisted = settingsProfileLibraryStore.remove(activeProfile.id);
      const nextSnapshot = settingsProfileLibraryStore.getSnapshot();
      const nextActive =
        nextSnapshot.activeProfileId === null
          ? null
          : (settingsProfileLibraryStore.resolve(nextSnapshot.activeProfileId) ?? null);
      setNameDraft(nextActive?.name ?? "");
      setNotice(mutationNotice("Deleted", activeProfile.name, persisted));
    } catch (error) {
      reportError(error);
    } finally {
      operationInFlightRef.current = false;
      setBusy(false);
    }
  }, [activeProfile, reportError]);

  const handleSwitch = useCallback(
    async (profileId: string, reloadActive = false) => {
      if (
        operationInFlightRef.current ||
        !settingsHydrated ||
        (!reloadActive && profileId === library.activeProfileId)
      ) {
        return;
      }
      const profile = settingsProfileLibraryStore.resolve(profileId);
      if (!profile) {
        reportError(new SettingsProfileError("That settings profile no longer exists."));
        return;
      }
      operationInFlightRef.current = true;
      setBusy(true);
      setNotice(null);
      const previousTheme = theme;
      let themeWriteAttempted = false;
      try {
        // Apply the synchronous local theme first, then the confirmed client patch.
        // The confirmed writer compensates a committed shared patch if the
        // renderer-local persistence stage rejects. Restore the prior theme
        // before reporting any rejected profile load.
        if (profile.theme !== previousTheme) {
          themeWriteAttempted = true;
          setTheme(profile.theme);
        }
        // Profile payloads contain client preferences only. Use the confirmed
        // writer so either stage rejects visibly and a committed shared stage
        // is compensated when renderer-local persistence fails.
        await updateClientSettingsConfirmed(profile.clientSettings);

        const latestProfile = settingsProfileLibraryStore.resolve(profile.id);
        if (
          latestProfile === null ||
          latestProfile.name !== profile.name ||
          latestProfile.updatedAt !== profile.updatedAt ||
          !settingsProfileMatches(latestProfile, {
            theme: profile.theme,
            clientSettings: profile.clientSettings,
          })
        ) {
          setNotice({
            tone: "warning",
            message:
              latestProfile === null
                ? `Loaded the saved values from “${profile.name}”, but that profile was removed or renamed in another window while it was loading.`
                : `Loaded an earlier version of “${profile.name}”. It changed in another window while loading; reload it to apply the latest values.`,
          });
          return;
        }

        // A failed settings write must never make a profile look successfully
        // loaded. The marker therefore changes only after both writes succeed.
        const activeMarkerPersisted = settingsProfileLibraryStore.activate(profile.id);
        setNameDraft(profile.name);
        setNotice(
          activeMarkerPersisted
            ? { tone: "success", message: `Loaded “${profile.name}”.` }
            : {
                tone: "warning",
                message: `Loaded “${profile.name}”, but its active marker could not be saved locally.`,
              },
        );
      } catch (error) {
        let themeRollbackError: unknown = null;
        if (themeWriteAttempted) {
          try {
            setTheme(previousTheme);
          } catch (rollbackError) {
            themeRollbackError = rollbackError;
          }
        }
        if (themeRollbackError === null) {
          reportError(error);
        } else {
          const loadMessage =
            error instanceof Error ? error.message : "The settings profile could not be loaded.";
          const rollbackMessage =
            themeRollbackError instanceof Error
              ? themeRollbackError.message
              : "The prior theme could not be restored.";
          reportError(
            new SettingsProfileError(
              `${loadMessage} The prior theme could not be restored: ${rollbackMessage}`,
            ),
          );
        }
      } finally {
        operationInFlightRef.current = false;
        setBusy(false);
      }
    },
    [
      library.activeProfileId,
      reportError,
      setTheme,
      settingsHydrated,
      theme,
      updateClientSettingsConfirmed,
    ],
  );

  const activeStatus = !settingsHydrated
    ? "Loading this client’s preferences before profiles can be saved or loaded."
    : activeProfile === null
      ? "No active profile. Save the current preferences under a name such as Mobile or Desktop."
      : activeProfileIsCurrent
        ? `“${activeProfile.name}” matches the current preferences.`
        : `Current preferences differ from “${activeProfile.name}”. Update it to keep those changes.`;

  return (
    <SettingsSection
      title="Settings profiles"
      icon={<UserRoundCogIcon aria-hidden="true" className="size-3.5" />}
      aria-busy={busy}
    >
      <SettingsRow
        title="Switch profile"
        description="Select a saved profile to load it immediately. The selected profile stays active after a restart."
        status={activeStatus}
        control={
          <>
            <Select
              value={library.activeProfileId ?? ""}
              disabled={busy || !settingsHydrated || library.profiles.length === 0}
              onValueChange={(profileId) => {
                if (profileId) void handleSwitch(profileId);
              }}
            >
              <SelectTrigger
                className="min-w-0 flex-1 sm:w-52"
                aria-label="Active settings profile"
              >
                <SelectValue>
                  {busy
                    ? "Loading…"
                    : (activeProfile?.name ??
                      (library.profiles.length === 0 ? "No saved profiles" : "Choose a profile"))}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {library.profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <Button
              size="sm"
              variant="outline"
              aria-label="Reload active settings profile"
              disabled={
                busy || !settingsHydrated || activeProfile === null || activeProfileIsCurrent
              }
              onClick={() => {
                if (activeProfile) void handleSwitch(activeProfile.id, true);
              }}
            >
              <RefreshCwIcon aria-hidden="true" />
              Reload
            </Button>
          </>
        }
      />

      <SettingsRow
        title="Save current preferences"
        description="Profiles are stored only in this browser or desktop client. Saving the same name replaces that local profile."
        status={
          notice ? (
            <span
              role={notice.tone === "error" ? "alert" : "status"}
              className={noticeClassName(notice.tone)}
            >
              {notice.message}
            </span>
          ) : (
            "Profiles capture the theme, UI appearance and layout, ambient YouTube/GIF activation and configuration, and inert usability preferences. GIF entries are content-addressed server assets; profiles never store their source file paths or image bytes. Profiles do not include permissions or consent, destructive-action confirmations, completion-alert activation, live thread/provider-fed visuals, keybindings, playback position or URL-queue progress, local files, uploaded sounds, native host controls, provider/auth or server/network settings, model identity or pacing, project-specific state, or exact-thread Auto Nudge and Idle Thread Guard authority."
          )
        }
      >
        <div className="flex flex-col gap-2 pb-3.5 sm:flex-row sm:items-center">
          <Input
            aria-label="Settings profile name"
            className="min-w-0 flex-1"
            maxLength={64}
            placeholder="Profile name, for example Mobile"
            value={nameDraft}
            disabled={busy || !settingsHydrated}
            onChange={(event) => {
              setNameDraft(event.currentTarget.value);
              setNotice(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && nameDraft.trim()) {
                event.preventDefault();
                handleSave();
              }
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !settingsHydrated || nameDraft.trim().length === 0}
              onClick={handleSave}
            >
              <SaveIcon aria-hidden="true" />
              Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy || !settingsHydrated || activeProfile === null || activeProfileIsCurrent
              }
              onClick={handleUpdateActive}
            >
              <CheckIcon aria-hidden="true" />
              Update active
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy ||
                activeProfile === null ||
                nameDraft.trim().length === 0 ||
                nameDraft.trim() === activeProfile.name
              }
              onClick={handleRename}
            >
              <PencilIcon aria-hidden="true" />
              Rename
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={busy || activeProfile === null}
              onClick={() => void handleDelete()}
            >
              <Trash2Icon aria-hidden="true" />
              Delete
            </Button>
          </div>
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
