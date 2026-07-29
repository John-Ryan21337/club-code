import { describe, expect, it } from "vitest";

import {
  makeHostNetworkTelemetrySampler,
  unavailableNetworkTelemetry,
  type HostNetworkCounters,
} from "./HostNetworkTelemetry.ts";

describe("HostNetworkTelemetry", () => {
  it("warms once, then derives aggregate receive and transmit rates", async () => {
    let now = 1_000;
    const counters: HostNetworkCounters[] = [
      { receivedBytes: 1_000, transmittedBytes: 2_000 },
      { receivedBytes: 4_000, transmittedBytes: 3_500 },
    ];
    const sampler = makeHostNetworkTelemetrySampler(
      {
        read: async () => counters.shift() ?? null,
      },
      { nowMonotonicMillis: () => now },
    );

    await expect(sampler.sample()).resolves.toMatchObject({
      status: "warming",
    });
    now = 16_000;
    await expect(sampler.sample()).resolves.toEqual({
      status: "available",
      receiveBytesPerSecond: 200,
      transmitBytesPerSecond: 100,
      detail: null,
    });
  });

  it("coalesces concurrent callers and caches a host sample for fifteen seconds", async () => {
    let now = 1_000;
    let resolveRead!: (value: HostNetworkCounters) => void;
    let calls = 0;
    const sampler = makeHostNetworkTelemetrySampler(
      {
        read: () => {
          calls += 1;
          return new Promise((resolve) => {
            resolveRead = resolve;
          });
        },
      },
      { nowMonotonicMillis: () => now },
    );

    const first = sampler.sample();
    now = 1_500;
    const second = sampler.sample();
    await Promise.resolve();
    resolveRead({ receivedBytes: 100, transmittedBytes: 200 });
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: "warming" }),
      expect.objectContaining({ status: "warming" }),
    ]);
    now = 15_999;
    await sampler.sample();
    expect(calls).toBe(1);
  });

  it("fails closed and resets its baseline after invalid or decreasing counters", async () => {
    let now = 1_000;
    const counters: Array<HostNetworkCounters | null> = [
      { receivedBytes: 1_000, transmittedBytes: 1_000 },
      { receivedBytes: 900, transmittedBytes: 1_100 },
      null,
      { receivedBytes: 2_000, transmittedBytes: 2_000 },
    ];
    const sampler = makeHostNetworkTelemetrySampler(
      {
        read: async () => counters.shift() ?? null,
      },
      { nowMonotonicMillis: () => now },
    );

    await sampler.sample();
    now = 16_000;
    await expect(sampler.sample()).resolves.toMatchObject({
      status: "warming",
    });
    now = 31_000;
    await expect(sampler.sample()).resolves.toEqual(unavailableNetworkTelemetry());
    now = 46_000;
    await expect(sampler.sample()).resolves.toMatchObject({
      status: "warming",
    });
  });

  it("never transports raw counters or interface identity", async () => {
    const sampler = makeHostNetworkTelemetrySampler(
      {
        read: async () => ({ receivedBytes: 10_000, transmittedBytes: 20_000 }),
      },
      { nowMonotonicMillis: () => 1_000 },
    );
    const result = await sampler.sample();
    const encoded = JSON.stringify(result);

    expect(encoded).not.toContain("10000");
    expect(encoded).not.toContain("20000");
    expect(encoded).not.toContain("interface");
    expect(encoded).not.toContain("address");
  });

  it("uses counter observation completion times rather than variable probe start times", async () => {
    let now = 0;
    let readIndex = 0;
    const sampler = makeHostNetworkTelemetrySampler(
      {
        read: async () => {
          readIndex += 1;
          if (readIndex === 1) {
            now = 800;
            return { receivedBytes: 1_000, transmittedBytes: 2_000 };
          }
          now = 16_300;
          return { receivedBytes: 32_000, transmittedBytes: 17_500 };
        },
      },
      { nowMonotonicMillis: () => now },
    );

    await expect(sampler.sample()).resolves.toMatchObject({ status: "warming" });
    now = 16_000;
    await expect(sampler.sample()).resolves.toEqual({
      status: "available",
      receiveBytesPerSecond: 2_000,
      transmitBytesPerSecond: 1_000,
      detail: null,
    });
  });
});
