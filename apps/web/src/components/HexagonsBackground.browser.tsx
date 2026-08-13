import "../index.css";

import {
  DEFAULT_AMBIENT_BACKGROUND_MANUSCRIPT_OPACITY,
  DEFAULT_AMBIENT_BACKGROUND_SIDEBAR_OPACITY,
  DEFAULT_UNIFIED_SETTINGS,
  type UnifiedSettings,
} from "@cafecode/contracts/settings";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { parseHexagonsBackgroundText } from "../hexagonsBackgroundPreset";
import { RightPanelSheet } from "./RightPanelSheet";
import { Sidebar, SidebarProvider, SidebarTrigger } from "./ui/sidebar";

const mocks = vi.hoisted(() => ({
  settings: null as unknown as UnifiedSettings,
  createHexagonBackground: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: <T,>(selector: (settings: UnifiedSettings) => T) => selector(mocks.settings),
}));

vi.mock("../vendor/the-hexagons-runtime-club-code/runtime/portable.js", () => ({
  createHexagonBackground: mocks.createHexagonBackground,
}));

import { HexagonsBackground } from "./HexagonsBackground";

const PRESET = parseHexagonsBackgroundText(
  JSON.stringify({
    kind: "the-hexagons-background",
    formatVersion: 1,
    name: "Black Light",
    target: "club-code",
    settings: {
      material: "glass",
      frontLightEnabled: true,
      frontLightColor: "#9900ff",
      fallingEffectsEnabled: true,
      renderer: "gpu",
      reducedMotion: "never",
    },
    activationHints: { backgroundEnabled: true, fallingEffectsEnabled: true },
    hostPolicyHints: { renderer: "gpu", reducedMotion: "never" },
  }),
).serialized;

function hasTransparentBackground(element: Element): boolean {
  const color = getComputedStyle(element).backgroundColor;
  return color === "transparent" || color === "rgba(0, 0, 0, 0)" || /\/\s*0\)$/.test(color);
}

beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-cafe-hexagons-background");
  document.documentElement.removeAttribute("data-cafe-local-media-background");
  document.documentElement.style.removeProperty("--cafe-ambient-background-manuscript-opacity");
  document.documentElement.style.removeProperty("--cafe-ambient-background-sidebar-opacity");
  mocks.settings = {
    ...DEFAULT_UNIFIED_SETTINGS,
    hexagonsBackgroundEnabled: false,
    hexagonsBackgroundPresetJson: PRESET,
    continueBackgroundAnimations: false,
  };
  mocks.destroy.mockReset();
  mocks.createHexagonBackground.mockReset();
  mocks.createHexagonBackground.mockResolvedValue({
    destroy: mocks.destroy,
    getState: () => ({
      activeRenderer: "webgl2",
      animationAllowed: true,
      tileCount: 144,
      fallbackReason: null,
    }),
  });
});

