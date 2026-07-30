import { useSyncExternalStore } from "react";

import {
  approveSessionAudioCaptureStream,
  revokeSessionAudioCaptureStream,
} from "./localMediaAudioVisualizer";

export type AmbientAudioCaptureFailureCode = "cancelled" | "failed" | "no-audio" | "unsupported";

export type AmbientAudioCaptureSnapshot =
  | {
      readonly status: "idle";
      readonly stream: null;
      readonly failure: null;
    }
  | {
      readonly status: "requesting";
      readonly stream: null;
      readonly failure: null;
    }
  | {
      readonly status: "active";
      readonly stream: MediaStream;
      readonly failure: null;
    }
  | {
      readonly status: "error";
      readonly stream: null;
      readonly failure: {
        readonly code: AmbientAudioCaptureFailureCode;
        readonly message: string;
      };
    };

export interface AmbientAudioCapturePlatform {
  readonly getDisplayMedia: (constraints: DisplayMediaStreamOptions) => Promise<MediaStream>;
}

export interface AmbientAudioCaptureStore {
  readonly getSnapshot: () => AmbientAudioCaptureSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Must be called directly from a user action. The browser/Electron display
   * capture chooser remains authoritative; there is intentionally no
   * getUserMedia or microphone fallback.
   */
  readonly start: () => Promise<boolean>;
  readonly stop: () => void;
}

const IDLE_SNAPSHOT: AmbientAudioCaptureSnapshot = {
  status: "idle",
  stream: null,
  failure: null,
};

function browserPlatform(): AmbientAudioCapturePlatform | null {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getDisplayMedia !== "function"
  ) {
    return null;
  }
  return {
    getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
  };
}

function captureError(error: unknown): AmbientAudioCaptureSnapshot {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { readonly name?: unknown }).name)
      : "";
  if (name === "NotAllowedError" || name === "AbortError") {
    return {
      status: "error",
      stream: null,
      failure: {
        code: "cancelled",
        message: "Audio sharing was cancelled or denied.",
      },
    };
  }
  if (name === "NotFoundError") {
    return {
      status: "error",
      stream: null,
      failure: {
        code: "unsupported",
        message: "No shareable tab, window, or system-audio source is available.",
      },
    };
  }
  return {
    status: "error",
    stream: null,
    failure: {
      code: "failed",
      message: "Club Code could not start shared-audio analysis.",
    },
  };
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // A source can end while teardown is already in progress.
    }
  }
}

export function createAmbientAudioCaptureStore(
  platform: AmbientAudioCapturePlatform | null,
): AmbientAudioCaptureStore {
  let snapshot = IDLE_SNAPSHOT;
  let generation = 0;
  let removeEndedListeners: (() => void) | null = null;
  const listeners = new Set<() => void>();
  const emit = (next: AmbientAudioCaptureSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const releaseCurrent = () => {
    removeEndedListeners?.();
    removeEndedListeners = null;
    if (snapshot.status !== "active") return;
    const stream = snapshot.stream;
    revokeSessionAudioCaptureStream(stream);
    stopTracks(stream);
  };

  const stop = () => {
    generation += 1;
    releaseCurrent();
    if (snapshot.status !== "idle") emit(IDLE_SNAPSHOT);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: async () => {
      const requestGeneration = generation + 1;
      generation = requestGeneration;
      releaseCurrent();
      if (platform === null) {
        emit({
          status: "error",
          stream: null,
          failure: {
            code: "unsupported",
            message: "This browser cannot share tab, window, or system audio.",
          },
        });
        return false;
      }

      emit({ status: "requesting", stream: null, failure: null });
      let stream: MediaStream;
      try {
        // getDisplayMedia is the only capture API used. Video is required by
        // browser implementations, but is discarded immediately after consent.
        stream = await platform.getDisplayMedia({ audio: true, video: true });
      } catch (error) {
        if (generation === requestGeneration) emit(captureError(error));
        return false;
      }

      if (generation !== requestGeneration) {
        stopTracks(stream);
        return false;
      }

      for (const track of stream.getVideoTracks()) {
        try {
          track.stop();
        } catch {
          // Analysis never consumes or retains the display video track.
        }
      }
      const audioTracks = stream.getAudioTracks().filter((track) => track.readyState === "live");
      if (audioTracks.length === 0) {
        stopTracks(stream);
        emit({
          status: "error",
          stream: null,
          failure: {
            code: "no-audio",
            message:
              "The selected source did not share audio. Choose a source with Share audio enabled.",
          },
        });
        return false;
      }

      const onEnded = () => {
        if (snapshot.status === "active" && snapshot.stream === stream) stop();
      };
      for (const track of audioTracks) track.addEventListener("ended", onEnded);
      removeEndedListeners = () => {
        for (const track of audioTracks) track.removeEventListener("ended", onEnded);
      };
      approveSessionAudioCaptureStream(stream);
      emit({ status: "active", stream, failure: null });
      return true;
    },
    stop,
  };
}

export const ambientAudioCaptureStore = createAmbientAudioCaptureStore(browserPlatform());

export function useAmbientAudioCapture(): AmbientAudioCaptureSnapshot {
  return useSyncExternalStore(
    ambientAudioCaptureStore.subscribe,
    ambientAudioCaptureStore.getSnapshot,
    ambientAudioCaptureStore.getSnapshot,
  );
}
