import { describe, expect, it } from "vitest";

import {
  createYouTubeUrlQueueLibraryStore,
  createYouTubeUrlQueueStore,
  DEFAULT_YOUTUBE_URL_QUEUE_EXAMPLE_ID,
  importYouTubeUrlQueueFile,
  parseYouTubeUrlQueueText,
  parseYouTubeUrlQueueExample,
  readYouTubeUrlQueueFile,
  youtubeUrlQueueLibraryStore,
  YOUTUBE_URL_QUEUE_EXAMPLES,
  YOUTUBE_URL_QUEUE_LIBRARY_STORAGE_KEY,
  YOUTUBE_URL_QUEUE_MAX_BYTES,
  YOUTUBE_URL_QUEUE_MAX_LINES,
  YouTubeUrlQueueFileError,
} from "./youtubeUrlQueue";

const youtubeWatchUrls = (videoIds: readonly string[]) =>
  videoIds.map((videoId) => `https://www.youtube.com/watch?v=${videoId}`);

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

const EDM_SOURCE_VIDEO_IDS = [
  "VGG0coMYaRQ",
  "WiUdWyyvmpQ",
  "WrlgWG29Sbg",
  "vpmP8fWSJlE",
  "2javfeqlYAU",
  "3fRncVSb_YA",
  "6Htm_Fjo7f0",
  "r00qDbJ2XsQ",
  "2_qE6o2Dqm",
  "8dYe50jm20s",
  "5-4yJfjApYo",
  "z0Rh3TyB2k0",
  "BYV_y4lpR0U",
  "_V9l025V2ws",
  "yb2TzY9G2TU",
  "p57OGH-nupY",
  "28R9VXI2Btw",
  "PX-d2lBuyGU",
  "i5xCKYMfpEc",
  "lC2wFbKcqn8",
  "oWBzvf_VA6I",
  "5Ow3J0pFMBY",
  "tSXgGt9QZw4",
  "VVykIWJp2ws",
  "-WV4ehwSf-A",
  "ugiugMgIiZw",
  "4GuTKWZY-o8",
  "URAYf4QnCM0",
  "64IMBBZJnR4",
  "w_x3DaZAGAg",
  "e1SArILAHPw",
];

const JAPANESE_SOURCE_VIDEO_IDS = [
  "71du1AUrMe4",
  "6Ee6MYr4GlQ",
  "UXa1bG5YFq0",
  "nn-XB8mcdAo",
  "8cEdndsuzSE",
  "IRXAUlcBgIk",
  "-L4Visli9sA",
  "-L4Visli9sA",
  "wEEoy-Nq8Rg",
  "Hf5vwt2qQFg",
  "blgxfEUgvVU",
  "aFrQIJ5cbRc",
  "nXYz8u1cEmM",
  "k7eGPMCy_ms",
  "e8rbEdXwQ_c",
  "BydbhAzmAzg",
  "bxz5v4pU2DA",
  "tN6AaDULF8",
  "0OIVIkmBdL",
  "6hjWW4qw7z",
  "lBcWKiv7B3Y",
  "OHAjc-ayhus",
  "fsMWdnx_wuI",
  "4ej8gUohH_Y",
  "_crezDzuriM",
  "nPLecyI8SIQ",
  "tHcGY11nvwg",
  "bqGl4vHXuJo",
  "RzTwehkbHkM",
  "uR1y7bXCtbI",
  "9FU59hfhqgg",
  "lL9gOqv-5CY",
  "6Rgui3VeMP0",
  "rxuR-52cyNw",
  "FSYHUe8Ng1M",
  "T57HYBSkci8",
  "BNYiiWdIIB0",
  "fgQ_NH-hvGI",
  "ZkQoi5T4-Lo",
  "OGkjgewQKSQ",
  "V14W9d2sMTE",
  "rvVqIWSf7Os",
  "Irf9Wbv2N1c",
  "E7jQ3nO2zH4",
  "tIS4EbSCVmY",
  "hqdT02Ci9zA",
  "_OrS-fFCaSw",
  "B6Y-WsgpzlQ",
  "29io5-F-4xM",
  "ysztVJxdDtc",
  "AzVM4bu2v0g",
  "Vk5vdX0votE",
  "8cEdndsuzSE",
  "cUfDOS2SINM",
  "L7spCJxloLY",
  "T6YVgEpRU6Q",
  "IPxDgf-g9Kw",
  "VFeRPM7Sm6c",
  "196hOZO5cWc",
  "aHTI0SXGVS0",
  "BydbhAzmAzg",
  "pFc9PZrroOk",
  "NhI2mp-WIck",
  "7PtvnaEo9-0",
  "gYaxQYf_EdI",
  "ihNaFCEd0Ms",
  "LIlZCmETvsY",
  "M_4nGY9at9M",
  "T1Db28z3kqo",
  "NvXRNFVF-K4",
  "n12C550sHCo",
  "LsHIlfjD6oQ",
  "ny9QNHChPHE",
  "vsPWV1O5F1s",
  "56FOKrCS-aM",
  "oBtpQjy7iPo",
  "AfQ8liDjC7s",
];

