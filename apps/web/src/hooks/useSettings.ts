/**
 * Unified settings hook.
 *
 * Abstracts the split between server settings, environment-shared client
 * settings, and renderer-local client persistence. Mobile presentation and
 * third-party weather consent are intentionally renderer-local so one client
 * cannot change another client's layout or initiate requests from its IP.
 *
 * Consumers use `useSettings(selector)` to read, and `useUpdateSettings()` to
 * write. The hook transparently routes reads/writes to the correct backing
 * store.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { ServerSettings, type ServerSettingsPatch } from "@cafecode/contracts";
import {
  type ClientSettingsPatch,
  type ClientSettings,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  UnifiedSettings,
} from "@cafecode/contracts/settings";
import { ensureLocalApi } from "~/localApi";
import * as Struct from "effect/Struct";
import * as Equal from "effect/Equal";
import { applyClientSettingsPatch } from "@cafecode/shared/clientSettings";
import { toastManager } from "../components/ui/toast";
import { applyServerSettingsPatch } from "@cafecode/shared/serverSettings";
import {
  applyClientSettingsUpdated,
  applySettingsUpdated,
  getServerConfig,
  useServerConfig,
  useServerSettings,
} from "~/rpc/serverState";
import {
  __resetClientSettingsPersistenceForTests as resetClientSettingsPersistenceStateForTests,
  clearClientSettingsHydrationPromise,
  getClientSettingsHydratedSnapshot,
  getClientSettingsSnapshot,
  readClientSettingsHydrationPromise,
  replaceClientSettingsSnapshot,
  setClientSettingsHydrated,
  subscribeClientSettingsHydrationSnapshot,
  subscribeClientSettingsSnapshot,
  writeClientSettingsHydrationPromise,
} from "./clientSettingsState";
import {
  __resetConfirmedSettingsWriteQueueForTests,
  enqueueConfirmedSettingsWrite,
} from "../confirmedSettingsWriteQueue";
import {
  partitionRendererLocalClientSettingsPatch,
  withoutRendererLocalClientSettings,
  withRendererLocalClientSettings,
} from "../rendererLocalClientSettings";

const CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE = "[CLIENT_SETTINGS]";
let clientSettingsImportAttempted = false;
let settingsMutationRevision = 0;
const serverFieldRevisions = new Map<string, number>();
const clientFieldRevisions = new Map<string, number>();

function subscribeClientSettings(listener: () => void): () => void {
  const unsubscribe = subscribeClientSettingsSnapshot(listener);
  void hydrateClientSettings();
  return unsubscribe;
}

function subscribeClientSettingsHydration(listener: () => void): () => void {
  const unsubscribe = subscribeClientSettingsHydrationSnapshot(listener);
  void hydrateClientSettings();
  return unsubscribe;
}

async function hydrateClientSettings(): Promise<void> {
  if (getClientSettingsHydratedSnapshot()) {
    return;
  }
  const existingHydrationPromise = readClientSettingsHydrationPromise();
  if (existingHydrationPromise) {
    return existingHydrationPromise;
  }

  const nextHydration = (async () => {
    try {
      const persistedSettings = await ensureLocalApi().persistence.getClientSettings();
      if (persistedSettings) {
        replaceClientSettingsSnapshot({ ...DEFAULT_CLIENT_SETTINGS, ...persistedSettings });
      }
    } catch (error) {
      console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} hydrate failed`, error);
    } finally {
      setClientSettingsHydrated(true);
    }
  })();

  const hydrationPromise = nextHydration.finally(() => {
    clearClientSettingsHydrationPromise(hydrationPromise);
  });
  writeClientSettingsHydrationPromise(hydrationPromise);

  return hydrationPromise;
}

async function maybeImportLocalClientSettingsToServer(): Promise<void> {
  if (clientSettingsImportAttempted) {
    return;
  }
  const currentServerConfig = getServerConfig();
  if (!currentServerConfig) {
    return;
  }
  clientSettingsImportAttempted = true;

  await hydrateClientSettings();
  const localSettings = getClientSettingsSnapshot();
  const sharedServerSettings = withoutRendererLocalClientSettings(
    currentServerConfig.clientSettings,
  );
  const sharedLocalSettings = withoutRendererLocalClientSettings(localSettings);
  const sharedDefaultSettings = withoutRendererLocalClientSettings(DEFAULT_CLIENT_SETTINGS);
  if (
    Equal.equals(sharedServerSettings, sharedDefaultSettings) &&
    !Equal.equals(sharedLocalSettings, sharedDefaultSettings)
  ) {
    applyClientSettingsUpdated(
      applyClientSettingsPatch(currentServerConfig.clientSettings, sharedLocalSettings),
    );
    await ensureLocalApi().server.updateClientSettings(sharedLocalSettings);
  }
}

function reportSettingsWriteFailure(scope: "server" | "client" | "unified", error: unknown): void {
  console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} ${scope} update failed`, error);
  // A rejected write rolls the optimistic value back, so the control silently
  // returns to its previous position. Reporting only to the console made that
  // read as a dead toggle: the setting appeared to do nothing, with no error
  // anywhere an operator or a log reader could see it. Surface it.
  toastManager.add({
    title: "Setting was not saved",
    description:
      error instanceof Error
        ? error.message
        : `The ${scope} settings write failed and the previous value was restored.`,
    type: "error",
  });
}

// ── Key sets for routing patches ─────────────────────────────────────

const SERVER_SETTINGS_KEYS = new Set<string>(Struct.keys(ServerSettings.fields));

function splitPatch(patch: Partial<UnifiedSettings>): {
  serverPatch: ServerSettingsPatch;
  clientPatch: ClientSettingsPatch;
} {
  const serverPatch: Record<string, unknown> = {};
  const clientPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SERVER_SETTINGS_KEYS.has(key)) {
      serverPatch[key] = value;
    } else {
      clientPatch[key] = value;
    }
  }
  return {
    serverPatch: serverPatch as ServerSettingsPatch,
    clientPatch: clientPatch as ClientSettingsPatch,
  };
}

function markPatchRevision(patch: object, revisions: Map<string, number>, revision: number): void {
  for (const key of Object.keys(patch)) {
    revisions.set(key, revision);
  }
}

function rollbackOptimisticPatch<T extends object>(
  current: T,
  previous: T,
  optimistic: T,
  patch: object,
  revisions: Map<string, number>,
  revision: number,
): T {
  const currentRecord = current as Record<string, unknown>;
  const previousRecord = previous as Record<string, unknown>;
  const optimisticRecord = optimistic as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;

  for (const key of Object.keys(patch)) {
    if (
      revisions.get(key) === revision &&
      Equal.equals(currentRecord[key], optimisticRecord[key])
    ) {
      next ??= { ...currentRecord };
      next[key] = previousRecord[key];
    }
  }

  return (next ?? current) as T;
}

async function applyUnifiedSettingsPatch(patch: Partial<UnifiedSettings>): Promise<void> {
  const { serverPatch, clientPatch } = splitPatch(patch);
  const { localPatch, sharedPatch } = partitionRendererLocalClientSettingsPatch(clientPatch);
  if (Object.keys(localPatch).length > 0) {
    // Never calculate a renderer-local write from the default snapshot while
    // its persisted document is still being read.
    await hydrateClientSettings();
  }

  const writes: Promise<unknown>[] = [];
  const revision = ++settingsMutationRevision;
  const currentServerConfig = getServerConfig();
  const sharedClientPatch = currentServerConfig ? sharedPatch : {};
  const localClientPatch = currentServerConfig ? localPatch : clientPatch;

  if (Object.keys(serverPatch).length > 0) {
    if (currentServerConfig) {
      const previousSettings = currentServerConfig.settings;
      const optimisticSettings = applyServerSettingsPatch(previousSettings, serverPatch);
      markPatchRevision(serverPatch, serverFieldRevisions, revision);
      applySettingsUpdated(optimisticSettings);
      writes.push(
        ensureLocalApi()
          .server.updateSettings(serverPatch)
          .catch((error) => {
            const latestSettings = getServerConfig()?.settings;
            if (latestSettings) {
              applySettingsUpdated(
                rollbackOptimisticPatch(
                  latestSettings,
                  previousSettings,
                  optimisticSettings,
                  serverPatch,
                  serverFieldRevisions,
                  revision,
                ),
              );
            }
            throw error;
          }),
      );
    } else {
      writes.push(ensureLocalApi().server.updateSettings(serverPatch));
    }
  }

  if (Object.keys(sharedClientPatch).length > 0 && currentServerConfig) {
    const previousClientSettings = currentServerConfig.clientSettings;
    const optimisticClientSettings = applyClientSettingsPatch(
      previousClientSettings,
      sharedClientPatch,
    );
    markPatchRevision(sharedClientPatch, clientFieldRevisions, revision);
    applyClientSettingsUpdated(optimisticClientSettings);
    writes.push(
      ensureLocalApi()
        .server.updateClientSettings(sharedClientPatch)
        .catch((error) => {
          const latestClientSettings = getServerConfig()?.clientSettings;
          if (latestClientSettings) {
            applyClientSettingsUpdated(
              rollbackOptimisticPatch(
                latestClientSettings,
                previousClientSettings,
                optimisticClientSettings,
                sharedClientPatch,
                clientFieldRevisions,
                revision,
              ),
            );
          }
          throw error;
        }),
    );
  }

  if (Object.keys(localClientPatch).length > 0) {
    const previousClientSettings = getClientSettingsSnapshot();
    const optimisticClientSettings = applyClientSettingsPatch(
      previousClientSettings,
      localClientPatch,
    );
    markPatchRevision(localClientPatch, clientFieldRevisions, revision);
    replaceClientSettingsSnapshot(optimisticClientSettings);
    writes.push(
      ensureLocalApi()
        .persistence.setClientSettings(optimisticClientSettings)
        .catch((error) => {
          replaceClientSettingsSnapshot(
            rollbackOptimisticPatch(
              getClientSettingsSnapshot(),
              previousClientSettings,
              optimisticClientSettings,
              localClientPatch,
              clientFieldRevisions,
              revision,
            ),
          );
          throw error;
        }),
    );
  }

  await Promise.all(writes);
}

// ── Hooks ────────────────────────────────────────────────────────────

/**
 * Read merged settings. Selector narrows the subscription so components
 * only re-render when the slice they care about changes.
 */

