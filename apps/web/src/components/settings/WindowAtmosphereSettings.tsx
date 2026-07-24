import {
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_OPACITY,
  DEFAULT_FALLING_EFFECT_2CH_ENRICHED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_COLOR_MODE,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINKS,
  DEFAULT_FALLING_EFFECT_DENSITY,
  DEFAULT_FALLING_EFFECTS_ENABLED,
  DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
  DEFAULT_FALLING_EFFECT_KIND,
  DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE,
  DEFAULT_FALLING_EFFECT_MATRIX_ENRICHED,
  DEFAULT_FALLING_EFFECT_DENSITY,
  DEFAULT_FALLING_EFFECT_SPEED,
  MAX_AMBIENT_OPACITY,
  MAX_FALLING_EFFECT_DENSITY,
  MAX_FALLING_EFFECT_JAPANESE_RATIO,
  MAX_FALLING_EFFECT_SPEED,
  MAX_FALLING_EFFECT_DENSITY,
  MAX_FALLING_EFFECT_JAPANESE_RATIO,
  MIN_AMBIENT_OPACITY,
  MIN_FALLING_EFFECT_DENSITY,
  MIN_FALLING_EFFECT_JAPANESE_RATIO,
  MIN_FALLING_EFFECT_SPEED,
  MIN_FALLING_EFFECT_DENSITY,
  MIN_FALLING_EFFECT_JAPANESE_RATIO,
} from "@cafecode/contracts/settings";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../rpc/serverState";
import { Button } from "../ui/button";
import {
  NumberField,
  NumberFieldDecrement,
  NumberFieldGroup,
  NumberFieldIncrement,
  NumberFieldInput,
} from "../ui/number-field";
import { Radio, RadioGroup } from "../ui/radio-group";
import { Switch } from "../ui/switch";
import { ColorWheelPicker } from "./ColorWheelPicker";
import { SettingResetButton, SettingsRow, SettingsSection } from "./settingsLayout";

const DEFAULT_ATMOSPHERE_PICKER_COLOR = "#38bdf8";

function clampFallingEffectSpeed(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return DEFAULT_FALLING_EFFECT_SPEED;
  }
  return Math.min(MAX_FALLING_EFFECT_SPEED, Math.max(MIN_FALLING_EFFECT_SPEED, value));
}

function clampFallingEffectDensity(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return DEFAULT_FALLING_EFFECT_DENSITY;
  }
  return Math.min(MAX_FALLING_EFFECT_DENSITY, Math.max(MIN_FALLING_EFFECT_DENSITY, value));
}

function clampFallingEffectJapaneseRatioPercent(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return DEFAULT_FALLING_EFFECT_JAPANESE_RATIO;
  }
  return Math.min(
    MAX_FALLING_EFFECT_JAPANESE_RATIO,
    Math.max(MIN_FALLING_EFFECT_JAPANESE_RATIO, value / 100),
  );
}

function clampFallingEffectOpacityPercent(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return DEFAULT_AMBIENT_OPACITY;
  }
  const opacity = value / 100;
  return Math.min(MAX_AMBIENT_OPACITY, Math.max(MIN_AMBIENT_OPACITY, opacity));
}

