/**
 * Translates recognized console commands into a client-settings patch and
 * describes the settings the server actually confirmed.
 *
 * The console never reports success from the patch it sent. It reports the
 * `ClientSettings` value returned by `server.updateClientSettings`, so a
 * rejected, clamped, or partially stored write is described as it landed.
 */
import {
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_OPACITY,
  DEFAULT_FALLING_EFFECT_DENSITY,
  DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
  DEFAULT_FALLING_EFFECT_KIND,
  DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE,
  DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE,
  DEFAULT_FALLING_EFFECT_SPEED,
  DEFAULT_FALLING_EFFECTS_ENABLED,
  MAX_AMBIENT_OPACITY,
  MAX_FALLING_EFFECT_DENSITY,
  MAX_FALLING_EFFECT_JAPANESE_RATIO,
  MAX_FALLING_EFFECT_SPEED,
  MIN_AMBIENT_OPACITY,
  MIN_FALLING_EFFECT_DENSITY,
  MIN_FALLING_EFFECT_JAPANESE_RATIO,
  MIN_FALLING_EFFECT_SPEED,
  type ClientSettings,
  type ClientSettingsPatch,
  type FallingEffectMatrixMotionMode,
} from "@cafecode/contracts/settings";

import type { AtmosphereCommand, AtmospherePercentProperty } from "./atmosphereCommandParser";

/** Relative step applied by an `up` / `down` command, in percent. */
export const ATMOSPHERE_ADJUST_STEP_PERCENT = 10;

interface PercentRange {
  readonly minimum: number;
  readonly maximum: number;
  readonly settingKey: keyof ClientSettings &
    (
      | "fallingEffectDensity"
      | "fallingEffectSpeed"
      | "fallingEffectOpacity"
      | "fallingEffectJapaneseRatio"
    );
  readonly defaultValue: number;
  readonly label: string;
}

const PERCENT_RANGES: Readonly<Record<AtmospherePercentProperty, PercentRange>> = {
  density: {
    minimum: MIN_FALLING_EFFECT_DENSITY,
    maximum: MAX_FALLING_EFFECT_DENSITY,
    settingKey: "fallingEffectDensity",
    defaultValue: DEFAULT_FALLING_EFFECT_DENSITY,
    label: "Density",
  },
  speed: {
    minimum: MIN_FALLING_EFFECT_SPEED,
    maximum: MAX_FALLING_EFFECT_SPEED,
    settingKey: "fallingEffectSpeed",
    defaultValue: DEFAULT_FALLING_EFFECT_SPEED,
    label: "Speed",
  },
  opacity: {
    minimum: MIN_AMBIENT_OPACITY,
    maximum: MAX_AMBIENT_OPACITY,
    settingKey: "fallingEffectOpacity",
    defaultValue: DEFAULT_AMBIENT_OPACITY,
    label: "Opacity",
  },
  "japanese-ratio": {
    minimum: MIN_FALLING_EFFECT_JAPANESE_RATIO,
    maximum: MAX_FALLING_EFFECT_JAPANESE_RATIO,
    settingKey: "fallingEffectJapaneseRatio",
    defaultValue: DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
    label: "Japanese ratio",
  },
};

const MOTION_LABELS: Readonly<Record<FallingEffectMatrixMotionMode, string>> = {
  flat: "Flat",
  forward: "Forward",
  reverse: "Reverse",
  tunnel: "Warp",
  "walk-forward": "Walk Forward",
  "walk-reverse": "Walk Reverse",
};

