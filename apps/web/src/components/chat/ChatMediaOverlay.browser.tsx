import "../../index.css";

import { beforeEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

const mocks = vi.hoisted(() => ({
  enabled: true,
  updateSettings: vi.fn(),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: <T,>(selector: (settings: Record<string, unknown>) => T) =>
    selector({
      ambientImageEnabled: mocks.enabled,
      ambientImageAsset: {
        id: `sha256-${"a".repeat(64)}.png`,
        url: "/ambient.png",
        mimeType: "image/png",
        width: 400,
        height: 300,
        sizeBytes: 1_024,
      },
      ambientImageCycleAssets: [],
      ambientImageCycleEnabled: false,
      ambientImageCycleSeconds: 20,
      ambientImagePresentationMode: "floating",
      ambientImageLayoutMode: "preset",
      ambientImagePresetPlacement: "bottom-left",
      ambientImagePresetSize: "medium",
      ambientImageGlowEnabled: false,
      ambientImageGlowColor: "auto",
      ambientImageGlowOpacity: 0.35,
      continueBackgroundAnimations: false,
      ambientVideoEnabled: false,
      ambientVideoSource: null,
      ambientVideoLayoutMode: "preset",
      ambientVideoPresetPlacement: "bottom-left",
      ambientVideoPresetSize: "medium",
      ambientVideoPresentationMode: "floating",
    }),
  useUpdateSettings: () => ({ updateSettings: mocks.updateSettings }),
}));

vi.mock("../../localMedia", () => ({
  useLocalMediaState: () => ({
    source: null,
    presentationMode: "floating",
    layoutMode: "preset",
    presetPlacement: "bottom-left",
    presetSize: "medium",
  }),
}));

vi.mock("../../rpc/serverState", () => ({
  useServerConfig: () => ({
    ambientExperienceCapabilities: {
      spotifyEmbed: true,
      youtubePlayer: true,
    },
  }),
}));

vi.mock("../ambient/AmbientVideoWorkspace", () => ({
  useAmbientVideoWorkspace: () => ({ cinemaEffective: false }),
}));

vi.mock("./AmbientImagePanel", () => ({
  AmbientImagePanel: () => <section aria-label="Ambient image" />,
}));

import { ChatMediaOverlay } from "./ChatMediaOverlay";

beforeEach(() => {
  mocks.enabled = true;
  mocks.updateSettings.mockReset();
});

it("stays outside chat layout flow and removes the image subtree when disabled", async () => {
  const mounted = await render(
    <div className="relative h-[320px] w-[220px]" data-testid="chat-manuscript">
      <div className="h-full">Transcript</div>
      <ChatMediaOverlay />
    </div>,
  );

  const manuscript = page.getByTestId("chat-manuscript").element();
  const overlay = document.querySelector<HTMLElement>('[data-chat-media-overlay="true"]');
  expect(overlay).not.toBeNull();
  expect(getComputedStyle(overlay!).position).toBe("absolute");
  expect(getComputedStyle(overlay!).pointerEvents).toBe("none");
  expect(manuscript.scrollHeight).toBe(320);
  expect(document.querySelector('[aria-label="Ambient image"]')).not.toBeNull();

  mocks.enabled = false;
  await mounted.rerender(
    <div className="relative h-[320px] w-[220px]" data-testid="chat-manuscript">
      <div className="h-full">Transcript</div>
      <ChatMediaOverlay />
    </div>,
  );

  expect(document.querySelector('[aria-label="Ambient image"]')).toBeNull();
  expect(manuscript.scrollHeight).toBe(320);
});
