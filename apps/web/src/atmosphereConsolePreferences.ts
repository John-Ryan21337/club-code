/**
 * Device-local Atmosphere Console preference.
 *
 * Kept in its own module so the Appearance settings panel can open the console
 * without importing the console component, and therefore without pulling the
 * local API client into the settings import graph.
 */
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";

export const ATMOSPHERE_CONSOLE_STORAGE_KEY = "cafe-code:atmosphere-console:v1";

const GeometrySchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type AtmosphereConsoleGeometry = typeof GeometrySchema.Type;

/**
 * Device-local console preference. Panel placement and open state are a
 * property of this screen, so they stay out of the synced settings schemas.
 */
const PreferencesSchema = Schema.Struct({
  open: Schema.Boolean,
  minimized: Schema.Boolean,
  /** `null` means "wherever the default lands in this viewport". */
  geometry: Schema.NullOr(GeometrySchema),
});
export type AtmosphereConsolePreferences = typeof PreferencesSchema.Type;

export const DEFAULT_ATMOSPHERE_CONSOLE_PREFERENCES: AtmosphereConsolePreferences = {
  open: false,
  minimized: false,
  geometry: null,
};

const MAX_PREFERENCES_CHARACTERS = 4_096;
const decodePreferences = Schema.decodeUnknownSync(PreferencesSchema);
const listeners = new Set<() => void>();
let initialized = false;
let snapshot = DEFAULT_ATMOSPHERE_CONSOLE_PREFERENCES;

function readPreferences(): AtmosphereConsolePreferences {
  try {
    const raw = window.localStorage.getItem(ATMOSPHERE_CONSOLE_STORAGE_KEY);
    if (raw && raw.length <= MAX_PREFERENCES_CHARACTERS) return decodePreferences(JSON.parse(raw));
  } catch {
    // Invalid or unavailable storage must not prevent use of the local controls.
  }
  return DEFAULT_ATMOSPHERE_CONSOLE_PREFERENCES;
}

function getSnapshot(): AtmosphereConsolePreferences {
  if (!initialized) {
    snapshot = readPreferences();
    initialized = true;
  }
  return snapshot;
}

function onStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== ATMOSPHERE_CONSOLE_STORAGE_KEY) return;
  snapshot = readPreferences();
  initialized = true;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener("storage", onStorage);
      initialized = false;
    }
  };
}

function setPreferences(
  value:
    | AtmosphereConsolePreferences
    | ((current: AtmosphereConsolePreferences) => AtmosphereConsolePreferences),
): void {
  const next = typeof value === "function" ? value(getSnapshot()) : value;
  snapshot = next;
  initialized = true;
  try {
    window.localStorage.setItem(ATMOSPHERE_CONSOLE_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Keep one in-memory snapshot for all mounted controls when saving fails.
  }
  for (const listener of listeners) listener();
}

const getServerSnapshot = () => DEFAULT_ATMOSPHERE_CONSOLE_PREFERENCES;

/** Shared accessor so the Appearance panel and the console stay in step. */
export function useAtmosphereConsolePreferences(): [
  AtmosphereConsolePreferences,
  (
    value:
      | AtmosphereConsolePreferences
      | ((current: AtmosphereConsolePreferences) => AtmosphereConsolePreferences),
  ) => void,
] {
  return [useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot), setPreferences];
}
