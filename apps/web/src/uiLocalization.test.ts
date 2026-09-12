import { describe, expect, it } from "vitest";

import {
  isKnownEnglishUiText,
  localizeUiText,
  resolveSystemUiLanguage,
  resolveUiLanguage,
} from "./uiLocalizationCore";

describe("UI localization", () => {
  it("resolves system language deterministically", () => {
    expect(resolveSystemUiLanguage(["ja-JP", "en-US"])).toBe("ja");
    expect(resolveSystemUiLanguage(["en-US", "ja-JP"])).toBe("en");
    expect(resolveSystemUiLanguage(["en-US", "fr-FR"])).toBe("en");
    expect(resolveUiLanguage("system", ["ja-JP"])).toBe("ja");
    expect(resolveUiLanguage("dual", ["en-US"])).toBe("dual");
  });

  it("renders Japanese and dual labels without fabricating missing translations", () => {
    expect(localizeUiText("Settings", "en", "設定")).toBe("Settings");
    expect(localizeUiText("Settings", "ja", "設定")).toBe("設定");
    expect(localizeUiText("Settings", "dual", "設定")).toBe("Settings / 設定");
    expect(localizeUiText("Operator-authored content", "ja")).toBe("Operator-authored content");
  });

  it("identifies authored English by source key instead of ambiguous Japanese reverse lookup", () => {
    expect(isKnownEnglishUiText("Remove")).toBe(true);
    expect(isKnownEnglishUiText("Delete")).toBe(true);
    expect(localizeUiText("Remove", "ja")).toBe("削除");
    expect(localizeUiText("Delete", "ja")).toBe("削除");
    expect(isKnownEnglishUiText("削除")).toBe(false);
  });
});
