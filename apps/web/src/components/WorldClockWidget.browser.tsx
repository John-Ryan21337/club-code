import "../index.css";

import type { UnifiedSettings } from "@cafecode/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";

import { WORLD_CLOCK_PANEL_STORAGE_KEY } from "../worldClockPanelGeometry";
import {
  __resetWorldClockWeatherConsentForTests,
  writeWorldClockWeatherConsent,
} from "../worldClockWeatherConsent";
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
    timestampFormat: "24-hour" as const,
    ambianceColor: "" as string,
    appAccentColor: "" as string,
    themeAccentColor: "" as string,
  } satisfies Partial<UnifiedSettings>,
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: <T,>(selector: (settings: typeof mocks.settings) => T) => selector(mocks.settings),
}));

import { WorldClockWidget } from "./WorldClockWidget";

/**
 * Every test injects this client. No test may reach a real endpoint, and the
 * fixture also proves the widget never calls a weather read without consent.
 */
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
          sourceTime: "2026-09-11T12:00",
          temperatureC: 27,
          weatherCode: 2,
          windKph: 12,
        },
        "los-angeles": {
          condition: "Clear sky",
          icon: "☀",
          sourceTime: "2026-09-11T12:00",
          temperatureC: 22,
          weatherCode: 0,
          windKph: 8,
        },
        london: {
          condition: "Rain",
          icon: "🌧",
          sourceTime: "2026-09-11T12:00",
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
  __resetWorldClockWeatherConsentForTests();
  mocks.settings.worldClockEnabled = true;
  mocks.settings.worldClockStyle = "rainbow";
  mocks.settings.worldClockLocationIds = ["tokyo", "los-angeles", "london"];
  mocks.settings.ambianceColor = "";
  mocks.settings.appAccentColor = "";
  mocks.settings.themeAccentColor = "";
});

afterEach(() => {
  __resetWorldClockWeatherConsentForTests();
});

