/**
 * Synthetic media capture harness for the Matrix runtime adoption.
 *
 * This file is not part of any normal test run: the unit `include` matches
 * `*.test.ts`, the browser `include` matches `*.browser.tsx`, and only
 * `vitest.matrix-capture.config.ts` selects this capture. It renders the real
 * production `WindowAtmosphere` layer and the real `WindowAtmosphereSettings`
 * panel against a fixture settings store, so nothing here can read or record
 * account, project, provider, or filesystem data.
 *
 * Every capture states the backend that actually committed its frames and the
 * WebGL2 driver string reported by this host. Neither the images nor this
 * harness claim hardware acceleration.
 */
import "../index.css";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@cafecode/contracts/settings";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { WindowAtmosphereSettings } from "./settings/WindowAtmosphereSettings";
import { WindowAtmosphere } from "./WindowAtmosphere";

const MEDIA_DIRECTORY = "../../../../docs/adoption-media/matrix-runtime";

const harness = vi.hoisted(() => {
  // Only type references may cross into a hoisted factory, so the fixture
  // baseline is supplied by `matrixSettings` at each call site.
  let settings = {} as UnifiedSettings;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    /** "production" runs the unmodified acquisition this build ships. */
    gpuMode: "production" as "production" | "forced-fallback" | "relaxed-attributes",
    reducedMotion: false,
    get: (): UnifiedSettings => settings,
    reset: (next: UnifiedSettings) => {
      settings = next;
      notify();
    },
    patch: (next: Partial<UnifiedSettings>) => {
      settings = { ...settings, ...next };
      notify();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock("../hooks/useSettings", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSettings: <T,>(selector?: (settings: UnifiedSettings) => T) => {
      const settings = useSyncExternalStore(harness.subscribe, harness.get, harness.get);
      return selector ? selector(settings) : settings;
    },
    useUpdateSettings: () => ({
      updateSettings: (patch: Partial<UnifiedSettings>) => {
        harness.patch(patch);
      },
    }),
  };
});

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark" as const }),
}));

vi.mock("../rpc/serverState", () => ({
  useServerConfig: () => ({ ambientExperienceCapabilities: { atmosphere: true } }),
}));

vi.mock("../matrixWebGlRenderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../matrixWebGlRenderer")>();
  return {
    ...actual,
    createMatrixWebGl2Renderer: ((canvas, glyphs, options = {}) => {
      if (harness.gpuMode === "forced-fallback") {
        return actual.createMatrixWebGl2Renderer(canvas, glyphs, {
          ...options,
          acquireContext: () => null,
        });
      }
      if (harness.gpuMode === "relaxed-attributes") {
        // The same production renderer; only `failIfMajorPerformanceCaveat` is
        // dropped, so a host without an accelerated driver can still commit GPU
        // frames for the lifecycle captures. That is a software path whenever
        // the driver string in the capture header says so.
        return actual.createMatrixWebGl2Renderer(canvas, glyphs, {
          ...options,
          acquireContext: (target: HTMLCanvasElement) =>
            target.getContext("webgl2", {
              alpha: true,
              antialias: false,
              depth: false,
              desynchronized: false,
              premultipliedAlpha: true,
              preserveDrawingBuffer: false,
              stencil: false,
            }),
        });
      }
      return actual.createMatrixWebGl2Renderer(canvas, glyphs, options);
    }) satisfies typeof actual.createMatrixWebGl2Renderer,
  };
});

function describeWebGl2Host(): { readonly driver: string; readonly productionAcquisition: string } {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) return { driver: "no WebGL2 context", productionAcquisition: "refused" };
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const driver = String(
    info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  );
  const production = document.createElement("canvas").getContext("webgl2", {
    failIfMajorPerformanceCaveat: true,
    powerPreference: "high-performance",
  });
  return { driver, productionAcquisition: production ? "granted" : "refused" };
}

const host = describeWebGl2Host();

