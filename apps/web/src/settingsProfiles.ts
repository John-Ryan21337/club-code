import {
  ClientSettingsSchema,
  type ClientSettings,
  type UnifiedSettings,
} from "@cafecode/contracts/settings";
import * as Schema from "effect/Schema";
import { useEffect, useSyncExternalStore } from "react";

import {
  captureProfileExtras,
  sanitizeProfileExtras,
  type SettingsProfileExtras,
} from "./settingsProfileExtras";

export const SETTINGS_PROFILE_LIBRARY_STORAGE_KEY = "cafe-code:settings-profile-library:v1";
export const SETTINGS_PROFILE_LIBRARY_VERSION = 5;
const LEGACY_SETTINGS_PROFILE_LIBRARY_VERSIONS = new Set([1, 2, 3, 4]);
export const SETTINGS_PROFILE_MAX_COUNT = 32;
export const SETTINGS_PROFILE_MAX_NAME_LENGTH = 64;
export const SETTINGS_PROFILE_MAX_STORAGE_BYTES = 2 * 1024 * 1024;

export type SettingsProfileTheme = "light" | "dark" | "system";

/**
 * Profiles capture user preferences, including feature switches. Loading a profile is an
 * explicit request to restore them. Credentials, OS permissions, bookkeeping, and
 * exact-thread execution grants remain outside this document. Every new client field
 * must be classified here. Older sparse profiles only patch the fields they contain.
 */
export type SettingsProfileClientFieldPolicy =
  | "include"
  | "client-bookkeeping"
  | "renderer-identity"
  | "consent"
  | "external-operation"
  | "external-media-activation"
  | "event-output-activation"
  | "ambient-activation"
  | "live-operational-input"
  | "local-asset-reference"
  | "provider-operation"
  | "execution-policy"
  | "exact-thread-authority"
  | "provider-model-state"
  | "native-machine-control"
  | "destructive-action-safety"
  | "project-specific";

