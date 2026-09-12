import type {
  ServerSystemGpuTelemetry,
  ServerSystemGpuAdapterTelemetry,
} from "@cafecode/contracts";
import { describe, expect, it } from "vitest";
import { gpuAdapterHistory, projectGpuAdapterDetails } from "./ProjectGpuAdapterHistory.model";

const adapter = (index: number, utilizationPercent = 50) => ({
  index,
  name: `Adapter ${index}`,
  utilizationPercent,
  memoryTotalBytes: 8192,
  memoryUsedBytes: 2048,
  memoryUtilizationPercent: 25,
  temperatureCelsius: 60,
});
const telemetry = (
  adapters: readonly ServerSystemGpuAdapterTelemetry[] = [adapter(0)],
): ServerSystemGpuTelemetry => ({ status: "available", reason: null, detail: null, adapters });

describe("per-GPU adapter histories", () => {
  it("sorts by source index and keeps each adapter's independent measurements", () => {
    expect(projectGpuAdapterDetails(telemetry([adapter(7, 70), adapter(2, 20)]))).toMatchObject([
      {
        key: "gpu-2",
        index: 2,
        utilizationPercent: 20,
        memoryAvailableBytes: 6144,
        temperatureCelsius: 60,
      },
      { key: "gpu-7", index: 7, utilizationPercent: 70 },
    ]);
  });

  it("retains a gap when an adapter disappears and returns in a different order", () => {
    const history = [
      { gpuAdapters: projectGpuAdapterDetails(telemetry([adapter(2, 20), adapter(7, 70)])) },
      { gpuAdapters: projectGpuAdapterDetails(telemetry([adapter(7, 80)])) },
      { gpuAdapters: projectGpuAdapterDetails(telemetry([adapter(7, 90), adapter(2, 30)])) },
    ];
    expect(gpuAdapterHistory(history, "gpu-2", "utilizationPercent")).toEqual([20, null, 30]);
    expect(gpuAdapterHistory(history, "gpu-7", "utilizationPercent")).toEqual([70, 80, 90]);
  });

  it("rejects duplicate indexes, unsafe names, oversized lists and missing snapshots", () => {
    expect(projectGpuAdapterDetails(telemetry([adapter(0), adapter(0)]))).toEqual([]);
    expect(
      projectGpuAdapterDetails(telemetry([{ ...adapter(0), name: "GPU\u0000hidden" }])),
    ).toEqual([]);
    expect(
      projectGpuAdapterDetails(telemetry(Array.from({ length: 65 }, (_, i) => adapter(i)))),
    ).toEqual([]);
    expect(projectGpuAdapterDetails(undefined)).toEqual([]);
  });

  it("retains utilization when VRAM is inconsistent and missing temperature remains null", () => {
    const { temperatureCelsius: _temperature, ...withoutTemperature } = adapter(0, 0);
    const result = projectGpuAdapterDetails(
      telemetry([{ ...withoutTemperature, memoryUsedBytes: 9000 }]),
    );
    expect(result[0]).toMatchObject({
      utilizationPercent: 0,
      memoryUtilizationPercent: null,
      memoryAvailableBytes: null,
      temperatureCelsius: null,
    });
  });
});
