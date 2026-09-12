import { YoutubeIcon } from "lucide-react";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../rpc/serverState";
import { useUiLocalization } from "../../uiLocalization";
import { useYouTubeUrlQueue } from "../../youtubeUrlQueue";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function YouTubePlayerToggle() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const config = useServerConfig();
  const queue = useYouTubeUrlQueue();
  const { t } = useUiLocalization();
  const source = queue.currentSource ?? settings.ambientVideoSource;
  if (!source || source.kind === "spotify") return null;

  const available = config?.ambientExperienceCapabilities.youtubePlayer === true;
  const label = settings.ambientVideoEnabled
    ? t("Turn YouTube player off", "YouTubeプレーヤーをオフにする")
    : t("Turn YouTube player on", "YouTubeプレーヤーをオンにする");
  const help =
    !available && !settings.ambientVideoEnabled
      ? t("Enable YouTube in settings first", "先に設定でYouTubeを有効にしてください")
      : label;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-label={label}
            title={help}
            pressed={settings.ambientVideoEnabled}
            disabled={!available && !settings.ambientVideoEnabled}
            onPressedChange={(enabled) => updateSettings({ ambientVideoEnabled: enabled })}
            variant="outline"
            size="sm"
            className="w-[calc(2rem*2.414)] sm:w-[calc(1.75rem*2.414)]"
            data-youtube-player-toggle="true"
          >
            <YoutubeIcon aria-hidden="true" className="size-4" />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{help}</TooltipPopup>
    </Tooltip>
  );
}
