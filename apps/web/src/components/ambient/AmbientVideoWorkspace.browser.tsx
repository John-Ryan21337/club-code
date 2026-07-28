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
});

it("seeds the Japanese URL queue from the normal workspace without opening Settings", async () => {
  setServerConfigSnapshot(makeConfig(null));
  mounted = await render(
    <AppAtomRegistryProvider>
      <AmbientVideoWorkspace>
        <main>Chat workspace</main>
      </AmbientVideoWorkspace>
    </AppAtomRegistryProvider>,
  );

  await expect.poll(() => youtubeUrlQueueStore.getSnapshot().exampleId).toBe("japanese");
  expect(youtubeUrlQueueStore.getSnapshot()).toMatchObject({
    active: true,
    count: 36,
    index: 0,
    currentSource: { kind: "video", id: "blgxfEUgvVU" },
  });
  // Seeding supplies a session queue only. It does not request playback.
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
