import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_FALLING_EFFECT_DENSITY,
  DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
  MAX_FALLING_EFFECT_DENSITY,
  MAX_FALLING_EFFECT_SPEED,
  MIN_AMBIENT_OPACITY,
  MIN_FALLING_EFFECT_DENSITY,
  type ClientSettings,
} from "@cafecode/contracts/settings";
import { describe, expect, it } from "vitest";

import { parseAtmosphereCommands } from "./atmosphereCommandParser";
import {
  atmospherePercentFromValue,
  atmosphereValueFromPercent,
  buildAtmospherePatch,
  describeConfirmedAtmosphere,
} from "./atmosphereConsoleCommands";

function settings(overrides: Partial<ClientSettings> = {}): ClientSettings {
  return { ...DEFAULT_CLIENT_SETTINGS, ...overrides };
}

function patchFor(request: string, current: ClientSettings = settings()) {
  const parsed = parseAtmosphereCommands(request);
  expect(parsed.issues).toEqual([]);
  return buildAtmospherePatch(parsed.commands, current);
}

describe("buildAtmospherePatch", () => {
  it("enables the requested effect and names the kind", () => {
    expect(patchFor("matrix")).toEqual({
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
    });
  });

  it("disables effects without naming a kind", () => {
    expect(patchFor("effects off")).toEqual({ fallingEffectsEnabled: false });
  });

  it("sets a motion mode without touching the effect switch", () => {
    expect(patchFor("motion warp")).toEqual({
      fallingEffectMatrixMotionMode: "tunnel",
    });
  });

  it("pins the color mode to fixed so a chosen color is visible", () => {
    expect(patchFor("color green")).toEqual({
      fallingEffectColor: "#4ade80",
      fallingEffectMatrixColorMode: "fixed",
    });
  });

  it("maps percentages onto the stored setting range", () => {
    expect(patchFor("density 0")).toEqual({
      fallingEffectDensity: MIN_FALLING_EFFECT_DENSITY,
    });
    expect(patchFor("density 100")).toEqual({
      fallingEffectDensity: MAX_FALLING_EFFECT_DENSITY,
    });
    expect(patchFor("speed 100")).toEqual({
      fallingEffectSpeed: MAX_FALLING_EFFECT_SPEED,
    });
    expect(patchFor("opacity 0")).toEqual({
      fallingEffectOpacity: MIN_AMBIENT_OPACITY,
    });
    expect(patchFor("japanese 70%")).toEqual({
      fallingEffectJapaneseRatio: 0.7,
    });
  });

  it("steps relative adjustments from the current value and stops at the bounds", () => {
    const raised = patchFor(
      "density up",
      settings({ fallingEffectDensity: MIN_FALLING_EFFECT_DENSITY }),
    );
    expect(atmospherePercentFromValue(raised.fallingEffectDensity!, "density")).toBe(10);

    const pinned = patchFor(
      "density up",
      settings({ fallingEffectDensity: MAX_FALLING_EFFECT_DENSITY }),
    );
    expect(pinned.fallingEffectDensity).toBe(MAX_FALLING_EFFECT_DENSITY);

    const lowered = patchFor(
      "speed down",
      settings({ fallingEffectSpeed: MAX_FALLING_EFFECT_SPEED }),
    );
    expect(atmospherePercentFromValue(lowered.fallingEffectSpeed!, "speed")).toBe(90);
  });

  it("resets the supported console fields for a bare reset", () => {
    expect(patchFor("reset")).toEqual({
      fallingEffectsEnabled: DEFAULT_CLIENT_SETTINGS.fallingEffectsEnabled,
      fallingEffectKind: DEFAULT_CLIENT_SETTINGS.fallingEffectKind,
      fallingEffectColor: DEFAULT_CLIENT_SETTINGS.fallingEffectColor,
      fallingEffectMatrixColorMode: DEFAULT_CLIENT_SETTINGS.fallingEffectMatrixColorMode,
      fallingEffectMatrixMotionMode: DEFAULT_CLIENT_SETTINGS.fallingEffectMatrixMotionMode,
      fallingEffectOpacity: DEFAULT_CLIENT_SETTINGS.fallingEffectOpacity,
      fallingEffectSpeed: DEFAULT_CLIENT_SETTINGS.fallingEffectSpeed,
      fallingEffectDensity: DEFAULT_FALLING_EFFECT_DENSITY,
      fallingEffectJapaneseRatio: DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
    });
  });

  it("resets only the named property for a targeted reset", () => {
    expect(patchFor("reset density")).toEqual({
      fallingEffectDensity: DEFAULT_FALLING_EFFECT_DENSITY,
    });
  });

  it("applies later commands in a request on top of earlier ones", () => {
    expect(
      buildAtmospherePatch(
        [
          { kind: "reset", target: "all" },
          { kind: "set-effect", effect: "matrix" },
        ],
        settings(),
      ),
    ).toMatchObject({
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
    });
  });

  it("round-trips a percentage through the stored value", () => {
    for (const percent of [0, 25, 45, 70, 100]) {
      expect(
        atmospherePercentFromValue(atmosphereValueFromPercent(percent, "speed"), "speed"),
      ).toBe(percent);
    }
  });
});

describe("describeConfirmedAtmosphere", () => {
  it("reports the settings the server confirmed, not the ones requested", () => {
    const parsed = parseAtmosphereCommands("matrix, density 100");
    // The server clamped density to half of what was asked for.
    const confirmed = settings({
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
      fallingEffectDensity: atmosphereValueFromPercent(50, "density"),
    });
    expect(describeConfirmedAtmosphere(parsed.commands, confirmed)).toBe(
      "Confirmed: Effect matrix. Density 50%.",
    );
  });

  it("reports an effect that the server did not enable", () => {
    const parsed = parseAtmosphereCommands("snow");
    const confirmed = settings({ fallingEffectsEnabled: false });
    expect(describeConfirmedAtmosphere(parsed.commands, confirmed)).toBe(
      "Confirmed: Falling effects off.",
    );
  });

  it("describes every property a whole reset touched", () => {
    const parsed = parseAtmosphereCommands("reset");
    const message = describeConfirmedAtmosphere(parsed.commands, settings());
    expect(message).toContain("Falling effects off.");
    expect(message).toContain("Motion Flat.");
    expect(message).toContain("Color auto.");
    expect(message).toContain("Japanese ratio 45%.");
  });

  it("names the confirmed motion label and hex color", () => {
    const parsed = parseAtmosphereCommands("motion warp, color #a1b2c3");
    const confirmed = settings({
      fallingEffectMatrixMotionMode: "tunnel",
      fallingEffectColor: "#a1b2c3",
    });
    expect(describeConfirmedAtmosphere(parsed.commands, confirmed)).toBe(
      "Confirmed: Motion Warp. Color #a1b2c3.",
    );
  });
});
