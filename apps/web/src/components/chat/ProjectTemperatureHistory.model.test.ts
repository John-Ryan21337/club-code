import type { ServerSystemTemperatureTelemetry } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";
import {
  emptyTemperatureCategoryValues,
  normalizeTemperatureHistory,
  projectTemperatureCategories,
  temperatureCategoryValues,
} from "./ProjectTemperatureHistory.model";

const measured: ServerSystemTemperatureTelemetry = {
  version: 1,
  status: "available",
  reason: null,
  detail: null,
  sensors: [
    { kind: "cpu", label: "Core 1", source: "linux-hwmon", temperatureCelsius: 40 },
    { kind: "cpu", label: "Core 2", source: "linux-hwmon", temperatureCelsius: 60 },
    { kind: "gpu", label: "GPU", source: "nvidia-smi", temperatureCelsius: 0 },
    {
      kind: "ambient",
      label: "Ambient",
      source: "libre-hardware-monitor",
      temperatureCelsius: -10,
    },
  ],
};

describe("temperature category histories", () => {
  it("keeps the hottest measured value, counts sources, and preserves zero and negative readings", () => {
    const result = projectTemperatureCategories(measured);
    expect(result.cpu).toEqual({ celsius: 60, count: 2 });
    expect(result.gpu).toEqual({ celsius: 0, count: 1 });
    expect(result.ambient).toEqual({ celsius: -10, count: 1 });
    expect(result.memory).toEqual({ celsius: null, count: 0 });
    expect(temperatureCategoryValues(measured)).toEqual({
      ...emptyTemperatureCategoryValues(),
      cpu: 60,
      gpu: 0,
      ambient: -10,
    });
  });

  it("retains valid GPU data when a separate host sensor provider is missing", () => {
    expect(
      projectTemperatureCategories({
        ...measured,
        hostSensorProbe: {
          status: "unavailable",
          reason: "provider-missing",
          detail: "Untrusted diagnostic text",
        },
      }).gpu,
    ).toEqual({ celsius: 0, count: 1 });
  });

  it.each([Number.NaN, Infinity, -101, 251, "50"])(
    "rejects an invalid injected sensor value: %s",
    (value) => {
      const hostile = {
        ...measured,
        sensors: [{ ...measured.sensors[0], temperatureCelsius: value }],
      } as unknown as ServerSystemTemperatureTelemetry;
      expect(temperatureCategoryValues(hostile)).toEqual(emptyTemperatureCategoryValues());
    },
  );

  it("rejects an oversized or unknown category list and clears missing snapshots", () => {
    expect(
      temperatureCategoryValues({
        ...measured,
        sensors: Array.from({ length: 65 }, () => measured.sensors[0]!),
      }),
    ).toEqual(emptyTemperatureCategoryValues());
    expect(
      temperatureCategoryValues({
        ...measured,
        sensors: [{ ...measured.sensors[0], kind: "unknown" }],
      } as unknown as ServerSystemTemperatureTelemetry),
    ).toEqual(emptyTemperatureCategoryValues());
    expect(temperatureCategoryValues(undefined)).toEqual(emptyTemperatureCategoryValues());
  });

  it("uses a fixed Celsius scale without joining missing values", () => {
    expect(normalizeTemperatureHistory([-100, -20, 50, 120, 250, null, NaN, 251])).toEqual([
      0,
      0,
      50,
      100,
      100,
      null,
      null,
      null,
    ]);
  });
});
