import { ServerSettings, DesktopWindowOpacityPreferenceSchema } from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { migrateAmbientMediaGeometryDocument } from "./ambientMediaGeometryStorage";
import { WorldClockPanelGeometrySchema } from "./worldClockPanelGeometry";

const geometry = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
});
const localSchemas = {
  chat_thread_sidebar_width: Schema.Finite,
  chat_diff_sidebar_width: Schema.Finite,
  "cafe-code:provider-usage-height:v1": Schema.Finite,
  "club-code:world-clock-panel:v1": WorldClockPanelGeometrySchema,
  "club-code:project-telemetry-panel:v1": geometry,
  "club-code:atmosphere-console:v1": Schema.Struct({
    open: Schema.Boolean,
    anchor: Schema.Literals(["bottom-left", "bottom-right", "top-left", "top-right", "custom"]),
    lmStudioEnabled: Schema.Boolean,
    providerMode: Schema.optionalKey(
      Schema.Literals(["local", "lm-studio", "codex", "claudeAgent"]),
    ),
    providerInstanceId: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))),
    providerModel: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(256))),
    geometry,
  }),
};
export const PROFILE_LOCAL_KEYS = [
  ...Object.keys(localSchemas),
  "cafe-code:ambient-media-geometry",
];
export interface SettingsProfileExtras {
  readonly localPreferences?: Readonly<Record<string, string | null>>;
  readonly serverPreferences?: Readonly<Record<string, unknown>>;
  readonly windowOpacity?: typeof DesktopWindowOpacityPreferenceSchema.Type;
}
export const PROFILE_SERVER_FIELD_POLICY = {
  enableAssistantStreaming: "include",
  automaticGitFetchInterval: "include",
  defaultThreadEnvMode: "include",
  addProjectBaseDirectory: "include",
  textGenerationModelSelection: "include",
  defaultProviderInstanceId: "include",
  usageStatsEnabled: "include",
  providers: "connection",
  providerInstances: "connection",
  observability: "connection",
} as const satisfies Record<keyof ServerSettings, "include" | "connection">;
type ProfileServerKey = {
  [K in keyof typeof PROFILE_SERVER_FIELD_POLICY]: (typeof PROFILE_SERVER_FIELD_POLICY)[K] extends "include"
    ? K
    : never;
}[keyof typeof PROFILE_SERVER_FIELD_POLICY];
const serverKeys = Object.keys(PROFILE_SERVER_FIELD_POLICY).filter(
  (key) => PROFILE_SERVER_FIELD_POLICY[key as keyof ServerSettings] === "include",
) as ProfileServerKey[];

export function sanitizeProfileExtras(input: SettingsProfileExtras): SettingsProfileExtras {
  const localPreferences: Record<string, string | null> = {};
  for (const key of PROFILE_LOCAL_KEYS) {
    const raw = input.localPreferences?.[key];
    if (raw === null) {
      localPreferences[key] = null;
      continue;
    }
    if (typeof raw !== "string" || raw.length > 65536) continue;
    try {
      const value = JSON.parse(raw);
      const decoded =
        key === "cafe-code:ambient-media-geometry"
          ? migrateAmbientMediaGeometryDocument(value)
          : Schema.decodeUnknownSync(localSchemas[key as keyof typeof localSchemas])(value);
      if (decoded !== null) localPreferences[key] = JSON.stringify(decoded);
    } catch {
      /* Keep unrelated valid preferences. */
    }
  }
  const serverPreferences: Record<string, unknown> = {};
  for (const key of serverKeys) {
    if (!Object.hasOwn(input.serverPreferences ?? {}, key)) continue;
    try {
      const value = Schema.decodeUnknownSync(ServerSettings.fields[key])(
        input.serverPreferences?.[key],
      );
      serverPreferences[key] = Schema.encodeSync(ServerSettings.fields[key])(value);
    } catch {
      /* Keep unrelated valid preferences. */
    }
  }
  let windowOpacity;
  try {
    if (input.windowOpacity)
      windowOpacity = Schema.decodeUnknownSync(DesktopWindowOpacityPreferenceSchema)(
        input.windowOpacity,
      );
  } catch {
    /* Unsupported old values are omitted. */
  }
  return {
    ...(input.localPreferences ? { localPreferences } : {}),
    ...(input.serverPreferences ? { serverPreferences } : {}),
    ...(windowOpacity ? { windowOpacity } : {}),
  };
}

export function captureProfileExtras(
  settings: object,
  storage?: Pick<Storage, "getItem">,
): SettingsProfileExtras {
  const serverPreferences: Record<string, unknown> = {};
  for (const key of serverKeys) {
    if (!Object.hasOwn(settings, key)) continue;
    const value = (settings as Record<string, unknown>)[key];
    serverPreferences[key] = Schema.encodeSync(ServerSettings.fields[key])(value as never);
  }
  const localPreferences = storage
    ? Object.fromEntries(PROFILE_LOCAL_KEYS.map((key) => [key, storage.getItem(key)]))
    : undefined;
  return sanitizeProfileExtras({
    serverPreferences,
    ...(localPreferences ? { localPreferences } : {}),
  });
}

export function decodeProfileServerPatch(extras: SettingsProfileExtras): Partial<ServerSettings> {
  const patch: Record<string, unknown> = {};
  for (const key of serverKeys) {
    if (Object.hasOwn(extras.serverPreferences ?? {}, key))
      patch[key] = Schema.decodeUnknownSync(ServerSettings.fields[key])(
        extras.serverPreferences?.[key],
      );
  }
  return patch as Partial<ServerSettings>;
}

export async function applyProfileExtras(extras: SettingsProfileExtras): Promise<void> {
  const safe = sanitizeProfileExtras(extras);
  const bridge = window.desktopBridge;
  if (safe.windowOpacity && bridge?.getWindowOpacityState && bridge.setWindowOpacityPreference) {
    const state = await bridge.getWindowOpacityState();
    if (state.supported) {
      const applied = await bridge.setWindowOpacityPreference(safe.windowOpacity);
      if (applied.reason === "persistence-failed" || applied.reason === "apply-failed")
        throw new Error("Window opacity could not be restored.");
    }
  }
  for (const [key, value] of Object.entries(safe.localPreferences ?? {})) {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
    window.dispatchEvent(new CustomEvent("cafe-code:local_storage_change", { detail: { key } }));
  }
  window.dispatchEvent(new Event("cafe-code:profile-layout-restored"));
}
