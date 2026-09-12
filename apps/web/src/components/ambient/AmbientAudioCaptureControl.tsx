import { SquareIcon } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  ambientAudioCaptureStore,
  useAmbientAudioCapture,
  type AmbientAudioCaptureOwner,
} from "../../ambientAudioCapture";
import { localMediaStore, useLocalMediaState } from "../../localMedia";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

/** Recheck after the DOM commit and when browser readiness changes. A stable
 * owner object alone does not rerender controls when its iframe ref is mounted
 * or focus returns from another window. Dispatch still checks the live owner. */
function subscribeCaptureReadiness(listener: () => void): () => void {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  window.addEventListener("focus", listener);
  window.addEventListener("blur", listener);
  document.addEventListener("visibilitychange", listener);
  motion.addEventListener("change", listener);
  return () => {
    window.removeEventListener("focus", listener);
    window.removeEventListener("blur", listener);
    document.removeEventListener("visibilitychange", listener);
    motion.removeEventListener("change", listener);
  };
}

export function AmbientAudioCaptureControl({
  owner,
  compact = false,
}: {
  readonly owner: AmbientAudioCaptureOwner | null;
  readonly compact?: boolean;
}) {
  const capture = useAmbientAudioCapture(),
    local = useLocalMediaState();
  const owned = ambientAudioCaptureStore.isOwnedBy(owner),
    active = capture.status === "active" && owned;
  const available = useSyncExternalStore(
    subscribeCaptureReadiness,
    () => {
      try {
        return owner?.isCurrent() === true;
      } catch {
        return false;
      }
    },
    () => false,
  );
  const stop = () => {
    if (owner) ambientAudioCaptureStore.stop(owner);
  };
  const start = () => {
    try {
      if (!owner || !owner.isCurrent()) return;
    } catch {
      return;
    }
    localMediaStore.update({ visualizerEnabled: true });
    void ambientAudioCaptureStore.start(owner);
  };
  if (compact)
    return active ? (
      <div
        role="status"
        className="pointer-events-auto absolute bottom-2 right-2 z-30 flex items-center gap-2 rounded-full border border-emerald-400/40 bg-black/85 px-3 py-1 text-xs text-white"
      >
        Audio analysis active{" "}
        <button
          type="button"
          aria-label="Stop shared audio"
          className="rounded px-2 py-1 hover:bg-white/20 focus-visible:outline focus-visible:outline-2"
          onClick={stop}
        >
          <SquareIcon className="inline size-3" aria-hidden="true" /> Stop
        </button>
      </div>
    ) : null;
  return (
    <div className="grid gap-3 py-3">
      <p className="text-xs text-muted-foreground">
        Desktop shares only this Cafe window. Browser builds use their source chooser. Video tracks
        are stopped immediately. There is no microphone fallback, recording, upload, or saved audio.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!available || capture.status === "requesting"}
          onClick={start}
        >
          Start shared audio analysis
        </Button>
        {active || (capture.status === "requesting" && owned) ? (
          <Button type="button" size="sm" variant="outline" onClick={stop}>
            Stop shared audio
          </Button>
        ) : null}
        <Select
          value={local.visualizerStyle}
          onValueChange={(value) =>
            localMediaStore.update({
              visualizerStyle: value === "milkdrop" ? "milkdrop" : "spectrum",
            })
          }
        >
          <SelectTrigger aria-label="Shared audio visualizer style" className="w-36">
            <SelectValue>
              {local.visualizerStyle === "milkdrop" ? "MilkDrop" : "Spectrum"}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value="spectrum">Spectrum</SelectItem>
            <SelectItem value="milkdrop">MilkDrop</SelectItem>
          </SelectPopup>
        </Select>
        <label className="flex items-center gap-2 text-xs">
          <Switch
            aria-label="Enable shared audio visualizer"
            checked={local.visualizerEnabled}
            disabled={!available}
            onCheckedChange={(enabled) => {
              localMediaStore.update({ visualizerEnabled: enabled });
              if (!enabled) stop();
            }}
          />
          Visualizer
        </label>
      </div>
      {local.visualizerStyle === "milkdrop" ? (
        <p className="text-xs text-muted-foreground">
          MilkDrop can contain rapid motion and flashing colors. Use the player toolbar to change
          presets.
        </p>
      ) : null}
      {capture.status === "requesting" ? (
        <p role="status" className="text-xs">
          Finish or close the pending share request. Stopping here cannot close the browser chooser;
          any late stream is discarded.
        </p>
      ) : active ? (
        <p role="status" className="text-xs text-emerald-600 dark:text-emerald-400">
          Shared audio is active for this player session. Stop it here or in the player.
        </p>
      ) : capture.status === "error" && owned ? (
        <p role="alert" className="text-xs text-destructive">
          {capture.failure.message}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Open a visible streaming player and keep this window focused to start. A source may
          provide no audio.
        </p>
      )}
    </div>
  );
}
