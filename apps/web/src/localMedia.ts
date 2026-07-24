import { useSyncExternalStore } from "react";

import {
  MAX_DESKTOP_LOCAL_MEDIA_QUEUE_BYTES,
  MAX_DESKTOP_LOCAL_MEDIA_QUEUE_ITEMS,
  type DesktopLocalMediaNavigationDirection,
  type DesktopLocalMediaSelection,
} from "@cafecode/contracts";

import type { LocalMediaVisualizerStyle } from "./localMediaAudioVisualizer";

export type LocalMediaKind = "audio" | "video";
export type LocalMediaLayoutMode = "preset" | "custom";
export type LocalMediaPresetPlacement = "bottom-left" | "bottom-right";
export type LocalMediaPresetSize = "small" | "medium" | "large";
export type LocalMediaPresentationMode = "floating" | "cinema" | "background";
export type LocalMediaGlowMode = "fixed" | "adaptive";

interface LocalMediaSourceBase {
  readonly kind: LocalMediaKind;
  /**
   * A current-document object URL or an opaque, owner-bound desktop playback
   * URL. It is never persisted or logged.
   */
  readonly objectUrl: string;
  /** A safe, current-session display title. It is never a source path. */
  readonly displayTitle: string;
}

export type LocalMediaSource =
  | (LocalMediaSourceBase & {
      readonly engine: "browser";
    })
  | (LocalMediaSourceBase & {
      readonly engine: "vlc";
      /** Opaque ownership token used only to release the desktop VLC process. */
      readonly sessionId: string;
    });

export interface LocalMediaState {
  readonly source: LocalMediaSource | null;
  readonly queue: {
    readonly currentIndex: number;
    readonly totalItems: number;
  } | null;
  readonly navigationPending: boolean;
  readonly layoutMode: LocalMediaLayoutMode;
  readonly presetPlacement: LocalMediaPresetPlacement;
  readonly presetSize: LocalMediaPresetSize;
  readonly presentationMode: LocalMediaPresentationMode;
  readonly glowEnabled: boolean;
  readonly glowMode: LocalMediaGlowMode;
  readonly glowColor: string;
  readonly glowOpacity: number;
  readonly backgroundOpacity: number;
  readonly visualizerEnabled: boolean;
  readonly visualizerStyle: LocalMediaVisualizerStyle;
  readonly visualizerPresetName: string | null;
  readonly visualizerAutoCycle: boolean;
  readonly visualizerCycleSeconds: number;
  readonly visualizerBlendSeconds: number;
}