describe("WorldClockWidget", () => {
  it("keeps clock controls below changing native caption bounds", async () => {
    const originalOverlay = Object.getOwnPropertyDescriptor(navigator, "windowControlsOverlay");
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, "platform");
    const originalBridge = window.desktopBridge;
    const overlay = Object.assign(new EventTarget(), {
      visible: true,
      height: 40,
      getTitlebarAreaRect() {
        return { y: 0, height: this.height };
      },
    });
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
    Object.defineProperty(navigator, "windowControlsOverlay", {
      configurable: true,
      value: overlay,
    });
    window.desktopBridge = {} as NonNullable<typeof window.desktopBridge>;
    window.localStorage.setItem(
      WORLD_CLOCK_PANEL_STORAGE_KEY,
      JSON.stringify({
        x: 0,
        y: 0,
        width: 900,
        height: 900,
        collapsed: false,
      }),
    );
    const mounted = await render(<WorldClockWidget weatherClient={weatherClientFixture()} />);
    try {
      const panel = () => document.querySelector<HTMLElement>(".cafe-world-clock-widget")!;
      await vi.waitFor(() => expect(panel().getBoundingClientRect().top).toBe(48));
      overlay.height = 64;
      overlay.dispatchEvent(new Event("geometrychange"));
      await vi.waitFor(() => expect(panel().getBoundingClientRect().top).toBe(72));
      expect(panel().getBoundingClientRect().bottom).toBeLessThanOrEqual(752);
      for (const button of panel().querySelectorAll("header button")) {
        const bounds = button.getBoundingClientRect();
        expect(
          button.contains(
            document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
          ),
        ).toBe(true);
      }
    } finally {
      await mounted.unmount();
      if (originalOverlay)
        Object.defineProperty(navigator, "windowControlsOverlay", originalOverlay);
      else Reflect.deleteProperty(navigator, "windowControlsOverlay");
      if (originalPlatform) Object.defineProperty(navigator, "platform", originalPlatform);
      else Reflect.deleteProperty(navigator, "platform");
      if (originalBridge) window.desktopBridge = originalBridge;
      else Reflect.deleteProperty(window, "desktopBridge");
    }
  });

  it("renders one transparent clock per selected city and stays off the pointer path", async () => {
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

      const panel = document.querySelector<HTMLElement>(".cafe-world-clock-widget");
      expect(panel).not.toBeNull();
      // The panel body is transparent so the app behind it stays readable.
      expect(getComputedStyle(panel!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      // The overlay covers the window but must never swallow a click.
      const overlay = document.querySelector<HTMLElement>("[data-world-clock-overlay]");
      expect(getComputedStyle(overlay!).pointerEvents).toBe("none");
      expect(getComputedStyle(panel!).pointerEvents).toBe("auto");

      // Weather is off by default in this renderer, so no request is made and
      // no attribution is shown.
      expect(weatherClient.read).not.toHaveBeenCalled();
      expect(page.getByText("Open-Meteo.com").elements()).toHaveLength(0);
    } finally {
      await mounted.unmount();
    }
  });

  it("reads weather and shows attribution only after local consent", async () => {
    await writeWorldClockWeatherConsent(true);
    const weatherClient = weatherClientFixture();
    const mounted = await render(<WorldClockWidget weatherClient={weatherClient} />);
    try {
      await expect.element(page.getByText("27°C")).toBeVisible();
      await expect.element(page.getByText("Open-Meteo.com")).toBeVisible();
      expect(weatherClient.read).toHaveBeenCalledWith(["tokyo", "los-angeles", "london"], {
        signal: expect.any(AbortSignal),
      });
    } finally {
      await mounted.unmount();
    }
  });

  it("persists collapse state and supports the transparent analog style", async () => {
    mocks.settings.worldClockStyle = "analog";
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

  it("clamps a stored off-screen geometry back into a narrow viewport", async () => {
    // A geometry saved on a large desktop must not put the panel controls out
    // of reach after the same renderer opens on a phone-sized viewport.
    window.localStorage.setItem(
      WORLD_CLOCK_PANEL_STORAGE_KEY,
      JSON.stringify({ x: 4_000, y: 4_000, width: 2_000, height: 2_000, collapsed: false }),
    );
    await page.viewport(390, 720);
    const mounted = await render(<WorldClockWidget weatherClient={weatherClientFixture()} />);
    try {
      const panel = document.querySelector<HTMLElement>(".cafe-world-clock-widget");
      await expect
        .poll(() => panel?.getBoundingClientRect().right ?? Infinity)
        .toBeLessThanOrEqual(390);
      const rect = panel!.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(720);
      // Both handles stay reachable at this width.
      await expect.element(page.getByRole("button", { name: /^Move world clock/ })).toBeVisible();
      await expect.element(page.getByRole("button", { name: /^Resize world clock/ })).toBeVisible();
    } finally {
      await mounted.unmount();
    }
  });

  it("moves and resizes the panel from the keyboard", async () => {
    const mounted = await render(<WorldClockWidget weatherClient={weatherClientFixture()} />);
    try {
      const panel = document.querySelector<HTMLElement>(".cafe-world-clock-widget")!;
      const before = panel.getBoundingClientRect();

      const moveHandle = page.getByRole("button", { name: /^Move world clock/ });
      await userEvent.click(moveHandle);
      await userEvent.keyboard("{ArrowRight}{ArrowRight}");
      await expect.poll(() => panel.getBoundingClientRect().left).toBeGreaterThan(before.left);

      const widthBefore = panel.getBoundingClientRect().width;
      const resizeHandle = page.getByRole("button", { name: /^Resize world clock/ });
      await userEvent.click(resizeHandle);
      await userEvent.keyboard("{ArrowLeft}");
      await expect.poll(() => panel.getBoundingClientRect().width).toBeLessThan(widthBefore);
    } finally {
      await mounted.unmount();
    }
  });

  it("follows the existing theme accent settings", async () => {
    mocks.settings.appAccentColor = "#123456";
    const mounted = await render(<WorldClockWidget weatherClient={weatherClientFixture()} />);
    try {
      const panel = document.querySelector<HTMLElement>(".cafe-world-clock-widget");
      await expect
        .poll(() => panel?.style.getPropertyValue("--cafe-world-clock-accent"))
        .toBe("#123456");
    } finally {
      await mounted.unmount();
    }
  });
});

/**
 * Visual evidence for the adoption review. These cases assert the same
 * enabled/disabled contract as the tests above and additionally save a
 * synthetic before/after screenshot pair under `evidence/`.
 */
describe("WorldClockWidget visual evidence", () => {
  it("captures the panel off and the panel on", async () => {
    mocks.settings.worldClockEnabled = false;
    const before = await render(<WorldClockWidget weatherClient={weatherClientFixture()} />);
    document.body.style.background = "#0b0f14";
    expect(document.querySelector(".cafe-world-clock-widget")).toBeNull();
    await page.screenshot({
      path: "../../.vitest-attachments/evidence/world-clock-before-disabled.png",
    });
    await before.unmount();

    mocks.settings.worldClockEnabled = true;
    await writeWorldClockWeatherConsent(true);
    const after = await render(<WorldClockWidget weatherClient={weatherClientFixture()} />);
    try {
      await expect.element(page.getByText("Open-Meteo.com")).toBeVisible();
      await page.screenshot({
        path: "../../.vitest-attachments/evidence/world-clock-after-rainbow-weather.png",
      });

      mocks.settings.worldClockStyle = "analog";
      await after.rerender(<WorldClockWidget weatherClient={weatherClientFixture()} />);
      await expect.element(page.getByLabelText("Analog clock for Tokyo")).toBeVisible();
      await page.screenshot({
        path: "../../.vitest-attachments/evidence/world-clock-after-analog.png",
      });
    } finally {
      await after.unmount();
      document.body.style.background = "";
    }
  });
});
