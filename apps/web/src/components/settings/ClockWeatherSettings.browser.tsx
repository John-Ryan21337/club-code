import "../../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

const mocks = vi.hoisted(() => ({
  settings: {
    worldClockEnabled: true,
    worldClockStyle: "rainbow" as const,
    worldClockLocationIds: ["tokyo", "los-angeles", "london"] as const,
    worldClockWeatherEnabled: false,
  },
  updateClientSettingsConfirmed: vi.fn<(patch: object) => Promise<void>>(),
  updateSettings: vi.fn(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => mocks.settings,
  useUpdateSettings: () => ({
    updateClientSettingsConfirmed: mocks.updateClientSettingsConfirmed,
    updateSettings: mocks.updateSettings,
  }),
}));

import { ClockWeatherSettings } from "./ClockWeatherSettings";

afterEach(() => {
  mocks.updateClientSettingsConfirmed.mockReset();
  mocks.updateSettings.mockReset();
  document.body.innerHTML = "";
});

describe("ClockWeatherSettings", () => {
  it("persists weather consent before publishing it to the mounted widget", async () => {
    let rejectWrite!: (error: Error) => void;
    mocks.updateClientSettingsConfirmed.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject;
        }),
    );
    const mounted = await render(<ClockWeatherSettings />);
    try {
      const weatherSwitch = page.getByLabelText("Show current weather in world clock");
      await userEvent.click(weatherSwitch);

      expect(mocks.updateClientSettingsConfirmed).toHaveBeenCalledWith({
        worldClockWeatherEnabled: true,
      });
      expect(mocks.updateSettings).not.toHaveBeenCalledWith({
        worldClockWeatherEnabled: true,
      });
      await expect.element(weatherSwitch).toBeDisabled();

      rejectWrite(new Error("storage unavailable"));
      await expect.element(page.getByRole("alert")).toHaveTextContent("Weather was left unchanged");
      await expect.element(weatherSwitch).not.toBeDisabled();
    } finally {
      await mounted.unmount();
    }
  });
});
