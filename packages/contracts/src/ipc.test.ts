import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  DesktopWindowAlwaysOnTopPreferenceSchema,
  DesktopWindowAlwaysOnTopStateSchema,
} from "./ipc.js";

const decodePreference = Schema.decodeUnknownSync(DesktopWindowAlwaysOnTopPreferenceSchema);
const decodeState = Schema.decodeUnknownSync(DesktopWindowAlwaysOnTopStateSchema);

describe("desktop whole-window always-on-top contracts", () => {
  it("accepts only a bounded boolean preference", () => {
    expect(decodePreference({ enabled: true })).toEqual({ enabled: true });
    expect(() => decodePreference({ enabled: "true" })).toThrow();
    expect(() =>
      decodePreference({ enabled: true, videoOnly: true }, { onExcessProperty: "error" }),
    ).toThrow();
  });

  it("does not claim a successful safe reset when native state is unknown", () => {
    expect(
      decodeState({
        supported: true,
        enabled: false,
        effectiveEnabled: null,
        reason: "safe-reset-failed",
      }),
    ).toEqual({
      supported: true,
      enabled: false,
      effectiveEnabled: null,
      reason: "safe-reset-failed",
    });
  });
});