export interface LocalMediaUrlApi {
  readonly createObjectURL: (object: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
}

export interface LocalMediaDesktopSessionApi {
  readonly release: (sessionId: string) => void | Promise<unknown>;
  readonly navigate?: (
    sessionId: string,
    direction: DesktopLocalMediaNavigationDirection,
  ) => Promise<DesktopLocalMediaSelection | null>;
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
  queue: null,
  navigationPending: false,
  layoutMode: "preset",
  presetPlacement: "bottom-right",
  presetSize: "medium",
  presentationMode: "floating",
  glowEnabled: false,
  glowMode: "fixed",
  glowColor: "#7dd3fc",
  glowOpacity: 0.35,
  backgroundOpacity: 0.4,
  visualizerEnabled: false,
  visualizerStyle: "milkdrop",
  visualizerPresetName: null,
  visualizerAutoCycle: true,
  visualizerCycleSeconds: 30,
  visualizerBlendSeconds: 4,
};

export const MIN_LOCAL_MEDIA_VISUALIZER_CYCLE_SECONDS = 5;
export const MAX_LOCAL_MEDIA_VISUALIZER_CYCLE_SECONDS = 300;
export const MIN_LOCAL_MEDIA_VISUALIZER_BLEND_SECONDS = 0;
export const MAX_LOCAL_MEDIA_VISUALIZER_BLEND_SECONDS = 15;

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

export const MAX_LOCAL_MEDIA_QUEUE_ITEMS = MAX_DESKTOP_LOCAL_MEDIA_QUEUE_ITEMS;
export const MAX_LOCAL_MEDIA_QUEUE_BYTES = MAX_DESKTOP_LOCAL_MEDIA_QUEUE_BYTES;

export function classifyLocalMedia(file: LocalMediaFile): LocalMediaKind | null {
  const mediaType = file.type.toLowerCase();
  const extension = file.name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const extensionKind: LocalMediaKind | null = [
    "aac",
    "aif",
    "aiff",
    "flac",
    "m4a",
    "mp3",
    "ogg",
    "opus",
    "wav",
    "wma",
  ].includes(extension ?? "")
    ? "audio"
    : [
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
      ? "video"
      : null;
  if (extensionKind) {
    // Extensions are the only useful fallback when a browser withholds a
    // local file MIME type, but an explicitly non-media/mismatched MIME is a
    // spoofing signal rather than a reason to hand bytes to a media decoder.
    if (
      mediaType.length === 0 ||
      mediaType === "application/octet-stream" ||
      mediaType === `audio/${extensionKind}` ||
      mediaType.startsWith(`${extensionKind}/`)
    ) {
      return extensionKind;
    }
    return null;
  }
  if (extension) return null;
  if (
    [
      "audio/aac",
      "audio/flac",
      "audio/mp4",
      "audio/mpeg",
      "audio/ogg",
      "audio/opus",
      "audio/wav",
      "audio/x-wav",
    ].includes(mediaType)
  ) {
    return "audio";
  }
  if (["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"].includes(mediaType)) {
    return "video";
  }
  return null;
}

const FALLBACK_DISPLAY_TITLE = "Untitled local media";
const MAX_LOCAL_MEDIA_DISPLAY_TITLE_LENGTH = 256;

function safeBasenameWithoutExtension(value: string): string {
  const basename = value.trim().split(/[\\/]/).at(-1)?.trim() ?? "";
  const extensionIndex = basename.lastIndexOf(".");
  return extensionIndex > 0 ? basename.slice(0, extensionIndex).trim() : basename;
}

function withoutControlCharacters(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      // Directional and isolate controls can make a basename visually appear
      // as a path or a different extension. They are presentation controls,
      // never useful title content.
      return codePoint < 32 ||
        codePoint === 127 ||
        (codePoint >= 0x200e && codePoint <= 0x200f) ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069)
        ? " "
        : character;
    })
    .join("");
}

/**
 * Keeps a human-readable title while ensuring source paths cannot be retained
 * in local-media state. File names are reduced to their basename and extension.
 */
