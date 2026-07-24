export const MAX_ATMOSPHERE_COMMAND_LENGTH = 500;
export const MAX_ATMOSPHERE_COMMANDS_PER_REQUEST = 4;

export type AtmosphereCommand =
  | {
      readonly kind: "set-effect";
      readonly effect: "off" | "snow" | "rain" | "matrix";
    }
  | {
      readonly kind: "adjust-effect";
      readonly property: "density" | "speed" | "opacity";
      readonly direction: "increase" | "decrease";
    }
  | {
      readonly kind: "set-effect-value";
      readonly property: "density" | "speed" | "opacity" | "japanese-ratio";
      readonly percent: number;
    }
  | {
      readonly kind: "set-effect-color";
      readonly color: string;
    }
  | {
      readonly kind: "set-2ch";
      readonly enabled: boolean;
    }
  | {
      readonly kind: "media-transport";
      readonly action: "next" | "previous" | "play" | "pause" | "stop";
    }
  | {
      readonly kind: "play-url";
      readonly url: string;
    }
  | {
      readonly kind: "visualizer";
      readonly action: "next" | "previous" | "random" | "toggle";
    };

const NAMED_COLORS: Readonly<Record<string, string>> = {
  aqua: "#22d3ee",
  blue: "#60a5fa",
  cyan: "#22d3ee",
  gold: "#fbbf24",
  green: "#4ade80",
  orange: "#fb923c",
  pink: "#f472b6",
  purple: "#c084fc",
  red: "#f87171",
  violet: "#a78bfa",
  white: "#ffffff",
  yellow: "#fde047",
};

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function pushBounded(commands: AtmosphereCommand[], command: AtmosphereCommand): void {
  if (commands.length >= MAX_ATMOSPHERE_COMMANDS_PER_REQUEST) return;
  const key =
    command.kind === "adjust-effect" || command.kind === "set-effect-value"
      ? `${command.kind}:${command.property}`
      : command.kind;
  const existingIndex = commands.findIndex((candidate) => {
    if (candidate.kind === "adjust-effect" || candidate.kind === "set-effect-value") {
      return `${candidate.kind}:${candidate.property}` === key;
    }
    return candidate.kind === command.kind;
  });
  if (existingIndex >= 0) {
    commands.splice(existingIndex, 1);
  }
  commands.push(command);
}

