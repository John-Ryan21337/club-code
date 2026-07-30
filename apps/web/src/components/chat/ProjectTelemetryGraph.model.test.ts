import { ProjectId, type ServerProjectSystemTelemetryResult } from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vitest";

import {
  appendBoundedTelemetryHistory,
  buildTelemetrySparklinePath,
  deriveProjectTelemetryStrokePalette,
  formatTelemetryBytes,
  normalizeTelemetryRateHistory,
  normalizeTemperatureHistory,
  PROJECT_TELEMETRY_METRIC_KEYS,
  projectTelemetryGpuAdapter,
  projectTelemetryTemperatureAdapter,
  toProjectTelemetryHistoryPoint,
  type ProjectTelemetryHistoryPoint,
} from "./ProjectTelemetryGraph.model";

function telemetryFixture(): ServerProjectSystemTelemetryResult {
  return {
    projectId: ProjectId.make("project-telemetry-graph"),
    sampledAt: DateTime.makeUnsafe("2026-07-26T12:00:00.000Z"),
    minimumSampleIntervalMs: 1_000,
    platform: "linux",
    architecture: "arm64",
    cpu: {
      status: "available",
      utilizationPercent: 42,
      logicalProcessorCount: 8,
      detail: null,
    },
    memory: {
      status: "available",
      totalBytes: 8_000,
      usedBytes: 6_000,
      availableBytes: 2_000,
      utilizationPercent: 75,
      detail: null,
    },
    network: {
      status: "available",
      receiveBytesPerSecond: 1_024,
      transmitBytesPerSecond: 512,
      detail: null,
    },
    gpu: {
      status: "unavailable",
      adapters: [],
      reason: "unsupported",
      detail: "GPU telemetry is unavailable.",
    },
    projectVolume: {
      status: "available",
      totalBytes: 10_000,
      usedBytes: 6_500,
      availableBytes: 3_500,
      utilizationPercent: 65,
      projectVolumeOnly: true,
      detail: null,
    },
  };
}

function telemetryWithGpu(gpu: unknown): ServerProjectSystemTelemetryResult {
  return { ...telemetryFixture(), gpu } as ServerProjectSystemTelemetryResult;
}

function gpuAdapter(overrides: Record<string, unknown> = {}) {
  return {
    index: 0,
    name: "GPU 0",
    utilizationPercent: 50,
    memoryTotalBytes: 8_000,
    memoryUsedBytes: 2_000,
    memoryUtilizationPercent: 25,
    ...overrides,
  };
}

function historyPoint(sampledAtMs: number): ProjectTelemetryHistoryPoint {
  return {
    sampledAtMs,
    cpuPercent: sampledAtMs,
    memoryPercent: sampledAtMs,
    projectVolumePercent: sampledAtMs,
    networkReceiveBytesPerSecond: sampledAtMs,
    networkTransmitBytesPerSecond: sampledAtMs,
    gpuAdapters: [],
    gpuPercent: null,
    vramPercent: null,
    temperatureCpuCelsius: null,
    temperatureGpuCelsius: null,
    temperatureMemoryCelsius: null,
    temperatureVramCelsius: null,
    temperatureStorageCelsius: null,
    temperatureAmbientCelsius: null,
    temperatureOtherCelsius: null,
  };
}

