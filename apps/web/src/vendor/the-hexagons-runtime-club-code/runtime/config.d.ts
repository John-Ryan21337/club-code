export interface HexagonsPresentationSettings {
  readonly [key: string]: boolean | number | string;
}

export interface HexagonsRuntimeSettings extends HexagonsPresentationSettings {
  readonly schemaVersion: 14;
  readonly enabled: boolean;
  readonly fallingEffectsEnabled: boolean;
  readonly renderer: "auto" | "gpu" | "canvas";
  readonly reducedMotion: "system" | "always" | "never";
  readonly continueBackgroundAnimations: boolean;
  readonly tessellationMode: "rhombille" | "cairo-pentagon" | "hexagram";
  readonly colorPattern:
    | "facet"
    | "backyard-star"
    | "rotating-triplets"
    | "checker"
    | "rings"
    | "seeded-mosaic";
  readonly patternScale: number;
  readonly patternPhase: number;
  readonly patternRotation: number;
  readonly patternMirror: boolean;
  readonly pistonPattern:
    | "individual"
    | "six-one"
    | "twelve-rhombus"
    | "rhombus-six-one"
    | "star-hex-twelve";
  readonly meshEnergyTracePistons: boolean;
  readonly meshEnergyPattern:
    | "tile-grid"
    | "piston-groups"
    | "six-point-stars"
    | "stars-and-pistons";
  readonly meshEnergyFlowMode: "natural" | "directional";
  readonly meshEnergyFlowAngle: number;
}

export const SCHEMA_VERSION: 14;
export const PROFILE_PRESENTATION_KEYS: readonly string[];

export function normalizeSettings(
  input?: Readonly<Record<string, unknown>>,
): HexagonsRuntimeSettings;

export function presentationProfile(
  settings: Readonly<Record<string, unknown>>,
): HexagonsPresentationSettings;
