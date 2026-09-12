import {
  DEFAULT_AMBIENT_IMAGE_GLOW_COLOR,
  DEFAULT_AMBIENT_IMAGE_GLOW_ENABLED,
  DEFAULT_AMBIENT_IMAGE_GLOW_OPACITY,
  DEFAULT_AMBIENT_IMAGE_LAYOUT_MODE,
  DEFAULT_AMBIENT_IMAGE_PRESENTATION_MODE,
  DEFAULT_AMBIENT_IMAGE_PRESET_PLACEMENT,
  DEFAULT_AMBIENT_IMAGE_PRESET_SIZE,
  MAX_AMBIENT_IMAGE_GLOW_OPACITY,
  MIN_AMBIENT_IMAGE_GLOW_OPACITY,
  type AmbientImageLayoutMode,
  type AmbientImagePresetPlacement,
  type AmbientImagePresetSize,
} from "@cafecode/contracts/settings";

import { resetAmbientImageGeometry } from "../../ambientImageGeometry";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";

/**
 * Presentation controls for the floating ambient image panel.
 *
 * These rows change only how the image is shown. They never change which image
 * is selected, what the library holds, or whether the feature is on. The panel
 * geometry that a drag produces is a per-device value and stays in browser
 * storage; see `apps/web/src/ambientImageGeometry.ts`.
 */
const LAYOUT_MODES: readonly { value: AmbientImageLayoutMode; label: string }[] = [
  { value: "preset", label: "Preset" },
  { value: "custom", label: "Custom" },
];
const PLACEMENTS: readonly { value: AmbientImagePresetPlacement; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
];
const SIZES: readonly { value: AmbientImagePresetSize; label: string }[] = [
  { value: "small", label: "Small" },
  { value: "medium", label: "Medium" },
  { value: "large", label: "Large" },
];
const SELECT_CLASS = "rounded-md border border-border bg-transparent px-2 py-1 text-sm";
const FALLBACK_GLOW_COLOR = "#7dd3fc";

export function AmbientImagePanelSettingsRows() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const presetLayout = settings.ambientImageLayoutMode === "preset";

  return (
    <>
      <SettingsRow
        title="Layout"
        description="Preset keeps the panel in a window corner. Custom keeps the position and size you set with the panel handles. A drag or an arrow key changes this to Custom."
        control={
          <select
            className={SELECT_CLASS}
            value={settings.ambientImageLayoutMode}
            aria-label="Ambient image layout"
            onChange={(event) => {
              const value = event.target.value;
              if (value === "preset" || value === "custom") {
                updateSettings({ ambientImageLayoutMode: value });
              }
            }}
          >
            {LAYOUT_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        }
      />

      <SettingsRow
        title="Preset corner"
        description="Select the window corner for the preset layout. Custom layout ignores this value."
        control={
          <select
            className={SELECT_CLASS}
            value={settings.ambientImagePresetPlacement}
            disabled={!presetLayout}
            aria-label="Ambient image preset corner"
            onChange={(event) => {
              const value = PLACEMENTS.find((entry) => entry.value === event.target.value);
              if (value) updateSettings({ ambientImagePresetPlacement: value.value });
            }}
          >
            {PLACEMENTS.map((placement) => (
              <option key={placement.value} value={placement.value}>
                {placement.label}
              </option>
            ))}
          </select>
        }
      />

      <SettingsRow
        title="Preset size"
        description="The image keeps its proportions inside the panel. Extreme shapes get space around the image so the controls remain usable. Sizes shrink to fit the window."
        control={
          <select
            className={SELECT_CLASS}
            value={settings.ambientImagePresetSize}
            disabled={!presetLayout}
            aria-label="Ambient image preset size"
            onChange={(event) => {
              const value = SIZES.find((entry) => entry.value === event.target.value);
              if (value) updateSettings({ ambientImagePresetSize: value.value });
            }}
          >
            {SIZES.map((size) => (
              <option key={size.value} value={size.value}>
                {size.label}
              </option>
            ))}
          </select>
        }
      />

      <SettingsRow
        title="Panel glow"
        description="Add a soft colored glow around the floating panel. Theater presentation does not use the glow."
        control={
          <Switch
            checked={settings.ambientImageGlowEnabled}
            onCheckedChange={(checked) =>
              updateSettings({ ambientImageGlowEnabled: Boolean(checked) })
            }
            aria-label="Enable ambient image glow"
          />
        }
      >
        {settings.ambientImageGlowEnabled ? (
          <div className="flex flex-wrap items-center gap-4 pt-1 pb-3.5">
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              Color
              <input
                type="color"
                className="h-6 w-10 rounded border border-border bg-transparent"
                aria-label="Ambient image glow color"
                value={
                  settings.ambientImageGlowColor === "auto"
                    ? FALLBACK_GLOW_COLOR
                    : settings.ambientImageGlowColor
                }
                onChange={(event) => {
                  const value = event.target.value.toLowerCase();
                  // The schema accepts `auto` or a six-digit hex triplet only.
                  if (/^#[0-9a-f]{6}$/.test(value)) {
                    updateSettings({ ambientImageGlowColor: value });
                  }
                }}
              />
            </label>
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              Intensity
              <input
                type="range"
                aria-label="Ambient image glow intensity"
                min={MIN_AMBIENT_IMAGE_GLOW_OPACITY}
                max={MAX_AMBIENT_IMAGE_GLOW_OPACITY}
                step={0.05}
                value={settings.ambientImageGlowOpacity}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (
                    Number.isFinite(next) &&
                    next >= MIN_AMBIENT_IMAGE_GLOW_OPACITY &&
                    next <= MAX_AMBIENT_IMAGE_GLOW_OPACITY
                  ) {
                    updateSettings({ ambientImageGlowOpacity: next });
                  }
                }}
              />
            </label>
          </div>
        ) : null}
      </SettingsRow>

      <SettingsRow
        title="Reset the panel"
        description="Restores the presentation defaults and the preset corner. Your images and your selected image stay in the library."
        resetAction={
          <SettingResetButton
            label="ambient image panel"
            onClick={() => {
              resetAmbientImageGeometry();
              updateSettings({
                ambientImagePresentationMode: DEFAULT_AMBIENT_IMAGE_PRESENTATION_MODE,
                ambientImageLayoutMode: DEFAULT_AMBIENT_IMAGE_LAYOUT_MODE,
                ambientImagePresetPlacement: DEFAULT_AMBIENT_IMAGE_PRESET_PLACEMENT,
                ambientImagePresetSize: DEFAULT_AMBIENT_IMAGE_PRESET_SIZE,
                ambientImageGlowEnabled: DEFAULT_AMBIENT_IMAGE_GLOW_ENABLED,
                ambientImageGlowColor: DEFAULT_AMBIENT_IMAGE_GLOW_COLOR,
                ambientImageGlowOpacity: DEFAULT_AMBIENT_IMAGE_GLOW_OPACITY,
              });
            }}
          />
        }
      />
    </>
  );
}
