import { useSyncExternalStore } from "react";

import type { YouTubeSource } from "@cafecode/contracts/settings";

import { parseYouTubeSource } from "./ambientVideo";

export const YOUTUBE_URL_QUEUE_MAX_BYTES = 256 * 1_024;
export const YOUTUBE_URL_QUEUE_MAX_LINES = 1_000;
export const YOUTUBE_URL_QUEUE_MAX_ITEMS = 200;
export const YOUTUBE_URL_QUEUE_MAX_URL_LENGTH = 2_048;
export const YOUTUBE_URL_QUEUE_MAX_SAVED_LISTS = 32;
export const YOUTUBE_URL_QUEUE_LIBRARY_STORAGE_KEY = "club-code:youtube-url-queue-library:v1";
export type YouTubeUrlQueueExampleId = "japanese" | "edm" | "kpop";

export interface YouTubeUrlQueueExample {
  readonly id: YouTubeUrlQueueExampleId;
  readonly logicalName: string;
  readonly label: string;
  readonly text: string;
}

// Club Code ships without preloaded media. Users can still import and save
// their own device-local queues through the playlist library.
export const YOUTUBE_URL_QUEUE_EXAMPLES: readonly YouTubeUrlQueueExample[] = [];

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
  readonly listId: string | null;
  readonly exampleId: YouTubeUrlQueueExampleId | null;
}

export interface YouTubeUrlQueueStore {
  readonly getSnapshot: () => YouTubeUrlQueueSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly load: (result: YouTubeUrlQueueParseResult) => boolean;
  readonly loadList: (listId: string) => boolean;
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
  listId: null,
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

export async function readYouTubeUrlQueueFile(
  file: Pick<File, "name" | "size" | "text" | "type">,
): Promise<YouTubeUrlQueueParseResult> {
  if (!file.name.toLowerCase().endsWith(".txt")) {
    throw new YouTubeUrlQueueFileError("Choose a plain .txt file.");
  }
  if (file.size > YOUTUBE_URL_QUEUE_MAX_BYTES) {
    throw new YouTubeUrlQueueFileError("The URL queue exceeds the 256 KB session limit.");
  }
  const mediaType = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (mediaType && mediaType !== "text/plain" && mediaType !== "application/octet-stream") {
    throw new YouTubeUrlQueueFileError("Choose a plain-text URL queue.");
  }
  return parseYouTubeUrlQueueText(await file.text());
}

export interface YouTubeUrlQueueListOption {
  readonly id: string;
  readonly logicalName: string;
  readonly label: string;
  readonly result: YouTubeUrlQueueParseResult;
  readonly source: "bundled" | "imported";
  readonly replacesBundled: boolean;
  readonly exampleId: YouTubeUrlQueueExampleId | null;
}

export interface YouTubeUrlQueueLibraryImportResult {
  readonly option: YouTubeUrlQueueListOption;
  readonly result: YouTubeUrlQueueParseResult;
  readonly replaced: boolean;
  readonly persisted: boolean;
}

export interface YouTubeUrlQueueLibraryStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export interface YouTubeUrlQueueLibraryStore {
  readonly getSnapshot: () => readonly YouTubeUrlQueueListOption[];
  readonly subscribe: (listener: () => void) => () => void;
  readonly resolve: (id: string) => YouTubeUrlQueueListOption | null;
  readonly upsert: (
    logicalName: string,
    result: YouTubeUrlQueueParseResult,
  ) => YouTubeUrlQueueLibraryImportResult;
  /** @internal Test-only reset for isolated renderer lifecycle coverage. */
  readonly resetForTests: (clearStorage?: boolean) => void;
}

interface SavedYouTubeUrlQueueList {
  readonly key: string;
  readonly logicalName: string;
  readonly videoIds: readonly string[];
}

const SAVED_LIBRARY_VERSION = 1;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const FORBIDDEN_LOGICAL_NAME_CHARACTER_PATTERN = /[\p{Cf}\p{Cs}]/u;

function resolveYouTubeUrlQueueLibraryStorage(): YouTubeUrlQueueLibraryStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizedLogicalName(value: string): string {
  const logicalName = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  const containsForbiddenCharacter = Array.from(logicalName).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      codePoint === 0x7f ||
      FORBIDDEN_LOGICAL_NAME_CHARACTER_PATTERN.test(character) ||
      character === "/" ||
      character === "\\"
    );
  });
  if (
    logicalName.length === 0 ||
    logicalName.length > 64 ||
    // Keep button labels printable and prevent a filename from masquerading
    // as nested UI or a path when restored on another browser launch.
    containsForbiddenCharacter
  ) {
    throw new YouTubeUrlQueueFileError(
      "Use a playlist filename with 1 to 64 printable characters.",
    );
  }
  return logicalName;
}

