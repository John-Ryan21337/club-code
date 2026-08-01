import {
  DEFAULT_AUTO_NUDGE_MAX_ROUNDS,
  MAX_AUTO_NUDGE_MAX_ROUNDS,
  MIN_AUTO_NUDGE_MAX_ROUNDS,
  type AutoNudgeMode,
} from "@cafecode/contracts";
import { useCallback, useSyncExternalStore } from "react";

import type { BackgroundAutoNudgeThreadRef } from "./backgroundAutoNudger";

export const AUTO_NUDGE_THREAD_POLICY_STORAGE_KEY = "cafe-code.auto-nudge.thread-policies.v2";
export const AUTO_NUDGE_EXECUTION_LOCK_NAME = "cafe-code.auto-nudge.execution.v2";

const MAX_POLICY_ENTRIES = 256;
const MAX_POLICY_STORAGE_CHARACTERS = 96_000;
const MAX_SAFE_ID_LENGTH = 512;

export interface AutoNudgeThreadPolicy {
  readonly mode: AutoNudgeMode;
  readonly backgroundContinuation: boolean;
  readonly maxRounds: number;
}

interface StoredAutoNudgeThreadPolicy extends AutoNudgeThreadPolicy {
  readonly environmentId: string;
  readonly threadId: string;
  readonly updatedAt: number;
}

interface StoredAutoNudgeThreadPolicyRegistry {
  readonly version: 2;
  readonly entries: readonly StoredAutoNudgeThreadPolicy[];
}

export interface AutoNudgeThreadPolicyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEFAULT_AUTO_NUDGE_THREAD_POLICY: AutoNudgeThreadPolicy = Object.freeze({
  mode: "off",
  backgroundContinuation: false,
  maxRounds: DEFAULT_AUTO_NUDGE_MAX_ROUNDS,
});

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_SAFE_ID_LENGTH;
}

function safeMode(value: unknown): value is AutoNudgeMode {
  return value === "off" || value === "hardcore-fanout" || value === "steady-progress";
}

function safeInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

export function isValidAutoNudgeThreadPolicy(
  value: unknown,
  options?: { readonly requireBackgroundContinuation?: boolean },
): value is AutoNudgeThreadPolicy {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AutoNudgeThreadPolicy>;
  return (
    safeMode(candidate.mode) &&
    typeof candidate.backgroundContinuation === "boolean" &&
    (!candidate.backgroundContinuation || candidate.mode !== "off") &&
    (!options?.requireBackgroundContinuation || candidate.backgroundContinuation) &&
    safeInteger(candidate.maxRounds, MIN_AUTO_NUDGE_MAX_ROUNDS, MAX_AUTO_NUDGE_MAX_ROUNDS)
  );
}

function entryKey(ref: BackgroundAutoNudgeThreadRef): string {
  // JSON encoding avoids the delimiter collisions possible with arbitrary
  // environment and thread ids.
  return JSON.stringify([ref.environmentId, ref.threadId]);
}

function policyFromEntry(entry: StoredAutoNudgeThreadPolicy): AutoNudgeThreadPolicy {
  return Object.freeze({
    mode: entry.mode,
    backgroundContinuation: entry.backgroundContinuation,
    maxRounds: entry.maxRounds,
  });
}

function isValidStoredPolicy(value: unknown): value is StoredAutoNudgeThreadPolicy {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StoredAutoNudgeThreadPolicy>;
  const updatedAt = candidate.updatedAt;
  return (
    safeId(candidate.environmentId) &&
    safeId(candidate.threadId) &&
    isValidAutoNudgeThreadPolicy(candidate) &&
    Number.isFinite(updatedAt) &&
    Number(updatedAt) >= 0
  );
}

function readEntries(
  storage: AutoNudgeThreadPolicyStorage | null,
): readonly StoredAutoNudgeThreadPolicy[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(AUTO_NUDGE_THREAD_POLICY_STORAGE_KEY);
    if (!raw || raw.length > MAX_POLICY_STORAGE_CHARACTERS) return [];
    const parsed = JSON.parse(raw) as Partial<StoredAutoNudgeThreadPolicyRegistry>;
    if (parsed.version !== 2 || !Array.isArray(parsed.entries)) return [];

    const unique = new Map<string, StoredAutoNudgeThreadPolicy>();
    for (const candidate of parsed.entries.slice(-MAX_POLICY_ENTRIES)) {
      if (!isValidStoredPolicy(candidate)) continue;
      unique.set(entryKey(candidate), {
        environmentId: candidate.environmentId,
        threadId: candidate.threadId,
        mode: candidate.mode,
        backgroundContinuation: candidate.backgroundContinuation,
        maxRounds: candidate.maxRounds,
        updatedAt: candidate.updatedAt,
      });
    }
    return [...unique.values()]
      .toSorted((left, right) => left.updatedAt - right.updatedAt)
      .slice(-MAX_POLICY_ENTRIES);
  } catch {
    return [];
  }
}

function resolveStorage(): AutoNudgeThreadPolicyStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Bounded, device-local policies keyed by the exact server thread identity.
 *
 * No global setting is used as a default. An unknown thread always fails
 * closed to Off, even when another thread has an active background run.
 */
