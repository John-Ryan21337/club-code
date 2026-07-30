import { describe, expect, it, vi } from "vitest";

import { createAmbientAudioCaptureStore } from "./ambientAudioCapture";
import { isApprovedSessionAudioCaptureStream } from "./localMediaAudioVisualizer";

function track(kind: "audio" | "video", readyState: MediaStreamTrackState = "live") {
  const listeners = new Set<() => void>();
  return {
    kind,
    readyState,
    stop: vi.fn(function (this: { readyState: MediaStreamTrackState }) {
      this.readyState = "ended";
    }),
    addEventListener: vi.fn((_event: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_event: string, listener: () => void) =>
      listeners.delete(listener),
    ),
    end: () => {
      for (const listener of listeners) listener();
    },
  };
}

function stream(audioCount = 1, videoCount = 1) {
  const audio = Array.from({ length: audioCount }, () => track("audio"));
  const video = Array.from({ length: videoCount }, () => track("video"));
  const value = {
    getAudioTracks: () => audio,
    getVideoTracks: () => video,
    getTracks: () => [...audio, ...video],
  } as unknown as MediaStream;
  return { value, audio, video };
}

describe("ambient audio capture", () => {
  it("uses display capture only after start and discards video without echoing or persisting", async () => {
    const selected = stream();
    const getDisplayMedia = vi.fn(async () => selected.value);
    const store = createAmbientAudioCaptureStore({ getDisplayMedia });

    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(await store.start()).toBe(true);
    expect(getDisplayMedia).toHaveBeenCalledWith({ audio: true, video: true });
    expect(selected.video[0]?.stop).toHaveBeenCalledOnce();
    expect(selected.audio[0]?.stop).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toEqual({
      status: "active",
      stream: selected.value,
      failure: null,
    });
    expect(isApprovedSessionAudioCaptureStream(selected.value)).toBe(true);

    store.stop();
    expect(selected.audio[0]?.stop).toHaveBeenCalledOnce();
    expect(isApprovedSessionAudioCaptureStream(selected.value)).toBe(false);
    expect(store.getSnapshot().status).toBe("idle");
  });

  it("has no microphone fallback and reports unsupported/cancelled capture honestly", async () => {
    const unsupported = createAmbientAudioCaptureStore(null);
    expect(await unsupported.start()).toBe(false);
    expect(unsupported.getSnapshot()).toMatchObject({
      status: "error",
      failure: { code: "unsupported" },
    });

    const getDisplayMedia = vi.fn(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    const cancelled = createAmbientAudioCaptureStore({ getDisplayMedia });
    expect(await cancelled.start()).toBe(false);
    expect(cancelled.getSnapshot()).toMatchObject({
      status: "error",
      failure: { code: "cancelled" },
    });
    expect(getDisplayMedia).toHaveBeenCalledOnce();
  });

  it("rejects silent shares, stops every track, and stops when the audio source ends", async () => {
    const silent = stream(0, 1);
    const silentStore = createAmbientAudioCaptureStore({
      getDisplayMedia: async () => silent.value,
    });
    expect(await silentStore.start()).toBe(false);
    expect(silent.video[0]?.stop).toHaveBeenCalled();
    expect(silentStore.getSnapshot()).toMatchObject({
      status: "error",
      failure: { code: "no-audio" },
    });

    const selected = stream();
    const store = createAmbientAudioCaptureStore({
      getDisplayMedia: async () => selected.value,
    });
    await store.start();
    selected.audio[0]?.end();
    expect(store.getSnapshot().status).toBe("idle");
    expect(selected.audio[0]?.stop).toHaveBeenCalledOnce();
  });

  it("stops a late picker result after the user cancels the pending request", async () => {
    const selected = stream();
    let resolve!: (stream: MediaStream) => void;
    const pending = new Promise<MediaStream>((done) => {
      resolve = done;
    });
    const store = createAmbientAudioCaptureStore({ getDisplayMedia: () => pending });
    const started = store.start();
    expect(store.getSnapshot().status).toBe("requesting");
    store.stop();
    resolve(selected.value);
    expect(await started).toBe(false);
    for (const mediaTrack of selected.value.getTracks()) {
      expect(mediaTrack.stop).toHaveBeenCalledOnce();
    }
    expect(store.getSnapshot().status).toBe("idle");
  });
});
