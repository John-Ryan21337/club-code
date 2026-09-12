import { parseAtmosphereCommands, type AtmosphereCommand } from "./atmosphereCommandParser";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function member(value: unknown, choices: readonly string[]): value is string {
  return typeof value === "string" && choices.includes(value);
}

const PERCENT_PROPERTIES = ["density", "speed", "opacity", "japanese-ratio"] as const;

/** Model output can name only the same bounded controls as the local parser. */
export function decodeAtmosphereModelProposal(value: unknown): readonly AtmosphereCommand[] {
  if (!record(value) || !fields(value, ["commands"]) || !Array.isArray(value.commands)) return [];
  if (value.commands.length === 0 || value.commands.length > 4) return [];
  const phrases: string[] = [];
  for (const command of value.commands) {
    if (!record(command)) return [];
    switch (command.kind) {
      case "set-effect":
        if (
          !fields(command, ["kind", "effect"]) ||
          !member(command.effect, ["off", "snow", "rain", "matrix"])
        )
          return [];
        phrases.push(command.effect);
        break;
      case "set-motion":
        if (
          !fields(command, ["kind", "motion"]) ||
          !member(command.motion, [
            "flat",
            "forward",
            "reverse",
            "tunnel",
            "walk-forward",
            "walk-reverse",
          ])
        )
          return [];
        phrases.push(`motion ${command.motion}`);
        break;
      case "set-color":
        if (
          !fields(command, ["kind", "color"]) ||
          typeof command.color !== "string" ||
          !/^(?:auto|#[\da-f]{6})$/iu.test(command.color)
        )
          return [];
        phrases.push(`color ${command.color}`);
        break;
      case "set-percent":
        if (
          !fields(command, ["kind", "property", "percent"]) ||
          !member(command.property, PERCENT_PROPERTIES) ||
          typeof command.percent !== "number" ||
          !Number.isInteger(command.percent) ||
          command.percent < 0 ||
          command.percent > 100
        )
          return [];
        phrases.push(
          `${command.property === "japanese-ratio" ? "japanese" : command.property} ${command.percent}`,
        );
        break;
      case "adjust":
        if (
          !fields(command, ["kind", "property", "direction"]) ||
          !member(command.property, ["density", "speed", "opacity"]) ||
          !member(command.direction, ["increase", "decrease"])
        )
          return [];
        phrases.push(`${command.property} ${command.direction}`);
        break;
      case "reset":
        if (
          !fields(command, ["kind", "target"]) ||
          !member(command.target, ["all", "effect", "motion", "color", ...PERCENT_PROPERTIES])
        )
          return [];
        phrases.push(`reset ${command.target === "japanese-ratio" ? "japanese" : command.target}`);
        break;
      default:
        return [];
    }
  }
  // The parser also enforces duplicate/overlapping-property refusal for the batch.
  return parseAtmosphereCommands(phrases.join(", ")).commands;
}
