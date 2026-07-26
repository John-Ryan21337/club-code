import "../../index.css";

import type { AmbientImageAsset } from "@cafecode/contracts/settings";
import { useState } from "react";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY,
  readAmbientMediaGeometry,
  resetAmbientMediaGeometry,
} from "../../ambientMediaGeometryStorage";
import { AmbientImagePanel } from "./AmbientImagePanel";

const asset = {
  id: `sha256-${"a".repeat(64)}.png`,
  url: `/api/ambient-media/image/sha256-${"a".repeat(64)}.png`,
  mimeType: "image/png",
  width: 400,
  height: 300,
  sizeBytes: 1024,
} as AmbientImageAsset;

let mounted: Awaited<ReturnType<typeof render>> | null = null;

beforeEach(() => {
  window.localStorage.removeItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY);
});

afterEach(async () => {
  await mounted?.unmount().catch(() => undefined);
  mounted = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

it("renders a reachable preset image and disable control", async () => {
  const onDisable = vi.fn();
  mounted = await render(
    <div className="relative h-[800px] w-[1000px]">
      <AmbientImagePanel
        asset={asset}
        cycleAssets={[]}
        cycleEnabled={false}
        cycleSeconds={20}
        presentationMode="floating"
        layoutMode="preset"
        placement="bottom-left"
        size="medium"
        stackedVideoSize={null}
        glow={false}
        glowColor="auto"
        glowOpacity={0.35}
        continueBackgroundAnimations={false}
        onDisable={onDisable}
      />
    </div>,
  );

  await expect
    .element(page.getByRole("region", { name: "Ambient image" }))
    .toHaveAttribute("data-ambient-image-layout", "preset");
  await userEvent.click(page.getByRole("button", { name: "Disable ambient image" }));
  expect(onDisable).toHaveBeenCalledOnce();
});

it("offers stable manual cycling and theater presentation", async () => {
  const secondAsset = {
    ...asset,
    id: `sha256-${"b".repeat(64)}.gif`,
    url: `/api/ambient-media/image/sha256-${"b".repeat(64)}.gif`,
    mimeType: "image/gif" as const,
  };
  mounted = await render(
    <div className="relative h-[800px] w-[1000px]">
      <AmbientImagePanel
        asset={asset}
        cycleAssets={[asset, secondAsset]}
        cycleEnabled
        cycleSeconds={20}
        presentationMode="theater"
        layoutMode="preset"
        placement="bottom-left"
        size="medium"
        stackedVideoSize={null}
        glow={false}
        glowColor="auto"
        glowOpacity={0.35}
        continueBackgroundAnimations={false}
        onDisable={vi.fn()}
      />
    </div>,
  );

  const panel = page.getByRole("region", { name: "Ambient image" });
  await expect.element(panel).toHaveAttribute("data-ambient-image-layout", "theater");
  await expect.element(page.getByText("1 / 2")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Next ambient image" }));
  await expect.element(page.getByText("2 / 2")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Previous ambient image" }));
  await expect.element(page.getByText("1 / 2")).toBeVisible();
});

it("does not overwrite saved custom geometry when cycling between aspect ratios", async () => {
  const savedGeometry = { x: 0.1, y: 0.1, width: 0.5 };
  window.localStorage.setItem(
    AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      slots: { image: savedGeometry },
    }),
  );
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const portraitAsset = {
    ...asset,
    id: `sha256-${"c".repeat(64)}.png`,
    width: 200,
    height: 400,
  };
  mounted = await render(
    <div className="relative h-[800px] w-[1000px]">
      <AmbientImagePanel
        asset={asset}
        cycleAssets={[asset, portraitAsset]}
        cycleEnabled
        cycleSeconds={20}
        presentationMode="floating"
        layoutMode="custom"
        placement="bottom-left"
        size="medium"
        stackedVideoSize={null}
        glow={false}
        glowColor="auto"
        glowOpacity={0.35}
        continueBackgroundAnimations={false}
        onDisable={vi.fn()}
      />
    </div>,
  );

  await expect
    .element(page.getByRole("region", { name: "Ambient image" }))
    .toHaveAttribute("data-ambient-image-layout", "custom");
  setItem.mockClear();

  await userEvent.click(page.getByRole("button", { name: "Next ambient image" }));
  await expect.element(page.getByText("2 / 2")).toBeVisible();
  expect(setItem).not.toHaveBeenCalled();
  expect(readAmbientMediaGeometry("image")).toEqual(savedGeometry);

  await userEvent.click(page.getByRole("button", { name: "Previous ambient image" }));
  await expect.element(page.getByText("1 / 2")).toBeVisible();
  expect(setItem).not.toHaveBeenCalled();
  expect(readAmbientMediaGeometry("image")).toEqual(savedGeometry);

  const parent = page.getByRole("region", { name: "Ambient image" }).element().parentElement;
  expect(parent).not.toBeNull();
  parent!.style.width = "500px";
  window.dispatchEvent(new Event("resize"));
  await vi.waitFor(() => {
    expect(page.getByRole("region", { name: "Ambient image" }).element().style.width).toBe("250px");
  });
  expect(setItem).not.toHaveBeenCalled();
  expect(readAmbientMediaGeometry("image")).toEqual(savedGeometry);
});

it("reseeds custom geometry after reset without requiring a remount", async () => {
  const savedGeometry = { x: 0.1, y: 0.1, width: 0.5 };
  window.localStorage.setItem(
    AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      slots: { image: savedGeometry },
    }),
  );

  function Harness() {
    const [layoutMode, setLayoutMode] = useState<"custom" | "preset">("custom");
    return (
      <div className="relative h-[800px] w-[1000px]">
        <button
          type="button"
          onClick={() => {
            resetAmbientMediaGeometry("image");
            setLayoutMode("preset");
          }}
        >
          Reset layout
        </button>
        <button type="button" onClick={() => setLayoutMode("custom")}>
          Use custom layout
        </button>
        <AmbientImagePanel
          asset={asset}
          cycleAssets={[]}
          cycleEnabled={false}
          cycleSeconds={20}
          presentationMode="floating"
          layoutMode={layoutMode}
          placement="bottom-left"
          size="medium"
          stackedVideoSize={null}
          glow={false}
          glowColor="auto"
          glowOpacity={0.35}
          continueBackgroundAnimations={false}
          onDisable={vi.fn()}
        />
      </div>
    );
  }

  mounted = await render(<Harness />);
  const panel = page.getByRole("region", { name: "Ambient image" });
  await expect.element(panel).toHaveAttribute("data-ambient-image-layout", "custom");
  expect(panel.element().style.width).toBe("500px");

  await userEvent.click(page.getByRole("button", { name: "Reset layout" }));
  await expect.element(panel).toHaveAttribute("data-ambient-image-layout", "preset");
  expect(readAmbientMediaGeometry("image")).toBeNull();

  await userEvent.click(page.getByRole("button", { name: "Use custom layout" }));
  await expect.element(panel).toHaveAttribute("data-ambient-image-layout", "custom");
  await vi.waitFor(() => {
    expect(readAmbientMediaGeometry("image")?.width).toBeCloseTo(0.26);
    expect(panel.element().style.width).toBe("260px");
  });
});

