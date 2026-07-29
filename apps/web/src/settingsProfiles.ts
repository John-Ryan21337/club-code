import {
  ClientSettingsSchema,
  type ClientSettings,
  type UnifiedSettings,
} from "@cafecode/contracts/settings";
import * as Schema from "effect/Schema";
import { useEffect, useSyncExternalStore } from "react";

export const SETTINGS_PROFILE_LIBRARY_STORAGE_KEY = "cafe-code:settings-profile-library:v1";
export const SETTINGS_PROFILE_LIBRARY_VERSION = 1;
export const SETTINGS_PROFILE_MAX_COUNT = 32;
export const SETTINGS_PROFILE_MAX_NAME_LENGTH = 64;
export const SETTINGS_PROFILE_MAX_STORAGE_BYTES = 512 * 1024;

export type SettingsProfileTheme = "light" | "dark" | "system";

/**
 * Settings profiles are local presentation presets, not server snapshots.
 *
 * This explicit allowlist is a security boundary. In particular, do not add:
 * - provider instances, endpoints, auth, account identity, or model-instance preferences;
 * - server exposure, observability endpoints, repository paths, or project-specific overrides;
 * - model pacing or any other cross-thread execution policy;
 * - the compatibility-only Auto Nudge fields (authority is exact-thread orchestration state);
 * - onboarding/dismissal bookkeeping.
 *
 * Add compatible client preferences deliberately in a later document version or as an
 * optional field in this version. Older profiles patch only the keys they actually contain,
 * so a newly allowlisted preference is never reset just because an older profile is loaded.
 */
export const SETTINGS_PROFILE_CLIENT_KEYS = [
  "autoOpenPlanSidebar",
  "notificationsEnabled",
  "completionAlertSoundEnabled",
  "completionAlertSpeechEnabled",
  "completionAlertLanguage",
  "completionAlertEnglishVoiceGender",
  "completionAlertJapaneseVoiceGender",
  "completionAlertDualStereoOrder",
  "confirmThreadArchive",
  "confirmThreadDelete",
  "diffIgnoreWhitespace",
  "diffWordWrap",
  "continueBackgroundAnimations",
  "mobileOptimizedPresentation",
  "worldClockEnabled",
  "worldClockStyle",
  "worldClockLocationIds",
  "fallingEffectsEnabled",
  "fallingEffectsOverCinemaEnabled",
  "fallingEffectKind",
  "fallingEffectMatrixBaseFontSize",
  "fallingEffectColor",
  "fallingEffectMatrixColorMode",
  "fallingEffectMatrixColorCycleSpeed",
  "fallingEffectMatrixMotionMode",
  "fallingEffectMatrixWalkStartFontSize",
  "fallingEffectMatrixWalkEndFontSize",
  "fallingEffectOpacity",
  "fallingEffectSpeed",
  "fallingEffectDensity",
  "fallingEffectJapaneseRatio",
  "fallingEffect2chEnriched",
  "fallingEffectLiveWorkVocabulary",
  "fallingEffectActivityLinks",
  "fallingEffectActivityLinkNetworkEnabled",
  "fallingEffectActivityLinkDatabaseEnabled",
  "fallingEffectActivityLinkBuildEnabled",
  "fallingEffectActivityLinkAgentEnabled",
  "fallingEffectActivityLinkColorMode",
  "fallingEffectActivityLinkRetentionSeconds",
  "ambientVideoEnabled",
  "ambientVideoSource",
  "ambientVideoLayoutMode",
  "ambientVideoPresetPlacement",
  "ambientVideoPresetSize",
  "ambientVideoPresentationMode",
  "ambientVideoGlowEnabled",
  "ambientVideoGlowMode",
  "ambientVideoGlowColor",
  "ambientVideoGlowOpacity",
  "ambientImageEnabled",
  "ambientImageAsset",
  "ambientImageCycleAssets",
  "ambientImageCycleEnabled",
  "ambientImageCycleSeconds",
  "ambientImagePresentationMode",
  "ambientImageLayoutMode",
  "ambientImagePresetPlacement",
  "ambientImagePresetSize",
  "ambientImageGlowEnabled",
  "ambientImageGlowColor",
  "ambientImageGlowOpacity",
  "showSidebarSearch",
  "showSidebarMascot",
  "showSidebarAttribution",
  "brandWordmarkPrefix",
  "sidebarBrandImage",
  "sidebarStarSpeed",
  "workflowObservatoryEnabled",
  "workflowStallWarningSeconds",
  "providerUsageWidgetEnabled",
  "providerUsagePollMinutes",
  "ambianceEnabled",
  "ambianceEffect",
  "ambianceIntensity",
  "ambianceReactMode",
  "ambianceSurfaceSidebar",
  "ambianceSurfaceThread",
  "ambianceSurfaceComposer",
  "ambianceColor",
  "themeAccentColor",
  "appAccentColor",
  "defaultEditor",
  "powerSaveBlockerMode",
  "sidebarProjectGroupingMode",
  "sidebarProjectSortOrder",
  "sidebarThreadSortOrder",
  "sidebarThreadPreviewCount",
  "timestampFormat",
  "chatCopyFormat",
] as const satisfies ReadonlyArray<keyof ClientSettings>;

