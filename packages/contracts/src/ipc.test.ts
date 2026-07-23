import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import { DesktopWindowOpacityPreferenceSchema, DesktopWindowOpacityStateSchema } from "./ipc.js";

const decodePreference = Schema.decodeUnknownSync(DesktopWindowOpacityPreferenceSchema);
const decodeState = Schema.decodeUnknownSync(DesktopWindowOpacityStateSchema);

describe("desktop window opacity contracts", () => {
  it("accepts only finite bounded opacity preferences", () => {
    expect(decodePreference({ enabled: true, opacity: 0.65 })).toEqual({
      enabled: true,
      opacity: 0.65,
    });
    expect(decodePreference({ enabled: false, opacity: 1 })).toEqual({
      enabled: false,
      opacity: 1,
    });

    for (const opacity of [0.64, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.8"]) {
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
  });
});
