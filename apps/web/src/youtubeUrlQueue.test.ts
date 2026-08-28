import { describe, expect, it } from "vitest";

import {
  createYouTubeUrlQueueLibraryStore,
  createYouTubeUrlQueueStore,
  importYouTubeUrlQueueFile,
  parseYouTubeUrlQueueText,
  readYouTubeUrlQueueFile,
  youtubeUrlQueueLibraryStore,
  YOUTUBE_URL_QUEUE_EXAMPLES,
  YOUTUBE_URL_QUEUE_LIBRARY_STORAGE_KEY,
  YOUTUBE_URL_QUEUE_MAX_BYTES,
  YOUTUBE_URL_QUEUE_MAX_LINES,
  YouTubeUrlQueueFileError,
} from "./youtubeUrlQueue";

function createMemoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(YOUTUBE_URL_QUEUE_LIBRARY_STORAGE_KEY, initial);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    read: (key: string) => values.get(key) ?? null,
  };
}

describe("YouTube URL queue and device-local list library", () => {
  it("ships no bundled playlists and preserves an empty first-run queue", () => {
    expect(YOUTUBE_URL_QUEUE_EXAMPLES).toEqual([]);
    expect(createYouTubeUrlQueueLibraryStore(createMemoryStorage()).getSnapshot()).toEqual([]);

    expect(createYouTubeUrlQueueStore().getSnapshot()).toMatchObject({
      active: false,
      count: 0,
      currentSource: null,
      revision: 0,
      listId: null,
      exampleId: null,
    });
  });

  it("accepts strict single-video URLs in order and counts comments, invalid lines, and duplicates", () => {
    const parsed = parseYouTubeUrlQueueText(
      [
        "# night queue",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be=wrong",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/playlist?list=PL1234567890",
        "https://www.youtube.com/watch?v=9bZkp7q19f0",
        "",
      ].join("\n"),
    );
    expect(parsed.videoIds).toEqual(["dQw4w9WgXcQ", "9bZkp7q19f0"]);
    expect(parsed.report).toEqual({
      accepted: 2,
      blank: 1,
      comments: 1,
      duplicates: 1,
      invalid: 2,
      overflow: 0,
      totalLines: 7,
    });
  });

  it("rejects bare IDs, embeds, credentials, playlist-bearing videos, oversized text, and excess lines", () => {
    const parsed = parseYouTubeUrlQueueText(
      [
        "dQw4w9WgXcQ",
        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
        "https://user:pass@youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890",
      ].join("\n"),
    );
    expect(parsed.report.invalid).toBe(4);
    expect(() => parseYouTubeUrlQueueText("x".repeat(YOUTUBE_URL_QUEUE_MAX_BYTES + 1))).toThrow(
      YouTubeUrlQueueFileError,
    );
    expect(() =>
      parseYouTubeUrlQueueText(
        Array.from({ length: YOUTUBE_URL_QUEUE_MAX_LINES + 1 }, () => "").join("\n"),
      ),
    ).toThrow(YouTubeUrlQueueFileError);
  });

  it("reads only bounded plain .txt files and never needs a filename after parsing", async () => {
    await expect(
      readYouTubeUrlQueueFile({
        name: "queue.json",
        size: 10,
        type: "application/json",
        text: async () => "https://youtu.be/dQw4w9WgXcQ",
      }),
    ).rejects.toThrow("plain .txt");
    const result = await readYouTubeUrlQueueFile({
      name: "private-name.txt",
      size: 32,
      type: "text/plain; charset=utf-8",
      text: async () => "https://youtu.be/dQw4w9WgXcQ",
    });
    expect(result.videoIds).toEqual(["dQw4w9WgXcQ"]);
    expect(JSON.stringify(result)).not.toContain("private-name");
    await expect(
      readYouTubeUrlQueueFile({
        name: "android-download.txt",
        size: 32,
        type: "application/octet-stream",
        text: async () => "https://youtu.be/9bZkp7q19f0",
      }),
    ).resolves.toMatchObject({ videoIds: ["9bZkp7q19f0"] });
  });

  it("adds imported lists and persists a unique name as a one-click option", () => {
    const storage = createMemoryStorage();
    const library = createYouTubeUrlQueueLibraryStore(storage);
    expect(library.getSnapshot()).toEqual([]);

    const firstImport = library.upsert(
      "Study Mix",
      parseYouTubeUrlQueueText("https://youtu.be/dQw4w9WgXcQ"),
    );
    expect(firstImport).toMatchObject({
      replaced: false,
      persisted: true,
      option: {
        label: "Study Mix",
        source: "imported",
        replacesBundled: false,
        result: { videoIds: ["dQw4w9WgXcQ"] },
      },
    });
    expect(library.getSnapshot()).toHaveLength(1);

    const added = library.upsert(
      "Night Drive",
      parseYouTubeUrlQueueText("https://youtu.be/9bZkp7q19f0"),
    );
    expect(added).toMatchObject({
      replaced: false,
      persisted: true,
      option: {
        label: "Night Drive",
        source: "imported",
        replacesBundled: false,
        result: { videoIds: ["9bZkp7q19f0"] },
      },
    });
    expect(library.getSnapshot()).toHaveLength(2);

    const replaced = library.upsert(
      "night drive",
      parseYouTubeUrlQueueText("https://youtu.be/kJQP7kiw5Fk"),
    );
    expect(replaced.replaced).toBe(true);
    expect(library.getSnapshot()).toHaveLength(2);
    expect(library.resolve(added.option.id)?.result.videoIds).toEqual(["kJQP7kiw5Fk"]);

    const restored = createYouTubeUrlQueueLibraryStore(storage);
    expect(restored.resolve(firstImport.option.id)?.result.videoIds).toEqual(["dQw4w9WgXcQ"]);
    expect(restored.resolve(added.option.id)?.result.videoIds).toEqual(["kJQP7kiw5Fk"]);
    expect(storage.read(YOUTUBE_URL_QUEUE_LIBRARY_STORAGE_KEY)).not.toContain("youtube.com");
  });

  it("keeps an existing named list when a replacement contains no valid videos", () => {
    const storage = createMemoryStorage();
    const library = createYouTubeUrlQueueLibraryStore(storage);
    const original = library.upsert(
      "Night Drive",
      parseYouTubeUrlQueueText("https://youtu.be/dQw4w9WgXcQ"),
    );
    const persistedBeforeRejectedReplacement = storage.read(YOUTUBE_URL_QUEUE_LIBRARY_STORAGE_KEY);

    expect(() =>
      library.upsert("night drive", parseYouTubeUrlQueueText("not a YouTube URL")),
    ).toThrow("No valid, unique single-video YouTube URLs were found.");
    expect(library.resolve(original.option.id)?.result.videoIds).toEqual(["dQw4w9WgXcQ"]);
    expect(storage.read(YOUTUBE_URL_QUEUE_LIBRARY_STORAGE_KEY)).toBe(
      persistedBeforeRejectedReplacement,
    );
  });

  it("rejects malformed Unicode names before persistence and skips them during recovery", () => {
    const malformedName = String.fromCharCode(0xd800);
    const validQueue = parseYouTubeUrlQueueText("https://youtu.be/dQw4w9WgXcQ");
    const storage = createMemoryStorage();
    const library = createYouTubeUrlQueueLibraryStore(storage);

    expect(() => library.upsert(malformedName, validQueue)).toThrow(
      "Use a playlist filename with 1 to 64 printable characters.",
    );
    expect(storage.read(YOUTUBE_URL_QUEUE_LIBRARY_STORAGE_KEY)).toBeNull();

    const malformedStorage = createMemoryStorage(
      JSON.stringify({
        version: 1,
        lists: [{ logicalName: malformedName, videoIds: ["dQw4w9WgXcQ"] }],
      }),
    );
    expect(() => createYouTubeUrlQueueLibraryStore(malformedStorage)).not.toThrow();
    expect(
      createYouTubeUrlQueueLibraryStore(malformedStorage)
        .getSnapshot()
        .map(({ id }) => id),
    ).toEqual([]);
  });

  it("uses the uploaded .txt filename as the replacement/add identity", async () => {
    youtubeUrlQueueLibraryStore.resetForTests();
    try {
      const first = await importYouTubeUrlQueueFile({
        name: "Road Mix.txt",
        size: 40,
        type: "text/plain",
        text: async () => "https://youtu.be/dQw4w9WgXcQ",
      });
      const replacement = await importYouTubeUrlQueueFile({
        name: "road mix.TXT",
        size: 40,
        type: "text/plain",
        text: async () => "https://youtu.be/9bZkp7q19f0",
      });
      expect(first.replaced).toBe(false);
      expect(replacement.replaced).toBe(true);
      expect(replacement.option.id).toBe(first.option.id);
      expect(youtubeUrlQueueLibraryStore.getSnapshot()).toHaveLength(1);
      expect(replacement.option.result.videoIds).toEqual(["9bZkp7q19f0"]);
      const queue = createYouTubeUrlQueueStore();
      expect(queue.loadList(replacement.option.id)).toBe(true);
      expect(queue.getSnapshot()).toMatchObject({
        count: 1,
        currentSource: { kind: "video", id: "9bZkp7q19f0" },
        listId: replacement.option.id,
        exampleId: null,
      });
    } finally {
      youtubeUrlQueueLibraryStore.resetForTests();
    }
  });

  it("keeps manual navigation available and prevents an unavailable queue from thrashing", () => {
    const parsed = parseYouTubeUrlQueueText(
      [
        "https://youtu.be/dQw4w9WgXcQ",
        "https://youtu.be/9bZkp7q19f0",
        "https://youtu.be/kJQP7kiw5Fk",
      ].join("\n"),
    );
    const store = createYouTubeUrlQueueStore();
    expect(store.load(parsed)).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ index: 0, count: 3 });

    const firstRevision = store.getSnapshot().revision;
    expect(store.advanceAutomatically(firstRevision, "unplayable")).toBe(true);
    // Duplicate terminal events from the replaced iframe are ignored.
    expect(store.advanceAutomatically(firstRevision, "unplayable")).toBe(false);
    expect(store.advanceAutomatically(store.getSnapshot().revision, "unplayable")).toBe(true);
    expect(store.advanceAutomatically(store.getSnapshot().revision, "unplayable")).toBe(false);
    expect(store.getSnapshot().automaticPaused).toBe(true);

    expect(store.next()).toBe(true);
    expect(store.getSnapshot().automaticPaused).toBe(false);
    expect(store.previous()).toBe(true);
  });

  it("pauses a single unavailable item after one bounded attempt", () => {
    const parsed = parseYouTubeUrlQueueText("https://youtu.be/dQw4w9WgXcQ");
    const store = createYouTubeUrlQueueStore();
    expect(store.load(parsed)).toBe(true);

    expect(store.advanceAutomatically(store.getSnapshot().revision, "unplayable")).toBe(false);
    expect(store.getSnapshot().automaticPaused).toBe(true);
    expect(store.next()).toBe(true);
    expect(store.getSnapshot().automaticPaused).toBe(false);
  });
});