export type SettingsProfileClientKey = (typeof SETTINGS_PROFILE_CLIENT_KEYS)[number];
export type SettingsProfileClientSettings = Partial<Pick<ClientSettings, SettingsProfileClientKey>>;

export interface SettingsProfilePayload {
  readonly theme: SettingsProfileTheme;
  readonly clientSettings: SettingsProfileClientSettings;
}

export interface SettingsProfile {
  readonly id: string;
  readonly name: string;
  readonly theme: SettingsProfileTheme;
  readonly clientSettings: SettingsProfileClientSettings;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SettingsProfileLibrarySnapshot {
  readonly activeProfileId: string | null;
  readonly profiles: readonly SettingsProfile[];
}

export interface SettingsProfileMutationResult {
  readonly profile: SettingsProfile;
  readonly persisted: boolean;
  readonly replaced: boolean;
}

export interface SettingsProfileLibraryStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export interface SettingsProfileLibraryStore {
  readonly getSnapshot: () => SettingsProfileLibrarySnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly resolve: (profileId: string) => SettingsProfile | null;
  readonly upsert: (name: string, payload: SettingsProfilePayload) => SettingsProfileMutationResult;
  readonly updateActive: (payload: SettingsProfilePayload) => SettingsProfileMutationResult;
  readonly rename: (profileId: string, name: string) => SettingsProfileMutationResult;
  readonly activate: (profileId: string | null) => boolean;
  readonly remove: (profileId: string) => boolean;
  /** Re-read the current document after another tab or window changes local storage. */
  readonly refreshFromStorage: () => void;
  /** @internal Test-only reset for isolated browser lifecycle coverage. */
  readonly resetForTests: (clearStorage?: boolean) => void;
}

export class SettingsProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsProfileError";
  }
}

interface PersistedSettingsProfile {
  readonly name: string;
  readonly theme: SettingsProfileTheme;
  readonly clientSettings: SettingsProfileClientSettings;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function resolveStorage(): SettingsProfileLibraryStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizedName(value: string): string {
  const canonical = value.normalize("NFKC");
  const containsForbiddenCharacter = Array.from(canonical).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const isWhitespace = /\s/u.test(character);
    return (
      (!isWhitespace && (codePoint <= 0x1f || codePoint === 0x7f)) ||
      /\p{Cf}|\p{Zl}|\p{Zp}/u.test(character) ||
      character === "/" ||
      character === "\\"
    );
  });
  const name = canonical.trim().replace(/\s+/gu, " ");
  if (
    name.length === 0 ||
    name.length > SETTINGS_PROFILE_MAX_NAME_LENGTH ||
    containsForbiddenCharacter
  ) {
    throw new SettingsProfileError(
      `Use a profile name with 1 to ${SETTINGS_PROFILE_MAX_NAME_LENGTH} printable characters.`,
    );
  }
  return name;
}

