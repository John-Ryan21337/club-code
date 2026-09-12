import type { ClientSettings, ClientSettingsPatch } from "@cafecode/contracts/settings";

/** Audio activation belongs to the listening device, not the shared server. */
export function splitCompletionAlertSettings(settings: ClientSettingsPatch) {
  const {
    completionAlertSoundEnabled,
    completionAlertSpeechEnabled,
    completionAlertLanguage,
    completionAlertEnglishVoiceGender,
    completionAlertJapaneseVoiceGender,
    completionAlertDualStereoOrder,
    ...shared
  } = settings;
  const local: ClientSettingsPatch = {
    ...(completionAlertSoundEnabled === undefined ? {} : { completionAlertSoundEnabled }),
    ...(completionAlertSpeechEnabled === undefined ? {} : { completionAlertSpeechEnabled }),
    ...(completionAlertLanguage === undefined ? {} : { completionAlertLanguage }),
    ...(completionAlertEnglishVoiceGender === undefined
      ? {}
      : { completionAlertEnglishVoiceGender }),
    ...(completionAlertJapaneseVoiceGender === undefined
      ? {}
      : { completionAlertJapaneseVoiceGender }),
    ...(completionAlertDualStereoOrder === undefined ? {} : { completionAlertDualStereoOrder }),
  };
  return { shared, local };
}

export function withLocalCompletionAlertSettings(
  shared: ClientSettings,
  local: ClientSettings,
): ClientSettings {
  return { ...shared, ...splitCompletionAlertSettings(local).local };
}
