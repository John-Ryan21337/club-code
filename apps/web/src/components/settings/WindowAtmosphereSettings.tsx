import {
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_OPACITY,
  DEFAULT_FALLING_EFFECT_DENSITY,
  DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
  DEFAULT_FALLING_EFFECT_KIND,
  DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE,
  DEFAULT_FALLING_EFFECT_SPEED,
  DEFAULT_FALLING_EFFECTS_ENABLED,
  MAX_AMBIENT_OPACITY,
  MAX_FALLING_EFFECT_DENSITY,
  MAX_FALLING_EFFECT_JAPANESE_RATIO,
  MAX_FALLING_EFFECT_SPEED,
  MIN_AMBIENT_OPACITY,
  MIN_FALLING_EFFECT_DENSITY,
  MIN_FALLING_EFFECT_JAPANESE_RATIO,
  MIN_FALLING_EFFECT_SPEED,
  DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP,
  MAX_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  MAX_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
  MAX_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  MIN_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  MIN_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
  MIN_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  type FallingEffectMatrixMotionMode,
} from "@cafecode/contracts/settings";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../rpc/serverState";
import {
  clampAtmosphereDensitySetting,
  clampAtmosphereJapanesePercentSetting,
  clampAtmosphereMatrixBaseFontSizeSetting,
  clampAtmosphereMatrixCenterWindIntensitySetting,
  clampAtmosphereMatrixColorCycleSpeedSetting,
  clampAtmosphereMatrixWalkFontSizeSetting,
  clampAtmosphereMatrixWalkLifecyclePercentSetting,
  clampAtmosphereOpacityPercentSetting,
  clampAtmosphereSpeedSetting,
} from "../../windowAtmosphereSettings";
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

const ATMOSPHERE_MOTION_MODES: ReadonlyArray<readonly [FallingEffectMatrixMotionMode, string]> = [
  ["flat", "Flat"],
  ["forward", "Forward"],
  ["reverse", "Reverse"],
  ["tunnel", "Warp"],
  ["walk-forward", "Walk Forward"],
  ["walk-reverse", "Walk Reverse"],
];

