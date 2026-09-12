import type { UiLanguagePreference } from "@cafecode/contracts/settings";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from "react";
import { localizeUiText, type ResolvedUiLanguage, resolveUiLanguage } from "./uiLocalizationCore";

export { localizeUiText, resolveSystemUiLanguage, resolveUiLanguage } from "./uiLocalizationCore";
export type { ResolvedUiLanguage } from "./uiLocalizationCore";

type UiLocalizationContextValue = {
  readonly preference: UiLanguagePreference;
  readonly language: ResolvedUiLanguage;
  readonly t: (english: string, japanese?: string) => string;
};
const UiLocalizationContext = createContext<UiLocalizationContextValue>({
  preference: "system",
  language: "en",
  t: (english) => english,
});

export function UiLocalizationProvider({
  children,
  preference,
}: {
  readonly children: ReactNode;
  readonly preference: UiLanguagePreference;
}) {
  const language = resolveUiLanguage(preference);
  const t = useCallback(
    (english: string, japanese?: string) => localizeUiText(english, language, japanese),
    [language],
  );
  const value = useMemo(() => ({ preference, language, t }), [language, preference, t]);
  useEffect(() => {
    document.documentElement.lang = language === "ja" ? "ja" : "en";
    document.documentElement.dataset.uiLanguage = language;
  }, [language]);
  return <UiLocalizationContext.Provider value={value}>{children}</UiLocalizationContext.Provider>;
}

export function useUiLocalization(): UiLocalizationContextValue {
  return useContext(UiLocalizationContext);
}

/** Use only for authored interface text, never provider or user content. Adds no DOM wrapper. */
export function UiText({ english }: { readonly english: string }) {
  const { t } = useUiLocalization();
  return english.replace(/\S(?:[\s\S]*\S)?/, (text) => t(text));
}
