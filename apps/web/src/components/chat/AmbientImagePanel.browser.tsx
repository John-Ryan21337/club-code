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
