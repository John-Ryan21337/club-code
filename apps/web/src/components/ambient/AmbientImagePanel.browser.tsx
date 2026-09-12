import "../../index.css";
import type { AmbientImageAsset } from "@cafecode/contracts/settings";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { AmbientImagePanel } from "../../ambient/AmbientImagePanel";
import {
  AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY,
  readAmbientImageGeometry,
} from "../../ambientImageGeometry";
import { CUSTOM_MAXIMUM_WIDTH_FRACTION, PRESET_WIDTH_PX } from "../../ambientImagePanelLayout";

/**
 * Real-DOM behavior of the ambient image panel handles.
 *
 * The panel is rendered inside a host element of a known size, exactly as the
 * ambient layer hosts it, so pane changes can be driven without resizing the
 * browser window. Every assertion reads the painted rectangle, not the stored
 * value: a control that writes a setting but does not move the image is the
 * failure this suite exists to catch.
 *
 * The image source points at the app's own authenticated ambient-media route
 * and is never fetched successfully here; the panel sizes its box from the
 * geometry, not from the decoded bitmap, so the rectangles stay meaningful.
 */
const assetFor = (seed: string, width: number, height: number): AmbientImageAsset =>
  ({
    id: `sha256-${seed.repeat(64).slice(0, 64)}.png`,
    url: `/api/ambient-media/image/${seed.repeat(64).slice(0, 64)}`,
    mimeType: "image/png",
    width,
    height,
    sizeBytes: 4096,
  }) as unknown as AmbientImageAsset;

const WIDE_ASSET = assetFor("a", 1600, 900);
const TALL_ASSET = assetFor("b", 600, 1200);

// Wide enough that the largest preset stays under the silver-ratio minor
// share, so the preset test measures the requested size and not the bound.
const HOST_WIDTH = 1280;
const HOST_HEIGHT = 600;

let mounted: { unmount: () => void; rerender: (ui: React.ReactElement) => void } | null = null;
const noop = () => {};

interface PanelHostProps {
  readonly asset?: AmbientImageAsset;
  readonly layoutMode?: "preset" | "custom";
  readonly presetSize?: "small" | "medium" | "large";
  readonly presetPlacement?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  readonly glowEnabled?: boolean;
  readonly hostWidth?: number;
  readonly hostHeight?: number;
  readonly onRequestCustomLayout?: () => void;
  readonly onResetLayout?: () => void;
  readonly onDisable?: () => void;
}

/**
 * The ambient layer in miniature: a click-through host of a known size.
 *
 * The host owns `layoutMode` exactly as the real layer does. The panel asks for
 * the custom layout, the owner saves it, and the saved value comes back as a
 * prop. A host that ignored the request would hide the case where a drag is
 * visible only while the pointer is down.
 */
function PanelHost({
  asset = WIDE_ASSET,
  layoutMode = "preset",
  presetSize = "medium",
  presetPlacement = "bottom-right",
  glowEnabled = false,
  hostWidth = HOST_WIDTH,
  hostHeight = HOST_HEIGHT,
  onRequestCustomLayout = noop,
  onResetLayout = noop,
  onDisable = noop,
}: PanelHostProps) {
  const [savedLayout, setSavedLayout] = useState(layoutMode);
  const lastRequested = useRef(layoutMode);
  if (lastRequested.current !== layoutMode) {
    lastRequested.current = layoutMode;
    setSavedLayout(layoutMode);
  }
  return (
    <div
      data-testid="panel-host"
      className="pointer-events-none absolute top-0 left-0 overflow-hidden"
      style={{ width: hostWidth, height: hostHeight }}
    >
      <AmbientImagePanel
        asset={asset}
        layoutMode={savedLayout}
        presetSize={presetSize}
        presetPlacement={presetPlacement}
        glowEnabled={glowEnabled}
        glowColor="auto"
        glowOpacity={0.35}
        onRequestCustomLayout={() => {
          setSavedLayout("custom");
          onRequestCustomLayout();
        }}
        onResetLayout={() => {
          setSavedLayout("preset");
          onResetLayout();
        }}
        onDisable={onDisable}
      />
    </div>
  );
}

const panel = () => document.querySelector<HTMLElement>('[data-testid="ambient-image-panel"]')!;
const handle = (name: "move" | "resize" | "reset" | "hide") =>
  document.querySelector<HTMLButtonElement>(
    `[data-testid="ambient-image-${name}-${name === "move" || name === "resize" ? "handle" : "button"}"]`,
  )!;