function extractSafeMediaUrl(input: string): string | null {
  const match = input.match(/https:\/\/[^\s<>"']+/iu);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    const hostname = url.hostname.toLowerCase();
    if (
      hostname !== "youtube.com" &&
      hostname !== "www.youtube.com" &&
      hostname !== "m.youtube.com" &&
      hostname !== "youtu.be" &&
      hostname !== "music.youtube.com" &&
      hostname !== "open.spotify.com"
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Decodes an optional local-model proposal through the same narrow command
 * boundary as the deterministic parser. A model cannot introduce a media URL
 * that the operator did not type.
 */
export function decodeAtmosphereCommandProposal(
  value: unknown,
  operatorInput: string,
): readonly AtmosphereCommand[] {
  if (!isRecord(value) || !Array.isArray(value.commands)) return [];
  const commands: AtmosphereCommand[] = [];
  const typedUrl = extractSafeMediaUrl(operatorInput);

  for (const candidate of value.commands.slice(0, MAX_ATMOSPHERE_COMMANDS_PER_REQUEST)) {
    if (!isRecord(candidate) || typeof candidate.kind !== "string") continue;
    switch (candidate.kind) {
      case "set-effect":
        if (
          candidate.effect === "off" ||
          candidate.effect === "snow" ||
          candidate.effect === "rain" ||
          candidate.effect === "matrix"
        ) {
          pushBounded(commands, { kind: "set-effect", effect: candidate.effect });
        }
        break;
      case "adjust-effect":
        if (
          (candidate.property === "density" ||
            candidate.property === "speed" ||
            candidate.property === "opacity") &&
          (candidate.direction === "increase" || candidate.direction === "decrease")
        ) {
          pushBounded(commands, {
            kind: "adjust-effect",
            property: candidate.property,
            direction: candidate.direction,
          });
        }
        break;
      case "set-effect-value":
        if (
          (candidate.property === "density" ||
            candidate.property === "speed" ||
            candidate.property === "opacity" ||
            candidate.property === "japanese-ratio") &&
          typeof candidate.percent === "number" &&
          Number.isFinite(candidate.percent) &&
          candidate.percent >= 0 &&
          candidate.percent <= 100
        ) {
          pushBounded(commands, {
            kind: "set-effect-value",
            property: candidate.property,
            percent: clampPercent(candidate.percent),
          });
        }
        break;
      case "set-effect-color":
        if (typeof candidate.color === "string" && /^#[0-9a-f]{6}$/iu.test(candidate.color)) {
          pushBounded(commands, {
            kind: "set-effect-color",
            color: candidate.color.toLowerCase(),
          });
        }
        break;
      case "set-2ch":
        if (typeof candidate.enabled === "boolean") {
          pushBounded(commands, { kind: "set-2ch", enabled: candidate.enabled });
        }
        break;
      case "media-transport":
        if (
          candidate.action === "next" ||
          candidate.action === "previous" ||
          candidate.action === "play" ||
          candidate.action === "pause" ||
          candidate.action === "stop"
        ) {
          pushBounded(commands, { kind: "media-transport", action: candidate.action });
        }
        break;
      case "visualizer":
        if (
          candidate.action === "next" ||
          candidate.action === "previous" ||
          candidate.action === "random" ||
          candidate.action === "toggle"
        ) {
          pushBounded(commands, { kind: "visualizer", action: candidate.action });
        }
        break;
      case "play-url":
        if (typeof candidate.url === "string" && typedUrl !== null && candidate.url === typedUrl) {
          pushBounded(commands, { kind: "play-url", url: typedUrl });
        }
        break;
    }
  }

  return commands;
}

/**
 * Parses common atmosphere/media requests locally. It never evaluates code,
 * touches project context, or sends the operator's wording to a provider.
 */
export function parseAtmosphereCommands(rawInput: string): readonly AtmosphereCommand[] {
  const input = rawInput.trim().slice(0, MAX_ATMOSPHERE_COMMAND_LENGTH);
  if (!input) return [];
  const normalized = input.toLowerCase().replace(/[’']/gu, "");
  const commands: AtmosphereCommand[] = [];

  const mediaUrl = extractSafeMediaUrl(input);
  if (mediaUrl && /\b(play|open|load|put on|watch|listen)\b/iu.test(normalized)) {
    pushBounded(commands, { kind: "play-url", url: mediaUrl });
  }

  const effectMatches = Array.from(normalized.matchAll(/\b(snow|rain|matrix)\b/gu));
  const requestsEffectChange =
    /\b(turn|switch|change|set|use|start|show|make|give me|i want)\b/iu.test(normalized) ||
    /\b(?:snow|rain|matrix)\s+(?:on|effect)\b/iu.test(normalized) ||
    /\b(?:to|into)\s+(?:snow|rain|matrix)\b/iu.test(normalized) ||
    /^(?:snow|rain|matrix)(?:\s+please)?[.!]?$/iu.test(normalized);
  const requestsEffectOff =
    /\b(?:turn|switch|set)\s+(?:the\s+)?(?:falling\s+)?(?:effect|effects|snow|rain|matrix)\s+off\b/iu.test(
      normalized,
    ) ||
    /\bturn\s+off\s+(?:the\s+)?(?:falling\s+)?(?:effect|effects|snow|rain|matrix)\b/iu.test(
      normalized,
    ) ||
    /\b(?:disable|hide|stop)\s+(?:the\s+)?(?:falling\s+)?(?:effect|effects|snow|rain|matrix)\b/iu.test(
      normalized,
    );
  if (requestsEffectOff) {
    pushBounded(commands, { kind: "set-effect", effect: "off" });
  } else if (effectMatches.length > 0 && requestsEffectChange) {
    const requestedEffect = effectMatches.at(-1)?.[1] as "snow" | "rain" | "matrix";
    pushBounded(commands, { kind: "set-effect", effect: requestedEffect });
  }

  const explicitJapanese = normalized.match(
    /\b(\d{1,3})(?:\s*%)?\s*(?:japanese|jp|nihongo|日本語)\b/iu,
  );
  const explicitEnglish = normalized.match(/\b(\d{1,3})(?:\s*%)?\s*(?:english|en|英語)\b/iu);
  if (/\b(?:all|full|100(?:\s*%)?)\s+(?:japanese|jp|nihongo)\b/iu.test(normalized)) {
    pushBounded(commands, {
      kind: "set-effect-value",
      property: "japanese-ratio",
      percent: 100,
    });
  } else if (/\b(?:all|full|100(?:\s*%)?)\s+(?:english|en)\b/iu.test(normalized)) {
    pushBounded(commands, {
      kind: "set-effect-value",
      property: "japanese-ratio",
      percent: 0,
    });
  } else if (explicitJapanese) {
    pushBounded(commands, {
      kind: "set-effect-value",
      property: "japanese-ratio",
      percent: clampPercent(Number(explicitJapanese[1])),
    });
  } else if (explicitEnglish) {
    pushBounded(commands, {
      kind: "set-effect-value",
      property: "japanese-ratio",
      percent: 100 - clampPercent(Number(explicitEnglish[1])),
    });
  }

  const numericProperties = [
    ["density", "density|particles?|amount"],
    ["speed", "speed"],
    ["opacity", "opacity|visibility"],
  ] as const;
  for (const [property, pattern] of numericProperties) {
    const match = normalized.match(
      new RegExp(`\\b(?:${pattern})\\s*(?:to|at|=)?\\s*(\\d{1,3})\\s*%?`, "iu"),
    );
    if (match) {
      pushBounded(commands, {
        kind: "set-effect-value",
        property,
        percent: clampPercent(Number(match[1])),
      });
    }
  }
  const transparentMatch = normalized.match(
    /\b(?:transparency|transparent)\s*(?:to|at|=)?\s*(\d{1,3})\s*%?/iu,
  );
  if (transparentMatch) {
    pushBounded(commands, {
      kind: "set-effect-value",
      property: "opacity",
      percent: 100 - clampPercent(Number(transparentMatch[1])),
    });
  }

  if (
    /\b(more|denser|heavier|thicker|increase|raise)\b.{0,24}\b(particles?|density|snow|rain|matrix)\b/iu.test(
      normalized,
    ) ||
    /\b(particles?|density|snow|rain|matrix)\b.{0,24}\b(more|denser|heavier|thicker|increase|raise)\b/iu.test(
      normalized,
    ) ||
    /\b(more|denser|heavier|thicker)\s+(snow|rain|matrix)\b/iu.test(normalized)
  ) {
    pushBounded(commands, {
      kind: "adjust-effect",
      property: "density",
      direction: "increase",
    });
  } else if (
    /\b(less|sparser|lighter|thinner|decrease|lower|reduce)\b.{0,24}\b(particles?|density|snow|rain|matrix)\b/iu.test(
      normalized,
    ) ||
    /\b(particles?|density|snow|rain|matrix)\b.{0,24}\b(less|sparser|lighter|thinner|decrease|lower|reduce)\b/iu.test(
      normalized,
    )
  ) {
    pushBounded(commands, {
      kind: "adjust-effect",
      property: "density",
      direction: "decrease",
    });
  }

  if (/\b(faster|speed up|increase speed)\b/iu.test(normalized)) {
    pushBounded(commands, {
      kind: "adjust-effect",
      property: "speed",
      direction: "increase",
    });
  } else if (/\b(slower|slow down|decrease speed|reduce speed)\b/iu.test(normalized)) {
    pushBounded(commands, {
      kind: "adjust-effect",
      property: "speed",
      direction: "decrease",
    });
  }

  if (/\b(more transparent|less visible|lower opacity)\b/iu.test(normalized)) {
    pushBounded(commands, {
      kind: "adjust-effect",
      property: "opacity",
      direction: "decrease",
    });
  } else if (/\b(less transparent|more visible|higher opacity)\b/iu.test(normalized)) {
    pushBounded(commands, {
      kind: "adjust-effect",
      property: "opacity",
      direction: "increase",
    });
  }

  const colorMatch = normalized.match(
    /\b(?:color|colour)\s*(?:to|=|at)?\s*(#[0-9a-f]{6}|[a-z]+)\b/iu,
  );
  if (colorMatch) {
    const rawColor = colorMatch[1]!.toLowerCase();
    const color = rawColor.startsWith("#") ? rawColor : NAMED_COLORS[rawColor];
    if (color) {
      pushBounded(commands, { kind: "set-effect-color", color });
    }
  }

  if (
    /\b(?:enable|turn|switch|set)\s+(?:the\s+)?2ch\s+on\b/iu.test(normalized) ||
    /^2ch\s+on[.!]?$/iu.test(normalized)
  ) {
    pushBounded(commands, { kind: "set-2ch", enabled: true });
  } else if (
    /\b(?:disable|turn|switch|set)\s+(?:the\s+)?2ch\s+off\b/iu.test(normalized) ||
    /^2ch\s+off[.!]?$/iu.test(normalized)
  ) {
    pushBounded(commands, { kind: "set-2ch", enabled: false });
  }

  if (/\b(next|different|another|skip)(?:\s+(?:song|track|video|media))?\b/iu.test(normalized)) {
    pushBounded(commands, { kind: "media-transport", action: "next" });
  } else if (
    /\b(previous|prior|last|go back)(?:\s+(?:song|track|video|media))?\b/iu.test(normalized)
  ) {
    pushBounded(commands, { kind: "media-transport", action: "previous" });
  } else if (/\b(?:pause)\s+(?:the\s+)?(?:song|track|video|media|music)\b/iu.test(normalized)) {
    pushBounded(commands, { kind: "media-transport", action: "pause" });
  } else if (
    /\b(?:resume|play)\s+(?:the\s+)?(?:song|track|video|media|music)\b/iu.test(normalized)
  ) {
    pushBounded(commands, { kind: "media-transport", action: "play" });
  } else if (/\b(?:stop)\s+(?:the\s+)?(?:song|track|video|media|music)\b/iu.test(normalized)) {
    pushBounded(commands, { kind: "media-transport", action: "stop" });
  }

  if (/\b(?:random|shuffle)\s+(?:visuali[sz](?:er|ation)|preset)\b/iu.test(normalized)) {
    pushBounded(commands, { kind: "visualizer", action: "random" });
  } else if (/\bnext\s+(?:visuali[sz](?:er|ation)|preset)\b/iu.test(normalized)) {
    pushBounded(commands, { kind: "visualizer", action: "next" });
  } else if (
    /\b(?:previous|prior|last)\s+(?:visuali[sz](?:er|ation)|preset)\b/iu.test(normalized)
  ) {
    pushBounded(commands, { kind: "visualizer", action: "previous" });
  } else if (/\b(?:toggle|show|hide)\s+(?:the\s+)?visuali[sz](?:er|ation)\b/iu.test(normalized)) {
    pushBounded(commands, { kind: "visualizer", action: "toggle" });
  }

  return commands;
}
