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
  it("returns to idle when ownership expires during the requesting notification", async () => {
    const getDisplayMedia = vi.fn(async () => stream().value);
    const store = createAmbientAudioCaptureStore({ getDisplayMedia });
    let valid = true;
    store.subscribe(() => {
      if (store.getSnapshot().status === "requesting") valid = false;
    });
    expect(await store.start({ isCurrent: () => valid })).toBe(false);
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(store.getSnapshot().status).toBe("idle");
  });

  it("clears a rejected chooser after ownership expires without exposing its error", async () => {
    let reject!: (error: Error) => void;
    const getDisplayMedia = vi.fn(
      () =>
        new Promise<MediaStream>((_resolve, fail) => {
          reject = fail;
        }),
    );
    const store = createAmbientAudioCaptureStore({ getDisplayMedia });
    let valid = true;
    const request = store.start({ isCurrent: () => valid });
    valid = false;
    reject(Error("synthetic private source detail"));
    expect(await request).toBe(false);
    expect(store.getSnapshot()).toEqual({ status: "idle", stream: null, failure: null });
  });

  it("does not admit a second chooser through a synchronous observer", async () => {
    const selected = stream();
    const getDisplayMedia = vi.fn(async () => selected.value);
    const store = createAmbientAudioCaptureStore({ getDisplayMedia });
    let second: Promise<boolean> | undefined;
    let attempted = false;
    store.subscribe(() => {
      if (!attempted) {
        attempted = true;
        second = store.start({ isCurrent: () => true });
      }
    });
    expect(await store.start({ isCurrent: () => true })).toBe(true);
    expect(await second).toBe(false);
    expect(getDisplayMedia).toHaveBeenCalledOnce();
    store.stop();
  });
  it("keeps one actual chooser admitted after stop until its late stream settles", async () => {
    const selected = stream();
    let resolve!: (value: MediaStream) => void;
    const getDisplayMedia = vi.fn(
      () =>
        new Promise<MediaStream>((done) => {
          resolve = done;
        }),
    );
    const store = createAmbientAudioCaptureStore({ getDisplayMedia });
    const owner = { isCurrent: () => true };
    const request = store.start(owner);
    store.stop(owner);
    expect(await store.start({ isCurrent: () => true })).toBe(false);
    expect(getDisplayMedia).toHaveBeenCalledOnce();
    resolve(selected.value);
    expect(await request).toBe(false);
    expect(isApprovedSessionAudioCaptureStream(selected.value)).toBe(false);
    expect(selected.audio[0]?.readyState).toBe("ended");
    expect(store.getSnapshot().status).toBe("idle");
  });

  it("checks source ownership before dispatch and after the asynchronous chooser", async () => {
    const selected = stream();
    let resolve!: (value: MediaStream) => void;
    const getDisplayMedia = vi.fn(
      () =>
        new Promise<MediaStream>((done) => {
          resolve = done;
        }),
    );
    const store = createAmbientAudioCaptureStore({ getDisplayMedia });
    let valid = false;
    const owner = { isCurrent: () => valid };
    expect(await store.start(owner)).toBe(false);
    expect(getDisplayMedia).not.toHaveBeenCalled();
    valid = true;
    const request = store.start(owner);
    valid = false;
    resolve(selected.value);
    expect(await request).toBe(false);
    expect(selected.audio[0]?.readyState).toBe("ended");
    expect(isApprovedSessionAudioCaptureStream(selected.value)).toBe(false);
  });

  it("does not let old-owner cleanup stop a replacement stream", async () => {
    const first = stream(),
      second = stream();
    const store = createAmbientAudioCaptureStore({
      getDisplayMedia: vi
        .fn()
        .mockResolvedValueOnce(first.value)
        .mockResolvedValueOnce(second.value),
    });
    const oldOwner = { isCurrent: () => true },
      newOwner = { isCurrent: () => true };
    await store.start(oldOwner);
    await store.start(newOwner);
    store.stop(oldOwner);
    expect(first.audio[0]?.readyState).toBe("ended");
    expect(second.audio[0]?.readyState).toBe("live");
    expect(store.isOwnedBy(newOwner)).toBe(true);
    store.stop(newOwner);
  });

  it("refuses video that did not stop and never approves it for analysis", async () => {
    const selected = stream();
    selected.video[0]!.stop.mockImplementation(() => {});
    const store = createAmbientAudioCaptureStore({ getDisplayMedia: async () => selected.value });
    expect(await store.start({ isCurrent: () => true })).toBe(false);
    expect(selected.audio[0]?.readyState).toBe("ended");
    expect(isApprovedSessionAudioCaptureStream(selected.value)).toBe(false);
  });

  it("lets a reentrant stop prevent dispatch and contains observer failures", async () => {
    const getDisplayMedia = vi.fn(async () => stream().value);
    const store = createAmbientAudioCaptureStore({ getDisplayMedia });
    let stopped = false;
    store.subscribe(() => {
      if (!stopped) {
        stopped = true;
        store.stop();
      }
    });
    store.subscribe(() => {
      throw Error("synthetic observer failure");
    });
    expect(await store.start({ isCurrent: () => true })).toBe(false);
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(store.getSnapshot().status).toBe("idle");
  });

  it("uses display capture only after start and discards video without echoing or persisting", async () => {
    const selected = stream();
    const getDisplayMedia = vi.fn(async () => selected.value);
    const store = createAmbientAudioCaptureStore({ getDisplayMedia });

    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(await store.start({ isCurrent: () => true })).toBe(true);
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
    expect(await unsupported.start({ isCurrent: () => true })).toBe(false);
    expect(unsupported.getSnapshot()).toMatchObject({
      status: "error",
      failure: { code: "unsupported" },
    });

    const getDisplayMedia = vi.fn(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    const cancelled = createAmbientAudioCaptureStore({ getDisplayMedia });
    expect(await cancelled.start({ isCurrent: () => true })).toBe(false);
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
    expect(await silentStore.start({ isCurrent: () => true })).toBe(false);
    expect(silent.video[0]?.stop).toHaveBeenCalled();
    expect(silentStore.getSnapshot()).toMatchObject({
      status: "error",
      failure: { code: "no-audio" },
    });

    const selected = stream();
    const store = createAmbientAudioCaptureStore({
      getDisplayMedia: async () => selected.value,
    });
    await store.start({ isCurrent: () => true });
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
    const started = store.start({ isCurrent: () => true });
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