/**
 * Non-hook accessor for the current merged client settings snapshot.
 * Used by non-React code paths (e.g. runtime services) that need the latest
 * settings without subscribing.
 */
export function getClientSettings(): ClientSettings {
  const localSettings = getClientSettingsSnapshot();
  return withRendererLocalClientSettings(
    getServerConfig()?.clientSettings ?? localSettings,
    localSettings,
  );
}

export function useClientSettingsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeClientSettingsHydration,
    getClientSettingsHydratedSnapshot,
    () => false,
  );
}

function useLocalClientSettings(): ClientSettings {
  return useSyncExternalStore(
    subscribeClientSettings,
    getClientSettingsSnapshot,
    () => DEFAULT_CLIENT_SETTINGS,
  );
}

export function useSettings<T = UnifiedSettings>(selector?: (s: UnifiedSettings) => T): T {
  const serverConfig = useServerConfig();
  const serverSettings = useServerSettings();
  const localClientSettings = useLocalClientSettings();

  useEffect(() => {
    if (serverConfig === null) {
      return;
    }
    void maybeImportLocalClientSettingsToServer().catch((error) => {
      console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} import failed`, error);
    });
  }, [serverConfig]);

  const merged = useMemo<UnifiedSettings>(
    () => ({
      ...serverSettings,
      ...withRendererLocalClientSettings(
        serverConfig?.clientSettings ?? localClientSettings,
        localClientSettings,
      ),
    }),
    [localClientSettings, serverConfig?.clientSettings, serverSettings],
  );

  return useMemo(() => (selector ? selector(merged) : (merged as T)), [merged, selector]);
}

/**
 * Returns an updater that routes each key to the correct backing store.
 *
 * Server keys are optimistically patched in atom-backed server state, then
 * persisted via RPC. Shared client keys use the connected environment server;
 * renderer-local presentation and third-party consent fields always use this
 * renderer's local persistence.
 */
export function useUpdateSettings() {
  const updateSettings = useCallback((patch: Partial<UnifiedSettings>) => {
    void applyUnifiedSettingsPatch(patch).catch((error) => {
      reportSettingsWriteFailure("unified", error);
    });
  }, []);

  const updateSettingsAsync = useCallback(
    (patch: Partial<UnifiedSettings>) => applyUnifiedSettingsPatch(patch),
    [],
  );

  /**
   * Persists client settings before publishing them to subscribers.
   *
   * Safety-sensitive features use this path when changing the setting and
   * starting side effects must be one transaction from the operator's point
   * of view. Unlike `updateSettings`, a rejected write is observable and does
   * not leave an optimistic setting armed in memory.
   */
  const updateClientSettingsConfirmed = useCallback((patch: ClientSettingsPatch) => {
    // Safety-sensitive toggles may be changed again while their previous RPC
    // is still in flight. Preserve invocation order and calculate each write
    // from the latest committed snapshot so the operator's last action wins.
    return enqueueConfirmedSettingsWrite(async () => {
      const { localPatch, sharedPatch } = partitionRendererLocalClientSettingsPatch(patch);
      if (Object.keys(localPatch).length > 0) {
        await hydrateClientSettings();
      }
      const currentServerConfig = getServerConfig();
      const sharedPatchKeys = Object.keys(sharedPatch) as Array<keyof ClientSettings>;
      const previousSharedPatch = Object.fromEntries(
        sharedPatchKeys.map((key) => [key, currentServerConfig?.clientSettings[key]]),
      ) as ClientSettingsPatch;
      let sharedWriteCommitted = false;
      try {
        if (currentServerConfig) {
          if (Object.keys(sharedPatch).length > 0) {
            await ensureLocalApi().server.updateClientSettings(sharedPatch);
            sharedWriteCommitted = true;
          }
          if (Object.keys(localPatch).length > 0) {
            const nextLocal = applyClientSettingsPatch(getClientSettingsSnapshot(), localPatch);
            await ensureLocalApi().persistence.setClientSettings(nextLocal);
            replaceClientSettingsSnapshot(nextLocal);
          }
          if (Object.keys(sharedPatch).length > 0) {
            const latest = getServerConfig()?.clientSettings ?? currentServerConfig.clientSettings;
            applyClientSettingsUpdated(applyClientSettingsPatch(latest, sharedPatch));
          }
          return;
        }

        const next = applyClientSettingsPatch(getClientSettingsSnapshot(), patch);
        await ensureLocalApi().persistence.setClientSettings(next);
        replaceClientSettingsSnapshot(next);
      } catch (error) {
        let rollbackError: unknown = null;
        if (currentServerConfig && sharedWriteCommitted) {
          try {
            await ensureLocalApi().server.updateClientSettings(previousSharedPatch);
            const latest = getServerConfig()?.clientSettings ?? currentServerConfig.clientSettings;
            applyClientSettingsUpdated(applyClientSettingsPatch(latest, previousSharedPatch));
          } catch (cause) {
            rollbackError = cause;
          }
        }
        reportSettingsWriteFailure("client", error);
        if (rollbackError !== null) {
          reportSettingsWriteFailure("client", rollbackError);
          const writeMessage =
            error instanceof Error ? error.message : "The client settings write failed.";
          const rollbackMessage =
            rollbackError instanceof Error
              ? rollbackError.message
              : "The prior shared settings could not be restored.";
          throw new Error(
            `${writeMessage} The prior shared settings could not be restored: ${rollbackMessage}`,
            { cause: error },
          );
        }
        throw error;
      }
    });
  }, []);

  const resetSettings = useCallback(() => {
    updateSettings(DEFAULT_UNIFIED_SETTINGS);
  }, [updateSettings]);

  return {
    updateSettings,
    updateSettingsAsync,
    updateClientSettingsConfirmed,
    resetSettings,
  };
}

export function __resetClientSettingsPersistenceForTests(): void {
  clientSettingsImportAttempted = false;
  settingsMutationRevision = 0;
  serverFieldRevisions.clear();
  clientFieldRevisions.clear();
  __resetConfirmedSettingsWriteQueueForTests();
  resetClientSettingsPersistenceStateForTests();
}
