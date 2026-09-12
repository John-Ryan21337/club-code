import type { ClientSettings, ClientSettingsPatch } from "@cafecode/contracts/settings";

/** Language belongs to this renderer and must not change another connected client's language. */
export function withoutRendererLocalClientSettings(
  settings: ClientSettingsPatch,
): ClientSettingsPatch {
  const { uiLanguage: _uiLanguage, ...sharedSettings } = settings;
  return sharedSettings;
}

export function withRendererLocalClientSettings(
  sharedSettings: ClientSettings,
  localSettings: Pick<ClientSettings, "uiLanguage">,
): ClientSettings {
  return { ...sharedSettings, uiLanguage: localSettings.uiLanguage };
}