function CaptureHarness({ label, note }: { readonly label: string; readonly note: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#080b10",
        color: "#e6edf3",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <WindowAtmosphere />
      <div style={{ position: "relative", zIndex: 50, padding: "20px" }}>
        <header
          style={{
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: "10px",
            background: "rgba(4,7,11,0.86)",
            padding: "12px 16px",
            maxWidth: "780px",
          }}
        >
          <p style={{ fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Synthetic capture harness — no account, project, or provider data
          </p>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: "4px 0" }}>{label}</h1>
          <p style={{ fontSize: "13px", opacity: 0.88 }}>{note}</p>
          <p style={{ fontSize: "11px", opacity: 0.7, marginTop: "6px" }}>
            WebGL2 driver reported by this host: {host.driver} · production context request:{" "}
            {host.productionAcquisition} · acceleration is not claimed.
          </p>
        </header>
        <section
          style={{
            marginTop: "16px",
            maxWidth: "780px",
            maxHeight: "430px",
            overflow: "auto",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: "10px",
            background: "rgba(4,7,11,0.86)",
            padding: "12px 16px",
          }}
        >
          <WindowAtmosphereSettings />
        </section>
      </div>
    </div>
  );
}

const MATRIX_BASE: Partial<UnifiedSettings> = {
  fallingEffectsEnabled: true,
  fallingEffectKind: "matrix",
  fallingEffectOpacity: 0.85,
  continueBackgroundAnimations: true,
};

function matrixSettings(next: Partial<UnifiedSettings> = {}): UnifiedSettings {
  return { ...DEFAULT_UNIFIED_SETTINGS, ...MATRIX_BASE, ...next };
}

function settle(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function atmosphereCanvas(): HTMLCanvasElement {
  return document.querySelector<HTMLCanvasElement>('[data-testid="window-atmosphere"]')!;
}

function gpuCanvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('[data-testid="window-atmosphere-matrix-gpu"]');
}

/** Waits for a real committed frame so no capture records a pending surface. */
async function waitForCommittedFrame(): Promise<string> {
  await vi.waitFor(() => {
    expect(atmosphereCanvas().dataset.atmosphereFrameCommit).not.toBe("pending");
  });
  return atmosphereCanvas().dataset.atmosphereFrameCommit ?? "unknown";
}

const captured: Array<{ readonly file: string; readonly commit: string }> = [];

async function capture(name: string): Promise<void> {
  await page.screenshot({ path: `${MEDIA_DIRECTORY}/${name}.png` });
  captured.push({
    file: `${name}.png`,
    commit: atmosphereCanvas().dataset.atmosphereFrameCommit ?? "unknown",
  });
}

