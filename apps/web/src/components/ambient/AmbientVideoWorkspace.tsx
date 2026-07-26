import type { CSSProperties } from "react";
import type {
  AmbientMediaPresetPlacement,
  AmbientMediaPresetSize,
  AmbientVideoPresentationMode,
} from "@cafecode/contracts/settings";

import { youtubeEmbedUrl } from "../../ambientVideo";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { useServerConfig } from "../../rpc/serverState";

const PRESET_WIDTHS: Readonly<Record<AmbientMediaPresetSize, number>> = {
  small: 360,
  medium: 480,
  large: 640,
};

function floatingPosition(placement: AmbientMediaPresetPlacement): CSSProperties {
  return placement === "bottom-left"
    ? { left: "1rem", bottom: "1rem" }
    : { right: "1rem", bottom: "1rem" };
}

function playerStyle(input: {
  readonly placement: AmbientMediaPresetPlacement;
  readonly presentationMode: AmbientVideoPresentationMode;
  readonly size: AmbientMediaPresetSize;
}): CSSProperties {
  if (input.presentationMode === "cinema") {
    return {
      left: "50%",
      top: "1rem",
      width: "min(960px, calc(100vw - 2rem))",
      transform: "translateX(-50%)",
    };
  }

  const width = PRESET_WIDTHS[input.size];
  return {
    ...floatingPosition(input.placement),
    width: `min(${width}px, calc(100vw - 2rem))`,
  };
}

/**
 * The player component owns one iframe for the lifetime of its normalized
 * source. Presentation updates change only styling and never create a second
 * player or move the frame to another parent.
 */
// oxlint-disable react/iframe-missing-sandbox -- youtubeEmbedUrl constructs only a
// cross-origin youtube-nocookie URL; YouTube requires scripts and its own origin
// to run the embedded player API.
export function AmbientVideoWorkspace() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const serverConfig = useServerConfig();
  const source = settings.ambientVideoSource;
  const available = serverConfig?.ambientExperienceCapabilities.youtubePlayer === true;

  if (!available || !settings.ambientVideoEnabled || source === null) {
    return null;
  }

  return (
    <section
      aria-label="Ambient YouTube player"
      className="fixed z-30 overflow-hidden rounded-xl border border-border/60 bg-black shadow-2xl"
      data-presentation-mode={settings.ambientVideoPresentationMode}
      data-testid="ambient-video-player"
      style={playerStyle({
        placement: settings.ambientVideoPresetPlacement,
        presentationMode: settings.ambientVideoPresentationMode,
        size: settings.ambientVideoPresetSize,
      })}
    >
      <iframe
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        className="block aspect-video w-full border-0 bg-black"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        src={youtubeEmbedUrl(source)}
        title={
          source.kind === "video"
            ? "Ambient YouTube video player"
            : "Ambient YouTube playlist player"
        }
      />
      <button
        type="button"
        className="absolute top-2 right-2 rounded-md bg-black/70 px-2 py-1 text-xs text-white"
        aria-label="Close ambient YouTube player"
        onClick={() => updateSettings({ ambientVideoEnabled: false })}
      >
        Close
      </button>
    </section>
  );
}
// oxlint-enable react/iframe-missing-sandbox
