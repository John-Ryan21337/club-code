import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  AMBIENT_CLIENT_SETTINGS_KEYS,
  ClientSettingsPatch,
  ClientSettingsSchema,
  CodexSettings,
  ClaudeSettings,
  CODEX_ULTRA_CACHING_AUTO_COMPACT_TOKEN_LIMIT,
  CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET,
  CLUB_CODE_FIRST_RUN_CLIENT_SETTINGS,
  DEFAULT_AMBIENT_CLIENT_SETTINGS,
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_IMAGE_ASSET,
  DEFAULT_AMBIENT_IMAGE_CYCLE_ASSETS,
  DEFAULT_AMBIENT_IMAGE_CYCLE_ENABLED,
  DEFAULT_AMBIENT_IMAGE_CYCLE_SECONDS,
  DEFAULT_AMBIENT_IMAGE_ENABLED,
  DEFAULT_AMBIENT_IMAGE_GLOW_ENABLED,
  DEFAULT_AMBIENT_IMAGE_LAYOUT_MODE,
  DEFAULT_AMBIENT_IMAGE_PRESENTATION_MODE,
  DEFAULT_AMBIENT_IMAGE_PRESET_PLACEMENT,
  DEFAULT_AMBIENT_IMAGE_PRESET_SIZE,
  DEFAULT_AMBIENT_OPACITY,
  DEFAULT_AMBIENT_VIDEO_ENABLED,
  DEFAULT_AMBIENT_VIDEO_GLOW_ENABLED,
  DEFAULT_AMBIENT_VIDEO_GLOW_MODE,
  DEFAULT_AMBIENT_VIDEO_LAYOUT_MODE,
  DEFAULT_AMBIENT_VIDEO_PRESENTATION_MODE,
  DEFAULT_AMBIENT_VIDEO_PRESET_PLACEMENT,
  DEFAULT_AMBIENT_VIDEO_PRESET_SIZE,
  DEFAULT_AMBIENT_VIDEO_SOURCE,
  DEFAULT_AMBIANCE_COLOR,
  DEFAULT_AMBIANCE_EFFECT,
  DEFAULT_AMBIANCE_ENABLED,
  DEFAULT_AMBIANCE_INTENSITY,
  DEFAULT_AMBIANCE_REACT_MODE,
  DEFAULT_AMBIANCE_SURFACE_COMPOSER,
  DEFAULT_AMBIANCE_SURFACE_SIDEBAR,
  DEFAULT_AMBIANCE_SURFACE_THREAD,
  DEFAULT_APP_ACCENT_COLOR,
  DEFAULT_AUTO_NUDGE_MODE,
  DEFAULT_BRAND_WORDMARK_PREFIX,
  DEFAULT_CHAT_COPY_FORMAT,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_CONTINUE_BACKGROUND_ANIMATIONS,
  DEFAULT_FALLING_EFFECT_2CH_ENRICHED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_AGENT_ENABLED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_BUILD_ENABLED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINKS,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_COLOR_MODE,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_DATABASE_ENABLED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_NETWORK_ENABLED,
  DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
  DEFAULT_FALLING_EFFECT_DENSITY,
  DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
  DEFAULT_FALLING_EFFECT_KIND,
  DEFAULT_FALLING_EFFECT_LIVE_WORK_VOCABULARY,
  DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE,
  DEFAULT_FALLING_EFFECT_SPEED,
  DEFAULT_FALLING_EFFECTS_ENABLED,
  DEFAULT_MODEL_PACING_ENABLED,
  DEFAULT_MODEL_PACING_RESERVE_PERCENT,
  DEFAULT_POWER_SAVE_BLOCKER_MODE,
  DEFAULT_PROVIDER_USAGE_POLL_MINUTES,
  DEFAULT_PROVIDER_USAGE_WIDGET_ENABLED,
  DEFAULT_SHOW_SIDEBAR_ATTRIBUTION,
  DEFAULT_SIDEBAR_BRAND_IMAGE_DATA_URL,
  DEFAULT_SIDEBAR_BRAND_IMAGE,
  DEFAULT_SIDEBAR_STAR_SPEED,
  DEFAULT_WORKFLOW_OBSERVATORY_ENABLED,
  DEFAULT_WORKFLOW_STALL_WARNING_SECONDS,
  DEFAULT_SHOW_SIDEBAR_MASCOT,
  DEFAULT_SHOW_SIDEBAR_SEARCH,
  DEFAULT_THEME_ACCENT_COLOR,
  MAX_AMBIENT_IMAGE_DIMENSION,
  MAX_AMBIENT_IMAGE_FILE_BYTES,
  MAX_AMBIENT_OPACITY,
  MAX_BRAND_WORDMARK_PREFIX_LENGTH,
  MAX_FALLING_EFFECT_DENSITY,
  MAX_FALLING_EFFECT_JAPANESE_RATIO,
  MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  MAX_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
  MAX_FALLING_EFFECT_SPEED,
  MAX_MODEL_PACING_RESERVE_PERCENT,
  MAX_PROVIDER_USAGE_POLL_MINUTES,
  MAX_SIDEBAR_BRAND_IMAGE_DATA_URL_LENGTH,
  MAX_SIDEBAR_BRAND_IMAGE_FILE_BYTES,
  MAX_SIDEBAR_BRAND_IMAGE_ID_LENGTH,
  MAX_AMBIANCE_INTENSITY,
  MAX_SIDEBAR_STAR_SPEED,
  MIN_AMBIANCE_INTENSITY,
  MIN_AMBIENT_OPACITY,
  MIN_FALLING_EFFECT_DENSITY,
  MIN_FALLING_EFFECT_JAPANESE_RATIO,
  MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
  MIN_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
  MIN_FALLING_EFFECT_SPEED,
  MIN_MODEL_PACING_RESERVE_PERCENT,
  MIN_PROVIDER_USAGE_POLL_MINUTES,
  MIN_SIDEBAR_STAR_SPEED,
  MAX_WORKFLOW_STALL_WARNING_SECONDS,
  MIN_WORKFLOW_STALL_WARNING_SECONDS,
  ServerSettingsPatch,
  type AmbientClientSettings,
  type ClientSettings,
} from "./settings.ts";

const decodeClientSettings = Schema.decodeSync(ClientSettingsSchema);
const decodeClientSettingsPatch = Schema.decodeUnknownSync(ClientSettingsPatch);
const encodeClientSettings = Schema.encodeSync(ClientSettingsSchema);
const decodeCodexSettings = Schema.decodeSync(CodexSettings);
const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);

const ambientImageAsset = {
  id: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.gif",
  url: "/api/ambient-media/image/sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.gif",
  mimeType: "image/gif" as const,
  width: 640,
  height: 360,
  sizeBytes: 512_000,
};

function pickAmbientSettings(settings: ClientSettings): AmbientClientSettings {
  return Object.fromEntries(
    AMBIENT_CLIENT_SETTINGS_KEYS.map((key) => [key, settings[key]]),
  ) as AmbientClientSettings;
}