describe("Matrix runtime adoption media", () => {
  const originalMatchMedia = window.matchMedia.bind(window);

  beforeEach(() => {
    harness.gpuMode = "production";
    harness.reducedMotion = false;
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    document.documentElement.classList.add("dark");
    harness.reset(matrixSettings());
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
      if (!query.includes("prefers-reduced-motion")) return originalMatchMedia(query);
      const listeners = new Set<() => void>();
      return {
        media: query,
        get matches() {
          return harness.reducedMotion;
        },
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
        addListener: (listener: () => void) => listeners.add(listener),
        removeListener: (listener: () => void) => listeners.delete(listener),
        onchange: null,
        dispatchEvent: () => true,
      } as unknown as MediaQueryList;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.classList.remove("dark");
  });

  it("records the before and after appearance of the adopted runtime", async () => {
    const before = await render(
      <CaptureHarness
        label="Before — foundation defaults"
        note="Foundation slice behaviour: Flat projection, fixed palette, default 14px glyphs. These remain the shipped defaults, so this is what an existing install keeps after the upgrade."
      />,
    );
    await waitForCommittedFrame();
    await settle(900);
    await capture("01-before-foundation-defaults");
    await before.unmount();

    harness.reset(
      matrixSettings({
        fallingEffectMatrixMotionMode: "walk-forward",
        fallingEffectMatrixColorMode: "rainbow",
        fallingEffectMatrixBaseFontSize: 18,
        fallingEffectMatrixWalkStartFontSize: 4,
        fallingEffectMatrixWalkEndFontSize: 96,
        fallingEffectMatrixWalkLifecyclePercent: 45,
        fallingEffectMatrixCenterWindIntensity: 6,
        fallingEffectDensity: 1.4,
      }),
    );
    const after = await render(
      <CaptureHarness
        label="After — Walk Forward, Rainbow, adopted controls"
        note="This slice: Walk Forward projection between the exact 4px and 96px endpoints, 45% lifecycle, center wind 6, Rainbow palette, and the new Appearance controls."
      />,
    );
    await waitForCommittedFrame();
    await settle(1_400);
    await capture("02-after-walk-forward-rainbow");
    await after.unmount();
  });

  it("records Warp and Walk Reverse motion", async () => {
    harness.reset(
      matrixSettings({
        fallingEffectMatrixMotionMode: "tunnel",
        fallingEffectMatrixColorMode: "fixed",
        fallingEffectColor: "#4ade80",
        fallingEffectDensity: 1.6,
      }),
    );
    const warp = await render(
      <CaptureHarness
        label="Motion — Warp (stored as tunnel)"
        note="Radial projection from the viewport center with the fixed palette."
      />,
    );
    await waitForCommittedFrame();
    await settle(1_200);
    await capture("03-motion-warp-fixed-color");
    await warp.unmount();

    harness.reset(
      matrixSettings({
        fallingEffectMatrixMotionMode: "walk-reverse",
        fallingEffectMatrixColorMode: "rainbow-extra",
        fallingEffectMatrixWalkStartFontSize: 1,
        fallingEffectMatrixWalkEndFontSize: 72,
        fallingEffectDensity: 1.4,
      }),
    );
    const walkReverse = await render(
      <CaptureHarness
        label="Motion — Walk Reverse, Rainbow Extra"
        note="The Walk size ramp runs from the end endpoint back to the start endpoint; Rainbow Extra distributes hue per stream."
      />,
    );
    await waitForCommittedFrame();
    await settle(1_400);
    await capture("04-motion-walk-reverse-rainbow-extra");
    await walkReverse.unmount();
  });

  it("records the forced Canvas2D fallback", async () => {
    harness.gpuMode = "forced-fallback";
    harness.reset(
      matrixSettings({
        fallingEffectMatrixMotionMode: "walk-forward",
        fallingEffectMatrixColorMode: "rainbow",
        fallingEffectDensity: 1.4,
      }),
    );
    const screen = await render(
      <CaptureHarness
        label="Fallback — WebGL2 refused, Canvas2D owns the frame"
        note="The GPU context request is refused, so the same scene is committed by the Canvas2D renderer. A fallback is a supported mode, not an error screen."
      />,
    );
    await vi.waitFor(() => {
      expect(gpuCanvas()?.dataset.matrixGpuAvailability).toBe("unavailable");
      expect(atmosphereCanvas().dataset.atmosphereFrameCommit).toBe("canvas2d");
    });
    expect(gpuCanvas()?.dataset.matrixGpuFallbackReason).toBe("webgl2-unavailable");
    await settle(1_200);
    await capture("05-canvas-fallback-forced");
    await screen.unmount();
  });

  it("records the reduced-motion static frame and the paused hidden window", async () => {
    harness.reducedMotion = true;
    harness.reset(
      matrixSettings({
        fallingEffectMatrixMotionMode: "walk-forward",
        fallingEffectMatrixColorMode: "fixed",
        fallingEffectColor: "#4ade80",
      }),
    );
    const reduced = await render(
      <CaptureHarness
        label="Lifecycle — prefers-reduced-motion"
        note="Exactly one dimmed static frame is drawn and no animation frame is scheduled."
      />,
    );
    await waitForCommittedFrame();
    await settle(700);
    await capture("06-reduced-motion-static-frame");
    await reduced.unmount();

    harness.reducedMotion = false;
    harness.reset(
      matrixSettings({
        continueBackgroundAnimations: false,
        fallingEffectMatrixMotionMode: "walk-forward",
      }),
    );
    const hidden = await render(
      <CaptureHarness
        label="Lifecycle — hidden window, background animation off"
        note="With background continuation disabled, losing visibility cancels the animation frame and clears both layers instead of burning frames behind another window."
      />,
    );
    await waitForCommittedFrame();
    await settle(500);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden" as DocumentVisibilityState,
    });
    vi.mocked(document.hasFocus).mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await settle(500);
    await capture("07-hidden-window-paused");
    Reflect.deleteProperty(document, "visibilityState");
    await hidden.unmount();
  });

  it("records a committed GPU frame recovering onto the Canvas2D fallback", async () => {
    harness.gpuMode = "relaxed-attributes";
    harness.reset(
      matrixSettings({
        fallingEffectMatrixMotionMode: "walk-forward",
        fallingEffectMatrixColorMode: "rainbow",
        fallingEffectDensity: 1.4,
      }),
    );
    const screen = await render(
      <CaptureHarness
        label="Lifecycle — WebGL2 frames committed on this host"
        note="The GPU layer holds the glyph frame and the Canvas2D layer is intentionally transparent. The driver string above states what actually rendered it."
      />,
    );
    await vi.waitFor(() => {
      expect(gpuCanvas()?.dataset.matrixGpuAvailability).toBe("available");
      expect(["rendered", "empty"]).toContain(atmosphereCanvas().dataset.atmosphereFrameCommit);
    });
    await settle(1_200);
    await capture("08-gpu-committed-frame");

    gpuCanvas()!.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    await vi.waitFor(() => {
      expect(gpuCanvas()?.dataset.matrixGpuAvailability).toBe("context-lost");
      expect(atmosphereCanvas().dataset.atmosphereFrameCommit).toBe("canvas2d");
    });
    await settle(900);
    await capture("09-gpu-context-lost-canvas-fallback");
    await screen.unmount();
  });

  it("records a settings interaction driving the live atmosphere", async () => {
    harness.reset(
      matrixSettings({
        fallingEffectMatrixMotionMode: "flat",
        fallingEffectMatrixColorMode: "fixed",
        fallingEffectDensity: 1.3,
      }),
    );
    const screen = await render(
      <CaptureHarness
        label="Interaction — Appearance controls change the live layer"
        note="Every control below is the shipped Appearance panel writing through the real settings patch, and the atmosphere behind it is the production layer reacting."
      />,
    );
    await waitForCommittedFrame();
    await settle(600);

    await page.getByText("Walk Forward", { exact: true }).click();
    await vi.waitFor(() => {
      expect(harness.get().fallingEffectMatrixMotionMode).toBe("walk-forward");
    });
    await settle(1_100);

    await page.getByText("Rainbow", { exact: true }).click();
    await vi.waitFor(() => {
      expect(harness.get().fallingEffectMatrixColorMode).toBe("rainbow");
    });
    await settle(1_100);

    await page.getByText("Warp", { exact: true }).click();
    await vi.waitFor(() => {
      expect(harness.get().fallingEffectMatrixMotionMode).toBe("tunnel");
    });
    await settle(1_100);
    await capture("10-settings-interaction-warp-rainbow");

    await page.getByText("Snow", { exact: true }).click();
    await vi.waitFor(() => {
      expect(harness.get().fallingEffectKind).toBe("snow");
    });
    await settle(1_100);
    await capture("11-settings-interaction-snow");

    // eslint-disable-next-line no-console -- the capture run must report what it recorded.
    console.log(`[matrix-capture] ${JSON.stringify({ host, captured })}`);
    await screen.unmount();
  });
});