const hostRect = () =>
  document.querySelector<HTMLElement>('[data-testid="panel-host"]')!.getBoundingClientRect();

/** Relative rectangle of the panel inside its host, in host fractions. */
function relativeRect() {
  const host = hostRect();
  const rect = panel().getBoundingClientRect();
  return {
    x: (rect.left - host.left) / host.width,
    y: (rect.top - host.top) / host.height,
    width: rect.width / host.width,
    widthPx: rect.width,
    heightPx: rect.height,
  };
}

/** Drives a real pointer interaction through the handle and the window. */
async function drag(target: HTMLElement, deltaX: number, deltaY: number) {
  const rect = target.getBoundingClientRect();
  const startX = rect.left + rect.width / 2;
  const startY = rect.top + rect.height / 2;
  const options = { pointerId: 1, pointerType: "mouse", bubbles: true, cancelable: true };
  target.dispatchEvent(
    new PointerEvent("pointerdown", { ...options, clientX: startX, clientY: startY }),
  );
  // Two moves, so a handler that only reads the last event is still exercised.
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      ...options,
      clientX: startX + deltaX / 2,
      clientY: startY + deltaY / 2,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      ...options,
      clientX: startX + deltaX,
      clientY: startY + deltaY,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointerup", {
      ...options,
      clientX: startX + deltaX,
      clientY: startY + deltaY,
    }),
  );
  await vi.waitFor(() => expect(panel()).not.toBeNull());
}

const pressKey = (target: HTMLElement, key: string) => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
};

const renderHost = async (props: PanelHostProps = {}) => {
  mounted = await render(<PanelHost {...props} />);
  await vi.waitFor(() => expect(panel().getBoundingClientRect().width).toBeGreaterThan(0));
};

