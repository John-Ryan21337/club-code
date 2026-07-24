import { SkipBackIcon, SkipForwardIcon } from "lucide-react";
import { cn } from "~/lib/utils";

import type { YouTubePlaylistController } from "../../youtubeIframeCommands";

export function YouTubePlaylistControls({
  className,
  controller,
  status,
}: {
  readonly className?: string;
  readonly controller: YouTubePlaylistController | null;
  readonly status: "connecting" | "ready" | "unavailable";
}) {
  const disabled = controller === null;
  const unavailable = status === "unavailable";
  const unavailableMessage = "Playlist unavailable: use a public or embeddable unlisted playlist.";
  return (
    <div
      role="toolbar"
      aria-label="YouTube playlist controls"
      className={cn("flex items-center gap-1", className)}
    >
      {status !== "ready" ? (
        <span
          role="status"
          className={cn(
            "mr-1 text-[10px] text-muted-foreground",
            unavailable && "text-destructive",
          )}
          title={unavailable ? unavailableMessage : "Waiting for YouTube"}
        >
          {unavailable ? "Unavailable" : "Connecting…"}
        </span>
      ) : null}
      <button
        type="button"
        aria-label="Previous YouTube playlist item"
        disabled={disabled}
        title={
          unavailable
            ? unavailableMessage
            : disabled
              ? "YouTube playlist is not ready"
              : "Previous playlist item"
        }
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => controller?.previous()}
      >
        <SkipBackIcon className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Next YouTube playlist item"
        disabled={disabled}
        title={
          unavailable
            ? unavailableMessage
            : disabled
              ? "YouTube playlist is not ready"
              : "Next playlist item"
        }
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => controller?.next()}
      >
        <SkipForwardIcon className="size-3.5" />
      </button>
    </div>
  );
}
