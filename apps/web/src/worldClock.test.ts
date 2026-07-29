import { describe, expect, it } from "vitest";

import {
  formatWorldClockDate,
  formatWorldClockTime,
  getAnalogHandAngles,
  getWorldClockAnalogParts,
  resolveWorldClockLocation,
  WORLD_CLOCK_LOCATIONS,
} from "./worldClock";

describe("world clock projection", () => {
  it("keeps every selectable city bound to a unique explicit IANA timezone", () => {
    expect(new Set(WORLD_CLOCK_LOCATIONS.map((location) => location.id)).size).toBe(
      WORLD_CLOCK_LOCATIONS.length,
    );
    for (const location of WORLD_CLOCK_LOCATIONS) {
      expect(location.timeZone).toContain("/");
      expect(() =>
        new Intl.DateTimeFormat("en-US", { timeZone: location.timeZone }).format(new Date()),
      ).not.toThrow();
      expect(resolveWorldClockLocation(location.id)).toBe(location);
    }
  });

  it("derives timezone-local analog hands without changing the represented instant", () => {
    const instant = new Date("2026-07-29T12:34:56.000Z");
    expect(getWorldClockAnalogParts(instant, resolveWorldClockLocation("tokyo"))).toEqual({
      hour: 21,
      minute: 34,
      second: 56,
    });
    expect(getWorldClockAnalogParts(instant, resolveWorldClockLocation("los-angeles"))).toEqual({
      hour: 5,
      minute: 34,
      second: 56,
    });
    expect(getAnalogHandAngles({ hour: 3, minute: 30, second: 0 })).toEqual({
      hour: 105,
      minute: 180,
      second: 0,
    });
  });

  it("formats the configured zone and respects the shared 12/24-hour preference", () => {
    const instant = new Date("2026-07-29T12:34:56.000Z");
    const tokyo = resolveWorldClockLocation("tokyo");
    expect(formatWorldClockTime(instant, tokyo, "24-hour")).toMatch(/21.*34.*56/);
    expect(formatWorldClockTime(instant, tokyo, "12-hour")).toMatch(/9.*34.*56/);
    expect(formatWorldClockDate(instant, tokyo)).toMatch(/Jul.*29|29.*Jul/);
  });
});
