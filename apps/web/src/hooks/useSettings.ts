/**
 * Unified settings hook.
 *
 * Abstracts the split between server-authoritative settings (persisted in
 * `settings.json` on the server, fetched via `server.getConfig`) and
 * client-only settings (persisted in localStorage).
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
  if (
    Equal.equals(currentServerConfig.clientSettings, DEFAULT_CLIENT_SETTINGS) &&
    !Equal.equals(localSettings, DEFAULT_CLIENT_SETTINGS)
  ) {
    applyClientSettingsUpdated(localSettings);
    await ensureLocalApi().server.updateClientSettings(localSettings);
  }
}

function reportSettingsWriteFailure(scope: "server" | "client" | "unified", error: unknown): void {
  console.error(`${CLIENT_SETTINGS_PERSISTENCE_ERROR_SCOPE} ${scope} update failed`, error);
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
  const writes: Promise<unknown>[] = [];
  const revision = ++settingsMutationRevision;

  if (Object.keys(serverPatch).length > 0) {
    const currentServerConfig = getServerConfig();
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

  if (Object.keys(clientPatch).length > 0) {
    const currentServerConfig = getServerConfig();
    if (currentServerConfig) {
      const previousClientSettings = currentServerConfig.clientSettings;
      const optimisticClientSettings = applyClientSettingsPatch(
        previousClientSettings,
        clientPatch,
      );
      markPatchRevision(clientPatch, clientFieldRevisions, revision);
      applyClientSettingsUpdated(optimisticClientSettings);
      writes.push(
        ensureLocalApi()
          .server.updateClientSettings(clientPatch)
          .catch((error) => {
            const latestClientSettings = getServerConfig()?.clientSettings;
            if (latestClientSettings) {
              applyClientSettingsUpdated(
                rollbackOptimisticPatch(
                  latestClientSettings,
                  previousClientSettings,
                  optimisticClientSettings,
                  clientPatch,
                  clientFieldRevisions,
                  revision,
                ),
              );
            }
            throw error;
          }),
      );
    } else {
      const previousClientSettings = getClientSettingsSnapshot();
      const optimisticClientSettings = applyClientSettingsPatch(
        previousClientSettings,
        clientPatch,
      );
      markPatchRevision(clientPatch, clientFieldRevisions, revision);
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
                clientPatch,
                clientFieldRevisions,
                revision,
              ),
            );
            throw error;
          }),
      );
    }
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
  return getServerConfig()?.clientSettings ?? getClientSettingsSnapshot();
}

export function useClientSettingsHydrated(): boolean {
  const serverConfig = useServerConfig();
  const localHydrated = useSyncExternalStore(
    subscribeClientSettingsHydration,
    getClientSettingsHydratedSnapshot,
    () => false,
  );
  return serverConfig !== null || localHydrated;
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
      ...(serverConfig?.clientSettings ?? localClientSettings),
    }),
    [localClientSettings, serverConfig?.clientSettings, serverSettings],
  );

  return useMemo(() => (selector ? selector(merged) : (merged as T)), [merged, selector]);
}

/**
 * Returns an updater that routes each key to the correct backing store.
 *
 * Server keys are optimistically patched in atom-backed server state, then
 * persisted via RPC. Client keys go through client persistence.
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

  const resetSettings = useCallback(() => {
    updateSettings(DEFAULT_UNIFIED_SETTINGS);
  }, [updateSettings]);

  return {
    updateSettings,
    updateSettingsAsync,
    resetSettings,
  };
}

export function __resetClientSettingsPersistenceForTests(): void {
  clientSettingsImportAttempted = false;
  settingsMutationRevision = 0;
  serverFieldRevisions.clear();
  clientFieldRevisions.clear();
  resetClientSettingsPersistenceStateForTests();
}