export class AutoNudgeThreadPolicyStore {
  private entries: readonly StoredAutoNudgeThreadPolicy[];
  private byKey = new Map<string, AutoNudgeThreadPolicy>();
  private readonly listeners = new Set<() => void>();
  private serialized = "";

  constructor(private readonly storage: AutoNudgeThreadPolicyStorage | null) {
    this.entries = readEntries(storage);
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.byKey = new Map(
      this.entries.map((entry) => [entryKey(entry), policyFromEntry(entry)] as const),
    );
    this.serialized = JSON.stringify({ version: 2, entries: this.entries });
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private write(entries: readonly StoredAutoNudgeThreadPolicy[]): void {
    let bounded = entries.slice(-MAX_POLICY_ENTRIES);
    let serialized = JSON.stringify({ version: 2, entries: bounded });
    while (serialized.length > MAX_POLICY_STORAGE_CHARACTERS && bounded.length > 0) {
      bounded = bounded.slice(1);
      serialized = JSON.stringify({ version: 2, entries: bounded });
    }
    this.entries = bounded;
    this.rebuildIndex();
    try {
      this.storage?.setItem(AUTO_NUDGE_THREAD_POLICY_STORAGE_KEY, serialized);
    } catch {
      // Keep the bounded in-memory policy. Automatic cross-window execution
      // remains unavailable without its separate Web Lock safety gate.
    }
    this.emit();
  }

  getPolicy(ref: BackgroundAutoNudgeThreadRef): AutoNudgeThreadPolicy {
    return this.byKey.get(entryKey(ref)) ?? DEFAULT_AUTO_NUDGE_THREAD_POLICY;
  }

  hasPolicy(ref: BackgroundAutoNudgeThreadRef): boolean {
    return this.byKey.has(entryKey(ref));
  }

  setPolicy(
    ref: BackgroundAutoNudgeThreadRef,
    patch: Partial<AutoNudgeThreadPolicy>,
    nowMs = Date.now(),
  ): AutoNudgeThreadPolicy {
    if (!safeId(ref.environmentId) || !safeId(ref.threadId)) {
      return DEFAULT_AUTO_NUDGE_THREAD_POLICY;
    }
    const current = this.getPolicy(ref);
    const candidate: AutoNudgeThreadPolicy = {
      mode: patch.mode ?? current.mode,
      backgroundContinuation: patch.backgroundContinuation ?? current.backgroundContinuation,
      maxRounds: patch.maxRounds ?? current.maxRounds,
    };
    const normalized: AutoNudgeThreadPolicy = {
      ...candidate,
      backgroundContinuation: candidate.mode === "off" ? false : candidate.backgroundContinuation,
    };
    if (!isValidAutoNudgeThreadPolicy(normalized)) return current;

    const key = entryKey(ref);
    const next = this.entries.filter((entry) => entryKey(entry) !== key);
    this.write([
      ...next,
      {
        ...ref,
        ...normalized,
        updatedAt: Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : Date.now(),
      },
    ]);
    return this.getPolicy(ref);
  }

  reloadFromStorage(): void {
    const entries = readEntries(this.storage);
    const serialized = JSON.stringify({ version: 2, entries });
    if (serialized === this.serialized) return;
    this.entries = entries;
    this.rebuildIndex();
    this.emit();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
}

let sharedStore: AutoNudgeThreadPolicyStore | null = null;
let removeStorageListener: (() => void) | null = null;

export function getAutoNudgeThreadPolicyStore(): AutoNudgeThreadPolicyStore {
  if (sharedStore) return sharedStore;
  sharedStore = new AutoNudgeThreadPolicyStore(resolveStorage());
  if (typeof window !== "undefined") {
    const onStorage = (event: StorageEvent) => {
      if (
        event.storageArea === window.localStorage &&
        event.key === AUTO_NUDGE_THREAD_POLICY_STORAGE_KEY
      ) {
        sharedStore?.reloadFromStorage();
      }
    };
    window.addEventListener("storage", onStorage);
    removeStorageListener = () => window.removeEventListener("storage", onStorage);
  }
  return sharedStore;
}

export function useAutoNudgeThreadPolicy(
  ref: BackgroundAutoNudgeThreadRef | null,
): AutoNudgeThreadPolicy {
  const store = getAutoNudgeThreadPolicyStore();
  const environmentId = ref?.environmentId ?? null;
  const threadId = ref?.threadId ?? null;
  const getSnapshot = useCallback(
    () =>
      environmentId && threadId
        ? store.getPolicy({ environmentId, threadId })
        : DEFAULT_AUTO_NUDGE_THREAD_POLICY,
    [environmentId, store, threadId],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

export function supportsAutoNudgeExecutionLock(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.locks?.request === "function";
}

export function __resetAutoNudgeThreadPolicyStoreForTests(options?: {
  readonly clearStorage?: boolean;
}): void {
  removeStorageListener?.();
  removeStorageListener = null;
  sharedStore = null;
  if (!options?.clearStorage) return;
  try {
    resolveStorage()?.removeItem(AUTO_NUDGE_THREAD_POLICY_STORAGE_KEY);
  } catch {
    // Best-effort test isolation.
  }
}
