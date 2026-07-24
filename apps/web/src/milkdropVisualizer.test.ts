import { describe, expect, it, vi } from "vitest";

import {
  MILKDROP_MAX_CANVAS_EDGE,
  MILKDROP_MAX_CANVAS_PIXELS,
  MilkdropVisualizerController,
  adjacentMilkdropPresetName,
  compareMilkdropPresetNames,
  fitMilkdropCanvas,
  mergeMilkdropPresetPacks,
  randomMilkdropPresetName,
} from "./milkdropVisualizer";

describe("mergeMilkdropPresetPacks", () => {
  it("deduplicates by stable pack priority and sorts names deterministically", () => {
    const firstPreset = { id: "first" };
    const duplicatePreset = { id: "duplicate" };
    const catalog = mergeMilkdropPresetPacks([
      {
        packName: "main",
        presets: {
          zebra: firstPreset,
          Alpha: { id: "alpha" },
          duplicate: firstPreset,
        },
      },
      {
        packName: "Extra",
        presets: {
          beta: { id: "beta" },
          duplicate: duplicatePreset,
        },
      },
    ]);

    expect(catalog.names).toEqual(["Alpha", "beta", "duplicate", "zebra"]);
    expect(catalog.presets.get("duplicate")).toBe(firstPreset);
    expect(catalog.sourceByName.get("duplicate")).toBe("main");
  });

  it("stores object-prototype-shaped names without changing their meaning", () => {
    const catalog = mergeMilkdropPresetPacks([
      {
        packName: "main",
        presets: Object.fromEntries([
          ["__proto__", { id: "prototype" }],
          ["constructor", { id: "constructor" }],
        ]),
      },
    ]);

    expect(catalog.names).toEqual(["__proto__", "constructor"]);
    expect(catalog.presets.get("__proto__")).toEqual({ id: "prototype" });
  });
});

describe("preset navigation", () => {
  const names = ["Alpha", "Beta", "Gamma"];

  it("wraps next and previous navigation", () => {
    expect(adjacentMilkdropPresetName(names, "Alpha", 1)).toBe("Beta");
    expect(adjacentMilkdropPresetName(names, "Gamma", 1)).toBe("Alpha");
    expect(adjacentMilkdropPresetName(names, "Alpha", -1)).toBe("Gamma");
    expect(adjacentMilkdropPresetName(names, "missing", 1)).toBe("Alpha");
    expect(adjacentMilkdropPresetName(names, "missing", -1)).toBe("Gamma");
    expect(adjacentMilkdropPresetName([], null, 1)).toBeNull();
  });

  it("selects a random preset without reselecting the current one", () => {
    expect(randomMilkdropPresetName(names, "Beta", () => 0)).toBe("Alpha");
    expect(randomMilkdropPresetName(names, "Beta", () => 0.999)).toBe("Gamma");
    expect(randomMilkdropPresetName(names, null, () => 0.5)).toBe("Beta");
    expect(randomMilkdropPresetName(["only"], "only", () => 0.5)).toBe("only");
    expect(randomMilkdropPresetName([], null, () => 0.5)).toBeNull();
  });

  it("samples randomness exactly once", () => {
    const random = vi.fn(() => 0.25);
    randomMilkdropPresetName(names, "Alpha", random);
    expect(random).toHaveBeenCalledOnce();
  });
});

describe("compareMilkdropPresetNames", () => {
  it("uses a case-folded locale-independent order with an exact tie-break", () => {
    expect(["z", "alpha", "Alpha", "Beta"].toSorted(compareMilkdropPresetNames)).toEqual([
      "Alpha",
      "alpha",
      "Beta",
      "z",
    ]);
  });
});

