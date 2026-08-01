import { type ProjectId, type ServerProjectSystemTelemetryResult } from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";

export const PROJECT_RESOURCES_HISTORY_LIMIT = 48;
export const PROJECT_RESOURCES_HISTORY_MAX = 120;

export interface ProjectResourcesTelemetryReadRequest {
  readonly projectId: ProjectId;
  /** Implementations must stop the underlying read when this signal aborts. */
  readonly signal: AbortSignal;
}

/** Narrow client seam for a separately reviewed, project-authorized transport. */
export interface ProjectResourcesTelemetryClient {
  readonly readProjectResources: (
    request: ProjectResourcesTelemetryReadRequest,
  ) => Promise<ServerProjectSystemTelemetryResult>;
}

export interface ProjectResourcesMetric {
  readonly status: "available" | "warming" | "unavailable";
  readonly utilizationPercent: number | null;
  readonly detail: string | null;
}

export interface ProjectResourcesTelemetryFrame {
  readonly projectId: ProjectId;
  readonly sampledAtMs: number;
  readonly minimumSampleIntervalMs: number;
  readonly cpu: ProjectResourcesMetric;
  readonly memory: ProjectResourcesMetric;
}

export interface ProjectResourcesTelemetryHistoryPoint {
  readonly sampledAtMs: number;
  readonly cpuPercent: number | null;
  readonly memoryPercent: number | null;
}

export function projectResourcesTelemetryFrame(
  telemetry: ServerProjectSystemTelemetryResult,
): ProjectResourcesTelemetryFrame {
  return {
    projectId: telemetry.projectId,
    sampledAtMs: DateTime.toEpochMillis(telemetry.sampledAt),
    minimumSampleIntervalMs: telemetry.minimumSampleIntervalMs,
    cpu: {
      status: telemetry.cpu.status,
      utilizationPercent:
        telemetry.cpu.status === "available" ? telemetry.cpu.utilizationPercent : null,
      detail: telemetry.cpu.detail,
    },
    memory: {
      status: telemetry.memory.status,
      utilizationPercent:
        telemetry.memory.status === "available" ? telemetry.memory.utilizationPercent : null,
      detail: telemetry.memory.detail,
    },
  };
}

export function projectResourcesHistoryPoint(
  frame: ProjectResourcesTelemetryFrame,
): ProjectResourcesTelemetryHistoryPoint {
  return {
    sampledAtMs: frame.sampledAtMs,
    cpuPercent: frame.cpu.status === "available" ? frame.cpu.utilizationPercent : null,
    memoryPercent: frame.memory.status === "available" ? frame.memory.utilizationPercent : null,
  };
}

export function projectResourcesGapPoint(
  sampledAtMs: number,
): ProjectResourcesTelemetryHistoryPoint {
  return { sampledAtMs, cpuPercent: null, memoryPercent: null };
}

export function appendProjectResourcesHistory(
  history: readonly ProjectResourcesTelemetryHistoryPoint[],
  point: ProjectResourcesTelemetryHistoryPoint,
  limit = PROJECT_RESOURCES_HISTORY_LIMIT,
): readonly ProjectResourcesTelemetryHistoryPoint[] {
  const boundedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(PROJECT_RESOURCES_HISTORY_MAX, Math.trunc(limit)))
    : PROJECT_RESOURCES_HISTORY_LIMIT;
  return [...history.slice(Math.max(0, history.length - boundedLimit + 1)), point];
}
