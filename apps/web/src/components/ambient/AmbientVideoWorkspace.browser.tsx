import "../../index.css";

import {
  DEFAULT_AMBIENT_EXPERIENCE_CAPABILITIES,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ServerConfig,
} from "@cafecode/contracts";
import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { resetServerStateForTests, setServerConfigSnapshot } from "../../rpc/serverState";
import { __resetYouTubeUrlQueueForTests, youtubeUrlQueueStore } from "../../youtubeUrlQueue";
import { AmbientVideoWorkspace, useAmbientVideoWorkspace } from "./AmbientVideoWorkspace";

let mounted: Awaited<ReturnType<typeof render>> | null = null;

function makeConfig(
  ambientVideoSource: (typeof DEFAULT_CLIENT_SETTINGS)["ambientVideoSource"],
): ServerConfig {
  return {
    environment: {
      environmentId: EnvironmentId.make("environment-ambient-workspace-test"),
      label: "Local environment",
      platform: { os: "darwin", arch: "arm64" },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie", "bearer-session-token"],
      sessionCookieName: "club-code-test",
    },
    cwd: "/repo/project",
    keybindingsConfigPath: "/repo/project/.club-code-keybindings.json",
    systemPromptPath: "/repo/project/.club-code-system-prompt.md",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/repo/project/.club-code/logs",
      localTracingEnabled: false,
      otlpTracesUrl: undefined,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
    clientSettings: {
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompleted: true,
      ambientVideoSource,
    },
    ambientExperienceCapabilities: {
      ...DEFAULT_AMBIENT_EXPERIENCE_CAPABILITIES,
      youtubePlayer: true,
    },
  };
}

function TestChatAnchor() {
  const { registerChatAnchor } = useAmbientVideoWorkspace();
  return (
    <main ref={registerChatAnchor} style={{ width: "900px", height: "600px" }}>
      Chat workspace
    </main>
  );
}

function TestMobileChatAnchor() {
  const { registerChatAnchor } = useAmbientVideoWorkspace();
  return (
    <main ref={registerChatAnchor} style={{ width: "100%", height: "100%" }}>
      Mobile chat workspace
    </main>
  );
}

async function waitForTwoAnimationFrames(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

async function expectPlayerGeometry(input: {
  readonly frame: HTMLIFrameElement;
  readonly layout: "floating" | "mobile-docked";
  readonly viewportWidth: number;
  readonly viewportHeight: number;
}): Promise<HTMLElement> {
  await expect
    .poll(() => {
      const player = input.frame.closest<HTMLElement>("[data-ambient-video-layout]");
      const frameRect = input.frame.getBoundingClientRect();
      const playerRect = player?.getBoundingClientRect();
      return (
        player?.dataset.ambientVideoLayout === input.layout &&
        frameRect.width >= 200 &&
        frameRect.height >= 200 &&
        playerRect !== undefined &&
        playerRect.left >= 0 &&
        playerRect.right <= input.viewportWidth &&
        playerRect.top >= 0 &&
        playerRect.bottom <= input.viewportHeight
      );
    })
    .toBe(true);
  return input.frame.closest<HTMLElement>("[data-ambient-video-layout]")!;
}

beforeEach(() => {
  resetServerStateForTests();
  __resetYouTubeUrlQueueForTests();
  document.body.innerHTML = "";
});

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  resetServerStateForTests();
  __resetYouTubeUrlQueueForTests();
  document.body.innerHTML = "";
  await page.viewport(1_280, 720);
});

it("keeps the first-run workspace queue empty without opening Settings", async () => {
  setServerConfigSnapshot(makeConfig(null));
  mounted = await render(
    <AppAtomRegistryProvider>
      <AmbientVideoWorkspace>
        <main>Chat workspace</main>
      </AmbientVideoWorkspace>
    </AppAtomRegistryProvider>,
  );

  await expect.poll(() => youtubeUrlQueueStore.getSnapshot().revision).toBe(0);
  expect(youtubeUrlQueueStore.getSnapshot()).toMatchObject({
    active: false,
    count: 0,
    currentSource: null,
    exampleId: null,
  });
  await expect.element(page.getByTitle("Ambient YouTube URL queue player")).not.toBeInTheDocument();
});

