import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useUiLocalization } from "../../uiLocalization";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingsRow, SettingsSection } from "./settingsLayout";

export function InterfaceLanguageSettings() {
  const preference = useSettings((settings) => settings.uiLanguage);
  const { updateSettings } = useUpdateSettings();
  const { t } = useUiLocalization();
  return (
    <SettingsSection title={t("Language", "言語")}>
      <SettingsRow
        title={t("Interface language", "インターフェース言語")}
        description={t(
          "Choose English, Japanese, both languages, or follow this device.",
          "英語、日本語、両言語表示、またはこの端末の言語設定を選択します。",
        )}
        control={
          <Select
            value={preference}
            onValueChange={(value) => {
              if (value === "system" || value === "en" || value === "ja" || value === "dual") {
                updateSettings({ uiLanguage: value });
              }
            }}
          >
            <SelectTrigger
              className="w-full sm:w-56"
              aria-label={t("Interface language", "インターフェース言語")}
            >
              <SelectValue>
                {preference === "system"
                  ? t("Follow system", "システム設定に従う")
                  : preference === "en"
                    ? "English"
                    : preference === "ja"
                      ? "日本語"
                      : "English + 日本語"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="system">
                {t("Follow system", "システム設定に従う")}
              </SelectItem>
              <SelectItem hideIndicator value="en">
                English
              </SelectItem>
              <SelectItem hideIndicator value="ja">
                日本語
              </SelectItem>
              <SelectItem hideIndicator value="dual">
                English + 日本語
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
    </SettingsSection>
  );
}
