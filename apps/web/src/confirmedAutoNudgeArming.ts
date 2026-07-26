import { useSyncExternalStore } from "react";

export const AUTO_NUDGE_SUPPRESSION_STORAGE_KEY = "cafe-code.auto-nudge.suppressed.v1";
const AUTO_NUDGE_SUPPRESSION_PROBE_KEY = "cafe-code.auto-nudge.suppressed.probe.v1";

export interface AutoNudgeSuppressionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveSuppressionStorage(): AutoNudgeSuppressionStorage | null {
  if (typeof window === "undefined") return null;
  const storages: AutoNudgeSuppressionStorage[] = [];
  try {
    storages.push(window.localStorage);
  } catch {
    // sessionStorage still preserves Stop across a same-tab reload.
  }
  try {
    if (!storages.includes(window.sessionStorage)) storages.push(window.sessionStorage);
  } catch {
    // The in-memory latch remains the final fail-closed fallback.
  }
  if (storages.length === 0) return null;
  return {
    getItem: (key) => {
      for (const storage of storages) {
        try {
          const value = storage.getItem(key);
          if (value !== null) return value;
        } catch {
          // Try the next available browser storage.
        }
      }
      return null;
    },
    setItem: (key, value) => {
      for (const storage of storages) {
        try {
          storage.setItem(key, value);
          return;
        } catch {
          // Fall back to the next storage only when the preferred one fails.
        }
      }
      throw new Error("Auto Nudge suppression storage is unavailable.");
    },
    removeItem: (key) => {
      let removals = 0;
      for (const storage of storages) {
        try {
          storage.removeItem(key);
          removals += 1;
        } catch {
          // Best effort across every available storage.
        }
      }
      if (removals === 0) throw new Error("Auto Nudge suppression storage is unavailable.");
    },
  };
}

function readSuppressed(storage: AutoNudgeSuppressionStorage | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function suppressionStorageIsWritable(storage: AutoNudgeSuppressionStorage | null): boolean {
  if (!storage) return false;
  try {
    const previous = storage.getItem(AUTO_NUDGE_SUPPRESSION_PROBE_KEY);
    storage.setItem(AUTO_NUDGE_SUPPRESSION_PROBE_KEY, "1");
    if (previous === null) {
      storage.removeItem(AUTO_NUDGE_SUPPRESSION_PROBE_KEY);
    } else {
      storage.setItem(AUTO_NUDGE_SUPPRESSION_PROBE_KEY, previous);
    }
    return true;
  } catch {
    return false;
  }
}

export class ConfirmedAutoNudgeArming {
  private generation = 0;
  private arming = false;
  private suppressed: boolean;
  private durableStorageAvailable: boolean;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly suppressionStorage: AutoNudgeSuppressionStorage | null = null,
    private readonly failClosedWithoutDurableStorage = false,
  ) {
    this.durableStorageAvailable = suppressionStorageIsWritable(suppressionStorage);
    this.suppressed =
      readSuppressed(suppressionStorage) ||
      (failClosedWithoutDurableStorage && !this.durableStorageAvailable);
  }

  getSnapshot = (): boolean => this.arming;
  getSuppressedSnapshot = (): boolean => this.suppressed;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private setArming(arming: boolean): void {
    if (this.arming === arming) return;
    this.arming = arming;
    this.emit();
  }

  private setSuppressed(suppressed: boolean): void {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    this.emit();
  }

  /**
   * Stop is an execution boundary, not merely a settings preference. Latch it
   * before attempting RPC persistence so a rejected write cannot revive the
   * previously saved mode on a later completed turn or renderer reload.
   */
  suppress(): void {
    this.generation += 1;
    try {
      this.suppressionStorage?.setItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY, "1");
      this.durableStorageAvailable = this.suppressionStorage !== null;
    } catch {
      // The in-memory latch still keeps this renderer fail-closed.
      this.durableStorageAvailable = false;
    }
    this.setSuppressed(true);
    this.setArming(false);
  }

  /**
   * Reconcile a storage event from another renderer. A missing key means an
   * explicit, successfully persisted enable cleared the stop latch.
   */
  synchronizeSuppressionFromStorage(): void {
    this.setSuppressed(
      readSuppressed(this.suppressionStorage) ||
        (this.failClosedWithoutDurableStorage && !this.durableStorageAvailable),
    );
  }

  private clearSuppression(): boolean {
    this.durableStorageAvailable = suppressionStorageIsWritable(this.suppressionStorage);
    if (!this.suppressionStorage || !this.durableStorageAvailable) {
      this.setSuppressed(this.failClosedWithoutDurableStorage);
      return !this.suppressed;
    }
    try {
      this.suppressionStorage.removeItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY);
      const cleared =
        this.suppressionStorage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY) === null;
      if (!cleared) this.durableStorageAvailable = false;
      this.setSuppressed(!cleared && this.failClosedWithoutDurableStorage);
      return !this.suppressed;
    } catch {
      this.durableStorageAvailable = false;
      this.setSuppressed(this.failClosedWithoutDurableStorage);
      return !this.suppressed;
    }
  }

  invalidate(): void {
    this.generation += 1;
    this.setArming(false);
  }

  async arm(input: {
    persistEnabled: () => Promise<void>;
    start: () => void;
    clearSuppression?: boolean;
  }): Promise<boolean> {
    const generation = this.generation + 1;
    this.generation = generation;
    this.setArming(true);
    try {
      await input.persistEnabled();
      if (this.generation !== generation) return false;
      if (input.clearSuppression) {
        if (!this.clearSuppression()) return false;
      }
      input.start();
      return true;
    } finally {
      if (this.generation === generation) this.setArming(false);
    }
  }
}

let removeSharedStorageListener: (() => void) | null = null;

function makeSharedConfirmedAutoNudgeArming(): ConfirmedAutoNudgeArming {
  removeSharedStorageListener?.();
  removeSharedStorageListener = null;
  const storage = resolveSuppressionStorage();
  const arming = new ConfirmedAutoNudgeArming(storage, true);
  if (typeof window !== "undefined") {
    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTO_NUDGE_SUPPRESSION_STORAGE_KEY) {
        arming.synchronizeSuppressionFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    removeSharedStorageListener = () => window.removeEventListener("storage", onStorage);
  }
  return arming;
}

let sharedConfirmedAutoNudgeArming = makeSharedConfirmedAutoNudgeArming();

export function getConfirmedAutoNudgeArming(): ConfirmedAutoNudgeArming {
  return sharedConfirmedAutoNudgeArming;
}

export function useConfirmedAutoNudgeArmingState(): boolean {
  const arming = getConfirmedAutoNudgeArming();
  return useSyncExternalStore(arming.subscribe, arming.getSnapshot, arming.getSnapshot);
}

export function useAutoNudgeSuppressedState(): boolean {
  const arming = getConfirmedAutoNudgeArming();
  return useSyncExternalStore(
    arming.subscribe,
    arming.getSuppressedSnapshot,
    arming.getSuppressedSnapshot,
  );
}

export function __resetConfirmedAutoNudgeArmingForTests(): void {
  sharedConfirmedAutoNudgeArming = makeSharedConfirmedAutoNudgeArming();
}