/** Every falling-effect field a whole-atmosphere reset restores. */
const ATMOSPHERE_RESET_PATCH: ClientSettingsPatch = {
  fallingEffectsEnabled: DEFAULT_FALLING_EFFECTS_ENABLED,
  fallingEffectKind: DEFAULT_FALLING_EFFECT_KIND,
  fallingEffectColor: DEFAULT_AMBIENT_COLOR,
  fallingEffectMatrixColorMode: DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE,
  fallingEffectMatrixMotionMode: DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE,
  fallingEffectOpacity: DEFAULT_AMBIENT_OPACITY,
  fallingEffectSpeed: DEFAULT_FALLING_EFFECT_SPEED,
  fallingEffectDensity: DEFAULT_FALLING_EFFECT_DENSITY,
  fallingEffectJapaneseRatio: DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function atmosphereValueFromPercent(
  percent: number,
  property: AtmospherePercentProperty,
): number {
  const range = PERCENT_RANGES[property];
  return range.minimum + (range.maximum - range.minimum) * (clamp(percent, 0, 100) / 100);
}

export function atmospherePercentFromValue(
  value: number,
  property: AtmospherePercentProperty,
): number {
  const range = PERCENT_RANGES[property];
  const span = range.maximum - range.minimum;
  if (span <= 0) return 0;
  return Math.round(clamp((value - range.minimum) / span, 0, 1) * 100);
}

/**
 * Builds the settings patch for a validated command list. `current` supplies
 * the baseline that relative steps move from; the caller passes the merged
 * settings it is already rendering.
 */
export function buildAtmospherePatch(
  commands: readonly AtmosphereCommand[],
  current: ClientSettings,
): ClientSettingsPatch {
  const patch: Record<string, unknown> = {};
  const readNumber = (key: PercentRange["settingKey"]): number => {
    const patched = patch[key];
    return typeof patched === "number" ? patched : current[key];
  };

  for (const command of commands) {
    switch (command.kind) {
      case "set-effect":
        if (command.effect === "off") {
          patch.fallingEffectsEnabled = false;
        } else {
          patch.fallingEffectsEnabled = true;
          patch.fallingEffectKind = command.effect;
        }
        break;
      case "set-motion":
        patch.fallingEffectMatrixMotionMode = command.motion;
        break;
      case "set-color":
        patch.fallingEffectColor = command.color;
        // A console color request is a fixed-color request. Leaving a cycling
        // mode selected would hide the color the operator just chose.
        patch.fallingEffectMatrixColorMode = "fixed";
        break;
      case "set-percent": {
        const range = PERCENT_RANGES[command.property];
        patch[range.settingKey] = atmosphereValueFromPercent(command.percent, command.property);
        break;
      }
      case "adjust": {
        const range = PERCENT_RANGES[command.property];
        const currentPercent = atmospherePercentFromValue(
          readNumber(range.settingKey),
          command.property,
        );
        const nextPercent = clamp(
          currentPercent +
            (command.direction === "increase" ? 1 : -1) * ATMOSPHERE_ADJUST_STEP_PERCENT,
          0,
          100,
        );
        patch[range.settingKey] = atmosphereValueFromPercent(nextPercent, command.property);
        break;
      }
      case "reset":
        switch (command.target) {
          case "all":
            Object.assign(patch, ATMOSPHERE_RESET_PATCH);
            break;
          case "effect":
            patch.fallingEffectsEnabled = DEFAULT_FALLING_EFFECTS_ENABLED;
            patch.fallingEffectKind = DEFAULT_FALLING_EFFECT_KIND;
            break;
          case "motion":
            patch.fallingEffectMatrixMotionMode = DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE;
            break;
          case "color":
            patch.fallingEffectColor = DEFAULT_AMBIENT_COLOR;
            patch.fallingEffectMatrixColorMode = DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE;
            break;
          default: {
            const range = PERCENT_RANGES[command.target];
            patch[range.settingKey] = range.defaultValue;
            break;
          }
        }
        break;
    }
  }

  return patch as ClientSettingsPatch;
}

/** The settings fields a command list touches, used to report what landed. */
function touchedProperties(
  commands: readonly AtmosphereCommand[],
): ReadonlySet<"effect" | "motion" | "color" | AtmospherePercentProperty> {
  const touched = new Set<"effect" | "motion" | "color" | AtmospherePercentProperty>();
  for (const command of commands) {
    switch (command.kind) {
      case "set-effect":
        touched.add("effect");
        break;
      case "set-motion":
        touched.add("motion");
        break;
      case "set-color":
        touched.add("color");
        break;
      case "set-percent":
      case "adjust":
        touched.add(command.property);
        break;
      case "reset":
        if (command.target === "all") {
          touched.add("effect");
          touched.add("motion");
          touched.add("color");
          touched.add("density");
          touched.add("speed");
          touched.add("opacity");
          touched.add("japanese-ratio");
        } else {
          touched.add(command.target);
        }
        break;
    }
  }
  return touched;
}

/**
 * Describes the confirmed settings for every property the request touched.
 * Reading `confirmed` rather than the sent patch means the status line cannot
 * claim a value the server did not store.
 */
export function describeConfirmedAtmosphere(
  commands: readonly AtmosphereCommand[],
  confirmed: ClientSettings,
): string {
  const touched = touchedProperties(commands);
  const parts: string[] = [];

  if (touched.has("effect")) {
    parts.push(
      confirmed.fallingEffectsEnabled
        ? `Effect ${confirmed.fallingEffectKind}.`
        : "Falling effects off.",
    );
  }
  if (touched.has("motion")) {
    parts.push(`Motion ${MOTION_LABELS[confirmed.fallingEffectMatrixMotionMode]}.`);
  }
  if (touched.has("color")) {
    parts.push(
      confirmed.fallingEffectColor === "auto"
        ? "Color auto."
        : `Color ${confirmed.fallingEffectColor}.`,
    );
  }
  for (const property of ["density", "speed", "opacity", "japanese-ratio"] as const) {
    if (!touched.has(property)) continue;
    const range = PERCENT_RANGES[property];
    parts.push(
      `${range.label} ${atmospherePercentFromValue(confirmed[range.settingKey], property)}%.`,
    );
  }

  if (parts.length === 0) return "Settings confirmed.";
  return `Confirmed: ${parts.join(" ")}`;
}
