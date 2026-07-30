import {
  ClientSettingsSchema,
  type ClientSettings,
  type UnifiedSettings,
} from "@cafecode/contracts/settings";
import * as Schema from "effect/Schema";
import { useEffect, useSyncExternalStore } from "react";

export const SETTINGS_PROFILE_LIBRARY_STORAGE_KEY = "cafe-code:settings-profile-library:v1";
export const SETTINGS_PROFILE_LIBRARY_VERSION = 3;
const LEGACY_SETTINGS_PROFILE_LIBRARY_VERSIONS = new Set([1, 2]);
export const SETTINGS_PROFILE_MAX_COUNT = 32;
export const SETTINGS_PROFILE_MAX_NAME_LENGTH = 64;
export const SETTINGS_PROFILE_MAX_STORAGE_BYTES = 512 * 1024;

export type SettingsProfileTheme = "light" | "dark" | "system";

/**
 * Settings profiles are local presentation presets, not server snapshots.
 *
 * This exhaustive policy is a security boundary. Every ClientSettings field must be classified,
 * so adding a field to the shared schema fails typecheck until profiles deliberately include or
 * exclude it. Include renderer-only appearance, layout, theme-adjacent, and usability preferences.
 * Exclude fields that carry identity, path, asset, consent, or authority data, and fields whose
 * application activates external media, provider, native-machine, or exact-thread behavior.
 *
 * Add compatible client preferences deliberately in a later document version or as an
 * optional field in this version. Older profiles patch only the keys they actually contain,
 * so a newly allowlisted preference is never reset just because an older profile is loaded.
 */
