import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { ClientSettingsPatch, ClientSettingsSchema } from "./settings.ts";

describe("telemetry display preference", () => {
  it("defaults to showing unavailable graphs and roundtrips explicit hide/show values", () => {
    const decode = Schema.decodeUnknownSync(ClientSettingsSchema);
    expect(decode({}).projectTelemetryHideUnavailableGraphs).toBe(false);
    for (const hidden of [true, false]) {
      const persisted = Schema.encodeSync(ClientSettingsSchema)(
        decode({ projectTelemetryHideUnavailableGraphs: hidden }),
      );
      expect(decode(persisted).projectTelemetryHideUnavailableGraphs).toBe(hidden);
      expect(
        Schema.decodeUnknownSync(ClientSettingsPatch)({
          projectTelemetryHideUnavailableGraphs: hidden,
        }),
      ).toEqual({ projectTelemetryHideUnavailableGraphs: hidden });
    }
  });
  it("rejects nonboolean persisted preferences", () => {
    expect(() =>
      Schema.decodeUnknownSync(ClientSettingsPatch)({
        projectTelemetryHideUnavailableGraphs: "true",
      }),
    ).toThrow();
  });
});