it("renders theater presentation for a single ambient image", async () => {
  mounted = await render(
    <div className="relative h-[800px] w-[1000px]">
      <AmbientImagePanel
        asset={asset}
        cycleAssets={[]}
        cycleEnabled={false}
        cycleSeconds={20}
        presentationMode="theater"
        layoutMode="preset"
        placement="bottom-left"
        size="medium"
        stackedVideoSize={null}
        glow={false}
        glowColor="auto"
        glowOpacity={0.35}
        continueBackgroundAnimations={false}
        onDisable={vi.fn()}
      />
    </div>,
  );

  await expect
    .element(page.getByRole("region", { name: "Ambient image" }))
    .toHaveAttribute("data-ambient-image-layout", "theater");
});

it("pauses animated images when reduced motion is requested", async () => {
  vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
  const gifAsset = {
    ...asset,
    id: `sha256-${"d".repeat(64)}.gif`,
    url: `/api/ambient-media/image/sha256-${"d".repeat(64)}.gif`,
    mimeType: "image/gif" as const,
  };
  mounted = await render(
    <div className="relative h-[800px] w-[1000px]">
      <AmbientImagePanel
        asset={gifAsset}
        cycleAssets={[]}
        cycleEnabled={false}
        cycleSeconds={20}
        presentationMode="floating"
        layoutMode="preset"
        placement="bottom-left"
        size="medium"
        stackedVideoSize={null}
        glow={false}
        glowColor="auto"
        glowOpacity={0.35}
        continueBackgroundAnimations
        onDisable={vi.fn()}
      />
    </div>,
  );

  await expect.element(page.getByText("Animated image paused for reduced motion.")).toBeVisible();
  expect(
    page.getByRole("region", { name: "Ambient image" }).element().querySelector("img"),
  ).toBeNull();
});

it("keeps one pointer owner and does not persist a no-op move click", async () => {
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  mounted = await render(
    <div className="relative h-[800px] w-[1000px]">
      <AmbientImagePanel
        asset={asset}
        cycleAssets={[]}
        cycleEnabled={false}
        cycleSeconds={20}
        presentationMode="floating"
        layoutMode="custom"
        placement="bottom-left"
        size="medium"
        stackedVideoSize={null}
        glow={false}
        glowColor="auto"
        glowOpacity={0.35}
        continueBackgroundAnimations={false}
        onDisable={vi.fn()}
      />
    </div>,
  );

  await expect
    .element(page.getByRole("region", { name: "Ambient image" }))
    .toHaveAttribute("data-ambient-image-layout", "custom");
  const move = page.getByRole("button", { name: /Move ambient image/ }).element();
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  Object.defineProperties(move, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  setItem.mockClear();

  move.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 71,
      clientX: 100,
      clientY: 100,
    }),
  );
  move.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 72,
      clientX: 130,
      clientY: 130,
    }),
  );

  expect(setPointerCapture).toHaveBeenCalledOnce();
  expect(setPointerCapture).toHaveBeenCalledWith(71);
  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 72 }));
  expect(releasePointerCapture).not.toHaveBeenCalled();
  expect(setItem).not.toHaveBeenCalled();

  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 71 }));
  expect(releasePointerCapture).toHaveBeenCalledOnce();
  expect(releasePointerCapture).toHaveBeenCalledWith(71);
  expect(setItem).not.toHaveBeenCalled();
});

