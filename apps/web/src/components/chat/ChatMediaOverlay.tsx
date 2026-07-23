import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../rpc/serverState";

import { AmbientImagePanel } from "./AmbientImagePanel";
import { useAmbientVideoWorkspace } from "../ambient/AmbientVideoWorkspace";

/** Relative-message-wrapper overlay. It intentionally owns no timeline state. */
export function ChatMediaOverlay() {
  const { cinemaEffective } = useAmbientVideoWorkspace();
  const media = useSettings((settings) => ({
    enabled: settings.ambientImageEnabled,
    asset: settings.ambientImageAsset,
    layoutMode: settings.ambientImageLayoutMode,
    placement: settings.ambientImagePresetPlacement,
    size: settings.ambientImagePresetSize,
    glow: settings.ambientImageGlowEnabled,
    glowColor: settings.ambientImageGlowColor,
    glowOpacity: settings.ambientImageGlowOpacity,
    continueBackgroundAnimations: settings.continueBackgroundAnimations,
    videoEnabled: settings.ambientVideoEnabled,
    videoSource: settings.ambientVideoSource,
    videoLayoutMode: settings.ambientVideoLayoutMode,
    videoPlacement: settings.ambientVideoPresetPlacement,
    videoSize: settings.ambientVideoPresetSize,
    videoPresentation: settings.ambientVideoPresentationMode,
  }));
  const serverConfig = useServerConfig();
  const { updateSettings } = useUpdateSettings();
  if (cinemaEffective || !media.enabled || media.asset === null) {
    return null;
  }
  const stackedVideoSize =
    media.layoutMode === "preset" &&
    serverConfig?.ambientExperienceCapabilities.youtubePlayer === true &&
    media.videoEnabled &&
    media.videoSource !== null &&
    media.videoPresentation === "floating" &&
    media.videoLayoutMode === "preset" &&
    media.videoPlacement === media.placement
      ? media.videoSize
      : null;
  return (
    <AmbientImagePanel
      asset={media.asset}
      layoutMode={media.layoutMode}
      placement={media.placement}
      size={media.size}
      stackedVideoSize={stackedVideoSize}
      glow={media.glow}
      glowColor={media.glowColor}
      glowOpacity={media.glowOpacity}
      continueBackgroundAnimations={media.continueBackgroundAnimations}
      onDisable={() => updateSettings({ ambientImageEnabled: false })}
    />
  );
}
