import type { ClientSettingsPatch } from "@cafecode/contracts/settings";

/**
 * Build the complete operator-authored presentation patch.
 *
 * Entering Mobile optimized mode deliberately turns on Matrix, but it does not
 * reset any Matrix appearance or motion values. Leaving the mode changes only
 * the presentation override, so Matrix remains enabled until the operator
 * changes it independently.
 */
export function createMobileOptimizedPresentationPatch(enabled: boolean): ClientSettingsPatch {
  if (!enabled) {
    return { mobileOptimizedPresentation: false };
  }
  return {
    mobileOptimizedPresentation: true,
    fallingEffectsEnabled: true,
    fallingEffectKind: "matrix",
  };
}

export function resolveMobileLayout(
  viewportMatchesMobile: boolean,
  mobileOptimizedPresentation: boolean,
): boolean {
  return viewportMatchesMobile || mobileOptimizedPresentation;
}