export type SettingsProfileClientFieldPolicy =
  | "include"
  | "client-bookkeeping"
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
  onboardingCompleted: "client-bookkeeping",
  dismissedFirstRunHints: "client-bookkeeping",
  // Notification permission/subscription state is owned by its settings controller.
  notificationsEnabled: "consent",
  completionAlertSoundEnabled: "event-output-activation",
  completionAlertSpeechEnabled: "event-output-activation",
  completionAlertLanguage: "include",
  completionAlertEnglishVoiceGender: "include",
  completionAlertJapaneseVoiceGender: "include",
  completionAlertDualStereoOrder: "include",
  // A profile must not weaken or silently change destructive-action confirmations.
  confirmThreadArchive: "destructive-action-safety",
  confirmThreadDelete: "destructive-action-safety",
  dismissedProviderUpdateNotificationKeys: "client-bookkeeping",
  diffIgnoreWhitespace: "include",
  diffWordWrap: "include",
  continueBackgroundAnimations: "include",
  mobileOptimizedPresentation: "include",
  worldClockEnabled: "include",
  worldClockStyle: "include",
  worldClockLocationIds: "include",
  // Weather is a separate network/approximate-location consent.
  worldClockWeatherEnabled: "consent",
  fallingEffectsEnabled: "ambient-activation",
  atmosphereConsoleEnabled: "ambient-activation",
  fallingEffectsOverCinemaEnabled: "ambient-activation",
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
  fallingEffectJapaneseRatio: "include",
  fallingEffect2chEnriched: "include",
  // These switches admit live provider/thread activity into an ambient renderer.
  // Keep that choice local and explicit instead of carrying it in a layout profile.
  fallingEffectLiveWorkVocabulary: "live-operational-input",
  fallingEffectActivityLinks: "live-operational-input",
  fallingEffectActivityLinkNetworkEnabled: "live-operational-input",
  fallingEffectActivityLinkDatabaseEnabled: "live-operational-input",
  fallingEffectActivityLinkBuildEnabled: "live-operational-input",
  fallingEffectActivityLinkAgentEnabled: "live-operational-input",
  fallingEffectActivityLinkColorMode: "include",
  fallingEffectActivityLinkRetentionSeconds: "include",
  ambientVideoEnabled: "external-media-activation",
  ambientVideoSource: "external-media-activation",
  ambientVideoLayoutMode: "include",
  ambientVideoPresetPlacement: "include",
  ambientVideoPresetSize: "include",
  ambientVideoPresentationMode: "include",
  ambientVideoGlowEnabled: "include",
  ambientVideoGlowMode: "include",
  ambientVideoGlowColor: "include",
  ambientVideoGlowOpacity: "include",
  ambientImageEnabled: "external-media-activation",
  ambientImageAsset: "local-asset-reference",
  ambientImageCycleAssets: "local-asset-reference",
  ambientImageCycleEnabled: "external-media-activation",
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
  brandWordmarkPrefix: "include",
  sidebarBrandImage: "local-asset-reference",
  sidebarBrandImageDataUrl: "local-asset-reference",
  sidebarStarSpeed: "include",
  workflowObservatoryEnabled: "include",
  workflowStallWarningSeconds: "include",
  // Enabling or polling provider usage can invoke provider/account-specific work.
  providerUsageWidgetEnabled: "provider-operation",
  providerUsagePollMinutes: "provider-operation",
  modelPacingEnabled: "execution-policy",
  modelPacingReservePercent: "execution-policy",
  // These compatibility fields cannot authorize or reconfigure exact-thread Auto Nudge.
  autoNudgeMode: "exact-thread-authority",
  autoNudgeBackgroundContinuation: "exact-thread-authority",
  autoNudgeMaxRounds: "exact-thread-authority",
  ambianceEnabled: "ambient-activation",
  ambianceEffect: "include",
  ambianceIntensity: "include",
  // This controls whether ambiance observes the current thread's live signals.
  ambianceReactMode: "live-operational-input",
  ambianceSurfaceSidebar: "include",
  ambianceSurfaceThread: "include",
  ambianceSurfaceComposer: "include",
  ambianceColor: "include",
  themeAccentColor: "include",
  appAccentColor: "include",
  defaultEditor: "native-machine-control",
  favorites: "provider-model-state",
  providerModelPreferences: "provider-model-state",
  powerSaveBlockerMode: "native-machine-control",
  sidebarProjectGroupingMode: "include",
  sidebarProjectGroupingOverrides: "project-specific",
  sidebarProjectSortOrder: "include",
  sidebarThreadSortOrder: "include",
  sidebarThreadPreviewCount: "include",
  timestampFormat: "include",
  chatCopyFormat: "include",
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
    // from smuggling authority, consent, identity, or asset fields to storage.
    clientSettings: sanitizeSettingsProfileClientSettings(profile.clientSettings),
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
    const safeNext = freezeSettingsProfileLibrarySnapshot(next);
    const persisted = persist(safeNext);
    emit(safeNext);
    return persisted;
  };

  if (parsedInitialDocument.requiresRewrite) {
    // Best-effort migration/scrub. The in-memory snapshot is safe even when
    // storage is blocked; a later mutation or activation retries persistence.
    persist(snapshot);
  }

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
      const storedProfile = snapshot.profiles.find((candidate) => candidate.id === id);
      if (!storedProfile) {
        throw new SettingsProfileError("The settings profile could not be stored in memory.");
      }
      return { profile: storedProfile, persisted, replaced: existing !== undefined };
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
      const storedProfile = snapshot.profiles.find((candidate) => candidate.id === active.id);
      if (!storedProfile) {
        throw new SettingsProfileError("The settings profile could not be stored in memory.");
      }
      return { profile: storedProfile, persisted, replaced: true };
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
      const storedProfile = snapshot.profiles.find((candidate) => candidate.id === id);
      if (!storedProfile) {
        throw new SettingsProfileError("The settings profile could not be stored in memory.");
      }
      return { profile: storedProfile, persisted, replaced: true };
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
      const parsed = parsePersistedProfiles(nextDocument.raw);
      if (parsed.requiresRewrite) {
        replace(parsed.snapshot);
      } else {
        emit(parsed.snapshot);
      }
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
