import type { ReactNode } from "react";
import { useSettings } from "../hooks/useSettings";
import { UiLocalizationProvider } from "../uiLocalization";

/** Keep persistence/runtime imports at the application boundary, outside shared UI primitives. */
export function SettingsUiLocalizationProvider({ children }: { readonly children: ReactNode }) {
  const preference = useSettings((settings) => settings.uiLanguage);
  return <UiLocalizationProvider preference={preference}>{children}</UiLocalizationProvider>;
}
