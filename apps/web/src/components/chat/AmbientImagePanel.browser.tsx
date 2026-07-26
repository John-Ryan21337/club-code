import "../../index.css";

import type { AmbientImageAsset } from "@cafecode/contracts/settings";
import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

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

it("renders theater presentation for a single ambient image", async () => {
  mounted = await render(
    <div className="relative h-[800px] w-[1000px]">
      <AmbientImagePanel
        asset={asset}
        cycleAssets={[]}
        cycleEnabled={false}
        cycleSeconds={20}
        presentationMode="theater"
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