describe("client settings", () => {
  it("keeps every per-device completion audio option off by default", () => {
    expect(decodeClientSettings({})).toMatchObject({
      notificationsEnabled: false,
      completionAlertSoundEnabled: false,
      completionAlertSpeechEnabled: false,
      completionAlertLanguage: "en",
      completionAlertEnglishVoiceGender: "female",
      completionAlertJapaneseVoiceGender: "female",
      completionAlertDualStereoOrder: "ja-left-en-right",
    });
    expect(() => decodeClientSettingsPatch({ completionAlertLanguage: "project-title" })).toThrow();
  });

  it("defaults power-save blocking to off", () => {
    expect(DEFAULT_CLIENT_SETTINGS.powerSaveBlockerMode).toBe(DEFAULT_POWER_SAVE_BLOCKER_MODE);
    expect(decodeClientSettings({}).powerSaveBlockerMode).toBe("off");
  });

  it("defaults chat selection copy to Markdown", () => {
    expect(DEFAULT_CLIENT_SETTINGS.chatCopyFormat).toBe(DEFAULT_CHAT_COPY_FORMAT);
    expect(decodeClientSettings({}).chatCopyFormat).toBe("markdown");
  });

  it("accepts only supported chat copy formats in patches", () => {
    expect(decodeClientSettingsPatch({ chatCopyFormat: "plainText" })).toEqual({
      chatCopyFormat: "plainText",
    });
    expect(() => decodeClientSettingsPatch({ chatCopyFormat: "html" })).toThrow();
  });

  it("exposes every client setting through ClientSettingsPatch", () => {
    // A settings key that exists in ClientSettingsSchema but not in
    // ClientSettingsPatch can never be saved: the update RPC decodes the patch
    // against ClientSettingsPatch and silently drops unknown keys, so the
    // toggle flips and snaps back. Keys updated through their own dedicated
    // flow rather than the generic patch RPC are allowlisted here.
    const NON_PATCHABLE_KEYS = new Set(["dismissedProviderUpdateNotificationKeys"]);
    const patchKeys = new Set(Object.keys(ClientSettingsPatch.fields));
    const missing = Object.keys(ClientSettingsSchema.fields).filter(
      (key) => !patchKeys.has(key) && !NON_PATCHABLE_KEYS.has(key),
    );
    expect(missing).toEqual([]);
  });

  it("defaults appearance preferences", () => {
    expect(DEFAULT_CLIENT_SETTINGS.continueBackgroundAnimations).toBe(
      DEFAULT_CONTINUE_BACKGROUND_ANIMATIONS,
    );
    expect(DEFAULT_CLIENT_SETTINGS.showSidebarSearch).toBe(DEFAULT_SHOW_SIDEBAR_SEARCH);
    expect(DEFAULT_CLIENT_SETTINGS.showSidebarMascot).toBe(DEFAULT_SHOW_SIDEBAR_MASCOT);
    expect(DEFAULT_CLIENT_SETTINGS.showSidebarAttribution).toBe(DEFAULT_SHOW_SIDEBAR_ATTRIBUTION);
    expect(DEFAULT_CLIENT_SETTINGS.brandWordmarkPrefix).toBe(DEFAULT_BRAND_WORDMARK_PREFIX);
    expect(DEFAULT_CLIENT_SETTINGS.sidebarBrandImage).toBe(DEFAULT_SIDEBAR_BRAND_IMAGE);
    expect(DEFAULT_CLIENT_SETTINGS.sidebarBrandImageDataUrl).toBe(
      DEFAULT_SIDEBAR_BRAND_IMAGE_DATA_URL,
    );
    expect(DEFAULT_CLIENT_SETTINGS.sidebarStarSpeed).toBe(DEFAULT_SIDEBAR_STAR_SPEED);
    expect(DEFAULT_CLIENT_SETTINGS.themeAccentColor).toBe(DEFAULT_THEME_ACCENT_COLOR);
    expect(DEFAULT_CLIENT_SETTINGS.appAccentColor).toBe(DEFAULT_APP_ACCENT_COLOR);
    expect(DEFAULT_CLIENT_SETTINGS.workflowObservatoryEnabled).toBe(
      DEFAULT_WORKFLOW_OBSERVATORY_ENABLED,
    );
    expect(DEFAULT_CLIENT_SETTINGS.workflowStallWarningSeconds).toBe(
      DEFAULT_WORKFLOW_STALL_WARNING_SECONDS,
    );
    expect(decodeClientSettings({}).continueBackgroundAnimations).toBe(false);
    expect(decodeClientSettings({}).showSidebarSearch).toBe(true);
    expect(decodeClientSettings({}).showSidebarMascot).toBe(true);
    expect(decodeClientSettings({}).showSidebarAttribution).toBe(true);
    expect(decodeClientSettings({}).brandWordmarkPrefix).toBe("Club");
    expect(decodeClientSettings({}).sidebarBrandImage).toBeNull();
    expect(decodeClientSettings({}).sidebarBrandImageDataUrl).toBe("");
    expect(decodeClientSettings({}).sidebarStarSpeed).toBe(1);
    expect(decodeClientSettings({}).themeAccentColor).toBe("");
    expect(decodeClientSettings({}).appAccentColor).toBe("");
    expect(decodeClientSettings({}).workflowObservatoryEnabled).toBe(true);
    expect(decodeClientSettings({}).workflowStallWarningSeconds).toBe(180);
  });

  it("keeps conservative defaults separate from the Club Code first-run profile", () => {
    expect(DEFAULT_CLIENT_SETTINGS.fallingEffectsEnabled).toBe(false);
    expect(DEFAULT_CLIENT_SETTINGS.fallingEffectMatrixColorMode).toBe("fixed");
    expect(DEFAULT_CLIENT_SETTINGS.fallingEffectMatrixColorCycleSpeed).toBe(
      DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
    );
    expect(DEFAULT_CLIENT_SETTINGS.ambientVideoEnabled).toBe(false);
    expect(DEFAULT_CLIENT_SETTINGS.ambientImageEnabled).toBe(false);
    expect(DEFAULT_CLIENT_SETTINGS.providerUsageWidgetEnabled).toBe(false);
    expect(DEFAULT_CLIENT_SETTINGS.modelPacingEnabled).toBe(false);

    expect(CLUB_CODE_FIRST_RUN_CLIENT_SETTINGS).toEqual({
      ...DEFAULT_CLIENT_SETTINGS,
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
      fallingEffectMatrixColorMode: "rainbow",
      fallingEffectOpacity: 0.55,
      fallingEffectSpeed: 4,
      fallingEffectDensity: 2.5,
      fallingEffectJapaneseRatio: 0.45,
      fallingEffect2chEnriched: true,
      fallingEffectLiveWorkVocabulary: true,
      fallingEffectActivityLinks: true,
      fallingEffectActivityLinkNetworkEnabled: true,
      fallingEffectActivityLinkDatabaseEnabled: true,
      fallingEffectActivityLinkBuildEnabled: true,
      fallingEffectActivityLinkAgentEnabled: true,
      fallingEffectActivityLinkColorMode: "matrix",
      ambientVideoEnabled: true,
      ambientVideoSource: null,
      ambientVideoLayoutMode: "custom",
      ambientVideoPresetPlacement: "bottom-right",
      ambientVideoPresetSize: "large",
      ambientVideoPresentationMode: "floating",
      ambientVideoGlowEnabled: true,
      ambientVideoGlowMode: "adaptive",
      ambientVideoGlowColor: "auto",
      ambientVideoGlowOpacity: 0.65,
      ambientImageEnabled: true,
      ambientImageAsset: CLUB_CODE_FIRST_RUN_AMBIENT_IMAGE_ASSET,
      ambientImagePresentationMode: "floating",
      ambientImageLayoutMode: "preset",
      ambientImagePresetPlacement: "bottom-left",
      ambientImagePresetSize: "large",
      ambientImageGlowEnabled: true,
      providerUsageWidgetEnabled: true,
      modelPacingEnabled: true,
      ambientImageGlowColor: "auto",
      ambientImageGlowOpacity: 0.35,
      workflowObservatoryEnabled: true,
      providerUsagePollMinutes: 2,
      modelPacingReservePercent: 5,
    });
    expect(CLUB_CODE_FIRST_RUN_CLIENT_SETTINGS.onboardingCompleted).toBe(false);
    expect(CLUB_CODE_FIRST_RUN_CLIENT_SETTINGS.dismissedFirstRunHints).toEqual([]);
  });

  it("keeps the workflow silence warning bounded and patchable", () => {
    expect(
      decodeClientSettingsPatch({
        workflowObservatoryEnabled: false,
        workflowStallWarningSeconds: MIN_WORKFLOW_STALL_WARNING_SECONDS,
      }),
    ).toEqual({
      workflowObservatoryEnabled: false,
      workflowStallWarningSeconds: MIN_WORKFLOW_STALL_WARNING_SECONDS,
    });
    expect(() =>
      decodeClientSettingsPatch({
        workflowStallWarningSeconds: MAX_WORKFLOW_STALL_WARNING_SECONDS + 1,
      }),
    ).toThrow();
  });

  it("defaults model pacing off and bounds its reserve buffer", () => {
    expect(DEFAULT_CLIENT_SETTINGS.modelPacingEnabled).toBe(DEFAULT_MODEL_PACING_ENABLED);
    expect(DEFAULT_CLIENT_SETTINGS.modelPacingReservePercent).toBe(
      DEFAULT_MODEL_PACING_RESERVE_PERCENT,
    );
    expect(
      decodeClientSettingsPatch({
        modelPacingEnabled: true,
        modelPacingReservePercent: MIN_MODEL_PACING_RESERVE_PERCENT,
      }),
    ).toEqual({
      modelPacingEnabled: true,
      modelPacingReservePercent: MIN_MODEL_PACING_RESERVE_PERCENT,
    });
    expect(() =>
      decodeClientSettingsPatch({
        modelPacingReservePercent: MAX_MODEL_PACING_RESERVE_PERCENT + 1,
      }),
    ).toThrow();
  });

  it("persists only the supported global auto-nudge modes and defaults safely off", () => {
    expect(DEFAULT_CLIENT_SETTINGS.autoNudgeMode).toBe(DEFAULT_AUTO_NUDGE_MODE);
    expect(decodeClientSettings({}).autoNudgeMode).toBe("off");
    expect(decodeClientSettings({}).autoNudgeBackgroundContinuation).toBe(false);
    expect(decodeClientSettings({}).autoNudgeMaxRounds).toBe(5);
    expect(decodeClientSettings({}).autoNudgeMaxMinutes).toBe(30);
    expect(decodeClientSettingsPatch({ autoNudgeMode: "hardcore-fanout" })).toEqual({
      autoNudgeMode: "hardcore-fanout",
    });
    expect(decodeClientSettingsPatch({ autoNudgeMode: "steady-progress" })).toEqual({
      autoNudgeMode: "steady-progress",
    });
    expect(() => decodeClientSettingsPatch({ autoNudgeMode: "forever" })).toThrow();
    expect(
      decodeClientSettingsPatch({
        autoNudgeBackgroundContinuation: true,
        autoNudgeMaxRounds: 20,
        autoNudgeMaxMinutes: 120,
      }),
    ).toEqual({
      autoNudgeBackgroundContinuation: true,
      autoNudgeMaxRounds: 20,
      autoNudgeMaxMinutes: 120,
    });
    expect(() => decodeClientSettingsPatch({ autoNudgeMaxRounds: 0 })).toThrow();
    expect(() => decodeClientSettingsPatch({ autoNudgeMaxRounds: 21 })).toThrow();
    expect(() => decodeClientSettingsPatch({ autoNudgeMaxMinutes: 4 })).toThrow();
    expect(() => decodeClientSettingsPatch({ autoNudgeMaxMinutes: 121 })).toThrow();
  });

  it("keeps provider-usage polling opt-in and within one to five minutes", () => {
    expect(DEFAULT_CLIENT_SETTINGS.providerUsageWidgetEnabled).toBe(
      DEFAULT_PROVIDER_USAGE_WIDGET_ENABLED,
    );
    expect(DEFAULT_CLIENT_SETTINGS.providerUsagePollMinutes).toBe(
      DEFAULT_PROVIDER_USAGE_POLL_MINUTES,
    );
    expect(
      decodeClientSettingsPatch({
        providerUsageWidgetEnabled: true,
        providerUsagePollMinutes: MIN_PROVIDER_USAGE_POLL_MINUTES,
      }),
    ).toEqual({
      providerUsageWidgetEnabled: true,
      providerUsagePollMinutes: MIN_PROVIDER_USAGE_POLL_MINUTES,
    });
    expect(() =>
      decodeClientSettingsPatch({
        providerUsagePollMinutes: MIN_PROVIDER_USAGE_POLL_MINUTES - 1,
      }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        providerUsagePollMinutes: MAX_PROVIDER_USAGE_POLL_MINUTES + 1,
      }),
    ).toThrow();
  });

  it("defaults ambiance to off with rain, live reaction, and accent-following color", () => {
    expect(DEFAULT_CLIENT_SETTINGS.ambianceEnabled).toBe(DEFAULT_AMBIANCE_ENABLED);
    expect(DEFAULT_CLIENT_SETTINGS.ambianceEffect).toBe(DEFAULT_AMBIANCE_EFFECT);
    expect(DEFAULT_CLIENT_SETTINGS.ambianceIntensity).toBe(DEFAULT_AMBIANCE_INTENSITY);
    expect(DEFAULT_CLIENT_SETTINGS.ambianceReactMode).toBe(DEFAULT_AMBIANCE_REACT_MODE);
    expect(DEFAULT_CLIENT_SETTINGS.ambianceSurfaceSidebar).toBe(DEFAULT_AMBIANCE_SURFACE_SIDEBAR);
    expect(DEFAULT_CLIENT_SETTINGS.ambianceSurfaceThread).toBe(DEFAULT_AMBIANCE_SURFACE_THREAD);
    expect(DEFAULT_CLIENT_SETTINGS.ambianceSurfaceComposer).toBe(DEFAULT_AMBIANCE_SURFACE_COMPOSER);
    expect(DEFAULT_CLIENT_SETTINGS.ambianceColor).toBe(DEFAULT_AMBIANCE_COLOR);
    expect(decodeClientSettings({}).ambianceEnabled).toBe(false);
    expect(decodeClientSettings({}).ambianceEffect).toBe("rain");
    expect(decodeClientSettings({}).ambianceIntensity).toBe(0.55);
    expect(decodeClientSettings({}).ambianceReactMode).toBe("live");
    expect(decodeClientSettings({}).ambianceColor).toBe("");
  });

  it("bounds ambiance patches to supported effects, modes, and intensity range", () => {
    expect(
      decodeClientSettingsPatch({
        ambianceEnabled: true,
        ambianceEffect: "snow",
        ambianceIntensity: MAX_AMBIANCE_INTENSITY,
        ambianceReactMode: "session",
        ambianceSurfaceSidebar: false,
        ambianceSurfaceThread: false,
        ambianceSurfaceComposer: false,
        ambianceColor: "  #48cfff  ",
      }),
    ).toEqual({
      ambianceEnabled: true,
      ambianceEffect: "snow",
      ambianceIntensity: MAX_AMBIANCE_INTENSITY,
      ambianceReactMode: "session",
      ambianceSurfaceSidebar: false,
      ambianceSurfaceThread: false,
      ambianceSurfaceComposer: false,
      ambianceColor: "#48cfff",
    });
    expect(decodeClientSettingsPatch({ ambianceIntensity: MIN_AMBIANCE_INTENSITY })).toEqual({
      ambianceIntensity: MIN_AMBIANCE_INTENSITY,
    });
    expect(() => decodeClientSettingsPatch({ ambianceEffect: "hail" })).toThrow();
    expect(() => decodeClientSettingsPatch({ ambianceReactMode: "sometimes" })).toThrow();
    expect(() =>
      decodeClientSettingsPatch({ ambianceIntensity: MAX_AMBIANCE_INTENSITY + 0.5 }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({ ambianceIntensity: MIN_AMBIANCE_INTENSITY - 0.5 }),
    ).toThrow();
  });

  it("defaults every ambient preference to the canonical reset vector", () => {
    expect(DEFAULT_AMBIENT_CLIENT_SETTINGS).toEqual({
      fallingEffectsEnabled: DEFAULT_FALLING_EFFECTS_ENABLED,
      fallingEffectKind: DEFAULT_FALLING_EFFECT_KIND,
      fallingEffectColor: DEFAULT_AMBIENT_COLOR,
      fallingEffectMatrixColorMode: DEFAULT_FALLING_EFFECT_MATRIX_COLOR_MODE,
      fallingEffectMatrixColorCycleSpeed: DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
      fallingEffectOpacity: DEFAULT_AMBIENT_OPACITY,
      fallingEffectSpeed: DEFAULT_FALLING_EFFECT_SPEED,
      fallingEffectDensity: DEFAULT_FALLING_EFFECT_DENSITY,
      fallingEffectJapaneseRatio: DEFAULT_FALLING_EFFECT_JAPANESE_RATIO,
      fallingEffect2chEnriched: DEFAULT_FALLING_EFFECT_2CH_ENRICHED,
      fallingEffectLiveWorkVocabulary: DEFAULT_FALLING_EFFECT_LIVE_WORK_VOCABULARY,
      fallingEffectActivityLinks: DEFAULT_FALLING_EFFECT_ACTIVITY_LINKS,
      fallingEffectActivityLinkNetworkEnabled: DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_NETWORK_ENABLED,
      fallingEffectActivityLinkDatabaseEnabled:
        DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_DATABASE_ENABLED,
      fallingEffectActivityLinkBuildEnabled: DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_BUILD_ENABLED,
      fallingEffectActivityLinkAgentEnabled: DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_AGENT_ENABLED,
      fallingEffectActivityLinkColorMode: DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_COLOR_MODE,
      fallingEffectActivityLinkRetentionSeconds:
        DEFAULT_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
      ambientVideoEnabled: DEFAULT_AMBIENT_VIDEO_ENABLED,
      ambientVideoSource: DEFAULT_AMBIENT_VIDEO_SOURCE,
      ambientVideoLayoutMode: DEFAULT_AMBIENT_VIDEO_LAYOUT_MODE,
      ambientVideoPresetPlacement: DEFAULT_AMBIENT_VIDEO_PRESET_PLACEMENT,
      ambientVideoPresetSize: DEFAULT_AMBIENT_VIDEO_PRESET_SIZE,
      ambientVideoPresentationMode: DEFAULT_AMBIENT_VIDEO_PRESENTATION_MODE,
      ambientVideoGlowEnabled: DEFAULT_AMBIENT_VIDEO_GLOW_ENABLED,
      ambientVideoGlowMode: DEFAULT_AMBIENT_VIDEO_GLOW_MODE,
      ambientVideoGlowColor: DEFAULT_AMBIENT_COLOR,
      ambientVideoGlowOpacity: DEFAULT_AMBIENT_OPACITY,
      ambientImageEnabled: DEFAULT_AMBIENT_IMAGE_ENABLED,
      ambientImageAsset: DEFAULT_AMBIENT_IMAGE_ASSET,
      ambientImageCycleAssets: DEFAULT_AMBIENT_IMAGE_CYCLE_ASSETS,
      ambientImageCycleEnabled: DEFAULT_AMBIENT_IMAGE_CYCLE_ENABLED,
      ambientImageCycleSeconds: DEFAULT_AMBIENT_IMAGE_CYCLE_SECONDS,
      ambientImagePresentationMode: DEFAULT_AMBIENT_IMAGE_PRESENTATION_MODE,
      ambientImageLayoutMode: DEFAULT_AMBIENT_IMAGE_LAYOUT_MODE,
      ambientImagePresetPlacement: DEFAULT_AMBIENT_IMAGE_PRESET_PLACEMENT,
      ambientImagePresetSize: DEFAULT_AMBIENT_IMAGE_PRESET_SIZE,
      ambientImageGlowEnabled: DEFAULT_AMBIENT_IMAGE_GLOW_ENABLED,
      ambientImageGlowColor: DEFAULT_AMBIENT_COLOR,
      ambientImageGlowOpacity: DEFAULT_AMBIENT_OPACITY,
    });
    expect(pickAmbientSettings(DEFAULT_CLIENT_SETTINGS)).toEqual(DEFAULT_AMBIENT_CLIENT_SETTINGS);
    expect(pickAmbientSettings(decodeClientSettings({}))).toEqual(DEFAULT_AMBIENT_CLIENT_SETTINGS);
  });

  it("adds ambient defaults when decoding an older partial settings document", () => {
    const decoded = decodeClientSettings({
      timestampFormat: "24-hour",
      showSidebarMascot: false,
    });

    expect(decoded.timestampFormat).toBe("24-hour");
    expect(decoded.showSidebarMascot).toBe(false);
    expect(decoded.fallingEffectMatrixColorMode).toBe("fixed");
    expect(decoded.fallingEffectMatrixColorCycleSpeed).toBe(
      DEFAULT_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
    );
    expect(pickAmbientSettings(decoded)).toEqual(DEFAULT_AMBIENT_CLIENT_SETTINGS);
  });

  it("preserves legacy YouTube sources while accepting the additive Spotify source", () => {
    const decoded = decodeClientSettings({
      ambientVideoEnabled: true,
      ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
    });

    expect(decoded.ambientVideoSource).toEqual({ kind: "video", id: "dQw4w9WgXcQ" });
  });

  it("round-trips the full ambient settings patch and reset vector", () => {
    const configured = decodeClientSettingsPatch({
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
      fallingEffectColor: "  #12AbEf  ",
      fallingEffectMatrixColorMode: "music-reactive",
      fallingEffectMatrixColorCycleSpeed: MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
      fallingEffectOpacity: MAX_AMBIENT_OPACITY,
      fallingEffectSpeed: MAX_FALLING_EFFECT_SPEED,
      fallingEffectDensity: MAX_FALLING_EFFECT_DENSITY,
      fallingEffectJapaneseRatio: MAX_FALLING_EFFECT_JAPANESE_RATIO,
      fallingEffect2chEnriched: true,
      fallingEffectLiveWorkVocabulary: true,
      fallingEffectActivityLinks: true,
      fallingEffectActivityLinkNetworkEnabled: false,
      fallingEffectActivityLinkDatabaseEnabled: true,
      fallingEffectActivityLinkBuildEnabled: false,
      fallingEffectActivityLinkAgentEnabled: true,
      fallingEffectActivityLinkColorMode: "matrix",
      fallingEffectActivityLinkRetentionSeconds: MAX_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
      ambientVideoEnabled: true,
      ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
      ambientVideoLayoutMode: "custom",
      ambientVideoPresetPlacement: "bottom-left",
      ambientVideoPresetSize: "large",
      ambientVideoPresentationMode: "cinema",
      ambientVideoGlowEnabled: true,
      ambientVideoGlowMode: "adaptive",
      ambientVideoGlowColor: "#ABCDEF",
      ambientVideoGlowOpacity: MIN_AMBIENT_OPACITY,
      ambientImageEnabled: true,
      ambientImageAsset,
      ambientImageLayoutMode: "custom",
      ambientImagePresetPlacement: "bottom-right",
      ambientImagePresetSize: "small",
      ambientImageGlowEnabled: true,
      ambientImageGlowColor: "#123456",
      ambientImageGlowOpacity: MAX_AMBIENT_OPACITY,
    });

    expect(configured).toEqual({
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
      fallingEffectColor: "#12abef",
      fallingEffectMatrixColorMode: "music-reactive",
      fallingEffectMatrixColorCycleSpeed: MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
      fallingEffectOpacity: MAX_AMBIENT_OPACITY,
      fallingEffectSpeed: MAX_FALLING_EFFECT_SPEED,
      fallingEffectDensity: MAX_FALLING_EFFECT_DENSITY,
      fallingEffectJapaneseRatio: MAX_FALLING_EFFECT_JAPANESE_RATIO,
      fallingEffect2chEnriched: true,
      fallingEffectLiveWorkVocabulary: true,
      fallingEffectActivityLinks: true,
      fallingEffectActivityLinkNetworkEnabled: false,
      fallingEffectActivityLinkDatabaseEnabled: true,
      fallingEffectActivityLinkBuildEnabled: false,
      fallingEffectActivityLinkAgentEnabled: true,
      fallingEffectActivityLinkColorMode: "matrix",
      fallingEffectActivityLinkRetentionSeconds: MAX_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
      ambientVideoEnabled: true,
      ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
      ambientVideoLayoutMode: "custom",
      ambientVideoPresetPlacement: "bottom-left",
      ambientVideoPresetSize: "large",
      ambientVideoPresentationMode: "cinema",
      ambientVideoGlowEnabled: true,
      ambientVideoGlowMode: "adaptive",
      ambientVideoGlowColor: "#abcdef",
      ambientVideoGlowOpacity: MIN_AMBIENT_OPACITY,
      ambientImageEnabled: true,
      ambientImageAsset,
      ambientImageLayoutMode: "custom",
      ambientImagePresetPlacement: "bottom-right",
      ambientImagePresetSize: "small",
      ambientImageGlowEnabled: true,
      ambientImageGlowColor: "#123456",
      ambientImageGlowOpacity: MAX_AMBIENT_OPACITY,
    });

    const resetPatch = decodeClientSettingsPatch(DEFAULT_AMBIENT_CLIENT_SETTINGS);
    const reset = decodeClientSettings({
      ...DEFAULT_CLIENT_SETTINGS,
      ...configured,
      ...resetPatch,
    });
    expect(pickAmbientSettings(reset)).toEqual(DEFAULT_AMBIENT_CLIENT_SETTINGS);
  });

  it("accepts exactly the three falling effects and five Matrix color modes", () => {
    for (const fallingEffectKind of ["snow", "rain", "matrix"] as const) {
      expect(decodeClientSettingsPatch({ fallingEffectKind })).toEqual({ fallingEffectKind });
    }
    for (const fallingEffectMatrixColorMode of [
      "fixed",
      "rainbow",
      "rainbow-extra",
      "music-reactive",
      "music-reactive-extra",
    ] as const) {
      expect(decodeClientSettingsPatch({ fallingEffectMatrixColorMode })).toEqual({
        fallingEffectMatrixColorMode,
      });
    }
    for (const fallingEffectActivityLinkColorMode of ["random", "matrix"] as const) {
      expect(decodeClientSettingsPatch({ fallingEffectActivityLinkColorMode })).toEqual({
        fallingEffectActivityLinkColorMode,
      });
    }
  });

  it("canonicalizes every explicit ambient color while preserving auto", () => {
    expect(
      decodeClientSettingsPatch({
        fallingEffectColor: "  #12AbEf  ",
        ambientVideoGlowColor: "#ABCDEF",
        ambientImageGlowColor: "#aBc123",
      }),
    ).toEqual({
      fallingEffectColor: "#12abef",
      ambientVideoGlowColor: "#abcdef",
      ambientImageGlowColor: "#abc123",
    });
    expect(
      decodeClientSettingsPatch({
        fallingEffectColor: "auto",
        ambientVideoGlowColor: "auto",
        ambientImageGlowColor: "auto",
      }),
    ).toEqual({
      fallingEffectColor: "auto",
      ambientVideoGlowColor: "auto",
      ambientImageGlowColor: "auto",
    });
  });

  it("canonicalizes ambient colors when encoding settings", () => {
    const encoded = encodeClientSettings({
      ...DEFAULT_CLIENT_SETTINGS,
      fallingEffectColor: "#ABCDEF",
      ambientVideoGlowColor: "#12AbEf",
      ambientImageGlowColor: "#aBc123",
    });

    expect(encoded.fallingEffectColor).toBe("#abcdef");
    expect(encoded.ambientVideoGlowColor).toBe("#12abef");
    expect(encoded.ambientImageGlowColor).toBe("#abc123");
  });

  it("accepts effective-empty ambient media states", () => {
    expect(
      decodeClientSettingsPatch({
        ambientVideoEnabled: true,
        ambientVideoSource: null,
        ambientImageEnabled: true,
        ambientImageAsset: null,
      }),
    ).toEqual({
      ambientVideoEnabled: true,
      ambientVideoSource: null,
      ambientImageEnabled: true,
      ambientImageAsset: null,
    });
  });

  it("validates atomic YouTube and Spotify sources", () => {
    expect(
      decodeClientSettingsPatch({
        ambientVideoSource: {
          kind: "playlist",
          id: "PL1234567890",
          videoId: "dQw4w9WgXcQ",
        },
      }),
    ).toEqual({
      ambientVideoSource: {
        kind: "playlist",
        id: "PL1234567890",
        videoId: "dQw4w9WgXcQ",
      },
    });
    expect(decodeClientSettingsPatch({ ambientVideoSource: null })).toEqual({
      ambientVideoSource: null,
    });
    expect(
      decodeClientSettingsPatch({
        ambientVideoSource: {
          kind: "spotify",
          entityType: "track",
          id: "4uLU6hMCjMI75M1A2tKUQC",
        },
      }),
    ).toEqual({
      ambientVideoSource: {
        kind: "spotify",
        entityType: "track",
        id: "4uLU6hMCjMI75M1A2tKUQC",
      },
    });

    expect(() =>
      decodeClientSettingsPatch({
        ambientVideoSource: { kind: "video" },
      }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        ambientVideoSource: { kind: "video", id: "too-short" },
      }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        ambientVideoSource: { kind: "playlist", id: "short" },
      }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        ambientVideoSource: {
          kind: "playlist",
          id: "PL1234567890",
          videoId: "too-short",
        },
      }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        ambientVideoSource: { kind: "channel", id: "dQw4w9WgXcQ" },
      }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        ambientVideoSource: { kind: "spotify", entityType: "track", id: "too-short" },
      }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        ambientVideoSource: {
          kind: "spotify",
          entityType: "user",
          id: "4uLU6hMCjMI75M1A2tKUQC",
        },
      }),
    ).toThrow();
  });

  it("bounds ambient colors, Matrix color modes and cycle speed, opacity, motion, density, Japanese ratio, and layout enums", () => {
    expect(
      decodeClientSettingsPatch({
        fallingEffectColor: "auto",
        fallingEffectMatrixColorMode: "rainbow-extra",
        fallingEffectMatrixColorCycleSpeed: MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
        fallingEffectOpacity: MIN_AMBIENT_OPACITY,
        fallingEffectSpeed: MIN_FALLING_EFFECT_SPEED,
        fallingEffectDensity: MIN_FALLING_EFFECT_DENSITY,
        fallingEffectJapaneseRatio: MIN_FALLING_EFFECT_JAPANESE_RATIO,
        fallingEffect2chEnriched: false,
        fallingEffectLiveWorkVocabulary: false,
        fallingEffectActivityLinks: false,
        fallingEffectActivityLinkNetworkEnabled: false,
        fallingEffectActivityLinkDatabaseEnabled: false,
        fallingEffectActivityLinkBuildEnabled: false,
        fallingEffectActivityLinkAgentEnabled: false,
        fallingEffectActivityLinkColorMode: "random",
        fallingEffectActivityLinkRetentionSeconds:
          MIN_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
        ambientVideoGlowOpacity: MAX_AMBIENT_OPACITY,
        ambientVideoGlowMode: "adaptive",
      }),
    ).toEqual({
      fallingEffectColor: "auto",
      fallingEffectMatrixColorMode: "rainbow-extra",
      fallingEffectMatrixColorCycleSpeed: MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED,
      fallingEffectOpacity: MIN_AMBIENT_OPACITY,
      fallingEffectSpeed: MIN_FALLING_EFFECT_SPEED,
      fallingEffectDensity: MIN_FALLING_EFFECT_DENSITY,
      fallingEffectJapaneseRatio: MIN_FALLING_EFFECT_JAPANESE_RATIO,
      fallingEffect2chEnriched: false,
      fallingEffectLiveWorkVocabulary: false,
      fallingEffectActivityLinks: false,
      fallingEffectActivityLinkNetworkEnabled: false,
      fallingEffectActivityLinkDatabaseEnabled: false,
      fallingEffectActivityLinkBuildEnabled: false,
      fallingEffectActivityLinkAgentEnabled: false,
      fallingEffectActivityLinkColorMode: "random",
      fallingEffectActivityLinkRetentionSeconds: MIN_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS,
      ambientVideoGlowOpacity: MAX_AMBIENT_OPACITY,
      ambientVideoGlowMode: "adaptive",
    });
    expect(
      decodeClientSettingsPatch({
        fallingEffectMatrixColorMode: "music-reactive-extra",
      }),
    ).toEqual({ fallingEffectMatrixColorMode: "music-reactive-extra" });

    for (const invalidPatch of [
      { fallingEffectColor: "#12345" },
      { fallingEffectColor: "red" },
      { fallingEffectsEnabled: "yes" },
      { fallingEffectKind: "hail" },
      { fallingEffectMatrixColorMode: "beat-sync" },
      {
        fallingEffectMatrixColorCycleSpeed: MIN_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED - 0.01,
      },
      {
        fallingEffectMatrixColorCycleSpeed: MAX_FALLING_EFFECT_MATRIX_COLOR_CYCLE_SPEED + 0.01,
      },
      { fallingEffectMatrixColorCycleSpeed: Number.NaN },
      { fallingEffectOpacity: MIN_AMBIENT_OPACITY - 0.01 },
      { fallingEffectOpacity: MAX_AMBIENT_OPACITY + 0.01 },
      { fallingEffectOpacity: Number.NaN },
      { fallingEffectSpeed: MIN_FALLING_EFFECT_SPEED - 0.01 },
      { fallingEffectSpeed: MAX_FALLING_EFFECT_SPEED + 0.01 },
      { fallingEffectDensity: MIN_FALLING_EFFECT_DENSITY - 0.01 },
      { fallingEffectDensity: MAX_FALLING_EFFECT_DENSITY + 0.01 },
      { fallingEffectDensity: Number.NaN },
      { fallingEffectJapaneseRatio: MIN_FALLING_EFFECT_JAPANESE_RATIO - 0.01 },
      { fallingEffectJapaneseRatio: MAX_FALLING_EFFECT_JAPANESE_RATIO + 0.01 },
      { fallingEffectJapaneseRatio: Number.NaN },
      { fallingEffect2chEnriched: "yes" },
      { fallingEffectLiveWorkVocabulary: "yes" },
      { fallingEffectActivityLinks: "yes" },
      { fallingEffectActivityLinkNetworkEnabled: "yes" },
      { fallingEffectActivityLinkDatabaseEnabled: "yes" },
      { fallingEffectActivityLinkBuildEnabled: "yes" },
      { fallingEffectActivityLinkAgentEnabled: "yes" },
      { fallingEffectActivityLinkColorMode: "category" },
      {
        fallingEffectActivityLinkRetentionSeconds:
          MIN_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS - 1,
      },
      {
        fallingEffectActivityLinkRetentionSeconds:
          MAX_FALLING_EFFECT_ACTIVITY_LINK_RETENTION_SECONDS + 1,
      },
      { fallingEffectActivityLinkRetentionSeconds: 30.5 },
      { ambientVideoLayoutMode: "floating" },
      { ambientVideoPresentationMode: "fullscreen" },
      { ambientVideoGlowMode: "live-frames" },
      { ambientVideoPresetPlacement: "top-left" },
      { ambientImagePresetSize: "extra-large" },
    ]) {
      expect(() => decodeClientSettingsPatch(invalidPatch)).toThrow();
    }
  });

  it("validates ambient image metadata independently of upload bytes", () => {
    expect(MAX_AMBIENT_IMAGE_FILE_BYTES).toBe(10 * 1024 * 1024);
    expect(decodeClientSettingsPatch({ ambientImageAsset })).toEqual({
      ambientImageAsset,
    });
    expect(
      decodeClientSettingsPatch({
        ambientImageAsset: {
          ...ambientImageAsset,
          width: MAX_AMBIENT_IMAGE_DIMENSION,
          height: MAX_AMBIENT_IMAGE_DIMENSION,
          sizeBytes: MAX_AMBIENT_IMAGE_FILE_BYTES,
        },
      }),
    ).toEqual({
      ambientImageAsset: {
        ...ambientImageAsset,
        width: MAX_AMBIENT_IMAGE_DIMENSION,
        height: MAX_AMBIENT_IMAGE_DIMENSION,
        sizeBytes: MAX_AMBIENT_IMAGE_FILE_BYTES,
      },
    });

    for (const ambientImageAssetPatch of [
      { ...ambientImageAsset, id: "ambient.gif" },
      { ...ambientImageAsset, url: "https://example.com/ambient.gif" },
      {
        ...ambientImageAsset,
        url: "/api/ambient-media/image/sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.gif",
      },
      {
        ...ambientImageAsset,
        id: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
      },
      { ...ambientImageAsset, mimeType: "image/png" },
      { ...ambientImageAsset, mimeType: "image/svg+xml" },
      { ...ambientImageAsset, width: 0 },
      { ...ambientImageAsset, height: MAX_AMBIENT_IMAGE_DIMENSION + 1 },
      { ...ambientImageAsset, sizeBytes: MAX_AMBIENT_IMAGE_FILE_BYTES + 1 },
    ]) {
      expect(() =>
        decodeClientSettingsPatch({ ambientImageAsset: ambientImageAssetPatch }),
      ).toThrow();
    }
  });

  it("persists only bounded, path-free ambient image cycle metadata", () => {
    const secondAsset = {
      ...ambientImageAsset,
      id: "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
      url: "/api/ambient-media/image/sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
      mimeType: "image/png" as const,
    };
    expect(
      decodeClientSettingsPatch({
        ambientImageCycleAssets: [ambientImageAsset, secondAsset],
        ambientImageCycleEnabled: true,
        ambientImageCycleSeconds: 20,
        ambientImagePresentationMode: "theater",
      }),
    ).toMatchObject({
      ambientImageCycleAssets: [ambientImageAsset, secondAsset],
      ambientImageCycleEnabled: true,
      ambientImageCycleSeconds: 20,
      ambientImagePresentationMode: "theater",
    });
    expect(() =>
      decodeClientSettingsPatch({
        ambientImageCycleAssets: Array.from({ length: 25 }, (_, index) => {
          const digest = index.toString(16).padStart(64, "0");
          return {
            ...ambientImageAsset,
            id: `sha256-${digest}.png`,
            url: `/api/ambient-media/image/sha256-${digest}.png`,
            mimeType: "image/png" as const,
          };
        }),
      }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        ambientImageCycleAssets: [ambientImageAsset, ambientImageAsset],
      }),
    ).toThrow();
    expect(() => decodeClientSettingsPatch({ ambientImageCycleSeconds: 2 })).toThrow();
    expect(() => decodeClientSettingsPatch({ ambientImageCycleSeconds: 3_601 })).toThrow();
    expect(() => decodeClientSettingsPatch({ ambientImagePresentationMode: "cinema" })).toThrow();
  });

  it("accepts only supported power-save blocker modes in patches", () => {
    expect(decodeClientSettingsPatch({ powerSaveBlockerMode: "during-chats" })).toEqual({
      powerSaveBlockerMode: "during-chats",
    });
    expect(() => decodeClientSettingsPatch({ powerSaveBlockerMode: "caffeinate" })).toThrow();
  });

  it("trims appearance color patches", () => {
    expect(
      decodeClientSettingsPatch({
        continueBackgroundAnimations: true,
        showSidebarSearch: false,
        showSidebarMascot: false,
        showSidebarAttribution: false,
        brandWordmarkPrefix: "  Acme  ",
        sidebarBrandImage: {
          id: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
          url: "/api/branding/sidebar-image/sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
          mimeType: "image/png",
          width: 128,
          height: 160,
          sizeBytes: 12345,
        },
        sidebarBrandImageDataUrl: "  data:image/png;base64,abc123  ",
        sidebarStarSpeed: 1.5,
        themeAccentColor: "  #16a34a  ",
        appAccentColor: "  #dc2626  ",
      }),
    ).toEqual({
      continueBackgroundAnimations: true,
      showSidebarSearch: false,
      showSidebarMascot: false,
      showSidebarAttribution: false,
      brandWordmarkPrefix: "Acme",
      sidebarBrandImage: {
        id: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
        url: "/api/branding/sidebar-image/sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
        mimeType: "image/png",
        width: 128,
        height: 160,
        sizeBytes: 12345,
      },
      sidebarBrandImageDataUrl: "data:image/png;base64,abc123",
      sidebarStarSpeed: 1.5,
      themeAccentColor: "#16a34a",
      appAccentColor: "#dc2626",
    });
  });

  it("bounds runtime branding settings", () => {
    expect(MAX_SIDEBAR_BRAND_IMAGE_FILE_BYTES).toBe(1_000_000);
    expect(MAX_SIDEBAR_BRAND_IMAGE_ID_LENGTH).toBe(96);
    expect(MAX_SIDEBAR_BRAND_IMAGE_DATA_URL_LENGTH).toBeGreaterThanOrEqual(
      Math.ceil((MAX_SIDEBAR_BRAND_IMAGE_FILE_BYTES * 4) / 3) + 128,
    );

    expect(
      decodeClientSettingsPatch({
        brandWordmarkPrefix: "x".repeat(MAX_BRAND_WORDMARK_PREFIX_LENGTH),
        sidebarBrandImage: {
          id: "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp",
          url: "/api/branding/sidebar-image/sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp",
          mimeType: "image/webp",
          width: 4096,
          height: 4096,
          sizeBytes: MAX_SIDEBAR_BRAND_IMAGE_FILE_BYTES,
        },
        sidebarBrandImageDataUrl: "x".repeat(MAX_SIDEBAR_BRAND_IMAGE_DATA_URL_LENGTH),
        sidebarStarSpeed: MIN_SIDEBAR_STAR_SPEED,
      }),
    ).toEqual({
      brandWordmarkPrefix: "x".repeat(MAX_BRAND_WORDMARK_PREFIX_LENGTH),
      sidebarBrandImage: {
        id: "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp",
        url: "/api/branding/sidebar-image/sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp",
        mimeType: "image/webp",
        width: 4096,
        height: 4096,
        sizeBytes: MAX_SIDEBAR_BRAND_IMAGE_FILE_BYTES,
      },
      sidebarBrandImageDataUrl: "x".repeat(MAX_SIDEBAR_BRAND_IMAGE_DATA_URL_LENGTH),
      sidebarStarSpeed: MIN_SIDEBAR_STAR_SPEED,
    });

    expect(decodeClientSettingsPatch({ sidebarStarSpeed: MAX_SIDEBAR_STAR_SPEED })).toEqual({
      sidebarStarSpeed: MAX_SIDEBAR_STAR_SPEED,
    });
    expect(() =>
      decodeClientSettingsPatch({ sidebarStarSpeed: MIN_SIDEBAR_STAR_SPEED / 2 }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({ sidebarStarSpeed: MAX_SIDEBAR_STAR_SPEED * 2 }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        brandWordmarkPrefix: "x".repeat(MAX_BRAND_WORDMARK_PREFIX_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        sidebarBrandImageDataUrl: "x".repeat(MAX_SIDEBAR_BRAND_IMAGE_DATA_URL_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        sidebarBrandImage: {
          id: "brand.png",
          url: "/api/branding/sidebar-image/brand.png",
          mimeType: "image/png",
          width: 128,
          height: 160,
          sizeBytes: 1024,
        },
      }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        sidebarBrandImage: {
          id: "sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.png",
          url: "/api/branding/sidebar-image/sha256-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.png",
          mimeType: "image/svg+xml",
          width: 128,
          height: 160,
          sizeBytes: 1024,
        },
      }),
    ).toThrow();
    expect(() =>
      decodeClientSettingsPatch({
        sidebarBrandImage: {
          id: "sha256-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.png",
          url: "/api/branding/sidebar-image/sha256-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd.png",
          mimeType: "image/png",
          width: 4097,
          height: 160,
          sizeBytes: 1024,
        },
      }),
    ).toThrow();
  });

  it("decodes legacy data URL settings alongside compact branding metadata", () => {
    expect(
      decodeClientSettings({
        sidebarBrandImageDataUrl: "data:image/png;base64,abc123",
      }).sidebarBrandImageDataUrl,
    ).toBe("data:image/png;base64,abc123");

    expect(
      decodeClientSettings({
        sidebarBrandImage: {
          id: "sha256-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.jpg",
          url: "/api/branding/sidebar-image/sha256-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.jpg",
          mimeType: "image/jpeg",
          width: 320,
          height: 400,
          sizeBytes: 2048,
        },
      }).sidebarBrandImageDataUrl,
    ).toBe("");
  });
});

