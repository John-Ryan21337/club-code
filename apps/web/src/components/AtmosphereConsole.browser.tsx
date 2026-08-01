import "../index.css";

import { page, userEvent } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  __resetAtmosphereControlHandlersForTests,
  registerAtmosphereControlHandler,
} from "../atmosphereControlBus";

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  settings: {
    fallingEffectDensity: 1,
    fallingEffectSpeed: 1,
    fallingEffectOpacity: 0.35,
  },
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => mocks.settings,
  useUpdateSettings: () => ({ updateSettings: mocks.updateSettings }),
}));

import { AtmosphereConsole } from "./AtmosphereConsole";

beforeEach(() => {
  localStorage.clear();
  mocks.updateSettings.mockReset();
  __resetAtmosphereControlHandlersForTests();
});

describe("AtmosphereConsole", () => {
  it("applies deterministic zero-token effects and remains reopenable", async () => {
    await render(<AtmosphereConsole />);

    const panel = page.getByRole("region", { name: "Atmosphere console" });
    await expect.element(panel).toHaveAttribute("data-atmosphere-console-anchor", "custom");
    const width = Math.min(622, Math.max(292, window.innerWidth - 24));
    const height = Math.min(477.5, Math.max(188, window.innerHeight - 24));
    expect(panel.element().style.left).toBe(
      `${Math.min(321, Math.max(12, window.innerWidth - width - 12))}px`,
    );
    expect(panel.element().style.top).toBe(
      `${Math.min(280, Math.max(12, window.innerHeight - height - 12))}px`,
    );
    expect(panel.element().style.width).toBe(`${width}px`);
    expect(panel.element().style.height).toBe(`${height}px`);

    const command = page.getByLabelText("Tell Club Code what to change");
    await command.fill("matrix");
    await page.getByRole("button", { name: "Apply" }).click();

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
    });
    await expect.element(page.getByRole("status")).toHaveTextContent("Zero-token");

    await page.getByRole("button", { name: "Close atmosphere console" }).click();
    await expect
      .element(page.getByRole("button", { name: "Open atmosphere console" }))
      .toBeVisible();
    await page.getByRole("button", { name: "Open atmosphere console" }).click();
    await expect.element(panel).toBeVisible();
  });

  it("routes media commands only to registered local controls", async () => {
    const handler = vi.fn(() => ({
      handled: true,
      message: "Skipped to the next queued video.",
    }));
    registerAtmosphereControlHandler(handler);
    await render(<AtmosphereConsole />);

    await page.getByLabelText("Tell Club Code what to change").fill("next song");
    await page.getByRole("button", { name: "Apply" }).click();

    expect(handler).toHaveBeenCalledWith({ kind: "media", action: "next" });
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent("Skipped to the next queued video.");
  });

  it("applies compound value and adjustment commands in their spoken order", async () => {
    await render(<AtmosphereConsole />);

    await page
      .getByLabelText("Tell Club Code what to change")
      .fill("set density 50% and make density more");
    await page.getByRole("button", { name: "Apply" }).click();

    // 50% maps to 5.25x in the expanded 0.5x–10x range, then the local adjustment
    // adds 0.25x rather than overwriting that value with the stale setting.
    expect(mocks.updateSettings).toHaveBeenCalledWith({ fallingEffectDensity: 5.5 });
  });

  it("supports anchored and keyboard-custom placement", async () => {
    await render(<AtmosphereConsole />);
    const position = page.getByLabelText("Console position");
    await userEvent.selectOptions(position, "top-right");
    await expect
      .element(page.getByRole("region", { name: "Atmosphere console" }))
      .toHaveAttribute("data-atmosphere-console-anchor", "top-right");

    const move = page.getByRole("button", { name: "Move atmosphere console" });
    move.element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(page.getByRole("region", { name: "Atmosphere console" }))
      .toHaveAttribute("data-atmosphere-console-anchor", "custom");
  });
});
