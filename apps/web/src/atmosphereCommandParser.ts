/**
 * Bounded local grammar for the Atmosphere Console.
 *
 * The parser is a finite, offline recognizer. It never evaluates code, never
 * reads project or chat context, never opens a network connection, and never
 * sends the operator's wording to a provider. Every accepted phrase maps onto
 * a falling-effect control that this build actually ships.
 *
 * Recognition is all-or-nothing. A request is split into at most
 * `MAX_ATMOSPHERE_COMMANDS_PER_REQUEST` segments and every segment must match
 * exactly one rule. If any segment is unknown, malformed, or names a feature
 * this build does not install, the whole request is refused and no command is
 * returned, so a partially understood sentence can never report success.
 */
import type { FallingEffectMatrixMotionMode } from "@cafecode/contracts/settings";

export const MAX_ATMOSPHERE_COMMAND_LENGTH = 500;
export const MAX_ATMOSPHERE_COMMANDS_PER_REQUEST = 4;

/** Percent-addressed falling-effect properties. */
export type AtmospherePercentProperty = "density" | "speed" | "opacity" | "japanese-ratio";

/** Properties that accept a relative step. Japanese ratio is absolute only. */
export type AtmosphereAdjustProperty = "density" | "speed" | "opacity";

export type AtmosphereResetTarget =
  | "all"
  | "effect"
  | "motion"
  | "color"
  | AtmospherePercentProperty;

export type AtmosphereCommand =
  | {
      readonly kind: "set-effect";
      readonly effect: "off" | "snow" | "rain" | "matrix";
    }
  | {
      readonly kind: "set-motion";
      readonly motion: FallingEffectMatrixMotionMode;
    }
  | { readonly kind: "set-color"; readonly color: string }
  | {
      readonly kind: "set-percent";
      readonly property: AtmospherePercentProperty;
      readonly percent: number;
    }
  | {
      readonly kind: "adjust";
      readonly property: AtmosphereAdjustProperty;
      readonly direction: "increase" | "decrease";
    }
  | { readonly kind: "reset"; readonly target: AtmosphereResetTarget };

/** Features named by the source console that this build does not install. */
export type AtmosphereMissingFeature = "media" | "visualizer" | "2ch" | "model-interpreter";

export type AtmosphereCommandIssue =
  | { readonly reason: "empty" }
  | { readonly reason: "too-long"; readonly length: number }
  | { readonly reason: "too-many-commands"; readonly count: number }
  | {
      readonly reason: "unsupported-feature";
      readonly text: string;
      readonly feature: AtmosphereMissingFeature;
    }
  | {
      readonly reason: "invalid-number";
      readonly text: string;
      readonly property: AtmospherePercentProperty;
    }
  | { readonly reason: "invalid-color"; readonly text: string }
  | { readonly reason: "conflicting"; readonly text: string }
  | { readonly reason: "unknown"; readonly text: string };

export interface AtmosphereParseResult {
  /** Non-empty only when every segment was recognized. */
  readonly commands: readonly AtmosphereCommand[];
  /** Non-empty whenever the request was refused. */
  readonly issues: readonly AtmosphereCommandIssue[];
}

/** The complete fixed color vocabulary. Anything else must be a hex triplet. */
const NAMED_COLORS: Readonly<Record<string, string>> = {
  amber: "#fbbf24",
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
  赤: "#f87171",
  青: "#60a5fa",
  緑: "#4ade80",
  黄: "#fde047",
  白: "#ffffff",
  紫: "#c084fc",
  桃: "#f472b6",
  橙: "#fb923c",
};

const EFFECT_WORDS: Readonly<Record<string, "off" | "snow" | "rain" | "matrix">> = {
  off: "off",
  none: "off",
  stop: "off",
  disable: "off",
  オフ: "off",
  なし: "off",
  停止: "off",
  snow: "snow",
  雪: "snow",
  rain: "rain",
  雨: "rain",
  matrix: "matrix",
  マトリックス: "matrix",
  マトリクス: "matrix",
};