export const SETTINGS_PROFILE_CLIENT_FIELD_POLICY = {
  autoOpenPlanSidebar: "include",
  uiLanguage: "include",
  onboardingCompleted: "client-bookkeeping",
  dismissedFirstRunHints: "client-bookkeeping",
  notificationsEnabled: "consent",
  completionAlertSoundEnabled: "include",
  completionAlertSpeechEnabled: "include",
  completionAlertLanguage: "include",
  completionAlertEnglishVoiceGender: "include",
  completionAlertJapaneseVoiceGender: "include",
  completionAlertDualStereoOrder: "include",
  confirmThreadArchive: "include",
  confirmThreadDelete: "include",
  dismissedProviderUpdateNotificationKeys: "client-bookkeeping",
  diffIgnoreWhitespace: "include",
  diffWordWrap: "include",
  continueBackgroundAnimations: "include",
  projectTelemetryHideUnavailableGraphs: "include",
  mobileOptimizedPresentation: "include",
  worldClockEnabled: "include",
  worldClockStyle: "include",
  worldClockLocationIds: "include",
  worldClockWeatherEnabled: "include",
  hexagonsBackgroundEnabled: "include",
  hexagonsBackgroundPresetJson: "include",
  ambientBackgroundManuscriptOpacity: "include",
  ambientBackgroundSidebarOpacity: "include",
  fallingEffectsEnabled: "include",
  atmosphereConsoleEnabled: "include",
  fallingEffectsOverCinemaEnabled: "include",
  hardwareLightingSyncEnabled: "include",
  hardwareLightingControllerIds: "include",
  hardwareLightingBrightness: "include",
  hardwareLightingRestoreOnDisable: "include",
  fallingEffectKind: "include",
  fallingEffectMatrixBaseFontSize: "include",
  fallingEffectColor: "include",
  fallingEffectMatrixColorMode: "include",
  fallingEffectMatrixColorCycleSpeed: "include",
  fallingEffectMatrixMotionMode: "include",
  fallingEffectMatrixWalkStartFontSize: "include",
  fallingEffectMatrixWalkEndFontSize: "include",
  fallingEffectMatrixWalkLifecyclePercent: "include",
  fallingEffectMatrixCenterWindIntensity: "include",
  fallingEffectOpacity: "include",
  fallingEffectSpeed: "include",
  fallingEffectDensity: "include",
  fallingEffectUsageReactive: "include",
  fallingEffectJapaneseRatio: "include",
  fallingEffect2chEnriched: "include",
  fallingEffectLiveWorkVocabulary: "include",
  fallingEffectActivityLinks: "include",
  fallingEffectActivityLinkNetworkEnabled: "include",
  fallingEffectActivityLinkDatabaseEnabled: "include",
  fallingEffectActivityLinkBuildEnabled: "include",
  fallingEffectActivityLinkAgentEnabled: "include",
  fallingEffectActivityLinkWorkEnabled: "include",
  fallingEffectActivityLinkColorMode: "include",
  fallingEffectActivityLinkRetentionSeconds: "include",
  ambientVideoEnabled: "include",
  ambientVideoSource: "include",
  ambientVideoLayoutMode: "include",
  ambientVideoPresetPlacement: "include",
  ambientVideoPresetSize: "include",
  ambientVideoPresentationMode: "include",
  ambientVideoGlowEnabled: "include",
  ambientVideoGlowMode: "include",
  ambientVideoGlowColor: "include",
  ambientVideoGlowOpacity: "include",
  ambientImageEnabled: "include",
  ambientImageAsset: "include",
  ambientImageCycleAssets: "include",
  ambientImageCycleEnabled: "include",
  ambientImageCycleSeconds: "include",
  ambientImagePresentationMode: "include",
  ambientImageLayoutMode: "include",
  ambientImagePresetPlacement: "include",
  ambientImagePresetSize: "include",
  ambientImageGlowEnabled: "include",
  ambientImageGlowColor: "include",
  ambientImageGlowOpacity: "include",
  showSidebarSearch: "include",
  showSidebarMascot: "include",
  showSidebarAttribution: "include",
  showComposerThreadAutomationControls: "include",
  promptSuggestionsEnabled: "include",
  brandWordmarkPrefix: "include",
  sidebarBrandImage: "include",
  sidebarBrandImageDataUrl: "include",
  sidebarStarSpeed: "include",
  workflowObservatoryEnabled: "include",
  workflowStallWarningSeconds: "include",
  providerUsageWidgetEnabled: "include",
  providerUsagePollMinutes: "include",
  modelPacingEnabled: "include",
  modelPacingReservePercent: "include",
  autoNudgeMode: "exact-thread-authority",
  autoNudgeBackgroundContinuation: "exact-thread-authority",
  autoNudgeMaxRounds: "exact-thread-authority",
  ambianceEnabled: "include",
  ambianceEffect: "include",
  ambianceIntensity: "include",
  ambianceReactMode: "include",
  ambianceSurfaceSidebar: "include",
  ambianceSurfaceThread: "include",
  ambianceSurfaceComposer: "include",
  ambianceColor: "include",
  themeAccentColor: "include",
  appAccentColor: "include",
  defaultEditor: "include",
  favorites: "include",
  providerModelPreferences: "include",
  powerSaveBlockerMode: "include",
  sidebarProjectGroupingMode: "include",
  sidebarProjectGroupingOverrides: "include",
  sidebarProjectSortOrder: "include",
  sidebarThreadSortOrder: "include",
  sidebarThreadPreviewCount: "include",
  timestampFormat: "include",
  chatCopyFormat: "include",
  agentBrowserDisabledThreadIds: "exact-thread-authority",
} as const satisfies Record<keyof ClientSettings, SettingsProfileClientFieldPolicy>;

export type SettingsProfileClientKey = {
  [Key in keyof typeof SETTINGS_PROFILE_CLIENT_FIELD_POLICY]: (typeof SETTINGS_PROFILE_CLIENT_FIELD_POLICY)[Key] extends "include"
    ? Key
    : never;
}[keyof typeof SETTINGS_PROFILE_CLIENT_FIELD_POLICY];

