import { useSyncExternalStore } from "react";

import {
  YOUTUBE_QUEUE_LIBRARY_MAX_ITEMS_PER_QUEUE,
  type SavedYouTubeQueue,
} from "./youtubeQueueLibrary";
import type { YouTubeQueuePlaybackEvent } from "./youtubeIframeCommands";

interface QueuePlayback {
  readonly environmentScopeKey: string | null;
  readonly name: string;
  readonly videoIds: readonly string[];
  readonly index: number;
  readonly revision: number;
  readonly active: boolean;
  readonly currentSource: { readonly kind: "video"; readonly id: string } | null;
}

const EMPTY_QUEUE: QueuePlayback = Object.freeze({
  environmentScopeKey: null,
  name: "",
  videoIds: Object.freeze([]),
  index: 0,
  revision: 0,
  active: false,
  currentSource: null,
});

/** Playback is memory-only. The reviewed queue library owns all saved IDs. */
export function createYouTubeQueuePlaybackStore() {
  let state = EMPTY_QUEUE;
  const listeners = new Set<() => void>();
  const publish = (next: QueuePlayback) => {
    state = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const stop = () => publish({ ...EMPTY_QUEUE, revision: state.revision + 1 });
  const move = (index: number) => {
    const id = state.videoIds[index];
    if (!state.active || id === undefined) {
      stop();
      return;
    }
    publish({
      ...state,
      index,
      revision: state.revision + 1,
      currentSource: Object.freeze({ kind: "video", id }),
    });
  };
  return Object.freeze({
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: (queue: SavedYouTubeQueue, environmentScopeKey: string) => {
      if (
        !environmentScopeKey ||
        queue.videoIds.length === 0 ||
        queue.videoIds.length > YOUTUBE_QUEUE_LIBRARY_MAX_ITEMS_PER_QUEUE ||
        queue.videoIds.some((id) => !/^[A-Za-z0-9_-]{11}$/.test(id))
      ) {
        throw new Error("Choose a valid saved YouTube queue.");
      }
      const videoIds = Object.freeze([...queue.videoIds]);
      publish({
        environmentScopeKey,
        name: queue.name.slice(0, 256),
        videoIds,
        index: 0,
        revision: state.revision + 1,
        active: true,
        currentSource: Object.freeze({ kind: "video", id: videoIds[0]! }),
      });
    },
    stop,
    next: () => move(state.index + 1),
    previous: () => move(Math.max(0, state.index - 1)),
    advanceAutomatically: (revision: number, _event: YouTubeQueuePlaybackEvent) => {
      // A stale iframe or repeated terminal event cannot advance the new item.
      if (state.active && state.revision === revision) move(state.index + 1);
    },
  });
}

export const youtubeUrlQueueStore = createYouTubeQueuePlaybackStore();

export function useYouTubeUrlQueue(environmentScopeKey: string): QueuePlayback {
  const state = useSyncExternalStore(
    youtubeUrlQueueStore.subscribe,
    youtubeUrlQueueStore.getSnapshot,
    () => EMPTY_QUEUE,
  );
  return state.environmentScopeKey === environmentScopeKey ? state : EMPTY_QUEUE;
}
