import type { UiLanguagePreference } from "@cafecode/contracts/settings";

import { APP_JA } from "./localization/appJa";
import { CORE_JA } from "./localization/coreJa";
import { SETTINGS_JA } from "./localization/settingsJa";

export type ResolvedUiLanguage = "en" | "ja" | "dual";

const JA_CATALOG: Readonly<Record<string, string>> = {
  ...CORE_JA,
  ...APP_JA,
  ...SETTINGS_JA,
};

export function resolveSystemUiLanguage(languages?: readonly string[]): "en" | "ja" {
  const candidates =
    languages ??
    (typeof navigator === "undefined"
      ? []
      : navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language]);
  return candidates[0]?.toLowerCase().startsWith("ja") ? "ja" : "en";
}

export function resolveUiLanguage(
  preference: UiLanguagePreference,
  systemLanguages?: readonly string[],
): ResolvedUiLanguage {
  return preference === "system" ? resolveSystemUiLanguage(systemLanguages) : preference;
}

export function localizeUiText(
  english: string,
  language: ResolvedUiLanguage,
  japanese = JA_CATALOG[english],
): string {
  if (language === "en" || !japanese) return english;
  return language === "ja" ? japanese : `${english} / ${japanese}`;
}

export function isKnownEnglishUiText(value: string): boolean {
  return Object.hasOwn(JA_CATALOG, value);
}
