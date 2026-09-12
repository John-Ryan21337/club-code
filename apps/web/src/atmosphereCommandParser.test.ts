import { describe, expect, it } from "vitest";

import {
  MAX_ATMOSPHERE_COMMAND_LENGTH,
  MAX_ATMOSPHERE_COMMANDS_PER_REQUEST,
  describeAtmosphereRefusal,
  parseAtmosphereCommands,
} from "./atmosphereCommandParser";

describe("parseAtmosphereCommands", () => {
  it("keeps a named media refusal after URL colon normalization", () => {
    expect(parseAtmosphereCommands("https://example.test/clip").issues[0]).toMatchObject({
      reason: "unsupported-feature",
      feature: "media",
    });
  });
  it.each([
    "constructor",
    "color constructor",
    "color __proto__",
    "motion constructor",
    "reset constructor",
    "constructor 50",
  ])("refuses inherited object keys in %j", (input) => {
    const result = parseAtmosphereCommands(input);
    expect(result.commands).toEqual([]);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("preserves newline command separators", () => {
    expect(parseAtmosphereCommands("snow\ncolor red").commands).toEqual([
      { kind: "set-effect", effect: "snow" },
      { kind: "set-color", color: "#f87171" },
    ]);
  });

  it.each([
    "reset density, density 50",
    "density 50, reset density",
    "reset all, snow",
    "snow, reset all",
    "reset color, color red",
    "motion flat, reset motion",
  ])("refuses overlapping reset and value commands in %j", (input) => {
    const result = parseAtmosphereCommands(input);
    expect(result.commands).toEqual([]);
    expect(result.issues[0]?.reason).toBe("conflicting");
  });

  describe("bounded grammar", () => {
    it.each([
      ["snow", { kind: "set-effect", effect: "snow" }],
      ["rain", { kind: "set-effect", effect: "rain" }],
      ["matrix", { kind: "set-effect", effect: "matrix" }],
      ["effects off", { kind: "set-effect", effect: "off" }],
      ["turn off the falling effects", { kind: "set-effect", effect: "off" }],
      ["雪", { kind: "set-effect", effect: "snow" }],
      ["雨", { kind: "set-effect", effect: "rain" }],
      ["マトリックス", { kind: "set-effect", effect: "matrix" }],
      ["オフ", { kind: "set-effect", effect: "off" }],
    ])("recognizes the installed effect phrase %j", (input, expected) => {
      expect(parseAtmosphereCommands(input)).toEqual({
        commands: [expected],
        issues: [],
      });
    });

    it.each([
      ["motion flat", "flat"],
      ["motion forward", "forward"],
      ["motion reverse", "reverse"],
      ["motion warp", "tunnel"],
      ["motion walk forward", "walk-forward"],
      ["motion walk reverse", "walk-reverse"],
      ["warp motion", "tunnel"],
      ["モーション ワープ", "tunnel"],
    ])("recognizes the installed motion mode %j", (input, motion) => {
      expect(parseAtmosphereCommands(input)).toEqual({
        commands: [{ kind: "set-motion", motion }],
        issues: [],
      });
    });

    it.each([
      ["color green", "#4ade80"],
      ["colour #a1b2c3", "#a1b2c3"],
      ["color #FFFFFF", "#ffffff"],
      ["色 赤", "#f87171"],
      ["color auto", "auto"],
    ])("recognizes the fixed color request %j", (input, color) => {
      expect(parseAtmosphereCommands(input)).toEqual({
        commands: [{ kind: "set-color", color }],
        issues: [],
      });
    });

    it.each([
      ["density 60", "density", 60],
      ["density 60%", "density", 60],
      ["speed to 25", "speed", 25],
      ["opacity 100", "opacity", 100],
      ["japanese 70%", "japanese-ratio", 70],
      ["日本語 70%", "japanese-ratio", 70],
      ["密度 ０", "density", 0],
      ["速度 ４０％", "speed", 40],
    ])("recognizes the percentage request %j", (input, property, percent) => {
      expect(parseAtmosphereCommands(input)).toEqual({
        commands: [{ kind: "set-percent", property, percent }],
        issues: [],
      });
    });

    it.each([
      ["density up", "density", "increase"],
      ["density down", "density", "decrease"],
      ["opacity increase", "opacity", "increase"],
      ["faster", "speed", "increase"],
      ["slower", "speed", "decrease"],
      ["密度 上げる", "density", "increase"],
      ["速度 下げる", "speed", "decrease"],
    ])("recognizes the relative step %j", (input, property, direction) => {
      expect(parseAtmosphereCommands(input)).toEqual({
        commands: [{ kind: "adjust", property, direction }],
        issues: [],
      });
    });

    it.each([
      ["reset", "all"],
      ["reset all", "all"],
      ["reset density", "density"],
      ["reset color", "color"],
      ["reset motion", "motion"],
      ["リセット", "all"],
      ["密度リセット", "density"],
    ])("recognizes the reset request %j", (input, target) => {
      expect(parseAtmosphereCommands(input)).toEqual({
        commands: [{ kind: "reset", target }],
        issues: [],
      });
    });

    it("accepts several commands separated by commas, and, or Japanese marks", () => {
      expect(parseAtmosphereCommands("matrix, motion warp and 日本語 70%、color green")).toEqual({
        commands: [
          { kind: "set-effect", effect: "matrix" },
          { kind: "set-motion", motion: "tunnel" },
          { kind: "set-percent", property: "japanese-ratio", percent: 70 },
          { kind: "set-color", color: "#4ade80" },
        ],
        issues: [],
      });
    });

    it("refuses more than the per-request command limit without applying any", () => {
      const result = parseAtmosphereCommands("snow, motion warp, density 10, speed 20, opacity 30");
      expect(result.commands).toEqual([]);
      expect(result.issues).toEqual([{ reason: "too-many-commands", count: 5 }]);
    });

    it("refuses input longer than the character limit", () => {
      const result = parseAtmosphereCommands("snow ".repeat(MAX_ATMOSPHERE_COMMAND_LENGTH));
      expect(result.commands).toEqual([]);
      expect(result.issues[0]?.reason).toBe("too-long");
    });

    it("refuses an empty request", () => {
      expect(parseAtmosphereCommands("   ")).toEqual({
        commands: [],
        issues: [{ reason: "empty" }],
      });
    });

    it("keeps the documented request limits in step with the grammar", () => {
      expect(MAX_ATMOSPHERE_COMMANDS_PER_REQUEST).toBe(4);
      expect(MAX_ATMOSPHERE_COMMAND_LENGTH).toBe(500);
    });
  });

  describe("misleading, unknown, and mixed requests", () => {
    it.each([
      ["next song", "media"],
      ["play the music", "media"],
      ["pause", "media"],
      ["play https://www.youtube.com/watch?v=aaaaaaaaaaa", "media"],
      ["next visualizer", "visualizer"],
      ["2ch on", "2ch"],
      ["ask claude to make it snow", "model-interpreter"],
      ["use lm studio", "model-interpreter"],
    ])("refuses %j because this build does not install that feature", (input, feature) => {
      const result = parseAtmosphereCommands(input);
      expect(result.commands).toEqual([]);
      expect(result.issues).toEqual([
        { reason: "unsupported-feature", text: expect.any(String), feature },
      ]);
    });

    it("applies nothing when a supported command is mixed with an unsupported one", () => {
      const result = parseAtmosphereCommands("snow and next song");
      expect(result.commands).toEqual([]);
      expect(result.issues).toEqual([
        { reason: "unsupported-feature", text: "next song", feature: "media" },
      ]);
      expect(describeAtmosphereRefusal(result.issues)).toContain("media playback");
      expect(describeAtmosphereRefusal(result.issues)).toContain("Nothing changed.");
    });

    it("applies nothing when a supported command is mixed with an unknown one", () => {
      const result = parseAtmosphereCommands("matrix, make it cosy");
      expect(result.commands).toEqual([]);
      expect(result.issues).toEqual([{ reason: "unknown", text: "make it cosy" }]);
    });

    it("refuses a repeated setting inside one request", () => {
      const result = parseAtmosphereCommands("density 10, density 90");
      expect(result.commands).toEqual([]);
      expect(result.issues).toEqual([{ reason: "conflicting", text: "density 90" }]);
    });

    it("refuses a relative step for a setting that only takes an absolute value", () => {
      const result = parseAtmosphereCommands("japanese up");
      expect(result.commands).toEqual([]);
      expect(result.issues).toEqual([{ reason: "unknown", text: "japanese up" }]);
    });

    it("does not treat a bare word as a color", () => {
      const result = parseAtmosphereCommands("green");
      expect(result.commands).toEqual([]);
      expect(result.issues).toEqual([{ reason: "unknown", text: "green" }]);
    });
  });

  describe("invalid numbers and colors", () => {
    it.each(["density 120", "speed 999", "opacity 101", "japanese 1000"])(
      "refuses the out-of-range percentage in %j",
      (input) => {
        const result = parseAtmosphereCommands(input);
        expect(result.commands).toEqual([]);
        expect(result.issues[0]?.reason).toBe("invalid-number");
      },
    );

    it("refuses a fractional percentage", () => {
      const result = parseAtmosphereCommands("density 12.5");
      expect(result.commands).toEqual([]);
      expect(result.issues).toEqual([
        { reason: "invalid-number", text: "12.5", property: "density" },
      ]);
    });

    it.each(["color chartreuse", "color #12345", "color #12345g", "色 こん"])(
      "refuses the unknown color in %j",
      (input) => {
        const result = parseAtmosphereCommands(input);
        expect(result.commands).toEqual([]);
        expect(result.issues[0]?.reason).toBe("invalid-color");
      },
    );

    it("names the offending value in the refusal text", () => {
      const result = parseAtmosphereCommands("color chartreuse");
      expect(describeAtmosphereRefusal(result.issues)).toBe(
        '"chartreuse" is not a known color name or a #rrggbb value. Nothing changed.',
      );
    });
  });
});