it("does not let temporary defaults mask a persisted source that arrives after mount", async () => {
  mounted = await render(
    <AppAtomRegistryProvider>
      <AmbientVideoWorkspace>
        <main>Chat workspace</main>
      </AmbientVideoWorkspace>
    </AppAtomRegistryProvider>,
  );

  await expect.poll(() => youtubeUrlQueueStore.getSnapshot().revision).toBe(0);
  setServerConfigSnapshot(makeConfig({ kind: "video", id: "dQw4w9WgXcQ" }));
  await expect.poll(() => youtubeUrlQueueStore.getSnapshot().revision).toBe(0);
  expect(youtubeUrlQueueStore.getSnapshot()).toMatchObject({
    active: false,
    currentSource: null,
  });
});

it("retains the exact player through Settings and remounts it across environments", async () => {
  const config = makeConfig({ kind: "video", id: "dQw4w9WgXcQ" });
  setServerConfigSnapshot({
    ...config,
    clientSettings: {
      ...config.clientSettings,
      ambientVideoEnabled: true,
      ambientVideoPresentationMode: "floating",
    },
  });
  mounted = await render(
    <AppAtomRegistryProvider>
      <AmbientVideoWorkspace environmentScopeKey="environment-a">
        <TestChatAnchor />
      </AmbientVideoWorkspace>
    </AppAtomRegistryProvider>,
  );

  await expect
    .poll(() =>
      document.querySelector<HTMLIFrameElement>('iframe[title="Ambient YouTube video player"]'),
    )
    .not.toBeNull();
  const firstFrame = document.querySelector<HTMLIFrameElement>(
    'iframe[title="Ambient YouTube video player"]',
  );
  expect(firstFrame).not.toBeNull();

  // Settings replaces the route child and removes the chat anchor. The
  // long-lived workspace must retain both its geometry and the exact iframe
  // node so YouTube playback/controller state is not restarted.
  await mounted.rerender(
    <AppAtomRegistryProvider>
      <AmbientVideoWorkspace environmentScopeKey="environment-a" retainPlayerWithoutAnchor>
        <main>Settings</main>
      </AmbientVideoWorkspace>
    </AppAtomRegistryProvider>,
  );
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
  expect(firstFrame?.isConnected).toBe(true);
  expect(
    document.querySelector<HTMLIFrameElement>('iframe[title="Ambient YouTube video player"]'),
  ).toBe(firstFrame);
  await mounted.rerender(
    <AppAtomRegistryProvider>
      <AmbientVideoWorkspace environmentScopeKey="environment-a" retainPlayerWithoutAnchor>
        <main data-settings-revision="2">Settings</main>
      </AmbientVideoWorkspace>
    </AppAtomRegistryProvider>,
  );
  expect(firstFrame?.isConnected).toBe(true);
  expect(
    document.querySelector<HTMLIFrameElement>('iframe[title="Ambient YouTube video player"]'),
  ).toBe(firstFrame);

  // An environment boundary is stronger than route persistence. Even while
  // Settings has no chat anchor, the old frame must be discarded so no
  // controller/playback state crosses server identities. The replacement can
  // wait until the destination environment has a visible chat anchor.
  await mounted.rerender(
    <AppAtomRegistryProvider>
      <AmbientVideoWorkspace environmentScopeKey="environment-b" retainPlayerWithoutAnchor>
        <main>Settings</main>
      </AmbientVideoWorkspace>
    </AppAtomRegistryProvider>,
  );
  expect(firstFrame?.isConnected).toBe(false);
  await mounted.rerender(
    <AppAtomRegistryProvider>
      <AmbientVideoWorkspace environmentScopeKey="environment-b">
        <TestChatAnchor />
      </AmbientVideoWorkspace>
    </AppAtomRegistryProvider>,
  );
  await expect
    .poll(() =>
      document.querySelector<HTMLIFrameElement>('iframe[title="Ambient YouTube video player"]'),
    )
    .not.toBeNull();
  const secondFrame = document.querySelector<HTMLIFrameElement>(
    'iframe[title="Ambient YouTube video player"]',
  );
  expect(secondFrame).not.toBeNull();
  expect(secondFrame).not.toBe(firstFrame);
  expect(secondFrame?.src).toBe(firstFrame?.src);
});

