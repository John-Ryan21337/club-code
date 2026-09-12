import { describe, expect, it } from "vitest";

import {
  EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL,
  MAX_LOCAL_MEDIA_AUDIO_SIGNAL_AGE_MS,
  createLocalMediaAudioSignalStore,
  hasFreshLocalMediaAudioSignal,
} from "./localMediaAudioSignal";

describe("local media audio signal", () => {
  it("keeps one bounded ephemeral feature sample and rejects non-finite samples", () => {
    const store = createLocalMediaAudioSignalStore();
    const owner = {};

    store.claim(owner);
    store.publish(owner, { level: 3, bass: -1, mid: 0.4, treble: 2, beat: Number.NaN }, 100);
    expect(store.getSnapshot()).toEqual({
      active: true,
      level: 1,
      bass: 0,
      mid: 0.4,
      treble: 1,
      beat: 0,
      sampledAt: 100,
    });
    store.publish(owner, { level: Number.NaN, bass: 0, mid: 0, treble: 0, beat: 0 }, 120);
    expect(store.getSnapshot()).toEqual({
      active: true,
      level: 0,
      bass: 0,
      mid: 0,
      treble: 0,
      beat: 0,
      sampledAt: 120,
    });
    store.publish(owner, { level: 0.5, bass: 0, mid: 0, treble: 0, beat: 0 }, Number.NaN);
    expect(store.getSnapshot().sampledAt).toBe(120);
    store.publish(owner, { level: 0.9, bass: 1, mid: 1, treble: 1, beat: 1 }, 120);
    store.publish(owner, { level: 0.9, bass: 1, mid: 1, treble: 1, beat: 1 }, 119);
    expect(store.getSnapshot()).toMatchObject({
      level: 0,
      sampledAt: 120,
    });
    store.publish(owner, { level: 0.6, bass: 0.5, mid: 0.4, treble: 0.3, beat: 0.2 }, 121);
    expect(store.getSnapshot()).toMatchObject({
      level: 0.6,
      bass: 0.5,
      mid: 0.4,
      treble: 0.3,
      beat: 0.2,
      sampledAt: 121,
    });
  });

  it("does not let an outgoing owner publish or clear after a handoff", () => {
    const store = createLocalMediaAudioSignalStore();
    const outgoing = {};
    const incoming = {};

    store.claim(outgoing);
    store.publish(outgoing, { level: 0.2, bass: 0, mid: 0, treble: 0, beat: 0 }, 100);
    store.claim(incoming);
    store.publish(incoming, { level: 0.8, bass: 0, mid: 0, treble: 0, beat: 0 }, 120);
    store.publish(outgoing, { level: 1, bass: 1, mid: 1, treble: 1, beat: 1 }, 130);
    store.release(outgoing);
    expect(store.getSnapshot()).toMatchObject({ active: true, level: 0.8, sampledAt: 120 });
    store.release(incoming);
    expect(store.getSnapshot()).toBe(EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL);
  });

  it("admits only fresh active monotonic samples", () => {
    const signal = {
      active: true,
      level: 0.4,
      bass: 0.3,
      mid: 0.4,
      treble: 0.2,
      beat: 0.1,
      sampledAt: 1_000,
    };
    expect(hasFreshLocalMediaAudioSignal(signal, 1_000 + MAX_LOCAL_MEDIA_AUDIO_SIGNAL_AGE_MS)).toBe(
      true,
    );
    expect(hasFreshLocalMediaAudioSignal(signal, 1_001 + MAX_LOCAL_MEDIA_AUDIO_SIGNAL_AGE_MS)).toBe(
      false,
    );
    expect(hasFreshLocalMediaAudioSignal({ ...signal, active: false }, 1_010)).toBe(false);
    expect(hasFreshLocalMediaAudioSignal(signal, 999)).toBe(false);
  });
});
