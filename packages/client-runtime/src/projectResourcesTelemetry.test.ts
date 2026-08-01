import { ProjectId, type ServerProjectSystemTelemetryResult } from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vitest";

import {
  appendProjectResourcesHistory,
  projectResourcesGapPoint,
  projectResourcesHistoryPoint,
  projectResourcesTelemetryFrame,
  type ProjectResourcesTelemetryHistoryPoint,
} from "./projectResourcesTelemetry.ts";

function telemetryFixture(): ServerProjectSystemTelemetryResult {
  return {
    projectId: ProjectId.make("project-resources-client"),
    sampledAt: DateTime.makeUnsafe("2026-08-01T12:00:00.000Z"),
    minimumSampleIntervalMs: 1_000,
    platform: "linux",
    architecture: "x64",
    cpu: {
      status: "available",
      utilizationPercent: 0,
      logicalProcessorCount: 8,
      detail: null,
    },
    memory: {
      status: "available",
      totalBytes: 8_000,
      usedBytes: 0,
      availableBytes: 8_000,
      utilizationPercent: 0,
      detail: null,
    },
    projectVolume: {
      status: "unavailable",
      totalBytes: null,
      usedBytes: null,
      availableBytes: null,
      utilizationPercent: null,
      projectVolumeOnly: true,
      detail: "Project-volume telemetry is unavailable.",
    },
  };
}

describe("project resources telemetry client model", () => {
  it("preserves measured zero utilization as available data", () => {
    const frame = projectResourcesTelemetryFrame(telemetryFixture());

    expect(frame.cpu).toMatchObject({ status: "available", utilizationPercent: 0 });
    expect(frame.memory).toMatchObject({ status: "available", utilizationPercent: 0 });
    expect(projectResourcesHistoryPoint(frame)).toMatchObject({
      cpuPercent: 0,
      memoryPercent: 0,
    });
  });

  it("maps warming and unavailable measurements to gaps rather than zeroes", () => {
    const telemetry = telemetryFixture();
    const frame = projectResourcesTelemetryFrame({
      ...telemetry,
      cpu: {
        status: "warming",
        utilizationPercent: null,
        logicalProcessorCount: 8,
        detail: "Collecting a CPU baseline.",
      },
      memory: {
        status: "unavailable",
        totalBytes: null,
        usedBytes: null,
        availableBytes: null,
        utilizationPercent: null,
        detail: "Memory telemetry is unavailable.",
      },
    });

    expect(projectResourcesHistoryPoint(frame)).toMatchObject({
      cpuPercent: null,
      memoryPercent: null,
    });
  });

  it("bounds history and keeps explicit outage gaps", () => {
    let history: readonly ProjectResourcesTelemetryHistoryPoint[] = [projectResourcesGapPoint(0)];
    for (let sampledAtMs = 1; sampledAtMs <= 8; sampledAtMs += 1) {
      history = appendProjectResourcesHistory(
        history,
        { sampledAtMs, cpuPercent: sampledAtMs, memoryPercent: sampledAtMs },
        4,
      );
    }

    expect(history.map((point) => point.sampledAtMs)).toEqual([5, 6, 7, 8]);
    expect(appendProjectResourcesHistory(history, projectResourcesGapPoint(9), 4)).toEqual([
      history[1],
      history[2],
      history[3],
      { sampledAtMs: 9, cpuPercent: null, memoryPercent: null },
    ]);
  });
});
