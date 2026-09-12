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
  resolveBundledMilkdropFactory,
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
  it.each([
    [1e200, 1e200],
    [1e300, 1],
    [1, 1e300],
    [4096.1, 1024.1],
    [0.1, 0.2],
  ])("keeps finite backing dimensions within both limits for %s by %s", (width, height) => {
    const size = fitMilkdropCanvas(width, height, 2);
    expect(Number.isFinite(size.dpr)).toBe(true);
    expect(size.dpr).toBeGreaterThan(0);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
    expect(size.width).toBeLessThanOrEqual(MILKDROP_MAX_CANVAS_EDGE);
    expect(size.height).toBeLessThanOrEqual(MILKDROP_MAX_CANVAS_EDGE);
    expect(size.width * size.height).toBeLessThanOrEqual(MILKDROP_MAX_CANVAS_PIXELS);
  });
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
    expect(controller.selectPreset("Alpha")).toBe(false);
    expect(visualizer.loadPreset).not.toHaveBeenCalled();
  });
});

describe("MilkDrop owned lifecycle", () => {
  function fixture(onPresetChange?: () => void) {
    const frames = new Map<number, FrameRequestCallback>();
    const listeners = new Map<string, EventListener>();
    let sequence = 0;
    const loseContext = vi.fn();
    const visualizer = {
      connectAudio: vi.fn(),
      disconnectAudio: vi.fn(),
      loadPreset: vi.fn(),
      render: vi.fn(),
      setRendererSize: vi.fn(),
    };
    const context = {} as AudioContext;
    const audioSource = { context } as unknown as AudioNode;
    const controller = new MilkdropVisualizerController(
      visualizer as never,
      mergeMilkdropPresetPacks([{ packName: "synthetic", presets: { Alpha: {}, Beta: {} } }]),
      {
        audioContext: context,
        audioSource,
        canvas: {
          addEventListener: (name: string, listener: EventListener) =>
            listeners.set(name, listener),
          removeEventListener: (name: string) => listeners.delete(name),
          getContext: () => ({ getExtension: () => ({ loseContext }) }),
        } as unknown as HTMLCanvasElement,
        autoCycle: true,
        cycleIntervalSeconds: 3,
        ...(onPresetChange ? { onPresetChange } : {}),
        platform: {
          requestAnimationFrame: (callback) => {
            frames.set(++sequence, callback);
            return sequence;
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
    const tick = (timestamp: number) => {
      const [id, callback] = frames.entries().next().value!;
      frames.delete(id);
      callback(timestamp);
    };
    return { controller, frames, listeners, visualizer, audioSource, loseContext, tick };
  }

  it.each(["stop", "destroy"] as const)("honors reentrant %s from a preset observer", (action) => {
    const state = fixture(() => state.controller[action]());
    expect(state.controller.start()).toBe(true);
    state.tick(3000);
    expect(state.visualizer.loadPreset).toHaveBeenCalledOnce();
    expect(state.visualizer.render).not.toHaveBeenCalled();
    expect(state.frames.size).toBe(0);
    expect(state.visualizer.disconnectAudio).toHaveBeenCalledExactlyOnceWith(state.audioSource);
    state.controller.destroy();
  });

  it("stops the one scheduler and targeted audio branch on context loss", () => {
    const state = fixture();
    state.controller.start();
    state.listeners.get("webglcontextlost")!(new Event("webglcontextlost"));
    expect(state.controller.failed).toBe(true);
    expect(state.controller.start()).toBe(false);
    expect(state.frames.size).toBe(0);
    expect(state.visualizer.disconnectAudio).toHaveBeenCalledExactlyOnceWith(state.audioSource);
    state.controller.destroy();
    state.controller.destroy();
    expect(state.loseContext).toHaveBeenCalledOnce();
    expect(state.listeners.size).toBe(0);
  });

  it("pauses and resumes without duplicating connections or closing the caller graph", () => {
    const state = fixture();
    state.controller.start();
    state.controller.start();
    expect(state.frames.size).toBe(1);
    expect(state.visualizer.connectAudio).toHaveBeenCalledOnce();
    state.controller.stop();
    state.controller.stop();
    expect(state.frames.size).toBe(0);
    expect(state.visualizer.disconnectAudio).toHaveBeenCalledOnce();
    state.controller.start();
    expect(state.frames.size).toBe(1);
    expect(state.visualizer.connectAudio).toHaveBeenCalledTimes(2);
    state.controller.destroy();
  });
});

describe("bundled MilkDrop module interop", () => {
  it.each([0, 1, 2])("accepts the pinned factory through %s default wrappers", (wrappers) => {
    const visualizer = {};
    const owner = {
      createVisualizer: vi.fn(function (this: unknown) {
        expect(this).toBe(owner);
        return visualizer;
      }),
    };
    let module: unknown = owner;
    for (let index = 0; index < wrappers; index += 1) module = { default: module };
    const factory = resolveBundledMilkdropFactory(module);
    expect(factory({} as AudioContext, {} as HTMLCanvasElement, { width: 1, height: 1 })).toBe(
      visualizer,
    );
    expect(owner.createVisualizer).toHaveBeenCalledOnce();
  });
  it("rejects malformed and recursively wrapped modules with a fixed message", () => {
    const cycle: { default?: unknown } = {};
    cycle.default = cycle;
    for (const module of [undefined, null, { createVisualizer: "private value" }, cycle]) {
      expect(() => resolveBundledMilkdropFactory(module)).toThrow(
        "The bundled MilkDrop factory is unavailable.",
      );
    }
  });
});