export function WindowAtmosphereSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const serverConfig = useServerConfig();
  const atmosphereAvailable = serverConfig?.ambientExperienceCapabilities.atmosphere === true;

  return (
    <SettingsSection title="Window atmosphere">
      <SettingsRow
        title="Falling effects"
        description="Let snow, rain, or Matrix characters drift across the whole Club Code window."
        status={
          atmosphereAvailable ? null : (
            <span className="text-amber-600 dark:text-amber-400">
              This server has not enabled the window atmosphere capability.
            </span>
          )
        }
        resetAction={
          settings.fallingEffectsEnabled !== DEFAULT_FALLING_EFFECTS_ENABLED ||
          settings.fallingEffectKind !== DEFAULT_FALLING_EFFECT_KIND ||
          settings.fallingEffectColor !== DEFAULT_AMBIENT_COLOR ||
          settings.fallingEffectMatrixColorMode !== DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE ||
          settings.fallingEffectOpacity !== DEFAULT_AMBIENT_OPACITY ||
          settings.fallingEffectSpeed !== DEFAULT_FALLING_EFFECT_SPEED ||
          settings.fallingEffectDensity !== DEFAULT_FALLING_EFFECT_DENSITY ||
          settings.fallingEffectJapaneseRatio !== DEFAULT_FALLING_EFFECT_JAPANESE_RATIO ||
          settings.fallingEffectMatrixEnriched !== DEFAULT_FALLING_EFFECT_MATRIX_ENRICHED ? (
            <SettingResetButton
              label="window atmosphere"
              onClick={() =>
                updateSettings({
                  fallingEffectsEnabled: DEFAULT_FALLING_EFFECTS_ENABLED,
                  fallingEffectKind: DEFAULT_FALLING_EFFECT_KIND,
                  fallingEffectColor: DEFAULT_AMBIENT_COLOR,
                  fallingEffectMatrixColorMode: DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE,
                  fallingEffectOpacity: DEFAULT_AMBIENT_OPACITY,
                  fallingEffectSpeed: DEFAULT_FALLING_EFFECT_SPEED,
                  fallingEffectDensity: DEFAULT_FALLING_EFFECT_DENSITY,
                  fallingEffectJapaneseRatio: DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
                  fallingEffectMatrixEnriched: DEFAULT_FALLING_EFFECT_MATRIX_ENRICHED,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            checked={settings.fallingEffectsEnabled}
            disabled={!atmosphereAvailable}
            onCheckedChange={(checked) =>
              updateSettings({ fallingEffectsEnabled: Boolean(checked) })
            }
            aria-label="Show falling effects"
          />
        }
      />

      {atmosphereAvailable && settings.fallingEffectsEnabled ? (
        <SettingsRow
          title="Effect"
          description="Choose what falls through the window."
          control={
            <RadioGroup
              value={settings.fallingEffectKind}
              onValueChange={(value) => {
                if (value === "snow" || value === "rain" || value === "matrix") {
                  updateSettings({ fallingEffectKind: value });
                }
              }}
              aria-label="Falling effect"
              className="flex-row gap-4"
            >
              {(
                [
                  ["snow", "Snow"],
                  ["rain", "Rain"],
                  ["matrix", "Matrix"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-1.5 text-xs font-medium"
                >
                  <Radio value={value} />
                  <span>{label}</span>
                </label>
              ))}
            </RadioGroup>
          }
        />
      ) : null}

      {atmosphereAvailable &&
      settings.fallingEffectsEnabled &&
      settings.fallingEffectKind === "matrix" ? (
        <>
          <SettingsRow
            title="Matrix color mode"
            description="Fixed keeps your selected color. Rainbow moves smoothly through the spectrum. Music reactive follows a playing selected Local Media file only; YouTube and Spotify iframe players do not expose shared audio, and Club Code never opens a microphone or captures system audio."
            control={
              <RadioGroup
                value={settings.fallingEffectMatrixColorMode}
                onValueChange={(value) => {
                  if (value === "fixed" || value === "rainbow" || value === "music-reactive") {
                    updateSettings({ fallingEffectMatrixColorMode: value });
                  }
                }}
                aria-label="Matrix color mode"
                className="flex-row flex-wrap gap-4"
              >
                {(
                  [
                    ["fixed", "Fixed"],
                    ["rainbow", "Rainbow cycle"],
                    ["music-reactive", "Music reactive"],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-1.5 text-xs font-medium"
                  >
                    <Radio value={value} />
                    <span>{label}</span>
                  </label>
                ))}
              </RadioGroup>
            }
          />
          <SettingsRow
            title="Japanese glyph ratio"
            description="Choose how much of the decorative Matrix glyph pool uses Japanese kana and kanji."
            control={
              <div className="flex items-center gap-2">
                <NumberField
                  value={Math.round(settings.fallingEffectJapaneseRatio * 100)}
                  min={Math.round(MIN_FALLING_EFFECT_JAPANESE_RATIO * 100)}
                  max={Math.round(MAX_FALLING_EFFECT_JAPANESE_RATIO * 100)}
                  step={5}
                  size="sm"
                  className="w-28"
                  onValueChange={(value) =>
                    updateSettings({
                      fallingEffectJapaneseRatio: clampFallingEffectJapaneseRatioPercent(value),
                    })
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease Japanese glyph ratio" />
                    <NumberFieldInput aria-label="Japanese glyph ratio percent" />
                    <NumberFieldIncrement aria-label="Increase Japanese glyph ratio" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            }
          />
          <SettingsRow
            title="Enriched Japanese glyphs"
            description="Include additional half-width kana and tasteful Japanese net/board symbols."
            control={
              <Switch
                checked={settings.fallingEffectMatrixEnriched}
                onCheckedChange={(checked) =>
                  updateSettings({ fallingEffectMatrixEnriched: Boolean(checked) })
                }
                aria-label="Use enriched Japanese Matrix glyphs"
              />
            }
          />
        </>
      ) : null}

      <SettingsRow
        title={
          settings.fallingEffectKind === "matrix" &&
          settings.fallingEffectMatrixColorMode !== "fixed"
            ? "Fixed / fallback color"
            : "Effect color"
        }
        description={
          settings.fallingEffectKind === "matrix" &&
          settings.fallingEffectMatrixColorMode === "music-reactive"
            ? "Used whenever no fresh approved Local Media audio signal is available."
            : "Use an automatic theme-aware color, or pick your own."
        }
        control={
          <fieldset
            disabled={!atmosphereAvailable || !settings.fallingEffectsEnabled}
            className="flex items-center gap-2 disabled:opacity-60"
          >
            <Button
              type="button"
              size="xs"
              variant="outline"
              aria-pressed={settings.fallingEffectColor === "auto"}
              onClick={() => updateSettings({ fallingEffectColor: "auto" })}
            >
              Auto
            </Button>
            <ColorWheelPicker
              value={
                settings.fallingEffectColor === "auto"
                  ? DEFAULT_ATMOSPHERE_PICKER_COLOR
                  : settings.fallingEffectColor
              }
              defaultPickerColor={DEFAULT_ATMOSPHERE_PICKER_COLOR}
              emptyValue={DEFAULT_ATMOSPHERE_PICKER_COLOR}
              ariaLabel="Falling effect color"
              onCommit={(value) => updateSettings({ fallingEffectColor: value })}
            />
          </fieldset>
        }
      />

      <SettingsRow
        title="Effect opacity"
        description="Lower is more transparent; 5% is faint and 100% is solid."
        control={
          <div className="flex items-center gap-2">
            <NumberField
              value={Math.round(settings.fallingEffectOpacity * 100)}
              min={Math.round(MIN_AMBIENT_OPACITY * 100)}
              max={Math.round(MAX_AMBIENT_OPACITY * 100)}
              step={5}
              disabled={!atmosphereAvailable || !settings.fallingEffectsEnabled}
              size="sm"
              className="w-28"
              onValueChange={(value) =>
                updateSettings({
                  fallingEffectOpacity: clampFallingEffectOpacityPercent(value),
                })
              }
            >
              <NumberFieldGroup>
                <NumberFieldDecrement aria-label="Decrease falling effect opacity" />
                <NumberFieldInput aria-label="Falling effect opacity percent" />
                <NumberFieldIncrement aria-label="Increase falling effect opacity" />
              </NumberFieldGroup>
            </NumberField>
            <span className="text-xs text-muted-foreground">%</span>
          </div>
        }
      />

      <SettingsRow
        title="Effect speed"
        description="Adjust how quickly the selected effect falls."
        control={
          <div className="flex items-center gap-2">
            <NumberField
              value={settings.fallingEffectSpeed}
              min={MIN_FALLING_EFFECT_SPEED}
              max={MAX_FALLING_EFFECT_SPEED}
              step={0.25}
              disabled={!atmosphereAvailable || !settings.fallingEffectsEnabled}
              size="sm"
              className="w-28"
              onValueChange={(value) =>
                updateSettings({ fallingEffectSpeed: clampFallingEffectSpeed(value) })
              }
            >
              <NumberFieldGroup>
                <NumberFieldDecrement aria-label="Decrease falling effect speed" />
                <NumberFieldInput aria-label="Falling effect speed multiplier" />
                <NumberFieldIncrement aria-label="Increase falling effect speed" />
              </NumberFieldGroup>
            </NumberField>
            <span className="text-xs text-muted-foreground">x</span>
          </div>
        }
      />

      <SettingsRow
        title="Effect density"
        description="Adjust how many flakes, drops, or Matrix columns fill the window."
        control={
          <div className="flex items-center gap-2">
            <NumberField
              value={settings.fallingEffectDensity}
              min={MIN_FALLING_EFFECT_DENSITY}
              max={MAX_FALLING_EFFECT_DENSITY}
              step={0.25}
              disabled={!atmosphereAvailable || !settings.fallingEffectsEnabled}
              size="sm"
              className="w-28"
              onValueChange={(value) =>
                updateSettings({ fallingEffectDensity: clampFallingEffectDensity(value) })
              }
            >
              <NumberFieldGroup>
                <NumberFieldDecrement aria-label="Decrease falling effect density" />
                <NumberFieldInput aria-label="Falling effect density multiplier" />
                <NumberFieldIncrement aria-label="Increase falling effect density" />
              </NumberFieldGroup>
            </NumberField>
            <span className="text-xs text-muted-foreground">x</span>
          </div>
        }
      />
    </SettingsSection>
  );
}