export function WindowAtmosphereSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const serverConfig = useServerConfig();
  const atmosphereAvailable = serverConfig?.ambientExperienceCapabilities.atmosphere === true;
  const hasNonDefaultValue =
    settings.fallingEffectsEnabled !== DEFAULT_FALLING_EFFECTS_ENABLED ||
    settings.fallingEffectKind !== DEFAULT_FALLING_EFFECT_KIND ||
    settings.fallingEffectColor !== DEFAULT_AMBIENT_COLOR ||
    settings.fallingEffectMatrixColorMode !== DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE ||
    settings.fallingEffectOpacity !== DEFAULT_AMBIENT_OPACITY ||
    settings.fallingEffectSpeed !== DEFAULT_FALLING_EFFECT_SPEED ||
    settings.fallingEffectDensity !== DEFAULT_FALLING_EFFECT_DENSITY ||
    settings.fallingEffectJapaneseRatio !== DEFAULT_FALLING_EFFECT_JAPANESE_RATIO ||
    settings.fallingEffectLiveWorkVocabularyEnabled ||
    settings.fallingEffect2chEnriched ||
    settings.fallingEffectMatrixColorCycleSpeed !==
      DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED ||
    settings.fallingEffectMatrixBaseFontSize !== DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE ||
    settings.fallingEffectMatrixMotionMode !== DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE ||
    settings.fallingEffectMatrixWalkStartFontSize !==
      DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE ||
    settings.fallingEffectMatrixWalkEndFontSize !==
      DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE ||
    settings.fallingEffectMatrixWalkLifecyclePercent !==
      DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT ||
    settings.fallingEffectMatrixCenterWindIntensity !==
      DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY;
  const controlsEnabled = atmosphereAvailable && settings.fallingEffectsEnabled;

  return (
    <SettingsSection title="Window atmosphere">
      <SettingsRow
        title="Falling effects"
        description="Let snow, rain, or Matrix characters drift across the whole Cafe Code window."
        status={
          atmosphereAvailable ? null : (
            <span className="text-amber-600 dark:text-amber-400">
              This server has not enabled the window atmosphere capability.
            </span>
          )
        }
        resetAction={
          hasNonDefaultValue ? (
            <SettingResetButton
              label="window atmosphere"
              onClick={() =>
                updateSettings({
                  fallingEffectsEnabled: DEFAULT_FALLING_EFFECTS_ENABLED,
                  fallingEffectKind: DEFAULT_FALLING_EFFECT_KIND,
                  fallingEffectColor: DEFAULT_AMBIENT_COLOR,
                  fallingEffectMatrixColorMode: DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE,
                  fallingEffectMatrixColorCycleSpeed:
                    DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
                  fallingEffectMatrixBaseFontSize: DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
                  fallingEffectMatrixMotionMode: DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE,
                  fallingEffectMatrixWalkStartFontSize:
                    DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
                  fallingEffectMatrixWalkEndFontSize:
                    DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
                  fallingEffectMatrixWalkLifecyclePercent:
                    DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
                  fallingEffectMatrixCenterWindIntensity:
                    DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
                  fallingEffectOpacity: DEFAULT_AMBIENT_OPACITY,
                  fallingEffectSpeed: DEFAULT_FALLING_EFFECT_SPEED,
                  fallingEffectDensity: DEFAULT_FALLING_EFFECT_DENSITY,
                  fallingEffectJapaneseRatio: DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
                  fallingEffectLiveWorkVocabularyEnabled: false,
                  fallingEffect2chEnriched: false,
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

      {controlsEnabled ? (
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

      {controlsEnabled ? (
        <SettingsRow
          title="Motion"
          description="Projection applied to every falling particle. Walk modes expand each Matrix stream between the size endpoints below."
          control={
            <RadioGroup
              value={settings.fallingEffectMatrixMotionMode}
              onValueChange={(value) => {
                const mode = ATMOSPHERE_MOTION_MODES.find(([candidate]) => candidate === value);
                if (mode) {
                  updateSettings({ fallingEffectMatrixMotionMode: mode[0] });
                }
              }}
              aria-label="Atmosphere motion"
              className="flex-row flex-wrap gap-4"
            >
              {ATMOSPHERE_MOTION_MODES.map(([value, label]) => (
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

      {controlsEnabled && settings.fallingEffectKind === "matrix" ? (
        <>
          <SettingsRow
            title="Matrix color mode"
            description="Rainbow Extra gives every falling stream its own deterministic color phase."
            control={
              <RadioGroup
                value={settings.fallingEffectMatrixColorMode}
                onValueChange={(value) => {
                  if (value === "fixed" || value === "rainbow" || value === "rainbow-extra") {
                    updateSettings({ fallingEffectMatrixColorMode: value });
                  }
                }}
                aria-label="Matrix color mode"
                className="flex-row flex-wrap gap-4"
              >
                {(
                  [
                    ["fixed", "Fixed"],
                    ["rainbow", "Rainbow"],
                    ["rainbow-extra", "Rainbow Extra"],
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
            title="Roman / Japanese mix"
            description="At 0%, streams use Roman glyphs. At 100%, they use Japanese glyphs."
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
                      fallingEffectJapaneseRatio: clampAtmosphereJapanesePercentSetting(value),
                    })
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease Japanese stream ratio" />
                    <NumberFieldInput aria-label="Japanese stream ratio percent" />
                    <NumberFieldIncrement aria-label="Increase Japanese stream ratio" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            }
          />
          <SettingsRow
            title="Live work vocabulary / 作業語彙"
            description="Show operation labels and filtered file names from the selected thread. Names can still be private; turn this off before screen sharing. Prompts, command text and file contents are not used. / 選択スレッドの操作名とフィルター済みファイル名を表示します。非公開の名前が残る場合があります。画面共有前にオフにしてください。プロンプト・コマンド本文・ファイル内容は使いません。"
            control={
              <Switch
                checked={settings.fallingEffectLiveWorkVocabularyEnabled}
                onCheckedChange={(checked) =>
                  updateSettings({ fallingEffectLiveWorkVocabularyEnabled: Boolean(checked) })
                }
                aria-label="Live work vocabulary / 作業語彙"
              />
            }
          />
          <SettingsRow
            title="2ch-style cat AA / 2ch風の猫AA"
            description="Add fixed half-width kana and occasional intact cat faces to Japanese Matrix streams. This setting does not access a website. / 日本語の Matrix の流れに、固定の半角カナと、ときどき猫の顔文字を追加します。外部サイトには接続しません。"
            control={
              <Switch
                checked={settings.fallingEffect2chEnriched}
                onCheckedChange={(checked) =>
                  updateSettings({ fallingEffect2chEnriched: Boolean(checked) })
                }
                aria-label="2ch-style cat AA / 2ch風の猫AA"
              />
            }
          />
          <SettingsRow
            title="Color cycle speed"
            description="Multiplier for the Rainbow hue animation. Fast settings distribute the shimmer across streams instead of flashing the whole field."
            control={
              <div className="flex items-center gap-2">
                <NumberField
                  value={settings.fallingEffectMatrixColorCycleSpeed}
                  min={MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED}
                  max={MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED}
                  step={0.25}
                  size="sm"
                  className="w-28"
                  onValueChange={(value) =>
                    updateSettings({
                      fallingEffectMatrixColorCycleSpeed:
                        clampAtmosphereMatrixColorCycleSpeedSetting(value),
                    })
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease Matrix color cycle speed" />
                    <NumberFieldInput aria-label="Matrix color cycle speed" />
                    <NumberFieldIncrement aria-label="Increase Matrix color cycle speed" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">x</span>
              </div>
            }
          />
          <SettingsRow
            title="Glyph size"
            description="Baseline Matrix glyph size. Flat, Forward, Reverse, and Warp streams scale their own variation around it."
            control={
              <div className="flex items-center gap-2">
                <NumberField
                  value={settings.fallingEffectMatrixBaseFontSize}
                  min={MIN_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE}
                  max={MAX_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE}
                  step={1}
                  size="sm"
                  className="w-28"
                  onValueChange={(value) =>
                    updateSettings({
                      fallingEffectMatrixBaseFontSize:
                        clampAtmosphereMatrixBaseFontSizeSetting(value),
                    })
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease Matrix glyph size" />
                    <NumberFieldInput aria-label="Matrix glyph size" />
                    <NumberFieldIncrement aria-label="Increase Matrix glyph size" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            }
          />
          <SettingsRow
            title="Walk size endpoints"
            description="Exact start and end glyph sizes for the Walk motion lifecycle."
            control={
              <div className="flex items-center gap-2">
                <NumberField
                  value={settings.fallingEffectMatrixWalkStartFontSize}
                  min={MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE}
                  max={MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE}
                  step={FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP}
                  size="sm"
                  className="w-24"
                  onValueChange={(value) =>
                    updateSettings({
                      fallingEffectMatrixWalkStartFontSize:
                        clampAtmosphereMatrixWalkFontSizeSetting(
                          value,
                          DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
                        ),
                    })
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease Walk start size" />
                    <NumberFieldInput aria-label="Walk start size" />
                    <NumberFieldIncrement aria-label="Increase Walk start size" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">to</span>
                <NumberField
                  value={settings.fallingEffectMatrixWalkEndFontSize}
                  min={MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE}
                  max={MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE}
                  step={FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP}
                  size="sm"
                  className="w-24"
                  onValueChange={(value) =>
                    updateSettings({
                      fallingEffectMatrixWalkEndFontSize: clampAtmosphereMatrixWalkFontSizeSetting(
                        value,
                        DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
                      ),
                    })
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease Walk end size" />
                    <NumberFieldInput aria-label="Walk end size" />
                    <NumberFieldIncrement aria-label="Increase Walk end size" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            }
          />
          <SettingsRow
            title="Walk lifecycle distance"
            description="Percentage of the viewport a Walk stream falls before it fades and respawns."
            control={
              <div className="flex items-center gap-2">
                <NumberField
                  value={settings.fallingEffectMatrixWalkLifecyclePercent}
                  min={MIN_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT}
                  max={MAX_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT}
                  step={5}
                  size="sm"
                  className="w-28"
                  onValueChange={(value) =>
                    updateSettings({
                      fallingEffectMatrixWalkLifecyclePercent:
                        clampAtmosphereMatrixWalkLifecyclePercentSetting(value),
                    })
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease Walk lifecycle distance" />
                    <NumberFieldInput aria-label="Walk lifecycle distance percent" />
                    <NumberFieldIncrement aria-label="Increase Walk lifecycle distance" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            }
          />
          <SettingsRow
            title="Center wind"
            description="How strongly Walk streams fan outward from the center of the window."
            control={
              <div className="flex items-center gap-2">
                <NumberField
                  value={settings.fallingEffectMatrixCenterWindIntensity}
                  min={MIN_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY}
                  max={MAX_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY}
                  step={1}
                  size="sm"
                  className="w-28"
                  onValueChange={(value) =>
                    updateSettings({
                      fallingEffectMatrixCenterWindIntensity:
                        clampAtmosphereMatrixCenterWindIntensitySetting(value),
                    })
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease center wind" />
                    <NumberFieldInput aria-label="Center wind intensity" />
                    <NumberFieldIncrement aria-label="Increase center wind" />
                  </NumberFieldGroup>
                </NumberField>
              </div>
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
        description="Use an automatic theme-aware color, or pick your own."
        control={
          <fieldset
            disabled={!controlsEnabled}
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
              disabled={!controlsEnabled}
              size="sm"
              className="w-28"
              onValueChange={(value) =>
                updateSettings({
                  fallingEffectOpacity: clampAtmosphereOpacityPercentSetting(value),
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
              disabled={!controlsEnabled}
              size="sm"
              className="w-28"
              onValueChange={(value) =>
                updateSettings({ fallingEffectSpeed: clampAtmosphereSpeedSetting(value) })
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
              disabled={!controlsEnabled}
              size="sm"
              className="w-28"
              onValueChange={(value) =>
                updateSettings({ fallingEffectDensity: clampAtmosphereDensitySetting(value) })
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
