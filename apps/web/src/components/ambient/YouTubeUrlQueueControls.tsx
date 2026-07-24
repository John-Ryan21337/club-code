import { RotateCcwIcon, SkipBackIcon, SkipForwardIcon, XIcon } from "lucide-react";

import { youtubeUrlQueueStore, useYouTubeUrlQueue } from "../../youtubeUrlQueue";
import { cn } from "../../lib/utils";

export function YouTubeUrlQueueControls({ className }: { readonly className?: string }) {
  const queue = useYouTubeUrlQueue();
  if (!queue.active) return null;

  return (
    <div
      role="toolbar"
      aria-label="YouTube URL queue controls"
      className={cn("flex items-center gap-1", className)}
    >
      <button
        type="button"
        aria-label="Previous YouTube URL"
        title="Previous URL"
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => youtubeUrlQueueStore.previous()}
      >
        <SkipBackIcon className="size-3.5" />
      </button>
      <span className="min-w-20 text-center text-[10px] text-muted-foreground">
        URL {queue.index + 1} of {queue.count}
      </span>
      <button
        type="button"
        aria-label="Next YouTube URL"
        title="Next URL"
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => youtubeUrlQueueStore.next()}
      >
        {queue.automaticPaused ? (
          <RotateCcwIcon className="size-3.5" />
        ) : (
          <SkipForwardIcon className="size-3.5" />
        )}
      </button>
      <button
        type="button"
        aria-label="Clear YouTube URL queue"
        title="Clear session queue"
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => youtubeUrlQueueStore.clear()}
      >
        <XIcon className="size-3.5" />
      </button>
      {queue.automaticPaused ? (
        <span role="status" className="text-[10px] text-amber-600 dark:text-amber-400">
          Auto-advance paused
        </span>
      ) : null}
    </div>
  );
}
