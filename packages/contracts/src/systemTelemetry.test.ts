import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  MAX_GPU_ADAPTER_INDEX,
  MAX_GPU_ADAPTER_NAME_LENGTH,
  MAX_GPU_ADAPTERS,
  MAX_GPU_MEMORY_BYTES,
  MAX_HARDWARE_TEMPERATURE_CELSIUS,
  MAX_TEMPERATURE_SENSOR_LABEL_LENGTH,
  MAX_TEMPERATURE_SENSORS,
  MIN_HARDWARE_TEMPERATURE_CELSIUS,
  ServerProjectSystemTelemetryError,
  ServerProjectSystemTelemetryInput,
  ServerProjectSystemTelemetryResult,
} from "./systemTelemetry.ts";

const decodeProjectSystemTelemetry = Schema.decodeUnknownSync(ServerProjectSystemTelemetryResult);
const decodeProjectSystemTelemetryInput = Schema.decodeUnknownSync(
  ServerProjectSystemTelemetryInput,
);
const encodeProjectSystemTelemetryError = Schema.encodeSync(ServerProjectSystemTelemetryError);

function projectSystemTelemetryFixture() {
  return {
    projectId: "project-1",
    sampledAt: DateTime.makeUnsafe("2026-07-25T12:00:00.000Z"),
    minimumSampleIntervalMs: 1_000,
    platform: "linux",
    architecture: "arm64",
    cpu: {
      status: "available",
      utilizationPercent: 42,
      logicalProcessorCount: 4,
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
      receiveBytesPerSecond: 32_768,
      transmitBytesPerSecond: 8_192,
      detail: null,
    },
    gpu: {
      status: "available",
      adapters: [
        {
          index: 0,
          name: "NVIDIA GeForce RTX 4090",
          utilizationPercent: 15,
          memoryTotalBytes: 25_757_220_864,
          memoryUsedBytes: 3_589_128_192,
          memoryUtilizationPercent: 13.93,
        },
      ],
      reason: null,
      detail: null,
    },
    projectVolume: {
      status: "available",
      totalBytes: 10_000,
      usedBytes: 7_500,
      availableBytes: 2_500,
      utilizationPercent: 75,
      projectVolumeOnly: true,
      detail: null,
    },
  };
}

