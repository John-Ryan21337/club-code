import "../../index.css";

import {
  DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE,
  DEFAULT_UNIFIED_SETTINGS,
  type UnifiedSettings,
} from "@cafecode/contracts/settings";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
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

  it("restores Flat with the complete atmosphere reset", async () => {
    mocks.settings = {
      ...mocks.settings,
      fallingEffectMatrixMotionMode: "reverse",
      fallingEffect2chEnriched: true,
    };
    const mounted = await render(<WindowAtmosphereSettings />);

    await page.getByRole("button", { name: "Reset window atmosphere to default" }).click();

    expect(mocks.updateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fallingEffectMatrixMotionMode: DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE,
        fallingEffect2chEnriched: false,
      }),
    );

    await mounted.unmount();
  });
});
