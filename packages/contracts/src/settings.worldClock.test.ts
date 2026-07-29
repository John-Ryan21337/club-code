import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  ClientSettingsPatch,
  ClientSettingsSchema,
  DEFAULT_WORLD_CLOCK_ENABLED,
  DEFAULT_WORLD_CLOCK_LOCATION_IDS,
  DEFAULT_WORLD_CLOCK_STYLE,
  DEFAULT_WORLD_CLOCK_WEATHER_ENABLED,
  MAX_WORLD_CLOCK_LOCATIONS,
} from "./settings.ts";

const decodeSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const decodePatch = Schema.decodeUnknownSync(ClientSettingsPatch);

describe("world clock client settings", () => {
  it("defaults to a disabled, local-only three-city clock", () => {
    expect(decodeSettings({})).toMatchObject({
      worldClockEnabled: DEFAULT_WORLD_CLOCK_ENABLED,
      worldClockStyle: DEFAULT_WORLD_CLOCK_STYLE,
      worldClockLocationIds: DEFAULT_WORLD_CLOCK_LOCATION_IDS,
      worldClockWeatherEnabled: DEFAULT_WORLD_CLOCK_WEATHER_ENABLED,
    });
    expect(DEFAULT_WORLD_CLOCK_ENABLED).toBe(false);
    expect(DEFAULT_WORLD_CLOCK_WEATHER_ENABLED).toBe(false);
  });

  it("accepts bounded unique cities and every supported presentation style", () => {
    for (const worldClockStyle of ["rainbow", "nixie", "analog", "led"] as const) {
      expect(
        decodePatch({
          worldClockEnabled: true,
          worldClockStyle,
          worldClockLocationIds: ["tokyo", "seoul"],
          worldClockWeatherEnabled: true,
        }),
      ).toMatchObject({ worldClockStyle });
    }
  });

  it("rejects empty, oversized, duplicated, and unknown city selections", () => {
    expect(() => decodePatch({ worldClockLocationIds: [] })).toThrow();
    expect(() =>
      decodePatch({
        worldClockLocationIds: Array.from({ length: MAX_WORLD_CLOCK_LOCATIONS + 1 }, () => "tokyo"),
      }),
    ).toThrow();
    expect(() => decodePatch({ worldClockLocationIds: ["tokyo", "tokyo"] })).toThrow();
    expect(() => decodePatch({ worldClockLocationIds: ["antarctica"] })).toThrow();
    expect(() => decodePatch({ worldClockStyle: "flip-clock" })).toThrow();
  });
});
