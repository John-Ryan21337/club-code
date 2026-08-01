import { describe, expect, it, vi } from "vitest";

import { createMatrixColorFrameStore } from "./matrixColorFrameStore";

const frame = (color: string, hue: number) => ({
  color,
  perStream: true,
  baseHue: hue,
  saturation: 88,
  lightness: 62,
});

describe("matrixColorFrameStore", () => {
  it("publishes exact frames and freezes the last frame when its owner releases", () => {
    const store = createMatrixColorFrameStore();
    const owner = {};
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.claim(owner);
    store.publish(owner, frame("hsl(10.0 88.0% 62.0%)", 10), "animated");
    expect(store.getSnapshot()).toMatchObject({
      frame: { color: "hsl(10.0 88.0% 62.0%)" },
      motion: "animated",
    });

    store.release(owner);
    expect(store.getSnapshot()).toMatchObject({
      frame: { color: "hsl(10.0 88.0% 62.0%)" },
      motion: "frozen",
    });
    store.publish(owner, frame("hsl(20.0 88.0% 62.0%)", 20), "animated");
    expect(store.getSnapshot()?.frame.color).toBe("hsl(10.0 88.0% 62.0%)");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("ignores a stale owner after a new atmosphere claims publication", () => {
    const store = createMatrixColorFrameStore();
    const oldOwner = {};
    const currentOwner = {};

    store.claim(oldOwner);
    store.publish(oldOwner, frame("hsl(10.0 88.0% 62.0%)", 10), "animated");
    store.claim(currentOwner);
    store.publish(oldOwner, frame("hsl(20.0 88.0% 62.0%)", 20), "animated");
    expect(store.getSnapshot()?.frame.color).toBe("hsl(10.0 88.0% 62.0%)");

    store.publish(currentOwner, frame("hsl(30.0 88.0% 62.0%)", 30), "animated");
    expect(store.getSnapshot()?.frame.color).toBe("hsl(30.0 88.0% 62.0%)");
  });
});
