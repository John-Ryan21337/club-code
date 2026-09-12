import type { EnvironmentId, ThreadId } from "@cafecode/contracts";
import type { UiLanguagePreference as BuiltInPromptLanguage } from "@cafecode/contracts/settings";
import { useSyncExternalStore } from "react";

export const IDLE_THREAD_GUARD_MIN_HOURS = 1;
export const IDLE_THREAD_GUARD_MAX_HOURS = 720;
export const IDLE_THREAD_GUARD_DEFAULT_HOURS = 2;
export const IDLE_THREAD_GUARD_PROMPT_MAX_CHARS = 240;
export const IDLE_THREAD_GUARD_DEFAULT_PROMPT =
  "Status update: are you still active, and is work still happening?";
export const IDLE_THREAD_GUARD_DEFAULT_PROMPT_JAPANESE =
  "状況を教えてください。まだアクティブで、作業は続いていますか？";
export const IDLE_THREAD_GUARD_DEFAULT_PROMPT_DUAL = `${IDLE_THREAD_GUARD_DEFAULT_PROMPT}\n\n${IDLE_THREAD_GUARD_DEFAULT_PROMPT_JAPANESE}`;

export const IDLE_THREAD_GUARD_BUILT_IN_PROMPTS: Readonly<
  Record<Exclude<BuiltInPromptLanguage, "system">, string>
> = {
  en: IDLE_THREAD_GUARD_DEFAULT_PROMPT,
  ja: IDLE_THREAD_GUARD_DEFAULT_PROMPT_JAPANESE,
  dual: IDLE_THREAD_GUARD_DEFAULT_PROMPT_DUAL,
};

export function idleThreadGuardDefaultPromptForLanguage(
  language: BuiltInPromptLanguage = "en",
): string {
  return IDLE_THREAD_GUARD_BUILT_IN_PROMPTS[language === "system" ? "en" : language];
}

const idleThreadGuardBuiltInPromptSet = new Set(Object.values(IDLE_THREAD_GUARD_BUILT_IN_PROMPTS));

/** Replaces only empty or built-in text; custom text is returned exactly. */
export function normalizeIdleThreadGuardBuiltInPrompt(
  prompt: string,
  language: BuiltInPromptLanguage = "en",
): string {
  const trimmed = prompt.trim();
  return trimmed.length === 0 || idleThreadGuardBuiltInPromptSet.has(trimmed)
    ? idleThreadGuardDefaultPromptForLanguage(language)
    : prompt;
}

/** Migrates a stored built-in between languages without touching operator text. */
export function migrateStoredIdleThreadGuardBuiltInPrompt(
  prompt: string,
  language: BuiltInPromptLanguage = "en",
): string {
  return idleThreadGuardBuiltInPromptSet.has(prompt.trim())
    ? idleThreadGuardDefaultPromptForLanguage(language)
    : prompt;
}

const STORAGE_KEY = "cafe-code:idle-thread-guard:v1";

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
  readonly awaitingAcknowledgement: boolean;
  readonly awaitingRequestId: string | null;
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
    awaitingAcknowledgement:
      candidate.awaitingAcknowledgement === true ||
      (candidate.awaitingAcknowledgement === undefined &&
        isIsoDateTime(candidate.awaitingActivityAfterDispatchAt)),
    awaitingRequestId:
      typeof candidate.awaitingRequestId === "string" &&
      candidate.awaitingRequestId.length > 0 &&
      candidate.awaitingRequestId.length <= 128
        ? candidate.awaitingRequestId
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
  window.addEventListener("storage", handleStorageChange);
}

function handleStorageChange(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY) return;
  state = readState();
  for (const listener of listeners) listener();
}

export function __resetIdleThreadGuardForTests(): void {
  if (typeof window !== "undefined") window.removeEventListener("storage", handleStorageChange);
  initialized = false;
  state = EMPTY_STATE;
  listeners.clear();
}

function publish(next: IdleThreadGuardState): void {
  const encoded = JSON.stringify(next);
  window.localStorage.setItem(STORAGE_KEY, encoded);
  if (window.localStorage.getItem(STORAGE_KEY) !== encoded)
    throw new Error("Guard state was not saved");
  state = next;
  for (const listener of listeners) listener();
}

export function isIdleThreadGuardSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.locks?.request === "function" &&
    typeof globalThis.crypto?.randomUUID === "function"
  );
}

