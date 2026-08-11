export interface HexagonsPresentationSettings {
  readonly [key: string]: boolean | number | string;
}

export interface HexagonsRuntimeSettings extends HexagonsPresentationSettings {
  readonly enabled: boolean;
  readonly fallingEffectsEnabled: boolean;
  readonly renderer: "auto" | "gpu" | "canvas";
  readonly reducedMotion: "system" | "always" | "never";
  readonly continueBackgroundAnimations: boolean;
}

export const PROFILE_PRESENTATION_KEYS: readonly string[];

export function normalizeSettings(
  input?: Readonly<Record<string, unknown>>,
): HexagonsRuntimeSettings;

export function presentationProfile(
  settings: Readonly<Record<string, unknown>>,
): HexagonsPresentationSettings;
