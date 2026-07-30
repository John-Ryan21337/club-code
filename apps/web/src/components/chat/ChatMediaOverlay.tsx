import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { type LocalMediaPresetSize, useLocalMediaState } from "../../localMedia";
import { useServerConfig } from "../../rpc/serverState";

import { AmbientImagePanel } from "./AmbientImagePanel";
import { useAmbientVideoWorkspace } from "../ambient/AmbientVideoWorkspace";

/** Relative-message-wrapper overlay. It intentionally owns no timeline state. */
export function ChatMediaOverlay() {
  const { cinemaEffective } = useAmbientVideoWorkspace();
  const localMedia = useLocalMediaState();
  const media = useSettings((settings) => ({
    enabled: settings.ambientImageEnabled,
    asset: settings.ambientImageAsset,
    cycleAssets: settings.ambientImageCycleAssets,
    cycleEnabled: settings.ambientImageCycleEnabled,
    cycleSeconds: settings.ambientImageCycleSeconds,
    presentationMode: settings.ambientImagePresentationMode,
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
  const firstAmbientImage = media.asset ?? media.cycleAssets[0] ?? null;
  const showAmbientImage =
    !cinemaEffective &&
    media.enabled &&
    (media.asset !== null || (media.cycleEnabled && media.cycleAssets.length > 0));
  const streamingCapability =
    media.videoSource?.kind === "spotify"
      ? serverConfig?.ambientExperienceCapabilities.spotifyEmbed === true
      : serverConfig?.ambientExperienceCapabilities.youtubePlayer === true;
  const streamingStackedSize =
    media.layoutMode === "preset" &&
    streamingCapability &&
    media.videoEnabled &&
    media.videoSource !== null &&
    media.videoPresentation === "floating" &&
    media.videoLayoutMode === "preset" &&
    media.videoPlacement === media.placement
      ? media.videoSize
      : null;
  const localStackedSize =
    media.layoutMode === "preset" &&
    !cinemaEffective &&
    localMedia.source !== null &&
    localMedia.presentationMode !== "background" &&
    localMedia.layoutMode === "preset" &&
    localMedia.presetPlacement === media.placement
      ? localMedia.presetSize
      : null;
  const stackedVideoSize = largestPresetSize(streamingStackedSize, localStackedSize);
  return (
    <div
      className="pointer-events-none absolute inset-0 z-20 overflow-visible"
      data-chat-media-overlay="true"
    >
      {showAmbientImage && firstAmbientImage ? (
        <AmbientImagePanel
          asset={firstAmbientImage}
          cycleAssets={media.cycleAssets}
          cycleEnabled={media.cycleEnabled}
          cycleSeconds={media.cycleSeconds}
          presentationMode={media.presentationMode}
          layoutMode={media.layoutMode}
          placement={media.placement}
          size={media.size}
          stackedVideoSize={stackedVideoSize}
          glow={media.glow}
          glowColor={media.glowColor}
          glowOpacity={media.glowOpacity}
          continueBackgroundAnimations={media.continueBackgroundAnimations}
          onRequestCustomLayout={() => updateSettings({ ambientImageLayoutMode: "custom" })}
          onDisable={() => updateSettings({ ambientImageEnabled: false })}
        />
      ) : null}
    </div>
  );
}

const PRESET_SIZE_ORDER: Readonly<Record<LocalMediaPresetSize, number>> = {
  small: 0,
  medium: 1,
  large: 2,
};

function largestPresetSize(
  left: LocalMediaPresetSize | null,
  right: LocalMediaPresetSize | null,
): LocalMediaPresetSize | null {
  if (left === null) return right;
  if (right === null) return left;
  return PRESET_SIZE_ORDER[left] >= PRESET_SIZE_ORDER[right] ? left : right;
}
