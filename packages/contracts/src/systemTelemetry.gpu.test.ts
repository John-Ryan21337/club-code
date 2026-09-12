import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { MAX_GPU_ADAPTERS, ServerSystemGpuTelemetry } from "./systemTelemetry.ts";

const decode = Schema.decodeUnknownSync(ServerSystemGpuTelemetry);
const adapter = {
  index: 0,
  name: "NVIDIA Test GPU",
  utilizationPercent: 25,
  memoryTotalBytes: 8_192,
  memoryUsedBytes: 2_048,
  memoryUtilizationPercent: 25,
};
const available = { status: "available", adapters: [adapter], reason: null, detail: null };

describe("GPU telemetry transport bounds", () => {
  it("preserves real measurements and optional temperatures", () => {
    expect(decode(available)).toEqual(available);
    const measured = { ...available, adapters: [{ ...adapter, temperatureCelsius: 62.5 }] };
    expect(decode(measured)).toEqual(measured);
  });

  it.each([
    { name: "GPU\u202Ehidden" },
    { name: "GPU\u0000hidden" },
    { name: "x".repeat(201) },
    { index: 4_096 },
    { utilizationPercent: Number.NaN },
    { utilizationPercent: 101 },
    { memoryTotalBytes: 1e300 },
    { memoryUsedBytes: -1 },
    { temperatureCelsius: Number.POSITIVE_INFINITY },
    { temperatureCelsius: 251 },
  ])("rejects unbounded or unsafe adapter fields: %j", (fields) => {
    expect(() => decode({ ...available, adapters: [{ ...adapter, ...fields }] })).toThrow();
  });

  it("bounds adapter counts and prevents measurements on an unavailable result", () => {
    expect(() => decode({ ...available, adapters: [] })).toThrow();
    expect(() =>
      decode({
        ...available,
        adapters: Array.from({ length: MAX_GPU_ADAPTERS + 1 }, () => adapter),
      }),
    ).toThrow();
    const unavailable = {
      status: "unavailable",
      adapters: [],
      reason: "unsupported",
      detail: "No supported source.",
    };
    expect(decode(unavailable)).toEqual(unavailable);
    expect(() => decode({ ...unavailable, adapters: [adapter] })).toThrow();
    expect(() => decode({ ...unavailable, detail: "x".repeat(161) })).toThrow();
  });
});
