import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { ServerSystemTemperatureTelemetry } from "./systemTelemetry.ts";

const decode = Schema.decodeUnknownSync(ServerSystemTemperatureTelemetry);
const sensor = {
  kind: "cpu",
  label: "CPU package",
  source: "linux-hwmon",
  temperatureCelsius: 55.5,
};
const available = {
  version: 1,
  status: "available",
  sensors: [sensor],
  reason: null,
  detail: null,
};

describe("hardware temperature transport", () => {
  it("preserves measured values and separate missing-provider diagnostics", () => {
    const partial = {
      ...available,
      hostSensorProbe: {
        status: "unavailable",
        reason: "provider-missing",
        detail: "No host provider.",
      },
    };
    expect(decode(available)).toEqual(available);
    expect(decode(partial)).toEqual(partial);
  });

  it.each([
    { temperatureCelsius: Number.NaN },
    { temperatureCelsius: 251 },
    { temperatureCelsius: -101 },
    { label: "x".repeat(121) },
    { label: "CPU\u202Ehidden" },
    { source: "untrusted-provider" },
  ])("rejects an invalid sensor: %j", (fields) => {
    expect(() => decode({ ...available, sensors: [{ ...sensor, ...fields }] })).toThrow();
  });

  it("bounds versions, sensor counts, and unavailable payloads", () => {
    expect(() => decode({ ...available, version: 2 })).toThrow();
    expect(() => decode({ ...available, sensors: [] })).toThrow();
    expect(() =>
      decode({ ...available, sensors: Array.from({ length: 65 }, () => sensor) }),
    ).toThrow();
    expect(() =>
      decode({ ...available, status: "unavailable", reason: "unsupported", detail: "No sensor." }),
    ).toThrow();
  });
});
