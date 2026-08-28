import { DEFAULT_UNIFIED_SETTINGS } from "@cafecode/contracts/settings";
import { describe, expect, it } from "vitest";

import {
  createMatrixAtmosphereRestorePatch,
  listChangedMatrixAtmosphereSettingLabels,
} from "./matrixAtmosphereSettings";

describe("global Matrix atmosphere reset", () => {
  it("reports and resets every non-default palette, motion, and enrichment value", () => {
    const changed = {
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectMatrixBaseFontSize: 28,
      fallingEffectMatrixColorMode: "rainbow-extra" as const,
      fallingEffectMatrixColorCycleSpeed: 32,
      fallingEffectMatrixMotionMode: "tunnel" as const,
      fallingEffectMatrixWalkStartFontSize: 12,
      fallingEffectMatrixWalkEndFontSize: 24,
      fallingEffectMatrixWalkLifecyclePercent: 55,
      fallingEffectMatrixCenterWindIntensity: 9,
      fallingEffect2chEnriched: true,
      fallingEffectLiveWorkVocabulary: true,
      fallingEffectActivityLinks: true,
      fallingEffectActivityLinkNetworkEnabled: false,
      fallingEffectActivityLinkDatabaseEnabled: false,
      fallingEffectActivityLinkBuildEnabled: false,
      fallingEffectActivityLinkAgentEnabled: false,
      fallingEffectActivityLinkWorkEnabled: false,
      fallingEffectActivityLinkColorMode: "matrix" as const,
      fallingEffectActivityLinkRetentionSeconds: 90,
    };

    expect(listChangedMatrixAtmosphereSettingLabels(changed)).toEqual([
      "Matrix base font size",
      "Matrix color mode",
      "Matrix color-cycle speed",
      "Atmosphere motion",
      "Walk perspective sizes",
      "Walk symbol lifecycle distance",
      "Motion from center wind intensity",
      "2ch-inspired Matrix enrichment",
      "Matrix live work vocabulary",
      "Matrix activity links",
      "Matrix activity link inputs",
      "Matrix activity link colors",
      "Matrix verified route visibility",
    ]);
    expect(createMatrixAtmosphereRestorePatch()).toEqual({
      fallingEffectMatrixBaseFontSize: 14,
      fallingEffectMatrixColorMode: "fixed",
      fallingEffectMatrixColorCycleSpeed: 1,
      fallingEffectMatrixMotionMode: "flat",
      fallingEffectMatrixWalkStartFontSize: 1,
      fallingEffectMatrixWalkEndFontSize: 72,
      fallingEffectMatrixWalkLifecyclePercent: 30,
      fallingEffectMatrixCenterWindIntensity: 4,
      fallingEffect2chEnriched: false,
      fallingEffectLiveWorkVocabulary: false,
      fallingEffectActivityLinks: false,
      fallingEffectActivityLinkNetworkEnabled: true,
      fallingEffectActivityLinkDatabaseEnabled: true,
      fallingEffectActivityLinkBuildEnabled: true,
      fallingEffectActivityLinkAgentEnabled: true,
      fallingEffectActivityLinkWorkEnabled: true,
      fallingEffectActivityLinkColorMode: "random",
      fallingEffectActivityLinkRetentionSeconds: 30,
    });
  });
});
