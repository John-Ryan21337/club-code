import { describe, expect, it } from "vitest";

import {
  decodeAtmosphereCommandProposal,
  MAX_ATMOSPHERE_COMMANDS_PER_REQUEST,
  parseAtmosphereCommands,
} from "./atmosphereCommandParser";

describe("parseAtmosphereCommands", () => {
  it("selects the destination effect in conversational changes", () => {
    expect(parseAtmosphereCommands("Change the rain to snow")).toEqual([
      { kind: "set-effect", effect: "snow" },
    ]);
    expect(parseAtmosphereCommands("Turn the falling effects off")).toEqual([
      { kind: "set-effect", effect: "off" },
    ]);
    expect(parseAtmosphereCommands("Turn off matrix")).toEqual([
      { kind: "set-effect", effect: "off" },
    ]);
    expect(parseAtmosphereCommands("matrix")).toEqual([{ kind: "set-effect", effect: "matrix" }]);
  });

  it("adjusts density, speed, opacity, color, and the language mix locally", () => {
    expect(
      parseAtmosphereCommands(
        "Use matrix, make the particles denser and faster, color to violet, 80% Japanese",
      ),
    ).toEqual([
      { kind: "set-effect", effect: "matrix" },
      { kind: "set-effect-value", property: "japanese-ratio", percent: 80 },
      { kind: "adjust-effect", property: "density", direction: "increase" },
      { kind: "adjust-effect", property: "speed", direction: "increase" },
    ]);
    expect(parseAtmosphereCommands("Set transparency to 70%")).toEqual([
      { kind: "set-effect-value", property: "opacity", percent: 30 },
    ]);
    expect(parseAtmosphereCommands("Set color to #12AbEf")).toEqual([
      { kind: "set-effect-color", color: "#12abef" },
    ]);
  });

  it("maps English ratios to the complementary Japanese ratio", () => {
    expect(parseAtmosphereCommands("100% English matrix text")).toEqual([
      { kind: "set-effect-value", property: "japanese-ratio", percent: 0 },
    ]);
    expect(parseAtmosphereCommands("all Japanese")).toEqual([
      { kind: "set-effect-value", property: "japanese-ratio", percent: 100 },
    ]);
  });

  it("controls 2ch, transport, and visualizer presets", () => {
    expect(parseAtmosphereCommands("Turn 2ch on and skip this song")).toEqual([
      { kind: "set-2ch", enabled: true },
      { kind: "media-transport", action: "next" },
    ]);
    expect(parseAtmosphereCommands("Go back to the previous track")).toEqual([
      { kind: "media-transport", action: "previous" },
    ]);
    expect(parseAtmosphereCommands("Give me a random visualizer preset")).toEqual([
      { kind: "visualizer", action: "random" },
    ]);
  });

  it("accepts only allowlisted HTTPS media hosts", () => {
    expect(parseAtmosphereCommands("Play https://youtu.be/dQw4w9WgXcQ?t=1#fragment")).toEqual([
      {
        kind: "play-url",
        url: "https://youtu.be/dQw4w9WgXcQ?t=1",
      },
    ]);
    expect(parseAtmosphereCommands("Play http://youtu.be/dQw4w9WgXcQ")).toEqual([]);
    expect(parseAtmosphereCommands("Play https://example.com/private")).toEqual([]);
  });

  it("fails closed for unknown text and bounds compound requests", () => {
    expect(parseAtmosphereCommands("please make the room feel cozier")).toEqual([]);
    expect(
      parseAtmosphereCommands(
        "matrix, 75% Japanese, more particles, faster, color red, 2ch on, next song",
      ),
    ).toHaveLength(MAX_ATMOSPHERE_COMMANDS_PER_REQUEST);
  });
});

describe("decodeAtmosphereCommandProposal", () => {
  it("accepts only bounded allowlisted commands", () => {
    expect(
      decodeAtmosphereCommandProposal(
        {
          commands: [
            { kind: "set-effect", effect: "snow" },
            { kind: "set-effect-value", property: "opacity", percent: 42.4 },
            { kind: "run-shell", command: "rm -rf" },
            { kind: "set-effect-color", color: "red" },
          ],
        },
        "make it calmer",
      ),
    ).toEqual([
      { kind: "set-effect", effect: "snow" },
      { kind: "set-effect-value", property: "opacity", percent: 42 },
    ]);
  });

  it("does not let a model invent a media URL", () => {
    expect(
      decodeAtmosphereCommandProposal(
        {
          commands: [{ kind: "play-url", url: "https://youtu.be/dQw4w9WgXcQ" }],
        },
        "play something chill",
      ),
    ).toEqual([]);
    expect(
      decodeAtmosphereCommandProposal(
        {
          commands: [{ kind: "play-url", url: "https://youtu.be/dQw4w9WgXcQ" }],
        },
        "play https://youtu.be/dQw4w9WgXcQ",
      ),
    ).toEqual([{ kind: "play-url", url: "https://youtu.be/dQw4w9WgXcQ" }]);
  });
});