describe("ServerProjectSystemTelemetryResult", () => {
  it("keeps network telemetry aggregate, bounded, and identity-free", () => {
    const input = projectSystemTelemetryFixture();
    const parsed = decodeProjectSystemTelemetry(input);

    expect(parsed.network).toEqual(input.network);
    expect(JSON.stringify(parsed.network)).not.toMatch(
      /interface|address|endpoint|packet|host(name)?/iu,
    );
    for (const network of [
      { ...input.network, receiveBytesPerSecond: -1 },
      { ...input.network, transmitBytesPerSecond: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => decodeProjectSystemTelemetry({ ...input, network })).toThrow();
    }

    const identityBearingInput = decodeProjectSystemTelemetry({
      ...input,
      network: { ...input.network, adapterName: "private-wifi" },
    });
    expect(identityBearingInput.network).toEqual(input.network);
    expect("adapterName" in identityBearingInput.network).toBe(false);
  });

  it("accepts only a project ID at the endpoint boundary", () => {
    const parsed = decodeProjectSystemTelemetryInput({
      projectId: "project-1",
      workspaceRoot: "/renderer-controlled",
    });

    expect(parsed).toEqual({ projectId: "project-1" });
    expect("workspaceRoot" in parsed).toBe(false);
  });

  it("uses bounded lookup failures without a raw cause field", () => {
    const failure = new ServerProjectSystemTelemetryError({
      kind: "project-lookup-failed",
      message: "Failed to resolve the selected project.",
    });
    const encoded = encodeProjectSystemTelemetryError(failure);

    expect(encoded).toMatchObject({
      _tag: "ServerProjectSystemTelemetryError",
      kind: "project-lookup-failed",
      message: "Failed to resolve the selected project.",
    });
    expect("cause" in encoded).toBe(false);
  });

  it("decodes bounded, project-volume-scoped telemetry", () => {
    const parsed = decodeProjectSystemTelemetry(projectSystemTelemetryFixture());

    expect(parsed.projectId).toBe("project-1");
    expect(parsed.memory.availableBytes).toBe(2_000);
    expect(parsed.projectVolume.availableBytes).toBe(2_500);
    expect(parsed.projectVolume.projectVolumeOnly).toBe(true);
  });

  it("rejects fabricated percentages outside the telemetry range", () => {
    const input = projectSystemTelemetryFixture();
    expect(() =>
      decodeProjectSystemTelemetry({
        ...input,
        cpu: { ...input.cpu, utilizationPercent: 101 },
      }),
    ).toThrow();
  });

  it("requires the disk sample to identify itself as project-volume-only", () => {
    const input = projectSystemTelemetryFixture();
    expect(() =>
      decodeProjectSystemTelemetry({
        ...input,
        projectVolume: { ...input.projectVolume, projectVolumeOnly: false },
      }),
    ).toThrow();
  });

  it("does not allow unavailable metrics to masquerade as measured zeroes", () => {
    const input = projectSystemTelemetryFixture();
    expect(() =>
      decodeProjectSystemTelemetry({
        ...input,
        memory: {
          status: "unavailable",
          totalBytes: 0,
          usedBytes: 0,
          availableBytes: 0,
          utilizationPercent: 0,
          detail: "Unavailable.",
        },
      }),
    ).toThrow();
  });

  it("round-trips an unavailable project-volume sample without fabricated values", () => {
    const input = projectSystemTelemetryFixture();
    const parsed = decodeProjectSystemTelemetry({
      ...input,
      projectVolume: {
        status: "unavailable",
        totalBytes: null,
        usedBytes: null,
        availableBytes: null,
        utilizationPercent: null,
        projectVolumeOnly: true,
        detail: "Project-volume telemetry is unavailable.",
      },
    });

    expect(parsed.projectVolume).toEqual({
      status: "unavailable",
      totalBytes: null,
      usedBytes: null,
      availableBytes: null,
      utilizationPercent: null,
      projectVolumeOnly: true,
      detail: "Project-volume telemetry is unavailable.",
    });
  });

  it("represents measured memory exhaustion without confusing it with unavailable data", () => {
    const input = projectSystemTelemetryFixture();
    const parsed = decodeProjectSystemTelemetry({
      ...input,
      memory: {
        ...input.memory,
        usedBytes: input.memory.totalBytes,
        availableBytes: 0,
        utilizationPercent: 100,
      },
    });

    expect(parsed.memory).toEqual({
      status: "available",
      totalBytes: input.memory.totalBytes,
      usedBytes: input.memory.totalBytes,
      availableBytes: 0,
      utilizationPercent: 100,
      detail: null,
    });
  });

  it("pairs GPU status with adapters and a machine-readable reason", () => {
    const input = projectSystemTelemetryFixture();
    const unavailable = {
      status: "unavailable" as const,
      adapters: [],
      reason: "unsupported" as const,
      detail: "No supported GPU telemetry source is available on this system.",
    };

    expect(decodeProjectSystemTelemetry({ ...input, gpu: unavailable }).gpu).toEqual(unavailable);
    for (const reason of ["unsupported", "probe-failed", "malformed"]) {
      expect(
        decodeProjectSystemTelemetry({ ...input, gpu: { ...unavailable, reason } }).gpu.reason,
      ).toBe(reason);
    }

    // available requires at least one adapter and a null reason/detail
    expect(() =>
      decodeProjectSystemTelemetry({
        ...input,
        gpu: { status: "available", adapters: [], reason: null, detail: null },
      }),
    ).toThrow();
    expect(() =>
      decodeProjectSystemTelemetry({ ...input, gpu: { ...input.gpu, reason: "malformed" } }),
    ).toThrow();
    // unavailable must not carry adapters and needs a known reason
    expect(() =>
      decodeProjectSystemTelemetry({
        ...input,
        gpu: { ...unavailable, adapters: input.gpu.adapters },
      }),
    ).toThrow();
    expect(() =>
      decodeProjectSystemTelemetry({ ...input, gpu: { ...unavailable, reason: "no-driver" } }),
    ).toThrow();
  });

  it("bounds GPU adapter cardinality at exactly the documented maximum", () => {
    const input = projectSystemTelemetryFixture();
    const adapter = input.gpu.adapters[0]!;
    const build = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ ...adapter, index }));

    const atLimit = decodeProjectSystemTelemetry({
      ...input,
      gpu: { ...input.gpu, adapters: build(MAX_GPU_ADAPTERS) },
    });
    expect(atLimit.gpu.status === "available" ? atLimit.gpu.adapters : []).toHaveLength(
      MAX_GPU_ADAPTERS,
    );

    expect(() =>
      decodeProjectSystemTelemetry({
        ...input,
        gpu: { ...input.gpu, adapters: build(MAX_GPU_ADAPTERS + 1) },
      }),
    ).toThrow();
  });

  it("bounds each GPU adapter field and rejects control characters in names", () => {
    const input = projectSystemTelemetryFixture();
    const adapter = input.gpu.adapters[0]!;
    const rejects = (overrides: Record<string, unknown>) =>
      expect(() =>
        decodeProjectSystemTelemetry({
          ...input,
          gpu: { ...input.gpu, adapters: [{ ...adapter, ...overrides }] },
        }),
      ).toThrow();

    rejects({ utilizationPercent: 101 });
    rejects({ utilizationPercent: -1 });
    rejects({ memoryUtilizationPercent: 100.1 });
    rejects({ temperatureCelsius: MIN_HARDWARE_TEMPERATURE_CELSIUS - 0.1 });
    rejects({ temperatureCelsius: MAX_HARDWARE_TEMPERATURE_CELSIUS + 0.1 });
    rejects({ temperatureCelsius: Number.NaN });
    rejects({ memoryTotalBytes: 0 });
    rejects({ index: -1 });
    rejects({ index: MAX_GPU_ADAPTER_INDEX + 1 });
    rejects({ name: "" });
    rejects({ name: "x".repeat(MAX_GPU_ADAPTER_NAME_LENGTH + 1) });
    // `Schema.Int` alone would admit 1e300, so the explicit byte ceiling matters.
    rejects({ memoryTotalBytes: 1e300 });
    rejects({ memoryUsedBytes: MAX_GPU_MEMORY_BYTES + 2 });
    for (const codePoint of [0x00, 0x1b, 0x9b, 0xad, 0x200d, 0x202e, 0x2028, 0xe000]) {
      rejects({ name: `NVIDIA ${String.fromCodePoint(codePoint)} RTX` });
    }

    // The contract bounds per-field ranges only; the cross-field
    // used-exceeds-total rule is enforced by the server-side parser.
    expect(() =>
      decodeProjectSystemTelemetry({
        ...input,
        gpu: {
          ...input.gpu,
          adapters: [{ ...adapter, memoryUsedBytes: adapter.memoryTotalBytes + 1 }],
        },
      }),
    ).not.toThrow();
  });

  it("accepts only bounded, classified, measured Celsius temperature sensors", () => {
    const input = projectSystemTelemetryFixture();
    const temperatures = {
      version: 1 as const,
      status: "available" as const,
      sensors: [
        {
          kind: "gpu" as const,
          label: "NVIDIA GeForce RTX 4090 GPU 0",
          temperatureCelsius: 48,
          source: "nvidia-smi" as const,
        },
      ],
      reason: null,
      detail: null,
    };
    expect(decodeProjectSystemTelemetry({ ...input, temperatures }).temperatures).toEqual(
      temperatures,
    );

    for (const temperatureCelsius of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      MIN_HARDWARE_TEMPERATURE_CELSIUS - 0.1,
      MAX_HARDWARE_TEMPERATURE_CELSIUS + 0.1,
    ]) {
      expect(() =>
        decodeProjectSystemTelemetry({
          ...input,
          temperatures: {
            ...temperatures,
            sensors: [{ ...temperatures.sensors[0], temperatureCelsius }],
          },
        }),
      ).toThrow();
    }
    expect(() =>
      decodeProjectSystemTelemetry({
        ...input,
        temperatures: {
          ...temperatures,
          sensors: Array.from({ length: MAX_TEMPERATURE_SENSORS + 1 }, (_, index) => ({
            ...temperatures.sensors[0],
            label: `GPU ${index}`,
          })),
        },
      }),
    ).toThrow();
    expect(() =>
      decodeProjectSystemTelemetry({
        ...input,
        temperatures: {
          ...temperatures,
          sensors: [
            {
              ...temperatures.sensors[0],
              label: "x".repeat(MAX_TEMPERATURE_SENSOR_LABEL_LENGTH + 1),
            },
          ],
        },
      }),
    ).toThrow();
    expect(() =>
      decodeProjectSystemTelemetry({
        ...input,
        temperatures: {
          ...temperatures,
          sensors: [{ ...temperatures.sensors[0], label: "GPU\u202e0" }],
        },
      }),
    ).toThrow();
  });

  it("keeps unsupported temperature telemetry explicit and value-free", () => {
    const input = projectSystemTelemetryFixture();
    const unavailable = {
      version: 1 as const,
      status: "unavailable" as const,
      sensors: [],
      reason: "unsupported" as const,
      detail: "No supported hardware temperature source is available on this system.",
    };
    expect(
      decodeProjectSystemTelemetry({ ...input, temperatures: unavailable }).temperatures,
    ).toEqual(unavailable);
    expect(() =>
      decodeProjectSystemTelemetry({
        ...input,
        temperatures: {
          ...unavailable,
          sensors: [
            {
              kind: "ambient",
              label: "Estimated case",
              temperatureCelsius: 22,
              source: "linux-hwmon",
            },
          ],
        },
      }),
    ).toThrow();
  });
});
