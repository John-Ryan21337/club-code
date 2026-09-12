import "../../index.css";
import {
  DEFAULT_DESKTOP_WINDOW_OPACITY,
  type DesktopBridge,
  type DesktopWindowOpacityPreference,
  type DesktopWindowOpacityState,
} from "@cafecode/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { WindowOpacitySettings } from "./WindowOpacitySettings";

/**
 * The real component is rendered against a synthetic desktop bridge. The
 * bridge stands in for the trusted main-process IPC boundary; the native
 * whole-window opacity itself is not exercised by a browser test.
 */
function installDesktopBridge(bridge: Partial<DesktopBridge>) {
  (window as unknown as { desktopBridge?: Partial<DesktopBridge> }).desktopBridge = bridge;
}

function opaqueState(overrides?: Partial<DesktopWindowOpacityState>): DesktopWindowOpacityState {
  return {
    supported: true,
    enabled: false,
    opacity: DEFAULT_DESKTOP_WINDOW_OPACITY,
    effectiveOpacity: 1,
    reason: null,
    ...overrides,
  };
}

afterEach(() => {
  delete (window as unknown as { desktopBridge?: unknown }).desktopBridge;
  vi.restoreAllMocks();
});

describe("WindowOpacitySettings", () => {
  it("reads the native state when mounted and shows a fully opaque default", async () => {
    const getWindowOpacityState = vi.fn().mockResolvedValue(opaqueState());
    installDesktopBridge({
      getWindowOpacityState,
      setWindowOpacityPreference: vi.fn(),
    });

    render(<WindowOpacitySettings />);

    const toggle = page.getByRole("switch", { name: "Transparent desktop window" });
    await expect.element(toggle).toBeVisible();
    await vi.waitFor(() => expect(getWindowOpacityState).toHaveBeenCalledTimes(1));

    const slider = page.getByLabelText("Desktop window opacity");
    await expect.element(slider).toBeVisible();
    await expect.element(slider).toHaveValue(String(DEFAULT_DESKTOP_WINDOW_OPACITY));
    await expect.element(toggle).not.toBeChecked();
  });

  it("sends the bounded preference over the desktop bridge and adopts the returned state", async () => {
    const setWindowOpacityPreference = vi
      .fn<(preference: DesktopWindowOpacityPreference) => Promise<DesktopWindowOpacityState>>()
      .mockImplementation(async (preference) =>
        opaqueState({
          enabled: preference.enabled,
          opacity: preference.opacity,
          effectiveOpacity: preference.enabled ? preference.opacity : 1,
        }),
      );
    installDesktopBridge({
      getWindowOpacityState: vi.fn().mockResolvedValue(opaqueState()),
      setWindowOpacityPreference,
    });

    render(<WindowOpacitySettings />);
    const toggle = page.getByRole("switch", { name: "Transparent desktop window" });
    await expect.element(toggle).toBeVisible();
    await toggle.click();

    await vi.waitFor(() =>
      expect(setWindowOpacityPreference).toHaveBeenCalledWith({
        enabled: true,
        opacity: DEFAULT_DESKTOP_WINDOW_OPACITY,
      }),
    );
    await expect.element(toggle).toBeChecked();
  });

  it("keeps the control disabled and explains an unsupported platform", async () => {
    const setWindowOpacityPreference = vi.fn();
    installDesktopBridge({
      getWindowOpacityState: vi.fn().mockResolvedValue({
        supported: false,
        enabled: false,
        opacity: 1,
        effectiveOpacity: 1,
        reason: "unsupported-platform",
      } satisfies DesktopWindowOpacityState),
      setWindowOpacityPreference,
    });

    render(<WindowOpacitySettings />);

    await expect
      .element(
        page.getByText(
          "This platform does not provide a reliable Electron whole-window opacity API.",
        ),
      )
      .toBeVisible();
    const toggle = page.getByRole("switch", { name: "Transparent desktop window" });
    await expect.element(toggle).toBeDisabled();
    expect(page.getByLabelText("Desktop window opacity").elements()).toHaveLength(0);
    expect(setWindowOpacityPreference).not.toHaveBeenCalled();
  });

  it("reports a failed native apply reported by the desktop", async () => {
    installDesktopBridge({
      getWindowOpacityState: vi.fn().mockResolvedValue(opaqueState()),
      setWindowOpacityPreference: vi.fn().mockResolvedValue(
        opaqueState({
          enabled: false,
          opacity: 1,
          effectiveOpacity: 1,
          reason: "apply-failed",
        }),
      ),
    });

    render(<WindowOpacitySettings />);
    const toggle = page.getByRole("switch", { name: "Transparent desktop window" });
    await expect.element(toggle).toBeVisible();
    await toggle.click();

    await expect
      .element(
        page.getByText(
          "The requested opacity could not be applied. The window was restored to opaque.",
        ),
      )
      .toBeVisible();
    await expect.element(toggle).not.toBeChecked();
  });

  it("offers an opaque recovery action when the native state cannot be read", async () => {
    const setWindowOpacityPreference = vi.fn().mockResolvedValue(opaqueState({ opacity: 1 }));
    installDesktopBridge({
      getWindowOpacityState: vi.fn().mockRejectedValue(new Error("bridge unavailable")),
      setWindowOpacityPreference,
    });

    render(<WindowOpacitySettings />);

    const restore = page.getByRole("button", { name: "Restore opaque window" });
    await expect.element(restore).toBeVisible();
    await restore.click();

    await vi.waitFor(() =>
      expect(setWindowOpacityPreference).toHaveBeenCalledWith({ enabled: false, opacity: 1 }),
    );
  });

  it("explains that the feature needs the desktop app when no bridge exists", async () => {
    render(<WindowOpacitySettings />);

    await expect
      .element(page.getByText("Whole-window opacity is available only in the desktop app."))
      .toBeVisible();
    await expect
      .element(page.getByRole("switch", { name: "Transparent desktop window" }))
      .toBeDisabled();
  });
});
