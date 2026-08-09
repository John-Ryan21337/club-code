import {
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_OPACITY,
  DEFAULT_ATMOSPHERE_CONSOLE_ENABLED,
  DEFAULT_FALLING_EFFECT_2CH_ENRICHED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_AGENT_ENABLED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_BUILD_ENABLED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_COLOR_MODE,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_DATABASE_ENABLED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_NETWORK_ENABLED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINKS,
  DEFAULT_FALLING_EFFECT_DENSITY,
  DEFAULT_FALLING_EFFECT_USAGE_REACTIVE,
  DEFAULT_FALLING_EFFECTS_ENABLED,
  DEFAULT_FALLING_EFFECTS_OVER_CINEMA_ENABLED,
  DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
  DEFAULT_FALLING_EFFECT_KIND,
  DEFAULT_FALLING_EFFECT_LIVE_WORK_VOCABULARY,
  DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE,
  DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_SPEED,
  DEFAULT_HARDWARE_LIGHTING_BRIGHTNESS,
  DEFAULT_HARDWARE_LIGHTING_RESTORE_ON_DISABLE,
  FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP,
  MAX_AMBIENT_OPACITY,
  MAX_FALLING_EFFECT_DENSITY,
  MAX_FALLING_EFFECT_JAPANESE_RATIO,
  MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  MAX_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  MAX_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
  MAX_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  MAX_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
  MAX_FALLING_EFFECT_SPEED,
  MIN_AMBIENT_OPACITY,
  MIN_FALLING_EFFECT_DENSITY,
  MIN_FALLING_EFFECT_JAPANESE_RATIO,
  MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  MIN_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  MIN_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
  MIN_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
  MIN_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
  MIN_FALLING_EFFECT_SPEED,
} from "@cafecode/contracts/settings";
import type { HardwareLightingStatus } from "@cafecode/contracts";
import { useEffect, useState } from "react";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { ensureLocalApi } from "../../localApi";
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

function clampWholePixelFontSize(
  value: number | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === null || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.round(Math.min(maximum, Math.max(minimum, value)));
}

interface WholePixelFontSizeFieldProps {
  decrementLabel: string;
  fallback: number;
  incrementLabel: string;
  inputLabel: string;
  maximum: number;
  minimum: number;
  onCommit: (value: number) => void;
  value: number;
}

