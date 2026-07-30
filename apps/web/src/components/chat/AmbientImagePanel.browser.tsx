import "../../index.css";

import type { AmbientImageAsset } from "@cafecode/contracts/settings";
import { page, userEvent } from "vitest/browser";
import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import {
  AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY,
  readAmbientMediaGeometry,
} from "../../ambientMediaGeometryStorage";
import { AmbientImagePanel } from "./AmbientImagePanel";

const asset = {
  id: `sha256-${"a".repeat(64)}.png`,
  url: `/api/ambient-media/image/sha256-${"a".repeat(64)}.png`,
  mimeType: "image/png",
  width: 400,
  height: 300,
  sizeBytes: 1_024,
} as AmbientImageAsset;

beforeEach(() => {
  window.localStorage.removeItem(AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY);
});

it("seeds custom image geometry and supports keyboard move and resize handles", async () => {
  await render(
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
        onRequestCustomLayout={vi.fn()}
        onDisable={vi.fn()}
      />
    </div>,
  );

  const panel = page.getByRole("region", { name: "Ambient image" });
  await expect.element(panel).toHaveAttribute("data-ambient-image-layout", "custom");

  const move = page.getByRole("button", { name: /Move ambient image/ });
  move.element().focus();
  await userEvent.keyboard("{ArrowRight}{ArrowUp}");
  const moved = readAmbientMediaGeometry("image");
  expect(moved).not.toBeNull();
  expect(moved!.x).toBeGreaterThan(0.02);
  expect(moved!.y).toBeLessThan(0.8);

  const resize = page.getByRole("button", { name: /Resize ambient image/ });
  const widthBefore = moved!.width;
  resize.element().focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(readAmbientMediaGeometry("image")!.width).toBeGreaterThan(widthBefore);

  const moveElement = move.element();
  Object.defineProperty(moveElement, "setPointerCapture", { value: vi.fn() });
  const xBeforePointerDrag = readAmbientMediaGeometry("image")!.x;
  moveElement.dispatchEvent(
    new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 7,
      clientX: 100,
      clientY: 100,
    }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 7,
      clientX: 200,
      clientY: 150,
    }),
  );
  window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7 }));
  expect(readAmbientMediaGeometry("image")!.x).toBeGreaterThan(xBeforePointerDrag);
});

it("shows move and resize affordances in preset layout and promotes the first adjustment", async () => {
  const onRequestCustomLayout = vi.fn();
  await render(
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
        onRequestCustomLayout={onRequestCustomLayout}
        onDisable={vi.fn()}
      />
    </div>,
  );

  const move = page.getByRole("button", { name: /Move ambient image/ });
  await expect.element(move).toBeVisible();
  await expect.element(page.getByRole("button", { name: /Resize ambient image/ })).toBeVisible();
  move.element().focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(onRequestCustomLayout).toHaveBeenCalledTimes(1);
  expect(readAmbientMediaGeometry("image")).not.toBeNull();
});

it("offers stable manual cycling and a theater presentation without changing custom geometry", async () => {
  const secondAsset = {
    ...asset,
    id: `sha256-${"b".repeat(64)}.gif`,
    url: `/api/ambient-media/image/sha256-${"b".repeat(64)}.gif`,
    mimeType: "image/gif" as const,
  };
  await render(
    <div className="relative h-[800px] w-[1000px]">
      <AmbientImagePanel
        asset={asset}
        cycleAssets={[asset, secondAsset]}
        cycleEnabled
        cycleSeconds={20}
        presentationMode="theater"
        layoutMode="custom"
        placement="bottom-left"
        size="medium"
        stackedVideoSize={null}
        glow={false}
        glowColor="auto"
        glowOpacity={0.35}
        continueBackgroundAnimations={false}
        onRequestCustomLayout={vi.fn()}
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

it("keeps custom controls reachable on a narrow pane and tears down cycling without layout height", async () => {
  const secondAsset = {
    ...asset,
    id: `sha256-${"c".repeat(64)}.gif`,
    url: `/api/ambient-media/image/sha256-${"c".repeat(64)}.gif`,
    mimeType: "image/gif" as const,
  };
  localStorage.setItem(
    AMBIENT_MEDIA_GEOMETRY_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      slots: { image: { x: 0.9, y: 0.9, width: 1 } },
    }),
  );
  const clearInterval = vi.spyOn(window, "clearInterval");
  const removeListener = vi.spyOn(window, "removeEventListener");
  const mounted = await render(
    <div className="relative h-[320px] w-[220px]" data-testid="narrow-chat-pane">
      <AmbientImagePanel
        asset={asset}
        cycleAssets={[asset, secondAsset]}
        cycleEnabled
        cycleSeconds={3}
        presentationMode="floating"
        layoutMode="custom"
        placement="bottom-left"
        size="large"
        stackedVideoSize={null}
        glow={false}
        glowColor="auto"
        glowOpacity={0.35}
        continueBackgroundAnimations
        onRequestCustomLayout={vi.fn()}
        onDisable={vi.fn()}
      />
    </div>,
  );

  const pane = page.getByTestId("narrow-chat-pane").element();
  const panel = page.getByRole("region", { name: "Ambient image" }).element();
  await expect.poll(() => panel.getBoundingClientRect().width).toBeGreaterThan(0);
  expect(panel.getBoundingClientRect().width).toBeLessThanOrEqual(220 * 0.9 + 1);
  expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(
    pane.getBoundingClientRect().left,
  );
  expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(
    pane.getBoundingClientRect().right + 1,
  );
  expect(pane.getBoundingClientRect().height).toBe(320);
  expect(pane.scrollHeight).toBe(320);
  expect(
    page
      .getByRole("button", { name: /Move ambient image/ })
      .element()
      .getAttribute("title"),
  ).toContain("Drag");
  expect(
    page
      .getByRole("button", { name: /Resize ambient image/ })
      .element()
      .getAttribute("title"),
  ).toContain("Drag");

  await mounted.unmount();

  expect(clearInterval).toHaveBeenCalled();
  expect(removeListener.mock.calls.some(([type]) => type === "pointermove")).toBe(true);
  expect(removeListener.mock.calls.some(([type]) => type === "resize")).toBe(true);
  clearInterval.mockRestore();
  removeListener.mockRestore();
});