const MOTION_WORDS: Readonly<Record<string, FallingEffectMatrixMotionMode>> = {
  flat: "flat",
  平坦: "flat",
  forward: "forward",
  前進: "forward",
  reverse: "reverse",
  後退: "reverse",
  warp: "tunnel",
  tunnel: "tunnel",
  ワープ: "tunnel",
  "walk forward": "walk-forward",
  "walk-forward": "walk-forward",
  ウォーク前進: "walk-forward",
  "walk reverse": "walk-reverse",
  "walk-reverse": "walk-reverse",
  ウォーク後退: "walk-reverse",
};

const PERCENT_PROPERTY_WORDS: Readonly<Record<string, AtmospherePercentProperty>> = {
  density: "density",
  密度: "density",
  speed: "speed",
  速度: "speed",
  opacity: "opacity",
  不透明度: "opacity",
  japanese: "japanese-ratio",
  "japanese ratio": "japanese-ratio",
  jp: "japanese-ratio",
  日本語: "japanese-ratio",
  日本語比率: "japanese-ratio",
};

const RESET_TARGET_WORDS: Readonly<Record<string, AtmosphereResetTarget>> = {
  all: "all",
  atmosphere: "all",
  everything: "all",
  すべて: "all",
  全部: "all",
  effect: "effect",
  effects: "effect",
  効果: "effect",
  motion: "motion",
  モーション: "motion",
  color: "color",
  colour: "color",
  色: "color",
};

/**
 * Vocabulary from the upstream console whose backing features (media player,
 * 2ch enrichment, visualizers, model interpreters) are not part of this build.
 * Naming one produces an explicit refusal instead of a vague "unknown", so a
 * mixed sentence can never look partially successful.
 */
