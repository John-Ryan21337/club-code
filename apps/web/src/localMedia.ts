import { useSyncExternalStore } from "react";

export type LocalMediaKind = "audio" | "video";
export type LocalMediaLayoutMode = "preset" | "custom";
export type LocalMediaPresetPlacement = "bottom-left" | "bottom-right";
export type LocalMediaPresetSize = "small" | "medium" | "large";
export type LocalMediaPresentationMode = "floating" | "cinema" | "background";

export interface LocalMediaSource {
  readonly kind: LocalMediaKind;
  /** A current-document object URL. It is never persisted or logged. */
  readonly objectUrl: string;
}

export interface LocalMediaState {
  readonly source: LocalMediaSource | null;
  readonly layoutMode: LocalMediaLayoutMode;
  readonly presetPlacement: LocalMediaPresetPlacement;
  readonly presetSize: LocalMediaPresetSize;
  readonly presentationMode: LocalMediaPresentationMode;
  readonly glowEnabled: boolean;
  readonly glowColor: string;
  readonly glowOpacity: number;
  readonly backgroundOpacity: number;
  readonly visualizerEnabled: boolean;
}

export interface LocalMediaUrlApi {
  readonly createObjectURL: (object: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
}

export const LOCAL_MEDIA_INPUT_ACCEPT = [
  "audio/*",
  "video/*",
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".opus",
  ".wav",
  ".webm",
  ".mp4",
  ".m4v",
  ".mov",
].join(",");

export const DEFAULT_LOCAL_MEDIA_STATE: LocalMediaState = {
  source: null,
  layoutMode: "preset",
  presetPlacement: "bottom-right",
  presetSize: "medium",
  presentationMode: "floating",
  glowEnabled: false,
  glowColor: "#7dd3fc",
  glowOpacity: 0.35,
  backgroundOpacity: 0.4,
  visualizerEnabled: false,
};

interface FileLike extends Blob {
  readonly type: string;
  readonly name?: string;
}

function clampFinite(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function classifyLocalMedia(file: FileLike): LocalMediaKind | null {
  const mediaType = file.type.toLowerCase();
  if (mediaType.startsWith("audio/")) return "audio";
  if (mediaType.startsWith("video/")) return "video";
  // Some browsers report an empty MIME type for local files. The name is read
  // only for this one-time classifier and is never retained in state.
  const extension = file.name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav"].includes(extension ?? "")) {
    return "audio";
  }
  if (["webm", "mp4", "m4v", "mov"].includes(extension ?? "")) return "video";
  return null;
}

export interface LocalMediaStore {
  readonly getSnapshot: () => LocalMediaState;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Replaces the current in-memory selection. The file itself, name, and path
   * never leave the browser's file picker or enter persisted settings.
   */
  readonly selectFile: (file: FileLike) => boolean;
  readonly clear: () => void;
  readonly update: (patch: Partial<Omit<LocalMediaState, "source">>) => void;
}

export function createLocalMediaStore(
  urlApi: LocalMediaUrlApi,
  initial: LocalMediaState = DEFAULT_LOCAL_MEDIA_STATE,
): LocalMediaStore {
  let state = initial;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const replace = (next: LocalMediaState) => {
    state = next;
    emit();
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectFile: (file) => {
      const kind = classifyLocalMedia(file);
      if (!kind) return false;
      const objectUrl = urlApi.createObjectURL(file);
      const previousUrl = state.source?.objectUrl;
      replace({
        ...state,
        source: { kind, objectUrl },
        // The background presentation is video-only. Switching to an audio
        // file must never strand its playback controls behind the chat.
        presentationMode:
          kind === "audio" && state.presentationMode === "background"
            ? "floating"
            : state.presentationMode,
      });
      if (previousUrl) urlApi.revokeObjectURL(previousUrl);
      return true;
    },
    clear: () => {
      const previousUrl = state.source?.objectUrl;
      if (state.source !== null) replace({ ...state, source: null });
      if (previousUrl) urlApi.revokeObjectURL(previousUrl);
    },
    update: (patch) => {
      const next = { ...state, ...patch };
      replace({
        ...next,
        glowOpacity: clampFinite(next.glowOpacity, 0, 1, DEFAULT_LOCAL_MEDIA_STATE.glowOpacity),
        backgroundOpacity: clampFinite(
          next.backgroundOpacity,
          0.15,
          0.7,
          DEFAULT_LOCAL_MEDIA_STATE.backgroundOpacity,
        ),
        presentationMode:
          next.source?.kind === "audio" && next.presentationMode === "background"
            ? "floating"
            : next.presentationMode,
      });
    },
  };
}

const browserUrlApi: LocalMediaUrlApi = {
  createObjectURL: (object) => URL.createObjectURL(object),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
};

export const localMediaStore = createLocalMediaStore(browserUrlApi);

export function useLocalMediaState(): LocalMediaState {
  return useSyncExternalStore(
    localMediaStore.subscribe,
    localMediaStore.getSnapshot,
    localMediaStore.getSnapshot,
  );
}

/**
 * A local-only seam for optional renderer features such as a visualizer. It
 * exposes only the selected HTML media element, never a path, file, bytes, or
 * object URL. Consumers must detach their own listeners when it becomes null.
 */
let currentLocalMediaElement: HTMLMediaElement | null = null;
const localMediaElementListeners = new Set<() => void>();

export function registerLocalMediaElement(element: HTMLMediaElement | null): void {
  if (currentLocalMediaElement === element) return;
  currentLocalMediaElement = element;
  localMediaElementListeners.forEach((listener) => listener());
}

export function useLocalMediaElement(): HTMLMediaElement | null {
  return useSyncExternalStore(
    (listener) => {
      localMediaElementListeners.add(listener);
      return () => localMediaElementListeners.delete(listener);
    },
    () => currentLocalMediaElement,
    () => null,
  );
}
