import {
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_OPACITY,
  DEFAULT_FALLING_EFFECT_2CH_ENRICHED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_AGENT_ENABLED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_BUILD_ENABLED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_COLOR_MODE,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_DATABASE_ENABLED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_NETWORK_ENABLED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINKS,
  DEFAULT_FALLING_EFFECT_DENSITY,
  DEFAULT_FALLING_EFFECTS_ENABLED,
  DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
  DEFAULT_FALLING_EFFECT_KIND,
  DEFAULT_FALLING_EFFECT_LIVE_WORK_VOCABULARY,
  DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE,
  DEFAULT_FALLING_EFFECT_SPEED,
  MAX_AMBIENT_OPACITY,
  MAX_FALLING_EFFECT_DENSITY,
  MAX_FALLING_EFFECT_JAPANESE_RATIO,
  MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  MAX_FALLING_EFFECT_SPEED,
  MIN_AMBIENT_OPACITY,
  MIN_FALLING_EFFECT_DENSITY,
  MIN_FALLING_EFFECT_JAPANESE_RATIO,
  MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  MIN_FALLING_EFFECT_SPEED,
} from "@cafecode/contracts/settings";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../rpc/serverState";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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

function clampMatrixColorCycleSpeed(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED;
  }
  return Math.min(
    MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
    Math.max(MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED, value),
  );
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
          settings.fallingEffectMatrixColorCycleSpeed !==
            DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED ||
          settings.fallingEffectOpacity !== DEFAULT_AMBIENT_OPACITY ||
          settings.fallingEffectSpeed !== DEFAULT_FALLING_EFFECT_SPEED ||
          settings.fallingEffectDensity !== DEFAULT_FALLING_EFFECT_DENSITY ||
          settings.fallingEffectJapaneseRatio !== DEFAULT_FALLING_EFFECT_JAPANESE_RATIO ||
          settings.fallingEffect2chEnriched !== DEFAULT_FALLING_EFFECT_2CH_ENRICHED ||
          settings.fallingEffectActivityLinks !== DEFAULT_FALLING_EFFECT_ACTIVITY_LINKS ||
          settings.fallingEffectActivityLinkNetworkEnabled !==
            DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_NETWORK_ENABLED ||
          settings.fallingEffectActivityLinkDatabaseEnabled !==
            DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_DATABASE_ENABLED ||
          settings.fallingEffectActivityLinkBuildEnabled !==
            DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_BUILD_ENABLED ||
          settings.fallingEffectActivityLinkAgentEnabled !==
            DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_AGENT_ENABLED ||
          settings.fallingEffectActivityLinkColorMode !==
            DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_COLOR_MODE ||
          settings.fallingEffectLiveWorkVocabulary !==
            DEFAULT_FALLING_EFFECT_LIVE_WORK_VOCABULARY ? (
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
                  fallingEffectOpacity: DEFAULT_AMBIENT_OPACITY,
                  fallingEffectSpeed: DEFAULT_FALLING_EFFECT_SPEED,
                  fallingEffectDensity: DEFAULT_FALLING_EFFECT_DENSITY,
                  fallingEffectJapaneseRatio: DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
                  fallingEffect2chEnriched: DEFAULT_FALLING_EFFECT_2CH_ENRICHED,
                  fallingEffectActivityLinks: DEFAULT_FALLING_EFFECT_ACTIVITY_LINKS,
                  fallingEffectActivityLinkNetworkEnabled:
                    DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_NETWORK_ENABLED,
                  fallingEffectActivityLinkDatabaseEnabled:
                    DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_DATABASE_ENABLED,
                  fallingEffectActivityLinkBuildEnabled:
                    DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_BUILD_ENABLED,
                  fallingEffectActivityLinkAgentEnabled:
                    DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_AGENT_ENABLED,
                  fallingEffectActivityLinkColorMode:
                    DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_COLOR_MODE,
                  fallingEffectLiveWorkVocabulary: DEFAULT_FALLING_EFFECT_LIVE_WORK_VOCABULARY,
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
            description="Rainbow Extra gives every falling stream its own deterministic color phase. Music modes use only approved direct/VLC media or audio you explicitly share for YouTube/Spotify; they never read an iframe or microphone. Quiet, stopped, or stale audio returns to the fallback color."
            control={
              <RadioGroup
                value={settings.fallingEffectMatrixColorMode}
                onValueChange={(value) => {
                  if (
                    value === "fixed" ||
                    value === "rainbow" ||
                    value === "rainbow-extra" ||
                    value === "music-reactive" ||
                    value === "music-reactive-extra"
                  ) {
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
                    ["music-reactive", "Music reactive · uniform"],
                    ["music-reactive-extra", "Music reactive · Rainbow Extra"],
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
            title="Matrix color-cycle speed"
            description="Controls hue motion independently of how fast the glyphs fall. 1x is the original 18-second rainbow; 16x to 64x creates a rapid shimmer. Music-reactive modes multiply their continuous hue drift while preserving beat impulses. Reduced-motion mode still stops animation."
            control={
              <div className="flex items-center gap-2">
                <NumberField
                  value={settings.fallingEffectMatrixColorCycleSpeed}
                  min={MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED}
                  max={MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED}
                  step={0.25}
                  disabled={settings.fallingEffectMatrixColorMode === "fixed"}
                  size="sm"
                  className="w-28"
                  onValueChange={(value) =>
                    updateSettings({
                      fallingEffectMatrixColorCycleSpeed: clampMatrixColorCycleSpeed(value),
                    })
                  }
                >
                  <NumberFieldGroup>
                    <NumberFieldDecrement aria-label="Decrease Matrix color-cycle speed" />
                    <NumberFieldInput aria-label="Matrix color-cycle speed multiplier" />
                    <NumberFieldIncrement aria-label="Increase Matrix color-cycle speed" />
                  </NumberFieldGroup>
                </NumberField>
                <span className="text-xs text-muted-foreground">x</span>
              </div>
            }
          />
          <SettingsRow
            title="Roman / Japanese mix"
            description="At 0%, streams use Roman glyphs and English live terms. At 100%, they use Japanese glyphs and Japanese live terms."
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
            title="2ch-inspired glyph enrichment"
            description="Add tasteful half-width kana, net-culture symbols, and rare intact cat AA tokens to Japanese streams. At 0% Japanese, this option has no visible effect."
            control={
              <Switch
                checked={settings.fallingEffect2chEnriched}
                onCheckedChange={(checked) =>
                  updateSettings({ fallingEffect2chEnriched: Boolean(checked) })
                }
                aria-label="Use 2ch-inspired Matrix enrichment"
              />
            }
          />
          <SettingsRow
            title="Live work vocabulary"
            description="Mix bounded operation labels and safe touched-file names from provider-reported activity into the Matrix rain. Prompt text, file contents, command output, hidden OS activity, and secret-looking names are excluded."
            control={
              <Switch
                checked={settings.fallingEffectLiveWorkVocabulary}
                onCheckedChange={(checked) =>
                  updateSettings({ fallingEffectLiveWorkVocabulary: Boolean(checked) })
                }
                aria-label="Use live work vocabulary in Matrix rain"
              />
            }
          />
          <SettingsRow
            title="Provider activity links"
            description="Show short network, database, build/compile, and agent-delegation pulses from provider-observed activity. Lines appear only between same-category events with the exact same reported item or tool identity; Club Code never invents data flow or renders prompts, commands, SQL values, URLs, credentials, or hidden OS traffic."
            control={
              <Switch
                checked={settings.fallingEffectActivityLinks}
                onCheckedChange={(checked) =>
                  updateSettings({ fallingEffectActivityLinks: Boolean(checked) })
                }
                aria-label="Show provider activity links in Matrix rain"
              />
            }
          />
          {settings.fallingEffectActivityLinks ? (
            <>
              <SettingsRow
                title="Activity inputs"
                description="Choose which safe provider-observed activity categories may create Matrix pulses and connecting lines. Clear every checkbox to show no activity overlay."
                control={
                  <div
                    role="group"
                    aria-label="Matrix activity link inputs"
                    className="flex flex-wrap justify-end gap-x-4 gap-y-2"
                  >
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
                      <Checkbox
                        checked={settings.fallingEffectActivityLinkNetworkEnabled}
                        onCheckedChange={(checked) =>
                          updateSettings({
                            fallingEffectActivityLinkNetworkEnabled: Boolean(checked),
                          })
                        }
                      />
                      <span>Network / web</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
                      <Checkbox
                        checked={settings.fallingEffectActivityLinkDatabaseEnabled}
                        onCheckedChange={(checked) =>
                          updateSettings({
                            fallingEffectActivityLinkDatabaseEnabled: Boolean(checked),
                          })
                        }
                      />
                      <span>Database / query</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
                      <Checkbox
                        checked={settings.fallingEffectActivityLinkBuildEnabled}
                        onCheckedChange={(checked) =>
                          updateSettings({
                            fallingEffectActivityLinkBuildEnabled: Boolean(checked),
                          })
                        }
                      />
                      <span>Build / compile</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs font-medium">
                      <Checkbox
                        checked={settings.fallingEffectActivityLinkAgentEnabled}
                        onCheckedChange={(checked) =>
                          updateSettings({
                            fallingEffectActivityLinkAgentEnabled: Boolean(checked),
                          })
                        }
                      />
                      <span>Agent / delegation</span>
                    </label>
                  </div>
                }
              />
              <SettingsRow
                title="Activity link colors"
                description="Random gives each real link an independent deterministic hue. Matrix follows the selected uniform or per-stream Matrix color animation."
                control={
                  <RadioGroup
                    value={settings.fallingEffectActivityLinkColorMode}
                    onValueChange={(value) => {
                      if (value === "random" || value === "matrix") {
                        updateSettings({ fallingEffectActivityLinkColorMode: value });
                      }
                    }}
                    aria-label="Matrix activity link color mode"
                    className="flex-row gap-4"
                  >
                    {(
                      [
                        ["random", "Random independent"],
                        ["matrix", "Follow Matrix colors"],
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
            </>
          ) : null}
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
          (settings.fallingEffectMatrixColorMode === "music-reactive" ||
            settings.fallingEffectMatrixColorMode === "music-reactive-extra")
            ? "Used whenever the approved direct, VLC, or explicitly shared-audio analyser is inactive, quiet, or stale."
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
