import { describe, expect, it } from "vitest";

import { createYouTubeQueuePlaybackStore } from "./youtubeQueuePlayback";

const videos = ["dQw4w9WgXcQ", "M7lc1UVf-VE", "aqz-KE-bpKQ"];

describe("YouTube queue playback", () => {
  it("binds a copied queue to an environment and ignores repeated or replaced iframe events", () => {
    const store = createYouTubeQueuePlaybackStore();
    const input = [...videos];
    store.start({ name: "Review queue", videoIds: input }, "environment-a");
    const firstRevision = store.getSnapshot().revision;
    input[0] = "___________";
    expect(store.getSnapshot()).toMatchObject({
      environmentScopeKey: "environment-a",
      currentSource: { kind: "video", id: videos[0] },
    });
    store.advanceAutomatically(firstRevision, "ended");
    expect(store.getSnapshot().currentSource?.id).toBe(videos[1]);
    store.advanceAutomatically(firstRevision, "unplayable");
    expect(store.getSnapshot().currentSource?.id).toBe(videos[1]);
    const replacedRevision = store.getSnapshot().revision;
    store.start({ name: "Another environment", videoIds: [videos[2]!] }, "environment-b");
    store.advanceAutomatically(replacedRevision, "ended");
    expect(store.getSnapshot()).toMatchObject({
      environmentScopeKey: "environment-b",
      active: true,
      currentSource: { kind: "video", id: videos[2] },
    });
  });

  it("stops at the final item and does not restart from a stale event or a new store", () => {
    const store = createYouTubeQueuePlaybackStore();
    store.start({ name: "One item", videoIds: [videos[0]!] }, "environment-a");
    const revision = store.getSnapshot().revision;
    store.advanceAutomatically(revision, "ended");
    expect(store.getSnapshot()).toMatchObject({ active: false, currentSource: null, videoIds: [] });
    store.advanceAutomatically(revision, "ended");
    expect(store.getSnapshot().active).toBe(false);
    expect(createYouTubeQueuePlaybackStore().getSnapshot().active).toBe(false);
  });

  it("rejects empty, oversized, or noncanonical queues without replacing playback", () => {
    const store = createYouTubeQueuePlaybackStore();
    store.start({ name: "Playing", videoIds: [videos[0]!] }, "environment-a");
    const before = store.getSnapshot();
    for (const videoIds of [[], ["https://example.com"], Array<string>(201).fill(videos[0]!)]) {
      expect(() => store.start({ name: "Invalid", videoIds }, "environment-a")).toThrow(
        "Choose a valid saved YouTube queue.",
      );
      expect(store.getSnapshot()).toBe(before);
    }
    expect(() => store.start({ name: "Invalid", videoIds: [videos[0]!] }, "")).toThrow();
    expect(store.getSnapshot()).toBe(before);
  });
});
