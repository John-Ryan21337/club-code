import { DEFAULT_CLIENT_SETTINGS } from "@cafecode/contracts/settings";
import { describe, expect, it } from "vitest";
import {
  withRendererLocalClientSettings,
  withoutRendererLocalClientSettings,
} from "./rendererLocalClientSettings";

describe("renderer-local language", () => {
  it("keeps shared preference patches while stripping language from server writes and imports", () => {
    expect(
      withoutRendererLocalClientSettings({ uiLanguage: "dual", interfaceScalePercent: 125 }),
    ).toEqual({ interfaceScalePercent: 125 });
    expect(withoutRendererLocalClientSettings({ uiLanguage: "ja" })).toEqual({});
  });
  it("uses the renderer's language while retaining other shared preferences", () => {
    expect(
      withRendererLocalClientSettings(
        { ...DEFAULT_CLIENT_SETTINGS, uiLanguage: "ja", interfaceScalePercent: 125 },
        { uiLanguage: "en" },
      ),
    ).toMatchObject({ uiLanguage: "en", interfaceScalePercent: 125 });
  });
});
