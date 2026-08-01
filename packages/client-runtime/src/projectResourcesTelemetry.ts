import { type ProjectId, ServerProjectSystemTelemetryResult } from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

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
  ) => Promise<unknown>;
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

const decodeTelemetry = Schema.decodeUnknownSync(ServerProjectSystemTelemetryResult);

export class ProjectResourcesTelemetryValidationError extends Error {
  override readonly name = "ProjectResourcesTelemetryValidationError";
}

function validPercent(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function validatedMetric(metric: {
  readonly status: "available" | "warming" | "unavailable";
  readonly utilizationPercent: number | null;
}): ProjectResourcesMetric {
  return {
    status: metric.status,
    utilizationPercent:
      metric.status === "available" && validPercent(metric.utilizationPercent)
        ? metric.utilizationPercent
        : null,
    // Provider/platform details are deliberately not crossed into the renderer model.
    detail: null,
  };
}

export function projectResourcesTelemetryFrame(input: unknown): ProjectResourcesTelemetryFrame {
  let telemetry: typeof ServerProjectSystemTelemetryResult.Type;
  try {
    telemetry = decodeTelemetry(input, { onExcessProperty: "error" });
  } catch {
    throw new ProjectResourcesTelemetryValidationError();
  }
  const sampledAtMs = DateTime.toEpochMillis(telemetry.sampledAt);
  if (
    !Number.isSafeInteger(sampledAtMs) ||
    sampledAtMs < 0 ||
    !Number.isSafeInteger(telemetry.minimumSampleIntervalMs) ||
    telemetry.minimumSampleIntervalMs < 1
  ) {
    throw new ProjectResourcesTelemetryValidationError();
  }
  return {
    projectId: telemetry.projectId,
    sampledAtMs,
    minimumSampleIntervalMs: telemetry.minimumSampleIntervalMs,
    cpu: validatedMetric(telemetry.cpu),
    memory: validatedMetric(telemetry.memory),
  };
}

export function projectResourcesHistoryPoint(
  frame: ProjectResourcesTelemetryFrame,
): ProjectResourcesTelemetryHistoryPoint {
  return {
    sampledAtMs: frame.sampledAtMs,
    cpuPercent:
      frame.cpu.status === "available" && validPercent(frame.cpu.utilizationPercent)
        ? frame.cpu.utilizationPercent
        : null,
    memoryPercent:
      frame.memory.status === "available" && validPercent(frame.memory.utilizationPercent)
        ? frame.memory.utilizationPercent
        : null,
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
  if (!Number.isSafeInteger(point.sampledAtMs) || point.sampledAtMs < 0) {
    throw new ProjectResourcesTelemetryValidationError();
  }
  const normalizedPoint = {
    sampledAtMs: point.sampledAtMs,
    cpuPercent: validPercent(point.cpuPercent) ? point.cpuPercent : null,
    memoryPercent: validPercent(point.memoryPercent) ? point.memoryPercent : null,
  };
  const safeHistory = history
    .slice(Math.max(0, history.length - boundedLimit + 1))
    .filter((entry) => Number.isSafeInteger(entry.sampledAtMs) && entry.sampledAtMs >= 0)
    .map(
      (entry): ProjectResourcesTelemetryHistoryPoint => ({
        sampledAtMs: entry.sampledAtMs,
        cpuPercent: validPercent(entry.cpuPercent) ? entry.cpuPercent : null,
        memoryPercent: validPercent(entry.memoryPercent) ? entry.memoryPercent : null,
      }),
    );
  const last = safeHistory.at(-1);
  if (
    last?.cpuPercent === null &&
    last.memoryPercent === null &&
    normalizedPoint.cpuPercent === null &&
    normalizedPoint.memoryPercent === null
  ) {
    return [...safeHistory.slice(0, -1), normalizedPoint];
  }
  return [...safeHistory, normalizedPoint];
}
