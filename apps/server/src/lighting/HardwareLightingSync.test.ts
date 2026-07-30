import { describe, expect, it, vi } from "vitest";

import {
  HARDWARE_LIGHTING_MINIMUM_FRAME_INTERVAL_MS,
  makeHardwareLightingSyncController,
  MAX_HARDWARE_LIGHTING_COLORS,
  type HardwareLightingAdapter,
  type HardwareLightingAdapterStatus,
  type HardwareLightingFrame,
} from "./HardwareLightingSync.ts";

function frame(sequence = 1): HardwareLightingFrame {
  return { sequence, colors: [{ red: 51, green: 213, blue: 242 }] };
}

function adapter(): HardwareLightingAdapter {
  return {
    probe: vi.fn(
      async (): Promise<HardwareLightingAdapterStatus> => ({
        status: "available",
        detail: "Test adapter available.",
      }),
    ),
    applyFrame: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe("HardwareLightingSync", () => {
  it("is inert by default and never probes, writes, or closes an adapter", async () => {
    const target = adapter();
    const controller = makeHardwareLightingSyncController({ adapter: target });

    await expect(controller.probe()).resolves.toEqual({
      status: "unavailable",
      detail: "Hardware lighting sync is off. Club Code will not access lighting devices.",
    });
    await expect(controller.applyFrame(frame())).resolves.toBe("disabled");
    await controller.close();

    expect(target.probe).not.toHaveBeenCalled();
    expect(target.applyFrame).not.toHaveBeenCalled();
    expect(target.close).not.toHaveBeenCalled();
  });

  it("applies only bounded RGB frames after explicit opt-in", async () => {
    const target = adapter();
    let now = 1_000;
    const controller = makeHardwareLightingSyncController({
      enabled: true,
      adapter: target,
      clock: { nowMonotonicMillis: () => now },
    });

    await expect(controller.probe()).resolves.toEqual({
      status: "available",
      detail: "The selected hardware lighting adapter is available.",
    });
    await expect(controller.applyFrame(frame())).resolves.toBe("applied");
    await expect(controller.applyFrame(frame(2))).resolves.toBe("rate-limited");
    now += HARDWARE_LIGHTING_MINIMUM_FRAME_INTERVAL_MS;
    await expect(controller.applyFrame(frame(3))).resolves.toBe("applied");
    await expect(
      controller.applyFrame({
        sequence: 4,
        colors: Array.from({ length: MAX_HARDWARE_LIGHTING_COLORS + 1 }, () => ({
          red: 1,
          green: 2,
          blue: 3,
        })),
      }),
    ).resolves.toBe("invalid");
    await expect(
      controller.applyFrame({ sequence: 5, colors: [{ red: 256, green: 0, blue: 0 }] }),
    ).resolves.toBe("invalid");
    expect(target.applyFrame).toHaveBeenCalledTimes(2);
  });

  it("serializes adapter writes and stays closed after cleanup", async () => {
    let release!: () => void;
    const target = adapter();
    vi.mocked(target.applyFrame).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const controller = makeHardwareLightingSyncController({
      enabled: true,
      adapter: target,
      clock: { nowMonotonicMillis: () => 1_000 },
    });

    const first = controller.applyFrame({
      ...frame(),
      colors: [{ red: 51, green: 213, blue: 242, ignored: "not forwarded" }],
    } as unknown as HardwareLightingFrame);
    await expect(controller.applyFrame(frame(2))).resolves.toBe("busy");
    const closing = controller.close();
    expect(target.close).not.toHaveBeenCalled();
    release();
    await expect(first).resolves.toBe("applied");
    await closing;
    await expect(controller.applyFrame(frame(3))).resolves.toBe("disabled");
    expect(target.applyFrame).toHaveBeenCalledWith({
      sequence: 1,
      colors: [{ red: 51, green: 213, blue: 242 }],
    });
    expect(target.close).toHaveBeenCalledOnce();
  });

  it("contains adapter errors and never treats them as successful writes", async () => {
    const target = adapter();
    vi.mocked(target.probe).mockRejectedValueOnce(new Error("raw vendor error"));
    vi.mocked(target.applyFrame).mockRejectedValueOnce(new Error("raw vendor error"));
    const controller = makeHardwareLightingSyncController({
      enabled: true,
      adapter: target,
      clock: { nowMonotonicMillis: () => 1_000 },
    });

    await expect(controller.probe()).resolves.toEqual({
      status: "unavailable",
      detail: "The selected hardware lighting adapter did not complete its capability check.",
    });
    await expect(controller.applyFrame(frame())).resolves.toBe("adapter-error");
  });
});
