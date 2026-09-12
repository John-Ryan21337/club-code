import "../../index.css";
import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ServerConfig,
} from "@cafecode/contracts";
import type { AmbientImageAsset } from "@cafecode/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { AmbientImageLayer } from "../../ambient/AmbientImageLayer";
import { AppAtomRegistryProvider, resetAppAtomRegistryForTests } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";

/**
 * Real-DOM regressions for the ambient overlay.
 *
 * These deliberately assert *stacking and hit-testing in the real layout*, not
 * just that a node was rendered: an earlier revision parked the layer at `z-0`
 * underneath the app shell's opaque chrome, where it rendered correctly and was
 * still completely invisible to the user.
 */
const assetFor = (id: string, mimeType: AmbientImageAsset["mimeType"]): AmbientImageAsset =>
  ({
    id,
    url: `/api/ambient-media/image/${id}`,
    mimeType,
    width: 64,
    height: 64,
    sizeBytes: 1024,
  }) as AmbientImageAsset;

const pngAsset = assetFor(`sha256-${"a".repeat(64)}.png`, "image/png");
const secondPngAsset = assetFor(`sha256-${"b".repeat(64)}.png`, "image/png");
const gifAsset = assetFor(`sha256-${"c".repeat(64)}.gif`, "image/gif");

function createServerConfig(clientSettings: Partial<ServerConfig["clientSettings"]>): ServerConfig {
  return {
    environment: {
      environmentId: EnvironmentId.make("environment-local"),
      label: "Local environment",
      platform: { os: "darwin" as const, arch: "arm64" as const },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie", "bearer-session-token"],
      sessionCookieName: "t3_session",
    },
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.t3code-keybindings.json",
    systemPromptPath: "/repo/project/.t3code-system-prompt.md",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.t3/logs",
      localTracingEnabled: true,
      otlpTracesUrl: "http://localhost:4318/v1/traces",
      otlpTracesEnabled: true,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
    clientSettings: {
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompleted: true,
      ...clientSettings,
    },
  } as ServerConfig;
}

/**
 * Stand-in for the real app shell: an opaque, full-viewport surface with a
 * button, rendered *after* the layer just as `__root.tsx` renders the app shell
 * after `<AmbientImageLayer />`. This is what a `z-0` overlay disappears behind.
 */
function OpaqueAppShell() {
  return (
    <div
      data-testid="opaque-app-shell"
      style={{
        position: "relative",
        inset: 0,
        minHeight: "100dvh",
        width: "100%",
        background: "rgb(20 20 24)",
      }}
    >
      <button
        type="button"
        data-testid="shell-button"
        style={{ margin: "40vh auto 0", display: "block" }}
      >
        Send
      </button>
    </div>
  );
}

let mounted: { unmount: () => void } | null = null;

const renderLayer = async (clientSettings: Partial<ServerConfig["clientSettings"]>) => {
  setServerConfigSnapshot(createServerConfig(clientSettings));
  mounted = await render(
    <AppAtomRegistryProvider>
      <AmbientImageLayer />
      <OpaqueAppShell />
    </AppAtomRegistryProvider>,
  );
};