describe("ProjectTelemetryGraph model", () => {
  it("derives distinct monitor strokes from a fixed Matrix color", () => {
    const palette = deriveProjectTelemetryStrokePalette({
      color: "#4ade80",
      perStream: false,
      baseHue: null,
      saturation: null,
      lightness: null,
    });

    expect(Object.keys(palette)).toEqual(PROJECT_TELEMETRY_METRIC_KEYS);
    expect(new Set(Object.values(palette)).size).toBe(PROJECT_TELEMETRY_METRIC_KEYS.length);
    expect(Object.values(palette).every((color) => color.startsWith("hsl("))).toBe(true);
    expect(palette.cpu).toMatch(/^hsl\(141\./);
  });

  it("moves every metric stroke with the current Matrix shimmer frame", () => {
    const first = deriveProjectTelemetryStrokePalette({
      color: "hsl(40.0 88.0% 62.0%)",
      perStream: true,
      baseHue: 40,
      saturation: 88,
      lightness: 62,
    });
    const second = deriveProjectTelemetryStrokePalette({
      color: "hsl(95.0 88.0% 62.0%)",
      perStream: true,
      baseHue: 95,
      saturation: 88,
      lightness: 62,
    });

    for (const metric of PROJECT_TELEMETRY_METRIC_KEYS) {
      expect(second[metric]).not.toBe(first[metric]);
    }
    expect(new Set(Object.values(first)).size).toBe(PROJECT_TELEMETRY_METRIC_KEYS.length);
    expect(new Set(Object.values(second)).size).toBe(PROJECT_TELEMETRY_METRIC_KEYS.length);
  });

  it("keeps history bounded and ordered", () => {
    let history: readonly ProjectTelemetryHistoryPoint[] = [];
    for (let index = 0; index < 12; index += 1) {
      history = appendBoundedTelemetryHistory(history, historyPoint(index), 5);
    }
    expect(history.map((point) => point.sampledAtMs)).toEqual([7, 8, 9, 10, 11]);
    expect(appendBoundedTelemetryHistory(history, historyPoint(12), Number.NaN)).toEqual([
      historyPoint(12),
    ]);
    expect(
      appendBoundedTelemetryHistory(history, historyPoint(12), Number.POSITIVE_INFINITY),
    ).toHaveLength(6);
  });

  it("keeps unavailable samples as visible gaps instead of fabricated zeroes", () => {
    expect(buildTelemetrySparklinePath([10, null, 80])).toBe(
      "M 0.00 21.60 L 0.00 21.60M 100.00 4.80 L 100.00 4.80",
    );
    expect(buildTelemetrySparklinePath([])).toBe("");
    expect(buildTelemetrySparklinePath([50])).toBe("M 0.00 12.00 L 0.00 12.00");
    expect(buildTelemetrySparklinePath([-10, 110])).toBe("M 0.00 24.00 L 0.00 24.00 L 100.00 0.00");
  });

  it("formats project-volume bytes without changing their meaning", () => {
    expect(formatTelemetryBytes(0)).toBe("0 B");
    expect(formatTelemetryBytes(100)).toBe("100 B");
    expect(formatTelemetryBytes(1.5 * 1024)).toBe("1.5 KiB");
    expect(formatTelemetryBytes(3 * 1024 ** 3)).toBe("3 GiB");
    expect(formatTelemetryBytes(1024 ** 5)).toBe("1 PiB");
    expect(formatTelemetryBytes(-1)).toBe("Unavailable");
    expect(formatTelemetryBytes(0.5)).toBe("Unavailable");
    expect(formatTelemetryBytes(Number.NaN)).toBe("Unavailable");
    expect(formatTelemetryBytes(null)).toBe("Unavailable");
  });

  it("normalizes aggregate network throughput against only its bounded recent peak", () => {
    expect(normalizeTelemetryRateHistory([null, 0, 2_000, 1_000])).toEqual([null, 0, 100, 50]);
    expect(normalizeTelemetryRateHistory([0, 0])).toEqual([0, 0]);
    expect(normalizeTelemetryRateHistory([Number.NaN, -1])).toEqual([null, null]);
  });

  it("projects only measured temperature classes and keeps unsupported sensors unavailable", () => {
    const telemetry = {
      ...telemetryFixture(),
      temperatures: {
        version: 1,
        status: "available",
        sensors: [
          {
            kind: "gpu",
            label: "GPU 0",
            temperatureCelsius: 48,
            source: "nvidia-smi",
          },
          {
            kind: "gpu",
            label: "GPU 1",
            temperatureCelsius: 34,
            source: "nvidia-smi",
          },
          {
            kind: "storage",
            label: "NVMe Composite",
            temperatureCelsius: 42,
            source: "linux-hwmon",
          },
        ],
        hostSensorProbe: {
          status: "unavailable",
          reason: "provider-missing",
          detail: "transported detail must not be rendered",
        },
        reason: null,
        detail: null,
      },
    } as ServerProjectSystemTelemetryResult;
    const temperatures = projectTelemetryTemperatureAdapter(telemetry);
    const point = toProjectTelemetryHistoryPoint(
      telemetry,
      projectTelemetryGpuAdapter(telemetry),
      temperatures,
    );

    expect(temperatures.gpu).toMatchObject({ celsius: 48 });
    expect(temperatures.storage).toMatchObject({ celsius: 42 });
    expect(temperatures.memory.celsius).toBeNull();
    expect(temperatures.memory.detail).toContain("Libre Hardware Monitor");
    expect(temperatures.memory.detail).not.toContain("transported detail");
    expect(temperatures.vram.celsius).toBeNull();
    expect(temperatures.ambient.celsius).toBeNull();
    expect(point).toMatchObject({
      temperatureGpuCelsius: 48,
      temperatureStorageCelsius: 42,
      temperatureMemoryCelsius: null,
    });
    const providerWithoutSensors = projectTelemetryTemperatureAdapter({
      ...telemetry,
      temperatures: {
        ...telemetry.temperatures,
        hostSensorProbe: {
          status: "unavailable",
          reason: "no-temperature-sensors",
          detail:
            "A supported hardware monitor is available, but it did not expose any measured temperature sensors.",
        },
      },
    } as ServerProjectSystemTelemetryResult);
    expect(providerWithoutSensors.memory.detail).toContain(
      "did not expose any measured temperature sensors",
    );
    expect(normalizeTemperatureHistory([null, -20, 50, 120, 250])).toEqual([null, 0, 50, 100, 100]);
  });

  it("projects CPU, RAM, and project-volume utilization while GPU remains honest", () => {
    const telemetry = telemetryFixture();
    const gpu = projectTelemetryGpuAdapter(telemetry);
    const point = toProjectTelemetryHistoryPoint(telemetry, gpu);

    expect(point).toMatchObject({
      cpuPercent: 42,
      memoryPercent: 75,
      projectVolumePercent: 65,
      networkReceiveBytesPerSecond: 1_024,
      networkTransmitBytesPerSecond: 512,
      gpuPercent: null,
      vramPercent: null,
    });
    expect(gpu.gpuDetail).toContain("unavailable");
  });

  it("maps non-available host metrics to gaps", () => {
    const telemetry = {
      ...telemetryFixture(),
      cpu: {
        status: "warming",
        utilizationPercent: null,
        logicalProcessorCount: 8,
        detail: "Collecting a baseline.",
      },
      memory: {
        status: "unavailable",
        totalBytes: null,
        usedBytes: null,
        availableBytes: null,
        utilizationPercent: null,
        detail: "Memory unavailable.",
      },
      projectVolume: {
        status: "unavailable",
        totalBytes: null,
        usedBytes: null,
        availableBytes: null,
        utilizationPercent: null,
        projectVolumeOnly: true,
        detail: "Volume unavailable.",
      },
      network: {
        status: "unavailable",
        receiveBytesPerSecond: null,
        transmitBytesPerSecond: null,
        detail: "Network unavailable.",
      },
    } as ServerProjectSystemTelemetryResult;

    expect(
      toProjectTelemetryHistoryPoint(telemetry, projectTelemetryGpuAdapter(telemetry)),
    ).toMatchObject({
      cpuPercent: null,
      memoryPercent: null,
      projectVolumePercent: null,
      networkReceiveBytesPerSecond: null,
      networkTransmitBytesPerSecond: null,
      gpuPercent: null,
      vramPercent: null,
    });
  });

  it("accepts bounded GPU fields through the independent adapter seam", () => {
    const telemetry = {
      ...telemetryFixture(),
      gpu: {
        status: "available",
        detail: null,
        reason: null,
        adapters: [
          {
            index: 0,
            name: "GPU 0",
            utilizationPercent: 55,
            memoryTotalBytes: 8_000,
            memoryUsedBytes: 2_000,
            memoryUtilizationPercent: 25,
          },
          {
            index: 1,
            name: "GPU 1",
            utilizationPercent: 35,
            memoryTotalBytes: 4_000,
            memoryUsedBytes: 1_000,
            memoryUtilizationPercent: 25,
          },
        ],
      },
    } as ServerProjectSystemTelemetryResult;

    expect(projectTelemetryGpuAdapter(telemetry)).toMatchObject({
      adapters: [
        {
          key: "gpu-0",
          label: "GPU 1",
          index: 0,
          name: "GPU 0",
          utilizationPercent: 55,
          memoryUsedBytes: 2_000,
          memoryTotalBytes: 8_000,
          memoryAvailableBytes: 6_000,
          temperatureCelsius: null,
        },
        {
          key: "gpu-1",
          label: "GPU 2",
          index: 1,
          name: "GPU 1",
          utilizationPercent: 35,
          memoryUsedBytes: 1_000,
          memoryTotalBytes: 4_000,
          memoryAvailableBytes: 3_000,
          temperatureCelsius: null,
        },
      ],
      gpuPercent: 55,
      vramPercent: 25,
      vramUsedBytes: 3_000,
      vramAvailableBytes: 9_000,
    });
  });

  it("sorts, labels, and histories every GPU adapter by its stable source index", () => {
    const telemetry = telemetryWithGpu({
      status: "available",
      detail: null,
      adapters: [
        gpuAdapter({
          index: 1,
          name: "NVIDIA GeForce RTX 3090 B",
          utilizationPercent: 7,
          memoryTotalBytes: 24_000,
          memoryUsedBytes: 4_000,
          memoryUtilizationPercent: 100 / 6,
          temperatureCelsius: 34,
        }),
        gpuAdapter({
          index: 0,
          name: "NVIDIA GeForce RTX 3090 A",
          utilizationPercent: 24,
          memoryTotalBytes: 24_000,
          memoryUsedBytes: 6_000,
          memoryUtilizationPercent: 25,
          temperatureCelsius: 49,
        }),
      ],
    });

    const projection = projectTelemetryGpuAdapter(telemetry);
    expect(projection.adapters).toEqual([
      {
        key: "gpu-0",
        index: 0,
        label: "GPU 1",
        name: "NVIDIA GeForce RTX 3090 A",
        utilizationPercent: 24,
        memoryUtilizationPercent: 25,
        memoryTotalBytes: 24_000,
        memoryUsedBytes: 6_000,
        memoryAvailableBytes: 18_000,
        temperatureCelsius: 49,
      },
      {
        key: "gpu-1",
        index: 1,
        label: "GPU 2",
        name: "NVIDIA GeForce RTX 3090 B",
        utilizationPercent: 7,
        memoryUtilizationPercent: 100 / 6,
        memoryTotalBytes: 24_000,
        memoryUsedBytes: 4_000,
        memoryAvailableBytes: 20_000,
        temperatureCelsius: 34,
      },
    ]);
    expect(toProjectTelemetryHistoryPoint(telemetry, projection).gpuAdapters).toEqual([
      {
        key: "gpu-0",
        utilizationPercent: 24,
        memoryUtilizationPercent: 25,
        temperatureCelsius: 49,
      },
      {
        key: "gpu-1",
        utilizationPercent: 7,
        memoryUtilizationPercent: 100 / 6,
        temperatureCelsius: 34,
      },
    ]);
  });

  it.each([
    ["empty adapter list", { status: "available", detail: null, adapters: [] }],
    [
      "too many adapters",
      {
        status: "available",
        detail: null,
        adapters: Array.from({ length: 65 }, () => gpuAdapter()),
      },
    ],
    ["non-object adapter", { status: "available", detail: null, adapters: [null] }],
    [
      "unsafe adapter display name",
      {
        status: "available",
        detail: null,
        adapters: [gpuAdapter({ name: "RTX 3090\u202eexe" })],
      },
    ],
    [
      "duplicate adapter index",
      {
        status: "available",
        detail: null,
        adapters: [gpuAdapter(), gpuAdapter({ name: "Duplicate GPU" })],
      },
    ],
    [
      "invalid utilization",
      { status: "available", detail: null, adapters: [gpuAdapter({ utilizationPercent: 101 })] },
    ],
  ])("rejects malformed GPU data: %s", (_label, gpu) => {
    expect(projectTelemetryGpuAdapter(telemetryWithGpu(gpu)).gpuPercent).toBeNull();
  });

  it("preserves a backend unavailable detail", () => {
    expect(
      projectTelemetryGpuAdapter(
        telemetryWithGpu({ status: "unavailable", detail: "GPU driver unavailable." }),
      ),
    ).toMatchObject({
      gpuPercent: null,
      gpuDetail: "GPU driver unavailable.",
      vramPercent: null,
      vramDetail: "GPU driver unavailable.",
    });
  });

  it.each([
    ["zero total", [gpuAdapter({ memoryTotalBytes: 0, memoryUsedBytes: 0 })]],
    ["used exceeds total", [gpuAdapter({ memoryTotalBytes: 1, memoryUsedBytes: 2 })]],
    ["invalid memory percent", [gpuAdapter({ memoryUtilizationPercent: Number.NaN })]],
    [
      "aggregate overflow",
      [
        gpuAdapter({ memoryTotalBytes: Number.MAX_SAFE_INTEGER, memoryUsedBytes: 0 }),
        gpuAdapter({
          index: 1,
          name: "GPU 1",
          memoryTotalBytes: Number.MAX_SAFE_INTEGER,
          memoryUsedBytes: 0,
        }),
      ],
    ],
  ])("keeps GPU utilization but rejects invalid VRAM data: %s", (_label, adapters) => {
    const projection = projectTelemetryGpuAdapter(
      telemetryWithGpu({ status: "available", detail: "VRAM unavailable.", adapters }),
    );
    expect(projection).toMatchObject({
      gpuPercent: 50,
      vramPercent: null,
      vramUsedBytes: null,
      vramAvailableBytes: null,
      vramDetail: "VRAM unavailable.",
    });
  });
});
