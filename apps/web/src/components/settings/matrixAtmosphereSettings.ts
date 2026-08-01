import {
  DEFAULT_UNIFIED_SETTINGS,
  type ClientSettingsPatch,
  type UnifiedSettings,
} from "@cafecode/contracts/settings";

const MATRIX_ATMOSPHERE_SETTING_LABELS = [
  ["fallingEffectMatrixBaseFontSize", "Matrix base font size"],
  ["fallingEffectMatrixColorMode", "Matrix color mode"],
  ["fallingEffectMatrixColorCycleSpeed", "Matrix color-cycle speed"],
  ["fallingEffectMatrixMotionMode", "Atmosphere motion"],
  ["fallingEffectMatrixWalkStartFontSize", "Walk perspective sizes"],
  ["fallingEffectMatrixWalkEndFontSize", "Walk perspective sizes"],
  ["fallingEffectMatrixWalkLifecyclePercent", "Walk symbol lifecycle distance"],
  ["fallingEffectMatrixCenterWindIntensity", "Motion from center wind intensity"],
  ["fallingEffect2chEnriched", "2ch-inspired Matrix enrichment"],
  ["fallingEffectLiveWorkVocabulary", "Matrix live work vocabulary"],
  ["fallingEffectActivityLinks", "Matrix activity links"],
  ["fallingEffectActivityLinkNetworkEnabled", "Matrix activity link inputs"],
  ["fallingEffectActivityLinkDatabaseEnabled", "Matrix activity link inputs"],
  ["fallingEffectActivityLinkBuildEnabled", "Matrix activity link inputs"],
  ["fallingEffectActivityLinkAgentEnabled", "Matrix activity link inputs"],
  ["fallingEffectActivityLinkColorMode", "Matrix activity link colors"],
  ["fallingEffectActivityLinkRetentionSeconds", "Matrix verified route visibility"],
] as const satisfies ReadonlyArray<readonly [keyof UnifiedSettings, string]>;

type MatrixAtmosphereSettingKey = (typeof MATRIX_ATMOSPHERE_SETTING_LABELS)[number][0];
type MatrixAtmosphereSettings = Pick<UnifiedSettings, MatrixAtmosphereSettingKey>;

export function listChangedMatrixAtmosphereSettingLabels(
  settings: MatrixAtmosphereSettings,
): readonly string[] {
  return [
    ...new Set(
      MATRIX_ATMOSPHERE_SETTING_LABELS.flatMap(([key, label]) =>
        settings[key] === DEFAULT_UNIFIED_SETTINGS[key] ? [] : [label],
      ),
    ),
  ];
}

export function createMatrixAtmosphereRestorePatch(): Pick<
  ClientSettingsPatch,
  MatrixAtmosphereSettingKey
> {
  return {
    fallingEffectMatrixBaseFontSize: DEFAULT_UNIFIED_SETTINGS.fallingEffectMatrixBaseFontSize,
    fallingEffectMatrixColorMode: DEFAULT_UNIFIED_SETTINGS.fallingEffectMatrixColorMode,
    fallingEffectMatrixColorCycleSpeed: DEFAULT_UNIFIED_SETTINGS.fallingEffectMatrixColorCycleSpeed,
    fallingEffectMatrixMotionMode: DEFAULT_UNIFIED_SETTINGS.fallingEffectMatrixMotionMode,
    fallingEffectMatrixWalkStartFontSize:
      DEFAULT_UNIFIED_SETTINGS.fallingEffectMatrixWalkStartFontSize,
    fallingEffectMatrixWalkEndFontSize: DEFAULT_UNIFIED_SETTINGS.fallingEffectMatrixWalkEndFontSize,
    fallingEffectMatrixWalkLifecyclePercent:
      DEFAULT_UNIFIED_SETTINGS.fallingEffectMatrixWalkLifecyclePercent,
    fallingEffectMatrixCenterWindIntensity:
      DEFAULT_UNIFIED_SETTINGS.fallingEffectMatrixCenterWindIntensity,
    fallingEffect2chEnriched: DEFAULT_UNIFIED_SETTINGS.fallingEffect2chEnriched,
    fallingEffectLiveWorkVocabulary: DEFAULT_UNIFIED_SETTINGS.fallingEffectLiveWorkVocabulary,
    fallingEffectActivityLinks: DEFAULT_UNIFIED_SETTINGS.fallingEffectActivityLinks,
    fallingEffectActivityLinkNetworkEnabled:
      DEFAULT_UNIFIED_SETTINGS.fallingEffectActivityLinkNetworkEnabled,
    fallingEffectActivityLinkDatabaseEnabled:
      DEFAULT_UNIFIED_SETTINGS.fallingEffectActivityLinkDatabaseEnabled,
    fallingEffectActivityLinkBuildEnabled:
      DEFAULT_UNIFIED_SETTINGS.fallingEffectActivityLinkBuildEnabled,
    fallingEffectActivityLinkAgentEnabled:
      DEFAULT_UNIFIED_SETTINGS.fallingEffectActivityLinkAgentEnabled,
    fallingEffectActivityLinkColorMode: DEFAULT_UNIFIED_SETTINGS.fallingEffectActivityLinkColorMode,
    fallingEffectActivityLinkRetentionSeconds:
      DEFAULT_UNIFIED_SETTINGS.fallingEffectActivityLinkRetentionSeconds,
  };
}
