import { useSyncExternalStore } from "react";

export const AUTO_NUDGE_SUPPRESSION_STORAGE_KEY = "cafe-code.auto-nudge.suppressed.v1";
export const AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY =
  "cafe-code.auto-nudge.suppressed-through.v1";
const AUTO_NUDGE_SUPPRESSION_PROBE_KEY = "cafe-code.auto-nudge.suppressed.probe.v1";
const AUTO_NUDGE_SUPPRESSION_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export interface AutoNudgeSuppressionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function resolveSuppressionStorage(): AutoNudgeSuppressionStorage | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const browserDocument = document;
  let storageSignal: AutoNudgeSuppressionStorage | null = null;
  try {
    storageSignal = window.localStorage;
  } catch {
    // A first-party cookie remains the port-independent durable barrier.
  }

  const readCookie = (key: string): string | null => {
    const encodedKey = encodeURIComponent(key);
    for (const segment of browserDocument.cookie.split(";")) {
      const trimmed = segment.trim();
      const separator = trimmed.indexOf("=");
      if (separator < 0 || trimmed.slice(0, separator) !== encodedKey) continue;
      try {
        return decodeURIComponent(trimmed.slice(separator + 1));
      } catch {
        return null;
      }
    }
    return null;
  };
  const writeCookie = (key: string, value: string): void => {
    browserDocument.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; Path=/; Max-Age=${AUTO_NUDGE_SUPPRESSION_COOKIE_MAX_AGE_SECONDS}; SameSite=Strict`;
    if (readCookie(key) !== value) {
      throw new Error("Auto Nudge suppression cookie is unavailable.");
    }
  };
  const removeCookie = (key: string): void => {
    browserDocument.cookie = `${encodeURIComponent(key)}=; Path=/; Max-Age=0; SameSite=Strict`;
    if (readCookie(key) !== null) {
      throw new Error("Auto Nudge suppression cookie could not be removed.");
    }
  };

  const storage: AutoNudgeSuppressionStorage = {
    getItem: (key) => {
      const cookieValue = readCookie(key);
      if (cookieValue !== null) return cookieValue;
      try {
        return storageSignal?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      writeCookie(key, value);
      try {
        // localStorage is only a same-origin change signal. The cookie is the
        // authoritative barrier because cookies survive a desktop port move.
        storageSignal?.setItem(key, value);
      } catch {
        // Final handoff checks read the cookie even when this signal is full.
      }
    },
    removeItem: (key) => {
      removeCookie(key);
      try {
        storageSignal?.removeItem(key);
      } catch {
        // Cookie removal is the authoritative operation.
      }
    },
  };

  // Migrate a Stop written by the localStorage-only implementation and align
  // its notification copy with the authoritative cookie.
  for (const key of [
    AUTO_NUDGE_SUPPRESSION_STORAGE_KEY,
    AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY,
  ]) {
    try {
      const value = storage.getItem(key);
      if (value !== null) storage.setItem(key, value);
    } catch {
      // Construction probes below keep execution fail-closed.
    }
  }
  return storage;
}

function readSuppressionState(storage: AutoNudgeSuppressionStorage | null): {
  readonly available: boolean;
  readonly suppressed: boolean;
} {
  if (!storage) return { available: false, suppressed: false };
  try {
    const stopTokenBefore = storage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY);
    const clearToken = storage.getItem(AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY);
    const stopTokenAfter = storage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY);
    return {
      available: true,
      suppressed:
        stopTokenBefore !== stopTokenAfter ||
        (stopTokenAfter !== null && clearToken !== stopTokenAfter),
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
      (failClosedWithoutDurableStorage &&
        (!suppressionState.available || !this.durableStorageAvailable));
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
  synchronizeSuppressionFromStorage(options?: { readonly verifyDurability?: boolean }): void {
    if (options?.verifyDurability) {
      this.durableStorageAvailable = suppressionStorageIsWritable(this.suppressionStorage);
    }
    const suppressionState = readSuppressionState(this.suppressionStorage);
    if (!suppressionState.available) {
      this.durableStorageAvailable = false;
    }
    this.setSuppressed(
      suppressionState.suppressed ||
        (this.failClosedWithoutDurableStorage &&
          (!suppressionState.available || !this.durableStorageAvailable)),
    );
  }

  /**
   * Revalidate the durable Stop barrier at the final synchronous boundary
   * before a renderer hands an automated prompt to transport.
   */
  confirmExecutionAuthorized(): boolean {
    this.synchronizeSuppressionFromStorage({ verifyDurability: true });
    return !this.suppressed;
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
        if (
          this.suppressionStorage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY) !==
          currentSuppressionToken
        ) {
          this.setSuppressed(true);
          return false;
        }
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
      const stopTokenBefore = this.suppressionStorage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY);
      const clearToken = this.suppressionStorage.getItem(AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY);
      const stopTokenAfter = this.suppressionStorage.getItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY);
      const cleared =
        stopTokenBefore === currentSuppressionToken &&
        stopTokenAfter === currentSuppressionToken &&
        clearToken === currentSuppressionToken;
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
    const browserWindow = window;
    const onStorage = (event: StorageEvent) => {
      if (
        event.key === AUTO_NUDGE_SUPPRESSION_STORAGE_KEY ||
        event.key === AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY
      ) {
        // Storage events are infrequent and represent a cross-window
        // authorization change, so re-probe durability here. Ordinary
        // coordinator reads stay side-effect free.
        arming.synchronizeSuppressionFromStorage({ verifyDurability: true });
      }
    };
    browserWindow.addEventListener("storage", onStorage);
    removeSharedStorageListener = () => browserWindow.removeEventListener("storage", onStorage);
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

export function __resetConfirmedAutoNudgeArmingForTests(options?: {
  readonly clearStorage?: boolean;
}): void {
  if (options?.clearStorage) {
    const storage = resolveSuppressionStorage();
    try {
      storage?.removeItem(AUTO_NUDGE_SUPPRESSION_STORAGE_KEY);
      storage?.removeItem(AUTO_NUDGE_SUPPRESSION_CLEAR_STORAGE_KEY);
    } catch {
      // The reconstructed runtime below remains fail-closed.
    }
  }
  sharedConfirmedAutoNudgeArming = makeSharedConfirmedAutoNudgeArming();
}