const MISSING_FEATURE_WORDS: ReadonlyArray<readonly [RegExp, AtmosphereMissingFeature]> = [
  // Ordered most specific first: "next visualizer" names a visualizer, not the
  // media transport that also owns the word "next".
  [/\bvisuali[sz](?:er|ation)\b|ビジュアライザ/u, "visualizer"],
  [/\b2ch\b|２ch/u, "2ch"],
  [/\b(?:lm ?studio|gpt|claude|codex|llm|model)\b|モデル/u, "model-interpreter"],
  [/\b(?:song|track|music|video|media|playlist|volume|mute)\b|曲|音楽|動画/u, "media"],
  [/\b(?:youtube|spotify)\b/u, "media"],
  [/\bhttps?\s*\/\//u, "media"],
  [/\b(?:play|pause|resume|skip|next|previous|rewind)\b|再生|一時停止/u, "media"],
];

const SEGMENT_SEPARATOR = /[,;\n、。]+|\s+and\s+|\s*そして\s*/u;

function lookupWord<T>(words: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(words, key) ? words[key] : undefined;
}

function normalize(input: string): string {
  return input
    .replace(/[’']/gu, "")
    .replace(/[０-９]/gu, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/％/gu, "%")
    .replace(/[：:]/gu, " ")
    .replace(/\r\n?/gu, "\n")
    .replace(/[^\S\n]+/gu, " ")
    .trim()
    .toLowerCase();
}

function matchMissingFeature(segment: string): AtmosphereMissingFeature | null {
  for (const [pattern, feature] of MISSING_FEATURE_WORDS) {
    if (pattern.test(segment)) return feature;
  }
  return null;
}

/** Parses a bare integer percentage. Rejects fractions and out-of-range values. */
function parsePercent(raw: string): number | null {
  if (!/^\d{1,3}$/u.test(raw)) return null;
  const value = Number(raw);
  return value >= 0 && value <= 100 ? value : null;
}

function commandKey(command: AtmosphereCommand): string {
  switch (command.kind) {
    case "set-percent":
      return command.property;
    case "adjust":
      return command.property;
    case "reset":
      return command.target;
    case "set-effect":
      return "effect";
    case "set-motion":
      return "motion";
    case "set-color":
      return "color";
  }
}

type SegmentOutcome =
  | { readonly ok: true; readonly command: AtmosphereCommand }
  | { readonly ok: false; readonly issue: AtmosphereCommandIssue };

function parseSegment(segment: string): SegmentOutcome {
  const missingFeature = matchMissingFeature(segment);
  if (missingFeature) {
    return {
      ok: false,
      issue: {
        reason: "unsupported-feature",
        text: segment,
        feature: missingFeature,
      },
    };
  }

  // A reset, optionally targeted at one property.
  const reset = segment.match(/^(?:reset|リセット)(?:\s+(.+))?$/u);
  if (reset) {
    const rawTarget = reset[1]?.trim();
    if (!rawTarget) return { ok: true, command: { kind: "reset", target: "all" } };
    const target =
      lookupWord(PERCENT_PROPERTY_WORDS, rawTarget) ?? lookupWord(RESET_TARGET_WORDS, rawTarget);
    if (target) return { ok: true, command: { kind: "reset", target } };
    return { ok: false, issue: { reason: "unknown", text: segment } };
  }
  const resetSuffix = segment.match(/^(.+?)\s*(?:を)?リセット$/u);
  if (resetSuffix) {
    const rawTarget = resetSuffix[1]!.trim();
    const target =
      lookupWord(PERCENT_PROPERTY_WORDS, rawTarget) ?? lookupWord(RESET_TARGET_WORDS, rawTarget);
    if (target) return { ok: true, command: { kind: "reset", target } };
    return { ok: false, issue: { reason: "unknown", text: segment } };
  }

  // Colors. A color keyword is required so a bare word cannot become a color.
  const color = segment.match(/^(?:color|colour|色)\s*(?:to|=|は)?\s*(.+)$/u);
  if (color) {
    const rawColor = color[1]!.trim();
    if (rawColor === "auto" || rawColor === "自動") {
      return { ok: true, command: { kind: "set-color", color: "auto" } };
    }
    if (/^#[0-9a-f]{6}$/u.test(rawColor)) {
      return { ok: true, command: { kind: "set-color", color: rawColor } };
    }
    const named = lookupWord(NAMED_COLORS, rawColor);
    if (named) return { ok: true, command: { kind: "set-color", color: named } };
    return { ok: false, issue: { reason: "invalid-color", text: rawColor } };
  }

  // Motion modes, with the keyword before or after the mode name.
  const motion = segment.match(/^(?:motion|モーション)\s*(?:to|=|は)?\s*(.+)$/u);
  if (motion) {
    const mode = lookupWord(MOTION_WORDS, motion[1]!.trim());
    if (mode) return { ok: true, command: { kind: "set-motion", motion: mode } };
    return { ok: false, issue: { reason: "unknown", text: segment } };
  }
  const motionSuffix = segment.match(/^(.+?)\s*(?:motion|モーション)$/u);
  if (motionSuffix) {
    const mode = lookupWord(MOTION_WORDS, motionSuffix[1]!.trim());
    if (mode) return { ok: true, command: { kind: "set-motion", motion: mode } };
    return { ok: false, issue: { reason: "unknown", text: segment } };
  }

  // Absolute percentages: "density 60", "japanese 70%", "密度 60%".
  const percent = segment.match(/^(.+?)\s*(?:to|at|=|は)?\s*(\d+(?:\.\d+)?)\s*%?$/u);
  if (percent) {
    const property = lookupWord(PERCENT_PROPERTY_WORDS, percent[1]!.trim());
    if (property) {
      const value = parsePercent(percent[2]!);
      if (value === null) {
        return {
          ok: false,
          issue: { reason: "invalid-number", text: percent[2]!, property },
        };
      }
      return {
        ok: true,
        command: { kind: "set-percent", property, percent: value },
      };
    }
  }

  // Relative steps: "density up", "speed down", "密度 上げる", "faster", "slower".
  if (/^(?:faster|速く)$/u.test(segment)) {
    return {
      ok: true,
      command: { kind: "adjust", property: "speed", direction: "increase" },
    };
  }
  if (/^(?:slower|遅く)$/u.test(segment)) {
    return {
      ok: true,
      command: { kind: "adjust", property: "speed", direction: "decrease" },
    };
  }
  const adjust = segment.match(/^(.+?)\s*(up|down|increase|decrease|\+|-|上げる|下げる)$/u);
  if (adjust) {
    const property = lookupWord(PERCENT_PROPERTY_WORDS, adjust[1]!.replace(/を$/u, "").trim());
    if (property === "japanese-ratio") {
      return { ok: false, issue: { reason: "unknown", text: segment } };
    }
    if (property) {
      const raised = /^(?:up|increase|\+|上げる)$/u.test(adjust[2]!);
      return {
        ok: true,
        command: {
          kind: "adjust",
          property,
          direction: raised ? "increase" : "decrease",
        },
      };
    }
  }

  // Effects last, so "matrix motion" and "color red" cannot be swallowed here.
  const effectOff = segment.match(
    /^(?:turn|switch|set)\s+off\s+(?:the\s+)?(?:falling\s+)?(?:effects?|snow|rain|matrix)$/u,
  );
  if (effectOff) return { ok: true, command: { kind: "set-effect", effect: "off" } };
  const effectPhrase = segment.match(
    /^(?:(?:turn|switch|set|use|show|make)\s+)?(?:the\s+)?(?:falling\s+)?(?:effects?\s+)?(.+?)(?:\s+(?:on|effect|effects))?$/u,
  );
  if (effectPhrase) {
    const effect = lookupWord(EFFECT_WORDS, effectPhrase[1]!.trim());
    if (effect) return { ok: true, command: { kind: "set-effect", effect } };
  }

  return { ok: false, issue: { reason: "unknown", text: segment } };
}

/**
 * Recognizes a bounded atmosphere request. Returns commands only when every
 * segment matched a rule this build can actually apply.
 */
export function parseAtmosphereCommands(rawInput: string): AtmosphereParseResult {
  const trimmed = rawInput.trim();
  if (!trimmed) return { commands: [], issues: [{ reason: "empty" }] };
  if (trimmed.length > MAX_ATMOSPHERE_COMMAND_LENGTH) {
    return {
      commands: [],
      issues: [{ reason: "too-long", length: trimmed.length }],
    };
  }

  const segments = normalize(trimmed)
    .split(SEGMENT_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return { commands: [], issues: [{ reason: "empty" }] };
  if (segments.length > MAX_ATMOSPHERE_COMMANDS_PER_REQUEST) {
    return {
      commands: [],
      issues: [{ reason: "too-many-commands", count: segments.length }],
    };
  }

  const commands: AtmosphereCommand[] = [];
  const issues: AtmosphereCommandIssue[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const outcome = parseSegment(segment);
    if (!outcome.ok) {
      issues.push(outcome.issue);
      continue;
    }
    const key = commandKey(outcome.command);
    if (seen.has(key) || seen.has("all") || (key === "all" && seen.size > 0)) {
      issues.push({ reason: "conflicting", text: segment });
      continue;
    }
    seen.add(key);
    commands.push(outcome.command);
  }

  // Fully validate before applying: one bad segment refuses the whole request.
  if (issues.length > 0) return { commands: [], issues };
  return { commands, issues: [] };
}

/** Operator-facing wording for a refusal. */
export function describeAtmosphereIssue(issue: AtmosphereCommandIssue): string {
  switch (issue.reason) {
    case "empty":
      return "Type a command first.";
    case "too-long":
      return `Requests are limited to ${MAX_ATMOSPHERE_COMMAND_LENGTH} characters. That one had ${issue.length}.`;
    case "too-many-commands":
      return `Requests are limited to ${MAX_ATMOSPHERE_COMMANDS_PER_REQUEST} commands. That one had ${issue.count}.`;
    case "unsupported-feature":
      switch (issue.feature) {
        case "media":
          return `"${issue.text}" asks for media playback, which this build does not install.`;
        case "visualizer":
          return `"${issue.text}" asks for a visualizer, which this build does not install.`;
        case "2ch":
          return `"${issue.text}" asks for 2ch enrichment, which this build does not install.`;
        case "model-interpreter":
          return `"${issue.text}" asks for a model interpreter. This console is local only.`;
      }
      break;
    case "invalid-number":
      return `"${issue.text}" is not a whole percentage from 0 to 100 for ${issue.property}.`;
    case "invalid-color":
      return `"${issue.text}" is not a known color name or a #rrggbb value.`;
    case "conflicting":
      return `"${issue.text}" repeats a setting already given in this request.`;
    case "unknown":
      return `"${issue.text}" is not a command this console understands.`;
  }
  return "That request was refused.";
}

/** Joins refusals into one status line and states that nothing was applied. */
export function describeAtmosphereRefusal(issues: readonly AtmosphereCommandIssue[]): string {
  if (issues.length === 0) return "That request was refused. Nothing changed.";
  return `${issues.map(describeAtmosphereIssue).join(" ")} Nothing changed.`;
}
