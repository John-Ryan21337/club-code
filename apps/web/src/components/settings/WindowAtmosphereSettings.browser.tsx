import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@cafecode/contracts/settings";
import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { WindowAtmosphereSettings } from "./WindowAtmosphereSettings";
import "../../index.css";

const testState = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  atmosphereAvailable: true,
  updateSettings: vi.fn(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: <T,>(selector?: (settings: UnifiedSettings) => T) => {
    const settings = testState.settings ?? DEFAULT_UNIFIED_SETTINGS;
    return selector ? selector(settings) : settings;
  },
  useUpdateSettings: () => ({ updateSettings: testState.updateSettings }),
}));

vi.mock("../../rpc/serverState", () => ({
  useServerConfig: () => ({
    ambientExperienceCapabilities: { atmosphere: testState.atmosphereAvailable },
  }),
}));

describe("WindowAtmosphereSettings", () => {
  beforeEach(() => {
    testState.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
    };
    testState.atmosphereAvailable = true;
    testState.updateSettings.mockReset();
  });

  it("offers the opt-in vocabulary control and persists selections", async () => {
    const screen = await render(<WindowAtmosphereSettings />);

    await expect.element(page.getByText("Window atmosphere", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByText("Matrix color mode", { exact: true })).toBeInTheDocument();
    await expect
      .element(page.getByText("Roman / Japanese mix", { exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("switch", { name: "Live work vocabulary / 作業語彙" }))
      .not.toBeChecked();
    await page.getByRole("switch", { name: "Live work vocabulary / 作業語彙" }).click();
    expect(testState.updateSettings).toHaveBeenCalledWith({
      fallingEffectLiveWorkVocabularyEnabled: true,
    });
    const routes = page.getByRole("switch", {
      name: "Provider activity routes / プロバイダー活動経路",
    });
    await expect.element(routes).not.toBeChecked();
    await routes.click();
    expect(testState.updateSettings).toHaveBeenCalledWith({ fallingEffectActivityLinks: true });

    await page.getByText("Rain", { exact: true }).click();
    expect(testState.updateSettings).toHaveBeenCalledWith({ fallingEffectKind: "rain" });

    await page.getByText("Rainbow Extra", { exact: true }).click();
    expect(testState.updateSettings).toHaveBeenCalledWith({
      fallingEffectMatrixColorMode: "rainbow-extra",
    });

    await screen.unmount();
  });

  it("fails closed when the server does not expose atmosphere support", async () => {
    testState.atmosphereAvailable = false;
    const screen = await render(<WindowAtmosphereSettings />);

    await expect
      .element(page.getByText("This server has not enabled the window atmosphere capability."))
      .toBeInTheDocument();
    await expect.element(page.getByLabelText("Show falling effects")).toBeDisabled();
    await expect.element(page.getByText("Effect", { exact: true })).not.toBeInTheDocument();

    await screen.unmount();
  });

  it("saves route category, palette and bounded retention changes", async () => {
    testState.settings = { ...testState.settings!, fallingEffectActivityLinks: true };
    const screen = await render(<WindowAtmosphereSettings />);
    await page.getByRole("switch", { name: "Activity: Network / 通信" }).click();
    expect(testState.updateSettings).toHaveBeenCalledWith({
      fallingEffectActivityLinkNetworkEnabled: false,
    });
    await page.getByRole("radio", { name: "Matrix palette / Matrix の色" }).click();
    expect(testState.updateSettings).toHaveBeenCalledWith({
      fallingEffectActivityLinkColorMode: "matrix",
    });
    await page.getByLabelText("Increase route retention / 保持時間を増やす").click();
    expect(testState.updateSettings).toHaveBeenCalledWith({
      fallingEffectActivityLinkRetentionSeconds: 31,
    });
    testState.settings = { ...testState.settings!, fallingEffectActivityLinkRetentionSeconds: 120 };
    await screen.rerender(<WindowAtmosphereSettings />);
    await expect
      .element(page.getByLabelText("Increase route retention / 保持時間を増やす"))
      .toBeDisabled();
    await screen.unmount();
  });

  it("resets every base atmosphere field together", async () => {
    testState.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
      fallingEffectColor: "#123456",
      fallingEffectMatrixColorMode: "rainbow-extra",
      fallingEffectOpacity: 0.8,
      fallingEffectSpeed: 2,
      fallingEffectDensity: 2,
      fallingEffectJapaneseRatio: 0.8,
      fallingEffectMatrixMotionMode: "walk-forward",
      fallingEffectMatrixWalkEndFontSize: 96,
    };
    const screen = await render(<WindowAtmosphereSettings />);

    await page.getByLabelText("Reset window atmosphere").click();
    expect(testState.updateSettings).toHaveBeenCalledWith({
      fallingEffectsEnabled: false,
      fallingEffectKind: "snow",
      fallingEffectColor: "auto",
      fallingEffectMatrixColorMode: "fixed",
      fallingEffectMatrixColorCycleSpeed: 1,
      fallingEffectMatrixBaseFontSize: 14,
      fallingEffectMatrixMotionMode: "flat",
      fallingEffectMatrixWalkStartFontSize: 1,
      fallingEffectMatrixWalkEndFontSize: 72,
      fallingEffectMatrixWalkLifecyclePercent: 30,
      fallingEffectMatrixCenterWindIntensity: 4,
      fallingEffectOpacity: 0.35,
      fallingEffectSpeed: 1,
      fallingEffectDensity: 1,
      fallingEffectJapaneseRatio: 0.45,
      fallingEffectLiveWorkVocabularyEnabled: false,
      fallingEffectActivityLinks: false,
      fallingEffectActivityLinkNetworkEnabled: true,
      fallingEffectActivityLinkDatabaseEnabled: true,
      fallingEffectActivityLinkBuildEnabled: true,
      fallingEffectActivityLinkAgentEnabled: true,
      fallingEffectActivityLinkWorkEnabled: true,
      fallingEffectActivityLinkColorMode: "random",
      fallingEffectActivityLinkRetentionSeconds: 30,
    });

    await screen.unmount();
  });
});
