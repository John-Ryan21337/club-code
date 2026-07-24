import { useSyncExternalStore } from "react";

import type { YouTubeSource } from "@cafecode/contracts/settings";

import edmYouTubeUrlQueueText from "../../../examples/youtube-url-queues/EDMYoutubeList.txt?raw";
import japaneseYouTubeUrlQueueText from "../../../examples/youtube-url-queues/JPMusic.txt?raw";
import { parseYouTubeSource } from "./ambientVideo";

export const YOUTUBE_URL_QUEUE_MAX_BYTES = 256 * 1_024;
export const YOUTUBE_URL_QUEUE_MAX_LINES = 1_000;
export const YOUTUBE_URL_QUEUE_MAX_ITEMS = 200;
export const YOUTUBE_URL_QUEUE_MAX_URL_LENGTH = 2_048;
export const DEFAULT_YOUTUBE_URL_QUEUE_EXAMPLE_ID = "japanese";

export type YouTubeUrlQueueExampleId = "japanese" | "edm";

export interface YouTubeUrlQueueExample {
  readonly id: YouTubeUrlQueueExampleId;
  readonly label: string;
  readonly text: string;
}

export const YOUTUBE_URL_QUEUE_EXAMPLES: readonly YouTubeUrlQueueExample[] = [
  {
    id: "japanese",
    label: "Japanese music",
    text: japaneseYouTubeUrlQueueText,
  },
  {
    id: "edm",
    label: "EDM",
    text: edmYouTubeUrlQueueText,
  },
];

export interface YouTubeUrlQueueParseReport {
  readonly accepted: number;
  readonly blank: number;
  readonly comments: number;
  readonly duplicates: number;
  readonly invalid: number;
  readonly overflow: number;
  readonly totalLines: number;
}

export interface YouTubeUrlQueueParseResult {
  readonly videoIds: readonly string[];
  readonly report: YouTubeUrlQueueParseReport;
}

export class YouTubeUrlQueueFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeUrlQueueFileError";
  }
}

export interface YouTubeUrlQueueSnapshot {
  readonly active: boolean;
  readonly count: number;
  readonly index: number;
  readonly currentSource: Exclude<YouTubeSource, null> | null;
  readonly revision: number;
  readonly report: YouTubeUrlQueueParseReport | null;
  readonly automaticPaused: boolean;
  readonly exampleId: YouTubeUrlQueueExampleId | null;
}

export interface YouTubeUrlQueueStore {
  readonly getSnapshot: () => YouTubeUrlQueueSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly load: (result: YouTubeUrlQueueParseResult) => boolean;
  readonly loadExample: (exampleId: YouTubeUrlQueueExampleId) => boolean;
  readonly initializeBundledDefault: (allowed: boolean) => boolean;
  readonly clear: () => void;
  readonly next: () => boolean;
  readonly previous: () => boolean;
  readonly advanceAutomatically: (
    expectedRevision: number,
    reason: "ended" | "unplayable",
  ) => boolean;
  /** @internal Test-only reset for isolated renderer lifecycle coverage. */
  readonly resetForTests: () => void;
}

const EMPTY_SNAPSHOT: YouTubeUrlQueueSnapshot = {
  active: false,
  count: 0,
  index: 0,
  currentSource: null,
  revision: 0,
  report: null,
  automaticPaused: false,
  exampleId: null,
};

const YOUTUBE_URL_QUEUE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

function strictSingleVideoId(value: string): string | null {
  if (value.length === 0 || value.length > YOUTUBE_URL_QUEUE_MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.port.length > 0 ||
    !YOUTUBE_URL_QUEUE_HOSTS.has(url.hostname.toLowerCase())
  ) {
    return null;
  }
  const pathParts = url.pathname.split("/").filter(Boolean);
  const supportedPath =
    (url.hostname.toLowerCase() === "youtu.be" && pathParts.length === 1) ||
    (url.pathname === "/watch" && pathParts.length === 1) ||
    (pathParts.length === 2 && (pathParts[0] === "shorts" || pathParts[0] === "live"));
  if (!supportedPath) return null;
  const parsed = parseYouTubeSource(url.href);
  return parsed?.kind === "video" ? parsed.id : null;
}

export function parseYouTubeUrlQueueText(text: string): YouTubeUrlQueueParseResult {
  if (new TextEncoder().encode(text).byteLength > YOUTUBE_URL_QUEUE_MAX_BYTES) {
    throw new YouTubeUrlQueueFileError("The URL queue exceeds the 256 KB session limit.");
  }
  const lines = text.split(/\r?\n/);
  if (lines.length > YOUTUBE_URL_QUEUE_MAX_LINES) {
    throw new YouTubeUrlQueueFileError(
      `The URL queue exceeds the ${YOUTUBE_URL_QUEUE_MAX_LINES}-line limit.`,
    );
  }

  const videoIds: string[] = [];
  const seen = new Set<string>();
  let blank = 0;
  let comments = 0;
  let duplicates = 0;
  let invalid = 0;
  let overflow = 0;
  for (const line of lines) {
    const value = line.trim();
    if (value.length === 0) {
      blank += 1;
      continue;
    }
    if (value.startsWith("#") || value.startsWith("//") || value.startsWith(";")) {
      comments += 1;
      continue;
    }
    const videoId = strictSingleVideoId(value);
    if (videoId === null) {
      invalid += 1;
      continue;
    }
    if (seen.has(videoId)) {
      duplicates += 1;
      continue;
    }
    if (videoIds.length >= YOUTUBE_URL_QUEUE_MAX_ITEMS) {
      overflow += 1;
      continue;
    }
    seen.add(videoId);
    videoIds.push(videoId);
  }

  return {
    videoIds,
    report: {
      accepted: videoIds.length,
      blank,
      comments,
      duplicates,
      invalid,
      overflow,
      totalLines: lines.length,
    },
  };
}

