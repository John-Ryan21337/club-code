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
export const SETTINGS_PROFILE_LIBRARY_MUTATION_LOCK_NAME =
  "cafe-code:settings-profile-library:v1:mutation";
const SETTINGS_PROFILE_MAX_CANDIDATES = SETTINGS_PROFILE_MAX_COUNT * 8;
const SETTINGS_PROFILE_MAX_SCALAR_STRING_LENGTH = 4_096;

export type SettingsProfileTheme = "light" | "dark" | "system";

/**
 * Settings profiles are local presentation presets, not server snapshots.
 *
 * This exhaustive policy is a security boundary. Every ClientSettings field must be classified,
 * so adding a field to the shared schema fails typecheck until profiles deliberately include or
 * exclude it. Include renderer-only appearance, layout, theme-adjacent, and usability preferences.
 * Exclude fields that carry identity/path/asset data or whose application activates external
 * media, provider, native-machine, server, or exact-thread execution behavior.
 *
 * Add compatible client preferences deliberately in a later document version or as an
 * optional field in this version. Older profiles patch only the keys they actually contain,
 * so a newly allowlisted preference is never reset just because an older profile is loaded.
 *
 * The current release lineage also contains Mobile presentation, world-clock, weather, and
 * cinema-overlay settings that are not yet present in this parent schema. When those fields are
 * integrated, this Record intentionally fails closed: Mobile/clock style and locations plus the
 * renderer-only cinema overlay can be included after bounded decoding is tested; weather fetch
 * activation must remain excluded.
 */
export type SettingsProfileClientFieldPolicy =
  | "include"
  | "client-bookkeeping"
  | "external-operation"
  | "external-media-activation"
  | "local-asset-reference"
  | "provider-operation"
  | "execution-policy"
  | "exact-thread-authority"
  | "provider-model-state"
  | "native-machine-control"
  | "project-specific";

export const SETTINGS_PROFILE_CLIENT_FIELD_POLICY = {
  autoOpenPlanSidebar: "include",
  onboardingCompleted: "client-bookkeeping",
  dismissedFirstRunHints: "client-bookkeeping",
  // Web notification activation owns permission/subscription side effects in its settings
  // controller. A raw profile patch would make the boolean disagree with browser push state.
  notificationsEnabled: "external-operation",
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
  fallingEffectsEnabled: "include",
  fallingEffectKind: "include",
  fallingEffectColor: "include",
  fallingEffectMatrixColorMode: "include",
  fallingEffectMatrixColorCycleSpeed: "include",
  fallingEffectOpacity: "include",
  fallingEffectSpeed: "include",
  fallingEffectDensity: "include",
  fallingEffectJapaneseRatio: "include",
  fallingEffect2chEnriched: "include",
  fallingEffectLiveWorkVocabulary: "include",
  fallingEffectActivityLinks: "include",
  fallingEffectActivityLinkNetworkEnabled: "include",
  fallingEffectActivityLinkDatabaseEnabled: "include",
  fallingEffectActivityLinkBuildEnabled: "include",
  fallingEffectActivityLinkAgentEnabled: "include",
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
  ambianceEnabled: "include",
  ambianceEffect: "include",
  ambianceIntensity: "include",
  ambianceReactMode: "include",
  ambianceSurfaceSidebar: "include",
  ambianceSurfaceThread: "include",
  ambianceSurfaceComposer: "include",
  ambianceColor: "include",
  workflowObservatoryEnabled: "include",
  workflowStallWarningSeconds: "include",
  providerUsageWidgetEnabled: "provider-operation",
  providerUsagePollMinutes: "provider-operation",
  modelPacingEnabled: "execution-policy",
  modelPacingReservePercent: "execution-policy",
  autoNudgeMode: "exact-thread-authority",
  autoNudgeBackgroundContinuation: "exact-thread-authority",
  autoNudgeMaxRounds: "exact-thread-authority",
  themeAccentColor: "include",
  appAccentColor: "include",
  // Installed editors and their launch capability differ by host.
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

export interface SettingsProfileMutationLock {
  readonly request: <Value>(name: string, callback: () => Value) => Promise<Value>;
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
  if (typeof value !== "string" || value.length > SETTINGS_PROFILE_MAX_NAME_LENGTH * 4) {
    throw new SettingsProfileError(
      `Use a profile name with 1 to ${SETTINGS_PROFILE_MAX_NAME_LENGTH} printable characters.`,
    );
  }
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

const MISSING_DATA_PROPERTY = Symbol("missing-data-property");

function readOwnDataProperty(
  input: object,
  key: PropertyKey,
): unknown | typeof MISSING_DATA_PROPERTY {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    return descriptor !== undefined && "value" in descriptor
      ? descriptor.value
      : MISSING_DATA_PROPERTY;
  } catch {
    return MISSING_DATA_PROPERTY;
  }
}

function decodeClientSetting<Key extends SettingsProfileClientKey>(
  key: Key,
  value: unknown,
): ClientSettings[Key] | undefined {
  if (
    (typeof value !== "boolean" && typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.length > SETTINGS_PROFILE_MAX_SCALAR_STRING_LENGTH)
  ) {
    return undefined;
  }
  try {
    const field = ClientSettingsSchema.fields[key];
    const decoded = Schema.decodeUnknownSync(field)(value) as ClientSettings[Key];
    return typeof decoded === "boolean" ||
      typeof decoded === "number" ||
      (typeof decoded === "string" && decoded.length <= SETTINGS_PROFILE_MAX_SCALAR_STRING_LENGTH)
      ? decoded
      : undefined;
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
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return Object.freeze({});
  }
  const record = input as Record<string, unknown>;
  const result: Partial<Record<SettingsProfileClientKey, unknown>> = {};
  for (const key of SETTINGS_PROFILE_CLIENT_KEYS) {
    const value = readOwnDataProperty(record, key);
    // JSON data properties are safe to inspect. Reject inherited properties and
    // accessors so profile capture/sanitization never executes caller-owned code.
    if (value === MISSING_DATA_PROPERTY) continue;
    const decoded = decodeClientSetting(key, value);
    if (decoded !== undefined) {
      result[key] = decoded;
    }
  }
  return Object.freeze(result) as SettingsProfileClientSettings;
}

function sanitizeSettingsProfilePayload(input: unknown): SettingsProfilePayload {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new SettingsProfileError("Choose valid settings before saving this profile.");
  }
  const theme = readOwnDataProperty(input, "theme");
  const clientSettings = readOwnDataProperty(input, "clientSettings");
  if (!isTheme(theme) || clientSettings === MISSING_DATA_PROPERTY) {
    throw new SettingsProfileError("Choose valid settings before saving this profile.");
  }
  return Object.freeze({
    theme,
    clientSettings: sanitizeSettingsProfileClientSettings(clientSettings),
  });
}

