declare module "butterchurn" {
  export type ButterchurnPreset = Record<string, unknown>;

  export interface ButterchurnVisualizer {
    connectAudio(audioNode: AudioNode): void;
    disconnectAudio(audioNode: AudioNode): void;
    loadPreset(preset: ButterchurnPreset, blendTime?: number): void;
    setRendererSize(
      width: number,
      height: number,
      options?: {
        readonly pixelRatio?: number;
        readonly textureRatio?: number;
        readonly meshWidth?: number;
        readonly meshHeight?: number;
      },
    ): void;
    render(): void;
  }

  export interface ButterchurnPresetPack {
    getPresets(): Record<string, ButterchurnPreset>;
  }

  const butterchurn: {
    createVisualizer(
      audioContext: AudioContext,
      canvas: HTMLCanvasElement,
      options: {
        readonly width: number;
        readonly height: number;
        readonly pixelRatio?: number;
        readonly textureRatio?: number;
        readonly meshWidth?: number;
        readonly meshHeight?: number;
      },
    ): ButterchurnVisualizer;
  };

  export default butterchurn;
}

declare module "butterchurn-presets" {
  import type { ButterchurnPresetPack } from "butterchurn";

  const presets: ButterchurnPresetPack;
  export default presets;
}

declare module "butterchurn-presets/lib/butterchurnPresetsExtra.min.js" {
  import type { ButterchurnPresetPack } from "butterchurn";

  const presets: ButterchurnPresetPack;
  export default presets;
}

declare module "butterchurn-presets/lib/butterchurnPresetsExtra2.min.js" {
  import type { ButterchurnPresetPack } from "butterchurn";

  const presets: ButterchurnPresetPack;
  export default presets;
}

declare module "butterchurn-presets/lib/butterchurnPresetsMD1.min.js" {
  import type { ButterchurnPresetPack } from "butterchurn";

  const presets: ButterchurnPresetPack;
  export default presets;
}

declare module "butterchurn-presets/lib/butterchurnPresetsMinimal.min.js" {
  import type { ButterchurnPresetPack } from "butterchurn";

  const presets: ButterchurnPresetPack;
  export default presets;
}

declare module "butterchurn-presets/lib/butterchurnPresetsNonMinimal.min.js" {
  import type { ButterchurnPresetPack } from "butterchurn";

  const presets: ButterchurnPresetPack;
  export default presets;
}
