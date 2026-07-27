import "../index.css";

import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const ambianceHarness = vi.hoisted(() => {
  const state = {
    environmentStateById: {},
  };
  const useStore = Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
    getState: () => state,
  });
  return {
    settings: {
      ambianceEnabled: true,
      ambianceEffect: "rain",
      ambianceIntensity: 1,
      ambianceReactMode: "off",
      ambianceSurfaceSidebar: true,
      ambianceSurfaceThread: true,
      ambianceSurfaceComposer: true,
      ambianceColor: "",
      appAccentColor: "",
      themeAccentColor: "",
      continueBackgroundAnimations: true,
    },
    useStore,
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useParams: () => ({}),
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: (selector: (settings: typeof ambianceHarness.settings) => unknown) =>
    selector(ambianceHarness.settings),
}));

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ theme: "dark" }),
}));

vi.mock("../store", () => ({
  selectAnyThreadRunning: () => false,
  useStore: ambianceHarness.useStore,
}));

import { AmbianceLayer } from "../ambiance/AmbianceLayer";

afterEach(() => {
  document.documentElement.style.removeProperty("--cafe-ambiance-state-color");
  document.documentElement.style.removeProperty("--cafe-ambiance-composer-ring");
});

describe("AmbianceLayer", () => {
  it("fills the viewport and paints visible weather pixels when enabled", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const screen = await render(<AmbianceLayer />, { container: host });

    try {
      const canvas = host.querySelector('[data-cafe-ambiance-canvas="true"]');
      expect(canvas).toBeInstanceOf(HTMLCanvasElement);
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error("Ambiance canvas did not mount");
      }

      await vi.waitFor(
        () => {
          const rect = canvas.getBoundingClientRect();
          expect(rect.width).toBe(window.innerWidth);
          expect(rect.height).toBe(window.innerHeight);

          const context = canvas.getContext("2d");
          expect(context).not.toBeNull();
          if (!context) return;

          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let painted = false;
          for (let index = 3; index < pixels.length; index += 4) {
            if (pixels[index]! > 0) {
              painted = true;
              break;
            }
          }
          expect(painted).toBe(true);
        },
        { timeout: 3_000 },
      );
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
