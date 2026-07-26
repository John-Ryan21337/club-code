import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../rpc/serverState";

import { AmbientImagePanel } from "./AmbientImagePanel";

/**
 * Relative-message-wrapper overlay. It intentionally owns no timeline state.
 *
 * This shell currently hosts only the ambient image panel. Companion media
 * panels (ambient video, local media) mount here as they land; until then no
 * same-corner panel exists, so the image never needs to stack above one.
 */
export function ChatMediaOverlay() {
  const serverConfig = useServerConfig();
  const media = useSettings((settings) => ({
    enabled: settings.ambientImageEnabled,
    asset: settings.ambientImageAsset,
    cycleAssets: settings.ambientImageCycleAssets,
    cycleEnabled: settings.ambientImageCycleEnabled,
    cycleSeconds: settings.ambientImageCycleSeconds,
    presentationMode: settings.ambientImagePresentationMode,
    placement: settings.ambientImagePresetPlacement,
    size: settings.ambientImagePresetSize,
    glow: settings.ambientImageGlowEnabled,
    glowColor: settings.ambientImageGlowColor,
    glowOpacity: settings.ambientImageGlowOpacity,
    continueBackgroundAnimations: settings.continueBackgroundAnimations,
  }));
  const { updateSettings } = useUpdateSettings();
  const firstAmbientImage = media.asset ?? media.cycleAssets[0] ?? null;
  const showAmbientImage =
    serverConfig?.ambientExperienceCapabilities.ambientImage === true &&
    media.enabled &&
    (media.asset !== null || (media.cycleEnabled && media.cycleAssets.length > 0));
  return (
    <>
      {showAmbientImage && firstAmbientImage ? (
        <AmbientImagePanel
          asset={firstAmbientImage}
          cycleAssets={media.cycleAssets}
          cycleEnabled={media.cycleEnabled}
          cycleSeconds={media.cycleSeconds}
          presentationMode={media.presentationMode}
          placement={media.placement}
          size={media.size}
          stackedVideoSize={null}
          glow={media.glow}
          glowColor={media.glowColor}
          glowOpacity={media.glowOpacity}
          continueBackgroundAnimations={media.continueBackgroundAnimations}
          onDisable={() => updateSettings({ ambientImageEnabled: false })}
        />
      ) : null}
    </>
  );
}