describe("fitMilkdropCanvas", () => {
  it("uses high DPI while bounding edge length and total GPU pixels", () => {
    expect(fitMilkdropCanvas(640, 360, 2)).toEqual({
      width: 1_280,
      height: 720,
      dpr: 2,
    });

    const huge = fitMilkdropCanvas(20_000, 10_000, 4);
    expect(huge.width).toBeLessThanOrEqual(MILKDROP_MAX_CANVAS_EDGE);
    expect(huge.height).toBeLessThanOrEqual(MILKDROP_MAX_CANVAS_EDGE);
    expect(huge.width * huge.height).toBeLessThanOrEqual(MILKDROP_MAX_CANVAS_PIXELS);
  });

  it("fails closed for invalid layout measurements", () => {
    expect(fitMilkdropCanvas(Number.NaN, 100, 2)).toEqual({
      width: 1,
      height: 1,
      dpr: 1,
    });
    expect(fitMilkdropCanvas(100, 0, 2)).toEqual({
      width: 1,
      height: 1,
      dpr: 1,
    });
  });
});

describe("MilkdropVisualizerController failures", () => {
  it("publishes successful frame timestamps without creating a second scheduler", () => {
    const frames = new Map<number, FrameRequestCallback>();
    const visualizer = {
      connectAudio: vi.fn(),
      disconnectAudio: vi.fn(),
      loadPreset: vi.fn(),
      render: vi.fn(),
      setRendererSize: vi.fn(),
    };
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ width: 640, height: 360 }),
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement;
    const source = { context: {} } as unknown as AudioNode;
    const onRenderFrame = vi.fn();
    let nextFrame = 0;
    const controller = new MilkdropVisualizerController(
      visualizer as never,
      {
        names: ["Alpha"],
        presets: new Map([["Alpha", {} as never]]),
        sourceByName: new Map([["Alpha", "test"]]),
      },
      {
        audioContext: source.context as AudioContext,
        audioSource: source,
        canvas,
        onRenderFrame,
        platform: {
          requestAnimationFrame: (callback) => {
            const handle = ++nextFrame;
            frames.set(handle, callback);
            return handle;
          },
          cancelAnimationFrame: (handle) => {
            frames.delete(handle);
          },
          now: () => 0,
          devicePixelRatio: () => 1,
          random: () => 0,
        },
      },
      "Alpha",
    );

    expect(controller.start()).toBe(true);
    expect(frames).toHaveLength(1);
    const entry = [...frames.entries()][0]!;
    frames.delete(entry[0]);
    entry[1](100);
    expect(onRenderFrame).toHaveBeenCalledWith(100);
    expect(frames).toHaveLength(1);
    controller.destroy();
  });

  it("does not revive a renderer after a rendering failure", () => {
    const frames = new Map<number, FrameRequestCallback>();
    const visualizer = {
      connectAudio: vi.fn(),
      disconnectAudio: vi.fn(),
      loadPreset: vi.fn(),
      render: vi.fn(() => {
        throw new Error("GPU lost");
      }),
      setRendererSize: vi.fn(),
    };
    const canvas = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getBoundingClientRect: () => ({ width: 640, height: 360 }),
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement;
    const source = { context: {} } as unknown as AudioNode;
    let nextFrame = 0;
    const controller = new MilkdropVisualizerController(
      visualizer as never,
      {
        names: ["Alpha"],
        presets: new Map([["Alpha", {} as never]]),
        sourceByName: new Map([["Alpha", "test"]]),
      },
      {
        audioContext: source.context as AudioContext,
        audioSource: source,
        canvas,
        platform: {
          requestAnimationFrame: (callback) => {
            const handle = ++nextFrame;
            frames.set(handle, callback);
            return handle;
          },
          cancelAnimationFrame: (handle) => {
            frames.delete(handle);
          },
          now: () => 0,
          devicePixelRatio: () => 1,
          random: () => 0,
        },
      },
      "Alpha",
    );

    expect(controller.start()).toBe(true);
    const entry = [...frames.entries()][0];
    expect(entry).toBeDefined();
    frames.delete(entry![0]);
    entry?.[1](100);

    expect(controller.running).toBe(false);
    expect(controller.failed).toBe(true);
    expect(frames).toHaveLength(0);
    expect(controller.start()).toBe(false);
    expect(visualizer.connectAudio).toHaveBeenCalledOnce();
  });
});
