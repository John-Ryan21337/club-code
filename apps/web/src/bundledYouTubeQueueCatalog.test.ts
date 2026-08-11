import { describe, expect, it } from "vitest";
import {
  BUNDLED_YOUTUBE_QUEUE_CATALOG,
  DEFAULT_BUNDLED_YOUTUBE_QUEUE_ID,
  loadBundledYouTubeQueue,
} from "./bundledYouTubeQueueCatalog";

describe("bundled YouTube queue catalog", () => {
  it("publishes all reviewed queues in stable display order", () => {
    expect(DEFAULT_BUNDLED_YOUTUBE_QUEUE_ID).toBe("japanese");
    expect(BUNDLED_YOUTUBE_QUEUE_CATALOG).toEqual([
      { id: "japanese", label: "Japanese music", itemCount: 71 },
      { id: "edm", label: "EDM", itemCount: 30 },
      { id: "kpop", label: "K-pop", itemCount: 8 },
    ]);
    expect(Object.isFrozen(BUNDLED_YOUTUBE_QUEUE_CATALOG)).toBe(true);
    expect(BUNDLED_YOUTUBE_QUEUE_CATALOG.every(Object.isFrozen)).toBe(true);
  });

  it.each([
    [
      "japanese",
      {
        totalLines: 78,
        blank: 0,
        comment: 1,
        accepted: 71,
        duplicate: 3,
        malformed: 3,
        overflow: 0,
      },
    ],
    [
      "edm",
      {
        totalLines: 32,
        blank: 0,
        comment: 1,
        accepted: 30,
        duplicate: 0,
        malformed: 1,
        overflow: 0,
      },
    ],
    [
      "kpop",
      {
        totalLines: 9,
        blank: 0,
        comment: 1,
        accepted: 8,
        duplicate: 0,
        malformed: 0,
        overflow: 0,
      },
    ],
  ] as const)("loads the reviewed %s queue", (id, expectedCounts) => {
    const result = loadBundledYouTubeQueue(id);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Reviewed bundled queue must load.");
    expect(result.entry.queue.counts).toEqual(expectedCounts);
    expect(result.entry.queue.videoIds).toHaveLength(expectedCounts.accepted);
    expect(result.entry.queue.issues).toHaveLength(expectedCounts.malformed);
    expect(result.entry.queue.issuesTruncated).toBe(false);
    expect(JSON.stringify(result)).not.toContain("youtube.com");
    expect(JSON.stringify(result)).not.toContain("youtu.be");
    expect(Object.isFrozen(result.entry)).toBe(true);
    expect(Object.isFrozen(result.entry.queue)).toBe(true);
    expect(Object.isFrozen(result.entry.queue.videoIds)).toBe(true);
    expect(Object.isFrozen(result.entry.queue.counts)).toBe(true);
    expect(Object.isFrozen(result.entry.queue.issues)).toBe(true);
  });

  it("fails closed for an unknown id without echoing it", () => {
    const result = loadBundledYouTubeQueue("private-operator-value");

    expect(result).toEqual({
      ok: false,
      error: { reason: "unknown-bundled-queue" },
    });
    expect(JSON.stringify(result)).not.toContain("private-operator-value");
  });

  it("returns a fresh immutable queue for each explicit load", () => {
    const first = loadBundledYouTubeQueue("edm");
    const second = loadBundledYouTubeQueue("edm");

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("Reviewed bundled queue must load.");
    expect(first.entry).not.toBe(second.entry);
    expect(first.entry.queue.videoIds).not.toBe(second.entry.queue.videoIds);
    expect(first.entry.queue.videoIds).toEqual(second.entry.queue.videoIds);
  });
});
