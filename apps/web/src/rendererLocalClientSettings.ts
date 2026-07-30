import type { ClientSettings, ClientSettingsPatch } from "@cafecode/contracts/settings";

export type RendererLocalClientSettingsPatch = Pick<
  ClientSettingsPatch,
  "atmosphereConsoleEnabled" | "mobileOptimizedPresentation" | "worldClockWeatherEnabled"
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
    worldClockWeatherEnabled,
    ...sharedPatch
  } = patch;
  return {
    sharedPatch,
    localPatch: {
      ...(atmosphereConsoleEnabled === undefined ? {} : { atmosphereConsoleEnabled }),
      ...(mobileOptimizedPresentation === undefined ? {} : { mobileOptimizedPresentation }),
      ...(worldClockWeatherEnabled === undefined ? {} : { worldClockWeatherEnabled }),
    },
  };
}

export function withoutRendererLocalClientSettings(settings: ClientSettings): ClientSettingsPatch {
  const {
    atmosphereConsoleEnabled: _atmosphereConsole,
    mobileOptimizedPresentation: _mobilePresentation,
    worldClockWeatherEnabled: _weatherConsent,
    ...sharedSettings
  } = settings;
  return sharedSettings;
}

export function withRendererLocalClientSettings(
  sharedSettings: ClientSettings,
  localSettings: Pick<
    ClientSettings,
    "atmosphereConsoleEnabled" | "mobileOptimizedPresentation" | "worldClockWeatherEnabled"
  >,
): ClientSettings {
  return {
    ...sharedSettings,
    atmosphereConsoleEnabled: localSettings.atmosphereConsoleEnabled,
    mobileOptimizedPresentation: localSettings.mobileOptimizedPresentation,
    worldClockWeatherEnabled: localSettings.worldClockWeatherEnabled,
  };
}
