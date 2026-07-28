import { describe, expect, it, vi } from "vitest";

import {
  AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY,
  AUTO_NUDGE_SUPPRESSION_STORAGE_KEY,
  __resetConfirmedAutoNudgeArmingForTests,
  type AutoNudgeSuppressionStorage,
  ConfirmedAutoNudgeArming,
  getConfirmedAutoNudgeArming,
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

function cookieDocumentFixture(): Document {
  const values = new Map<string, string>();
  const cookieDocument = {} as Document;
  Object.defineProperty(cookieDocument, "cookie", {
    configurable: true,
    get: () => [...values.entries()].map(([key, value]) => `${key}=${value}`).join("; "),
    set: (serialized: string) => {
      const parts = serialized.split(";").map((part) => part.trim());
      const separator = parts[0]?.indexOf("=") ?? -1;
      if (separator < 0) return;
      const key = parts[0]!.slice(0, separator);
      const value = parts[0]!.slice(separator + 1);
      if (parts.some((part) => part.toLowerCase() === "max-age=0")) {
        values.delete(key);
      } else {
        values.set(key, value);
      }
    },
  });
  return cookieDocument;
}

function suppressionWindowFixture(localStorage: AutoNudgeSuppressionStorage) {
  return {
    localStorage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
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

    storage.setItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY, "stop-1");
    coordinator.synchronizeSuppressionFromStorage();
    expect(coordinator.getSuppressedSnapshot()).toBe(true);

    storage.setItem(AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY, "stop-1");
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

  it("starts suppressed when the probe works but the Stop barrier cannot be read", () => {
    const values = new Map<string, string>();
    const partiallyDeniedStorage: AutoNudgeSuppressionStorage = {
      getItem: (key) => {
        if (
          key === AUTO_NUDGE_SUPPRESSION_STORAGE_KEY ||
          key === AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY
        ) {
          throw new Error("barrier read denied");
        }
        return values.get(key) ?? null;
      },
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => {
        values.delete(key);
      },
    };

    expect(new ConfirmedAutoNudgeArming(partiallyDeniedStorage, true).getSuppressedSnapshot()).toBe(
      true,
    );
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

  it("fails closed when durable storage remains readable but stops accepting writes", () => {
    const values = new Map<string, string>();
    let writesDenied = false;
    const storage: AutoNudgeSuppressionStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        if (writesDenied) throw new Error("storage quota reached");
        values.set(key, value);
      },
      removeItem: (key) => {
        if (writesDenied) throw new Error("storage quota reached");
        values.delete(key);
      },
    };
    const coordinator = new ConfirmedAutoNudgeArming(storage, true);
    expect(coordinator.getSuppressedSnapshot()).toBe(false);

    writesDenied = true;
    coordinator.synchronizeSuppressionFromStorage({ verifyDurability: true });

    expect(coordinator.getSuppressedSnapshot()).toBe(true);
  });

  it("keeps ordinary suppression reads side-effect free", () => {
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => values.set(key, value));
    const removeItem = vi.fn((key: string) => {
      values.delete(key);
    });
    const storage: AutoNudgeSuppressionStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem,
      removeItem,
    };
    const coordinator = new ConfirmedAutoNudgeArming(storage, true);
    setItem.mockClear();
    removeItem.mockClear();

    coordinator.synchronizeSuppressionFromStorage();
    coordinator.synchronizeSuppressionFromStorage();

    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });

  it("treats a Stop token changed during a storage read as suppressed", () => {
    const values = new Map<string, string>([
      [AUTO_NUDGE_SUPPRESSION_STORAGE_KEY, "stop-1"],
      [AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY, "stop-1"],
    ]);
    let changeStopDuringRead = false;
    let stopReads = 0;
    const storage: AutoNudgeSuppressionStorage = {
      getItem: (key) => {
        if (key === AUTO_NUDGE_SUPPRESSION_STORAGE_KEY && changeStopDuringRead) {
          stopReads += 1;
          if (stopReads === 1) {
            values.set(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY, "stop-2");
            return "stop-1";
          }
        }
        return values.get(key) ?? null;
      },
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => {
        values.delete(key);
      },
    };
    const coordinator = new ConfirmedAutoNudgeArming(storage, true);
    expect(coordinator.getSuppressedSnapshot()).toBe(false);

    changeStopDuringRead = true;
    coordinator.synchronizeSuppressionFromStorage();

    expect(coordinator.getSuppressedSnapshot()).toBe(true);
  });

  it("rejects a handoff when another renderer wrote Stop before its storage event arrives", () => {
    const storage = memoryStorage();
    const coordinator = new ConfirmedAutoNudgeArming(storage, true);
    expect(coordinator.confirmExecutionAuthorized()).toBe(true);

    storage.setItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY, "cross-window-stop");

    expect(coordinator.confirmExecutionAuthorized()).toBe(false);
  });

  it("does not clear a newer Stop written during clear verification", async () => {
    const values = new Map<string, string>();
    let replaceStopDuringVerification = false;
    let stopReadsAfterClear = 0;
    const storage: AutoNudgeSuppressionStorage = {
      getItem: (key) => {
        const value = values.get(key) ?? null;
        if (key === AUTO_NUDGE_SUPPRESSION_STORAGE_KEY && replaceStopDuringVerification) {
          stopReadsAfterClear += 1;
          if (stopReadsAfterClear === 1) {
            values.set(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY, "newer-stop");
          }
        }
        return value;
      },
      setItem: (key, value) => {
        values.set(key, value);
        if (key === AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY) {
          replaceStopDuringVerification = true;
        }
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

    expect(coordinator.getSuppressedSnapshot()).toBe(true);
    expect(values.get(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY)).toBe("newer-stop");
    expect(start).not.toHaveBeenCalled();
  });

  it("does not mistake session-only storage for a restart-durable Stop barrier", () => {
    const sessionStorage = memoryStorage();
    vi.stubGlobal("window", {
      get localStorage() {
        throw new Error("local storage denied");
      },
      sessionStorage,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    try {
      __resetConfirmedAutoNudgeArmingForTests();
      expect(getConfirmedAutoNudgeArming().getSuppressedSnapshot()).toBe(true);
      expect(sessionStorage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      __resetConfirmedAutoNudgeArmingForTests();
    }
  });

  it("preserves Stop when a desktop restart moves to a different localStorage origin", () => {
    const cookieDocument = cookieDocumentFixture();
    const firstOriginStorage = memoryStorage();
    vi.stubGlobal("document", cookieDocument);
    vi.stubGlobal("window", suppressionWindowFixture(firstOriginStorage));

    try {
      __resetConfirmedAutoNudgeArmingForTests({ clearStorage: true });
      const beforeRestart = getConfirmedAutoNudgeArming();
      expect(beforeRestart.confirmExecutionAuthorized()).toBe(true);
      beforeRestart.suppress();
      expect(beforeRestart.getSuppressedSnapshot()).toBe(true);

      const nextOriginStorage = memoryStorage();
      vi.stubGlobal("window", suppressionWindowFixture(nextOriginStorage));
      __resetConfirmedAutoNudgeArmingForTests();

      expect(getConfirmedAutoNudgeArming().getSuppressedSnapshot()).toBe(true);
      expect(nextOriginStorage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY)).not.toBeNull();
    } finally {
      __resetConfirmedAutoNudgeArmingForTests({ clearStorage: true });
      vi.unstubAllGlobals();
      __resetConfirmedAutoNudgeArmingForTests();
    }
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