export function getYouTubeUrlQueueExample(
  exampleId: YouTubeUrlQueueExampleId,
): YouTubeUrlQueueExample {
  const example = YOUTUBE_URL_QUEUE_EXAMPLES.find((candidate) => candidate.id === exampleId);
  if (!example) {
    throw new Error(`Unknown bundled YouTube URL queue: ${exampleId}`);
  }
  return example;
}

export function parseYouTubeUrlQueueExample(
  exampleId: YouTubeUrlQueueExampleId,
): YouTubeUrlQueueParseResult {
  return parseYouTubeUrlQueueText(getYouTubeUrlQueueExample(exampleId).text);
}

export async function readYouTubeUrlQueueFile(
  file: Pick<File, "name" | "size" | "text" | "type">,
): Promise<YouTubeUrlQueueParseResult> {
  if (!file.name.toLowerCase().endsWith(".txt")) {
    throw new YouTubeUrlQueueFileError("Choose a plain .txt file.");
  }
  if (file.size > YOUTUBE_URL_QUEUE_MAX_BYTES) {
    throw new YouTubeUrlQueueFileError("The URL queue exceeds the 256 KB session limit.");
  }
  if (file.type && file.type !== "text/plain") {
    throw new YouTubeUrlQueueFileError("Choose a plain-text URL queue.");
  }
  return parseYouTubeUrlQueueText(await file.text());
}

export function createYouTubeUrlQueueStore(): YouTubeUrlQueueStore {
  let videoIds: readonly string[] = [];
  let failureStreak = 0;
  let snapshot = EMPTY_SNAPSHOT;
  const listeners = new Set<() => void>();
  const emit = (next: YouTubeUrlQueueSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const moveTo = (index: number, resetFailures: boolean) => {
    if (videoIds.length === 0) return false;
    if (resetFailures) failureStreak = 0;
    const normalizedIndex = (index + videoIds.length) % videoIds.length;
    emit({
      ...snapshot,
      active: true,
      count: videoIds.length,
      index: normalizedIndex,
      currentSource: { kind: "video", id: videoIds[normalizedIndex]! },
      revision: snapshot.revision + 1,
      automaticPaused: false,
    });
    return true;
  };
  const load = (result: YouTubeUrlQueueParseResult, exampleId: YouTubeUrlQueueExampleId | null) => {
    const bounded = result.videoIds.slice(0, YOUTUBE_URL_QUEUE_MAX_ITEMS);
    if (bounded.length === 0) return false;
    videoIds = bounded;
    failureStreak = 0;
    emit({
      active: true,
      count: bounded.length,
      index: 0,
      currentSource: { kind: "video", id: bounded[0]! },
      revision: snapshot.revision + 1,
      report: result.report,
      automaticPaused: false,
      exampleId,
    });
    return true;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load: (result) => load(result, null),
    loadExample: (exampleId) => load(parseYouTubeUrlQueueExample(exampleId), exampleId),
    initializeBundledDefault: (allowed) => {
      if (!allowed || snapshot.revision !== 0) return false;
      return load(
        parseYouTubeUrlQueueExample(DEFAULT_YOUTUBE_URL_QUEUE_EXAMPLE_ID),
        DEFAULT_YOUTUBE_URL_QUEUE_EXAMPLE_ID,
      );
    },
    clear: () => {
      videoIds = [];
      failureStreak = 0;
      emit({ ...EMPTY_SNAPSHOT, revision: snapshot.revision + 1 });
    },
    next: () => moveTo(snapshot.index + 1, true),
    previous: () => moveTo(snapshot.index - 1, true),
    advanceAutomatically: (expectedRevision, reason) => {
      if (!snapshot.active || snapshot.revision !== expectedRevision || snapshot.automaticPaused) {
        return false;
      }
      if (videoIds.length === 1) {
        if (reason === "unplayable") {
          failureStreak = 1;
          emit({ ...snapshot, automaticPaused: true });
        }
        return false;
      }
      if (reason === "unplayable") {
        failureStreak += 1;
        if (failureStreak >= videoIds.length) {
          emit({ ...snapshot, automaticPaused: true });
          return false;
        }
      } else {
        failureStreak = 0;
      }
      return moveTo(snapshot.index + 1, false);
    },
    resetForTests: () => {
      videoIds = [];
      failureStreak = 0;
      snapshot = EMPTY_SNAPSHOT;
      listeners.clear();
    },
  };
}

export const youtubeUrlQueueStore = createYouTubeUrlQueueStore();

/** @internal Keeps browser tests from leaking a session-only queue between cases. */
export function __resetYouTubeUrlQueueForTests(): void {
  youtubeUrlQueueStore.resetForTests();
}

export function useYouTubeUrlQueue(): YouTubeUrlQueueSnapshot {
  return useSyncExternalStore(
    youtubeUrlQueueStore.subscribe,
    youtubeUrlQueueStore.getSnapshot,
    youtubeUrlQueueStore.getSnapshot,
  );
}
