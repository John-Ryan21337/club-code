import { ServerSystemGpuTelemetry } from "@cafecode/contracts";
import * as Schema from "effect/Schema";

const validGpuTelemetry = Schema.is(ServerSystemGpuTelemetry);
export interface GpuAdapterHistoryPoint {
  readonly key: string;
  readonly utilizationPercent: number;
  readonly memoryUtilizationPercent: number | null;
  readonly temperatureCelsius: number | null;
}
export interface GpuAdapterReading extends GpuAdapterHistoryPoint {
  readonly index: number;
  readonly name: string;
  readonly memoryAvailableBytes: number | null;
}

/** Keep the source index as identity so missing/reordered entries cannot shift histories. */
export function projectGpuAdapterDetails(
  telemetry: ServerSystemGpuTelemetry | undefined,
): readonly GpuAdapterReading[] {
  if (!validGpuTelemetry(telemetry) || telemetry.status !== "available") return [];
  const seen = new Set<number>();
  const projected: GpuAdapterReading[] = [];
  for (const adapter of telemetry.adapters) {
    if (seen.has(adapter.index)) return [];
    seen.add(adapter.index);
    const validMemory =
      adapter.memoryTotalBytes > 0 && adapter.memoryUsedBytes <= adapter.memoryTotalBytes;
    projected.push({
      key: `gpu-${adapter.index}`,
      index: adapter.index,
      name: adapter.name,
      utilizationPercent: adapter.utilizationPercent,
      memoryUtilizationPercent: validMemory ? adapter.memoryUtilizationPercent : null,
      memoryAvailableBytes: validMemory ? adapter.memoryTotalBytes - adapter.memoryUsedBytes : null,
      temperatureCelsius: adapter.temperatureCelsius ?? null,
    });
  }
  return projected.sort((left, right) => left.index - right.index);
}

export function gpuAdapterHistory(
  history: readonly { readonly gpuAdapters: readonly GpuAdapterHistoryPoint[] }[],
  key: string,
  metric: "utilizationPercent" | "memoryUtilizationPercent" | "temperatureCelsius",
): readonly (number | null)[] {
  return history.map(
    (point) => point.gpuAdapters.find((adapter) => adapter.key === key)?.[metric] ?? null,
  );
}