describe("provider settings", () => {
  it("defaults Codex and Claude provider runtime source to system", () => {
    expect(decodeCodexSettings({}).runtimeSource).toBe("system");
    expect(decodeClaudeSettings({}).runtimeSource).toBe("system");
  });

  it("defaults local model mode off and persists it through provider patches", () => {
    expect(decodeCodexSettings({}).ossMode).toBe(false);
    expect(
      decodeServerSettingsPatch({
        providers: {
          codex: { ossMode: true },
        },
      }),
    ).toEqual({
      providers: {
        codex: { ossMode: true },
      },
    });
  });

  it("accepts bundled provider runtime source in server settings patches", () => {
    expect(
      decodeServerSettingsPatch({
        providers: {
          codex: { runtimeSource: "bundled" },
          claudeAgent: { runtimeSource: "bundled" },
        },
      }),
    ).toEqual({
      providers: {
        codex: { runtimeSource: "bundled" },
        claudeAgent: { runtimeSource: "bundled" },
      },
    });

    expect(() =>
      decodeServerSettingsPatch({
        providers: {
          codex: { runtimeSource: "global" },
        },
      }),
    ).toThrow();
  });

  it("leaves the Codex auto-compact limit unset for upstream resolution", () => {
    expect(decodeCodexSettings({}).autoCompactTokenLimit).toBeUndefined();
  });

  it("defaults ultra caching off and persists it independently per provider", () => {
    expect(CODEX_ULTRA_CACHING_AUTO_COMPACT_TOKEN_LIMIT).toBe(120_000);
    expect(decodeCodexSettings({}).ultraCaching).toBe(false);
    expect(decodeClaudeSettings({}).ultraCaching).toBe(false);
    expect(decodeCodexSettings({ ultraCaching: true }).ultraCaching).toBe(true);
    expect(decodeCodexSettings({ ultraCaching: true }).autoCompactTokenLimit).toBeUndefined();
    expect(decodeClaudeSettings({ ultraCaching: true }).ultraCaching).toBe(true);
    expect(
      decodeServerSettingsPatch({
        providers: {
          codex: { ultraCaching: true },
          claudeAgent: { ultraCaching: true },
        },
      }),
    ).toEqual({
      providers: {
        codex: { ultraCaching: true },
        claudeAgent: { ultraCaching: true },
      },
    });
  });

  it("decodes a configured Codex auto-compact token limit", () => {
    expect(decodeCodexSettings({ autoCompactTokenLimit: 150_000 }).autoCompactTokenLimit).toBe(
      150_000,
    );
  });

  it("rejects non-positive or non-integer Codex auto-compact token limits", () => {
    expect(() => decodeCodexSettings({ autoCompactTokenLimit: 0 })).toThrow();
    expect(() => decodeCodexSettings({ autoCompactTokenLimit: -1 })).toThrow();
    expect(() => decodeCodexSettings({ autoCompactTokenLimit: 1.5 })).toThrow();
    expect(() => decodeCodexSettings({ autoCompactTokenLimit: Number.NaN })).toThrow();
    expect(() =>
      decodeCodexSettings({ autoCompactTokenLimit: Number.POSITIVE_INFINITY }),
    ).toThrow();
  });

  it("saves the Codex auto-compact token limit through legacy and per-instance patches", () => {
    expect(
      decodeServerSettingsPatch({
        providers: {
          codex: { autoCompactTokenLimit: 150_000 },
        },
      }),
    ).toEqual({
      providers: {
        codex: { autoCompactTokenLimit: 150_000 },
      },
    });

    expect(() =>
      decodeServerSettingsPatch({
        providers: {
          codex: { autoCompactTokenLimit: 0 },
        },
      }),
    ).toThrow();
  });
});
