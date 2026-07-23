import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";

import {
  AMBIENT_CLIENT_SETTINGS_KEYS,
  ClientSettingsPatch,
  ClientSettingsSchema,
  CodexSettings,
  ClaudeSettings,
  DEFAULT_AMBIENT_CLIENT_SETTINGS,
  DEFAULT_AMBIENT_COLOR,
  DEFAULT_AMBIENT_IMAGE_ASSET,
  DEFAULT_AMBIENT_IMAGE_ENABLED,
  DEFAULT_AMBIENT_IMAGE_GLOW_ENABLED,
  DEFAULT_AMBIENT_IMAGE_LAYOUT_MODE,
  DEFAULT_AMBIENT_IMAGE_PRESET_PLACEMENT,
  DEFAULT_AMBIENT_IMAGE_PRESET_SIZE,
  DEFAULT_AMBIENT_OPACITY,
  DEFAULT_AMBIENT_VIDEO_ENABLED,
  DEFAULT_AMBIENT_VIDEO_GLOW_ENABLED,
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
  DEFAULT_BRAND_WORDMARK_PREFIX,
  DEFAULT_CHAT_COPY_FORMAT,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_CONTINUE_BACKGROUND_ANIMATIONS,
  DEFAULT_FALLING_EFFECT_KIND,
  DEFAULT_FALLING_EFFECT_SPEED,
  DEFAULT_FALLING_EFFECTS_ENABLED,
  DEFAULT_POWER_SAVE_BLOCKER_MODE,
  DEFAULT_SHOW_SIDEBAR_ATTRIBUTION,
  DEFAULT_SIDEBAR_BRAND_IMAGE_DATA_URL,
  DEFAULT_SIDEBAR_BRAND_IMAGE,
  DEFAULT_SIDEBAR_STAR_SPEED,
  DEFAULT_SHOW_SIDEBAR_MASCOT,
  DEFAULT_SHOW_SIDEBAR_SEARCH,
  DEFAULT_THEME_ACCENT_COLOR,
  MAX_AMBIENT_IMAGE_DIMENSION,
  MAX_AMBIENT_IMAGE_FILE_BYTES,
  MAX_AMBIENT_OPACITY,
  MAX_BRAND_WORDMARK_PREFIX_LENGTH,
  MAX_FALLING_EFFECT_SPEED,
  MAX_SIDEBAR_BRAND_IMAGE_DATA_URL_LENGTH,
  MAX_SIDEBAR_BRAND_IMAGE_FILE_BYTES,
  MAX_SIDEBAR_BRAND_IMAGE_ID_LENGTH,
  MAX_AMBIANCE_INTENSITY,
  MAX_SIDEBAR_STAR_SPEED,
  MIN_AMBIANCE_INTENSITY,
  MIN_AMBIENT_OPACITY,
  MIN_FALLING_EFFECT_SPEED,
  MIN_SIDEBAR_STAR_SPEED,
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
    expect(decodeClientSettings({}).continueBackgroundAnimations).toBe(false);
    expect(decodeClientSettings({}).showSidebarSearch).toBe(true);
    expect(decodeClientSettings({}).showSidebarMascot).toBe(true);
    expect(decodeClientSettings({}).showSidebarAttribution).toBe(true);
    expect(decodeClientSettings({}).brandWordmarkPrefix).toBe("Cafe");
    expect(decodeClientSettings({}).sidebarBrandImage).toBeNull();
    expect(decodeClientSettings({}).sidebarBrandImageDataUrl).toBe("");
    expect(decodeClientSettings({}).sidebarStarSpeed).toBe(1);
    expect(decodeClientSettings({}).themeAccentColor).toBe("");
    expect(decodeClientSettings({}).appAccentColor).toBe("");
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
      fallingEffectOpacity: DEFAULT_AMBIENT_OPACITY,
      fallingEffectSpeed: DEFAULT_FALLING_EFFECT_SPEED,
      ambientVideoEnabled: DEFAULT_AMBIENT_VIDEO_ENABLED,
      ambientVideoSource: DEFAULT_AMBIENT_VIDEO_SOURCE,
      ambientVideoLayoutMode: DEFAULT_AMBIENT_VIDEO_LAYOUT_MODE,
      ambientVideoPresetPlacement: DEFAULT_AMBIENT_VIDEO_PRESET_PLACEMENT,
      ambientVideoPresetSize: DEFAULT_AMBIENT_VIDEO_PRESET_SIZE,
      ambientVideoPresentationMode: DEFAULT_AMBIENT_VIDEO_PRESENTATION_MODE,
      ambientVideoGlowEnabled: DEFAULT_AMBIENT_VIDEO_GLOW_ENABLED,
      ambientVideoGlowColor: DEFAULT_AMBIENT_COLOR,
      ambientVideoGlowOpacity: DEFAULT_AMBIENT_OPACITY,
      ambientImageEnabled: DEFAULT_AMBIENT_IMAGE_ENABLED,
      ambientImageAsset: DEFAULT_AMBIENT_IMAGE_ASSET,
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
      fallingEffectOpacity: MAX_AMBIENT_OPACITY,
      fallingEffectSpeed: MAX_FALLING_EFFECT_SPEED,
      ambientVideoEnabled: true,
      ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
      ambientVideoLayoutMode: "custom",
      ambientVideoPresetPlacement: "bottom-left",
      ambientVideoPresetSize: "large",
      ambientVideoPresentationMode: "cinema",
      ambientVideoGlowEnabled: true,
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
      fallingEffectOpacity: MAX_AMBIENT_OPACITY,
      fallingEffectSpeed: MAX_FALLING_EFFECT_SPEED,
      ambientVideoEnabled: true,
      ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
      ambientVideoLayoutMode: "custom",
      ambientVideoPresetPlacement: "bottom-left",
      ambientVideoPresetSize: "large",
      ambientVideoPresentationMode: "cinema",
      ambientVideoGlowEnabled: true,
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
        ambientVideoSource: { kind: "playlist", id: "PL1234567890" },
      }),
    ).toEqual({
      ambientVideoSource: { kind: "playlist", id: "PL1234567890" },
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

  it("bounds ambient colors, opacity, speed, and layout enums", () => {
    expect(
      decodeClientSettingsPatch({
        fallingEffectColor: "auto",
        fallingEffectOpacity: MIN_AMBIENT_OPACITY,
        fallingEffectSpeed: MIN_FALLING_EFFECT_SPEED,
        ambientVideoGlowOpacity: MAX_AMBIENT_OPACITY,
      }),
    ).toEqual({
      fallingEffectColor: "auto",
      fallingEffectOpacity: MIN_AMBIENT_OPACITY,
      fallingEffectSpeed: MIN_FALLING_EFFECT_SPEED,
      ambientVideoGlowOpacity: MAX_AMBIENT_OPACITY,
    });

    for (const invalidPatch of [
      { fallingEffectColor: "#12345" },
      { fallingEffectColor: "red" },
      { fallingEffectOpacity: MIN_AMBIENT_OPACITY - 0.01 },
      { fallingEffectOpacity: MAX_AMBIENT_OPACITY + 0.01 },
      { fallingEffectOpacity: Number.NaN },
      { fallingEffectSpeed: MIN_FALLING_EFFECT_SPEED - 0.01 },
      { fallingEffectSpeed: MAX_FALLING_EFFECT_SPEED + 0.01 },
      { ambientVideoLayoutMode: "floating" },
      { ambientVideoPresentationMode: "fullscreen" },
      { ambientVideoPresetPlacement: "top-left" },
      { ambientImagePresetSize: "extra-large" },
    ]) {
      expect(() => decodeClientSettingsPatch(invalidPatch)).toThrow();
    }
  });

  it("validates ambient image metadata independently of upload bytes", () => {
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
