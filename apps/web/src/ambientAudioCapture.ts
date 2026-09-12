import { useSyncExternalStore } from "react";
import {
  approveSessionAudioCaptureStream,
  revokeSessionAudioCaptureStream,
} from "./localMediaAudioVisualizer";

export interface AmbientAudioCaptureOwner {
  readonly isCurrent: () => boolean;
}
export type AmbientAudioCaptureSnapshot =
  | { readonly status: "idle" | "requesting"; readonly stream: null; readonly failure: null }
  | { readonly status: "active"; readonly stream: MediaStream; readonly failure: null }
  | {
      readonly status: "error";
      readonly stream: null;
      readonly failure: {
        readonly code: "cancelled" | "failed" | "no-audio" | "unsupported";
        readonly message: string;
      };
    };
export interface AmbientAudioCapturePlatform {
  readonly getDisplayMedia: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
}
export interface AmbientAudioCaptureStore {
  readonly getSnapshot: () => AmbientAudioCaptureSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly isOwnedBy: (owner: AmbientAudioCaptureOwner | null) => boolean;
  /** Call directly from a user action; the capture request must retain its transient gesture. */
  readonly start: (owner: AmbientAudioCaptureOwner) => Promise<boolean>;
  readonly stop: (owner?: AmbientAudioCaptureOwner) => void;
}
const IDLE: AmbientAudioCaptureSnapshot = { status: "idle", stream: null, failure: null };
function current(owner: AmbientAudioCaptureOwner | null): boolean {
  try {
    return owner?.isCurrent() === true;
  } catch {
    return false;
  }
}
function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* Teardown remains best effort after an ended source. */
    }
  }
}
function failure(error: unknown): AmbientAudioCaptureSnapshot {
  const name =
    error instanceof DOMException
      ? error.name
      : typeof error === "object" && error !== null
        ? Object.getOwnPropertyDescriptor(error, "name")?.value
        : undefined;
  return {
    status: "error",
    stream: null,
    failure:
      name === "NotAllowedError" || name === "AbortError"
        ? { code: "cancelled", message: "Audio sharing was cancelled or denied." }
        : { code: "failed", message: "Cafe Code could not start shared-audio analysis." },
  };
}

export function createAmbientAudioCaptureStore(
  platform: AmbientAudioCapturePlatform | null,
): AmbientAudioCaptureStore {
  let snapshot = IDLE,
    owner: AmbientAudioCaptureOwner | null = null,
    generation = 0;
  let pending: Promise<MediaStream> | null = null;
  let dispatching = false;
  let removeListeners: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const emit = (next: AmbientAudioCaptureSnapshot) => {
    snapshot = next;
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* Observers cannot retain capture or interrupt stop. */
      }
    }
  };
  const release = () => {
    removeListeners?.();
    removeListeners = null;
    if (snapshot.status === "active") {
      revokeSessionAudioCaptureStream(snapshot.stream);
      stopTracks(snapshot.stream);
    }
  };
  const stop = (expected?: AmbientAudioCaptureOwner) => {
    if (expected && owner !== expected) return;
    generation++;
    release();
    owner = null;
    // getDisplayMedia has no cancellation signal. Keep admission closed until
    // the actual chooser/request settles; any late stream is stopped below.
    emit(pending ? { status: "requesting", stream: null, failure: null } : IDLE);
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isOwnedBy: (expected) => expected !== null && owner === expected && current(expected),
    stop,
    start: async (requestedOwner) => {
      if (pending || dispatching || !current(requestedOwner)) return false;
      const requestGeneration = ++generation;
      release();
      owner = requestedOwner;
      if (!platform) {
        emit({
          status: "error",
          stream: null,
          failure: {
            code: "unsupported",
            message: "Audio sharing is not available in this browser.",
          },
        });
        return false;
      }
      let stream: MediaStream;
      try {
        dispatching = true;
        emit({ status: "requesting", stream: null, failure: null });
        if (
          generation !== requestGeneration ||
          owner !== requestedOwner ||
          !current(requestedOwner)
        ) {
          // No chooser was dispatched. A changed live predicate can revoke
          // admission without calling stop, so clear its pending UI as well.
          if (owner === requestedOwner || owner === null) {
            owner = null;
            emit(IDLE);
          }
          return false;
        }
        // This is the only capture API. No microphone fallback or recording.
        pending = platform.getDisplayMedia({ audio: true, video: true });
        dispatching = false;
        stream = await pending;
      } catch (error) {
        if (generation === requestGeneration && owner === requestedOwner && current(owner))
          emit(failure(error));
        else if (owner === requestedOwner || owner === null) {
          owner = null;
          emit(IDLE);
        }
        return false;
      } finally {
        pending = null;
        dispatching = false;
      }
      if (
        generation !== requestGeneration ||
        owner !== requestedOwner ||
        !current(requestedOwner)
      ) {
        stopTracks(stream);
        if (owner === requestedOwner || owner === null) {
          owner = null;
          emit(IDLE);
        }
        return false;
      }
      for (const track of stream.getVideoTracks()) {
        try {
          track.stop();
        } catch {
          /* Checked below before admission. */
        }
      }
      if (stream.getVideoTracks().some((track) => track.readyState !== "ended")) {
        stopTracks(stream);
        emit(failure(null));
        return false;
      }
      const audio = stream.getAudioTracks().filter((track) => track.readyState === "live");
      if (!audio.length) {
        stopTracks(stream);
        emit({
          status: "error",
          stream: null,
          failure: {
            code: "no-audio",
            message: "This source did not provide audio. Check the source and its sharing options.",
          },
        });
        return false;
      }
      const ended = () => {
        if (snapshot.status === "active" && snapshot.stream === stream) stop(requestedOwner);
      };
      for (const track of audio) track.addEventListener("ended", ended);
      removeListeners = () => {
        for (const track of audio) track.removeEventListener("ended", ended);
      };
      approveSessionAudioCaptureStream(stream);
      emit({ status: "active", stream, failure: null });
      if (!current(requestedOwner)) {
        stop(requestedOwner);
        return false;
      }
      return snapshot.status === "active" && snapshot.stream === stream && owner === requestedOwner;
    },
  };
}
function browserPlatform(): AmbientAudioCapturePlatform | null {
  return typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
    ? { getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints) }
    : null;
}
export const ambientAudioCaptureStore = createAmbientAudioCaptureStore(browserPlatform());
export function useAmbientAudioCapture(): AmbientAudioCaptureSnapshot {
  return useSyncExternalStore(
    ambientAudioCaptureStore.subscribe,
    ambientAudioCaptureStore.getSnapshot,
    ambientAudioCaptureStore.getSnapshot,
  );
}
