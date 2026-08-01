import {
  CheckIcon,
  EyeIcon,
  PencilIcon,
  RefreshCwIcon,
  SaveIcon,
  Trash2Icon,
  UserRoundCogIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useClientSettingsHydrated, useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import {
  captureSettingsProfilePayload,
  compareSettingsProfile,
  mutateSettingsProfileLibrary,
  settingsProfileLibraryStore,
  settingsProfileMatches,
  type SettingsProfile,
  SettingsProfileError,
  useSettingsProfileLibrary,
} from "../../settingsProfiles";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
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

function isSameSavedProfile(left: SettingsProfile, right: SettingsProfile): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    settingsProfileMatches(left, {
      theme: right.theme,
      clientSettings: right.clientSettings,
    })
  );
}

function profileDifferenceLabel(key: string): string {
  if (key === "theme") return "Theme";
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

function profileDifferenceValue(value: boolean | number | string | undefined): string {
  if (value === undefined) return "Not set";
  if (typeof value === "boolean") return value ? "On" : "Off";
  const normalized = String(value).replace(/\s+/gu, " ").trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}…` : normalized;
}

export function SettingsProfiles() {
  const library = useSettingsProfileLibrary();
  const settings = useSettings();
  const settingsHydrated = useClientSettingsHydrated();
  const { updateSettingsAsync } = useUpdateSettings();
  const { theme, setTheme } = useTheme();
  const activeProfile =
    library.activeProfileId === null
      ? null
      : (library.profiles.find((profile) => profile.id === library.activeProfileId) ?? null);
  const [nameDraft, setNameDraft] = useState(activeProfile?.name ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<ProfileNotice | null>(null);
  const [previewProfileId, setPreviewProfileId] = useState<string | null>(null);
  const [pendingDeleteProfile, setPendingDeleteProfile] = useState<SettingsProfile | null>(null);

  const currentPayload = useMemo(
    () => captureSettingsProfilePayload(settings, theme),
    [settings, theme],
  );
  const activeProfileDifferences = useMemo(
    () => (activeProfile === null ? [] : compareSettingsProfile(activeProfile, currentPayload)),
    [activeProfile, currentPayload],
  );
  // Older profiles are deliberately sparse patches. Treat one as current when
  // applying it would make no change; exact document equality would incorrectly
  // enable Reload merely because a later allowlisted field is absent.
  const activeProfileIsCurrent = activeProfile !== null && activeProfileDifferences.length === 0;
  const previewProfile =
    previewProfileId === null
      ? null
      : (library.profiles.find((profile) => profile.id === previewProfileId) ?? null);
  const previewProfileDifferences = useMemo(
    () =>
      previewProfile === null
        ? []
        : previewProfile.id === activeProfile?.id
          ? activeProfileDifferences
          : compareSettingsProfile(previewProfile, currentPayload),
    [activeProfile?.id, activeProfileDifferences, currentPayload, previewProfile],
  );
  const activeProfilePreviewVisible =
    activeProfile !== null && previewProfile?.id === activeProfile.id;

  useEffect(() => {
    setNameDraft(activeProfile?.name ?? "");
  }, [activeProfile?.id, activeProfile?.name]);

  useEffect(() => {
    if (previewProfileId !== null && previewProfile === null) setPreviewProfileId(null);
  }, [previewProfile, previewProfileId]);

  const reportError = useCallback((error: unknown) => {
    setNotice({
      tone: "error",
      message:
        error instanceof SettingsProfileError || error instanceof Error
          ? error.message
          : "The settings profile could not be changed.",
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!settingsHydrated || busy) return;
    setBusy(true);
    try {
      const result = await mutateSettingsProfileLibrary(settingsProfileLibraryStore, () => {
        const existing = settingsProfileLibraryStore.resolveByName(nameDraft);
        if (existing !== null) {
          throw new SettingsProfileError(
            `A profile named “${existing.name}” already exists. Choose another name, or load that profile and use Update active after making changes.`,
          );
        }
        return settingsProfileLibraryStore.upsert(nameDraft, currentPayload);
      });
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
    } finally {
      setBusy(false);
    }
  }, [busy, currentPayload, nameDraft, reportError, settingsHydrated]);

  const handleUpdateActive = useCallback(async () => {
    if (!settingsHydrated || busy || activeProfile === null) return;
    setBusy(true);
    try {
      const result = await mutateSettingsProfileLibrary(settingsProfileLibraryStore, () => {
        const latest = settingsProfileLibraryStore.resolve(activeProfile.id);
        if (
          latest === null ||
          settingsProfileLibraryStore.getSnapshot().activeProfileId !== activeProfile.id ||
          !isSameSavedProfile(activeProfile, latest)
        ) {
          throw new SettingsProfileError(
            latest === null
              ? "That settings profile no longer exists."
              : `“${activeProfile.name}” changed in another window. Review it before updating.`,
          );
        }
        return settingsProfileLibraryStore.updateActive(currentPayload);
      });
      setNotice(mutationNotice("Updated", result.profile.name, result.persisted));
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }, [activeProfile, busy, currentPayload, reportError, settingsHydrated]);

  const handleRename = useCallback(async () => {
    if (!activeProfile || busy) return;
    setBusy(true);
    try {
      const result = await mutateSettingsProfileLibrary(settingsProfileLibraryStore, () => {
        const latest = settingsProfileLibraryStore.resolve(activeProfile.id);
        if (latest === null || !isSameSavedProfile(activeProfile, latest)) {
          throw new SettingsProfileError(
            latest === null
              ? "That settings profile no longer exists."
              : `“${activeProfile.name}” changed in another window. Review it before renaming.`,
          );
        }
        return settingsProfileLibraryStore.rename(activeProfile.id, nameDraft);
      });
      setNameDraft(result.profile.name);
      setNotice(mutationNotice("Renamed profile to", result.profile.name, result.persisted));
    } catch (error) {
      reportError(error);
    } finally {
      setBusy(false);
    }
  }, [activeProfile, busy, nameDraft, reportError]);

  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDeleteProfile || busy) return;
    const profile = pendingDeleteProfile;
    setBusy(true);
    try {
      const removal = await mutateSettingsProfileLibrary(settingsProfileLibraryStore, () => {
        const latest = settingsProfileLibraryStore.resolve(profile.id);
        if (latest === null) return { kind: "missing" as const };
        if (!isSameSavedProfile(profile, latest)) {
          return { kind: "changed" as const };
        }
        return {
          kind: "removed" as const,
          persisted: settingsProfileLibraryStore.remove(profile.id),
        };
      });
      if (removal.kind !== "removed") {
        setNotice({
          tone: "warning",
          message:
            removal.kind === "missing"
              ? `“${profile.name}” was already removed or renamed in another window.`
              : `“${profile.name}” changed in another window and was not deleted. Review it and try again.`,
        });
        return;
      }
      const nextSnapshot = settingsProfileLibraryStore.getSnapshot();
      const nextActive =
        nextSnapshot.activeProfileId === null
          ? null
          : (settingsProfileLibraryStore.resolve(nextSnapshot.activeProfileId) ?? null);
      setNameDraft(nextActive?.name ?? "");
      setNotice(mutationNotice("Deleted", profile.name, removal.persisted));
    } catch (error) {
      reportError(error);
    } finally {
      setPendingDeleteProfile(null);
      setBusy(false);
    }
  }, [busy, pendingDeleteProfile, reportError]);

  const handleSwitch = useCallback(
    async (profileId: string, reloadActive = false) => {
      if (busy || !settingsHydrated || (!reloadActive && profileId === library.activeProfileId)) {
        return;
      }
      setBusy(true);
      setNotice(null);
      let profile: SettingsProfile | null;
      try {
        profile = await mutateSettingsProfileLibrary(settingsProfileLibraryStore, () =>
          settingsProfileLibraryStore.resolve(profileId),
        );
      } catch (error) {
        reportError(error);
        setBusy(false);
        return;
      }
      if (!profile) {
        reportError(new SettingsProfileError("That settings profile no longer exists."));
        setBusy(false);
        return;
      }
      const previousTheme = theme;
      let themeWriteAttempted = false;
      try {
        // Apply the synchronous local theme first, then the async client patch.
        // The settings writer rolls back its own optimistic patch on rejection;
        // if it rejects, restore the prior theme before reporting the failure.
        if (profile.theme !== previousTheme) {
          themeWriteAttempted = true;
          setTheme(profile.theme);
        }
        await updateSettingsAsync(profile.clientSettings);

        let activation:
          | { readonly kind: "activated"; readonly persisted: boolean }
          | { readonly kind: "missing" | "changed" };
        try {
          activation = await mutateSettingsProfileLibrary(settingsProfileLibraryStore, () => {
            const latest = settingsProfileLibraryStore.resolve(profile.id);
            if (latest === null) return { kind: "missing" as const };
            if (!isSameSavedProfile(profile, latest)) return { kind: "changed" as const };
            return {
              kind: "activated" as const,
              persisted: settingsProfileLibraryStore.activate(profile.id),
            };
          });
        } catch (error) {
          const detail =
            error instanceof Error && error.message.trim().length > 0 ? ` ${error.message}` : "";
          setNameDraft(profile.name);
          setNotice({
            tone: "warning",
            message: `Loaded “${profile.name}”, but its active marker could not be coordinated across open windows.${detail}`,
          });
          return;
        }

        if (activation.kind !== "activated") {
          setNotice({
            tone: "warning",
            message:
              activation.kind === "missing"
                ? `Loaded the saved values from “${profile.name}”, but that profile was removed or renamed in another window while it was loading.`
                : `Loaded an earlier version of “${profile.name}”. It changed in another window while loading; reload it to apply the latest values.`,
          });
          return;
        }

        // A failed settings write must never make a profile look successfully
        // loaded. The marker therefore changes only after both writes succeed.
        setNameDraft(profile.name);
        setNotice(
          activation.persisted
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
        setBusy(false);
      }
    },
    [
      busy,
      library.activeProfileId,
      reportError,
      setTheme,
      settingsHydrated,
      theme,
      updateSettingsAsync,
    ],
  );

  const activeStatus = !settingsHydrated
    ? "Loading this environment’s preferences before profiles can be saved or loaded."
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
        description="Select a saved profile to load it immediately. Its active marker survives a restart when local storage is available."
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
            <Button
              size="sm"
              variant="outline"
              aria-controls="settings-profile-difference-preview"
              aria-expanded={activeProfilePreviewVisible}
              disabled={busy || !settingsHydrated || activeProfile === null}
              onClick={() =>
                setPreviewProfileId((profileId) =>
                  profileId === activeProfile?.id ? null : (activeProfile?.id ?? null),
                )
              }
            >
              <EyeIcon aria-hidden="true" />
              {activeProfilePreviewVisible ? "Hide preview" : "Preview changes"}
            </Button>
          </>
        }
      >
        {library.profiles.length > 0 ? (
          <div
            className="flex max-w-full gap-1.5 overflow-x-auto pb-3.5 pt-1"
            role="group"
            aria-label="Quick settings profile switch"
          >
            {library.profiles.map((profile) => {
              const isActive = profile.id === library.activeProfileId;
              return (
                <div key={profile.id} className="flex shrink-0">
                  <Button
                    size="sm"
                    variant={isActive ? "secondary" : "outline"}
                    className="max-w-48 rounded-r-none"
                    aria-pressed={isActive}
                    title={`Load ${profile.name}`}
                    disabled={busy || !settingsHydrated}
                    onClick={() => void handleSwitch(profile.id, isActive)}
                  >
                    <span className="truncate">{profile.name}</span>
                  </Button>
                  <Button
                    size="icon-sm"
                    variant={previewProfile?.id === profile.id ? "secondary" : "outline"}
                    className="rounded-l-none border-l-0"
                    aria-label={`Preview ${profile.name}`}
                    aria-controls="settings-profile-difference-preview"
                    aria-expanded={previewProfile?.id === profile.id}
                    disabled={busy || !settingsHydrated}
                    onClick={() =>
                      setPreviewProfileId((profileId) =>
                        profileId === profile.id ? null : profile.id,
                      )
                    }
                  >
                    <EyeIcon aria-hidden="true" />
                  </Button>
                </div>
              );
            })}
          </div>
        ) : null}
        {previewProfile !== null ? (
          <section
            id="settings-profile-difference-preview"
            className="mb-3.5 rounded-lg border bg-muted/30 p-3 text-sm"
            aria-label={`Changes from loading ${previewProfile.name}`}
          >
            <p className="font-medium">
              {previewProfileDifferences.length === 0
                ? "This profile would not change the current safe preferences."
                : `${previewProfileDifferences.length} safe preference${previewProfileDifferences.length === 1 ? "" : "s"} would change.`}
            </p>
            {previewProfileDifferences.length > 0 ? (
              <dl className="mt-2 grid gap-2">
                {previewProfileDifferences.map((difference) => (
                  <div
                    key={difference.key}
                    className="grid gap-0.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3"
                  >
                    <dt className="font-medium">{profileDifferenceLabel(difference.key)}</dt>
                    <dd className="min-w-0 break-words text-muted-foreground">
                      <span className="sr-only">Current: </span>
                      {profileDifferenceValue(difference.currentValue)}
                      <span aria-hidden="true"> → </span>
                      <span className="sr-only">Saved profile: </span>
                      {profileDifferenceValue(difference.savedValue)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>
        ) : null}
      </SettingsRow>

      <SettingsRow
        title="Save current preferences"
        description="Save creates a new profile in this browser or desktop client. Loading one applies its safe preferences to the current Cafe environment; use Update active to replace the selected profile."
        status={
          notice ? (
            <span
              role={notice.tone === "error" ? "alert" : "status"}
              className={noticeClassName(notice.tone)}
            >
              {notice.message}
            </span>
          ) : (
            "Profiles capture the theme plus safe UI appearance, layout, completion-alert, ambiance, and usability preferences. They do not include keybindings, OS/Web notification activation, external media playback or playlist libraries, local or uploaded assets, provider-usage polling, native editor or power controls, window transparency or panel geometry, provider/auth or server/network settings, model favorites or pacing, project-specific state, or exact-thread Auto Nudge."
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
                void handleSave();
              }
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !settingsHydrated || nameDraft.trim().length === 0}
              onClick={() => void handleSave()}
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
              onClick={() => void handleUpdateActive()}
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
              onClick={() => void handleRename()}
            >
              <PencilIcon aria-hidden="true" />
              Rename
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={busy || activeProfile === null}
              onClick={() => setPendingDeleteProfile(activeProfile)}
            >
              <Trash2Icon aria-hidden="true" />
              Delete
            </Button>
          </div>
        </div>
      </SettingsRow>
      <AlertDialog
        open={pendingDeleteProfile !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingDeleteProfile(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete settings profile “{pendingDeleteProfile?.name ?? ""}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes only the local saved preset. It does not change the preferences that are
              currently applied.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" disabled={busy} />}>
              Cancel
            </AlertDialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => void handleConfirmDelete()}
            >
              Delete profile
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsSection>
  );
}
