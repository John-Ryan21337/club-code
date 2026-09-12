import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_DESKTOP_WINDOW_OPACITY,
  DesktopWindowOpacityPreferenceSchema,
  DesktopWindowOpacityStateSchema,
  MAX_DESKTOP_WINDOW_OPACITY,
  MIN_DESKTOP_WINDOW_OPACITY,
} from "./ipc.ts";

const decodePreference = Schema.decodeUnknownSync(DesktopWindowOpacityPreferenceSchema);
const decodeState = Schema.decodeUnknownSync(DesktopWindowOpacityStateSchema);

describe("desktop window opacity contracts", () => {
  it("keeps the default preference fully opaque and inside the supported band", () => {
    expect(MAX_DESKTOP_WINDOW_OPACITY).toBe(1);
    expect(DEFAULT_DESKTOP_WINDOW_OPACITY).toBeGreaterThanOrEqual(MIN_DESKTOP_WINDOW_OPACITY);
    expect(DEFAULT_DESKTOP_WINDOW_OPACITY).toBeLessThanOrEqual(MAX_DESKTOP_WINDOW_OPACITY);
  });

  it("accepts only finite bounded opacity preferences", () => {
    expect(decodePreference({ enabled: true, opacity: 0.65 })).toEqual({
      enabled: true,
      opacity: 0.65,
    });
    expect(decodePreference({ enabled: false, opacity: 1 })).toEqual({
      enabled: false,
      opacity: 1,
    });

    for (const opacity of [0.64, 1.01, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, "0.8"]) {
      expect(() => decodePreference({ enabled: true, opacity })).toThrow();
    }
  });

  it("represents unknown live opacity without claiming a successful safe reset", () => {
    expect(
      decodeState({
        supported: true,
        enabled: false,
        opacity: 1,
        effectiveOpacity: null,
        reason: "safe-reset-failed",
      }),
    ).toEqual({
      supported: true,
      enabled: false,
      opacity: 1,
      effectiveOpacity: null,
      reason: "safe-reset-failed",
    });

    expect(() =>
      decodeState({
        supported: false,
        enabled: false,
        opacity: 1,
        effectiveOpacity: 1,
        reason: "not-a-known-reason",
      }),
    ).toThrow();
  });
});