function includedSettingsProfileClientKeys(): readonly SettingsProfileClientKey[] {
  const included: SettingsProfileClientKey[] = [];
  for (const key of Object.keys(SETTINGS_PROFILE_CLIENT_FIELD_POLICY) as Array<
    keyof ClientSettings
  >) {
    if (SETTINGS_PROFILE_CLIENT_FIELD_POLICY[key] === "include") {
      included.push(key as SettingsProfileClientKey);
    }
  }
  return Object.freeze(included);
}

export const SETTINGS_PROFILE_CLIENT_KEYS = includedSettingsProfileClientKeys();
export type SettingsProfileClientSettings = Partial<Pick<ClientSettings, SettingsProfileClientKey>>;

export interface SettingsProfilePayload extends SettingsProfileExtras {
  readonly theme: SettingsProfileTheme;
  readonly clientSettings: SettingsProfileClientSettings;
}

export interface SettingsProfile extends SettingsProfileExtras {
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
  /** Restore the desktop copy even when the browser cache cannot be written. */
  readonly restoreFromDisk: (raw: string) => void;
  /** @internal Test-only reset for isolated browser lifecycle coverage. */
  readonly resetForTests: (clearStorage?: boolean) => void;
}

export class SettingsProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsProfileError";
  }
}

interface PersistedSettingsProfile extends SettingsProfileExtras {
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

function cloneAndFreezeProfileValue<Value>(value: Value): Value {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreezeProfileValue(entry))) as Value;
  }
  if (typeof value === "object" && value !== null) {
    const clone = Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneAndFreezeProfileValue(entry)]),
    );
    return Object.freeze(clone) as Value;
  }
  return value;
}

/**
 * Copy only allowlisted, schema-valid fields out of an untrusted persisted object.
 * Unknown and malformed fields are dropped independently so one forward field does
 * not make every compatible preference in the profile unusable.
 */
export function sanitizeSettingsProfileClientSettings(
  input: unknown,
): SettingsProfileClientSettings {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return Object.freeze({});
  }
  const record = input as Record<string, unknown>;
  const result: Partial<Record<SettingsProfileClientKey, unknown>> = {};
  for (const key of SETTINGS_PROFILE_CLIENT_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = decodeClientSetting(key, record[key]);
    if (value !== undefined) {
      result[key] = cloneAndFreezeProfileValue(value);
    }
  }
  return Object.freeze(result) as SettingsProfileClientSettings;
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
    ...captureProfileExtras(
      settings,
      typeof window === "undefined" ? undefined : (resolveStorage() ?? undefined),
    ),
  };
}

export function settingsProfileMatches(
  profile: SettingsProfile,
  payload: SettingsProfilePayload,
): boolean {
  if (profile.theme !== payload.theme) return false;
  // Sparse older profiles only compare the sections they contain.
  for (const key of ["localPreferences", "serverPreferences", "windowOpacity"] as const) {
    if (
      profile[key] !== undefined &&
      payload[key] !== undefined &&
      JSON.stringify(profile[key]) !== JSON.stringify(payload[key])
    )
      return false;
  }
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

interface ParsedSettingsProfileLibrary {
  readonly snapshot: SettingsProfileLibrarySnapshot;
  readonly requiresRewrite: boolean;
}

function emptyParsedSettingsProfileLibrary(requiresRewrite = false): ParsedSettingsProfileLibrary {
  return {
    snapshot: { activeProfileId: null, profiles: [] },
    requiresRewrite,
  };
}

function parsePersistedProfiles(raw: string | null): ParsedSettingsProfileLibrary {
  if (
    raw === null ||
    new TextEncoder().encode(raw).byteLength > SETTINGS_PROFILE_MAX_STORAGE_BYTES
  ) {
    return emptyParsedSettingsProfileLibrary();
  }
  try {
    const decoded = JSON.parse(raw) as {
      readonly version?: unknown;
      readonly activeProfileId?: unknown;
      readonly profiles?: unknown;
    };
    const supportedVersion =
      decoded.version === SETTINGS_PROFILE_LIBRARY_VERSION ||
      LEGACY_SETTINGS_PROFILE_LIBRARY_VERSIONS.has(decoded.version as number);
    if (!supportedVersion) {
      return emptyParsedSettingsProfileLibrary();
    }
    if (!Array.isArray(decoded.profiles)) return emptyParsedSettingsProfileLibrary(true);

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
        ...sanitizeProfileExtras(candidate),
        createdAt,
        updatedAt,
      });
    }
    const activeProfileId =
      typeof decoded.activeProfileId === "string" && seenIds.has(decoded.activeProfileId)
        ? decoded.activeProfileId
        : null;
    const snapshot = { activeProfileId, profiles };
    const canonicalDocument = {
      version: SETTINGS_PROFILE_LIBRARY_VERSION,
      activeProfileId,
      profiles: profiles.map(toPersistedProfile),
    };
    return {
      snapshot,
      // This also scrubs unsafe/unknown fields from a current-version document
      // instead of merely hiding them in the in-memory projection.
      requiresRewrite: JSON.stringify(decoded) !== JSON.stringify(canonicalDocument),
    };
  } catch {
    return emptyParsedSettingsProfileLibrary();
  }
}