function profileNameKey(name: string): string {
  return normalizedName(name).toLocaleLowerCase("en-US");
}

function profileIdFromName(name: string): string {
  return `profile:${encodeURIComponent(profileNameKey(name))}`;
}

function isTheme(value: unknown): value is SettingsProfileTheme {
  return value === "light" || value === "dark" || value === "system";
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function decodeClientSetting<Key extends SettingsProfileClientKey>(
  key: Key,
  value: unknown,
): ClientSettings[Key] | undefined {
  try {
    const field = ClientSettingsSchema.fields[key];
    return Schema.decodeUnknownSync(field)(value) as ClientSettings[Key];
  } catch {
    return undefined;
  }
}

/**
 * Copy only allowlisted, schema-valid fields out of an untrusted persisted object.
 * Unknown and malformed fields are dropped independently so one forward field does
 * not make every compatible preference in the profile unusable.
 */
export function sanitizeSettingsProfileClientSettings(
  input: unknown,
): SettingsProfileClientSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const record = input as Record<string, unknown>;
  const result: Partial<Record<SettingsProfileClientKey, unknown>> = {};
  for (const key of SETTINGS_PROFILE_CLIENT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = decodeClientSetting(key, record[key]);
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as SettingsProfileClientSettings;
}

export function captureSettingsProfilePayload(
  settings: Pick<UnifiedSettings, SettingsProfileClientKey>,
  theme: SettingsProfileTheme,
): SettingsProfilePayload {
  if (!isTheme(theme)) {
    throw new SettingsProfileError("Choose a valid light, dark, or system theme.");
  }
  return {
    theme,
    clientSettings: sanitizeSettingsProfileClientSettings(settings),
  };
}

export function settingsProfileMatches(
  profile: SettingsProfile,
  payload: SettingsProfilePayload,
): boolean {
  if (profile.theme !== payload.theme) return false;
  for (const key of SETTINGS_PROFILE_CLIENT_KEYS) {
    const profileHasKey = Object.prototype.hasOwnProperty.call(profile.clientSettings, key);
    const payloadHasKey = Object.prototype.hasOwnProperty.call(payload.clientSettings, key);
    if (profileHasKey !== payloadHasKey) return false;
    if (
      profileHasKey &&
      JSON.stringify(profile.clientSettings[key]) !== JSON.stringify(payload.clientSettings[key])
    ) {
      return false;
    }
  }
  return true;
}

function parsePersistedProfiles(raw: string | null): SettingsProfileLibrarySnapshot {
  if (
    raw === null ||
    new TextEncoder().encode(raw).byteLength > SETTINGS_PROFILE_MAX_STORAGE_BYTES
  ) {
    return { activeProfileId: null, profiles: [] };
  }
  try {
    const decoded = JSON.parse(raw) as {
      readonly version?: unknown;
      readonly activeProfileId?: unknown;
      readonly profiles?: unknown;
    };
    if (decoded.version !== SETTINGS_PROFILE_LIBRARY_VERSION || !Array.isArray(decoded.profiles)) {
      return { activeProfileId: null, profiles: [] };
    }

    const profiles: SettingsProfile[] = [];
    const seenIds = new Set<string>();
    for (const candidate of decoded.profiles) {
      if (profiles.length >= SETTINGS_PROFILE_MAX_COUNT) break;
      if (typeof candidate !== "object" || candidate === null) continue;
      const record = candidate as {
        readonly name?: unknown;
        readonly theme?: unknown;
        readonly clientSettings?: unknown;
        readonly createdAt?: unknown;
        readonly updatedAt?: unknown;
      };
      if (typeof record.name !== "string" || !isTheme(record.theme)) continue;
      let name: string;
      try {
        name = normalizedName(record.name);
      } catch {
        continue;
      }
      const id = profileIdFromName(name);
      if (seenIds.has(id)) continue;
      const now = new Date().toISOString();
      const createdAt = isIsoDate(record.createdAt) ? record.createdAt : now;
      const updatedAt = isIsoDate(record.updatedAt) ? record.updatedAt : createdAt;
      seenIds.add(id);
      profiles.push({
        id,
        name,
        theme: record.theme,
        clientSettings: sanitizeSettingsProfileClientSettings(record.clientSettings),
        createdAt,
        updatedAt,
      });
    }
    const activeProfileId =
      typeof decoded.activeProfileId === "string" && seenIds.has(decoded.activeProfileId)
        ? decoded.activeProfileId
        : null;
    return { activeProfileId, profiles };
  } catch {
    return { activeProfileId: null, profiles: [] };
  }
}

function toPersistedProfile(profile: SettingsProfile): PersistedSettingsProfile {
  return {
    name: profile.name,
    theme: profile.theme,
    clientSettings: profile.clientSettings,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

export function createSettingsProfileLibraryStore(
  storage: SettingsProfileLibraryStorage | null = resolveStorage(),
): SettingsProfileLibraryStore {
  const readStorageDocument = ():
    | { readonly ok: true; readonly raw: string | null }
    | {
        readonly ok: false;
      } => {
    try {
      return {
        ok: true,
        raw: storage?.getItem(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY) ?? null,
      };
    } catch {
      return { ok: false };
    }
  };
  const initialDocument = readStorageDocument();
  let lastObservedStorageDocument = initialDocument.ok ? initialDocument.raw : null;
  let snapshot: SettingsProfileLibrarySnapshot = initialDocument.ok
    ? parsePersistedProfiles(initialDocument.raw)
    : { activeProfileId: null, profiles: [] };
  const listeners = new Set<() => void>();
  const emit = (next: SettingsProfileLibrarySnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const persist = (next: SettingsProfileLibrarySnapshot): boolean => {
    if (storage === null) return false;
    try {
      const serialized = JSON.stringify({
        version: SETTINGS_PROFILE_LIBRARY_VERSION,
        activeProfileId: next.activeProfileId,
        profiles: next.profiles.map(toPersistedProfile),
      });
      if (new TextEncoder().encode(serialized).byteLength > SETTINGS_PROFILE_MAX_STORAGE_BYTES) {
        return false;
      }
      storage.setItem(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY, serialized);
      lastObservedStorageDocument = serialized;
      return true;
    } catch {
      return false;
    }
  };
  const replace = (next: SettingsProfileLibrarySnapshot): boolean => {
    const persisted = persist(next);
    emit(next);
    return persisted;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resolve: (profileId) => snapshot.profiles.find((profile) => profile.id === profileId) ?? null,
    upsert: (nameInput, payload) => {
      const name = normalizedName(nameInput);
      if (!isTheme(payload.theme)) {
        throw new SettingsProfileError("Choose a valid light, dark, or system theme.");
      }
      const id = profileIdFromName(name);
      const existing = snapshot.profiles.find((profile) => profile.id === id);
      if (!existing && snapshot.profiles.length >= SETTINGS_PROFILE_MAX_COUNT) {
        throw new SettingsProfileError(
          `The local profile library is limited to ${SETTINGS_PROFILE_MAX_COUNT} profiles.`,
        );
      }
      const now = new Date().toISOString();
      const profile: SettingsProfile = {
        id,
        name,
        theme: payload.theme,
        clientSettings: sanitizeSettingsProfileClientSettings(payload.clientSettings),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const profiles = existing
        ? snapshot.profiles.map((candidate) => (candidate.id === id ? profile : candidate))
        : [...snapshot.profiles, profile];
      const persisted = replace({ activeProfileId: id, profiles });
      return { profile, persisted, replaced: existing !== undefined };
    },
    updateActive: (payload) => {
      if (!isTheme(payload.theme)) {
        throw new SettingsProfileError("Choose a valid light, dark, or system theme.");
      }
      const active = snapshot.activeProfileId
        ? snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId)
        : undefined;
      if (!active) {
        throw new SettingsProfileError("Choose an active profile before updating it.");
      }
      const profile: SettingsProfile = {
        ...active,
        theme: payload.theme,
        clientSettings: sanitizeSettingsProfileClientSettings(payload.clientSettings),
        updatedAt: new Date().toISOString(),
      };
      const profiles = snapshot.profiles.map((candidate) =>
        candidate.id === active.id ? profile : candidate,
      );
      const persisted = replace({ activeProfileId: active.id, profiles });
      return { profile, persisted, replaced: true };
    },
    rename: (profileId, nameInput) => {
      const active = snapshot.profiles.find((profile) => profile.id === profileId);
      if (!active) throw new SettingsProfileError("That settings profile no longer exists.");
      const name = normalizedName(nameInput);
      const id = profileIdFromName(name);
      const collision = snapshot.profiles.some(
        (profile) => profile.id === id && profile.id !== profileId,
      );
      if (collision) {
        throw new SettingsProfileError(`A profile named “${name}” already exists.`);
      }
      const profile: SettingsProfile = {
        ...active,
        id,
        name,
        updatedAt: new Date().toISOString(),
      };
      const profiles = snapshot.profiles.map((candidate) =>
        candidate.id === profileId ? profile : candidate,
      );
      const activeProfileId =
        snapshot.activeProfileId === profileId ? id : snapshot.activeProfileId;
      const persisted = replace({ activeProfileId, profiles });
      return { profile, persisted, replaced: true };
    },
    activate: (profileId) => {
      if (profileId !== null && !snapshot.profiles.some((profile) => profile.id === profileId)) {
        return false;
      }
      // Retry persistence even when the in-memory marker already matches.
      // A prior quota/security failure may have left a useful session-only
      // selection that still needs to become durable.
      if (snapshot.activeProfileId === profileId) return persist(snapshot);
      return replace({ ...snapshot, activeProfileId: profileId });
    },
    remove: (profileId) => {
      if (!snapshot.profiles.some((profile) => profile.id === profileId)) return false;
      const profiles = snapshot.profiles.filter((profile) => profile.id !== profileId);
      return replace({
        activeProfileId: snapshot.activeProfileId === profileId ? null : snapshot.activeProfileId,
        profiles,
      });
    },
    refreshFromStorage: () => {
      const nextDocument = readStorageDocument();
      if (!nextDocument.ok || nextDocument.raw === lastObservedStorageDocument) return;
      lastObservedStorageDocument = nextDocument.raw;
      emit(parsePersistedProfiles(nextDocument.raw));
    },
    resetForTests: (clearStorage = true) => {
      if (clearStorage && storage !== null) {
        try {
          storage.removeItem(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY);
          lastObservedStorageDocument = null;
        } catch {
          // The in-memory reset remains useful when storage is unavailable.
        }
      }
      emit({ activeProfileId: null, profiles: [] });
    },
  };
}

export const settingsProfileLibraryStore = createSettingsProfileLibraryStore();

export function useSettingsProfileLibrary(): SettingsProfileLibrarySnapshot {
  const snapshot = useSyncExternalStore(
    settingsProfileLibraryStore.subscribe,
    settingsProfileLibraryStore.getSnapshot,
    settingsProfileLibraryStore.getSnapshot,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const refreshFromOtherWindow = (event: StorageEvent) => {
      if (event.key === SETTINGS_PROFILE_LIBRARY_STORAGE_KEY || event.key === null) {
        // Re-read current storage instead of trusting event.newValue. Another
        // local write may have won while this queued event was waiting.
        settingsProfileLibraryStore.refreshFromStorage();
      }
    };
    window.addEventListener("storage", refreshFromOtherWindow);
    settingsProfileLibraryStore.refreshFromStorage();
    return () => window.removeEventListener("storage", refreshFromOtherWindow);
  }, []);
  return snapshot;
}