it("keeps one compliant player through portrait, landscape, minimum bounds, and Settings", async () => {
  await page.viewport(390, 844);
  const config = makeConfig({ kind: "video", id: "dQw4w9WgXcQ" });
  setServerConfigSnapshot({
    ...config,
    clientSettings: {
      ...config.clientSettings,
      ambientVideoEnabled: true,
      ambientVideoPresentationMode: "floating",
    },
  });
  mounted = await render(
    <div style={{ display: "flex", width: "390px", height: "844px" }}>
      <AppAtomRegistryProvider>
        <AmbientVideoWorkspace environmentScopeKey="mobile-environment">
          <TestMobileChatAnchor />
        </AmbientVideoWorkspace>
      </AppAtomRegistryProvider>
    </div>,
  );

  await expect
    .poll(() =>
      document.querySelector<HTMLIFrameElement>('iframe[title="Ambient YouTube video player"]'),
    )
    .not.toBeNull();
  const firstFrame = document.querySelector<HTMLIFrameElement>(
    'iframe[title="Ambient YouTube video player"]',
  );
  expect(firstFrame).not.toBeNull();
  await expectPlayerGeometry({
    frame: firstFrame!,
    layout: "mobile-docked",
    viewportWidth: 390,
    viewportHeight: 844,
  });
  expect(firstFrame!.referrerPolicy).toBe("strict-origin-when-cross-origin");
  expect(firstFrame!.allow).toContain("fullscreen");
  expect(firstFrame!.sandbox.contains("allow-scripts")).toBe(true);
  expect(firstFrame!.sandbox.contains("allow-same-origin")).toBe(true);
  expect(firstFrame!.sandbox.contains("allow-presentation")).toBe(true);
  const embedUrl = new URL(firstFrame!.src);
  expect(embedUrl.searchParams.get("playsinline")).toBe("1");
  expect(embedUrl.searchParams.get("origin")).toBe(window.location.origin);

  await page.viewport(844, 390);
  await mounted.rerender(
    <div style={{ display: "flex", width: "844px", height: "390px" }}>
      <AppAtomRegistryProvider>
        <AmbientVideoWorkspace environmentScopeKey="mobile-environment">
          <TestMobileChatAnchor />
        </AmbientVideoWorkspace>
      </AppAtomRegistryProvider>
    </div>,
  );
  expect(
    document.querySelector<HTMLIFrameElement>('iframe[title="Ambient YouTube video player"]'),
  ).toBe(firstFrame);
  await expectPlayerGeometry({
    frame: firstFrame!,
    layout: "floating",
    viewportWidth: 844,
    viewportHeight: 390,
  });

  // At the narrowest legal panel, the two section borders are outside the
  // iframe's own 200x200 viewport. Controls remain inside the same bounded
  // panel and the source key keeps the exact iframe alive through the resize.
  await page.viewport(202, 238);
  await mounted.rerender(
    <div style={{ display: "flex", width: "202px", height: "238px" }}>
      <AppAtomRegistryProvider>
        <AmbientVideoWorkspace environmentScopeKey="mobile-environment">
          <TestMobileChatAnchor />
        </AmbientVideoWorkspace>
      </AppAtomRegistryProvider>
    </div>,
  );
  expect(
    document.querySelector<HTMLIFrameElement>('iframe[title="Ambient YouTube video player"]'),
  ).toBe(firstFrame);
  const minimumPlayer = await expectPlayerGeometry({
    frame: firstFrame!,
    layout: "mobile-docked",
    viewportWidth: 202,
    viewportHeight: 238,
  });
  const disableButton = minimumPlayer.querySelector<HTMLButtonElement>(
    'button[aria-label="Disable ambient video"]',
  );
  expect(disableButton).not.toBeNull();
  const disableRect = disableButton!.getBoundingClientRect();
  expect(disableRect.left).toBeGreaterThanOrEqual(0);
  expect(disableRect.right).toBeLessThanOrEqual(202);

  await page.viewport(390, 844);
  await mounted.rerender(
    <div style={{ display: "flex", width: "390px", height: "844px" }}>
      <AppAtomRegistryProvider>
        <AmbientVideoWorkspace environmentScopeKey="mobile-environment" retainPlayerWithoutAnchor>
          <main>Settings</main>
        </AmbientVideoWorkspace>
      </AppAtomRegistryProvider>
    </div>,
  );
  await waitForTwoAnimationFrames();
  expect(firstFrame?.isConnected).toBe(true);
  expect(
    document.querySelector<HTMLIFrameElement>('iframe[title="Ambient YouTube video player"]'),
  ).toBe(firstFrame);
});

