/**
 * Synthetic media capture harness for the Atmosphere Console adoption.
 *
 * This file is not part of any normal test run: the unit `include` matches
 * `*.test.ts`, the browser `include` matches `*.browser.tsx`, and only
 * `vitest.atmosphere-console-capture.config.ts` selects it. It renders the real
 * production `AtmosphereConsole`, the real `WindowAtmosphere` layer, and the
 * real `WindowAtmosphereSettings` panel against a fixture settings store with
 * the application stylesheet loaded, so nothing here can read or record
 * account, project, provider, or filesystem data.
 *
 * The fixture stands in for the settings RPC. It stores what the console sends
 * and returns the stored value, which is the same confirmed-write path the
 * console reports from in the product.
 */
import "../index.css";
import {
  DEFAULT_UNIFIED_SETTINGS,
  type ClientSettings,
  type UnifiedSettings,
} from "@cafecode/contracts/settings";
import { page, userEvent } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { WindowAtmosphereSettings } from "./settings/WindowAtmosphereSettings";
import { WindowAtmosphere } from "./WindowAtmosphere";
import { AtmosphereConsole } from "./AtmosphereConsole";

const MEDIA_DIRECTORY = "../../../../docs/adoption-media/atmosphere-console";

const harness = vi.hoisted(() => {
  let settings = {} as UnifiedSettings;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
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
    getClientSettings: () => harness.get(),
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
  getServerConfig: () => ({ ambientExperienceCapabilities: { atmosphere: true } }),
  useServerConfig: () => ({ ambientExperienceCapabilities: { atmosphere: true } }),
  applyClientSettingsUpdated: (settings: ClientSettings) => {
    harness.patch(settings as Partial<UnifiedSettings>);
  },
}));

/** Stands in for the settings RPC: stores the patch, returns what it stored. */
vi.mock("../environments/runtime", () => {
  const connection = {
    environmentId: "synthetic-capture-environment",
    client: {
      server: {
        updateClientSettings: async (patch: Partial<UnifiedSettings>) => {
          harness.patch(patch);
          return harness.get() as ClientSettings;
        },
      },
    },
  };
  return { getPrimaryEnvironmentConnection: () => connection };
});

