import type { EnvironmentId, ThreadId } from "@cafecode/contracts";
import { useSyncExternalStore } from "react";

export const IDLE_THREAD_GUARD_MIN_HOURS = 1;
export const IDLE_THREAD_GUARD_MAX_HOURS = 720;
export const IDLE_THREAD_GUARD_DEFAULT_HOURS = 2;
export const IDLE_THREAD_GUARD_PROMPT_MAX_CHARS = 240;
export const IDLE_THREAD_GUARD_DEFAULT_PROMPT =
  "Status update: are you still active, and is work still happening?";

const STORAGE_KEY = "club-code:idle-thread-guard:v1";

export interface IdleThreadGuardScope {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

export interface IdleThreadGuardConfig extends IdleThreadGuardScope {
  readonly enabled: boolean;
  readonly idleHours: number;
  readonly prompt: string;
  readonly armedAt: string;
  readonly awaitingActivityAfterDispatchAt: string | null;
  readonly lastError: string | null;
}

interface IdleThreadGuardState {
  readonly configs: Readonly<Record<string, IdleThreadGuardConfig>>;
}

const EMPTY_STATE: IdleThreadGuardState = { configs: {} };
let state = EMPTY_STATE;
let initialized = false;
const listeners = new Set<() => void>();

export function idleThreadGuardScopeKey(scope: IdleThreadGuardScope): string {
  return JSON.stringify([scope.environmentId, scope.threadId]);
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function normalizeHours(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return IDLE_THREAD_GUARD_DEFAULT_HOURS;
  }
  return Math.min(
    IDLE_THREAD_GUARD_MAX_HOURS,
    Math.max(IDLE_THREAD_GUARD_MIN_HOURS, Math.round(value)),
  );
}

function normalizeConfig(value: unknown): IdleThreadGuardConfig | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<IdleThreadGuardConfig>;
  if (typeof candidate.environmentId !== "string" || typeof candidate.threadId !== "string") {
    return null;
  }
  const prompt =
    typeof candidate.prompt === "string" &&
    candidate.prompt.trim().length > 0 &&
    candidate.prompt.length <= IDLE_THREAD_GUARD_PROMPT_MAX_CHARS
      ? candidate.prompt
      : IDLE_THREAD_GUARD_DEFAULT_PROMPT;
  return {
    environmentId: candidate.environmentId as EnvironmentId,
    threadId: candidate.threadId as ThreadId,
    enabled: candidate.enabled === true,
    idleHours: normalizeHours(candidate.idleHours),
    prompt,
    armedAt: isIsoDateTime(candidate.armedAt) ? candidate.armedAt : new Date().toISOString(),
    awaitingActivityAfterDispatchAt: isIsoDateTime(candidate.awaitingActivityAfterDispatchAt)
      ? candidate.awaitingActivityAfterDispatchAt
      : null,
    lastError: typeof candidate.lastError === "string" ? candidate.lastError : null,
  };
}

function readState(): IdleThreadGuardState {
  if (typeof window === "undefined") return EMPTY_STATE;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as {
      configs?: unknown;
    };
    if (!parsed.configs || typeof parsed.configs !== "object") return EMPTY_STATE;
    const configs: Record<string, IdleThreadGuardConfig> = {};
    for (const value of Object.values(parsed.configs)) {
      const config = normalizeConfig(value);
      if (config) configs[idleThreadGuardScopeKey(config)] = config;
    }
    return { configs };
  } catch {
    return EMPTY_STATE;
  }
}

function ensureInitialized(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  state = readState();
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    state = readState();
    for (const listener of listeners) listener();
  });
}

function publish(next: IdleThreadGuardState): void {
  state = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  for (const listener of listeners) listener();
}

export function readIdleThreadGuardState(): IdleThreadGuardState {
  ensureInitialized();
  return state;
}

export function subscribeIdleThreadGuard(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIdleThreadGuardState(): IdleThreadGuardState {
  return useSyncExternalStore(
    subscribeIdleThreadGuard,
    readIdleThreadGuardState,
    () => EMPTY_STATE,
  );
}

export function readIdleThreadGuardConfig(
  scope: IdleThreadGuardScope,
): IdleThreadGuardConfig | null {
  return readIdleThreadGuardState().configs[idleThreadGuardScopeKey(scope)] ?? null;
}

export function saveIdleThreadGuardConfig(config: IdleThreadGuardConfig): void {
  const normalized = normalizeConfig(config);
  if (!normalized) return;
  const key = idleThreadGuardScopeKey(normalized);
  publish({
    configs: {
      ...readIdleThreadGuardState().configs,
      [key]: normalized,
    },
  });
}

export function configureIdleThreadGuard(
  scope: IdleThreadGuardScope,
  input: {
    readonly enabled: boolean;
    readonly idleHours: number;
    readonly prompt: string;
  },
): void {
  const now = new Date().toISOString();
  saveIdleThreadGuardConfig({
    ...scope,
    enabled: input.enabled,
    idleHours: normalizeHours(input.idleHours),
    prompt: input.prompt,
    armedAt: now,
    awaitingActivityAfterDispatchAt: null,
    lastError: null,
  });
}

export function patchIdleThreadGuardConfig(
  scope: IdleThreadGuardScope,
  patch: Partial<
    Pick<
      IdleThreadGuardConfig,
      "awaitingActivityAfterDispatchAt" | "lastError" | "armedAt" | "enabled"
    >
  >,
): void {
  const current = readIdleThreadGuardConfig(scope);
  if (!current) return;
  saveIdleThreadGuardConfig({ ...current, ...patch });
}

export function latestIdleActivityAt(
  values: ReadonlyArray<string | null | undefined>,
): string | null {
  let latestMs = Number.NEGATIVE_INFINITY;
  let latest: string | null = null;
  for (const value of values) {
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp) && timestamp > latestMs) {
      latestMs = timestamp;
      latest = value;
    }
  }
  return latest;
}

export function isIdleThreadGuardDue(input: {
  readonly nowMs: number;
  readonly latestActivityAt: string;
  readonly armedAt: string;
  readonly idleHours: number;
}): boolean {
  const latestActivityMs = Date.parse(input.latestActivityAt);
  const armedAtMs = Date.parse(input.armedAt);
  if (!Number.isFinite(latestActivityMs) || !Number.isFinite(armedAtMs)) return false;
  const safeHours = Math.min(
    IDLE_THREAD_GUARD_MAX_HOURS,
    Math.max(IDLE_THREAD_GUARD_MIN_HOURS, input.idleHours),
  );
  return input.nowMs - Math.max(latestActivityMs, armedAtMs) >= safeHours * 60 * 60 * 1_000;
}

/**
 * Advances the one-shot barrier only for the dispatch attempt that is still
 * current. The acknowledgement timestamp is intentionally recorded after the
 * command promise resolves: the Guard's own user-message/steer projection is
 * part of that command and must not look like fresh provider activity that
 * immediately re-arms another paid status request.
 */
export function idleThreadGuardAcknowledgedBarrier(input: {
  readonly currentAwaitingActivityAfterDispatchAt: string | null;
  readonly dispatchAttemptAt: string;
  readonly acknowledgedAt: string;
}): string | null {
  if (
    input.currentAwaitingActivityAfterDispatchAt !== input.dispatchAttemptAt ||
    !isIsoDateTime(input.dispatchAttemptAt) ||
    !isIsoDateTime(input.acknowledgedAt)
  ) {
    return null;
  }
  return Date.parse(input.acknowledgedAt) >= Date.parse(input.dispatchAttemptAt)
    ? input.acknowledgedAt
    : input.dispatchAttemptAt;
}
