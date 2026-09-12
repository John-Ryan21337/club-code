import { describe, expect, it } from "vitest";
import { decodeAtmosphereModelProposal } from "./atmosphereModelProposal";

describe("decodeAtmosphereModelProposal", () => {
  it.each([
    { kind: "set-effect", effect: "matrix" },
    { kind: "set-motion", motion: "tunnel" },
    { kind: "set-motion", motion: "walk-reverse" },
    { kind: "set-color", color: "#aabbcc" },
    { kind: "set-percent", property: "japanese-ratio", percent: 70 },
    { kind: "adjust", property: "density", direction: "increase" },
    { kind: "reset", target: "motion" },
  ])("accepts installed command %j", (command) => {
    expect(decodeAtmosphereModelProposal({ commands: [command] })).toEqual([command]);
  });

  it.each([
    null,
    { commands: [], explanation: "extra" },
    { commands: [{ kind: "set-effect", effect: "constructor" }] },
    { commands: [{ kind: "set-motion", motion: "warp", shell: "ignored" }] },
    { commands: [{ kind: "set-color", color: "red; snow" }] },
    { commands: [{ kind: "set-percent", property: "density", percent: 120 }] },
    { commands: [{ kind: "set-percent", property: "density", percent: 0.5 }] },
    { commands: [{ kind: "adjust", property: "japanese-ratio", direction: "increase" }] },
    { commands: [{ kind: "play-url", url: "https://example.test" }] },
    {
      commands: [
        { kind: "set-effect", effect: "snow" },
        { kind: "set-effect", effect: "rain" },
      ],
    },
    {
      commands: [
        { kind: "reset", target: "all" },
        { kind: "set-effect", effect: "snow" },
      ],
    },
    { commands: Array.from({ length: 5 }, () => ({ kind: "set-effect", effect: "snow" })) },
  ])("refuses the entire malformed or conflicting proposal %j", (value) => {
    expect(decodeAtmosphereModelProposal(value)).toEqual([]);
  });
});