vi.mock("../environments/primary", () => ({
  usePrimaryEnvironmentId: () => "synthetic-capture-environment",
}));

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
      <AtmosphereConsole />
      <div style={{ position: "relative", zIndex: 20, padding: "20px" }}>
        <header
          style={{
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: "10px",
            background: "rgba(4,7,11,0.86)",
            padding: "12px 16px",
            maxWidth: "720px",
          }}
        >
          <p style={{ fontSize: "11px", letterSpacing: "0.14em", textTransform: "uppercase" }}>
            Synthetic capture harness — no account, project, or provider data
          </p>
          <h1 style={{ fontSize: "20px", fontWeight: 600, margin: "4px 0" }}>{label}</h1>
          <p style={{ fontSize: "13px", opacity: 0.88 }}>{note}</p>
          <p style={{ fontSize: "11px", opacity: 0.7, marginTop: "6px" }}>
            Commands are parsed locally. This capture uses a synthetic settings server; no shell or
            model is used.
          </p>
        </header>
        <section
          style={{
            marginTop: "16px",
            maxWidth: "720px",
            maxHeight: "420px",
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

function settle(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function consolePanel(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-testid="atmosphere-console"]')!;
}

function statusText(): string {
  return document.querySelector('[data-testid="atmosphere-console-status"]')?.textContent ?? "";
}

const captured: Array<{ readonly file: string; readonly status: string }> = [];

async function capture(name: string): Promise<void> {
  await page.screenshot({ path: `${MEDIA_DIRECTORY}/${name}.png` });
  captured.push({ file: `${name}.png`, status: statusText() });
}

async function applyCommand(request: string): Promise<void> {
  await page.getByLabelText("Falling-effect command").fill(request);
  await page.getByRole("button", { name: "Apply" }).click();
  await vi.waitFor(() => {
    expect(statusText()).not.toBe("Applying…");
  });
  await settle(400);
}

describe("Atmosphere console adoption media", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    document.documentElement.classList.add("dark");
    harness.reset({ ...DEFAULT_UNIFIED_SETTINGS, continueBackgroundAnimations: true });
  });

  it("records the console driving the real atmosphere layer and settings panel", async () => {
    const screen = await render(
      <CaptureHarness
        label="Atmosphere console"
        note="Closed by default. The Appearance panel opens it; opening it enables nothing."
      />,
    );

    // 01 — before: the console is closed and no effect is running.
    expect(document.querySelector('[data-testid="atmosphere-console"]')).toBeNull();
    expect(harness.get().fallingEffectsEnabled).toBe(false);
    await settle(500);
    await capture("01-before-console-closed-effects-off");

    // 02 — the Appearance control opens the console. Still nothing enabled.
    await page.getByRole("button", { name: "Open console" }).click();
    await vi.waitFor(() => {
      expect(consolePanel()).not.toBeNull();
    });
    expect(harness.get().fallingEffectsEnabled).toBe(false);
    await settle(500);
    await capture("02-console-open-nothing-enabled");

    // 03 — after: one bounded command turns the installed Matrix effect on.
    await applyCommand("matrix, density 80%, 日本語 70%");
    expect(harness.get().fallingEffectsEnabled).toBe(true);
    expect(harness.get().fallingEffectKind).toBe("matrix");
    await settle(900);
    await capture("03-after-matrix-density-japanese");

    // 04 — a motion mode and a fixed color, confirmed from the stored value.
    await applyCommand("motion warp and color green");
    expect(harness.get().fallingEffectMatrixMotionMode).toBe("tunnel");
    expect(harness.get().fallingEffectMatrixColorMode).toBe("fixed");
    await settle(900);
    await capture("04-motion-warp-fixed-color");

    // 05 — a mixed request naming an uninstalled feature changes nothing.
    const beforeRefusal = harness.get().fallingEffectKind;
    await applyCommand("snow and next song");
    expect(harness.get().fallingEffectKind).toBe(beforeRefusal);
    expect(statusText()).toContain("media playback");
    await settle(600);
    await capture("05-refused-unsupported-media-request");

    // 06 — an invalid number is refused with the offending value named.
    await applyCommand("density 120");
    expect(statusText()).toContain("not a whole percentage");
    await settle(600);
    await capture("06-refused-invalid-number");

    // 07 — the panel moves and resizes with the keyboard, inside the viewport.
    document.querySelector<HTMLElement>('[aria-label="Move atmosphere console"]')!.focus();
    await userEvent.keyboard("{ArrowLeft}".repeat(20));
    document.querySelector<HTMLElement>('[aria-label="Resize atmosphere console"]')!.focus();
    await userEvent.keyboard("{ArrowRight}".repeat(8));
    const moved = consolePanel().getBoundingClientRect();
    expect(moved.left).toBeGreaterThanOrEqual(0);
    expect(moved.right).toBeLessThanOrEqual(window.innerWidth);
    await settle(600);
    await capture("07-moved-and-resized");

    // 08 — minimized to its header bar, then restored.
    await page.getByLabelText("Minimize atmosphere console").click();
    await settle(500);
    await capture("08-minimized-to-header");
    await page.getByLabelText("Restore atmosphere console").click();
    await settle(300);

    // 09 — reset returns the supported console fields to their defaults.
    await applyCommand("reset");
    expect(harness.get().fallingEffectsEnabled).toBe(false);
    expect(harness.get().fallingEffectMatrixMotionMode).toBe("flat");
    await settle(700);
    await capture("09-after-reset-defaults");

    for (const entry of captured) {
      expect(entry.file).toMatch(/\.png$/u);
    }
    expect(captured).toHaveLength(9);

    await screen.unmount();
  });
});