function toPersistedProfile(profile: SettingsProfile): PersistedSettingsProfile {
  return {
    name: profile.name,
    theme: profile.theme,
    // Re-sanitize at the durable boundary even though normal mutation paths
    // already sanitize. This prevents a stale or externally mutated object
    // from smuggling authority, consent, identity, or raw local asset fields to storage.
    clientSettings: sanitizeSettingsProfileClientSettings(profile.clientSettings),
    ...cloneAndFreezeProfileValue(sanitizeProfileExtras(profile)),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function freezeSettingsProfileLibrarySnapshot(
  input: SettingsProfileLibrarySnapshot,
): SettingsProfileLibrarySnapshot {
  const profiles = input.profiles.map((profile) =>
    Object.freeze({
      ...profile,
      clientSettings: sanitizeSettingsProfileClientSettings(profile.clientSettings),
      ...cloneAndFreezeProfileValue(sanitizeProfileExtras(profile)),
    }),
  );
  return Object.freeze({
    activeProfileId: input.activeProfileId,
    profiles: Object.freeze(profiles),
  });
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
  const parsedInitialDocument = initialDocument.ok
    ? parsePersistedProfiles(initialDocument.raw)
    : emptyParsedSettingsProfileLibrary();
  let lastObservedStorageDocument = initialDocument.ok ? initialDocument.raw : null;
  let snapshot = freezeSettingsProfileLibrarySnapshot(parsedInitialDocument.snapshot);
  const listeners = new Set<() => void>();
  const emit = (next: SettingsProfileLibrarySnapshot) => {
    snapshot = freezeSettingsProfileLibrarySnapshot(next);
    for (const listener of listeners) listener();
  };
  const persist = (next: SettingsProfileLibrarySnapshot): boolean => {
    if (storage === null) return false;
    try {
      const serialized = JSON.stringify({
        version: SETTINGS_PROFILE_LIBRARY_VERSION,
        savedAt: new Date().toISOString(),
        activeProfileId: next.activeProfileId,
        profiles: next.profiles.map(toPersistedProfile),
      });
      if (new TextEncoder().encode(serialized).byteLength > SETTINGS_PROFILE_MAX_STORAGE_BYTES) {
        return false;
      }
      const previous = storage.getItem(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY);
      if (previous !== null && previous !== serialized) {
        storage.setItem(`${SETTINGS_PROFILE_LIBRARY_STORAGE_KEY}:previous`, previous);
      }
      storage.setItem(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY, serialized);
      lastObservedStorageDocument = serialized;
      return true;
    } catch {
      return false;
    }
  };
  const replace = (next: SettingsProfileLibrarySnapshot): boolean => {
    const safeNext = freezeSettingsProfileLibrarySnapshot(next);
    const persisted = persist(safeNext);
    emit(safeNext);
    return persisted;
  };

  const refreshBeforeMutation = () => {
    const document = readStorageDocument();
    if (!document.ok)
      throw new SettingsProfileError(
        "Profile storage could not be read. Try again before changing profiles.",
      );
    if (document.raw !== null) {
      let decoded;
      try {
        decoded = JSON.parse(document.raw);
      } catch {
        throw new SettingsProfileError(
          "Profile storage is damaged. The saved data has been preserved.",
        );
      }
      if (![1, 2, 3, 4, 5].includes(decoded.version) || !Array.isArray(decoded.profiles)) {
        throw new SettingsProfileError(
          "This profile library needs a compatible app version. The saved data has been preserved.",
        );
      }
    }
    if (document.raw === lastObservedStorageDocument) return;
    lastObservedStorageDocument = document.raw;
    emit(parsePersistedProfiles(document.raw).snapshot);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resolve: (profileId) => snapshot.profiles.find((profile) => profile.id === profileId) ?? null,
    upsert: (nameInput, payload) => {
      refreshBeforeMutation();
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
        ...sanitizeProfileExtras(payload),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const profiles = existing
        ? snapshot.profiles.map((candidate) => (candidate.id === id ? profile : candidate))
        : [...snapshot.profiles, profile];
      const persisted = replace({ activeProfileId: id, profiles });
      const storedProfile = snapshot.profiles.find((candidate) => candidate.id === id);
      if (!storedProfile) {
        throw new SettingsProfileError("The settings profile could not be stored in memory.");
      }
      return { profile: storedProfile, persisted, replaced: existing !== undefined };
    },
    updateActive: (payload) => {
      const expectedActiveId = snapshot.activeProfileId;
      refreshBeforeMutation();
      if (!isTheme(payload.theme)) {
        throw new SettingsProfileError("Choose a valid light, dark, or system theme.");
      }
      const active = expectedActiveId
        ? snapshot.profiles.find((profile) => profile.id === expectedActiveId)
        : undefined;
      if (!active) {
        throw new SettingsProfileError("Choose an active profile before updating it.");
      }
      const profile: SettingsProfile = {
        ...active,
        theme: payload.theme,
        clientSettings: sanitizeSettingsProfileClientSettings(payload.clientSettings),
        ...sanitizeProfileExtras(payload),
        updatedAt: new Date().toISOString(),
      };
      const profiles = snapshot.profiles.map((candidate) =>
        candidate.id === active.id ? profile : candidate,
      );
      const persisted = replace({ activeProfileId: active.id, profiles });
      const storedProfile = snapshot.profiles.find((candidate) => candidate.id === active.id);
      if (!storedProfile) {
        throw new SettingsProfileError("The settings profile could not be stored in memory.");
      }
      return { profile: storedProfile, persisted, replaced: true };
    },
    rename: (profileId, nameInput) => {
      refreshBeforeMutation();
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
      const storedProfile = snapshot.profiles.find((candidate) => candidate.id === id);
      if (!storedProfile) {
        throw new SettingsProfileError("The settings profile could not be stored in memory.");
      }
      return { profile: storedProfile, persisted, replaced: true };
    },
    activate: (profileId) => {
      refreshBeforeMutation();
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
      refreshBeforeMutation();
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
      const parsed = parsePersistedProfiles(nextDocument.raw);
      emit(parsed.snapshot);
    },
    restoreFromDisk: (raw) => {
      const current = readStorageDocument();
      lastObservedStorageDocument = current.ok ? current.raw : null;
      emit(parsePersistedProfiles(raw).snapshot);
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
    void hydrateSettingsProfileLibrary();
    settingsProfileLibraryStore.refreshFromStorage();
    return () => window.removeEventListener("storage", refreshFromOtherWindow);
  }, []);
  return snapshot;
}

let profileHydration: Promise<void> | null = null;
let profileHydrationError: string | null = null;
let profilesReady =
  typeof window === "undefined" || !window.desktopBridge?.getSettingsProfileLibrary;
const hydrationListeners = new Set<() => void>();
export function hydrateSettingsProfileLibrary(): Promise<void> {
  if (profilesReady) return Promise.resolve();
  if (profileHydration) return profileHydration;
  profileHydration = (async () => {
    const diskDocument = await window.desktopBridge?.getSettingsProfileLibrary?.();
    const storage = resolveStorage();
    const localDocument = storage?.getItem(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY) ?? null;
    const timestamp = (raw: string | null | undefined): number => {
      if (!raw) return -1;
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.profiles)) return -1;
        if (parsed.version > SETTINGS_PROFILE_LIBRARY_VERSION)
          throw new SettingsProfileError("This profile library requires a newer app version.");
        return Math.max(
          Date.parse(parsed.savedAt) || 0,
          ...parsed.profiles.map(
            (profile: { updatedAt?: string }) => Date.parse(profile.updatedAt ?? "") || 0,
          ),
        );
      } catch (error) {
        if (error instanceof SettingsProfileError) throw error;
        return -1;
      }
    };
    // A renderer save may have completed just before an interrupted disk write.
    // Keep that newer library instead of rolling it back to the older disk copy.
    const preferLocal = timestamp(localDocument) > timestamp(diskDocument);
    const document = preferLocal ? localDocument : diskDocument;
    if (document) {
      try {
        const previous = storage?.getItem(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY);
        if (previous && previous !== document)
          storage?.setItem(`${SETTINGS_PROFILE_LIBRARY_STORAGE_KEY}:previous`, previous);
        storage?.setItem(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY, document);
      } catch {
        /* The disk copy remains available when the browser cache is full. */
      }
      settingsProfileLibraryStore.restoreFromDisk(document);
      if (preferLocal) await window.desktopBridge?.setSettingsProfileLibrary?.(document);
    }
    if (!document && storage) {
      const raw = storage.getItem(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY);
      if (raw !== null) {
        const decoded = JSON.parse(raw);
        if (![1, 2, 3, 4, 5].includes(decoded.version) || !Array.isArray(decoded.profiles))
          throw new Error("The saved profile library cannot be migrated safely.");
        const snapshot = settingsProfileLibraryStore.getSnapshot();
        await window.desktopBridge?.setSettingsProfileLibrary?.(
          JSON.stringify({
            version: SETTINGS_PROFILE_LIBRARY_VERSION,
            activeProfileId: snapshot.activeProfileId,
            profiles: snapshot.profiles.map(toPersistedProfile),
          }),
        );
      }
    }
    profilesReady = true;
    profileHydrationError = null;
    for (const listener of hydrationListeners) listener();
  })().catch(() => {
    profileHydration = null;
    profileHydrationError =
      "Profile storage could not be read. Your saved files have not been changed. Restart Club Code to retry.";
    for (const listener of hydrationListeners) listener();
    console.error("Profile disk storage could not be read; saving remains disabled.");
  });
  return profileHydration;
}
export function useSettingsProfilesReady(): boolean {
  useEffect(() => {
    void hydrateSettingsProfileLibrary();
  }, []);
  return useSyncExternalStore(
    (listener) => {
      hydrationListeners.add(listener);
      return () => {
        hydrationListeners.delete(listener);
      };
    },
    () => profilesReady,
    () => false,
  );
}
export function useSettingsProfilesError(): string | null {
  return useSyncExternalStore(
    (listener) => {
      hydrationListeners.add(listener);
      return () => {
        hydrationListeners.delete(listener);
      };
    },
    () => profileHydrationError,
    () => null,
  );
}
let diskWrite: Promise<void> = Promise.resolve();
export async function flushSettingsProfileLibrary(localPersisted = true): Promise<boolean> {
  const writer =
    typeof window === "undefined" ? undefined : window.desktopBridge?.setSettingsProfileLibrary;
  if (!writer) return localPersisted;
  const snapshot = settingsProfileLibraryStore.getSnapshot();
  const raw = JSON.stringify({
    version: SETTINGS_PROFILE_LIBRARY_VERSION,
    savedAt: new Date().toISOString(),
    activeProfileId: snapshot.activeProfileId,
    profiles: snapshot.profiles.map(toPersistedProfile),
  });
  const pending = diskWrite.catch(() => {}).then(() => writer(raw));
  diskWrite = pending;
  try {
    await pending;
    return true;
  } catch {
    return false;
  }
}
