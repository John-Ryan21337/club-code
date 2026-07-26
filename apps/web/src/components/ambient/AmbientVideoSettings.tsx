import {
  DEFAULT_AMBIENT_VIDEO_ENABLED,
  DEFAULT_AMBIENT_VIDEO_KEEP_ABOVE_CONTENT,
  DEFAULT_AMBIENT_VIDEO_PRESET_PLACEMENT,
  DEFAULT_AMBIENT_VIDEO_PRESET_SIZE,
  DEFAULT_AMBIENT_VIDEO_PRESENTATION_MODE,
  DEFAULT_AMBIENT_VIDEO_SOURCE,
} from "@cafecode/contracts/settings";
import { useEffect, useState } from "react";

import { parseYouTubeSource, youtubeSourceInputValue } from "../../ambientVideo";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../rpc/serverState";
import { DraftInput } from "../ui/draft-input";
import { Radio, RadioGroup } from "../ui/radio-group";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow, SettingsSection } from "../settings/settingsLayout";

const AMBIENT_YOUTUBE_URL_ERROR_ID = "ambient-youtube-url-error";

export function AmbientVideoSettings() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const serverConfig = useServerConfig();
  const sourceInputValue = youtubeSourceInputValue(settings.ambientVideoSource);
  const [sourceInputError, setSourceInputError] = useState<string | null>(null);
  const playerAvailable = serverConfig?.ambientExperienceCapabilities.youtubePlayer === true;
  const hasNonDefault =
    settings.ambientVideoEnabled !== DEFAULT_AMBIENT_VIDEO_ENABLED ||
    settings.ambientVideoSource !== DEFAULT_AMBIENT_VIDEO_SOURCE ||
    settings.ambientVideoPresetPlacement !== DEFAULT_AMBIENT_VIDEO_PRESET_PLACEMENT ||
    settings.ambientVideoPresetSize !== DEFAULT_AMBIENT_VIDEO_PRESET_SIZE ||
    settings.ambientVideoPresentationMode !== DEFAULT_AMBIENT_VIDEO_PRESENTATION_MODE ||
    settings.ambientVideoKeepAboveContent !== DEFAULT_AMBIENT_VIDEO_KEEP_ABOVE_CONTENT;

  useEffect(() => {
    setSourceInputError(null);
  }, [sourceInputValue]);

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
              onClick={() => {
                setSourceInputError(null);
                updateSettings({
                  ambientVideoEnabled: DEFAULT_AMBIENT_VIDEO_ENABLED,
                  ambientVideoSource: DEFAULT_AMBIENT_VIDEO_SOURCE,
                  ambientVideoPresetPlacement: DEFAULT_AMBIENT_VIDEO_PRESET_PLACEMENT,
                  ambientVideoPresetSize: DEFAULT_AMBIENT_VIDEO_PRESET_SIZE,
                  ambientVideoPresentationMode: DEFAULT_AMBIENT_VIDEO_PRESENTATION_MODE,
                  ambientVideoKeepAboveContent: DEFAULT_AMBIENT_VIDEO_KEEP_ABOVE_CONTENT,
                });
              }}
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
        status={
          sourceInputError === null ? null : (
            <span className="text-destructive" id={AMBIENT_YOUTUBE_URL_ERROR_ID} role="alert">
              {sourceInputError}
            </span>
          )
        }
        control={
          <DraftInput
            aria-label="Ambient YouTube URL"
            aria-describedby={sourceInputError === null ? undefined : AMBIENT_YOUTUBE_URL_ERROR_ID}
            aria-invalid={sourceInputError === null ? undefined : true}
            className="w-full sm:w-80"
            maxLength={2_048}
            value={sourceInputValue}
            onInput={() => setSourceInputError(null)}
            onCommit={(value) => {
              if (value.trim().length === 0) {
                setSourceInputError(null);
                updateSettings({
                  ambientVideoSource: null,
                  ambientVideoEnabled: false,
                });
                return;
              }
              const source = parseYouTubeSource(value);
              if (source === null) {
                setSourceInputError(
                  "That is not a supported YouTube video or playlist. The current player was not changed.",
                );
                return;
              }
              setSourceInputError(null);
              updateSettings({
                ambientVideoSource: source,
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
        title="Keep above app content"
        description="Raise the player above chat and Settings inside Cafe Code. This does not keep the desktop window above other applications."
        control={
          <Switch
            aria-label="Keep ambient YouTube above app content"
            checked={settings.ambientVideoKeepAboveContent}
            onCheckedChange={(checked) =>
              updateSettings({ ambientVideoKeepAboveContent: Boolean(checked) })
            }
          />
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
