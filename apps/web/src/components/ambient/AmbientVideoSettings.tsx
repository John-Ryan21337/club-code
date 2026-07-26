import {
  DEFAULT_AMBIENT_VIDEO_ENABLED,
  DEFAULT_AMBIENT_VIDEO_PRESET_PLACEMENT,
  DEFAULT_AMBIENT_VIDEO_PRESET_SIZE,
  DEFAULT_AMBIENT_VIDEO_PRESENTATION_MODE,
  DEFAULT_AMBIENT_VIDEO_SOURCE,
} from "@cafecode/contracts/settings";

import { parseYouTubeSource, youtubeSourceInputValue } from "../../ambientVideo";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../rpc/serverState";
import { DraftInput } from "../ui/draft-input";
import { Radio, RadioGroup } from "../ui/radio-group";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "../settings/settingsLayout";

export function AmbientVideoSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const serverConfig = useServerConfig();
  const playerAvailable = serverConfig?.ambientExperienceCapabilities.youtubePlayer === true;
  const hasNonDefault =
    settings.ambientVideoEnabled !== DEFAULT_AMBIENT_VIDEO_ENABLED ||
    settings.ambientVideoSource !== DEFAULT_AMBIENT_VIDEO_SOURCE ||
    settings.ambientVideoPresetPlacement !== DEFAULT_AMBIENT_VIDEO_PRESET_PLACEMENT ||
    settings.ambientVideoPresetSize !== DEFAULT_AMBIENT_VIDEO_PRESET_SIZE ||
    settings.ambientVideoPresentationMode !== DEFAULT_AMBIENT_VIDEO_PRESENTATION_MODE;

  return (
    <SettingsSection title="Ambient YouTube">
      <SettingsRow
        title="Preset player"
        description="Show a privacy-enhanced YouTube video or playlist without leaving Cafe Code."
        status={
          playerAvailable ? null : (
            <span className="text-amber-600 dark:text-amber-400">
              This server has not enabled the YouTube player capability.
            </span>
          )
        }
        resetAction={
          hasNonDefault ? (
            <SettingResetButton
              label="ambient YouTube"
              onClick={() =>
                updateSettings({
                  ambientVideoEnabled: DEFAULT_AMBIENT_VIDEO_ENABLED,
                  ambientVideoSource: DEFAULT_AMBIENT_VIDEO_SOURCE,
                  ambientVideoPresetPlacement: DEFAULT_AMBIENT_VIDEO_PRESET_PLACEMENT,
                  ambientVideoPresetSize: DEFAULT_AMBIENT_VIDEO_PRESET_SIZE,
                  ambientVideoPresentationMode: DEFAULT_AMBIENT_VIDEO_PRESENTATION_MODE,
                })
              }
            />
          ) : null
        }
        control={
          <Switch
            aria-label="Show ambient YouTube player"
            checked={settings.ambientVideoEnabled}
            disabled={!playerAvailable || settings.ambientVideoSource === null}
            onCheckedChange={(checked) => updateSettings({ ambientVideoEnabled: Boolean(checked) })}
          />
        }
      />
      <SettingsRow
        title="YouTube URL"
        description="Paste a supported HTTPS YouTube video or playlist URL, or an 11-character video ID."
        control={
          <DraftInput
            aria-label="Ambient YouTube URL"
            className="w-full sm:w-80"
            maxLength={2_048}
            value={youtubeSourceInputValue(settings.ambientVideoSource)}
            onCommit={(value) => {
              const source = parseYouTubeSource(value);
              updateSettings({
                ambientVideoSource: source,
                ...(source === null ? { ambientVideoEnabled: false } : {}),
              });
            }}
          />
        }
      />
      <SettingsRow
        title="Corner"
        description="Choose the floating-player corner."
        control={
          <RadioGroup
            aria-label="Ambient YouTube corner"
            className="flex-row gap-4"
            value={settings.ambientVideoPresetPlacement}
            onValueChange={(value) => {
              if (value === "bottom-left" || value === "bottom-right") {
                updateSettings({ ambientVideoPresetPlacement: value });
              }
            }}
          >
            <label className="flex items-center gap-1.5 text-xs">
              <Radio value="bottom-left" /> Bottom left
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <Radio value="bottom-right" /> Bottom right
            </label>
          </RadioGroup>
        }
      />
      <SettingsRow
        title="Size"
        description="Choose a bounded floating-player width."
        control={
          <RadioGroup
            aria-label="Ambient YouTube size"
            className="flex-row gap-4"
            value={settings.ambientVideoPresetSize}
            onValueChange={(value) => {
              if (value === "small" || value === "medium" || value === "large") {
                updateSettings({ ambientVideoPresetSize: value });
              }
            }}
          >
            {(["small", "medium", "large"] as const).map((size) => (
              <label className="flex items-center gap-1.5 text-xs capitalize" key={size}>
                <Radio value={size} /> {size}
              </label>
            ))}
          </RadioGroup>
        }
      />
      <SettingsRow
        title="Presentation"
        description="Cinema enlarges the same player session; switching modes does not restart playback."
        control={
          <RadioGroup
            aria-label="Ambient YouTube presentation"
            className="flex-row gap-4"
            value={settings.ambientVideoPresentationMode}
            onValueChange={(value) => {
              if (value === "floating" || value === "cinema") {
                updateSettings({ ambientVideoPresentationMode: value });
              }
            }}
          >
            <label className="flex items-center gap-1.5 text-xs">
              <Radio value="floating" /> Floating
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <Radio value="cinema" /> Cinema
            </label>
          </RadioGroup>
        }
      />
    </SettingsSection>
  );
}
