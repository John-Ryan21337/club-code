import { ProjectId, type ServerProjectSystemTelemetryResult } from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vitest";

import {
  appendProjectResourcesHistory,
  projectResourcesGapPoint,
  projectResourcesHistoryPoint,
  projectResourcesTelemetryFrame,
  ProjectResourcesTelemetryValidationError,
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
    expect(frame.cpu.detail).toBeNull();
    expect(frame.memory.detail).toBeNull();
  });

  it("rejects malformed, encoded, non-finite, and contradictory client results", () => {
    const telemetry = telemetryFixture();
    expect(() =>
      projectResourcesTelemetryFrame({
        ...telemetry,
        sampledAt: "2026-08-01T12:00:00.000Z",
      }),
    ).toThrow(ProjectResourcesTelemetryValidationError);
    expect(() =>
      projectResourcesTelemetryFrame({
        ...telemetry,
        cpu: { ...telemetry.cpu, utilizationPercent: Number.NaN },
      }),
    ).toThrow(ProjectResourcesTelemetryValidationError);
    expect(() =>
      projectResourcesTelemetryFrame({
        ...telemetry,
        memory: { ...telemetry.memory, utilizationPercent: 101 },
      }),
    ).toThrow(ProjectResourcesTelemetryValidationError);
    expect(() =>
      projectResourcesTelemetryFrame({
        ...telemetry,
        extraTransportField: "not decoded",
      }),
    ).toThrow(ProjectResourcesTelemetryValidationError);
    expect(() =>
      projectResourcesTelemetryFrame({
        ...telemetry,
        sampledAt: DateTime.makeUnsafe("1969-12-31T23:59:59.999Z"),
      }),
    ).toThrow(ProjectResourcesTelemetryValidationError);
    expect(() =>
      projectResourcesTelemetryFrame({
        ...telemetry,
        minimumSampleIntervalMs: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(ProjectResourcesTelemetryValidationError);

    expect(
      projectResourcesHistoryPoint({
        ...projectResourcesTelemetryFrame(telemetry),
        cpu: { status: "available", utilizationPercent: Number.NaN, detail: null },
      }).cpuPercent,
    ).toBeNull();
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

  it("normalizes hostile history values, copies inputs, and coalesces outage gaps", () => {
    const mutable = [
      { sampledAtMs: 1, cpuPercent: 25, memoryPercent: 50 },
      { sampledAtMs: 2, cpuPercent: null, memoryPercent: null },
    ];
    const history = appendProjectResourcesHistory(
      mutable,
      { sampledAtMs: 3, cpuPercent: -1, memoryPercent: 101 },
      Number.POSITIVE_INFINITY,
    );
    mutable[0]!.cpuPercent = 99;
    expect(history).toEqual([
      { sampledAtMs: 1, cpuPercent: 25, memoryPercent: 50 },
      { sampledAtMs: 3, cpuPercent: null, memoryPercent: null },
    ]);
    expect(() =>
      appendProjectResourcesHistory(history, {
        sampledAtMs: Number.NaN,
        cpuPercent: 50,
        memoryPercent: 50,
      }),
    ).toThrow(ProjectResourcesTelemetryValidationError);
  });
});