describe("The Hexagons background host", () => {
  it("does not mount for a disabled or invalid stored preset", async () => {
    const mounted = await render(<HexagonsBackground />);

    expect(mocks.createHexagonBackground).not.toHaveBeenCalled();
    await expect.element(page.getByTestId("hexagons-background")).not.toBeInTheDocument();
    expect(
      document.documentElement.style.getPropertyValue(
        "--cafe-ambient-background-manuscript-opacity",
      ),
    ).toBe(`${DEFAULT_AMBIENT_BACKGROUND_MANUSCRIPT_OPACITY * 100}%`);
    expect(
      document.documentElement.style.getPropertyValue("--cafe-ambient-background-sidebar-opacity"),
    ).toBe(`${DEFAULT_AMBIENT_BACKGROUND_SIDEBAR_OPACITY * 100}%`);

    mocks.settings = {
      ...mocks.settings,
      hexagonsBackgroundEnabled: true,
      hexagonsBackgroundPresetJson: "invalid",
    };
    await mounted.rerender(<HexagonsBackground />);
    expect(mocks.createHexagonBackground).not.toHaveBeenCalled();
    await expect.element(page.getByTestId("hexagons-background")).not.toBeInTheDocument();
  });

  it("uses one bounded surface at 0% and 100% for combined ambient backgrounds", () => {
    document.documentElement.setAttribute("data-cafe-local-media-background", "true");
    document.documentElement.setAttribute("data-cafe-hexagons-background", "true");
    const chatShell = document.createElement("div");
    chatShell.dataset.chatViewShell = "true";
    chatShell.className = "bg-background";
    const manuscriptScrim = document.createElement("div");
    manuscriptScrim.dataset.chatManuscriptScrim = "true";
    const leftDesktopWrapper = document.createElement("div");
    leftDesktopWrapper.className = "cafe-thread-sidebar";
    const leftDesktopSidebar = document.createElement("div");
    leftDesktopSidebar.dataset.slot = "sidebar-inner";
    leftDesktopSidebar.className = "bg-sidebar";
    leftDesktopWrapper.append(leftDesktopSidebar);
    const leftMobileSidebar = document.createElement("div");
    leftMobileSidebar.dataset.slot = "sidebar";
    leftMobileSidebar.dataset.mobile = "true";
    leftMobileSidebar.className = "bg-sidebar";
    const rightDesktopSidebar = document.createElement("div");
    rightDesktopSidebar.dataset.cafeDetailsSidebar = "sidebar";
    rightDesktopSidebar.className = "bg-card";
    const detailsSheetContent = document.createElement("div");
    detailsSheetContent.dataset.cafeDetailsSidebar = "sheet";
    detailsSheetContent.className = "bg-card";
    const detailsSheetShell = document.createElement("div");
    detailsSheetShell.dataset.cafeDetailsSidebarShell = "true";
    detailsSheetShell.className = "bg-background";
    detailsSheetShell.append(detailsSheetContent);
    const diffSidebarSurface = document.createElement("div");
    diffSidebarSurface.dataset.slot = "sidebar-inner";
    diffSidebarSurface.className = "bg-sidebar";
    const diffPanelShell = document.createElement("div");
    diffPanelShell.dataset.cafeDiffPanelShell = "true";
    diffPanelShell.className = "bg-background";
    diffSidebarSurface.append(diffPanelShell);
    const sidebarSheetBackdrop = document.createElement("div");
    sidebarSheetBackdrop.className = "cafe-sidebar-sheet-backdrop bg-black/32 backdrop-blur-sm";
    const ordinarySheet = document.createElement("div");
    ordinarySheet.className = "bg-background";
    const ordinarySheetBackdrop = document.createElement("div");
    ordinarySheetBackdrop.className = "bg-black/32 backdrop-blur-sm";
    document.body.append(
      chatShell,
      manuscriptScrim,
      leftDesktopWrapper,
      leftMobileSidebar,
      rightDesktopSidebar,
      detailsSheetShell,
      diffSidebarSurface,
      sidebarSheetBackdrop,
      ordinarySheet,
      ordinarySheetBackdrop,
    );

    expect(hasTransparentBackground(chatShell)).toBe(true);
    expect(hasTransparentBackground(manuscriptScrim)).toBe(false);
    const defaultSidebarColor = getComputedStyle(leftDesktopSidebar).backgroundColor;
    expect(hasTransparentBackground(leftDesktopSidebar)).toBe(false);
    expect(getComputedStyle(leftDesktopSidebar).backgroundImage).toBe("none");
    expect(getComputedStyle(leftDesktopSidebar, "::before").display).toBe("none");
    expect(getComputedStyle(leftDesktopSidebar, "::after").display).toBe("none");
    expect(getComputedStyle(leftMobileSidebar).backgroundColor).toBe(defaultSidebarColor);
    expect(getComputedStyle(rightDesktopSidebar).backgroundColor).toBe(defaultSidebarColor);
    expect(getComputedStyle(detailsSheetShell).backgroundColor).toBe(defaultSidebarColor);
    expect(getComputedStyle(diffSidebarSurface).backgroundColor).toBe(defaultSidebarColor);
    expect(hasTransparentBackground(detailsSheetContent)).toBe(true);
    expect(hasTransparentBackground(diffPanelShell)).toBe(true);
    expect(hasTransparentBackground(sidebarSheetBackdrop)).toBe(true);
    expect(getComputedStyle(sidebarSheetBackdrop).backdropFilter).toBe("none");
    expect(hasTransparentBackground(ordinarySheet)).toBe(false);
    expect(hasTransparentBackground(ordinarySheetBackdrop)).toBe(false);

    document.documentElement.removeAttribute("data-cafe-hexagons-background");
    expect(getComputedStyle(leftDesktopSidebar).backgroundColor).toBe(defaultSidebarColor);
    document.documentElement.removeAttribute("data-cafe-local-media-background");
    expect(getComputedStyle(leftDesktopSidebar).backgroundImage).not.toBe("none");
    expect(getComputedStyle(leftDesktopSidebar, "::before").display).not.toBe("none");
    expect(getComputedStyle(leftDesktopSidebar, "::after").display).not.toBe("none");
    document.documentElement.setAttribute("data-cafe-local-media-background", "true");
    document.documentElement.setAttribute("data-cafe-hexagons-background", "true");

    document.documentElement.style.setProperty(
      "--cafe-ambient-background-manuscript-opacity",
      "0%",
    );
    document.documentElement.style.setProperty("--cafe-ambient-background-sidebar-opacity", "0%");
    expect(hasTransparentBackground(manuscriptScrim)).toBe(true);
    for (const surface of [
      leftDesktopSidebar,
      leftMobileSidebar,
      rightDesktopSidebar,
      detailsSheetShell,
      diffSidebarSurface,
    ]) {
      expect(hasTransparentBackground(surface)).toBe(true);
    }

    document.documentElement.style.setProperty(
      "--cafe-ambient-background-manuscript-opacity",
      "100%",
    );
    document.documentElement.style.setProperty("--cafe-ambient-background-sidebar-opacity", "100%");
    expect(hasTransparentBackground(manuscriptScrim)).toBe(false);
    for (const surface of [
      leftDesktopSidebar,
      leftMobileSidebar,
      rightDesktopSidebar,
      detailsSheetShell,
      diffSidebarSurface,
    ]) {
      expect(hasTransparentBackground(surface)).toBe(false);
    }
  });

  it("removes only the mobile sidebar sheet haze while keeping one surface opacity", async () => {
    document.documentElement.setAttribute("data-cafe-local-media-background", "true");
    await page.viewport(390, 844);
    const leftSidebar = await render(
      <SidebarProvider>
        <Sidebar className="cafe-thread-sidebar bg-card">
          <div>Navigation</div>
        </Sidebar>
        <SidebarTrigger />
      </SidebarProvider>,
    );

    try {
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
      await expect
        .poll(() =>
          document.querySelector<HTMLElement>('[data-slot="sidebar"][data-mobile="true"]'),
        )
        .not.toBeNull();
      const leftSurface = document.querySelector<HTMLElement>(
        '[data-slot="sidebar"][data-mobile="true"]',
      );
      const leftBackdrop = document.querySelector<HTMLElement>('[data-slot="sheet-backdrop"]');
      expect(leftSurface).not.toBeNull();
      expect(leftBackdrop?.classList.contains("cafe-sidebar-sheet-backdrop")).toBe(true);
      expect(getComputedStyle(leftSurface!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(leftBackdrop!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(leftBackdrop!).backdropFilter).toBe("none");
    } finally {
      await leftSidebar.unmount();
    }

    const rightSidebar = await render(
      <RightPanelSheet open onClose={vi.fn()}>
        <div className="bg-card" data-cafe-details-sidebar="sheet">
          Details
        </div>
      </RightPanelSheet>,
    );
    try {
      await expect
        .poll(() => document.querySelector<HTMLElement>('[data-cafe-details-sidebar-shell="true"]'))
        .not.toBeNull();
      const rightSurface = document.querySelector<HTMLElement>(
        '[data-cafe-details-sidebar-shell="true"]',
      );
      const rightContent = document.querySelector<HTMLElement>(
        '[data-cafe-details-sidebar="sheet"]',
      );
      const rightBackdrop = document.querySelector<HTMLElement>('[data-slot="sheet-backdrop"]');
      expect(rightBackdrop?.classList.contains("cafe-sidebar-sheet-backdrop")).toBe(true);
      expect(getComputedStyle(rightSurface!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(rightContent!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(rightBackdrop!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(rightBackdrop!).backdropFilter).toBe("none");
    } finally {
      await rightSidebar.unmount();
      await page.viewport(1_280, 720);
    }
  });

  it("mounts below the app with Club Code activation and motion policy", async () => {
    mocks.settings = {
      ...mocks.settings,
      hexagonsBackgroundEnabled: true,
      continueBackgroundAnimations: true,
      ambientBackgroundManuscriptOpacity: 0.42,
      ambientBackgroundSidebarOpacity: 0.73,
    };
    const mounted = await render(<HexagonsBackground />);
    const background = page.getByTestId("hexagons-background");

    await expect.element(background).toBeInTheDocument();
    await expect.poll(() => mocks.createHexagonBackground.mock.calls.length).toBe(1);
    const options = mocks.createHexagonBackground.mock.calls[0]?.[0];
    expect(options.settings).toMatchObject({
      material: "glass",
      frontLightEnabled: true,
      frontLightColor: "#9900ff",
      enabled: true,
      fallingEffectsEnabled: false,
      renderer: "auto",
      reducedMotion: "system",
      continueBackgroundAnimations: true,
    });
    expect(options.pointerTarget).toBe(window);
    expect(options.position).toBe("absolute");
    expect(options.zIndex).toBe(0);
    await expect.element(background).toHaveAttribute("data-hexagons-status", "ready");
    await expect.element(background).toHaveAttribute("data-hexagons-renderer", "webgl2");
    await expect.element(background).toHaveAttribute("data-hexagons-tile-count", "144");
    const repeatedFrameMutations: MutationRecord[] = [];
    const repeatedFrameObserver = new MutationObserver((records) => {
      repeatedFrameMutations.push(...records);
    });
    repeatedFrameObserver.observe(background.element(), { attributes: true });
    options.onState({
      activeRenderer: "webgl2",
      animationAllowed: true,
      tileCount: 144,
      fallbackReason: null,
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    repeatedFrameObserver.disconnect();
    expect(repeatedFrameMutations).toHaveLength(0);
    options.onState({
      activeRenderer: "canvas2d-fallback",
      animationAllowed: false,
      tileCount: 64,
      fallbackReason: "context-lost",
    });
    await expect.element(background).toHaveAttribute("data-hexagons-renderer", "canvas2d-fallback");
    await expect.element(background).toHaveAttribute("data-hexagons-animation-allowed", "false");
    await expect.element(background).toHaveAttribute("data-hexagons-tile-count", "64");
    await expect
      .element(background)
      .toHaveAttribute("data-hexagons-fallback-reason", "context-lost");
    options.onState({
      activeRenderer: "gpu-webgl2",
      animationAllowed: true,
      tileCount: 144,
      fallbackReason: null,
    });
    await expect.element(background).not.toHaveAttribute("data-hexagons-fallback-reason");
    expect(document.documentElement.dataset.cafeHexagonsBackground).toBe("true");
    expect(
      document.documentElement.style.getPropertyValue(
        "--cafe-ambient-background-manuscript-opacity",
      ),
    ).toBe("42%");
    expect(
      document.documentElement.style.getPropertyValue("--cafe-ambient-background-sidebar-opacity"),
    ).toBe("73%");
    expect(getComputedStyle(background.element()).pointerEvents).toBe("none");

    mocks.settings = {
      ...mocks.settings,
      ambientBackgroundManuscriptOpacity: 0.21,
      ambientBackgroundSidebarOpacity: 0.91,
    };
    await mounted.rerender(<HexagonsBackground />);
    expect(
      document.documentElement.style.getPropertyValue(
        "--cafe-ambient-background-manuscript-opacity",
      ),
    ).toBe("21%");
    expect(
      document.documentElement.style.getPropertyValue("--cafe-ambient-background-sidebar-opacity"),
    ).toBe("91%");

    await mounted.unmount();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(document.documentElement.hasAttribute("data-cafe-hexagons-background")).toBe(false);
    expect(
      document.documentElement.style.getPropertyValue(
        "--cafe-ambient-background-manuscript-opacity",
      ),
    ).toBe("");
    expect(
      document.documentElement.style.getPropertyValue("--cafe-ambient-background-sidebar-opacity"),
    ).toBe("");
  });

  it("cleans partial renderer output when startup fails", async () => {
    mocks.settings = {
      ...mocks.settings,
      hexagonsBackgroundEnabled: true,
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.createHexagonBackground.mockImplementationOnce(async ({ container }) => {
      container.append(document.createElement("canvas"));
      throw new Error("Renderer startup failed");
    });

    const mounted = await render(<HexagonsBackground />);
    const background = page.getByTestId("hexagons-background");
    await expect.element(background).toHaveAttribute("data-hexagons-status", "error");
    expect(background.element().childElementCount).toBe(0);
    expect(document.documentElement.hasAttribute("data-cafe-hexagons-background")).toBe(false);

    await mounted.unmount();
    consoleError.mockRestore();
  });
});
