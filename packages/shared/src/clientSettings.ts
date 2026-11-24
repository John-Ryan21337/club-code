import {
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  type ClientSettingsPatch,
} from "@cafecode/contracts";
import * as Schema from "effect/Schema";

/** Recover each persisted preference independently. Never reset a valid neighboring field. */
export function recoverClientSettings(input: Record<string, unknown>): {
  settings: ClientSettings;
  invalidKeys: string[];
} {
  const settings: Record<string, unknown> = { ...DEFAULT_CLIENT_SETTINGS };
  const invalidKeys: string[] = [];
  for (const key of Object.keys(ClientSettingsSchema.fields) as Array<keyof ClientSettings>) {
    if (!Object.hasOwn(input, key)) continue;
    try {
      settings[key] = Schema.decodeUnknownSync(ClientSettingsSchema.fields[key])(input[key]);
    } catch {
      invalidKeys.push(key);
    }
  }
  return { settings: settings as ClientSettings, invalidKeys };
}

/**
 * Client settings patches are field-level preference replacements. Nested maps
 * such as model preferences are small and intentionally replaced as a whole so
 * every connected client observes the same canonical value.
 */
export function applyClientSettingsPatch(
  current: ClientSettings,
  patch: ClientSettingsPatch,
): ClientSettings {
  return {
    ...current,
    ...patch,
  };
}