export function deriveLocalMediaDisplayTitle(
  file: LocalMediaFile,
  metadata: LocalMediaSelectionMetadata = {},
): string {
  const metadataTitle =
    typeof metadata.displayTitle === "string" ? metadata.displayTitle.trim() : undefined;
  if (metadataTitle) {
    const isSourcePath = /^(?:[a-z]:[\\/]|[\\/]{1,2}|file:\/\/)/i.test(metadataTitle);
    const title = withoutControlCharacters(
      isSourcePath ? safeBasenameWithoutExtension(metadataTitle) : metadataTitle,
    )
      .replace(/\s+/g, " ")
      .trim();
    if (title) return title.slice(0, MAX_LOCAL_MEDIA_DISPLAY_TITLE_LENGTH);
  }

  const filenameTitle = withoutControlCharacters(safeBasenameWithoutExtension(file.name ?? ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LOCAL_MEDIA_DISPLAY_TITLE_LENGTH);
  return filenameTitle || FALLBACK_DISPLAY_TITLE;
}

export interface LocalMediaStore {
  readonly getSnapshot: () => LocalMediaState;
  /** Monotonic current-document selection intent; never persisted. */
  readonly getSelectionRevision: () => number;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Replaces the current in-memory selection. The file and source path never
   * leave the browser's file picker or enter persisted settings; only a safe
   * display title is kept for this session.
   */
  readonly selectFile: (file: LocalMediaFile, metadata?: LocalMediaSelectionMetadata) => boolean;
  readonly selectFiles: (files: readonly LocalMediaFile[]) => boolean;
  /**
   * Adopts one already-validated, owner-bound desktop VLC selection. The
   * renderer receives no file path, native command, or loopback endpoint.
   */
  readonly selectDesktopMedia: (selection: DesktopLocalMediaSelection) => boolean;
  readonly navigate: (direction: DesktopLocalMediaNavigationDirection) => Promise<boolean>;
  readonly handlePlaybackEnded: () => Promise<boolean>;
  readonly handlePlaybackFailure: () => Promise<boolean>;
  readonly markPlaybackSuccess: () => void;
  readonly clear: () => void;
  readonly update: (patch: Partial<Omit<LocalMediaState, "source">>) => void;
}

export function createLocalMediaStore(
  urlApi: LocalMediaUrlApi,
  initial: LocalMediaState = DEFAULT_LOCAL_MEDIA_STATE,
  desktopSessionApi: LocalMediaDesktopSessionApi = { release: () => undefined },
): LocalMediaStore {
  let state = initial;
  let selectionRevision = 0;
  let browserQueue: readonly LocalMediaFile[] = [];
  let failedIndexes = new Set<number>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const replace = (next: LocalMediaState) => {
    state = next;
    emit();
  };
  const releaseSource = (source: LocalMediaSource | null) => {
    if (source === null) return;
    if (source.engine === "browser") {
      urlApi.revokeObjectURL(source.objectUrl);
      return;
    }
    try {
      void Promise.resolve(desktopSessionApi.release(source.sessionId)).catch(() => undefined);
    } catch {
      // Desktop teardown is best-effort during replacement or renderer exit.
    }
  };

  const isDesktopSelection = (selection: DesktopLocalMediaSelection): boolean =>
    typeof selection === "object" &&
    selection !== null &&
    (selection.kind === "audio" || selection.kind === "video") &&
    typeof selection.displayTitle === "string" &&
    selection.displayTitle.trim().length > 0 &&
    selection.displayTitle.trim().length <= MAX_LOCAL_MEDIA_DISPLAY_TITLE_LENGTH &&
    typeof selection.playbackUrl === "string" &&
    typeof selection.sessionId === "string" &&
    Number.isSafeInteger(selection.currentIndex) &&
    selection.currentIndex >= 0 &&
    Number.isSafeInteger(selection.totalItems) &&
    selection.totalItems >= 1 &&
    selection.totalItems <= MAX_LOCAL_MEDIA_QUEUE_ITEMS &&
    selection.currentIndex < selection.totalItems &&
    typeof selection.engine === "object" &&
    selection.engine !== null &&
    selection.engine.label === "VLC" &&
    (selection.engine.version === null || typeof selection.engine.version === "string") &&
    selection.engine.reason === null &&
    /^cafecode-media:\/\/stream\/[A-Za-z0-9_-]{32,128}$/.test(selection.playbackUrl) &&
    /^[A-Za-z0-9_-]{32,128}$/.test(selection.sessionId);

  const installBrowserIndex = (index: number): boolean => {
    const file = browserQueue[index];
    const kind = file ? classifyLocalMedia(file) : null;
    if (!file || !kind) return false;
    const objectUrl = urlApi.createObjectURL(file);
    const previousSource = state.source;
    replace({
      ...state,
      source: {
        kind,
        objectUrl,
        displayTitle: deriveLocalMediaDisplayTitle(file),
        engine: "browser",
      },
      queue: { currentIndex: index, totalItems: browserQueue.length },
      navigationPending: false,
      presentationMode:
        kind === "audio" && state.presentationMode === "background"
          ? "floating"
          : state.presentationMode,
    });
    releaseSource(previousSource);
    return true;
  };

  const installDesktopSelection = (
    selection: DesktopLocalMediaSelection,
    releasePrevious: boolean,
  ): boolean => {
    if (!isDesktopSelection(selection)) return false;
    const previousSource = state.source;
    replace({
      ...state,
      source: {
        kind: selection.kind,
        objectUrl: selection.playbackUrl,
        displayTitle: deriveLocalMediaDisplayTitle(
          { type: `${selection.kind}/desktop` } as LocalMediaFile,
          { displayTitle: selection.displayTitle },
        ),
        engine: "vlc",
        sessionId: selection.sessionId,
      },
      queue: {
        currentIndex: selection.currentIndex,
        totalItems: selection.totalItems,
      },
      navigationPending: false,
      presentationMode:
        selection.kind === "audio" && state.presentationMode === "background"
          ? "floating"
          : state.presentationMode,
    });
    if (
      releasePrevious &&
      previousSource?.engine === "vlc" &&
      previousSource.sessionId === selection.sessionId
    ) {
      return true;
    }
    if (releasePrevious) releaseSource(previousSource);
    return true;
  };

  const failClosedDesktopSession = (sessionId: string): void => {
    if (state.source?.engine !== "vlc" || state.source.sessionId !== sessionId) return;
    selectionRevision += 1;
    browserQueue = [];
    failedIndexes = new Set();
    replace({ ...state, source: null, queue: null, navigationPending: false });
    try {
      void Promise.resolve(desktopSessionApi.release(sessionId)).catch(() => undefined);
    } catch {
      // The opaque queue is already absent from renderer state.
    }
  };

  const navigate = async (
    direction: DesktopLocalMediaNavigationDirection,
    afterFailure: boolean,
  ): Promise<boolean> => {
    const source = state.source;
    const queue = state.queue;
    if (!source || !queue || queue.totalItems < 1 || state.navigationPending) return false;
    if (!afterFailure) failedIndexes = new Set();
    if (source.engine === "browser") {
      const step = direction === "previous" ? -1 : 1;
      for (let attempt = 1; attempt <= queue.totalItems; attempt += 1) {
        const index =
          (queue.currentIndex + step * attempt + queue.totalItems * 2) % queue.totalItems;
        if (afterFailure && failedIndexes.has(index)) continue;
        selectionRevision += 1;
        return installBrowserIndex(index);
      }
      return false;
    }
    if (!desktopSessionApi.navigate) return false;
    const operationRevision = ++selectionRevision;
    const sessionId = source.sessionId;
    replace({ ...state, navigationPending: true });
    try {
      for (let attempt = 0; attempt < queue.totalItems; attempt += 1) {
        const selection = await desktopSessionApi.navigate(sessionId, direction);
        if (selectionRevision !== operationRevision) {
          if (state.source?.engine !== "vlc" || state.source.sessionId !== sessionId) {
            void Promise.resolve(desktopSessionApi.release(sessionId)).catch(() => undefined);
          }
          return false;
        }
        if (!selection || !isDesktopSelection(selection) || selection.sessionId !== sessionId) {
          failClosedDesktopSession(sessionId);
          return false;
        }
        if (!afterFailure || !failedIndexes.has(selection.currentIndex)) {
          return installDesktopSelection(selection, false);
        }
      }
      failClosedDesktopSession(sessionId);
      return false;
    } catch {
      if (selectionRevision === operationRevision) {
        failClosedDesktopSession(sessionId);
      }
      return false;
    }
  };

  const selectFiles = (files: readonly LocalMediaFile[]): boolean => {
    if (files.length < 1 || files.length > MAX_LOCAL_MEDIA_QUEUE_ITEMS) return false;
    let totalBytes = 0;
    for (const file of files) {
      if (!classifyLocalMedia(file)) return false;
      const size = Number.isFinite(file.size) && file.size >= 0 ? file.size : 0;
      totalBytes += size;
      if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_LOCAL_MEDIA_QUEUE_BYTES) {
        return false;
      }
    }
    const previousSource = state.source;
    browserQueue = [...files];
    failedIndexes = new Set();
    selectionRevision += 1;
    // installBrowserIndex releases the previous source after the replacement.
    const installed = installBrowserIndex(0);
    if (!installed) {
      browserQueue = [];
      releaseSource(previousSource);
    }
    return installed;
  };

  return {
    getSnapshot: () => state,
    getSelectionRevision: () => selectionRevision,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectFile: (file, metadata = {}) => {
      if (metadata.displayTitle === undefined) return selectFiles([file]);
      if (!classifyLocalMedia(file)) return false;
      const selected = selectFiles([file]);
      if (!selected || state.source?.engine !== "browser") return selected;
      replace({
        ...state,
        source: {
          ...state.source,
          displayTitle: deriveLocalMediaDisplayTitle(file, metadata),
        },
      });
      return true;
    },
    selectFiles,
    selectDesktopMedia: (selection) => {
      if (!isDesktopSelection(selection)) return false;
      browserQueue = [];
      failedIndexes = new Set();
      selectionRevision += 1;
      return installDesktopSelection(selection, true);
    },
    navigate: (direction) => navigate(direction, false),
    handlePlaybackEnded: () => navigate("next", false),
    handlePlaybackFailure: () => {
      if (state.queue) failedIndexes.add(state.queue.currentIndex);
      return navigate("next", true);
    },
    markPlaybackSuccess: () => {
      failedIndexes = new Set();
    },
    clear: () => {
      const previousSource = state.source;
      // Clearing is an operator intent even when no source is currently
      // installed; it must invalidate an outstanding native picker result.
      selectionRevision += 1;
      browserQueue = [];
      failedIndexes = new Set();
      if (state.source !== null || state.queue !== null || state.navigationPending) {
        replace({ ...state, source: null, queue: null, navigationPending: false });
      }
      releaseSource(previousSource);
    },
    update: (patch) => {
      const next = { ...state, ...patch };
      replace({
        ...next,
        glowMode: next.glowMode === "adaptive" ? "adaptive" : "fixed",
        glowOpacity: clampFinite(next.glowOpacity, 0, 1, DEFAULT_LOCAL_MEDIA_STATE.glowOpacity),
        backgroundOpacity: clampFinite(
          next.backgroundOpacity,
          0.15,
          0.7,
          DEFAULT_LOCAL_MEDIA_STATE.backgroundOpacity,
        ),
        visualizerCycleSeconds: clampFinite(
          next.visualizerCycleSeconds,
          MIN_LOCAL_MEDIA_VISUALIZER_CYCLE_SECONDS,
          MAX_LOCAL_MEDIA_VISUALIZER_CYCLE_SECONDS,
          DEFAULT_LOCAL_MEDIA_STATE.visualizerCycleSeconds,
        ),
        visualizerBlendSeconds: clampFinite(
          next.visualizerBlendSeconds,
          MIN_LOCAL_MEDIA_VISUALIZER_BLEND_SECONDS,
          MAX_LOCAL_MEDIA_VISUALIZER_BLEND_SECONDS,
          DEFAULT_LOCAL_MEDIA_STATE.visualizerBlendSeconds,
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

const desktopSessionApi: LocalMediaDesktopSessionApi = {
  release: (sessionId) =>
    typeof window === "undefined"
      ? undefined
      : (window.desktopBridge?.releaseLocalMedia({ sessionId }) ?? undefined),
  navigate: (sessionId, direction) =>
    typeof window === "undefined"
      ? Promise.resolve(null)
      : (window.desktopBridge?.navigateLocalMedia?.({ sessionId, direction }) ??
        Promise.resolve(null)),
};

export const localMediaStore = createLocalMediaStore(
  browserUrlApi,
  DEFAULT_LOCAL_MEDIA_STATE,
  desktopSessionApi,
);

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => localMediaStore.clear());
}

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