describe("AmbientImageLayer", () => {
  beforeEach(() => {
    resetAppAtomRegistryForTests();
    resetServerStateForTests();
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
    resetServerStateForTests();
    resetAppAtomRegistryForTests();
    vi.useRealTimers();
  });

  it("renders nothing for a default profile", async () => {
    await renderLayer({});
    expect(document.querySelector('[data-testid="ambient-image-layer"]')).toBeNull();
  });

  it("renders nothing when an image is selected but the feature is off", async () => {
    await renderLayer({ ambientImageEnabled: false, ambientImageAsset: pngAsset });
    expect(document.querySelector('[data-testid="ambient-image-layer"]')).toBeNull();
  });

  it("paints the selected image above the opaque app shell and stays click-through", async () => {
    await renderLayer({
      ambientImageEnabled: true,
      ambientImageAsset: pngAsset,
      ambientImagePresentationMode: "theater",
    });

    const image = document.querySelector<HTMLImageElement>("[data-ambient-image-id]");
    expect(image).not.toBeNull();
    expect(image?.dataset["ambientImageId"]).toBe(pngAsset.id);

    // Visibility: hit-testing follows paint order, so with the click-through
    // rule momentarily lifted the overlay must win against the opaque shell.
    // (The real `pointer-events: none` is asserted separately below.)
    const layer = image!.parentElement!;
    expect(getComputedStyle(layer).pointerEvents).toBe("none");
    const centreLeft = window.innerWidth * 0.15;
    const topStrip = window.innerHeight * 0.1;
    layer.style.pointerEvents = "auto";
    const painted = document.elementFromPoint(centreLeft, topStrip);
    layer.style.pointerEvents = "";
    expect(painted).toBe(image);

    // Theater mode really covers the viewport rather than collapsing to 0x0.
    const rect = image!.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(window.innerWidth * 0.9);
    expect(rect.height).toBeGreaterThan(window.innerHeight * 0.9);

    // Reading stays possible: the wash is bounded well below opaque.
    expect(Number(getComputedStyle(image!).opacity)).toBeLessThanOrEqual(0.35);

    // Controls underneath stay usable: the layer takes no pointer events.
    expect(getComputedStyle(layer).pointerEvents).toBe("none");
    const shellButton = document.querySelector<HTMLButtonElement>('[data-testid="shell-button"]');
    const buttonRect = shellButton!.getBoundingClientRect();
    expect(
      document.elementFromPoint(
        buttonRect.left + buttonRect.width / 2,
        buttonRect.top + buttonRect.height / 2,
      ),
    ).toBe(shellButton);

    // The overlay is inert and never reads from a third party: the only source
    // is the app's own authenticated ambient-media route.
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.closest("[aria-hidden]")).not.toBeNull();
    const resolved = new URL(image!.src, window.location.href);
    expect(resolved.origin).toBe(window.location.origin);
    expect(resolved.pathname).toBe(pngAsset.url);
  });

  it("keeps a floating image visible without covering the control it sits near", async () => {
    await renderLayer({
      ambientImageEnabled: true,
      ambientImageAsset: pngAsset,
      ambientImagePresentationMode: "floating",
    });

    const image = document.querySelector<HTMLImageElement>("[data-ambient-image-id]");
    const rect = image!.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    // A corner panel, not a full-bleed cover.
    expect(rect.width).toBeLessThan(window.innerWidth * 0.5);
    const layer = image!.parentElement!;
    expect(getComputedStyle(layer).pointerEvents).toBe("none");
    layer.style.pointerEvents = "auto";
    // Sample the centre: the panel has a 12px corner radius, so a corner pixel
    // is legitimately clipped away.
    const painted = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    layer.style.pointerEvents = "";
    expect(painted).toBe(image);
  });

  it("shows an uploaded library image that was never explicitly selected", async () => {
    await renderLayer({
      ambientImageEnabled: true,
      ambientImageAsset: null,
      ambientImageCycleAssets: [pngAsset],
    });

    expect(
      document.querySelector<HTMLImageElement>("[data-ambient-image-id]")?.dataset[
        "ambientImageId"
      ],
    ).toBe(pngAsset.id);
  });

  it("renders a GIF as a plain img so browser animation is preserved", async () => {
    await renderLayer({
      ambientImageEnabled: true,
      ambientImageAsset: gifAsset,
    });

    const image = document.querySelector<HTMLImageElement>("[data-ambient-image-id]");
    // A canvas or a video element would drop the decoded animation the upload
    // budget was validated for; the overlay must stay a plain <img>.
    expect(image?.tagName).toBe("IMG");
    expect(document.querySelector('[data-testid="ambient-image-layer"] canvas')).toBeNull();
    expect(document.querySelector('[data-testid="ambient-image-layer"] video')).toBeNull();
    expect(new URL(image!.src, window.location.href).pathname.endsWith(".gif")).toBe(true);
  });

  it("advances the rotation and clears its timer on unmount", async () => {
    await renderLayer({
      ambientImageEnabled: true,
      ambientImageCycleEnabled: true,
      ambientImageCycleAssets: [pngAsset, secondPngAsset],
      ambientImageCycleSeconds: 3,
    });

    const currentId = () =>
      document.querySelector<HTMLImageElement>("[data-ambient-image-id]")?.dataset[
        "ambientImageId"
      ];
    expect(currentId()).toBe(pngAsset.id);

    await vi.waitFor(() => expect(currentId()).toBe(secondPngAsset.id), {
      timeout: 8_000,
      interval: 100,
    });

    const clearInterval = vi.spyOn(window, "clearInterval");
    mounted?.unmount();
    mounted = null;
    expect(clearInterval).toHaveBeenCalled();
    clearInterval.mockRestore();
  });
});