export function youtubeUrlQueueLogicalNameFromFileName(fileName: string): string {
  if (!fileName.toLowerCase().endsWith(".txt")) {
    throw new YouTubeUrlQueueFileError("Choose a plain .txt file.");
  }
  return normalizedLogicalName(fileName.slice(0, -4));
}

function logicalNameKey(logicalName: string): string {
  return normalizedLogicalName(logicalName).toLocaleLowerCase("en-US");
}

function customListId(key: string): string {
  return `custom:${encodeURIComponent(key)}`;
}

function parsePersistedLibrary(raw: string | null): SavedYouTubeUrlQueueList[] {
  if (raw === null || raw.length > YOUTUBE_URL_QUEUE_MAX_BYTES) return [];
  try {
    const decoded = JSON.parse(raw) as {
      readonly version?: unknown;
      readonly lists?: unknown;
    };
    if (decoded.version !== SAVED_LIBRARY_VERSION || !Array.isArray(decoded.lists)) return [];

    const lists: SavedYouTubeUrlQueueList[] = [];
    const seenKeys = new Set<string>();
    for (const candidate of decoded.lists.slice(0, YOUTUBE_URL_QUEUE_MAX_SAVED_LISTS)) {
      if (typeof candidate !== "object" || candidate === null) continue;
      const record = candidate as {
        readonly logicalName?: unknown;
        readonly videoIds?: unknown;
      };
      if (typeof record.logicalName !== "string" || !Array.isArray(record.videoIds)) continue;
      let logicalName: string;
      let key: string;
      try {
        logicalName = normalizedLogicalName(record.logicalName);
        key = logicalNameKey(logicalName);
      } catch {
        continue;
      }
      if (seenKeys.has(key)) continue;
      const videoIds: string[] = [];
      const seenVideoIds = new Set<string>();
      for (const videoId of record.videoIds.slice(0, YOUTUBE_URL_QUEUE_MAX_ITEMS)) {
        if (
          typeof videoId !== "string" ||
          !VIDEO_ID_PATTERN.test(videoId) ||
          seenVideoIds.has(videoId)
        ) {
          continue;
        }
        seenVideoIds.add(videoId);
        videoIds.push(videoId);
      }
      if (videoIds.length === 0) continue;
      seenKeys.add(key);
      lists.push({ key, logicalName, videoIds });
    }
    return lists;
  } catch {
    return [];
  }
}

function resultFromSavedList(list: SavedYouTubeUrlQueueList): YouTubeUrlQueueParseResult {
  return {
    videoIds: list.videoIds,
    report: {
      accepted: list.videoIds.length,
      blank: 0,
      comments: 0,
      duplicates: 0,
      invalid: 0,
      overflow: 0,
      totalLines: list.videoIds.length,
    },
  };
}

function libraryOptions(
  savedLists: readonly SavedYouTubeUrlQueueList[],
): readonly YouTubeUrlQueueListOption[] {
  const savedByKey = new Map(savedLists.map((list) => [list.key, list] as const));
  const bundledKeys = new Set<string>();
  const options: YouTubeUrlQueueListOption[] = YOUTUBE_URL_QUEUE_EXAMPLES.map((example) => {
    const key = logicalNameKey(example.logicalName);
    bundledKeys.add(key);
    const replacement = savedByKey.get(key);
    return {
      id: example.id,
      logicalName: example.logicalName,
      label: example.label,
      result:
        replacement === undefined
          ? parseYouTubeUrlQueueText(example.text)
          : resultFromSavedList(replacement),
      source: replacement === undefined ? "bundled" : "imported",
      replacesBundled: replacement !== undefined,
      exampleId: example.id,
    };
  });
  for (const list of savedLists) {
    if (bundledKeys.has(list.key)) continue;
    options.push({
      id: customListId(list.key),
      logicalName: list.logicalName,
      label: list.logicalName,
      result: resultFromSavedList(list),
      source: "imported",
      replacesBundled: false,
      exampleId: null,
    });
  }
  return options;
}

