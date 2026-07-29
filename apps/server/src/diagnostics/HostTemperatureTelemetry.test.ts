import { describe, expect, it } from "vitest";

import {
  HOST_TEMPERATURE_MINIMUM_SAMPLE_INTERVAL_MS,
  makeHostTemperatureTelemetrySampler,
} from "./HostTemperatureTelemetry.ts";
import { unavailableTemperatureTelemetry } from "./TemperatureTelemetry.ts";

const available = {
  version: 1 as const,
  status: "available" as const,
  sensors: [
    {
      kind: "cpu" as const,
      label: "CPU Package",
      temperatureCelsius: 55,
      source: "libre-hardware-monitor" as const,
    },
  ],
  reason: null,
  detail: null,
};

describe("HostTemperatureTelemetry", () => {
  it("shares an in-flight probe and caches it beyond one-second UI polling", async () => {
    let now = 0;
    let calls = 0;
    let resolveRead!: (value: typeof available) => void;
    const sampler = makeHostTemperatureTelemetrySampler(
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
    const second = sampler.sample();
    expect(calls).toBe(0);
    await Promise.resolve();
    expect(calls).toBe(1);
    resolveRead(available);
    await expect(first).resolves.toEqual(available);
    await expect(second).resolves.toEqual(available);

    now = HOST_TEMPERATURE_MINIMUM_SAMPLE_INTERVAL_MS - 1;
    await expect(sampler.sample()).resolves.toEqual(available);
    expect(calls).toBe(1);
  });

  it("replaces disappeared sensors after cache expiry and fails stale on clock rollback", async () => {
    let now = 10_000;
    const reads = [available, unavailableTemperatureTelemetry("unsupported")];
    const sampler = makeHostTemperatureTelemetrySampler(
      { read: async () => reads.shift() ?? unavailableTemperatureTelemetry("unsupported") },
      { nowMonotonicMillis: () => now },
    );
    await expect(sampler.sample()).resolves.toEqual(available);
    now += HOST_TEMPERATURE_MINIMUM_SAMPLE_INTERVAL_MS;
    await expect(sampler.sample()).resolves.toEqual(unavailableTemperatureTelemetry("unsupported"));
    now = 1;
    await expect(sampler.sample()).resolves.toEqual(unavailableTemperatureTelemetry("stale"));
  });
});