export function captureSettingsProfilePayload(
  settings: Pick<UnifiedSettings, SettingsProfileClientKey>,
  theme: SettingsProfileTheme,
): SettingsProfilePayload {
  if (!isTheme(theme)) {
    throw new SettingsProfileError("Choose a valid light, dark, or system theme.");
  }
  return Object.freeze({
    theme,
    clientSettings: sanitizeSettingsProfileClientSettings(settings),
  });
}

export function settingsProfileMatches(
  profile: SettingsProfile,
  payload: SettingsProfilePayload,
): boolean {
  const profileTheme = readOwnDataProperty(profile, "theme");
  const payloadTheme = readOwnDataProperty(payload, "theme");
  const profileSettings = readOwnDataProperty(profile, "clientSettings");
  const payloadSettings = readOwnDataProperty(payload, "clientSettings");
  if (
    !isTheme(profileTheme) ||
    !isTheme(payloadTheme) ||
    profileTheme !== payloadTheme ||
    typeof profileSettings !== "object" ||
    profileSettings === null ||
    Array.isArray(profileSettings) ||
    typeof payloadSettings !== "object" ||
    payloadSettings === null ||
    Array.isArray(payloadSettings)
  ) {
    return false;
  }
  for (const key of SETTINGS_PROFILE_CLIENT_KEYS) {
    const profileValue = readOwnDataProperty(profileSettings, key);
    const payloadValue = readOwnDataProperty(payloadSettings, key);
    if (profileValue === MISSING_DATA_PROPERTY || payloadValue === MISSING_DATA_PROPERTY) {
      if (profileValue !== payloadValue) return false;
      continue;
    }
    if (JSON.stringify(profileValue) !== JSON.stringify(payloadValue)) {
      return false;
    }
  }
  return true;
}

function freezeSettingsProfile(profile: SettingsProfile): SettingsProfile {
  return Object.freeze({
    ...profile,
    clientSettings: Object.freeze({ ...profile.clientSettings }),
  });
}

function freezeSettingsProfileSnapshot(
  snapshot: SettingsProfileLibrarySnapshot,
): SettingsProfileLibrarySnapshot {
  return Object.freeze({
    activeProfileId: snapshot.activeProfileId,
    profiles: Object.freeze(snapshot.profiles.map(freezeSettingsProfile)),
  });
}