export function createYouTubeUrlQueueLibraryStore(
  storage: YouTubeUrlQueueLibraryStorage | null = resolveYouTubeUrlQueueLibraryStorage(),
): YouTubeUrlQueueLibraryStore {
  let savedLists = parsePersistedLibrary(
    (() => {
      try {
        return storage?.getItem(YOUTUBE_URL_QUEUE_LIBRARY_STORAGE_KEY) ?? null;
      } catch {
        return null;
      }
    })(),
  );
  let snapshot = libraryOptions(savedLists);
  const listeners = new Set<() => void>();
  const emit = () => {
    snapshot = libraryOptions(savedLists);
    for (const listener of listeners) listener();
  };
  const persist = (): boolean => {
    if (storage === null) return false;
    try {
      storage.setItem(
        YOUTUBE_URL_QUEUE_LIBRARY_STORAGE_KEY,
        JSON.stringify({
          version: SAVED_LIBRARY_VERSION,
          lists: savedLists.map(({ logicalName, videoIds }) => ({ logicalName, videoIds })),
        }),
      );
      return true;
    } catch {
      return false;
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    resolve: (id) => snapshot.find((option) => option.id === id) ?? null,
    upsert: (logicalNameInput, result) => {
      const logicalName = normalizedLogicalName(logicalNameInput);
      const key = logicalNameKey(logicalName);
      const boundedVideoIds = [...new Set(result.videoIds)].filter((videoId) =>
        VIDEO_ID_PATTERN.test(videoId),
      );
      if (boundedVideoIds.length === 0) {
        throw new YouTubeUrlQueueFileError(
          "No valid, unique single-video YouTube URLs were found.",
        );
      }
      const existingIndex = savedLists.findIndex((list) => list.key === key);
      const replacesBundled = YOUTUBE_URL_QUEUE_EXAMPLES.some(
        (example) => logicalNameKey(example.logicalName) === key,
      );
      if (existingIndex < 0 && savedLists.length >= YOUTUBE_URL_QUEUE_MAX_SAVED_LISTS) {
        throw new YouTubeUrlQueueFileError(
          `The local playlist library is limited to ${YOUTUBE_URL_QUEUE_MAX_SAVED_LISTS} named lists.`,
        );
      }
      const replacement: SavedYouTubeUrlQueueList = {
        key,
        logicalName,
        videoIds: boundedVideoIds.slice(0, YOUTUBE_URL_QUEUE_MAX_ITEMS),
      };
      savedLists =
        existingIndex < 0
          ? [...savedLists, replacement]
          : savedLists.map((list, index) => (index === existingIndex ? replacement : list));
      const persisted = persist();
      emit();
      const example = YOUTUBE_URL_QUEUE_EXAMPLES.find(
        (candidate) => logicalNameKey(candidate.logicalName) === key,
      );
      const optionId = example?.id ?? customListId(key);
      const option = snapshot.find((candidate) => candidate.id === optionId);
      if (!option) {
        throw new Error("The imported YouTube playlist was not added to the local library.");
      }
      return {
        option,
        result: {
          videoIds: replacement.videoIds,
          report: {
            ...result.report,
            accepted: replacement.videoIds.length,
          },
        },
        replaced: existingIndex >= 0 || replacesBundled,
        persisted,
      };
    },
    resetForTests: (clearStorage = true) => {
      savedLists = [];
      if (clearStorage && storage !== null) {
        try {
          storage.removeItem(YOUTUBE_URL_QUEUE_LIBRARY_STORAGE_KEY);
        } catch {
          // Storage can be disabled; the in-memory test reset still succeeds.
        }
      }
      emit();
    },
  };
}

export const youtubeUrlQueueLibraryStore = createYouTubeUrlQueueLibraryStore();

export async function importYouTubeUrlQueueFile(
  file: Pick<File, "name" | "size" | "text" | "type">,
): Promise<YouTubeUrlQueueLibraryImportResult> {
  const logicalName = youtubeUrlQueueLogicalNameFromFileName(file.name);
  const result = await readYouTubeUrlQueueFile(file);
  return youtubeUrlQueueLibraryStore.upsert(logicalName, result);
}

export function useYouTubeUrlQueueLibrary(): readonly YouTubeUrlQueueListOption[] {
  return useSyncExternalStore(
    youtubeUrlQueueLibraryStore.subscribe,
    youtubeUrlQueueLibraryStore.getSnapshot,
    youtubeUrlQueueLibraryStore.getSnapshot,
  );
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
  const load = (
    result: YouTubeUrlQueueParseResult,
    listId: string | null,
    exampleId: YouTubeUrlQueueExampleId | null,
  ) => {
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
      listId,
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
    load: (result) => load(result, null, null),
    loadList: (listId) => {
      const option = youtubeUrlQueueLibraryStore.resolve(listId);
      return option === null ? false : load(option.result, option.id, option.exampleId);
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

/** @internal Keeps browser tests from leaking queue or library state between cases. */
export function __resetYouTubeUrlQueueForTests(): void {
  youtubeUrlQueueStore.resetForTests();
  youtubeUrlQueueLibraryStore.resetForTests();
}

export function useYouTubeUrlQueue(): YouTubeUrlQueueSnapshot {
  return useSyncExternalStore(
    youtubeUrlQueueStore.subscribe,
    youtubeUrlQueueStore.getSnapshot,
    youtubeUrlQueueStore.getSnapshot,
  );
}