async function withGuardStateLock<T>(
  operation: (current: IdleThreadGuardState) => T,
): Promise<T | null> {
  if (!isIdleThreadGuardSupported()) return null;
  try {
    // The callback is synchronous. Never hold this state lock across a provider request.
    return await navigator.locks.request(
      STORAGE_KEY,
      { signal: AbortSignal.timeout(3_000) },
      (lock) => (lock ? operation(readState()) : null),
    );
  } catch {
    return null;
  }
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

function saveConfig(current: IdleThreadGuardState, config: IdleThreadGuardConfig): void {
  publish({ configs: { ...current.configs, [idleThreadGuardScopeKey(config)]: config } });
}

export async function configureIdleThreadGuard(
  scope: IdleThreadGuardScope,
  input: {
    readonly enabled: boolean;
    readonly idleHours: number;
    readonly prompt: string;
  },
): Promise<boolean> {
  return (
    (await withGuardStateLock((current) => {
      const normalized = normalizeConfig({
        ...scope,
        enabled: input.enabled,
        idleHours: normalizeHours(input.idleHours),
        prompt: input.prompt,
        armedAt: new Date().toISOString(),
        awaitingActivityAfterDispatchAt: null,
        awaitingAcknowledgement: false,
        awaitingRequestId: null,
        lastError: null,
      });
      if (!normalized) return false;
      saveConfig(current, normalized);
      return true;
    })) ?? false
  );
}

export async function claimIdleThreadGuardRequest(
  scope: IdleThreadGuardScope,
  readLatestActivity: (config: IdleThreadGuardConfig) => string | null,
): Promise<{
  readonly config: IdleThreadGuardConfig;
  readonly dispatchedAt: string;
  readonly requestId: string;
} | null> {
  return withGuardStateLock((current) => {
    const config = current.configs[idleThreadGuardScopeKey(scope)];
    if (!config?.enabled || config.awaitingAcknowledgement) return null;
    const activity = readLatestActivity(config);
    if (!activity) return null;
    if (config.awaitingActivityAfterDispatchAt !== null) {
      if (Date.parse(activity) > Date.parse(config.awaitingActivityAfterDispatchAt)) {
        saveConfig(current, {
          ...config,
          awaitingActivityAfterDispatchAt: null,
          awaitingRequestId: null,
          armedAt: activity,
          lastError: null,
        });
      }
      return null;
    }
    if (
      !isIdleThreadGuardDue({
        nowMs: Date.now(),
        latestActivityAt: activity,
        armedAt: config.armedAt,
        idleHours: config.idleHours,
      })
    )
      return null;
    const dispatchedAt = new Date().toISOString();
    const requestId = crypto.randomUUID();
    const claimed = {
      ...config,
      awaitingActivityAfterDispatchAt: dispatchedAt,
      awaitingAcknowledgement: true,
      awaitingRequestId: requestId,
      lastError: null,
    };
    saveConfig(current, claimed);
    return { config: claimed, dispatchedAt, requestId };
  });
}

/** Start only a still-current claim; release the state lock before awaiting the provider. */
export async function beginIdleThreadGuardRequest(
  scope: IdleThreadGuardScope,
  requestId: string,
  isEligible: (config: IdleThreadGuardConfig) => boolean,
  dispatch: (config: IdleThreadGuardConfig) => Promise<unknown>,
): Promise<{ readonly completion: Promise<unknown> } | null> {
  return withGuardStateLock((current) => {
    const config = current.configs[idleThreadGuardScopeKey(scope)];
    if (
      !config?.enabled ||
      !config.awaitingAcknowledgement ||
      config.awaitingRequestId !== requestId
    )
      return null;
    if (!isEligible(config)) {
      // Nothing reached the provider. Cancel this reservation and require a
      // fresh idle interval instead of showing an acknowledgement that cannot arrive.
      saveConfig(current, {
        ...config,
        awaitingAcknowledgement: false,
        awaitingActivityAfterDispatchAt: null,
        awaitingRequestId: null,
        armedAt: new Date().toISOString(),
        lastError: null,
      });
      return null;
    }
    // Keep the promise inside an object so Web Locks does not hold the lock
    // while the remote command waits for acknowledgement.
    let completion: Promise<unknown>;
    try {
      completion = dispatch(config);
    } catch (error) {
      completion = Promise.reject(error);
    }
    // The caller receives this promise after the lock request resolves.
    // Attach a handler now so an immediate rejection is never unhandled.
    void completion.catch(() => {});
    return { completion };
  });
}

export async function settleIdleThreadGuardRequest(
  scope: IdleThreadGuardScope,
  requestId: string,
  dispatchAttemptAt: string,
  acknowledgedAt: string | null,
): Promise<void> {
  await withGuardStateLock((current) => {
    const config = current.configs[idleThreadGuardScopeKey(scope)];
    if (
      !config ||
      config.awaitingRequestId !== requestId ||
      config.awaitingActivityAfterDispatchAt !== dispatchAttemptAt
    )
      return;
    saveConfig(current, {
      ...config,
      awaitingAcknowledgement: acknowledgedAt === null,
      awaitingActivityAfterDispatchAt:
        acknowledgedAt === null
          ? dispatchAttemptAt
          : (idleThreadGuardAcknowledgedBarrier({
              currentAwaitingActivityAfterDispatchAt: config.awaitingActivityAfterDispatchAt,
              dispatchAttemptAt,
              acknowledgedAt,
            }) ?? dispatchAttemptAt),
      lastError:
        acknowledgedAt === null
          ? "The status request was not acknowledged. Resave the Guard settings to try again."
          : null,
    });
  });
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
