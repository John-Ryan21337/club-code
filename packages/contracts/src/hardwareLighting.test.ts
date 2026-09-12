import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { HardwareLightingFrameInput } from "./hardwareLighting.ts";
import { ClientSettingsSchema, ClientSettingsPatch } from "./settings.ts";

describe("hardware lighting contracts", () => {
  it("defaults to no device authority and preserves a bounded explicit selection", () => {
    const settings = Schema.decodeUnknownSync(ClientSettingsSchema)({});
    expect(settings.hardwareLightingSyncEnabled).toBe(false);
    expect(settings.hardwareLightingControllerIds).toEqual([]);
    expect(settings.hardwareLightingRestoreOnDisable).toBe(true);
    const decode = Schema.decodeUnknownSync(ClientSettingsPatch);
    expect(
      decode({ hardwareLightingControllerIds: ["a".repeat(16)], hardwareLightingBrightness: 0.05 }),
    ).toEqual({
      hardwareLightingControllerIds: ["a".repeat(16)],
      hardwareLightingBrightness: 0.05,
    });
    expect(() =>
      decode({ hardwareLightingControllerIds: ["a".repeat(16), "a".repeat(16)] }),
    ).toThrow();
    expect(() =>
      decode({
        hardwareLightingControllerIds: Array.from({ length: 65 }, (_, i) =>
          i.toString(16).padStart(16, "0"),
        ),
      }),
    ).toThrow();
    expect(() => decode({ hardwareLightingBrightness: 0 })).toThrow();
  });
  it("rejects oversized, fractional and non-byte frame payloads", () => {
    const decode = Schema.decodeUnknownSync(HardwareLightingFrameInput);
    const color = { red: 0, green: 128, blue: 255 };
    expect(decode({ sequence: 0, active: false, colors: [] }).active).toBe(false);
    expect(() => decode({ sequence: 0.5, active: true, colors: [color] })).toThrow();
    expect(() =>
      decode({ sequence: 1, active: true, colors: Array.from({ length: 65 }, () => color) }),
    ).toThrow();
    expect(() => decode({ sequence: 1, active: true, colors: [{ ...color, red: 256 }] })).toThrow();
  });
});
