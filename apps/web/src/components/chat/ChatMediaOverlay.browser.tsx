import "../../index.css";

import { DEFAULT_CLIENT_SETTINGS } from "@cafecode/contracts/settings";
import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ChatMediaOverlay } from "./ChatMediaOverlay";

const overlayHarness = vi.hoisted(() => ({
  ambientImageCapability: true,
  settings: {} as Record<string, unknown>,
  updateSettings: vi.fn(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: (selector: (settings: Record<string, unknown>) => unknown) =>
    selector(overlayHarness.settings),
  useUpdateSettings: () => ({
    updateSettings: overlayHarness.updateSettings,
  }),
}));

vi.mock("../../rpc/serverState", () => ({
  useServerConfig: () => ({
    ambientExperienceCapabilities: {
      ambientImage: overlayHarness.ambientImageCapability,
    },
  }),
}));

const asset = {
  id: `sha256-${"a".repeat(64)}.png`,
  mimeType: "image/png" as const,
  sizeBytes: 128,
  width: 320,
  height: 180,
  url: `/api/ambient-media/image/sha256-${"a".repeat(64)}.png`,
};

describe("ChatMediaOverlay", () => {
  let mounted: Awaited<ReturnType<typeof render>> | null = null;

  beforeEach(() => {
    overlayHarness.ambientImageCapability = true;
    overlayHarness.settings = {
      ...DEFAULT_CLIENT_SETTINGS,
      ambientImageEnabled: true,
      ambientImageAsset: asset,
    };
    overlayHarness.updateSettings.mockReset();
  });

  afterEach(async () => {
    await mounted?.unmount().catch(() => undefined);
    mounted = null;
    document.body.innerHTML = "";
  });

  it("renders the selected image when the server capability is enabled", async () => {
    mounted = await render(
      <div className="relative h-[480px] w-[720px]">
        <ChatMediaOverlay />
      </div>,
    );

    await expect
      .element(page.getByRole("region", { name: "Ambient image", exact: true }))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Disable ambient image" }));
    expect(overlayHarness.updateSettings).toHaveBeenCalledWith({
      ambientImageEnabled: false,
    });
  });

  it("fails closed when the server capability is disabled", async () => {
    overlayHarness.ambientImageCapability = false;
    mounted = await render(
      <div className="relative h-[480px] w-[720px]">
        <ChatMediaOverlay />
      </div>,
    );

    expect(document.querySelector('section[aria-label="Ambient image"]')).toBeNull();
  });
});
