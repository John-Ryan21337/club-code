import { DEFAULT_CLIENT_SETTINGS } from "@cafecode/contracts/settings";
import { describe, expect, it } from "vitest";

import {
  createMobileOptimizedPresentationPatch,
  resolveMobileLayout,
  resolveProfileAwareMobileLayout,
} from "./mobilePresentation";
import {
  partitionRendererLocalClientSettingsPatch,
  withoutRendererLocalClientSettings,
  withRendererLocalClientSettings,
} from "./rendererLocalClientSettings";

describe("mobile presentation", () => {
  it("forces mobile reflow on wide viewports without changing natural responsive behavior", () => {
    expect(resolveMobileLayout(false, false)).toBe(false);
    expect(resolveMobileLayout(false, true)).toBe(true);
    expect(resolveMobileLayout(true, false)).toBe(true);
    expect(resolveMobileLayout(true, true)).toBe(true);
  });

  it("lets an active Desktop Profile override a physical phone viewport", () => {
    expect(resolveProfileAwareMobileLayout(true, false, "profile:desktop%20profile")).toBe(false);
    expect(resolveProfileAwareMobileLayout(true, true, "profile:mobile%20profile")).toBe(true);
    expect(resolveProfileAwareMobileLayout(true, false, null)).toBe(true);
  });

  it("enables Matrix while preserving every existing Matrix configuration value", () => {
    const configured = {
      ...DEFAULT_CLIENT_SETTINGS,
      fallingEffectsEnabled: false,
      fallingEffectKind: "snow" as const,
      fallingEffectMatrixBaseFontSize: 31,
      fallingEffectMatrixColorMode: "rainbow" as const,
      fallingEffectMatrixColorCycleSpeed: 7.25,
      fallingEffectMatrixMotionMode: "walk-reverse" as const,
      fallingEffectMatrixWalkStartFontSize: 9,
      fallingEffectMatrixWalkEndFontSize: 64,
      fallingEffectSpeed: 3.5,
      fallingEffectDensity: 2.25,
    };

    const enabled = {
      ...configured,
      ...createMobileOptimizedPresentationPatch(true),
    };

    expect(enabled).toEqual({
      ...configured,
      mobileOptimizedPresentation: true,
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
    });
  });

  it("restores responsive desktop presentation without turning Matrix off", () => {
    const enabled = {
      ...DEFAULT_CLIENT_SETTINGS,
      mobileOptimizedPresentation: true,
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix" as const,
    };

    const restored = {
      ...enabled,
      ...createMobileOptimizedPresentationPatch(false),
    };

    expect(createMobileOptimizedPresentationPatch(false)).toEqual({
      mobileOptimizedPresentation: false,
    });
    expect(restored.mobileOptimizedPresentation).toBe(false);
    expect(restored.fallingEffectsEnabled).toBe(true);
    expect(restored.fallingEffectKind).toBe("matrix");
  });

  it("keeps the layout override local while leaving Matrix changes server-shareable", () => {
    const { localPatch, sharedPatch } = partitionRendererLocalClientSettingsPatch(
      createMobileOptimizedPresentationPatch(true),
    );

    expect(localPatch).toEqual({ mobileOptimizedPresentation: true });
    expect(sharedPatch).toEqual({
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
    });
    expect(sharedPatch).not.toHaveProperty("mobileOptimizedPresentation");
  });

  it("uses the renderer-local override instead of a connected server copy", () => {
    const serverSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      mobileOptimizedPresentation: true,
      fallingEffectsEnabled: true,
    };
    const localSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      mobileOptimizedPresentation: false,
    };

    expect(withRendererLocalClientSettings(serverSettings, localSettings)).toMatchObject({
      mobileOptimizedPresentation: false,
      fallingEffectsEnabled: true,
    });
    expect(withoutRendererLocalClientSettings(serverSettings)).not.toHaveProperty(
      "mobileOptimizedPresentation",
    );
  });
});
