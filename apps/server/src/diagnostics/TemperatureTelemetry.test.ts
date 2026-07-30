import { describe, expect, it } from "vitest";

import {
  mergeGpuTemperatureSensors,
  parseTemperatureProbeOutput,
  sanitizeTemperatureSensorLabel,
  temperatureTelemetryFromRawSamples,
  unavailableTemperatureTelemetry,
  unavailableWindowsTemperatureTelemetry,
} from "./TemperatureTelemetry.ts";

describe("TemperatureTelemetry", () => {
  it("parses, classifies, bounds, and sanitizes optional hardware monitor sensors", () => {
    const result = parseTemperatureProbeOutput(
      JSON.stringify([
        {
          Source: "libre-hardware-monitor",
          Name: "CPU Package\u202e",
          Identifier: "/amdcpu/0/temperature/0",
          Value: 63.5,
        },
        {
          Source: "libre-hardware-monitor",
          Name: "GPU Memory Junction",
          Identifier: "/gpu-nvidia/0/temperature/2",
          Value: "78",
        },
        {
          Source: "libre-hardware-monitor",
          Name: "NVMe Composite",
          Identifier: "/nvme/0/temperature/0",
          Value: 41,
        },
      ]),
    );

    expect(result.status).toBe("available");
    expect(result.status === "available" ? result.sensors : []).toEqual([
      expect.objectContaining({ kind: "cpu", label: "CPU Package", temperatureCelsius: 63.5 }),
      expect.objectContaining({ kind: "vram", temperatureCelsius: 78 }),
      expect.objectContaining({ kind: "storage", temperatureCelsius: 41 }),
    ]);
  });

  it("never publishes impossible, non-finite, or source-less values", () => {
    expect(
      temperatureTelemetryFromRawSamples([
        { source: "libre-hardware-monitor", name: "CPU", value: Number.NaN },
        { source: "libre-hardware-monitor", name: "GPU", value: 251 },
        { source: "unknown", name: "Ambient", value: 20 },
      ]),
    ).toEqual(unavailableTemperatureTelemetry("malformed"));
    expect(parseTemperatureProbeOutput("{bad")).toEqual(
      unavailableTemperatureTelemetry("malformed"),
    );
    expect(parseTemperatureProbeOutput("")).toEqual(unavailableTemperatureTelemetry("unsupported"));
    expect(parseTemperatureProbeOutput("[]")).toEqual(
      unavailableTemperatureTelemetry("unsupported"),
    );
  });

  it("distinguishes a missing Windows sensor provider from a provider without sensors", () => {
    expect(
      parseTemperatureProbeOutput(
        JSON.stringify({ CafeCodeTemperatureStatus: "provider-missing" }),
      ),
    ).toEqual({
      version: 1,
      status: "unavailable",
      sensors: [],
      hostSensorProbe: {
        status: "unavailable",
        reason: "provider-missing",
        detail:
          "Libre Hardware Monitor or Open Hardware Monitor WMI is not available. Install and run a supported sensor provider to expose measured host temperatures.",
      },
      reason: "unsupported",
      detail:
        "Libre Hardware Monitor or Open Hardware Monitor WMI is not available. Install and run a supported sensor provider to expose measured host temperatures.",
    });
    expect(
      parseTemperatureProbeOutput(
        JSON.stringify({ CafeCodeTemperatureStatus: "no-temperature-sensors" }),
      ),
    ).toEqual({
      version: 1,
      status: "unavailable",
      sensors: [],
      hostSensorProbe: {
        status: "unavailable",
        reason: "no-temperature-sensors",
        detail:
          "A supported hardware monitor is available, but it did not expose any measured temperature sensors.",
      },
      reason: "unsupported",
      detail:
        "A supported hardware monitor is available, but it did not expose any measured temperature sensors.",
    });
    expect(
      parseTemperatureProbeOutput(JSON.stringify({ CafeCodeTemperatureStatus: "probe-failed" })),
    ).toEqual(unavailableTemperatureTelemetry("probe-failed"));
    expect(
      parseTemperatureProbeOutput(
        JSON.stringify({
          CafeCodeTemperatureStatus: "provider-missing",
          injected: "ignored",
        }),
      ),
    ).toEqual(unavailableTemperatureTelemetry("unsupported"));
  });

  it("keeps distinct same-label sensors with stable safe suffixes", () => {
    const samples = [
      {
        source: "linux-hwmon",
        name: "Composite",
        identifier: "/nvme/0/temp1",
        value: 41,
      },
      {
        source: "linux-hwmon",
        name: "Composite",
        identifier: "/nvme/1/temp1",
        value: 43,
      },
    ] as const;
    const first = temperatureTelemetryFromRawSamples(samples);
    const second = temperatureTelemetryFromRawSamples(samples);
    expect(first).toEqual(second);
    expect(first.status === "available" ? first.sensors.map((sensor) => sensor.label) : []).toEqual(
      ["Composite", "Composite (2)"],
    );
  });

  it("uses measured nvidia-smi GPU temperatures without fabricating memory temperature", () => {
    const host = unavailableWindowsTemperatureTelemetry("provider-missing");
    const result = mergeGpuTemperatureSensors(host, {
      status: "available",
      reason: null,
      detail: null,
      adapters: [
        {
          index: 0,
          name: "NVIDIA GeForce RTX 3090",
          utilizationPercent: 10,
          memoryTotalBytes: 1_000,
          memoryUsedBytes: 100,
          memoryUtilizationPercent: 10,
          temperatureCelsius: 48,
        },
        {
          index: 1,
          name: "NVIDIA GeForce RTX 3090",
          utilizationPercent: 12,
          memoryTotalBytes: 1_000,
          memoryUsedBytes: 100,
          memoryUtilizationPercent: 10,
          temperatureCelsius: 34,
        },
      ],
    });

    expect(result.status === "available" ? result.sensors : []).toEqual([
      expect.objectContaining({ kind: "gpu", temperatureCelsius: 48, source: "nvidia-smi" }),
      expect.objectContaining({ kind: "gpu", temperatureCelsius: 34, source: "nvidia-smi" }),
    ]);
    expect(
      result.status === "available"
        ? result.sensors.some((sensor) => sensor.kind === "vram")
        : true,
    ).toBe(false);
    expect(result.status === "available" ? result.hostSensorProbe : null).toEqual(
      host.hostSensorProbe,
    );
  });

  it("creates stable bounded labels without controls or lone surrogates", () => {
    const first = sanitizeTemperatureSensorLabel(` Case\u0000\u202e ${"x".repeat(200)} `, "Case");
    const second = sanitizeTemperatureSensorLabel(` Case\u0000\u202e ${"x".repeat(200)} `, "Case");
    expect(first).toBe(second);
    expect(first.length).toBeLessThanOrEqual(120);
    expect(first.includes("\u0000")).toBe(false);
    expect(first.includes("\u202e")).toBe(false);
    expect(sanitizeTemperatureSensorLabel("\ud800", "Other temperature")).toBe("Other temperature");
  });
});