it("keeps narrow-pane rendering YouTube-only and capability-gated", async () => {
  await page.viewport(390, 844);
  const spotifyConfig = makeConfig({
    kind: "spotify",
    entityType: "track",
    id: "4uLU6hMCjMI75M1A2tKUQC",
  });
  setServerConfigSnapshot({
    ...spotifyConfig,
    clientSettings: {
      ...spotifyConfig.clientSettings,
      ambientVideoEnabled: true,
      ambientVideoPresentationMode: "floating",
    },
    ambientExperienceCapabilities: {
      ...spotifyConfig.ambientExperienceCapabilities,
      spotifyEmbed: true,
    },
  });
  mounted = await render(
    <div style={{ display: "flex", width: "390px", height: "844px" }}>
      <AppAtomRegistryProvider>
        <AmbientVideoWorkspace environmentScopeKey="mobile-provider-conditions">
          <TestMobileChatAnchor />
        </AmbientVideoWorkspace>
      </AppAtomRegistryProvider>
    </div>,
  );
  await waitForTwoAnimationFrames();
  expect(
    document.querySelector<HTMLIFrameElement>('iframe[title="Ambient Spotify track player"]'),
  ).toBeNull();

  // The existing wide-pane Spotify behavior is unchanged.
  await page.viewport(900, 600);
  await mounted.rerender(
    <div style={{ display: "flex", width: "900px", height: "600px" }}>
      <AppAtomRegistryProvider>
        <AmbientVideoWorkspace environmentScopeKey="mobile-provider-conditions">
          <TestMobileChatAnchor />
        </AmbientVideoWorkspace>
      </AppAtomRegistryProvider>
    </div>,
  );
  await expect
    .poll(() =>
      document.querySelector<HTMLIFrameElement>('iframe[title="Ambient Spotify track player"]'),
    )
    .not.toBeNull();

  const youtubeConfig = makeConfig({ kind: "video", id: "dQw4w9WgXcQ" });
  setServerConfigSnapshot({
    ...youtubeConfig,
    clientSettings: {
      ...youtubeConfig.clientSettings,
      ambientVideoEnabled: true,
      ambientVideoPresentationMode: "floating",
    },
    ambientExperienceCapabilities: {
      ...youtubeConfig.ambientExperienceCapabilities,
      youtubePlayer: false,
    },
  });
  await page.viewport(390, 844);
  await mounted.rerender(
    <div style={{ display: "flex", width: "390px", height: "844px" }}>
      <AppAtomRegistryProvider>
        <AmbientVideoWorkspace environmentScopeKey="mobile-provider-conditions">
          <TestMobileChatAnchor />
        </AmbientVideoWorkspace>
      </AppAtomRegistryProvider>
    </div>,
  );
  await waitForTwoAnimationFrames();
  expect(document.querySelector("iframe")).toBeNull();
});
