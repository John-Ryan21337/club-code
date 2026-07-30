import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@cafecode/contracts/settings";
import { describe, expect, it } from "vitest";

import {
  partitionRendererLocalClientSettingsPatch,
  withoutRendererLocalClientSettings,
  withRendererLocalClientSettings,
} from "./rendererLocalClientSettings";

describe("renderer-local client settings", () => {
  it("keeps presentation and third-party consent out of shared patches", () => {
    const { localPatch, sharedPatch } = partitionRendererLocalClientSettingsPatch({
      atmosphereConsoleEnabled: false,
      mobileOptimizedPresentation: true,
      worldClockWeatherEnabled: true,
      worldClockEnabled: true,
    });

    expect(localPatch).toEqual({
      atmosphereConsoleEnabled: false,
      mobileOptimizedPresentation: true,
      worldClockWeatherEnabled: true,
    });
    expect(sharedPatch).toEqual({ worldClockEnabled: true });
  });

  it("strips renderer-local fields from legacy import candidates", () => {
    const settings: ClientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      atmosphereConsoleEnabled: false,
      mobileOptimizedPresentation: true,
      worldClockWeatherEnabled: true,
    };

    expect(withoutRendererLocalClientSettings(settings)).not.toHaveProperty(
      "atmosphereConsoleEnabled",
    );
    expect(withoutRendererLocalClientSettings(settings)).not.toHaveProperty(
      "mobileOptimizedPresentation",
    );
    expect(withoutRendererLocalClientSettings(settings)).not.toHaveProperty(
      "worldClockWeatherEnabled",
    );
  });

  it("lets the local snapshot override legacy shared values", () => {
    expect(
      withRendererLocalClientSettings(
        {
          ...DEFAULT_CLIENT_SETTINGS,
          atmosphereConsoleEnabled: false,
          mobileOptimizedPresentation: true,
          worldClockWeatherEnabled: true,
        },
        {
          atmosphereConsoleEnabled: true,
          mobileOptimizedPresentation: false,
          worldClockWeatherEnabled: false,
        },
      ),
    ).toMatchObject({
      atmosphereConsoleEnabled: true,
      mobileOptimizedPresentation: false,
      worldClockWeatherEnabled: false,
    });
  });
});