function parsePersistedProfiles(raw: string | null): SettingsProfileLibrarySnapshot {
  if (
    raw === null ||
    new TextEncoder().encode(raw).byteLength > SETTINGS_PROFILE_MAX_STORAGE_BYTES
  ) {
    return freezeSettingsProfileSnapshot({ activeProfileId: null, profiles: [] });
  }
  try {
    const decoded = JSON.parse(raw) as {
      readonly version?: unknown;
      readonly activeProfileId?: unknown;
      readonly profiles?: unknown;
    };
    if (decoded.version !== SETTINGS_PROFILE_LIBRARY_VERSION || !Array.isArray(decoded.profiles)) {
      return freezeSettingsProfileSnapshot({ activeProfileId: null, profiles: [] });
    }

    const profiles: SettingsProfile[] = [];
    const seenIds = new Set<string>();
    for (const candidate of decoded.profiles.slice(0, SETTINGS_PROFILE_MAX_CANDIDATES)) {
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
    return freezeSettingsProfileSnapshot({ activeProfileId, profiles });
  } catch {
    return freezeSettingsProfileSnapshot({ activeProfileId: null, profiles: [] });
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
    : freezeSettingsProfileSnapshot({ activeProfileId: null, profiles: [] });
  const listeners = new Set<() => void>();
  const emit = (next: SettingsProfileLibrarySnapshot) => {
    snapshot = freezeSettingsProfileSnapshot(next);
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
      const sanitizedPayload = sanitizeSettingsProfilePayload(payload);
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
        theme: sanitizedPayload.theme,
        clientSettings: sanitizedPayload.clientSettings,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const profiles = existing
        ? snapshot.profiles.map((candidate) => (candidate.id === id ? profile : candidate))
        : [...snapshot.profiles, profile];
      const persisted = replace({ activeProfileId: id, profiles });
      return {
        profile:
          snapshot.profiles.find((candidate) => candidate.id === id) ??
          freezeSettingsProfile(profile),
        persisted,
        replaced: existing !== undefined,
      };
    },
    updateActive: (payload) => {
      const sanitizedPayload = sanitizeSettingsProfilePayload(payload);
      const active = snapshot.activeProfileId
        ? snapshot.profiles.find((profile) => profile.id === snapshot.activeProfileId)
        : undefined;
      if (!active) {
        throw new SettingsProfileError("Choose an active profile before updating it.");
      }
      const profile: SettingsProfile = {
        ...active,
        theme: sanitizedPayload.theme,
        clientSettings: sanitizedPayload.clientSettings,
        updatedAt: new Date().toISOString(),
      };
      const profiles = snapshot.profiles.map((candidate) =>
        candidate.id === active.id ? profile : candidate,
      );
      const persisted = replace({ activeProfileId: active.id, profiles });
      return {
        profile:
          snapshot.profiles.find((candidate) => candidate.id === active.id) ??
          freezeSettingsProfile(profile),
        persisted,
        replaced: true,
      };
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

function resolveSettingsProfileMutationLock(): SettingsProfileMutationLock | null {
  if (typeof navigator === "undefined") return null;
  try {
    const locks = navigator.locks;
    if (!locks || typeof locks.request !== "function") return null;
    return {
      request: <Value>(name: string, callback: () => Value): Promise<Value> =>
        locks.request<Value>(name, () => callback()),
    };
  } catch {
    return null;
  }
}

/**
 * Serialize profile-library mutations across same-origin desktop/browser windows.
 *
 * A storage event is asynchronous, so relying on it alone lets two windows mutate stale
 * snapshots and makes the later write erase the earlier one. Modern Electron/Chromium and
 * secure browser contexts expose Web Locks; inside that lock, always re-read storage before
 * calculating the mutation. Older browsers still get the refresh-before-write repair, while
 * localStorage's atomic setItem keeps each individual document intact.
 */
export async function mutateSettingsProfileLibrary<Value>(
  store: SettingsProfileLibraryStore,
  mutation: () => Value,
  lock: SettingsProfileMutationLock | null = resolveSettingsProfileMutationLock(),
): Promise<Value> {
  const applyLatest = () => {
    store.refreshFromStorage();
    return mutation();
  };
  if (lock === null) return applyLatest();
  return lock.request(SETTINGS_PROFILE_LIBRARY_MUTATION_LOCK_NAME, applyLatest);
}

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
