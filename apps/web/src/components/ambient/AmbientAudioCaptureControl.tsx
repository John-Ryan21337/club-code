import { AudioLinesIcon, LoaderIcon, SquareIcon } from "lucide-react";

import { ambientAudioCaptureStore, useAmbientAudioCapture } from "../../ambientAudioCapture";
import { localMediaStore, useLocalMediaState } from "../../localMedia";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";

function startAmbientAudioCapture(): void {
  // Keep the getDisplayMedia call in the click stack. Electron independently
  // verifies request.userGesture before granting its trusted app frame.
  void ambientAudioCaptureStore.start().then((started) => {
    if (started && !localMediaStore.getSnapshot().visualizerEnabled) {
      localMediaStore.update({ visualizerEnabled: true });
    }
  });
}

export function AmbientAudioCaptureControl({
  available,
  compact = false,
  className,
}: {
  readonly available: boolean;
  readonly compact?: boolean;
  readonly className?: string;
}) {
  const capture = useAmbientAudioCapture();
  const localMedia = useLocalMediaState();

  if (compact) {
    return capture.status === "active" ? (
      <div
        role="status"
        className={cn(
          "flex items-center gap-1 rounded-full border border-emerald-400/35 bg-black/75 px-2 py-1 text-[10px] text-white shadow-lg",
          className,
        )}
      >
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
        Shared audio active
        <button
          type="button"
          className="ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          onClick={() => ambientAudioCaptureStore.stop()}
        >
          <SquareIcon aria-hidden="true" className="size-2.5" />
          Stop
        </button>
      </div>
    ) : null;
  }

  return (
    <div className={cn("grid w-full max-w-md gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {capture.status === "active" ? (
          <Button
            size="xs"
            type="button"
            variant="outline"
            onClick={() => ambientAudioCaptureStore.stop()}
          >
            <SquareIcon aria-hidden="true" className="size-3.5" />
            Stop shared audio
          </Button>
        ) : (
          <Button
            disabled={!available || capture.status === "requesting"}
            size="xs"
            type="button"
            variant="outline"
            onClick={startAmbientAudioCapture}
          >
            {capture.status === "requesting" ? (
              <LoaderIcon aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <AudioLinesIcon aria-hidden="true" className="size-3.5" />
            )}
            {capture.status === "requesting" ? "Waiting for chooser…" : "Choose audio to share"}
          </Button>
        )}
        <label className="flex items-center gap-2 text-xs">
          <Switch
            aria-label="Enable shared audio visualizer"
            checked={localMedia.visualizerEnabled}
            disabled={!available}
            onCheckedChange={(visualizerEnabled) => {
              localMediaStore.update({ visualizerEnabled });
              if (!visualizerEnabled) ambientAudioCaptureStore.stop();
            }}
          />
          Visualizer
        </label>
      </div>
      {capture.status === "active" ? (
        <span role="status" className="text-xs text-emerald-600 dark:text-emerald-400">
          Shared audio is active for this session. Club Code does not record, upload, or save it.
        </span>
      ) : capture.status === "error" ? (
        <span role="alert" className="text-xs text-destructive">
          {capture.failure.message}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">
          Your browser chooses the tab, window, or screen and whether audio is shared. The desktop
          app grants only this Club Code window. There is no microphone fallback.
        </span>
      )}
    </div>
  );
}
