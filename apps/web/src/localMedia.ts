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
  /** A safe, current-session display title. It is never a source path. */
  readonly displayTitle: string;
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
  ".aif",
  ".aiff",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".opus",
  ".wav",
  ".wma",
  ".3gp",
  ".avi",
  ".flv",
  ".m2ts",
  ".mkv",
  ".mpeg",
  ".mpg",
  ".ts",
  ".webm",
  ".mp4",
  ".m4v",
  ".mov",
  ".wmv",
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

export interface LocalMediaFile extends Blob {
  readonly type: string;
  readonly name?: string;
}

export interface LocalMediaSelectionMetadata {
  /**
   * An optional, caller-supplied media title. Source paths are reduced to a
   * basename before they can enter in-memory state.
   */
  readonly displayTitle?: string;
}

function clampFinite(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function classifyLocalMedia(file: LocalMediaFile): LocalMediaKind | null {
  const mediaType = file.type.toLowerCase();
  if (mediaType.startsWith("audio/")) return "audio";
  if (mediaType.startsWith("video/")) return "video";
  // Some browsers report an empty MIME type for local files. The name is used
  // for one-time classification and to derive a safe display title only.
  const extension = file.name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (
    ["aac", "aif", "aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma"].includes(
      extension ?? "",
    )
  ) {
    return "audio";
  }
  if (
    [
      "3gp",
      "avi",
      "flv",
      "m2ts",
      "m4v",
      "mkv",
      "mov",
      "mp4",
      "mpeg",
      "mpg",
      "ts",
      "webm",
      "wmv",
    ].includes(extension ?? "")
  ) {
    return "video";
  }
  return null;
}

const FALLBACK_DISPLAY_TITLE = "Untitled local media";

function safeBasenameWithoutExtension(value: string): string {
  const basename = value.trim().split(/[\\/]/).at(-1)?.trim() ?? "";
  const extensionIndex = basename.lastIndexOf(".");
  return extensionIndex > 0 ? basename.slice(0, extensionIndex).trim() : basename;
}

/**
 * Keeps a human-readable title while ensuring source paths cannot be retained
 * in local-media state. File names are reduced to their basename and extension.
 */
export function deriveLocalMediaDisplayTitle(
  file: LocalMediaFile,
  metadata: LocalMediaSelectionMetadata = {},
): string {
  const metadataTitle = metadata.displayTitle?.trim();
  if (metadataTitle) {
    const isSourcePath = /^(?:[a-z]:[\\/]|[\\/]{1,2}|file:\/\/)/i.test(metadataTitle);
    const title = isSourcePath
      ? safeBasenameWithoutExtension(metadataTitle)
      : metadataTitle.replace(/[\r\n\t]/g, " ").trim();
    if (title) return title;
  }

  return safeBasenameWithoutExtension(file.name ?? "") || FALLBACK_DISPLAY_TITLE;
}

export interface LocalMediaStore {
  readonly getSnapshot: () => LocalMediaState;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Replaces the current in-memory selection. The file and source path never
   * leave the browser's file picker or enter persisted settings; only a safe
   * display title is kept for this session.
   */
  readonly selectFile: (file: LocalMediaFile, metadata?: LocalMediaSelectionMetadata) => boolean;
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
    selectFile: (file, metadata = {}) => {
      const kind = classifyLocalMedia(file);
      if (!kind) return false;
      const objectUrl = urlApi.createObjectURL(file);
      const previousUrl = state.source?.objectUrl;
      replace({
        ...state,
        source: { kind, objectUrl, displayTitle: deriveLocalMediaDisplayTitle(file, metadata) },
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
