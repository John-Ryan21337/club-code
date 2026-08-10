import { createHexagonBackground } from "./runtime/portable.js";

export const backgroundPreset = Object.freeze({
  "kind": "the-hexagons-background",
  "formatVersion": 1,
  "name": "The Hexagons Runtime",
  "target": "club-code",
  "createdAt": "2026-08-09T00:00:00.000Z",
  "settings": {
    "quality": "cinematic",
    "alignmentMode": "seamless",
    "material": "glass",
    "tileBase": "dark",
    "foregroundIllumination": 0.08,
    "pistonMode": "radial",
    "behindLightEnabled": true,
    "behindLightType": "point-bar",
    "behindLightColor": "#21e6d1",
    "behindPrismMode": "white-core",
    "behindPrismStrength": 8,
    "frontLightEnabled": true,
    "frontLightColor": "#86fff2",
    "meshEnergyColor": "#ff2bd6",
    "meshEnergyRainbowCycle": false,
    "fallingSourceProfile": "club-code",
    "fallingEffectKind": "matrix",
    "fallingReflectionEnabled": true,
    "schemaVersion": 7
  },
  "activationHints": {
    "backgroundEnabled": false,
    "fallingEffectsEnabled": false
  },
  "hostPolicyHints": {
    "renderer": "auto",
    "reducedMotion": "system",
    "continueBackgroundAnimations": false
  }
});

export async function mountClubCodeHexagonsBackground(options = {}) {
  const {
    useBundledFallingEffects: requestedBundledFallingEffects,
    settings: requestedSettings,
    ...runtimeOptions
  } = options;
  const useBundledFallingEffects = requestedBundledFallingEffects ?? false;
  const settingsOverride = requestedSettings ?? {};
  const settings = {
    ...backgroundPreset.settings,
    enabled: backgroundPreset.activationHints.backgroundEnabled,
    ...settingsOverride,
    fallingEffectsEnabled:
      useBundledFallingEffects &&
      (settingsOverride.fallingEffectsEnabled ?? backgroundPreset.activationHints.fallingEffectsEnabled),
  };
  return createHexagonBackground({ ...runtimeOptions, preset: undefined, settings });
}

export default mountClubCodeHexagonsBackground;