it("moves custom images smoothly and persists exactly once on pointer release", async () => {
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  mounted = await render(
    <div className="relative h-[800px] w-[1000px]">
      <AmbientImagePanel
        asset={asset}
        cycleAssets={[]}
        cycleEnabled={false}
        cycleSeconds={20}
        presentationMode="floating"
        layoutMode="custom"
        placement="bottom-left"
        size="medium"
        stackedVideoSize={null}
        glow={false}
        glowColor="auto"
        glowOpacity={0.35}
        continueBackgroundAnimations={false}
        onDisable={vi.fn()}
      />
    </div>,
  );

  const panel = page.getByRole("region", { name: "Ambient image" });
  await expect.element(panel).toHaveAttribute("data-ambient-image-layout", "custom");
  const initial = readAmbientMediaGeometry("image");
  expect(initial).not.toBeNull();
  setItem.mockClear();

  const move = page.getByRole("button", { name: /Move ambient image/ }).element();
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  Object.defineProperties(move, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: () => true },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  move.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(setItem).toHaveBeenCalledOnce();
  const beforePointerMove = readAmbientMediaGeometry("image")!;
  expect(beforePointerMove.x).toBeGreaterThan(initial!.x);
  setItem.mockClear();

  move.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 7,
      clientX: 100,
      clientY: 100,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 7,
      clientX: 150,
      clientY: 120,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 7,
      clientX: 220,
      clientY: 180,
    }),
  );

  expect(setItem).not.toHaveBeenCalled();
  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7 }));

  expect(setPointerCapture).toHaveBeenCalledWith(7);
  expect(releasePointerCapture).toHaveBeenCalledWith(7);
  expect(setItem).toHaveBeenCalledOnce();
  expect(readAmbientMediaGeometry("image")!.x).toBeGreaterThan(beforePointerMove.x);
  expect(readAmbientMediaGeometry("image")!.y).toBeGreaterThan(beforePointerMove.y);
});

it("commits on lost capture but never writes an unfinished move during unmount", async () => {
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  mounted = await render(
    <div className="relative h-[800px] w-[1000px]">
      <AmbientImagePanel
        asset={asset}
        cycleAssets={[]}
        cycleEnabled={false}
        cycleSeconds={20}
        presentationMode="floating"
        layoutMode="custom"
        placement="bottom-left"
        size="medium"
        stackedVideoSize={null}
        glow={false}
        glowColor="auto"
        glowOpacity={0.35}
        continueBackgroundAnimations={false}
        onDisable={vi.fn()}
      />
    </div>,
  );

  await expect
    .element(page.getByRole("region", { name: "Ambient image" }))
    .toHaveAttribute("data-ambient-image-layout", "custom");
  const move = page.getByRole("button", { name: /Move ambient image/ }).element();
  Object.defineProperties(move, {
    setPointerCapture: { configurable: true, value: vi.fn() },
    hasPointerCapture: { configurable: true, value: () => false },
    releasePointerCapture: { configurable: true, value: vi.fn() },
  });
  setItem.mockClear();

  move.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 8,
      clientX: 100,
      clientY: 100,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 8,
      clientX: 160,
      clientY: 140,
    }),
  );
  move.dispatchEvent(
    new PointerEvent("lostpointercapture", {
      bubbles: true,
      pointerId: 8,
    }),
  );
  expect(setItem).toHaveBeenCalledOnce();

  setItem.mockClear();
  move.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 9,
      clientX: 100,
      clientY: 100,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 9,
      clientX: 180,
      clientY: 150,
    }),
  );
  window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 9 }));
  move.dispatchEvent(
    new PointerEvent("lostpointercapture", {
      bubbles: true,
      pointerId: 9,
    }),
  );
  expect(setItem).toHaveBeenCalledOnce();

  setItem.mockClear();
  move.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 10,
      clientX: 100,
      clientY: 100,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 10,
      clientX: 190,
      clientY: 160,
    }),
  );
  window.dispatchEvent(new Event("blur"));
  expect(setItem).toHaveBeenCalledOnce();

  setItem.mockClear();
  move.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 11,
      clientX: 100,
      clientY: 100,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 11,
      clientX: 200,
      clientY: 200,
    }),
  );
  await mounted.unmount();
  mounted = null;
  expect(setItem).not.toHaveBeenCalled();
});
