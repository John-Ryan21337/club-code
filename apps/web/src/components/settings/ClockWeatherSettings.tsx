import {
  DEFAULT_WORLD_CLOCK_ENABLED,
  DEFAULT_WORLD_CLOCK_LOCATION_IDS,
  DEFAULT_WORLD_CLOCK_STYLE,
  DEFAULT_WORLD_CLOCK_WEATHER_ENABLED,
  MAX_WORLD_CLOCK_LOCATIONS,
  type WorldClockLocationId,
  type WorldClockStyle,
} from "@cafecode/contracts/settings";
import { Clock3Icon } from "lucide-react";
import { useState } from "react";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { WORLD_CLOCK_LOCATIONS } from "../../worldClock";
import { WORLD_WEATHER_ATTRIBUTION_URL } from "../../worldWeather";
import { Checkbox } from "../ui/checkbox";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

const STYLE_LABELS: Readonly<Record<WorldClockStyle, string>> = {
  rainbow: "Rainbow shimmer",
  nixie: "Amber nixie tubes",
  analog: "Transparent analog",
  led: "Old-school LED",
};

function isWorldClockStyle(value: unknown): value is WorldClockStyle {
  return value === "rainbow" || value === "nixie" || value === "analog" || value === "led";
}

export function ClockWeatherSettings() {
  const settings = useSettings();
  const { updateClientSettingsConfirmed, updateSettings } = useUpdateSettings();
  const [weatherConsentPending, setWeatherConsentPending] = useState(false);
  const [weatherConsentError, setWeatherConsentError] = useState(false);
  const hasNonDefaultValue =
    settings.worldClockEnabled !== DEFAULT_WORLD_CLOCK_ENABLED ||
    settings.worldClockStyle !== DEFAULT_WORLD_CLOCK_STYLE ||
    settings.worldClockWeatherEnabled !== DEFAULT_WORLD_CLOCK_WEATHER_ENABLED ||
    settings.worldClockLocationIds.length !== DEFAULT_WORLD_CLOCK_LOCATION_IDS.length ||
    settings.worldClockLocationIds.some(
      (locationId, index) => locationId !== DEFAULT_WORLD_CLOCK_LOCATION_IDS[index],
    );

  const toggleLocation = (locationId: WorldClockLocationId, checked: boolean) => {
    if (checked) {
      if (
        settings.worldClockLocationIds.includes(locationId) ||
        settings.worldClockLocationIds.length >= MAX_WORLD_CLOCK_LOCATIONS
      ) {
        return;
      }
      updateSettings({
        worldClockLocationIds: [...settings.worldClockLocationIds, locationId],
      });
      return;
    }
    if (settings.worldClockLocationIds.length <= 1) return;
    updateSettings({
      worldClockLocationIds: settings.worldClockLocationIds.filter(
        (selectedId) => selectedId !== locationId,
      ),
    });
  };

  return (
    <SettingsSection
      title="World clock & weather"
      icon={<Clock3Icon className="size-3.5" aria-hidden />}
    >
      <SettingsRow
        title="World clock widget"
        description="Show a transparent multi-city clock over Club Code. Drag, resize, or collapse it on desktop and LAN browsers."
        resetAction={
          hasNonDefaultValue ? (
            <SettingResetButton
              label="world clock and weather"
              onClick={() =>
                updateSettings({
                  worldClockEnabled: DEFAULT_WORLD_CLOCK_ENABLED,
                  worldClockStyle: DEFAULT_WORLD_CLOCK_STYLE,
                  worldClockLocationIds: DEFAULT_WORLD_CLOCK_LOCATION_IDS,
                  worldClockWeatherEnabled: DEFAULT_WORLD_CLOCK_WEATHER_ENABLED,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.worldClockEnabled}
            aria-label="Show world clock widget"
            onCheckedChange={(checked) => updateSettings({ worldClockEnabled: Boolean(checked) })}
          />
        }
      />

      <SettingsRow
        title="Clock style"
        description="Shimmer colors follow the live Matrix palette when it is available."
        control={
          <Select
            value={settings.worldClockStyle}
            onValueChange={(value) => {
              if (isWorldClockStyle(value)) updateSettings({ worldClockStyle: value });
            }}
          >
            <SelectTrigger className="w-full sm:w-48" aria-label="World clock style">
              <SelectValue>{STYLE_LABELS[settings.worldClockStyle]}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {(Object.entries(STYLE_LABELS) as ReadonlyArray<[WorldClockStyle, string]>).map(
                ([value, label]) => (
                  <SelectItem hideIndicator key={value} value={value}>
                    {label}
                  </SelectItem>
                ),
              )}
            </SelectPopup>
          </Select>
        }
      />

      <SettingsRow
        title="Cities"
        description={`Select 1–${MAX_WORLD_CLOCK_LOCATIONS} clocks. Each saved city has an explicit IANA timezone, so daylight-saving changes follow the browser's timezone data.`}
        status={`${settings.worldClockLocationIds.length} of ${MAX_WORLD_CLOCK_LOCATIONS} selected`}
      >
        <div
          className="grid grid-cols-1 gap-2 pb-4 sm:grid-cols-2"
          role="group"
          aria-label="World clock cities"
        >
          {WORLD_CLOCK_LOCATIONS.map((location) => {
            const selected = settings.worldClockLocationIds.includes(location.id);
            const selectionLimitReached =
              !selected && settings.worldClockLocationIds.length >= MAX_WORLD_CLOCK_LOCATIONS;
            const lastSelected = selected && settings.worldClockLocationIds.length === 1;
            return (
              <label
                key={location.id}
                className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border border-border/55 bg-background/35 px-3 py-2 text-xs has-data-disabled:cursor-not-allowed has-data-disabled:opacity-55"
              >
                <Checkbox
                  checked={selected}
                  disabled={selectionLimitReached || lastSelected}
                  aria-label={`${selected ? "Remove" : "Add"} ${location.city} clock`}
                  onCheckedChange={(checked) => toggleLocation(location.id, Boolean(checked))}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground">{location.city}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {location.timeZone}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </SettingsRow>

      <SettingsRow
        title="Current weather"
        description="Optionally add temperature, conditions, and wind for the selected cities. Consent is saved only in this browser/Desktop renderer, not synced or included in Settings profiles. Requests run only while the clock is open and visible."
        status={
          <span className="grid gap-1">
            <span>
              Privacy and use notice: enabling sends your device/browser IP and selected city
              coordinates directly to Open-Meteo. Its keyless API is for non-commercial use,
              requires attribution, may keep troubleshooting IP/coordinate logs for up to 90 days,
              and may be stale or unavailable. Commercial users must leave this off unless Club Code
              is later configured with a suitable paid endpoint.{" "}
              <a
                className="underline underline-offset-2 hover:text-foreground"
                href={`${WORLD_WEATHER_ATTRIBUTION_URL}en/terms`}
                rel="noreferrer"
                target="_blank"
              >
                Open-Meteo terms
              </a>
            </span>
            {weatherConsentError ? (
              <span className="text-destructive" role="alert">
                The consent change could not be saved. Weather was left unchanged.
              </span>
            ) : null}
          </span>
        }
        control={
          <Switch
            checked={settings.worldClockWeatherEnabled}
            disabled={!settings.worldClockEnabled || weatherConsentPending}
            aria-label="Show current weather in world clock"
            onCheckedChange={(checked) => {
              setWeatherConsentError(false);
              setWeatherConsentPending(true);
              void updateClientSettingsConfirmed({
                worldClockWeatherEnabled: Boolean(checked),
              })
                .catch(() => {
                  setWeatherConsentError(true);
                })
                .finally(() => {
                  setWeatherConsentPending(false);
                });
            }}
          />
        }
      />
    </SettingsSection>
  );
}
