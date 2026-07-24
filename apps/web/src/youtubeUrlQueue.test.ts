import { describe, expect, it } from "vitest";

import {
  createYouTubeUrlQueueStore,
  DEFAULT_YOUTUBE_URL_QUEUE_EXAMPLE_ID,
  parseYouTubeUrlQueueText,
  parseYouTubeUrlQueueExample,
  readYouTubeUrlQueueFile,
  YOUTUBE_URL_QUEUE_EXAMPLES,
  YOUTUBE_URL_QUEUE_MAX_BYTES,
  YOUTUBE_URL_QUEUE_MAX_LINES,
  YouTubeUrlQueueFileError,
} from "./youtubeUrlQueue";

const youtubeWatchUrls = (videoIds: readonly string[]) =>
  videoIds.map((videoId) => `https://www.youtube.com/watch?v=${videoId}`);

const EDM_SOURCE_VIDEO_IDS = [
  "VGG0coMYaRQ",
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
];

const JAPANESE_SOURCE_VIDEO_IDS = [
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
];

describe("session-only YouTube URL queue", () => {
  it("bundles every supplied line in exact source order and reports malformed IDs", () => {
    expect(YOUTUBE_URL_QUEUE_EXAMPLES.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "japanese", label: "Japanese music" },
      { id: "edm", label: "EDM" },
    ]);
    expect(
      YOUTUBE_URL_QUEUE_EXAMPLES.find(({ id }) => id === "japanese")
        ?.text.trim()
        .split(/\r?\n/),
    ).toEqual(youtubeWatchUrls(JAPANESE_SOURCE_VIDEO_IDS));
    expect(
      YOUTUBE_URL_QUEUE_EXAMPLES.find(({ id }) => id === "edm")
        ?.text.trim()
        .split(/\r?\n/),
    ).toEqual(youtubeWatchUrls(EDM_SOURCE_VIDEO_IDS));
    expect(JAPANESE_SOURCE_VIDEO_IDS).toHaveLength(39);
    expect(EDM_SOURCE_VIDEO_IDS).toHaveLength(20);

    const japanese = parseYouTubeUrlQueueExample("japanese");
    expect(japanese.videoIds).toEqual(
      JAPANESE_SOURCE_VIDEO_IDS.filter((videoId) => videoId.length === 11),
    );
    expect(japanese.report).toMatchObject({ accepted: 36, invalid: 3 });
    const edm = parseYouTubeUrlQueueExample("edm");
    expect(edm.videoIds).toEqual(EDM_SOURCE_VIDEO_IDS.filter((videoId) => videoId.length === 11));
    expect(edm.report).toMatchObject({ accepted: 19, invalid: 1 });
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
      count: 36,
      index: 0,
      currentSource: { kind: "video", id: JAPANESE_SOURCE_VIDEO_IDS[0] },
      exampleId: "japanese",
    });
    expect(freshStore.initializeBundledDefault(true)).toBe(false);

    const userControlledStore = createYouTubeUrlQueueStore();
    expect(userControlledStore.loadExample("edm")).toBe(true);
    expect(userControlledStore.initializeBundledDefault(true)).toBe(false);
    expect(userControlledStore.getSnapshot()).toMatchObject({
      count: 19,
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
      count: 36,
      exampleId: "japanese",
      report: { accepted: 36, invalid: 3 },
    });

    expect(store.loadExample("edm")).toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      index: 0,
      count: 19,
      exampleId: "edm",
      report: { accepted: 19, invalid: 1 },
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
      type: "text/plain",
      text: async () => "https://youtu.be/dQw4w9WgXcQ",
    });
    expect(result.videoIds).toEqual(["dQw4w9WgXcQ"]);
    expect(JSON.stringify(result)).not.toContain("private-name");
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
