import * as Schema from "effect/Schema";

import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "./hooks/useLocalStorage";

/**
 * Renderer-local consent for the optional world clock weather request.
 *
 * Cafe's ordinary appearance preferences are backend-authoritative client
 * settings: `useUpdateSettings` forwards them to `server.updateClientSettings`,
 * and the backend then pushes them to every renderer attached to that
 * environment. That is correct for cosmetic state, and wrong for this flag.
 *
 * Enabling weather causes an outbound request from the device that is running
 * the renderer, which discloses that device's network address and the selected
 * city coordinates to a third party. Consent for that belongs to the person at
 * that device. Storing it as a client setting would let one browser tab turn on
 * third-party requests from a desktop app, a LAN phone, and every other
 * connected client at once.
 *
 * It is therefore deliberately NOT part of `ClientSettings`. It lives in this
 * renderer's local storage only, so it cannot travel through the settings RPC,
 * the persisted server settings file, or a future settings profile/export that
 * iterates the contract schema. The absence from the schema is the enforcement:
 * there is no field for a sync path to copy.
 */
export const WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY = "cafe-code:world-clock-weather-consent:v1";
export const DEFAULT_WORLD_CLOCK_WEATHER_ENABLED = false;

const WorldClockWeatherConsentSchema = Schema.Boolean;

type ConsentListener = () => void;

const listeners = new Set<ConsentListener>();

// Cached so `useSyncExternalStore` receives a stable snapshot between writes.
// Reading local storage on every render would be a per-render synchronous
// storage hit, and an unstable snapshot would loop the store.
let cachedConsent: boolean | null = null;

function readStoredConsent(): boolean {
  try {
    return (
      getLocalStorageItem(
        WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY,
        WorldClockWeatherConsentSchema,
      ) ?? DEFAULT_WORLD_CLOCK_WEATHER_ENABLED
    );
  } catch {
    // A corrupted value must fail closed: no consent means no outbound request.
    return DEFAULT_WORLD_CLOCK_WEATHER_ENABLED;
  }
}

export function getWorldClockWeatherConsent(): boolean {
  cachedConsent ??= readStoredConsent();
  return cachedConsent;
}

export function getServerWorldClockWeatherConsent(): boolean {
  // Server-side rendering and non-browser test environments have no consent.
  return DEFAULT_WORLD_CLOCK_WEATHER_ENABLED;
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY) return;
  cachedConsent = readStoredConsent();
  for (const registered of listeners) registered();
}

export function subscribeWorldClockWeatherConsent(listener: ConsentListener): () => void {
  listeners.add(listener);
  // Another tab of the browser UI may change its own consent. `storage` only
  // fires in the other documents, which is exactly the propagation we want:
  // each renderer keeps its own value, and same-origin tabs of one browser
  // share one local storage area.
  if (typeof window !== "undefined" && listeners.size === 1) {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined" && listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
    }
  };
}

/**
 * Persist the consent, then publish it.
 *
 * The order matters. The widget starts requesting weather as soon as the value
 * it observes turns on, so publishing before the write would let a renderer
 * make third-party requests that the user could not turn back off after a
 * reload. A failed write rejects and leaves the previous value in place, and
 * the settings UI reports that the change was not saved.
 */
export async function writeWorldClockWeatherConsent(enabled: boolean): Promise<void> {
  const previous = getWorldClockWeatherConsent();
  if (enabled === previous) return;
  if (enabled) {
    setLocalStorageItem(
      WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY,
      enabled,
      WorldClockWeatherConsentSchema,
    );
  } else {
    // Withdrawn consent removes the record instead of storing `false`, so the
    // default (off) is what a later read finds.
    removeLocalStorageItem(WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY);
  }
  const stored = readStoredConsent();
  if (stored !== enabled) {
    throw new Error("World clock weather consent could not be saved");
  }
  cachedConsent = stored;
  for (const listener of listeners) listener();
}

export function __resetWorldClockWeatherConsentForTests(): void {
  cachedConsent = null;
  try {
    removeLocalStorageItem(WORLD_CLOCK_WEATHER_CONSENT_STORAGE_KEY);
  } catch {
    // Test teardown must not fail because storage is unavailable.
  }
  for (const listener of listeners) listener();
}
