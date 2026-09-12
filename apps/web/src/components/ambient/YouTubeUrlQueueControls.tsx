import { useYouTubeUrlQueue, youtubeUrlQueueStore } from "../../youtubeQueuePlayback";
import { useAmbientVideoWorkspace } from "./AmbientVideoWorkspace";

export function YouTubeUrlQueueControls({ className = "" }: { readonly className?: string }) {
  const { environmentScopeKey } = useAmbientVideoWorkspace();
  const queue = useYouTubeUrlQueue(environmentScopeKey);
  if (!queue.active) return null;
  return (
    <div
      role="toolbar"
      aria-label="YouTube queue controls"
      className={`flex min-w-0 items-center gap-2 text-xs ${className}`}
    >
      <span className="truncate" title={queue.name}>
        {queue.index + 1}/{queue.videoIds.length}
      </span>
      <button
        type="button"
        aria-label="Previous queued video"
        className="rounded px-2 py-1 hover:bg-muted focus-visible:ring-2"
        disabled={queue.index === 0}
        onClick={youtubeUrlQueueStore.previous}
      >
        Previous
      </button>
      <button
        type="button"
        aria-label="Next queued video"
        className="rounded px-2 py-1 hover:bg-muted focus-visible:ring-2"
        onClick={youtubeUrlQueueStore.next}
      >
        Next
      </button>
      <button
        type="button"
        aria-label="Stop YouTube queue"
        className="rounded px-2 py-1 hover:bg-muted focus-visible:ring-2"
        onClick={youtubeUrlQueueStore.stop}
      >
        Stop
      </button>
    </div>
  );
}
