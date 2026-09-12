import "../../index.css";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import {
  __resetWorldClockWeatherConsentForTests,
  getWorldClockWeatherConsent,
} from "../../worldClockWeatherConsent";

const mocks = vi.hoisted(() => ({
  settings: {
    worldClockEnabled: true,
    worldClockStyle: "rainbow" as const,
    worldClockLocationIds: ["tokyo", "los-angeles", "london"] as string[],
  },
  updateSettings: vi.fn(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => mocks.settings,
  useUpdateSettings: () => ({ updateSettings: mocks.updateSettings }),
}));

import { ClockWeatherSettings } from "./ClockWeatherSettings";

beforeEach(() => {
  mocks.settings.worldClockEnabled = true;
  mocks.settings.worldClockLocationIds = ["tokyo", "los-angeles", "london"];
  __resetWorldClockWeatherConsentForTests();
});

afterEach(() => {
  mocks.updateSettings.mockReset();
  __resetWorldClockWeatherConsentForTests();
  document.body.innerHTML = "";
});

describe("ClockWeatherSettings", () => {
  it("keeps weather consent in this renderer instead of the synced settings patch", async () => {
    const mounted = await render(<ClockWeatherSettings />);
    try {
      const weatherSwitch = page.getByLabelText("Show current weather in world clock");
      await expect.element(weatherSwitch).not.toBeChecked();

      await userEvent.click(weatherSwitch);
      await expect.element(weatherSwitch).toBeChecked();

      // The consent lives only in the local store. It must never appear in a
      // patch, because `updateSettings` forwards client keys to the backend and
      // the backend pushes them to every other connected renderer.
      expect(getWorldClockWeatherConsent()).toBe(true);
      for (const call of mocks.updateSettings.mock.calls) {
        expect(call[0]).not.toHaveProperty("worldClockWeatherEnabled");
      }

      // Withdrawing consent is equally local and takes effect immediately.
      await userEvent.click(weatherSwitch);
      await expect.element(weatherSwitch).not.toBeChecked();
      expect(getWorldClockWeatherConsent()).toBe(false);
    } finally {
      await mounted.unmount();
    }
  });

  it("shows the third-party notice and requires the clock before weather", async () => {
    mocks.settings.worldClockEnabled = false;
    const mounted = await render(<ClockWeatherSettings />);
    try {
      await expect.element(page.getByText("Open-Meteo terms", { exact: true })).toBeVisible();
      // Weather cannot be turned on while the panel is off: it would authorize
      // requests for a surface the user cannot see.
      await expect
        .element(page.getByLabelText("Show current weather in world clock"))
        .toBeDisabled();
    } finally {
      await mounted.unmount();
    }
  });

  it("bounds the city selection to 1 to 6 through the checkbox controls", async () => {
    mocks.settings.worldClockLocationIds = ["tokyo"];
    const mounted = await render(<ClockWeatherSettings />);
    try {
      // The only selected city cannot be removed, so the panel is never empty.
      await expect
        .element(page.getByRole("checkbox", { name: "Remove Tokyo clock" }))
        .toBeDisabled();

      await userEvent.click(page.getByRole("checkbox", { name: "Add Paris clock" }));
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        worldClockLocationIds: ["tokyo", "paris"],
      });
    } finally {
      await mounted.unmount();
    }
  });

  it("disables the remaining cities once six are selected", async () => {
    mocks.settings.worldClockLocationIds = [
      "tokyo",
      "los-angeles",
      "london",
      "paris",
      "berlin",
      "seoul",
    ];
    const mounted = await render(<ClockWeatherSettings />);
    try {
      await expect.element(page.getByText("6 of 6 selected")).toBeVisible();
      await expect.element(page.getByRole("checkbox", { name: "Add Sydney clock" })).toBeDisabled();
      await expect
        .element(page.getByRole("checkbox", { name: "Remove Tokyo clock" }))
        .not.toBeDisabled();
    } finally {
      await mounted.unmount();
    }
  });
});