const KPOP_SOURCE_VIDEO_IDS = [
  "DskqpUrvlmw",
  "4EcNa_cOr4o",
  "Ur7aK4FvK-U",
  "9nEp9eeGaJk",
  "qQU5Fjqkg0c",
  "Vk5-c_v4gMU",
  "83C3TZ4Zm_o",
  "MMmhSeLBQ-4",
];

describe("YouTube URL queue and device-local list library", () => {
  it("bundles every supplied line in exact source order and reports malformed IDs", () => {
    expect(
      YOUTUBE_URL_QUEUE_EXAMPLES.map(({ id, logicalName, label }) => ({
        id,
        logicalName,
        label,
      })),
    ).toEqual([
      { id: "japanese", logicalName: "JPMusic", label: "Japanese music" },
      { id: "edm", logicalName: "EDMYoutubeList", label: "EDM" },
      { id: "kpop", logicalName: "KPOPList", label: "K-pop" },
    ]);
    expect(
      YOUTUBE_URL_QUEUE_EXAMPLES.find(({ id }) => id === "japanese")
        ?.text.trim()
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("#")),
    ).toEqual(youtubeWatchUrls(JAPANESE_SOURCE_VIDEO_IDS));
    expect(
      YOUTUBE_URL_QUEUE_EXAMPLES.find(({ id }) => id === "edm")
        ?.text.trim()
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("#")),
    ).toEqual(youtubeWatchUrls(EDM_SOURCE_VIDEO_IDS));
    expect(
      YOUTUBE_URL_QUEUE_EXAMPLES.find(({ id }) => id === "kpop")
        ?.text.trim()
        .split(/\r?\n/)
        .filter((line) => !line.startsWith("#")),
    ).toEqual(youtubeWatchUrls(KPOP_SOURCE_VIDEO_IDS));
    expect(
      YOUTUBE_URL_QUEUE_EXAMPLES.every(({ text }) =>
        text.startsWith(
          "# During playback, YouTube videos that are unavailable or disallow embedding are skipped automatically.",
        ),
      ),
    ).toBe(true);
    expect(JAPANESE_SOURCE_VIDEO_IDS).toHaveLength(77);
    expect(EDM_SOURCE_VIDEO_IDS).toHaveLength(31);
    expect(KPOP_SOURCE_VIDEO_IDS).toHaveLength(8);
    expect(new Set(JAPANESE_SOURCE_VIDEO_IDS).size).toBe(74);
    expect(new Set(EDM_SOURCE_VIDEO_IDS).size).toBe(31);
    expect(new Set(KPOP_SOURCE_VIDEO_IDS).size).toBe(8);

    const japanese = parseYouTubeUrlQueueExample("japanese");
    expect(japanese.videoIds).toEqual([
      ...new Set(JAPANESE_SOURCE_VIDEO_IDS.filter((videoId) => videoId.length === 11)),
    ]);
    expect(japanese.report).toMatchObject({ accepted: 71, duplicates: 3, invalid: 3 });
    const edm = parseYouTubeUrlQueueExample("edm");
    expect(edm.videoIds).toEqual(EDM_SOURCE_VIDEO_IDS.filter((videoId) => videoId.length === 11));
    expect(edm.report).toMatchObject({ accepted: 30, invalid: 1 });
    const kpop = parseYouTubeUrlQueueExample("kpop");
    expect(kpop.videoIds).toEqual(KPOP_SOURCE_VIDEO_IDS);
    expect(kpop.report).toMatchObject({ accepted: 8, invalid: 0 });
  });

  it("loads Japanese music only for an untouched, allowed first-run session", () => {
    expect(DEFAULT_YOUTUBE_URL_QUEUE_EXAMPLE_ID).toBe("japanese");

    const preservedSourceStore = createYouTubeUrlQueueStore();
    expect(preservedSourceStore.initializeBundledDefault(false)).toBe(false);
    expect(preservedSourceStore.getSnapshot()).toMatchObject({ active: false, revision: 0 });

    const freshStore = createYouTubeUrlQueueStore();
    expect(freshStore.initializeBundledDefault(true)).toBe(true);
    expect(freshStore.getSnapshot()).toMatchObject({
      active: true,
      count: 71,
      index: 0,
      currentSource: { kind: "video", id: JAPANESE_SOURCE_VIDEO_IDS[0] },
      exampleId: "japanese",
    });
    expect(freshStore.initializeBundledDefault(true)).toBe(false);

    const userControlledStore = createYouTubeUrlQueueStore();
    expect(userControlledStore.loadExample("edm")).toBe(true);
    expect(userControlledStore.initializeBundledDefault(true)).toBe(false);
    expect(userControlledStore.getSnapshot()).toMatchObject({
      count: 30,
      exampleId: "edm",
    });
    userControlledStore.clear();
    expect(userControlledStore.initializeBundledDefault(true)).toBe(false);
    expect(userControlledStore.getSnapshot().active).toBe(false);

    const customChoiceStore = createYouTubeUrlQueueStore();
    expect(customChoiceStore.load(parseYouTubeUrlQueueText("https://youtu.be/dQw4w9WgXcQ"))).toBe(
      true,
    );
    expect(customChoiceStore.initializeBundledDefault(true)).toBe(false);
    expect(customChoiceStore.getSnapshot()).toMatchObject({
      count: 1,
      exampleId: null,
    });
  });

  it("reloads either bundled example from its first safe item without retaining URLs", () => {
    const store = createYouTubeUrlQueueStore();
    expect(store.loadExample("japanese")).toBe(true);
    expect(store.next()).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ index: 1, exampleId: "japanese" });

    expect(store.loadExample("japanese")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      index: 0,
      count: 71,
      exampleId: "japanese",
      listId: "japanese",
      report: { accepted: 71, invalid: 3 },
    });

    expect(store.loadExample("edm")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      index: 0,
      count: 30,
      exampleId: "edm",
      listId: "edm",
      report: { accepted: 30, invalid: 1 },
    });
    expect(JSON.stringify(store.getSnapshot())).not.toContain("youtube.com/watch");
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

  it("replaces a matching named list and persists a unique name as a one-click option", () => {
    const storage = createMemoryStorage();
    const library = createYouTubeUrlQueueLibraryStore(storage);
    expect(library.getSnapshot().map(({ id }) => id)).toEqual(["japanese", "edm", "kpop"]);

    const edmReplacement = library.upsert(
      "EDMYoutubeList",
      parseYouTubeUrlQueueText("https://youtu.be/dQw4w9WgXcQ"),
    );
    expect(edmReplacement).toMatchObject({
      replaced: true,
      persisted: true,
      option: {
        id: "edm",
        label: "EDM",
        source: "imported",
        replacesBundled: true,
        result: { videoIds: ["dQw4w9WgXcQ"] },
      },
    });
    expect(library.getSnapshot()).toHaveLength(3);

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
    expect(library.getSnapshot()).toHaveLength(4);

    const replaced = library.upsert(
      "night drive",
      parseYouTubeUrlQueueText("https://youtu.be/kJQP7kiw5Fk"),
    );
    expect(replaced.replaced).toBe(true);
    expect(library.getSnapshot()).toHaveLength(4);
    expect(library.resolve(added.option.id)?.result.videoIds).toEqual(["kJQP7kiw5Fk"]);

    const restored = createYouTubeUrlQueueLibraryStore(storage);
    expect(restored.resolve("edm")?.result.videoIds).toEqual(["dQw4w9WgXcQ"]);
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
      expect(youtubeUrlQueueLibraryStore.getSnapshot()).toHaveLength(4);
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
