import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  ClientSettingsPatch,
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_WORLD_CLOCK_ENABLED,
  DEFAULT_WORLD_CLOCK_LOCATION_IDS,
  DEFAULT_WORLD_CLOCK_STYLE,
  MAX_WORLD_CLOCK_LOCATIONS,
  WorldClockLocationIds,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const decodeLocationIds = Schema.decodeUnknownSync(WorldClockLocationIds);

describe("world clock settings contract", () => {
  it("ships off by default and keeps the documented default selection", () => {
    expect(DEFAULT_WORLD_CLOCK_ENABLED).toBe(false);
    expect(DEFAULT_WORLD_CLOCK_STYLE).toBe("rainbow");
    expect(DEFAULT_WORLD_CLOCK_LOCATION_IDS).toEqual(["tokyo", "los-angeles", "london"]);
    expect(DEFAULT_WORLD_CLOCK_LOCATION_IDS.length).toBeLessThanOrEqual(MAX_WORLD_CLOCK_LOCATIONS);
    expect(DEFAULT_CLIENT_SETTINGS.worldClockEnabled).toBe(DEFAULT_WORLD_CLOCK_ENABLED);
  });

  it("bounds the selection to 1 to 6 unique known cities", () => {
    expect(decodeLocationIds(["tokyo"])).toEqual(["tokyo"]);
    expect(
      decodeLocationIds(["tokyo", "los-angeles", "london", "paris", "berlin", "seoul"]),
    ).toHaveLength(MAX_WORLD_CLOCK_LOCATIONS);

    // An empty list would render an empty panel; an oversized one would grow
    // both the render cost and the single weather request without a bound.
    expect(() => decodeLocationIds([])).toThrow();
    expect(() =>
      decodeLocationIds(["tokyo", "los-angeles", "london", "paris", "berlin", "seoul", "sydney"]),
    ).toThrow();
    // A duplicate would render the same city twice and break the per-location
    // weather mapping, which is keyed by location id.
    expect(() => decodeLocationIds(["tokyo", "tokyo"])).toThrow();
    expect(() => decodeLocationIds(["atlantis"])).toThrow();
  });

  it("rejects an out-of-bounds selection at the patch boundary too", () => {
    expect(decodeClientSettingsPatch({ worldClockLocationIds: ["paris"] })).toEqual({
      worldClockLocationIds: ["paris"],
    });
    expect(() => decodeClientSettingsPatch({ worldClockLocationIds: [] })).toThrow();
    expect(() => decodeClientSettingsPatch({ worldClockStyle: "hologram" })).toThrow();
  });

  it("decodes settings that predate the world clock without turning it on", () => {
    // Existing saved settings have no world clock keys. They must decode to the
    // documented defaults, so an upgrade never enables the panel by itself and
    // never rejects a stored settings file.
    const decoded = decodeClientSettings({});
    expect(decoded.worldClockEnabled).toBe(DEFAULT_WORLD_CLOCK_ENABLED);
    expect(decoded.worldClockStyle).toBe(DEFAULT_WORLD_CLOCK_STYLE);
    expect(decoded.worldClockLocationIds).toEqual(DEFAULT_WORLD_CLOCK_LOCATION_IDS);
  });
});
