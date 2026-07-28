import { useSyncExternalStore } from "react";

export const AUTO_NUDGE_SUPPRESSION_STORAGE_KEY = "cafe-code.auto-nudge.suppressed.v1";
export const AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY =
  "cafe-code.auto-nudge.suppressed-through.v1";
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
      let readableStorages = 0;
      for (const storage of storages) {
        try {
          const value = storage.getItem(key);
          readableStorages += 1;
          if (value !== null) return value;
        } catch {
          // Try the next available browser storage.
        }
      }
      if (readableStorages === 0) {
        throw new Error("Auto Nudge suppression storage is unavailable.");
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
          // Best effort across every available browser storage.
        }
      }
      if (removals === 0) throw new Error("Auto Nudge suppression storage is unavailable.");
    },
  };
}

function readSuppressionState(storage: AutoNudgeSuppressionStorage | null): {
  readonly available: boolean;
  readonly suppressed: boolean;
} {
  if (!storage) return { available: false, suppressed: false };
  try {
    const stopToken = storage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY);
    return {
      available: true,
      suppressed:
        stopToken !== null &&
        storage.getItem(AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY) !== stopToken,
    };
  } catch {
    return { available: false, suppressed: false };
  }
}

function newSuppressionToken(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid
    ? `v1:${randomUuid}`
    : `v1:${Date.now()}:${Math.random().toString(36).slice(2)}`;
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
    const suppressionState = readSuppressionState(suppressionStorage);
    this.suppressed =
      suppressionState.suppressed ||
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
      this.suppressionStorage?.setItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY, newSuppressionToken());
      this.durableStorageAvailable = this.suppressionStorage !== null;
    } catch {
      // The in-memory latch still keeps this renderer fail-closed.
      this.durableStorageAvailable = false;
    }
    this.setSuppressed(true);
    this.setArming(false);
  }

  /**
   * Reconcile a storage event from another renderer. A matching clear token
   * means an explicit, successfully persisted enable acknowledged that Stop.
   */
  synchronizeSuppressionFromStorage(): void {
    const suppressionState = readSuppressionState(this.suppressionStorage);
    if (!suppressionState.available) {
      this.durableStorageAvailable = false;
    }
    this.setSuppressed(
      suppressionState.suppressed ||
        (this.failClosedWithoutDurableStorage && !this.durableStorageAvailable),
    );
  }

  private readSuppressionToken(): string | null | undefined {
    if (!this.suppressionStorage) return undefined;
    try {
      return this.suppressionStorage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY);
    } catch {
      return undefined;
    }
  }

  private clearSuppression(expectedSuppressionToken: string | null | undefined): boolean {
    this.durableStorageAvailable = suppressionStorageIsWritable(this.suppressionStorage);
    if (!this.suppressionStorage || !this.durableStorageAvailable) {
      this.setSuppressed(this.failClosedWithoutDurableStorage);
      return !this.suppressed;
    }
    try {
      const currentSuppressionToken = this.suppressionStorage.getItem(
        AUTO_NUDGE_SUPPRESSION_STORAGE_KEY,
      );
      if (
        expectedSuppressionToken !== undefined &&
        currentSuppressionToken !== expectedSuppressionToken
      ) {
        // Another renderer issued Stop after this enable began. Never let an
        // older settings acknowledgement clear that newer execution boundary.
        this.setSuppressed(true);
        return false;
      }
      if (currentSuppressionToken === null) {
        this.setSuppressed(false);
        return true;
      }
      // Acknowledge the observed Stop generation instead of deleting it.
      // Separate monotonic tokens avoid a get/remove race erasing a newer Stop
      // written by another renderer between those two storage operations.
      this.suppressionStorage.setItem(
        AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY,
        currentSuppressionToken,
      );
      const cleared =
        this.suppressionStorage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY) ===
          currentSuppressionToken &&
        this.suppressionStorage.getItem(AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY) ===
          currentSuppressionToken;
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
    const suppressionTokenAtArm = input.clearSuppression ? this.readSuppressionToken() : undefined;
    this.generation = generation;
    this.setArming(true);
    try {
      await input.persistEnabled();
      if (this.generation !== generation) return false;
      if (input.clearSuppression) {
        if (!this.clearSuppression(suppressionTokenAtArm)) return false;
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
      if (
        event.key === AUTO_NUDGE_SUPPRESSION_STORAGE_KEY ||
        event.key === AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY
      ) {
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