function WholePixelFontSizeField({
  decrementLabel,
  fallback,
  incrementLabel,
  inputLabel,
  maximum,
  minimum,
  onCommit,
  value,
}: WholePixelFontSizeFieldProps) {
  const [draftValue, setDraftValue] = useState<number | null>(() =>
    clampWholePixelFontSize(value, fallback, minimum, maximum),
  );

  useEffect(() => {
    setDraftValue(clampWholePixelFontSize(value, fallback, minimum, maximum));
  }, [fallback, maximum, minimum, value]);

  return (
    <NumberField
      value={draftValue}
      min={minimum}
      max={maximum}
      step={FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP}
      smallStep={FALLING_EFFECT_MATRIX_WALK_FONT_SIZE_STEP}
      largeStep={10}
      snapOnStep
      format={{ minimumFractionDigits: 0, maximumFractionDigits: 0 }}
      size="sm"
      className="w-32"
      onValueChange={setDraftValue}
      onValueCommitted={(nextValue) => {
        const normalizedValue = clampWholePixelFontSize(nextValue, fallback, minimum, maximum);
        setDraftValue(normalizedValue);
        onCommit(normalizedValue);
      }}
    >
      <NumberFieldGroup>
        <NumberFieldDecrement aria-label={decrementLabel} />
        <NumberFieldInput
          aria-label={inputLabel}
          onFocus={(event) => {
            // Base UI places the caret at the end on first focus. Selecting the
            // complete formatted value instead lets direct typing, paste, and
            // browser autofill replace it rather than append to (for example)
            // "1".
            event.preventBaseUIHandler();
            event.currentTarget.select();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        <NumberFieldIncrement aria-label={incrementLabel} />
      </NumberFieldGroup>
    </NumberField>
  );
}

function clampFallingEffectDensity(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return DEFAULT_FALLING_EFFECT_DENSITY;
  }
  return Math.min(MAX_FALLING_EFFECT_DENSITY, Math.max(MIN_FALLING_EFFECT_DENSITY, value));
}

function clampMatrixActivityLinkRetentionSeconds(value: number | null): number {
  if (value === null || !Number.isFinite(value)) {
    return DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS;
  }
  return Math.min(
    MAX_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
    Math.max(MIN_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS, Math.round(value)),
  );
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
  const { updateSettings, updateClientSettingsConfirmed } = useUpdateSettings();
  const [lightingStatus, setLightingStatus] = useState<HardwareLightingStatus | null>(null);
  const [lightingBusy, setLightingBusy] = useState(false);
  const serverConfig = useServerConfig();
  const atmosphereAvailable = serverConfig?.ambientExperienceCapabilities.atmosphere === true;
  const controlsEnabled = atmosphereAvailable && settings.fallingEffectsEnabled;

  useEffect(() => {
    let cancelled = false;
    void ensureLocalApi()
      .server.getHardwareLightingStatus()
      .then((status) => {
        if (!cancelled) setLightingStatus(status);
      })
      .catch(() => {
        if (!cancelled) setLightingStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshLightingStatus = async (discover: boolean) => {
    setLightingBusy(true);
    try {
      const status = discover
        ? await ensureLocalApi().server.refreshHardwareLighting()
        : await ensureLocalApi().server.getHardwareLightingStatus();
      setLightingStatus(status);
    } catch (error) {
      console.error("[HARDWARE_LIGHTING] Status refresh failed", error);
      setLightingStatus(null);
    } finally {
      setLightingBusy(false);
    }
  };

  const commitLightingSettings = async (
    patch: Parameters<typeof updateClientSettingsConfirmed>[0],
  ) => {
    try {
      await updateClientSettingsConfirmed(patch);
      await refreshLightingStatus(false);
    } catch {
      // The settings hook already reports the failed write and rolls back.
    }
  };
  const hasNonDefaultValue =
    settings.atmosphereConsoleEnabled !== DEFAULT_ATMOSPHERE_CONSOLE_ENABLED ||
    settings.fallingEffectsEnabled !== DEFAULT_FALLING_EFFECTS_ENABLED ||
    settings.fallingEffectsOverCinemaEnabled !== DEFAULT_FALLING_EFFECTS_OVER_CINEMA_ENABLED ||
    settings.fallingEffectKind !== DEFAULT_FALLING_EFFECT_KIND ||
    settings.fallingEffectMatrixBaseFontSize !== DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE ||
    settings.fallingEffectColor !== DEFAULT_AMBIENT_COLOR ||
    settings.fallingEffectMatrixColorMode !== DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE ||
    settings.fallingEffectMatrixColorCycleSpeed !==
      DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED ||
    settings.fallingEffectMatrixMotionMode !== DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE ||
    settings.fallingEffectMatrixWalkStartFontSize !==
      DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE ||
    settings.fallingEffectMatrixWalkEndFontSize !==
      DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE ||
    settings.fallingEffectMatrixWalkLifecyclePercent !==
      DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT ||
    settings.fallingEffectMatrixCenterWindIntensity !==
      DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY ||
    settings.fallingEffectOpacity !== DEFAULT_AMBIENT_OPACITY ||
    settings.fallingEffectSpeed !== DEFAULT_FALLING_EFFECT_SPEED ||
    settings.fallingEffectDensity !== DEFAULT_FALLING_EFFECT_DENSITY ||
    settings.fallingEffectUsageReactive !== DEFAULT_FALLING_EFFECT_USAGE_REACTIVE ||
    settings.fallingEffectJapaneseRatio !== DEFAULT_FALLING_EFFECT_JAPANESE_RATIO ||
    settings.fallingEffect2chEnriched !== DEFAULT_FALLING_EFFECT_2CH_ENRICHED ||
    settings.fallingEffectLiveWorkVocabulary !== DEFAULT_FALLING_EFFECT_LIVE_WORK_VOCABULARY ||
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
    settings.fallingEffectActivityLinkRetentionSeconds !==
      DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS;

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
          hasNonDefaultValue ? (
            <SettingResetButton
              label="window atmosphere"
              onClick={() =>
                updateSettings({
                  atmosphereConsoleEnabled: DEFAULT_ATMOSPHERE_CONSOLE_ENABLED,
                  fallingEffectsEnabled: DEFAULT_FALLING_EFFECTS_ENABLED,
                  fallingEffectsOverCinemaEnabled: DEFAULT_FALLING_EFFECTS_OVER_CINEMA_ENABLED,
                  fallingEffectKind: DEFAULT_FALLING_EFFECT_KIND,
                  fallingEffectMatrixBaseFontSize: DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
                  fallingEffectColor: DEFAULT_AMBIENT_COLOR,
                  fallingEffectMatrixColorMode: DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE,
                  fallingEffectMatrixColorCycleSpeed:
                    DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
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
                  fallingEffectUsageReactive: DEFAULT_FALLING_EFFECT_USAGE_REACTIVE,
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
                  fallingEffectActivityLinkRetentionSeconds:
                    DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
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

      <SettingsRow
        title="Atmosphere console"
        description="Show the movable, resizable local atmosphere command panel. Turning this off fully unmounts the console and stops its listeners and local requests."
        control={
          <Switch
            checked={settings.atmosphereConsoleEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ atmosphereConsoleEnabled: Boolean(checked) })
            }
            aria-label="Show Atmosphere console"
          />
        }
      />

      <SettingsRow
        title="Keyboard & case RGB"
        description="Mirror the resolved Matrix palette to compatible devices through OpenRGB's local SDK server. Club Code connects only to 127.0.0.1:6742, never scans the network, and restores the previous lighting when sync stops by default."
        status={
          <span
            className={
              lightingStatus?.state === "active"
                ? "text-emerald-600 dark:text-emerald-400"
                : lightingStatus?.state === "error" || lightingStatus?.state === "unavailable"
                  ? "text-amber-600 dark:text-amber-400"
                  : undefined
            }
          >
            {lightingStatus?.detail ??
              "OpenRGB status is not available until the local backend is connected."}
          </span>
        }
        control={
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              variant="outline"
              disabled={lightingBusy}
              onClick={() => void refreshLightingStatus(true)}
            >
              {lightingBusy ? "Checking…" : "Refresh devices"}
            </Button>
            <Switch
              checked={settings.hardwareLightingSyncEnabled}
              disabled={!atmosphereAvailable || lightingBusy}
              onCheckedChange={(checked) =>
                void commitLightingSettings({ hardwareLightingSyncEnabled: Boolean(checked) })
              }
              aria-label="Sync Matrix palette to keyboard and case RGB"
            />
          </div>
        }
      >
        <div className="mt-3 space-y-3 border-t border-border/50 py-3">
          {lightingStatus?.controllers.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {lightingStatus.controllers.map((controller) => {
                const selected = settings.hardwareLightingControllerIds.includes(controller.id);
                return (
                  <label
                    key={controller.id}
                    className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border border-border/55 bg-background/35 px-3 py-2 text-xs has-data-disabled:cursor-not-allowed has-data-disabled:opacity-55"
                  >
                    <Checkbox
                      checked={selected}
                      disabled={!controller.supported || lightingBusy}
                      aria-label={`${selected ? "Remove" : "Add"} ${controller.name} lighting controller`}
                      onCheckedChange={(checked) => {
                        const next = checked
                          ? [...settings.hardwareLightingControllerIds, controller.id]
                          : settings.hardwareLightingControllerIds.filter(
                              (id) => id !== controller.id,
                            );
                        void commitLightingSettings({ hardwareLightingControllerIds: next });
                      }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">
                        {controller.name || "Unnamed OpenRGB controller"}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {[controller.vendor, controller.type, `${controller.ledCount} LEDs`]
                          .filter(Boolean)
                          .join(" · ")}
                        {controller.supported ? "" : " · Direct color mode unavailable"}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Start OpenRGB, enable its SDK server, then choose Refresh devices. OpenRGB remains the
              hardware/vendor compatibility layer; Club Code never launches vendor tools.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Brightness
              <NumberField
                value={Math.round(settings.hardwareLightingBrightness * 100)}
                min={5}
                max={100}
                step={5}
                size="sm"
                className="w-24"
                onValueCommitted={(value) => {
                  const percent =
                    value === null ? DEFAULT_HARDWARE_LIGHTING_BRIGHTNESS * 100 : value;
                  void commitLightingSettings({
                    hardwareLightingBrightness: Math.min(1, Math.max(0.05, percent / 100)),
                  });
                }}
              >
                <NumberFieldGroup>
                  <NumberFieldDecrement aria-label="Decrease hardware lighting brightness" />
                  <NumberFieldInput aria-label="Hardware lighting brightness percent" />
                  <NumberFieldIncrement aria-label="Increase hardware lighting brightness" />
                </NumberFieldGroup>
              </NumberField>
              <span>%</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={settings.hardwareLightingRestoreOnDisable}
                onCheckedChange={(checked) =>
                  void commitLightingSettings({
                    hardwareLightingRestoreOnDisable: Boolean(checked),
                  })
                }
                aria-label="Restore previous lighting when Matrix sync stops"
              />
              Restore previous lighting when sync stops
            </label>
            {(settings.hardwareLightingBrightness !== DEFAULT_HARDWARE_LIGHTING_BRIGHTNESS ||
              settings.hardwareLightingRestoreOnDisable !==
                DEFAULT_HARDWARE_LIGHTING_RESTORE_ON_DISABLE) && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void commitLightingSettings({
                    hardwareLightingBrightness: DEFAULT_HARDWARE_LIGHTING_BRIGHTNESS,
                    hardwareLightingRestoreOnDisable: DEFAULT_HARDWARE_LIGHTING_RESTORE_ON_DISABLE,
                  })
                }
              >
                Reset lighting options
              </Button>
            )}
          </div>
        </div>
      </SettingsRow>

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

      {controlsEnabled &&
      settings.fallingEffectKind === "matrix" &&
      (settings.fallingEffectMatrixMotionMode === "walk-forward" ||
        settings.fallingEffectMatrixMotionMode === "walk-reverse") ? (
        <>
          <SettingsRow
            title="Walk symbol lifecycle distance"
            description="Set how far each randomly placed Matrix stream falls before its font expansion cycle fades out and respawns elsewhere in the background."
            control={
              <div className="flex items-center gap-2">
                <WholePixelFontSizeField
                  value={settings.fallingEffectMatrixWalkLifecyclePercent}
                  fallback={DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT}
                  minimum={MIN_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT}
                  maximum={MAX_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT}
                  inputLabel="Walk symbol lifecycle distance"
                  decrementLabel="Decrease Walk symbol lifecycle distance"
                  incrementLabel="Increase Walk symbol lifecycle distance"
                  onCommit={(value) =>
                    updateSettings({ fallingEffectMatrixWalkLifecyclePercent: value })
                  }
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            }
          />
          <SettingsRow
            title="Motion from center wind intensity"
            description="Fan falling streams away from the viewport center. Centered symbols receive little horizontal motion; symbols nearer the left and right edges receive progressively stronger outward motion."
            control={
              <WholePixelFontSizeField
                value={settings.fallingEffectMatrixCenterWindIntensity}
                fallback={DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY}
                minimum={MIN_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY}
                maximum={MAX_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY}
                inputLabel="Motion from center wind intensity"
                decrementLabel="Decrease Motion from center wind intensity"
                incrementLabel="Increase Motion from center wind intensity"
                onCommit={(value) =>
                  updateSettings({ fallingEffectMatrixCenterWindIntensity: value })
                }
              />
            }
          />
        </>
      ) : null}

      {controlsEnabled && settings.fallingEffectKind === "matrix" ? (
        <SettingsRow
          title="Matrix base font size"
          description="Sets the baseline Matrix glyph size for Flat, Forward, Reverse, and Warp. Rain and snow geometry are unchanged. Walk modes continue to use their absolute Start and End sizes."
          control={
            <div className="flex items-center gap-2">
              <WholePixelFontSizeField
                value={settings.fallingEffectMatrixBaseFontSize}
                fallback={DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE}
                minimum={MIN_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE}
                maximum={MAX_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE}
                inputLabel="Matrix base font size"
                decrementLabel="Decrease Matrix base font size"
                incrementLabel="Increase Matrix base font size"
                onCommit={(value) => updateSettings({ fallingEffectMatrixBaseFontSize: value })}
              />
              <span className="text-xs text-muted-foreground">px</span>
            </div>
          }
        />
      ) : null}

      {controlsEnabled ? (
        <SettingsRow
          title="Show over cinema video"
          description="Keep only the selected falling snow, rain, or Matrix glyphs visible over the video area in Cinema workspace. Provider activity connectors stay behind the player, and video controls remain interactive. Off by default."
          control={
            <Switch
              checked={settings.fallingEffectsOverCinemaEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ fallingEffectsOverCinemaEnabled: Boolean(checked) })
              }
              aria-label="Overlay cinema video with falling atmosphere"
            />
          }
        />
      ) : null}

      {controlsEnabled ? (
        <SettingsRow
          title="Atmosphere motion"
          description="Flat preserves classic falling geometry. Forward and Reverse add subtle depth travel; Warp sends the same particles through a bounded center tunnel. Walk Forward and Walk Reverse use the configurable near/far sizes below."
          control={
            <RadioGroup
              value={settings.fallingEffectMatrixMotionMode}
              onValueChange={(value) => {
                if (
                  value === "flat" ||
                  value === "forward" ||
                  value === "reverse" ||
                  value === "tunnel" ||
                  value === "walk-forward" ||
                  value === "walk-reverse"
                ) {
                  updateSettings({ fallingEffectMatrixMotionMode: value });
                }
              }}
              aria-label="Atmosphere motion"
              className="flex-row flex-wrap gap-4"
            >
              {(
                [
                  ["flat", "Flat"],
                  ["forward", "Forward"],
                  ["reverse", "Reverse"],
                  ["tunnel", "Warp"],
                  ["walk-forward", "Walk Forward"],
                  ["walk-reverse", "Walk Reverse"],
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
          title="Walk perspective sizes"
          description="Set the absolute far and near particle sizes from 1px to 144px. Walk Reverse mirrors the same endpoints. Position, depth, and line scaling remain continuously interpolated; Matrix glyph font strings use 1px cache buckets to reduce local font-cache and canvas load."
          control={
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Start</span>
                <WholePixelFontSizeField
                  value={settings.fallingEffectMatrixWalkStartFontSize}
                  fallback={DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE}
                  minimum={MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE}
                  maximum={MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE}
                  inputLabel="Walk start font size"
                  decrementLabel="Decrease Walk start font size"
                  incrementLabel="Increase Walk start font size"
                  onCommit={(value) =>
                    updateSettings({
                      fallingEffectMatrixWalkStartFontSize: value,
                    })
                  }
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">End</span>
                <WholePixelFontSizeField
                  value={settings.fallingEffectMatrixWalkEndFontSize}
                  fallback={DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE}
                  minimum={MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE}
                  maximum={MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE}
                  inputLabel="Walk end font size"
                  decrementLabel="Decrease Walk end font size"
                  incrementLabel="Increase Walk end font size"
                  onCommit={(value) =>
                    updateSettings({
                      fallingEffectMatrixWalkEndFontSize: value,
                    })
                  }
                />
                <span className="text-xs text-muted-foreground">px</span>
              </div>
            </div>
          }
        />
      ) : null}

      {controlsEnabled && settings.fallingEffectKind === "matrix" ? (
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
            description="Controls hue motion independently of how fast the glyphs fall. 1x is the original 18-second rainbow; 16x to 64x creates a rapid shimmer. At the fastest uniform Rainbow rate, colors distribute per stream to avoid synchronized full-field flashing. Music-reactive drift remains safety-capped and preserves beat impulses. Reduced-motion mode still stops animation."
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
            description="Show short network/web, database, build/compile, and agent-delegation pulses from recognized provider tool lifecycle events. This is not raw bandwidth or system-wide activity monitoring: a connector appears only when Codex (including Codex-OSS-compatible transports), Claude, or OpenCode emits matching events for the same tool item. A local model appears only when its provider emits that lifecycle. Club Code never invents data flow or renders prompts, commands, SQL values, URLs, credentials, or hidden OS activity."
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
              <SettingsRow
                title="Verified route visibility"
                description="Keep an already verified exact provider route visible for this many seconds. Longer visibility only replays the same bounded decorative packets; it never creates activity, measures throughput, or raises the link, packet, or ring caps."
                control={
                  <div className="flex items-center gap-2">
                    <NumberField
                      value={settings.fallingEffectActivityLinkRetentionSeconds}
                      min={MIN_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS}
                      max={MAX_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS}
                      step={1}
                      size="sm"
                      className="w-28"
                      onValueChange={(value) =>
                        updateSettings({
                          fallingEffectActivityLinkRetentionSeconds:
                            clampMatrixActivityLinkRetentionSeconds(value),
                        })
                      }
                    >
                      <NumberFieldGroup>
                        <NumberFieldDecrement aria-label="Decrease verified route visibility" />
                        <NumberFieldInput aria-label="Verified route visibility seconds" />
                        <NumberFieldIncrement aria-label="Increase verified route visibility" />
                      </NumberFieldGroup>
                    </NumberField>
                    <span className="text-xs text-muted-foreground">seconds</span>
                  </div>
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
        title="Usage-reactive rain and snow"
        description="Use aggregate output-token throughput across every thread and project on this Club Code server. Your speed and density settings remain the calm baseline; active output raises them smoothly within the existing renderer caps and fades over about five seconds. No prompts, filenames, or thread identities enter the effect."
        status={
          settings.fallingEffectUsageReactive && !settings.usageStatsEnabled ? (
            <span className="text-amber-600 dark:text-amber-400">
              Usage collection is off, so the atmosphere will remain at its baseline.
            </span>
          ) : settings.fallingEffectKind === "matrix" ? (
            <span className="text-muted-foreground">
              Select rain or snow to see token-rate reactivity.
            </span>
          ) : null
        }
        control={
          <Switch
            checked={settings.fallingEffectUsageReactive}
            disabled={!controlsEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ fallingEffectUsageReactive: Boolean(checked) })
            }
            aria-label="Make rain and snow react to aggregate token usage"
          />
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
        description="Adjust how many flakes, drops, or Matrix columns fill the window. Matrix supports up to 10x density with a bounded 640-stream source pool; Walk modes cap visible streams and skip projected glyphs that would overlap."
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
