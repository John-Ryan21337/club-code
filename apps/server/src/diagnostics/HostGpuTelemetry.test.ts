import { describe, expect, it, vi } from "vitest";

import { makeHostGpuTelemetrySampler } from "./HostGpuTelemetry.ts";

const availableGpu = {
  status: "available" as const,
  adapters: [
    {
      index: 0,
      name: "GPU 0",
      utilizationPercent: 40,
      memoryTotalBytes: 8_000,
      memoryUsedBytes: 2_000,
      memoryUtilizationPercent: 25,
    },
  ],
  reason: null,
  detail: null,
};

describe("HostGpuTelemetry", () => {
  it("coalesces concurrent host reads and caches the result across projects", async () => {
    let resolveRead!: (value: typeof availableGpu) => void;
    let now = 1_000;
    const read = vi.fn(
      () =>
        new Promise<typeof availableGpu>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const sampler = makeHostGpuTelemetrySampler({ read }, { nowMonotonicMillis: () => now });

    const first = sampler.sample();
    const second = sampler.sample();
    await Promise.resolve();
    resolveRead(availableGpu);

    await expect(Promise.all([first, second])).resolves.toEqual([availableGpu, availableGpu]);
    now = 3_999;
    await expect(sampler.sample()).resolves.toBe(availableGpu);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("caches a sanitized probe failure instead of retrying on every caller", async () => {
    let now = 1_000;
    const read = vi.fn(async () => {
      throw new Error("private driver failure");
    });
    const sampler = makeHostGpuTelemetrySampler({ read }, { nowMonotonicMillis: () => now });

    await expect(sampler.sample()).resolves.toMatchObject({
      status: "unavailable",
      reason: "probe-failed",
    });
    now = 2_000;
    await expect(sampler.sample()).resolves.toMatchObject({
      status: "unavailable",
      reason: "probe-failed",
    });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
