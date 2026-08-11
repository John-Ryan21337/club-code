import "../../index.css";

import {
  DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
  DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
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
  updateClientSettingsConfirmed: vi.fn(),
  toastAdd: vi.fn(),
  getHardwareLightingStatus: vi.fn(),
  refreshHardwareLighting: vi.fn(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => mocks.settings,
  useUpdateSettings: () => ({
    updateSettings: mocks.updateSettings,
    updateClientSettingsConfirmed: mocks.updateClientSettingsConfirmed,
  }),
}));

vi.mock("../../localApi", () => ({
  ensureLocalApi: () => ({
    server: {
      getHardwareLightingStatus: mocks.getHardwareLightingStatus,
      refreshHardwareLighting: mocks.refreshHardwareLighting,
    },
  }),
}));

vi.mock("../../rpc/serverState", () => ({
  useServerConfig: () => ({
    ambientExperienceCapabilities: { atmosphere: true },
  }),
}));

vi.mock("../ui/toast", () => ({
  stackedThreadToast: (toast: unknown) => toast,
  toastManager: { add: mocks.toastAdd },
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
  mocks.updateClientSettingsConfirmed.mockReset();
  mocks.updateClientSettingsConfirmed.mockResolvedValue(undefined);
  mocks.toastAdd.mockReset();
  const lightingStatus = {
    state: "available" as const,
    adapter: "OpenRGB SDK (loopback)" as const,
    detail: "OpenRGB is connected with 1 compatible controller.",
    protocolVersion: 5,
    controllers: [
      {
        id: "0123456789abcdef0123456789abcdef",
        name: "Desk Keyboard",
        vendor: "Example Vendor",
        type: "keyboard" as const,
        ledCount: 104,
        supported: true,
      },
    ],
    selectedControllerCount: 0,
    lastFrameAt: null,
    lastDisposition: null,
  };
  mocks.getHardwareLightingStatus.mockReset();
  mocks.getHardwareLightingStatus.mockResolvedValue(lightingStatus);
  mocks.refreshHardwareLighting.mockReset();
  mocks.refreshHardwareLighting.mockResolvedValue(lightingStatus);
});

describe("WindowAtmosphereSettings motion", () => {
  it("discovers and explicitly opts into Matrix keyboard and case lighting", async () => {
    mocks.settings = {
      ...mocks.settings,
      fallingEffectKind: "matrix",
    };
    const mounted = await render(<WindowAtmosphereSettings />);

    await page.getByRole("button", { name: "Refresh devices" }).click();
    expect(mocks.refreshHardwareLighting).toHaveBeenCalledOnce();
    await expect.element(page.getByText("Desk Keyboard")).toBeInTheDocument();

    await page
      .getByRole("switch", { name: "Sync Matrix palette to keyboard and case RGB" })
      .click();
    expect(mocks.updateClientSettingsConfirmed).toHaveBeenLastCalledWith({
      hardwareLightingSyncEnabled: true,
    });

    await mounted.unmount();
  });

  it("persists the renderer-local Atmosphere console kill switch", async () => {
    const mounted = await render(<WindowAtmosphereSettings />);
    const toggle = page.getByRole("switch", { name: "Show Atmosphere console" });

    await expect.element(toggle).toBeChecked();
    await toggle.click();
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      atmosphereConsoleEnabled: false,
    });

    mocks.settings = { ...mocks.settings, atmosphereConsoleEnabled: false };
    await mounted.rerender(<WindowAtmosphereSettings />);
    await expect.element(toggle).not.toBeChecked();
  });

  it("keeps the cinema falling overlay opt-in and persists both toggle states", async () => {
    const mounted = await render(<WindowAtmosphereSettings />);
    const toggle = page.getByRole("switch", {
      name: "Overlay cinema video with falling atmosphere",
    });

    await expect.element(toggle).not.toBeChecked();
    await toggle.click();
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectsOverCinemaEnabled: true,
    });

    mocks.settings = {
      ...mocks.settings,
      fallingEffectsOverCinemaEnabled: true,
    };
    await mounted.rerender(<WindowAtmosphereSettings />);
    await expect.element(toggle).toBeChecked();
    await toggle.click();
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectsOverCinemaEnabled: false,
    });

    await mounted.unmount();
  });

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

  it("persists a Matrix-only baseline for non-Walk glyph modes", async () => {
    mocks.settings = { ...mocks.settings, fallingEffectKind: "matrix" };
    const mounted = await render(<WindowAtmosphereSettings />);
    const baseInput = page.getByLabelText("Matrix base font size", { exact: true });

    await expect.element(baseInput).toHaveValue("14");
    await expect
      .element(
        page.getByText(
          /Rain and snow geometry are unchanged\. Walk modes continue to use their absolute Start and End sizes\./u,
        ),
      )
      .toBeInTheDocument();

    await baseInput.fill("27.6");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixBaseFontSize: 28,
    });

    await mounted.unmount();
  });

  it("commits directly typed Walk endpoints exactly once on the 1px grid", async () => {
    const mounted = await render(<WindowAtmosphereSettings />);
    const startInput = page.getByLabelText("Walk start font size", { exact: true });
    const endInput = page.getByLabelText("Walk end font size", { exact: true });

    await expect.element(startInput).toHaveValue("1");
    await expect.element(endInput).toHaveValue("72");

    await startInput.fill("12.34");
    await expect.element(startInput).toHaveValue("12.34");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    await endInput.click();
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixWalkStartFontSize: 12,
    });

    mocks.updateSettings.mockClear();
    await endInput.fill("98.76");
    await expect.element(endInput).toHaveValue("98.76");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    await startInput.click();
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixWalkEndFontSize: 99,
    });

    mocks.updateSettings.mockClear();
    await startInput.fill("17.89");
    await expect.element(startInput).toHaveValue("17.89");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1);
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixWalkStartFontSize: 18,
    });

    await mounted.unmount();
  });

  it("steps persisted Walk endpoints at 1px resolution and enforces UI bounds", async () => {
    const mounted = await render(<WindowAtmosphereSettings />);

    await page.getByLabelText("Increase Walk start font size").click();
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixWalkStartFontSize: 2,
    });

    await page.getByLabelText("Decrease Walk end font size").click();
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixWalkEndFontSize: 71,
    });

    // Reflect those committed values through the mocked settings source before
    // moving to each bound, matching the real persisted-settings round trip.
    mocks.settings = {
      ...mocks.settings,
      fallingEffectMatrixWalkStartFontSize: 2,
      fallingEffectMatrixWalkEndFontSize: 71,
    };
    await mounted.rerender(<WindowAtmosphereSettings />);

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

  it("shows bounded Matrix Walk lifecycle and center-wind controls only in Walk modes", async () => {
    mocks.settings = {
      ...mocks.settings,
      fallingEffectKind: "matrix",
      fallingEffectMatrixMotionMode: "flat",
    };
    const mounted = await render(<WindowAtmosphereSettings />);
    await expect
      .element(page.getByLabelText("Walk symbol lifecycle distance", { exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByLabelText("Motion from center wind intensity", { exact: true }))
      .not.toBeInTheDocument();

    mocks.settings = {
      ...mocks.settings,
      fallingEffectMatrixMotionMode: "walk-forward",
    };
    await mounted.rerender(<WindowAtmosphereSettings />);
    const lifecycle = page.getByLabelText("Walk symbol lifecycle distance", { exact: true });
    const wind = page.getByLabelText("Motion from center wind intensity", { exact: true });
    await expect.element(lifecycle).toHaveValue("30");
    await expect.element(wind).toHaveValue("4");

    await lifecycle.fill("48");
    await userEvent.keyboard("{Enter}");
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixWalkLifecyclePercent: 48,
    });

    await wind.fill("9");
    await userEvent.keyboard("{Enter}");
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixCenterWindIntensity: 9,
    });

    await mounted.unmount();
  });

  it("normalizes legacy two-decimal Walk endpoints for display without rewriting on mount", async () => {
    mocks.settings = {
      ...mocks.settings,
      fallingEffectMatrixWalkStartFontSize: 0.01,
      fallingEffectMatrixWalkEndFontSize: 12.34,
    };
    const mounted = await render(<WindowAtmosphereSettings />);

    await expect
      .element(page.getByLabelText("Walk start font size", { exact: true }))
      .toHaveValue("1");
    await expect
      .element(page.getByLabelText("Walk end font size", { exact: true }))
      .toHaveValue("12");
    expect(mocks.updateSettings).not.toHaveBeenCalled();

    await page.getByLabelText("Increase Walk start font size").click();
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      fallingEffectMatrixWalkStartFontSize: 2,
    });

    await mounted.unmount();
  });

  it("imports, activates, and removes a finished The Hexagons preset", async () => {
    const mounted = await render(<WindowAtmosphereSettings />);
    const toggle = page.getByRole("switch", {
      name: "Show imported The Hexagons background",
    });

    await expect.element(toggle).toBeDisabled();
    const input = document.querySelector(
      'input[aria-label="Import The Hexagons background preset"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        new File(
          [
            JSON.stringify({
              kind: "the-hexagons-background",
              formatVersion: 1,
              name: "Black Light",
              target: "club-code",
              settings: {
                material: "glass",
                frontLightEnabled: true,
                frontLightColor: "#9900ff",
              },
            }),
          ],
          "black-light.hexbg.json",
          { type: "application/json" },
        ),
      ],
    });
    input!.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => expect(mocks.updateClientSettingsConfirmed).toHaveBeenCalledOnce());
    const importedPatch = mocks.updateClientSettingsConfirmed.mock.calls[0]?.[0];
    expect(importedPatch).toEqual({
      hexagonsBackgroundPresetJson: expect.any(String),
    });
    const stored = JSON.parse(importedPatch?.hexagonsBackgroundPresetJson as string) as {
      activationHints: { backgroundEnabled: boolean };
      hostPolicyHints: { renderer: string };
      name: string;
    };
    expect(stored).toMatchObject({
      name: "Black Light",
      activationHints: { backgroundEnabled: false },
      hostPolicyHints: { renderer: "auto" },
    });

    mocks.settings = {
      ...mocks.settings,
      hexagonsBackgroundPresetJson: importedPatch?.hexagonsBackgroundPresetJson as string,
    };
    mocks.updateClientSettingsConfirmed.mockClear();
    await mounted.rerender(<WindowAtmosphereSettings />);
    await expect.element(toggle).toBeEnabled();
    await toggle.click();
    expect(mocks.updateClientSettingsConfirmed).toHaveBeenLastCalledWith({
      hexagonsBackgroundEnabled: true,
    });

    mocks.updateClientSettingsConfirmed.mockClear();
    await page.getByRole("button", { name: "Remove preset" }).click();
    expect(mocks.updateClientSettingsConfirmed).toHaveBeenLastCalledWith({
      hexagonsBackgroundEnabled: false,
      hexagonsBackgroundPresetJson: null,
    });

    await mounted.unmount();
  });

  it("reports invalid files once and leaves write failures to the settings layer", async () => {
    const mounted = await render(<WindowAtmosphereSettings />);
    const input = document.querySelector(
      'input[aria-label="Import The Hexagons background preset"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();

    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["not json"], "broken.hexbg.json", { type: "application/json" })],
    });
    input!.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(mocks.toastAdd).toHaveBeenCalledOnce());
    expect(mocks.updateClientSettingsConfirmed).not.toHaveBeenCalled();

    mocks.toastAdd.mockClear();
    mocks.updateClientSettingsConfirmed.mockRejectedValueOnce(new Error("Disk write failed"));
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        new File(
          [
            JSON.stringify({
              kind: "the-hexagons-background",
              formatVersion: 1,
              name: "Write Failure",
              target: "club-code",
              settings: { material: "glass" },
            }),
          ],
          "write-failure.hexbg.json",
          { type: "application/json" },
        ),
      ],
    });
    input!.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(mocks.updateClientSettingsConfirmed).toHaveBeenCalledOnce());
    expect(mocks.toastAdd).not.toHaveBeenCalled();

    await mounted.unmount();
  });

  it("restores Flat with the complete atmosphere reset", async () => {
    mocks.settings = {
      ...mocks.settings,
      fallingEffectMatrixMotionMode: "reverse",
      fallingEffectMatrixBaseFontSize: 28,
      fallingEffectMatrixWalkStartFontSize: 12,
      fallingEffectMatrixWalkEndFontSize: 24,
      fallingEffect2chEnriched: true,
      fallingEffectsOverCinemaEnabled: true,
      hexagonsBackgroundEnabled: true,
      hexagonsBackgroundPresetJson: "saved-preset",
    };
    const mounted = await render(<WindowAtmosphereSettings />);

    await page.getByRole("button", { name: "Reset window atmosphere to default" }).click();

    expect(mocks.updateSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fallingEffectMatrixMotionMode: DEFAULT_FALLING_EFFECT_MATRIX_MOTION_MODE,
        fallingEffectMatrixBaseFontSize: DEFAULT_FALLING_EFFECT_MATRIX_BASE_FONT_SIZE,
        fallingEffectMatrixWalkStartFontSize: DEFAULT_FALLING_EFFECT_MATRIX_WALK_START_FONT_SIZE,
        fallingEffectMatrixWalkEndFontSize: DEFAULT_FALLING_EFFECT_MATRIX_WALK_END_FONT_SIZE,
        fallingEffectMatrixWalkLifecyclePercent:
          DEFAULT_FALLING_EFFECT_MATRIX_WALK_LIFECYCLE_PERCENT,
        fallingEffectMatrixCenterWindIntensity: DEFAULT_FALLING_EFFECT_MATRIX_CENTER_WIND_INTENSITY,
        fallingEffect2chEnriched: false,
        fallingEffectsOverCinemaEnabled: false,
        hexagonsBackgroundEnabled: false,
        hexagonsBackgroundPresetJson: null,
      }),
    );

    await mounted.unmount();
  });
});
