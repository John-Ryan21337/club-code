import { describe, expect, it } from "vitest";

import {
  EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL,
  MAX_LOCAL_MEDIA_AUDIO_SIGNAL_AGE_MS,
  createLocalMediaAudioSignalStore,
  hasFreshLocalMediaAudioSignal,
} from "./localMediaAudioSignal";

describe("local media audio signal", () => {
  it("keeps one bounded session-only level and clamps untrusted samples", () => {
    const store = createLocalMediaAudioSignalStore();
    const owner = {};

    store.publish(owner, 3, 100);
    expect(store.getSnapshot()).toEqual({ active: true, level: 1, sampledAt: 100 });
    store.publish(owner, Number.NaN, 120);
    expect(store.getSnapshot()).toEqual({ active: true, level: 0, sampledAt: 120 });
  });

  it("does not let an outgoing owner clear a newer element's signal", () => {
    const store = createLocalMediaAudioSignalStore();
    const outgoing = {};
    const incoming = {};

    store.publish(outgoing, 0.2, 100);
    store.publish(incoming, 0.8, 120);
    store.clear(outgoing);
    expect(store.getSnapshot()).toEqual({ active: true, level: 0.8, sampledAt: 120 });
    store.clear(incoming);
    expect(store.getSnapshot()).toBe(EMPTY_LOCAL_MEDIA_AUDIO_SIGNAL);
  });

  it("admits only fresh active samples", () => {
    const signal = { active: true, level: 0.4, sampledAt: 1_000 };
    expect(hasFreshLocalMediaAudioSignal(signal, 1_000 + MAX_LOCAL_MEDIA_AUDIO_SIGNAL_AGE_MS)).toBe(
      true,
    );
    expect(hasFreshLocalMediaAudioSignal(signal, 1_001 + MAX_LOCAL_MEDIA_AUDIO_SIGNAL_AGE_MS)).toBe(
      false,
    );
    expect(hasFreshLocalMediaAudioSignal({ ...signal, active: false }, 1_010)).toBe(false);
  });
});