describe("AmbientImagePanel", () => {
  beforeEach(() => {
    window.localStorage.removeItem(AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY);
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    window.localStorage.removeItem(AMBIENT_IMAGE_GEOMETRY_STORAGE_KEY);
  });

  it("draws the requested preset size and corner", async () => {
    await renderHost({ presetSize: "small", presetPlacement: "top-left" });
    const small = relativeRect();
    expect(small.widthPx).toBeCloseTo(PRESET_WIDTH_PX.small, 0);
    expect(small.x).toBeLessThan(0.05);
    expect(small.y).toBeLessThan(0.05);

    // A settings change must repaint the panel, not only store a value.
    mounted!.rerender(<PanelHost presetSize="large" presetPlacement="bottom-right" />);
    await vi.waitFor(() =>
      expect(panel().getBoundingClientRect().width).toBeCloseTo(PRESET_WIDTH_PX.large, 0),
    );
    const large = relativeRect();
    expect(large.x + large.width).toBeGreaterThan(0.9);
    expect(large.y).toBeGreaterThan(0.4);
  });

  it.each([
    [1, 4096, 320, 120],
    [4096, 1, 320, 200],
  ])(
    "keeps all handles separate and reachable for a %ix%i image in a %ix%i pane",
    async (width, height, hostWidth, hostHeight) => {
      await renderHost({ asset: assetFor("d", width, height), hostWidth, hostHeight });
      await vi.waitFor(() => expect(handle("hide")).not.toBeNull());
      const bounds = panel().getBoundingClientRect();
      const handles = [handle("move"), handle("hide"), handle("reset"), handle("resize")].map(
        (element) => element.getBoundingClientRect(),
      );
      for (const rect of handles) {
        expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
        expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
        expect(rect.right).toBeLessThanOrEqual(bounds.right);
        expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
      }
      for (let left = 0; left < handles.length; left++)
        for (let right = left + 1; right < handles.length; right++) {
          const a = handles[left]!,
            b = handles[right]!;
          expect(
            a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
          ).toBe(true);
        }
      expect(bounds.bottom).toBeLessThanOrEqual(hostRect().bottom + 1);
      expect(getComputedStyle(panel().querySelector("img")!).objectFit).toBe("contain");
    },
  );

  it("moves the panel with the move handle and asks for the custom layout", async () => {
    const onRequestCustomLayout = vi.fn();
    await renderHost({ presetPlacement: "bottom-right", onRequestCustomLayout });
    const before = relativeRect();

    await drag(handle("move"), -300, -200);

    const after = relativeRect();
    expect(after.x).toBeLessThan(before.x - 0.2);
    expect(after.y).toBeLessThan(before.y - 0.2);
    expect(panel().dataset["ambientImageLayout"]).toBe("custom");
    // The layout mode is a saved setting; the geometry is per device.
    expect(onRequestCustomLayout).toHaveBeenCalled();
    expect(readAmbientImageGeometry()?.x).toBeCloseTo(after.x, 2);
  });

  it.each(["blur", "Home"])(
    "releases pointer capture on %s and ignores later move events",
    async (reason) => {
      await renderHost({ presetPlacement: "top-left" });
      const target = handle("move");
      const capture = vi.spyOn(target, "setPointerCapture").mockImplementation(() => {});
      const hasCapture = vi.spyOn(target, "hasPointerCapture").mockReturnValue(true);
      const release = vi.spyOn(target, "releasePointerCapture").mockImplementation(() => {});
      try {
        target.dispatchEvent(
          new PointerEvent("pointerdown", {
            pointerId: 7,
            button: 0,
            bubbles: true,
            clientX: 20,
            clientY: 20,
          }),
        );
        if (reason === "Home") pressKey(target, "Home");
        else window.dispatchEvent(new Event("blur"));
        expect(release).toHaveBeenCalledWith(7);
        const before = relativeRect();
        window.dispatchEvent(
          new PointerEvent("pointermove", { pointerId: 7, clientX: 600, clientY: 500 }),
        );
        await Promise.resolve();
        expect(relativeRect()).toEqual(before);
      } finally {
        capture.mockRestore();
        hasCapture.mockRestore();
        release.mockRestore();
      }
    },
  );

  it("resizes the panel with the resize handle and keeps the aspect ratio", async () => {
    await renderHost({ layoutMode: "custom", presetPlacement: "bottom-left" });
    const before = relativeRect();

    await drag(handle("resize"), 160, 0);

    const after = relativeRect();
    expect(after.widthPx).toBeGreaterThan(before.widthPx + 100);
    expect(after.widthPx / after.heightPx).toBeCloseTo(WIDE_ASSET.width / WIDE_ASSET.height, 1);
  });

  it("clamps a drag that leaves the pane", async () => {
    await renderHost({ layoutMode: "custom", presetPlacement: "top-left" });

    await drag(handle("move"), 4_000, 4_000);

    const after = relativeRect();
    expect(after.x + after.width).toBeLessThanOrEqual(1.001);
    expect(after.y).toBeLessThanOrEqual(1.001);
    expect(after.y * HOST_HEIGHT + after.heightPx).toBeLessThanOrEqual(HOST_HEIGHT + 1);
  });

  it("clamps a resize to the silver-ratio share of the pane", async () => {
    await renderHost({ layoutMode: "custom", presetPlacement: "bottom-left" });

    await drag(handle("resize"), 4_000, 0);

    const after = relativeRect();
    expect(after.width).toBeLessThanOrEqual(CUSTOM_MAXIMUM_WIDTH_FRACTION + 0.01);
    expect(after.x + after.width).toBeLessThanOrEqual(1.001);
  });

  it("moves and resizes with the arrow keys", async () => {
    await renderHost({ layoutMode: "custom", presetPlacement: "bottom-right" });
    const start = relativeRect();

    pressKey(handle("move"), "ArrowLeft");
    await vi.waitFor(() => expect(relativeRect().x).toBeLessThan(start.x - 0.01));
    const moved = relativeRect();

    pressKey(handle("move"), "ArrowUp");
    await vi.waitFor(() => expect(relativeRect().y).toBeLessThan(moved.y - 0.01));

    const beforeResize = relativeRect();
    pressKey(handle("resize"), "ArrowRight");
    await vi.waitFor(() => expect(relativeRect().width).toBeGreaterThan(beforeResize.width + 0.01));
    pressKey(handle("resize"), "ArrowLeft");
    await vi.waitFor(() => expect(relativeRect().width).toBeCloseTo(beforeResize.width, 2));
  });

  it("recovers the preset position from the reset control and from the Home key", async () => {
    const onResetLayout = vi.fn();
    await renderHost({ layoutMode: "custom", presetPlacement: "bottom-right", onResetLayout });
    const preset = relativeRect();

    await drag(handle("move"), -400, -300);
    expect(relativeRect().x).toBeLessThan(preset.x - 0.2);

    handle("reset").click();
    await vi.waitFor(() => expect(relativeRect().x).toBeCloseTo(preset.x, 2));
    expect(onResetLayout).toHaveBeenCalled();
    // The dragged position is forgotten. The preset layout is restored, so
    // nothing re-seeds a stored position behind the user.
    await vi.waitFor(() => expect(panel().dataset["ambientImageLayout"]).toBe("preset"));
    expect(readAmbientImageGeometry()).toBeNull();

    await drag(handle("move"), -400, -300);
    expect(relativeRect().x).toBeLessThan(preset.x - 0.2);
    pressKey(handle("move"), "Home");
    await vi.waitFor(() => expect(relativeRect().x).toBeCloseTo(preset.x, 2));
  });

  it("recovers an off-pane panel when the pane becomes smaller", async () => {
    await renderHost({ layoutMode: "custom", presetPlacement: "bottom-right" });
    await drag(handle("move"), -100, -100);
    const wide = relativeRect();
    expect(wide.widthPx).toBeGreaterThan(0);

    // The window shrinks: the stored fractions would now put part of the panel
    // outside the pane, so the clamp has to pull it back without user action.
    mounted!.rerender(
      <PanelHost
        layoutMode="custom"
        presetPlacement="bottom-right"
        hostWidth={320}
        hostHeight={240}
      />,
    );
    await vi.waitFor(() => expect(hostRect().width).toBeCloseTo(320, 0));
    await vi.waitFor(() => {
      const after = relativeRect();
      expect(after.x).toBeGreaterThanOrEqual(-0.001);
      expect(after.x + after.width).toBeLessThanOrEqual(1.001);
      expect(after.y * 240 + after.heightPx).toBeLessThanOrEqual(241);
    });
  });

  it("re-clamps when the image is switched for one with a different shape", async () => {
    await renderHost({ layoutMode: "custom", presetPlacement: "bottom-left" });
    await drag(handle("resize"), 4_000, 0);
    const wide = relativeRect();
    expect(wide.widthPx / wide.heightPx).toBeCloseTo(16 / 9, 1);

    mounted!.rerender(
      <PanelHost asset={TALL_ASSET} layoutMode="custom" presetPlacement="bottom-left" />,
    );
    await vi.waitFor(() => {
      const after = relativeRect();
      expect(after.widthPx / after.heightPx).toBeCloseTo(0.5, 1);
      // A tall image at the stored width would overflow the pane height.
      expect(after.y * HOST_HEIGHT + after.heightPx).toBeLessThanOrEqual(HOST_HEIGHT + 1);
    });
  });

  it("applies the glow only when the glow setting is on", async () => {
    await renderHost({ glowEnabled: false });
    const withoutGlow = getComputedStyle(panel()).boxShadow;

    mounted!.rerender(<PanelHost glowEnabled />);
    await vi.waitFor(() => expect(getComputedStyle(panel()).boxShadow).not.toBe(withoutGlow));
    expect(getComputedStyle(panel()).boxShadow).toContain("rgb");
  });

  it("adds no transition when the user asks for reduced motion", async () => {
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    try {
      await renderHost({});
      await vi.waitFor(() => expect(panel().dataset["ambientImageReducedMotion"]).toBe("true"));
      const style = getComputedStyle(panel());
      expect(style.transitionDuration === "" || style.transitionDuration === "0s").toBe(true);
      expect(style.animationName === "" || style.animationName === "none").toBe(true);
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  it("keeps the frame click-through and releases every listener on unmount", async () => {
    await renderHost({});
    // Only the handles opt into pointer events; the frame and the image do not.
    expect(getComputedStyle(panel()).pointerEvents).toBe("none");
    const image = panel().querySelector("img")!;
    expect(getComputedStyle(image).pointerEvents).toBe("none");
    expect(getComputedStyle(handle("move")).pointerEvents).toBe("auto");

    const removeEventListener = vi.spyOn(window, "removeEventListener");
    const disconnect = vi.spyOn(ResizeObserver.prototype, "disconnect");
    mounted!.unmount();
    mounted = null;
    const removed = removeEventListener.mock.calls.map(([type]) => type);
    expect(removed).toContain("pointermove");
    expect(removed).toContain("pointerup");
    expect(removed).toContain("pointercancel");
    expect(removed).toContain("blur");
    expect(removed).toContain("resize");
    expect(disconnect).toHaveBeenCalled();
    removeEventListener.mockRestore();
    disconnect.mockRestore();

    // A pointer event after unmount must not reach a detached handler.
    expect(() =>
      window.dispatchEvent(
        new PointerEvent("pointermove", { pointerId: 1, clientX: 10, clientY: 10 }),
      ),
    ).not.toThrow();
  });
});
