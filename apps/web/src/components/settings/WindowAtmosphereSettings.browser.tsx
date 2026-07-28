import "../../index.css";

import {
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE,
  DEFAULT_UNIFIED_SETTINGS,
  MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
  MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
  type UnifiedSettings,
} from "@cafecode/contracts/settings";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

const mocks = vi.hoisted(() => ({
  settings: null as unknown as UnifiedSettings,
  updateSettings: vi.fn(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => mocks.settings,
  useUpdateSettings: () => ({ updateSettings: mocks.updateSettings }),
}));

vi.mock("../../rpc/serverState", () => ({
  useServerConfig: () => ({
    ambientExperienceCapabilities: { atmosphere: true },
  }),
}));

import { WindowAtmosphereSettings } from "./WindowAtmosphereSettings";

beforeEach(() => {
  document.body.innerHTML = "";
  mocks.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    fallingEffectsEnabled: true,
    fallingEffectKind: "snow",
    fallingEffectMatrixMotionMode: "flat",
  };
  mocks.updateSettings.mockReset();
});

describe("WindowAtmosphereSettings motion", () => {
  it("offers every motion mode for snow, rain, and Matrix", async () => {
    const mounted = await render(<WindowAtmosphereSettings />);

    for (const kind of ["snow", "rain", "matrix"] as const) {
      mocks.settings = {
        ...mocks.settings,
        fallingEffectKind: kind,
        fallingEffectMatrixMotionMode: "flat",
      };
      await mounted.rerender(<WindowAtmosphereSettings />);

      for (const [label, value] of [
        ["Forward", "forward"],
        ["Reverse", "reverse"],
        ["Warp", "tunnel"],
        ["Walk Forward", "walk-forward"],
        ["Walk Reverse", "walk-reverse"],
      ] as const) {
        const choice = page.getByRole("radio", { name: label, exact: true });
        await expect.element(choice).toBeInTheDocument();
        await choice.click();
        expect(mocks.updateSettings).toHaveBeenLastCalledWith({
          fallingEffectMatrixMotionMode: value,
        });
      }

      mocks.settings = { ...mocks.settings, fallingEffectMatrixMotionMode: "forward" };
      await mounted.rerender(<WindowAtmosphereSettings />);
      await page.getByRole("radio", { name: "Flat", exact: true }).click();
      expect(mocks.updateSettings).toHaveBeenLastCalledWith({
        fallingEffectMatrixMotionMode: "flat",
      });
    }

    await mounted.unmount();
  });

  it("commits directly typed Walk endpoints exactly once at their two-decimal values", async () => {
    const mounted = await render(<WindowAtmosphereSettings />);
    const startInput = page.getByLabelText("Walk start font size", { exact: true });
    const endInput = page.getByLabelText("Walk end font size", { exact: true });

    await expect.element(startInput).toHaveValue("1.00");
    await expect.element(endInput).toHaveValue("72.00");

    await startInput.fill("12.34");
    await expect.element(startInput).toHaveValue("12.34");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    await endInput.click();
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixWalkStartFontSize: 12.34,
    });

    mocks.updateSettings.mockClear();
    await endInput.fill("98.76");
    await expect.element(endInput).toHaveValue("98.76");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    await startInput.click();
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixWalkEndFontSize: 98.76,
    });

    mocks.updateSettings.mockClear();
    await startInput.fill("17.89");
    await expect.element(startInput).toHaveValue("17.89");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixWalkStartFontSize: 17.89,
    });

    await mounted.unmount();
  });

  it("steps persisted Walk endpoints at 0.01px resolution and enforces UI bounds", async () => {
    const mounted = await render(<WindowAtmosphereSettings />);

    await page.getByLabelText("Increase Walk start font size").click();
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixWalkStartFontSize: 1.01,
    });

    await page.getByLabelText("Decrease Walk end font size").click();
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixWalkEndFontSize: 71.99,
    });

    mocks.settings = {
      ...mocks.settings,
      fallingEffectMatrixWalkStartFontSize: MIN_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
      fallingEffectMatrixWalkEndFontSize: MAX_FALLING_EFFECT_MATRIX_WALK_FONT_SIZE,
    };
    await mounted.rerender(<WindowAtmosphereSettings />);

    await expect.element(page.getByLabelText("Decrease Walk start font size")).toBeDisabled();
    await expect.element(page.getByLabelText("Increase Walk end font size")).toBeDisabled();

    await mounted.unmount();
  });

  it("restores Flat with the complete atmosphere reset", async () => {
    mocks.settings = {
      ...mocks.settings,
      fallingEffectMatrixMotionMode: "reverse",
      fallingEffectMatrixWalkStartFontSize: 12,
      fallingEffectMatrixWalkEndFontSize: 24,
      fallingEffect2chEnriched: true,
    };
    const mounted = await render(<WindowAtmosphereSettings />);

    await page.getByRole("button", { name: "Reset window atmosphere to default" }).click();

    expect(mocks.updateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fallingEffectMatrixMotionMode: DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE,
        fallingEffectMatrixWalkStartFontSize: DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
        fallingEffectMatrixWalkEndFontSize: DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
        fallingEffect2chEnriched: false,
      }),
    );

    await mounted.unmount();
  });
});
