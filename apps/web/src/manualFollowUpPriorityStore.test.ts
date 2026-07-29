import { describe, expect, it } from "vitest";

import { createManualFollowUpPriorityStore } from "./manualFollowUpPriorityStore";

describe("manualFollowUpPriorityStore", () => {
  it("keeps queued and in-flight representations continuously prioritized", () => {
    const store = createManualFollowUpPriorityStore();
    const owner = {};
    const target = { environmentId: "environment-a", threadId: "thread-a" };

    store.replace(owner, [target]);
    expect(store.has(target)).toBe(true);

    // ChatView replaces its complete metadata snapshot when a queue item
    // becomes a pending turn start, steer, or interrupt recovery. The target
    // remains owned across that representation change.
    store.replace(owner, [target]);
    expect(store.has(target)).toBe(true);

    store.replace(owner, []);
    expect(store.has(target)).toBe(false);
  });

  it("isolates exact environment and thread identities", () => {
    const store = createManualFollowUpPriorityStore();
    const owner = {};

    store.replace(owner, [{ environmentId: "environment-a", threadId: "thread-shared" }]);

    expect(store.has({ environmentId: "environment-a", threadId: "thread-shared" })).toBe(true);
    expect(store.has({ environmentId: "environment-b", threadId: "thread-shared" })).toBe(false);
    expect(store.has({ environmentId: "environment-a", threadId: "thread-other" })).toBe(false);
  });

  it("does not let one StrictMode-safe owner release another owner's priority", () => {
    const store = createManualFollowUpPriorityStore();
    const firstOwner = {};
    const secondOwner = {};
    const target = { environmentId: "environment-a", threadId: "thread-a" };

    store.replace(firstOwner, [target]);
    store.replace(secondOwner, [target]);
    store.release(firstOwner);
    expect(store.has(target)).toBe(true);

    store.release(firstOwner);
    expect(store.has(target)).toBe(true);

    store.release(secondOwner);
    expect(store.has(target)).toBe(false);
  });
});
