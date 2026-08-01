import type { ClientSettings, ClientSettingsPatch } from "@cafecode/contracts/settings";

export type RendererLocalClientSettingsPatch = Pick<
  ClientSettingsPatch,
  | "atmosphereConsoleEnabled"
  | "mobileOptimizedPresentation"
  | "uiLanguage"
  | "worldClockWeatherEnabled"
>;

/**
 * These preferences belong to the current browser/Desktop renderer. They must
 * never be sent to the connected environment server: doing so could force a
 * desktop into a phone layout or make another client contact a third party.
 */
export function partitionRendererLocalClientSettingsPatch(patch: ClientSettingsPatch): {
  readonly sharedPatch: ClientSettingsPatch;
  readonly localPatch: RendererLocalClientSettingsPatch;
} {
  const {
    atmosphereConsoleEnabled,
    mobileOptimizedPresentation,
    uiLanguage,
    worldClockWeatherEnabled,
    ...sharedPatch
  } = patch;
  return {
    sharedPatch,
    localPatch: {
      ...(atmosphereConsoleEnabled === undefined ? {} : { atmosphereConsoleEnabled }),
      ...(mobileOptimizedPresentation === undefined ? {} : { mobileOptimizedPresentation }),
      ...(uiLanguage === undefined ? {} : { uiLanguage }),
      ...(worldClockWeatherEnabled === undefined ? {} : { worldClockWeatherEnabled }),
    },
  };
}

export function withoutRendererLocalClientSettings(settings: ClientSettings): ClientSettingsPatch {
  const {
    atmosphereConsoleEnabled: _atmosphereConsole,
    mobileOptimizedPresentation: _mobilePresentation,
    uiLanguage: _uiLanguage,
    worldClockWeatherEnabled: _weatherConsent,
    ...sharedSettings
  } = settings;
  return sharedSettings;
}

export function withRendererLocalClientSettings(
  sharedSettings: ClientSettings,
  localSettings: Pick<
    ClientSettings,
    | "atmosphereConsoleEnabled"
    | "mobileOptimizedPresentation"
    | "uiLanguage"
    | "worldClockWeatherEnabled"
  >,
): ClientSettings {
  return {
    ...sharedSettings,
    atmosphereConsoleEnabled: localSettings.atmosphereConsoleEnabled,
    mobileOptimizedPresentation: localSettings.mobileOptimizedPresentation,
    uiLanguage: localSettings.uiLanguage,
    worldClockWeatherEnabled: localSettings.worldClockWeatherEnabled,
  };
}
