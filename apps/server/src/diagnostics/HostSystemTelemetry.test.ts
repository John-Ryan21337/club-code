import { describe, expect, it } from "vitest";

import {
  calculateCpuUtilizationPercent,
  makeHostSystemTelemetrySampler,
  memoryCountersFromRuntime,
  type CpuTimes,
  type HostSystemTelemetryRuntime,
} from "./HostSystemTelemetry.ts";

function cpuTimes(input: { readonly busy: number; readonly idle: number }): CpuTimes {
  return {
    user: input.busy,
    nice: 0,
    sys: 0,
    idle: input.idle,
    irq: 0,
  };
}

function makeRuntime(input: {
  readonly readCpuTimes: () => ReadonlyArray<CpuTimes>;
  readonly readMemory?: HostSystemTelemetryRuntime["readMemory"];
}): HostSystemTelemetryRuntime {
  return {
    readCpuTimes: input.readCpuTimes,
    readMemory: input.readMemory ?? (() => ({ totalBytes: 1_000, availableBytes: 250 })),
  };
}

describe("HostSystemTelemetry", () => {
  it("calculates bounded host CPU utilization from aggregate deltas", () => {
    expect(
      calculateCpuUtilizationPercent({ total: 1_000, idle: 750 }, { total: 1_200, idle: 850 }),
    ).toBe(50);
    expect(
      calculateCpuUtilizationPercent({ total: 1_000, idle: 750 }, { total: 1_000, idle: 750 }),
    ).toBeNull();
    expect(
      calculateCpuUtilizationPercent({ total: 1_000, idle: 750 }, { total: 1_200, idle: 1_000 }),
    ).toBeNull();
    expect(
      calculateCpuUtilizationPercent({ total: 1_000, idle: 750 }, { total: 900, idle: 700 }),
    ).toBeNull();
    expect(
      calculateCpuUtilizationPercent({ total: 1_000, idle: 750 }, { total: 1_200, idle: 700 }),
    ).toBeNull();
  });

  it("uses process-effective total and process-available memory", () => {
    expect(memoryCountersFromRuntime(32_000, 8_000, 3_000, "linux")).toEqual({
      totalBytes: 8_000,
      availableBytes: 3_000,
    });
    expect(memoryCountersFromRuntime(32_000, 0, 12_000, "win32")).toEqual({
      totalBytes: 32_000,
      availableBytes: 12_000,
    });
    expect(memoryCountersFromRuntime(32_000, 64_000, 12_000, "win32")).toEqual({
      totalBytes: 32_000,
      availableBytes: 12_000,
    });

    const available = makeHostSystemTelemetrySampler(
      makeRuntime({
        readCpuTimes: () => [cpuTimes({ busy: 1, idle: 3 })],
      }),
    ).sample({ sampledAtMonotonicMs: 1_000, platform: "linux" });
    expect(available.memory).toEqual({
      status: "available",
      totalBytes: 1_000,
      usedBytes: 750,
      availableBytes: 250,
      utilizationPercent: 75,
      detail: null,
    });
  });

  it.each([
    { platform: "linux" as const, constrainedTotalBytes: 0 },
    { platform: "darwin" as const, constrainedTotalBytes: 0 },
    { platform: "darwin" as const, constrainedTotalBytes: 8_000 },
    { platform: "freebsd" as const, constrainedTotalBytes: 0 },
  ])(
    "fails unsupported $platform memory closed instead of treating raw free pages as available",
    ({ platform, constrainedTotalBytes }) => {
      expect(() =>
        memoryCountersFromRuntime(32_000, constrainedTotalBytes, 1_000, platform),
      ).toThrow("Process-available memory is unsupported on this platform.");
    },
  );

  it.each([
    { hostTotalBytes: 0, constrainedTotalBytes: 0, availableBytes: 0 },
    { hostTotalBytes: Number.NaN, constrainedTotalBytes: 0, availableBytes: 0 },
    { hostTotalBytes: 32_000, constrainedTotalBytes: Number.NaN, availableBytes: 1_000 },
    { hostTotalBytes: 32_000, constrainedTotalBytes: -1, availableBytes: 1_000 },
    { hostTotalBytes: 32_000, constrainedTotalBytes: 0, availableBytes: -1 },
    { hostTotalBytes: 32_000, constrainedTotalBytes: 0, availableBytes: 32_001 },
    {
      hostTotalBytes: 32_000,
      constrainedTotalBytes: 0,
      availableBytes: Number.MAX_SAFE_INTEGER + 1,
    },
  ])("rejects invalid live runtime memory counters: %j", (memory) => {
    expect(() =>
      memoryCountersFromRuntime(
        memory.hostTotalBytes,
        memory.constrainedTotalBytes,
        memory.availableBytes,
        "win32",
      ),
    ).toThrow("Invalid runtime memory counters.");
  });

  it("rejects a platform constraint whose available-memory counter does not account for it", () => {
    expect(() => memoryCountersFromRuntime(32_000, 8_000, 3_000, "win32")).toThrow(
      "Process-available memory is unsupported on this platform.",
    );
  });

  it("fails an invalid monotonic timestamp closed without corrupting the CPU baseline", () => {
    let cpu = [cpuTimes({ busy: 100, idle: 300 })];
    const sampler = makeHostSystemTelemetrySampler(
      makeRuntime({
        readCpuTimes: () => cpu,
      }),
    );

    const invalid = sampler.sample({ sampledAtMonotonicMs: Number.NaN, platform: "linux" });
    expect(invalid.cpu.status).toBe("unavailable");

    const warming = sampler.sample({ sampledAtMonotonicMs: 1_000, platform: "linux" });
    expect(warming.cpu.status).toBe("warming");
    cpu = [cpuTimes({ busy: 200, idle: 400 })];
    const available = sampler.sample({ sampledAtMonotonicMs: 2_000, platform: "linux" });
    expect(available.cpu).toMatchObject({ status: "available", utilizationPercent: 50 });
  });

  it("reports measured zero available memory as complete exhaustion", () => {
    const exhausted = makeHostSystemTelemetrySampler(
      makeRuntime({
        readCpuTimes: () => [cpuTimes({ busy: 1, idle: 3 })],
        readMemory: () => ({ totalBytes: 1_000, availableBytes: 0 }),
      }),
    ).sample({ sampledAtMonotonicMs: 1_000, platform: "linux" });
    expect(exhausted.memory).toEqual({
      status: "available",
      totalBytes: 1_000,
      usedBytes: 1_000,
      availableBytes: 0,
      utilizationPercent: 100,
      detail: null,
    });
  });

  it.each([
    { totalBytes: 0, availableBytes: 1 },
    { totalBytes: 1_000, availableBytes: 1_001 },
    { totalBytes: Number.MAX_SAFE_INTEGER + 1, availableBytes: 1 },
    { totalBytes: 1_000, availableBytes: Number.NaN },
    { totalBytes: -1, availableBytes: 1 },
  ])("fails invalid memory counters closed: %j", (memory) => {
    const sampler = makeHostSystemTelemetrySampler(
      makeRuntime({
        readCpuTimes: () => [cpuTimes({ busy: 1, idle: 3 })],
        readMemory: () => memory,
      }),
    );

    expect(sampler.sample({ sampledAtMonotonicMs: 1_000, platform: "linux" }).memory).toEqual({
      status: "unavailable",
      totalBytes: null,
      usedBytes: null,
      availableBytes: null,
      utilizationPercent: null,
      detail: "Memory telemetry is unavailable.",
    });
  });

  it("does not double-count Windows interrupt time already included in system time", () => {
    let cpu: ReadonlyArray<CpuTimes> = [{ user: 0, nice: 0, sys: 100, idle: 100, irq: 100 }];
    const sampler = makeHostSystemTelemetrySampler(makeRuntime({ readCpuTimes: () => cpu }));

    sampler.sample({ sampledAtMonotonicMs: 1_000, platform: "win32" });
    cpu = [{ user: 0, nice: 0, sys: 150, idle: 150, irq: 200 }];
    const second = sampler.sample({
      sampledAtMonotonicMs: 2_000,
      platform: "win32",
    });

    expect(second.cpu).toMatchObject({
      status: "available",
      utilizationPercent: 50,
      logicalProcessorCount: 1,
    });
  });

  it("includes separate interrupt counters on Unix-like platforms", () => {
    let cpu: ReadonlyArray<CpuTimes> = [{ user: 0, nice: 0, sys: 100, idle: 100, irq: 100 }];
    const sampler = makeHostSystemTelemetrySampler(makeRuntime({ readCpuTimes: () => cpu }));

    sampler.sample({ sampledAtMonotonicMs: 1_000, platform: "linux" });
    cpu = [{ user: 0, nice: 0, sys: 150, idle: 150, irq: 200 }];
    const second = sampler.sample({
      sampledAtMonotonicMs: 2_000,
      platform: "linux",
    });

    expect(second.cpu).toMatchObject({
      status: "available",
      utilizationPercent: 75,
      logicalProcessorCount: 1,
    });
  });

  it("warms a new baseline if the CPU accounting platform changes", () => {
    let cpu: ReadonlyArray<CpuTimes> = [{ user: 0, nice: 0, sys: 100, idle: 100, irq: 100 }];
    const sampler = makeHostSystemTelemetrySampler(makeRuntime({ readCpuTimes: () => cpu }));

    sampler.sample({ sampledAtMonotonicMs: 1_000, platform: "linux" });
    cpu = [{ user: 0, nice: 0, sys: 200, idle: 200, irq: 300 }];
    const changed = sampler.sample({
      sampledAtMonotonicMs: 1_500,
      platform: "win32",
    });
    expect(changed.cpu).toMatchObject({
      status: "warming",
      utilizationPercent: null,
      logicalProcessorCount: 1,
    });

    cpu = [{ user: 0, nice: 0, sys: 250, idle: 250, irq: 400 }];
    const settled = sampler.sample({
      sampledAtMonotonicMs: 2_500,
      platform: "win32",
    });
    expect(settled.cpu).toMatchObject({
      status: "available",
      utilizationPercent: 50,
      logicalProcessorCount: 1,
    });
  });

  it("throttles CPU counter reads while continuing to sample memory", () => {
    let cpuReadCount = 0;
    let memoryReadCount = 0;
    const sampler = makeHostSystemTelemetrySampler({
      readCpuTimes: () => {
        cpuReadCount += 1;
        return [cpuTimes({ busy: cpuReadCount * 100, idle: cpuReadCount * 300 })];
      },
      readMemory: () => {
        memoryReadCount += 1;
        return { totalBytes: 1_000, availableBytes: 250 };
      },
    });

    const first = sampler.sample({ sampledAtMonotonicMs: 1_000, platform: "linux" });
    const throttled = sampler.sample({ sampledAtMonotonicMs: 1_999, platform: "linux" });
    const resumed = sampler.sample({ sampledAtMonotonicMs: 2_000, platform: "linux" });

    expect(first.cpu.status).toBe("warming");
    expect(throttled.cpu).toBe(first.cpu);
    expect(resumed.cpu.status).toBe("available");
    expect(cpuReadCount).toBe(2);
    expect(memoryReadCount).toBe(3);
  });

  it("moves non-advancing CPU counters from warming to unavailable and recovers", () => {
    let cpu = [cpuTimes({ busy: 100, idle: 300 })];
    const sampler = makeHostSystemTelemetrySampler(makeRuntime({ readCpuTimes: () => cpu }));

    expect(sampler.sample({ sampledAtMonotonicMs: 1_000, platform: "linux" }).cpu.status).toBe(
      "warming",
    );
    expect(sampler.sample({ sampledAtMonotonicMs: 2_000, platform: "linux" }).cpu.status).toBe(
      "warming",
    );
    expect(sampler.sample({ sampledAtMonotonicMs: 3_000, platform: "linux" }).cpu.status).toBe(
      "warming",
    );
    const stalled = sampler.sample({
      sampledAtMonotonicMs: 4_000,
      platform: "linux",
    });
    expect(stalled.cpu).toMatchObject({
      status: "unavailable",
      utilizationPercent: null,
      detail: "CPU counters are not advancing consistently.",
    });

    cpu = [cpuTimes({ busy: 200, idle: 400 })];
    const recovered = sampler.sample({
      sampledAtMonotonicMs: 5_000,
      platform: "linux",
    });
    expect(recovered.cpu).toMatchObject({
      status: "available",
      utilizationPercent: 50,
    });
  });

  it("warms a fresh CPU baseline after monotonic time rolls backward", () => {
    let cpu = [cpuTimes({ busy: 100, idle: 300 })];
    const sampler = makeHostSystemTelemetrySampler(makeRuntime({ readCpuTimes: () => cpu }));

    sampler.sample({ sampledAtMonotonicMs: 1_000, platform: "linux" });
    cpu = [cpuTimes({ busy: 200, idle: 400 })];
    expect(sampler.sample({ sampledAtMonotonicMs: 2_000, platform: "linux" }).cpu.status).toBe(
      "available",
    );

    cpu = [cpuTimes({ busy: 300, idle: 500 })];
    const rollback = sampler.sample({
      sampledAtMonotonicMs: 500,
      platform: "linux",
    });
    expect(rollback.cpu.status).toBe("warming");

    cpu = [cpuTimes({ busy: 400, idle: 600 })];
    const settled = sampler.sample({
      sampledAtMonotonicMs: 1_500,
      platform: "linux",
    });
    expect(settled.cpu).toMatchObject({
      status: "available",
      utilizationPercent: 50,
    });
  });

  it("warms a new CPU baseline when the logical processor topology changes", () => {
    let cpu = [cpuTimes({ busy: 100, idle: 300 })];
    const sampler = makeHostSystemTelemetrySampler(makeRuntime({ readCpuTimes: () => cpu }));

    sampler.sample({ sampledAtMonotonicMs: 1_000, platform: "linux" });
    cpu = [cpuTimes({ busy: 200, idle: 400 }), cpuTimes({ busy: 1_000, idle: 3_000 })];
    const changed = sampler.sample({
      sampledAtMonotonicMs: 2_000,
      platform: "linux",
    });
    expect(changed.cpu).toMatchObject({
      status: "warming",
      logicalProcessorCount: 2,
    });

    cpu = [cpuTimes({ busy: 300, idle: 500 }), cpuTimes({ busy: 1_100, idle: 3_100 })];
    const settled = sampler.sample({
      sampledAtMonotonicMs: 3_000,
      platform: "linux",
    });
    expect(settled.cpu).toMatchObject({
      status: "available",
      utilizationPercent: 50,
      logicalProcessorCount: 2,
    });
  });

  it("discards an old CPU baseline when the first new-topology sample is malformed", () => {
    let cpu: ReadonlyArray<CpuTimes> = [cpuTimes({ busy: 100, idle: 300 })];
    const sampler = makeHostSystemTelemetrySampler(makeRuntime({ readCpuTimes: () => cpu }));

    sampler.sample({ sampledAtMonotonicMs: 1_000, platform: "linux" });
    cpu = [
      cpuTimes({ busy: 200, idle: 400 }),
      { ...cpuTimes({ busy: 1_000, idle: 3_000 }), user: Number.NaN },
    ];
    const malformed = sampler.sample({
      sampledAtMonotonicMs: 2_000,
      platform: "linux",
    });
    expect(malformed.cpu).toMatchObject({
      status: "unavailable",
      logicalProcessorCount: 2,
    });

    cpu = [cpuTimes({ busy: 300, idle: 500 }), cpuTimes({ busy: 1_100, idle: 3_100 })];
    const newBaseline = sampler.sample({
      sampledAtMonotonicMs: 3_000,
      platform: "linux",
    });
    expect(newBaseline.cpu).toMatchObject({
      status: "warming",
      utilizationPercent: null,
      logicalProcessorCount: 2,
    });
  });

  it("fails aggregate CPU counter overflow closed", () => {
    const nearLimit = Math.floor(Number.MAX_SAFE_INTEGER / 2);
    const sampler = makeHostSystemTelemetrySampler(
      makeRuntime({
        readCpuTimes: () => [
          cpuTimes({ busy: nearLimit, idle: nearLimit }),
          cpuTimes({ busy: nearLimit, idle: nearLimit }),
        ],
      }),
    );

    expect(sampler.sample({ sampledAtMonotonicMs: 1_000, platform: "linux" }).cpu).toEqual({
      status: "unavailable",
      utilizationPercent: null,
      logicalProcessorCount: 2,
      detail: "CPU telemetry is unavailable.",
    });
  });

  it("fails host counter exceptions closed without fabricating zeroes", () => {
    const sampler = makeHostSystemTelemetrySampler({
      readCpuTimes: () => {
        throw new Error("private CPU detail");
      },
      readMemory: () => {
        throw new Error("private memory detail");
      },
    });

    const result = sampler.sample({
      sampledAtMonotonicMs: 1_000,
      platform: "darwin",
    });
    expect(result.cpu).toEqual({
      status: "unavailable",
      utilizationPercent: null,
      logicalProcessorCount: 0,
      detail: "CPU telemetry is unavailable.",
    });
    expect(result.memory).toEqual({
      status: "unavailable",
      totalBytes: null,
      usedBytes: null,
      availableBytes: null,
      utilizationPercent: null,
      detail: "Memory telemetry is unavailable.",
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("preserves a healthy CPU baseline across a transient read failure", () => {
    let cpu = [cpuTimes({ busy: 100, idle: 300 })];
    let failCpuRead = false;
    const sampler = makeHostSystemTelemetrySampler(
      makeRuntime({
        readCpuTimes: () => {
          if (failCpuRead) {
            throw new Error("transient private CPU detail");
          }
          return cpu;
        },
      }),
    );

    sampler.sample({ sampledAtMonotonicMs: 1_000, platform: "linux" });
    cpu = [cpuTimes({ busy: 200, idle: 400 })];
    expect(sampler.sample({ sampledAtMonotonicMs: 2_000, platform: "linux" }).cpu.status).toBe(
      "available",
    );

    failCpuRead = true;
    expect(sampler.sample({ sampledAtMonotonicMs: 3_000, platform: "linux" }).cpu).toEqual({
      status: "unavailable",
      utilizationPercent: null,
      logicalProcessorCount: 1,
      detail: "CPU telemetry is unavailable.",
    });

    failCpuRead = false;
    cpu = [cpuTimes({ busy: 300, idle: 500 })];
    expect(sampler.sample({ sampledAtMonotonicMs: 4_000, platform: "linux" }).cpu).toMatchObject({
      status: "available",
      utilizationPercent: 50,
      logicalProcessorCount: 1,
    });
  });
});
