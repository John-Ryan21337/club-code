import { describe, expect, it } from "vitest";

import {
  AUTO_NUDGE_THREAD_POLICY_STORAGE_KEY,
  AutoNudgeThreadPolicyStore,
} from "./autoNudgeThreadPolicy";

function storageFixture() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  };
}

const threadA = { environmentId: "local", threadId: "thread-a" };
const threadB = { environmentId: "local", threadId: "thread-b" };

describe("per-thread Auto Nudge policy", () => {
  it("fails closed for every unknown thread instead of inheriting another thread's mode", () => {
    const store = new AutoNudgeThreadPolicyStore(null);

    store.setPolicy(threadA, {
      mode: "steady-progress",
      backgroundContinuation: true,
    });

    expect(store.getPolicy(threadA)).toMatchObject({
      mode: "steady-progress",
      backgroundContinuation: true,
    });
    expect(store.getPolicy(threadB)).toMatchObject({
      mode: "off",
      backgroundContinuation: false,
    });
  });

  it("persists an enabled background thread across navigation and renderer reload", () => {
    const { storage } = storageFixture();
    const beforeNavigation = new AutoNudgeThreadPolicyStore(storage);
    beforeNavigation.setPolicy(threadA, {
      mode: "hardcore-fanout",
      backgroundContinuation: true,
      maxRounds: 8,
      maxMinutes: 45,
    });

    const onOtherThread = new AutoNudgeThreadPolicyStore(storage);
    expect(onOtherThread.getPolicy(threadB).mode).toBe("off");
    onOtherThread.setPolicy(threadB, { mode: "off" });

    const afterReturn = new AutoNudgeThreadPolicyStore(storage);
    expect(afterReturn.getPolicy(threadA)).toEqual({
      mode: "hardcore-fanout",
      backgroundContinuation: true,
      maxRounds: 8,
      maxMinutes: 45,
    });
    expect(afterReturn.getPolicy(threadB).mode).toBe("off");
  });

  it("turning a thread off also disables only that thread's background continuation", () => {
    const store = new AutoNudgeThreadPolicyStore(null);
    store.setPolicy(threadA, {
      mode: "steady-progress",
      backgroundContinuation: true,
    });
    store.setPolicy(threadB, {
      mode: "hardcore-fanout",
      backgroundContinuation: true,
    });

    store.setPolicy(threadB, { mode: "off" });

    expect(store.getPolicy(threadA).backgroundContinuation).toBe(true);
    expect(store.getPolicy(threadB)).toMatchObject({
      mode: "off",
      backgroundContinuation: false,
    });
  });

  it("uses collision-safe environment and thread identities", () => {
    const store = new AutoNudgeThreadPolicyStore(null);
    const left = { environmentId: "a:b", threadId: "c" };
    const right = { environmentId: "a", threadId: "b:c" };

    store.setPolicy(left, { mode: "steady-progress" }, 1);
    store.setPolicy(right, { mode: "hardcore-fanout" }, 2);

    expect(store.getPolicy(left).mode).toBe("steady-progress");
    expect(store.getPolicy(right).mode).toBe("hardcore-fanout");
  });

  it("bounds persisted policies and evicts the oldest entries", () => {
    const { storage, values } = storageFixture();
    const store = new AutoNudgeThreadPolicyStore(storage);
    for (let index = 0; index < 300; index += 1) {
      store.setPolicy(
        { environmentId: "local", threadId: `thread-${index}` },
        { mode: "steady-progress" },
        index,
      );
    }

    const persisted = JSON.parse(values.get(AUTO_NUDGE_THREAD_POLICY_STORAGE_KEY) ?? "{}") as {
      entries?: unknown[];
    };
    expect(persisted.entries).toHaveLength(256);
    expect(store.getPolicy({ environmentId: "local", threadId: "thread-0" }).mode).toBe("off");
    expect(store.getPolicy({ environmentId: "local", threadId: "thread-299" }).mode).toBe(
      "steady-progress",
    );
  });

  it("fails closed on corrupt, oversized, or invalid persisted policy data", () => {
    const { storage, values } = storageFixture();
    values.set(AUTO_NUDGE_THREAD_POLICY_STORAGE_KEY, "{not-json");
    expect(new AutoNudgeThreadPolicyStore(storage).getPolicy(threadA).mode).toBe("off");

    values.set(AUTO_NUDGE_THREAD_POLICY_STORAGE_KEY, "x".repeat(96_001));
    expect(new AutoNudgeThreadPolicyStore(storage).getPolicy(threadA).mode).toBe("off");

    values.set(
      AUTO_NUDGE_THREAD_POLICY_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        entries: [
          {
            ...threadA,
            mode: "steady-progress",
            backgroundContinuation: true,
            maxRounds: 999,
            maxMinutes: 30,
            updatedAt: 1,
          },
        ],
      }),
    );
    expect(new AutoNudgeThreadPolicyStore(storage).getPolicy(threadA).mode).toBe("off");
  });
});
