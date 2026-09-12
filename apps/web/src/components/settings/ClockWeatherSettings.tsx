import {
  DEFAULT_WORLD_CLOCK_ENABLED,
  DEFAULT_WORLD_CLOCK_LOCATION_IDS,
  DEFAULT_WORLD_CLOCK_STYLE,
  MAX_WORLD_CLOCK_LOCATIONS,
  type WorldClockLocationId,
  type WorldClockStyle,
} from "@cafecode/contracts/settings";
import { Clock3Icon } from "lucide-react";
import { useState } from "react";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { WORLD_CLOCK_LOCATIONS } from "../../worldClock";
import { writeWorldClockWeatherConsent } from "../../worldClockWeatherConsent";
import { WORLD_WEATHER_ATTRIBUTION_URL } from "../../worldWeather";
import { useWorldClockWeatherConsent } from "../WorldClockWidget.hooks";
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

/**
 * Settings for the world clock panel.
 *
 * The clock keys are ordinary client settings, so they are shared with the
 * other renderers of this environment. The weather switch is different: it
 * writes only to the local consent store of this renderer, because it
 * authorizes a third-party request from this device. The control writes first
 * and then reports a failed write, so the user never sees weather reported as
 * on when the consent did not persist.
 */
export function ClockWeatherSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const weatherEnabled = useWorldClockWeatherConsent();
  const [weatherConsentPending, setWeatherConsentPending] = useState(false);
  const [weatherConsentError, setWeatherConsentError] = useState(false);
  const hasNonDefaultValue =
    settings.worldClockEnabled !== DEFAULT_WORLD_CLOCK_ENABLED ||
    settings.worldClockStyle !== DEFAULT_WORLD_CLOCK_STYLE ||
    settings.worldClockLocationIds.length !== DEFAULT_WORLD_CLOCK_LOCATION_IDS.length ||
    settings.worldClockLocationIds.some(
      (locationId, index) => locationId !== DEFAULT_WORLD_CLOCK_LOCATION_IDS[index],
    );

  // The contract bounds the selection to 1-6 unique cities. The control keeps
  // the same bounds, so a rejected patch cannot reach the settings RPC.
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
        title="World clock panel"
        description="Show a transparent multi-city clock over Cafe Code. You can move, resize, or collapse the panel on desktop and on LAN browsers."
        resetAction={
          hasNonDefaultValue ? (
            <SettingResetButton
              label="world clock"
              onClick={() =>
                updateSettings({
                  worldClockEnabled: DEFAULT_WORLD_CLOCK_ENABLED,
                  worldClockStyle: DEFAULT_WORLD_CLOCK_STYLE,
                  worldClockLocationIds: DEFAULT_WORLD_CLOCK_LOCATION_IDS,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.worldClockEnabled}
            aria-label="Show world clock panel"
            onCheckedChange={(checked) => updateSettings({ worldClockEnabled: Boolean(checked) })}
          />
        }
      />

      <SettingsRow
        title="Clock style"
        description="Select the clock face. Colors follow the ambiance color, then the accent color, then the sidebar color."
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
        description={`Select 1 to ${MAX_WORLD_CLOCK_LOCATIONS} clocks. Each city has an explicit IANA time zone, so daylight-saving changes follow the platform time-zone data.`}
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
        description="Add temperature, conditions, and wind for the selected cities. Cafe Code saves this consent only in this browser or Desktop renderer. Cafe Code does not sync it to the server or to other clients. Requests run only while the panel is open and visible."
        status={
          <span className="grid gap-1">
            <span>
              Privacy and use notice: if you turn this on, your device sends its network address and
              the selected city coordinates to Open-Meteo. The keyless Open-Meteo API is for
              non-commercial use. It requires attribution, it can keep troubleshooting logs of the
              address and the coordinates for up to 90 days, and it can be stale or unavailable.
              Commercial users must keep this off unless Cafe Code has a suitable paid endpoint.{" "}
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
                Cafe Code could not save the consent change. Weather stays unchanged.
              </span>
            ) : null}
          </span>
        }
        control={
          <Switch
            checked={weatherEnabled}
            disabled={!settings.worldClockEnabled || weatherConsentPending}
            aria-label="Show current weather in world clock"
            onCheckedChange={(checked) => {
              setWeatherConsentError(false);
              setWeatherConsentPending(true);
              void writeWorldClockWeatherConsent(Boolean(checked))
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
