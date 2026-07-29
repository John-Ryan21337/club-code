import "../index.css";

import type { UnifiedSettings } from "@cafecode/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { matrixColorFrameStore } from "../matrixColorFrameStore";
import { WORLD_CLOCK_PANEL_STORAGE_KEY } from "../worldClockPanelGeometry";
import type { WorldWeatherClient } from "../worldWeather";

const mocks = vi.hoisted(() => ({
  settings: {
    worldClockEnabled: true as boolean,
    worldClockStyle: "rainbow" as UnifiedSettings["worldClockStyle"],
    worldClockLocationIds: [
      "tokyo",
      "los-angeles",
      "london",
    ] as UnifiedSettings["worldClockLocationIds"],
    worldClockWeatherEnabled: true as boolean,
    timestampFormat: "24-hour" as const,
  } satisfies Partial<UnifiedSettings>,
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: <T,>(selector: (settings: typeof mocks.settings) => T) => selector(mocks.settings),
}));

import { WorldClockWidget } from "./WorldClockWidget";

let matrixPaletteOwner: object;

function weatherClientFixture(): WorldWeatherClient {
  return {
    clear: vi.fn(),
    read: vi.fn(async () => ({
      fetchedAtMs: Date.now(),
      stale: false,
      byLocation: {
        tokyo: {
          condition: "Partly cloudy",
          icon: "⛅",
          sourceTime: "2026-07-29T12:00",
          temperatureC: 27,
          weatherCode: 2,
          windKph: 12,
        },
        "los-angeles": {
          condition: "Clear sky",
          icon: "☀",
          sourceTime: "2026-07-29T12:00",
          temperatureC: 22,
          weatherCode: 0,
          windKph: 8,
        },
        london: {
          condition: "Rain",
          icon: "🌧",
          sourceTime: "2026-07-29T12:00",
          temperatureC: 16,
          weatherCode: 63,
          windKph: 18,
        },
      },
    })),
  };
}

beforeEach(async () => {
  await page.viewport(1_000, 760);
  window.localStorage.removeItem(WORLD_CLOCK_PANEL_STORAGE_KEY);
  mocks.settings.worldClockEnabled = true;
  mocks.settings.worldClockStyle = "rainbow";
  mocks.settings.worldClockLocationIds = ["tokyo", "los-angeles", "london"];
  mocks.settings.worldClockWeatherEnabled = true;
  matrixPaletteOwner = {};
  matrixColorFrameStore.claim(matrixPaletteOwner);
  matrixColorFrameStore.publish(
    matrixPaletteOwner,
    {
      color: "#53f59f",
      perStream: false,
      baseHue: null,
      saturation: null,
      lightness: null,
    },
    "frozen",
  );
});

afterEach(() => matrixColorFrameStore.release(matrixPaletteOwner));

describe("WorldClockWidget", () => {
  it("renders multiple transparent clocks and opt-in weather in the browser", async () => {
    const weatherClient = weatherClientFixture();
    const mounted = await render(<WorldClockWidget weatherClient={weatherClient} />);
    try {
      await expect.element(page.getByRole("heading", { name: "Tokyo", exact: true })).toBeVisible();
      await expect
        .element(page.getByRole("heading", { name: "Los Angeles", exact: true }))
        .toBeVisible();
      await expect
        .element(page.getByRole("heading", { name: "London", exact: true }))
        .toBeVisible();
      await expect.element(page.getByText("27°C")).toBeVisible();
      await expect.element(page.getByText("Open-Meteo.com")).toBeVisible();
      expect(weatherClient.read).toHaveBeenCalledWith(["tokyo", "los-angeles", "london"], {
        signal: expect.any(AbortSignal),
      });

      const panel = document.querySelector<HTMLElement>(".cafe-world-clock-widget");
      expect(panel).not.toBeNull();
      expect(getComputedStyle(panel!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(panel?.dataset.matrixPaletteColor).toBe("#53f59f");

      matrixColorFrameStore.publish(
        matrixPaletteOwner,
        {
          color: "hsl(220 88% 62%)",
          perStream: true,
          baseHue: 220,
          saturation: 88,
          lightness: 62,
        },
        "animated",
      );
      await expect.poll(() => panel?.dataset.matrixPaletteColor).toBe("hsl(220 88% 62%)");
      expect(panel?.dataset.matrixPaletteMotion).toBe("animated");
    } finally {
      await mounted.unmount();
    }
  });

  it("persists collapse state and supports the transparent analog style", async () => {
    mocks.settings.worldClockStyle = "analog";
    mocks.settings.worldClockWeatherEnabled = false;
    const mounted = await render(<WorldClockWidget weatherClient={weatherClientFixture()} />);
    try {
      await expect.element(page.getByLabelText("Analog clock for Tokyo")).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: "Collapse world clock" }));
      await expect.poll(() => document.querySelectorAll("[data-world-clock-city]").length).toBe(0);
      expect(
        JSON.parse(window.localStorage.getItem(WORLD_CLOCK_PANEL_STORAGE_KEY) ?? "{}"),
      ).toEqual(expect.objectContaining({ collapsed: true }));
      await expect.element(page.getByRole("button", { name: "Expand world clock" })).toBeVisible();
      await userEvent.click(page.getByRole("button", { name: "Expand world clock" }));
      await expect.element(page.getByLabelText("Analog clock for Tokyo")).toBeVisible();
    } finally {
      await mounted.unmount();
    }
  });
});
