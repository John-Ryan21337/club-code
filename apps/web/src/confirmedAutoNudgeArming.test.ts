import { describe, expect, it, vi } from "vitest";

import {
  AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY,
  AUTO_NUDGE_SUPPRESSION_STORAGE_KEY,
  type AutoNudgeSuppressionStorage,
  ConfirmedAutoNudgeArming,
} from "./confirmedAutoNudgeArming";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function memoryStorage(): AutoNudgeSuppressionStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe("confirmed auto nudge arming", () => {
  it("starts exactly once only after settings persistence succeeds", async () => {
    const persistence = deferred();
    const start = vi.fn();
    const armingStates: boolean[] = [];
    const coordinator = new ConfirmedAutoNudgeArming();
    coordinator.subscribe(() => armingStates.push(coordinator.getSnapshot()));

    const result = coordinator.arm({
      persistEnabled: () => persistence.promise,
      start,
    });
    expect(start).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot()).toBe(true);

    persistence.resolve();
    await expect(result).resolves.toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(armingStates).toEqual([true, false]);
  });

  it("does not start when settings persistence fails", async () => {
    const start = vi.fn();
    const coordinator = new ConfirmedAutoNudgeArming();

    await expect(
      coordinator.arm({
        persistEnabled: () => Promise.reject(new Error("settings unavailable")),
        start,
      }),
    ).rejects.toThrow("settings unavailable");
    expect(start).not.toHaveBeenCalled();
    expect(coordinator.getSnapshot()).toBe(false);
  });

  it("does not start after an explicit disable invalidates an in-flight arm", async () => {
    const persistence = deferred();
    const start = vi.fn();
    const coordinator = new ConfirmedAutoNudgeArming();
    const result = coordinator.arm({
      persistEnabled: () => persistence.promise,
      start,
    });

    coordinator.invalidate();
    persistence.resolve();

    await expect(result).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it("keeps an in-flight owner capture alive when the initiating view unsubscribes", async () => {
    const persistence = deferred();
    const start = vi.fn();
    const coordinator = new ConfirmedAutoNudgeArming();
    const listener = vi.fn();
    const unsubscribe = coordinator.subscribe(listener);
    const result = coordinator.arm({
      persistEnabled: () => persistence.promise,
      start,
    });

    // Route navigation unmounts the initiating ChatView, but it is not an
    // operator cancellation signal for a background continuation request.
    unsubscribe();
    persistence.resolve();

    await expect(result).resolves.toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    expect(coordinator.getSnapshot()).toBe(false);
  });

  it("allows a newer global request to supersede an older owner capture", async () => {
    const firstPersistence = deferred();
    const firstStart = vi.fn();
    const secondStart = vi.fn();
    const coordinator = new ConfirmedAutoNudgeArming();
    const first = coordinator.arm({
      persistEnabled: () => firstPersistence.promise,
      start: firstStart,
    });
    const second = coordinator.arm({
      persistEnabled: () => Promise.resolve(),
      start: secondStart,
    });

    await expect(second).resolves.toBe(true);
    firstPersistence.resolve();
    await expect(first).resolves.toBe(false);
    expect(firstStart).not.toHaveBeenCalled();
    expect(secondStart).toHaveBeenCalledTimes(1);
  });

  it("durably suppresses execution before a disable write can fail", async () => {
    const storage = memoryStorage();
    const persistence = deferred();
    const start = vi.fn();
    const coordinator = new ConfirmedAutoNudgeArming(storage);
    const pendingEnable = coordinator.arm({
      persistEnabled: () => persistence.promise,
      start,
    });

    coordinator.suppress();
    persistence.resolve();

    await expect(pendingEnable).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(coordinator.getSuppressedSnapshot()).toBe(true);
    expect(storage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY)).not.toBeNull();
    expect(new ConfirmedAutoNudgeArming(storage).getSuppressedSnapshot()).toBe(true);
  });

  it("lets Stop fail closed even when an enable write never settles", () => {
    const storage = memoryStorage();
    const persistence = deferred();
    const start = vi.fn();
    const coordinator = new ConfirmedAutoNudgeArming(storage);
    void coordinator.arm({
      persistEnabled: () => persistence.promise,
      start,
    });

    coordinator.suppress();

    expect(coordinator.getSnapshot()).toBe(false);
    expect(coordinator.getSuppressedSnapshot()).toBe(true);
    expect(storage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY)).not.toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("does not let an older enable clear a Stop from another renderer", async () => {
    const storage = memoryStorage();
    const persistence = deferred();
    const stoppingRenderer = new ConfirmedAutoNudgeArming(storage, true);
    stoppingRenderer.suppress();
    const earlierStopToken = storage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY);
    const enablingRenderer = new ConfirmedAutoNudgeArming(storage, true);
    const start = vi.fn();
    const pendingEnable = enablingRenderer.arm({
      persistEnabled: () => persistence.promise,
      start,
      clearSuppression: true,
    });

    stoppingRenderer.suppress();
    const newerStopToken = storage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY);
    expect(newerStopToken).not.toBeNull();
    expect(newerStopToken).not.toBe(earlierStopToken);
    persistence.resolve();

    await expect(pendingEnable).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
    expect(enablingRenderer.getSuppressedSnapshot()).toBe(true);
    expect(storage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY)).toBe(newerStopToken);
  });

  it("clears a stop latch only after an explicit enable is confirmed", async () => {
    const storage = memoryStorage();
    const coordinator = new ConfirmedAutoNudgeArming(storage);
    const start = vi.fn();
    coordinator.suppress();

    await expect(
      coordinator.arm({
        persistEnabled: () => Promise.reject(new Error("settings unavailable")),
        start,
        clearSuppression: true,
      }),
    ).rejects.toThrow("settings unavailable");
    expect(coordinator.getSuppressedSnapshot()).toBe(true);
    expect(start).not.toHaveBeenCalled();

    await expect(
      coordinator.arm({
        persistEnabled: () => Promise.resolve(),
        start,
        clearSuppression: true,
      }),
    ).resolves.toBe(true);
    expect(coordinator.getSuppressedSnapshot()).toBe(false);
    expect(storage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY)).not.toBeNull();
    expect(new ConfirmedAutoNudgeArming(storage, true).getSuppressedSnapshot()).toBe(false);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("reconciles a stop latch written by another renderer", () => {
    const storage = memoryStorage();
    const coordinator = new ConfirmedAutoNudgeArming(storage);
    const listener = vi.fn();
    coordinator.subscribe(listener);

    storage.setItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY, "1");
    coordinator.synchronizeSuppressionFromStorage();
    expect(coordinator.getSuppressedSnapshot()).toBe(true);

    storage.setItem(AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY, "1");
    coordinator.synchronizeSuppressionFromStorage();
    expect(coordinator.getSuppressedSnapshot()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("starts suppressed when the runtime requires durability but storage is denied", () => {
    const deniedStorage: AutoNudgeSuppressionStorage = {
      getItem: () => {
        throw new Error("storage denied");
      },
      setItem: () => {
        throw new Error("storage denied");
      },
      removeItem: () => {
        throw new Error("storage denied");
      },
    };

    expect(new ConfirmedAutoNudgeArming(deniedStorage, true).getSuppressedSnapshot()).toBe(true);
  });

  it("fails closed on a later storage outage and recovers through an explicit enable", async () => {
    const values = new Map<string, string>();
    let storageUnavailable = false;
    const storage: AutoNudgeSuppressionStorage = {
      getItem: (key) => {
        if (storageUnavailable) throw new Error("storage unavailable");
        return values.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (storageUnavailable) throw new Error("storage unavailable");
        values.set(key, value);
      },
      removeItem: (key) => {
        if (storageUnavailable) throw new Error("storage unavailable");
        values.delete(key);
      },
    };
    const coordinator = new ConfirmedAutoNudgeArming(storage, true);
    const start = vi.fn();
    expect(coordinator.getSuppressedSnapshot()).toBe(false);

    storageUnavailable = true;
    coordinator.synchronizeSuppressionFromStorage();
    expect(coordinator.getSuppressedSnapshot()).toBe(true);

    storageUnavailable = false;
    await expect(
      coordinator.arm({
        persistEnabled: () => Promise.resolve(),
        start,
        clearSuppression: true,
      }),
    ).resolves.toBe(true);
    expect(coordinator.getSuppressedSnapshot()).toBe(false);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("does not arm execution when a confirmed enable still cannot clear durable suppression", async () => {
    const deniedStorage: AutoNudgeSuppressionStorage = {
      getItem: () => {
        throw new Error("storage denied");
      },
      setItem: () => {
        throw new Error("storage denied");
      },
      removeItem: () => {
        throw new Error("storage denied");
      },
    };
    const coordinator = new ConfirmedAutoNudgeArming(deniedStorage, true);
    const start = vi.fn();

    await expect(
      coordinator.arm({
        persistEnabled: () => Promise.resolve(),
        start,
        clearSuppression: true,
      }),
    ).resolves.toBe(false);
    expect(coordinator.getSuppressedSnapshot()).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });

  it("does not resurrect execution when the Stop generation cannot be acknowledged", async () => {
    const values = new Map<string, string>();
    const storage: AutoNudgeSuppressionStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (key === AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY) {
          throw new Error("clear acknowledgement is unavailable");
        }
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    };
    const coordinator = new ConfirmedAutoNudgeArming(storage, true);
    const start = vi.fn();
    coordinator.suppress();

    await expect(
      coordinator.arm({
        persistEnabled: () => Promise.resolve(),
        start,
        clearSuppression: true,
      }),
    ).resolves.toBe(false);

    expect(values.get(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY)).not.toBeNull();
    expect(coordinator.getSuppressedSnapshot()).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });
});
