import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { Switch } from "../ui/switch";
import { Input } from "../ui/input";

export function ProviderUsageSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  return (
    <SettingsSection title="Provider usage">
      <SettingsRow
        title="Sidebar usage panel"
        description="Show provider-reported account windows and reset-credit balances. Off by default."
        control={
          <Switch
            aria-label="Show provider usage panel"
            checked={settings.providerUsageWidgetEnabled}
            onCheckedChange={(checked) =>
              void updateSettings({ providerUsageWidgetEnabled: checked })
            }
          />
        }
      />
      <SettingsRow
        title="Usage refresh interval"
        description="One to five minutes while enabled and the document is visible. Only the provider's bounded usage path runs."
        control={
          <Input
            className="w-20"
            aria-label="Usage refresh interval in minutes"
            type="number"
            min={1}
            max={5}
            step={1}
            value={settings.providerUsagePollMinutes}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isInteger(value) && value >= 1 && value <= 5)
                void updateSettings({ providerUsagePollMinutes: value });
            }}
          />
        }
      />
      <SettingsRow
        title="Advisory model pacing"
        description="Compare reported usage with time left in its window. Advice does not change models, permissions, worker counts, or request admission."
        control={
          <Switch
            aria-label="Show advisory model pacing"
            checked={settings.modelPacingEnabled}
            onCheckedChange={(checked) => void updateSettings({ modelPacingEnabled: checked })}
          />
        }
      />
      <SettingsRow
        title="Pacing reserve"
        description="Keep zero to fifty percent outside the suggested usage pace."
        control={
          <Input
            className="w-20"
            aria-label="Pacing reserve percent"
            type="number"
            min={0}
            max={50}
            step={1}
            value={settings.modelPacingReservePercent}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              if (Number.isInteger(value) && value >= 0 && value <= 50)
                void updateSettings({ modelPacingReservePercent: value });
            }}
          />
        }
      />
    </SettingsSection>
  );
}
