import { DEFAULT_UNIFIED_SETTINGS } from "@cafecode/contracts/settings";
import { describe, expect, it } from "vitest";

import {
  captureSettingsProfilePayload,
  sanitizeSettingsProfileClientSettings,
} from "./settingsProfiles";

describe("world clock settings profiles", () => {
  it("captures visual clock configuration including the user-selected weather preference", () => {
    const settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      worldClockEnabled: true,
      worldClockStyle: "analog" as const,
      worldClockLocationIds: ["seoul", "sydney"] as const,
      worldClockWeatherEnabled: true,
    };
    const payload = captureSettingsProfilePayload(settings, "dark");
    expect(payload.clientSettings).toMatchObject({
      worldClockEnabled: true,
      worldClockStyle: "analog",
      worldClockLocationIds: ["seoul", "sydney"],
    });
    expect(payload.clientSettings).not.toHaveProperty("worldClockPanelGeometry");
    expect(payload.clientSettings).toHaveProperty("worldClockWeatherEnabled", true);
  });

  it("drops malformed persisted clock fields independently", () => {
    expect(
      sanitizeSettingsProfileClientSettings({
        worldClockEnabled: true,
        worldClockStyle: "unsupported",
        worldClockLocationIds: ["tokyo", "tokyo"],
        worldClockWeatherEnabled: true,
      }),
    ).toEqual({
      worldClockEnabled: true,
      worldClockWeatherEnabled: true,
    });
  });
});
