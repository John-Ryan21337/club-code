import "../../index.css";
import {
  type AuthAccessStreamEvent,
  type AuthAccessSnapshot,
  AuthSessionId,
  DEFAULT_AMBIENT_EXPERIENCE_CAPABILITIES,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_LM_STUDIO_BASE_URL,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type DesktopBridge,
  type DesktopSourceUpdateState,
  type DesktopUpdateChannel,
  type DesktopUpdateState,
  type LocalApi,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerConfig,
  type ServerProcessResourceHistoryResult,
  type ServerProvider,
  type ServerRuntimeLayerDiagnosticsResult,
  type SourceControlDiscoveryResult,
} from "@cafecode/contracts";
import {
  type ClientSettings,
  MAX_AMBIENT_IMAGE_FILE_BYTES,
  MAX_SIDEBAR_BRAND_IMAGE_FILE_BYTES,
} from "@cafecode/contracts/settings";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import type { ReactNode } from "react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { __resetLocalApiForTests } from "../../localApi";
import { localMediaStore } from "../../localMedia";
import { AppAtomRegistryProvider, resetAppAtomRegistryForTests } from "../../rpc/atomRegistry";
import {
  getServerConfig,
  resetServerStateForTests,
  setServerConfigSnapshot,
} from "../../rpc/serverState";
import { useUiStateStore } from "../../uiStateStore";
import {
  SETTINGS_PROFILE_LIBRARY_STORAGE_KEY,
  settingsProfileLibraryStore,
} from "../../settingsProfiles";
import { youtubeUrlQueueLibraryStore, youtubeUrlQueueStore } from "../../youtubeUrlQueue";
import { toastManager } from "../ui/toast";
import { ConnectionsSettings } from "./ConnectionsSettings";
import { DiagnosticsSettingsPanel } from "./DiagnosticsSettings";
import {
  AppearanceSettingsPanel,
  ChatSettingsPanel,
  FilesSettingsPanel,
  ProviderSettingsPanel,
  SystemSettingsPanel,
  useSettingsRestore,
} from "./SettingsPanels";
import { SourceControlSettingsPanel } from "./SourceControlSettings";

function renderWithTestRouter(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const rootRoute = createRootRoute({
    component: () => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  return render(<RouterProvider router={router} />);
}

const authAccessHarness = vi.hoisted(() => {
  type Snapshot = AuthAccessSnapshot;
  let snapshot: Snapshot = {
    pairingLinks: [],
    clientSessions: [],
  };
  let revision = 1;
  const listeners = new Set<(event: AuthAccessStreamEvent) => void>();

  const emitEvent = (event: AuthAccessStreamEvent) => {
    for (const listener of listeners) {
      listener(event);
    }
  };

  return {
    reset() {
      snapshot = {
        pairingLinks: [],
        clientSessions: [],
      };
      revision = 1;
      listeners.clear();
    },
    setSnapshot(next: Snapshot) {
      snapshot = next;
    },
    emitSnapshot() {
      emitEvent({
        version: 1 as const,
        revision,
        type: "snapshot" as const,
        payload: snapshot,
      });
      revision += 1;
    },
    emitEvent,
    emitPairingLinkUpserted(pairingLink: Snapshot["pairingLinks"][number]) {
      emitEvent({
        version: 1,
        revision,
        type: "pairingLinkUpserted",
        payload: pairingLink,
      });
      revision += 1;
    },
    emitPairingLinkRemoved(id: string) {
      emitEvent({
        version: 1,
        revision,
        type: "pairingLinkRemoved",
        payload: { id },
      });
      revision += 1;
    },
    emitClientUpserted(clientSession: Snapshot["clientSessions"][number]) {
      emitEvent({
        version: 1,
        revision,
        type: "clientUpserted",
        payload: clientSession,
      });
      revision += 1;
    },
    emitClientRemoved(sessionId: string) {
      emitEvent({
        version: 1,
        revision,
        type: "clientRemoved",
        payload: {
          sessionId: AuthSessionId.make(sessionId),
        },
      });
      revision += 1;
    },
    subscribe(listener: (event: AuthAccessStreamEvent) => void) {
      listeners.add(listener);
      listener({
        version: 1,
        revision: 1,
        type: "snapshot",
        payload: snapshot,
      });
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock("../../environments/runtime", () => {
  const primaryConnection = {
    kind: "primary" as const,
    knownEnvironment: {
      id: "environment-local",
      label: "Local environment",
      source: "manual" as const,
      environmentId: EnvironmentId.make("environment-local"),
      target: {
        httpBaseUrl: "http://localhost:3000",
        wsBaseUrl: "ws://localhost:3000",
      },
    },
    environmentId: EnvironmentId.make("environment-local"),
    client: {
      server: {
        subscribeAuthAccess: (listener: Parameters<typeof authAccessHarness.subscribe>[0]) =>
          authAccessHarness.subscribe(listener),
      },
    },
    ensureBootstrapped: async () => undefined,
    reconnect: async () => undefined,
    dispose: async () => undefined,
  };

  return {
    getEnvironmentHttpBaseUrl: () => "http://localhost:3000",
    resolveEnvironmentHttpUrl: (input: { readonly pathname: string }) =>
      new URL(input.pathname, "http://localhost:3000").toString(),
    ensureEnvironmentConnectionBootstrapped: async () => undefined,
    getPrimaryEnvironmentConnection: () => primaryConnection,
    readEnvironmentConnection: () => primaryConnection,
    requireEnvironmentConnection: () => primaryConnection,
    resetEnvironmentServiceForTests: () => undefined,
    startEnvironmentConnectionService: () => undefined,
    subscribeEnvironmentConnections: () => () => {},
  };
});

function createBaseServerConfig(): ServerConfig {
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
    clientSettings: { ...DEFAULT_CLIENT_SETTINGS, onboardingCompleted: true },
    ambientExperienceCapabilities: DEFAULT_AMBIENT_EXPERIENCE_CAPABILITIES,
  };
}

function createOutdatedProvider(
  driver: string,
  updateCommand = "npm install -g openai/codex@latest",
): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(driver),
    driver: ProviderDriverKind.make(driver),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-05-04T10:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    versionAdvisory: {
      status: "behind_latest",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      approvedVersion: null,
      message: "Update available.",
      checkedAt: "2026-05-04T10:00:00.000Z",
      updateCommand,
      canUpdate: true,
    },
  };
}

function makeUtc(value: string) {
  return DateTime.makeUnsafe(value);
}

function createEmptyProcessResourceHistoryResult(): ServerProcessResourceHistoryResult {
  return {
    readAt: makeUtc("2036-04-07T00:00:00.000Z"),
    windowMs: 15 * 60_000,
    bucketMs: 60_000,
    sampleIntervalMs: 5_000,
    retainedSampleCount: 0,
    totalCpuSecondsApprox: 0,
    buckets: [],
    topProcesses: [],
    error: Option.none(),
  };
}

function createRuntimeLayerDiagnosticsResult(): ServerRuntimeLayerDiagnosticsResult {
  return {
    readAt: "2036-04-07T00:00:00.000Z",
    platform: "darwin",
    windowMs: 15 * 60_000,
    bucketMs: 60_000,
    collectionSource: "test",
    partialFailure: false,
    runtimeLayers: [
      {
        role: "backend",
        status: "online",
        pid: 1234,
        rssBytes: 1024,
        cpuPercent: 1,
        uptimeLabel: "00:10",
        lastEventAt: "2036-04-07T00:00:00.000Z",
        notes: ["Main backend process."],
      },
      {
        role: "provider-daemon",
        status: "online",
        pid: 5678,
        rssBytes: 2048,
        cpuPercent: 2,
        uptimeLabel: "00:05",
        lastEventAt: "2036-04-07T00:00:00.000Z",
        notes: ["Provider daemon health summary."],
      },
      {
        role: "provider-supervisor",
        status: "not-configured",
        pid: null,
        rssBytes: 0,
        cpuPercent: 0,
        uptimeLabel: null,
        lastEventAt: null,
        notes: ["Optional provider supervisor is not configured; providers run in the daemon."],
      },
    ],
    orchestrator: {
      latestEventSequence: 10,
      projectionSequence: 10,
      projectionLag: 0,
      commandQueueDepth: 0,
      acceptedCommandCount: 1,
      rejectedCommandCount: 0,
      failedCommandCount: 0,
      projectCount: 1,
      threadCount: 1,
      pendingTurnCount: 0,
      runningTurnCount: 0,
      activeTurnCount: 0,
      recentEventTypeCounts: [
        {
          eventType: "thread.message-sent",
          actorKind: "provider",
          count: 1,
          lastSeenAt: "2036-04-07T00:00:00.000Z",
        },
      ],
      projectorCursors: [
        {
          projector: "thread-detail",
          cursor: 10,
          lag: 0,
          updatedAt: "2036-04-07T00:00:00.000Z",
          status: "online",
        },
      ],
      providerRuntimeIngestion: {
        cursor: 10,
        daemonEventCursor: 10,
        lag: 0,
        updatedAt: "2036-04-07T00:00:00.000Z",
        lastDaemonEventAt: "2036-04-07T00:00:00.000Z",
        status: "online",
      },
      staleStateFlags: [],
    },
    subprocesses: [
      {
        role: "provider-daemon",
        ownerKind: "daemon-marker",
        pid: 5678,
        ppid: 1,
        status: "S",
        cpuPercent: 2,
        rssBytes: 2048,
        elapsed: "00:05",
        commandLabel: "node",
        sanitizedCommand: "node daemon.mjs",
        depth: 0,
        childPids: [],
        attribution: "daemon health PID",
        lastSeenAt: "2036-04-07T00:00:00.000Z",
        notes: [],
      },
    ],
    providerDaemon: {
      available: true,
      reachable: true,
      status: "online",
      pid: 5678,
      ppid: 1,
      mode: "provider-daemon",
      transport: "loopback-tcp",
      healthLatencyMs: 2,
      startedAt: "2036-04-07T00:00:00.000Z",
      activeSessionCount: 1,
      activeStreamCount: 0,
      retainedEventCount: 2,
      eventCursor: 4,
      leaseCount: 0,
      commandCount: 1,
      runningCommandCount: 0,
      completedCommandCount: 1,
      failedCommandCount: 0,
      totalRpcCount: 3,
      failedRpcCount: 0,
      maxRpcDurationMs: 5,
      meanRpcDurationMs: 2,
      sqliteBusyTimeoutMs: 5_000,
      recentCommands: [],
      runtimeEventSummaries: [],
      error: null,
    },
    providerSupervisor: {
      configured: false,
      reachable: false,
      status: "not-configured",
      pid: null,
      ppid: null,
      transport: null,
      healthLatencyMs: null,
      activeSessionCount: 0,
      activeStreamCount: 0,
      retainedEventCount: 0,
      commandCount: 0,
      runningCommandCount: 0,
      completedCommandCount: 0,
      failedCommandCount: 0,
      sessionCounts: {},
      error: null,
    },
    resources: {
      sampleIntervalMs: 0,
      retainedSampleCount: 1,
      buckets: [],
      processes: [
        {
          processKey: "provider-daemon:5678:node",
          role: "provider-daemon",
          pid: 5678,
          currentRssBytes: 2048,
          maxRssBytes: 2048,
          currentCpuPercent: 2,
          avgCpuPercent: 2,
          maxCpuPercent: 2,
          sampleCount: 1,
          lastSeenAt: "2036-04-07T00:00:00.000Z",
        },
      ],
    },
    errors: [],
  };
}

function makePairingLink(input: {
  readonly id: string;
  readonly credential: string;
  readonly role: "owner" | "client";
  readonly subject: string;
  readonly label?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}): AuthAccessSnapshot["pairingLinks"][number] {
  return {
    ...input,
    createdAt: makeUtc(input.createdAt),
    expiresAt: makeUtc(input.expiresAt),
  };
}

function makeClientSession(input: {
  readonly sessionId: string;
  readonly subject: string;
  readonly role: "owner" | "client";
  readonly method: "browser-session-cookie";
  readonly client?: {
    readonly label?: string;
    readonly ipAddress?: string;
    readonly userAgent?: string;
    readonly deviceType?: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
    readonly os?: string;
    readonly browser?: string;
  };
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastConnectedAt?: string | null;
  readonly connected: boolean;
  readonly current: boolean;
}): AuthAccessSnapshot["clientSessions"][number] {
  return {
    ...input,
    client: {
      deviceType: "unknown",
      ...input.client,
    },
    sessionId: AuthSessionId.make(input.sessionId),
    issuedAt: makeUtc(input.issuedAt),
    expiresAt: makeUtc(input.expiresAt),
    lastConnectedAt:
      input.lastConnectedAt === undefined || input.lastConnectedAt === null
        ? null
        : makeUtc(input.lastConnectedAt),
  };
}

const createDesktopBridgeStub = (overrides?: {
  readonly serverExposureState?: Awaited<ReturnType<DesktopBridge["getServerExposureState"]>>;
  readonly advertisedEndpoints?: Awaited<ReturnType<DesktopBridge["getAdvertisedEndpoints"]>>;
  readonly setServerExposureMode?: DesktopBridge["setServerExposureMode"];
  readonly setServerHttpsEnabled?: DesktopBridge["setServerHttpsEnabled"];
  readonly setUpdateChannel?: DesktopBridge["setUpdateChannel"];
  readonly sourceUpdateState?: DesktopSourceUpdateState;
  readonly checkSourceUpdate?: DesktopBridge["checkSourceUpdate"];
  readonly getWindowOpacityState?: DesktopBridge["getWindowOpacityState"];
  readonly setWindowOpacityPreference?: DesktopBridge["setWindowOpacityPreference"];
}): DesktopBridge => {
  const idleUpdateState: DesktopUpdateState = {
    enabled: false,
    status: "idle",
    channel: "latest",
    installMode: "in-app",
    currentVersion: "0.0.0-test",
    hostArch: "arm64",
    appArch: "arm64",
    runningUnderArm64Translation: false,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: false,
  };
  const sourceUpdateState: DesktopSourceUpdateState = overrides?.sourceUpdateState ?? {
    status: "ignored",
    branch: "feature-test",
    trackedBranch: null,
    runtimeHash: "abc123",
    localHash: "abc123",
    remoteHash: null,
    mergeBaseHash: null,
    dirty: false,
    checkedAt: "2026-01-01T00:00:00.000Z",
    message: "Only branches main and dev are tracked.",
  };

  return {
    getAppBranding: vi.fn().mockReturnValue(null),
    getLocalEnvironmentBootstrap: () => ({
      label: "Local environment",
      httpBaseUrl: "http://127.0.0.1:3773",
      wsBaseUrl: "ws://127.0.0.1:3773",
      bootstrapToken: "desktop-bootstrap-token",
    }),
    getDebugEndpointState: vi.fn().mockResolvedValue({ enabled: false, url: null }),
    publishDebugSnapshot: vi.fn().mockResolvedValue(undefined),
    getClientSettings: vi.fn().mockResolvedValue(null),
    setClientSettings: vi.fn().mockResolvedValue(undefined),
    setPowerSaveBlockerState: vi.fn().mockResolvedValue(undefined),
    getSavedEnvironmentRegistry: vi.fn().mockResolvedValue([]),
    setSavedEnvironmentRegistry: vi.fn().mockResolvedValue(undefined),
    getSavedEnvironmentSecret: vi.fn().mockResolvedValue(null),
    setSavedEnvironmentSecret: vi.fn().mockResolvedValue(true),
    removeSavedEnvironmentSecret: vi.fn().mockResolvedValue(undefined),
    getServerExposureState: vi.fn().mockResolvedValue(
      overrides?.serverExposureState ?? {
        mode: "local-only",
        httpsEnabled: true,
        endpointUrl: null,
        advertisedHost: null,
      },
    ),
    setServerExposureMode:
      overrides?.setServerExposureMode ??
      vi.fn().mockImplementation(async (mode) => ({
        mode,
        httpsEnabled: true,
        endpointUrl: mode === "network-accessible" ? "http://192.168.1.44:3773" : null,
        advertisedHost: mode === "network-accessible" ? "192.168.1.44" : null,
      })),
    setServerHttpsEnabled:
      overrides?.setServerHttpsEnabled ??
      vi.fn().mockImplementation(async (httpsEnabled) => ({
        mode: "local-only",
        httpsEnabled,
        endpointUrl: null,
        advertisedHost: null,
      })),
    getAdvertisedEndpoints: vi.fn().mockResolvedValue(overrides?.advertisedEndpoints ?? []),
    getWindowOpacityState:
      overrides?.getWindowOpacityState ??
      vi.fn().mockResolvedValue({
        supported: false,
        enabled: false,
        opacity: 1,
        effectiveOpacity: 1,
        reason: "unsupported-platform",
      }),
    setWindowOpacityPreference:
      overrides?.setWindowOpacityPreference ??
      vi.fn().mockImplementation(async ({ opacity }) => ({
        supported: false,
        enabled: false,
        opacity,
        effectiveOpacity: 1,
        reason: "unsupported-platform",
      })),
    pickFolder: vi.fn().mockResolvedValue(null),
    getLocalMediaCapability: vi.fn().mockResolvedValue({
      available: false,
      engine: { label: "VLC", version: null, reason: "Unavailable in browser tests." },
    }),
    pickLocalMedia: vi.fn().mockResolvedValue(null),
    releaseLocalMedia: vi.fn().mockResolvedValue(false),
    openEmbeddedBrowser: vi.fn().mockRejectedValue(new Error("Not implemented in settings test")),
    closeEmbeddedBrowser: vi.fn().mockRejectedValue(new Error("Not implemented in settings test")),
    setEmbeddedBrowserBounds: vi
      .fn()
      .mockRejectedValue(new Error("Not implemented in settings test")),
    shareEmbeddedBrowser: vi.fn().mockRejectedValue(new Error("Not implemented in settings test")),
    navigateEmbeddedBrowser: vi
      .fn()
      .mockRejectedValue(new Error("Not implemented in settings test")),
    controlEmbeddedBrowserHistory: vi
      .fn()
      .mockRejectedValue(new Error("Not implemented in settings test")),
    snapshotEmbeddedBrowser: vi.fn().mockResolvedValue(null),
    clickEmbeddedBrowser: vi.fn().mockRejectedValue(new Error("Not implemented in settings test")),
    typeInEmbeddedBrowser: vi.fn().mockRejectedValue(new Error("Not implemented in settings test")),
    onEmbeddedBrowserState: () => () => undefined,
    confirm: vi.fn().mockResolvedValue(false),
    setTheme: vi.fn().mockResolvedValue(undefined),
    showContextMenu: vi.fn().mockResolvedValue(null),
    openExternal: vi.fn().mockResolvedValue(true),
    openPath: vi.fn().mockResolvedValue(true),
    revealPath: vi.fn().mockResolvedValue(true),
    onMenuAction: () => () => {},
    getUpdateState: vi.fn().mockResolvedValue(idleUpdateState),
    setUpdateChannel:
      overrides?.setUpdateChannel ??
      vi.fn().mockImplementation(async (channel: DesktopUpdateChannel) => ({
        ...idleUpdateState,
        channel,
      })),
    checkForUpdate: vi.fn().mockResolvedValue({ checked: false, state: idleUpdateState }),
    downloadUpdate: vi
      .fn()
      .mockResolvedValue({ accepted: false, completed: false, state: idleUpdateState }),
    installUpdate: vi
      .fn()
      .mockResolvedValue({ accepted: false, completed: false, state: idleUpdateState }),
    onUpdateState: () => () => {},
    getSourceUpdateState: vi.fn().mockResolvedValue(sourceUpdateState),
    checkSourceUpdate: overrides?.checkSourceUpdate ?? vi.fn().mockResolvedValue(sourceUpdateState),
    onSourceUpdateState: () => () => {},
  };
};

function installClientSettingsNativeApi(desktopBridge: DesktopBridge) {
  const updateSettings = vi
    .fn<LocalApi["server"]["updateSettings"]>()
    .mockResolvedValue(DEFAULT_SERVER_SETTINGS);
  const updateClientSettings = vi
    .fn<LocalApi["server"]["updateClientSettings"]>()
    .mockResolvedValue(DEFAULT_CLIENT_SETTINGS);
  window.nativeApi = {
    dialogs: {
      pickFolder: desktopBridge.pickFolder,
      confirm: desktopBridge.confirm,
    },
    persistence: {
      getClientSettings: desktopBridge.getClientSettings,
      setClientSettings: desktopBridge.setClientSettings,
    },
    server: {
      updateSettings,
      updateClientSettings,
    },
    shell: {
      openExternal: async (url: string) => {
        const opened = await desktopBridge.openExternal(url);
        if (!opened) throw new Error("Unable to open link.");
      },
    },
  } as unknown as LocalApi;
  return { updateSettings, updateClientSettings };
}

function SettingsRestoreHarness({ onRestored }: { readonly onRestored: () => void }) {
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(onRestored);
  return (
    <>
      <output aria-label="Changed settings">{changedSettingLabels.join(" | ")}</output>
      <button type="button" onClick={() => void restoreDefaults()}>
        Apply settings reset
      </button>
    </>
  );
}

function setColorInput(ariaLabel: string, value: string) {
  const input = document.querySelector(
    `input[aria-label="${ariaLabel}"]`,
  ) as HTMLInputElement | null;
  expect(input).not.toBeNull();
  const inputValueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  inputValueSetter?.call(input, value);
  input!.dispatchEvent(new Event("input", { bubbles: true }));
  input!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

describe("settings panels", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  beforeEach(async () => {
    resetServerStateForTests();
    await __resetLocalApiForTests();
    localMediaStore.clear();
    localStorage.clear();
    settingsProfileLibraryStore.resetForTests();
    youtubeUrlQueueLibraryStore.resetForTests();
    useUiStateStore.setState({ defaultAdvertisedEndpointKey: null });
    authAccessHarness.reset();
  });

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window, "desktopBridge");
    Reflect.deleteProperty(window, "nativeApi");
    document.body.innerHTML = "";
    settingsProfileLibraryStore.resetForTests();
    youtubeUrlQueueLibraryStore.resetForTests();
    resetServerStateForTests();
    await __resetLocalApiForTests();
    localMediaStore.clear();
    authAccessHarness.reset();
  });

  it("keeps ambient image folder selection unavailable outside the desktop shell", async () => {
    setServerConfigSnapshot(createBaseServerConfig());
    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );
    await expect.element(page.getByText("Image folder cycling")).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Image-folder cycling is available in the Club Code desktop app. Browser sessions keep single-image upload only.",
        ),
      )
      .toBeInTheDocument();
    expect(document.querySelector('input[aria-label="Ambient image folder"]')).toBeNull();
  });

  it("hides owner pairing tools in browser-served loopback builds without remote exposure", async () => {
    Reflect.deleteProperty(window, "desktopBridge");
    authAccessHarness.setSnapshot({
      pairingLinks: [],
      clientSessions: [
        makeClientSession({
          sessionId: "session-owner",
          subject: "browser-owner",
          role: "owner",
          method: "browser-session-cookie",
          client: {
            label: "Chrome on Mac",
            deviceType: "desktop",
            os: "macOS",
            browser: "Chrome",
            ipAddress: "127.0.0.1",
          },
          issuedAt: "2036-04-07T00:00:00.000Z",
          expiresAt: "2036-05-07T00:00:00.000Z",
          connected: true,
          current: true,
        }),
      ],
    });
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/auth/session")) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            auth: createBaseServerConfig().auth,
            role: "owner",
            sessionMethod: "browser-session-cookie",
            expiresAt: "2036-05-07T00:00:00.000Z",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      throw new Error(`Unhandled fetch GET ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Manage local backend")).toBeInTheDocument();
    await expect.element(page.getByLabelText("Enable network access")).toBeDisabled();
    await expect
      .element(
        page.getByText(
          "This backend is only reachable on this machine. Restart it with a non-loopback host to enable remote pairing.",
        ),
      )
      .toBeInTheDocument();
    await expect.element(page.getByText("Authorized clients")).not.toBeInTheDocument();
    await expect.element(page.getByText("Chrome on Mac")).not.toBeInTheDocument();
  });

  it("hides advertised endpoint rows when desktop network access is disabled", async () => {
    window.desktopBridge = createDesktopBridgeStub({
      serverExposureState: {
        mode: "local-only",
        httpsEnabled: true,
        endpointUrl: null,
        advertisedHost: null,
      },
      advertisedEndpoints: [
        {
          id: "loopback",
          label: "This machine",
          provider: {
            id: "desktop-core",
            label: "Desktop",
            kind: "manual",
            isAddon: false,
          },
          httpBaseUrl: "http://127.0.0.1:3773/",
          wsBaseUrl: "ws://127.0.0.1:3773/",
          reachability: "loopback",
          source: "desktop-core",
          status: "available",
          isDefault: true,
        },
      ],
    });
    authAccessHarness.setSnapshot({
      pairingLinks: [],
      clientSessions: [],
    });
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Limited to this machine.")).toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "This machine", exact: true }))
      .not.toBeInTheDocument();
  });

  it("shows advertised endpoints by default and lets users hide them", async () => {
    window.desktopBridge = createDesktopBridgeStub({
      serverExposureState: {
        mode: "network-accessible",
        httpsEnabled: true,
        endpointUrl: "http://192.168.86.39:3773",
        advertisedHost: "192.168.86.39",
      },
      advertisedEndpoints: [
        {
          id: "desktop-loopback:3773",
          label: "This machine",
          provider: {
            id: "desktop-core",
            label: "Desktop",
            kind: "manual",
            isAddon: false,
          },
          httpBaseUrl: "http://127.0.0.1:3773/",
          wsBaseUrl: "ws://127.0.0.1:3773/",
          reachability: "loopback",
          source: "desktop-core",
          status: "available",
        },
        {
          id: "desktop-lan:http://192.168.86.39:3773",
          label: "Local network",
          provider: {
            id: "desktop-core",
            label: "Desktop",
            kind: "manual",
            isAddon: false,
          },
          httpBaseUrl: "http://192.168.86.39:3773/",
          wsBaseUrl: "ws://192.168.86.39:3773/",
          reachability: "lan",
          source: "desktop-core",
          status: "available",
          isDefault: true,
        },
      ],
    });
    authAccessHarness.setSnapshot({
      pairingLinks: [],
      clientSessions: [],
    });
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("http://192.168.86.39:3773/").first()).toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Local network", exact: true }))
      .toBeInTheDocument();

    await page.getByRole("button", { name: "Hide" }).click();

    await expect
      .element(page.getByRole("heading", { name: "Local network", exact: true }))
      .not.toBeInTheDocument();
    await page.getByRole("button", { name: "+1" }).click();
    await expect
      .element(page.getByRole("heading", { name: "Local network", exact: true }))
      .toBeInTheDocument();
    await page.getByRole("button", { name: "Set as default" }).first().click();
    await expect.element(page.getByText("http://127.0.0.1:3773/").first()).toBeInTheDocument();
  });

  it("shows diagnostics inside About with a diagnostics link", async () => {
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <SystemSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("About")).toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Alpha software / アルファ版", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByText(/Club Code is alpha\/testing software/))
      .toBeInTheDocument();
    await expect
      .element(page.getByText(/現在テスト中のアルファ版ソフトウェアです/))
      .toBeInTheDocument();
    const disclaimer = document.querySelector('[data-alpha-software-disclaimer="true"]');
    expect(disclaimer).not.toBeNull();
    expect(disclaimer?.querySelectorAll("p")).toHaveLength(0);
    expect(disclaimer?.querySelector('[lang="en"]')).not.toBeNull();
    expect(disclaimer?.querySelector('[lang="ja"]')).not.toBeNull();
    await expect
      .element(page.getByRole("heading", { name: "Diagnostics", exact: true }))
      .toBeInTheDocument();
    await expect.element(page.getByRole("link", { name: "View diagnostics" })).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Local trace file. Exporting OTEL traces to http://localhost:4318/v1/traces.",
        ),
      )
      .toBeInTheDocument();
  });

  it("shows source branch update status in About and refreshes it on demand", async () => {
    const checkSourceUpdate = vi.fn().mockResolvedValue({
      status: "behind",
      branch: "dev",
      trackedBranch: "dev",
      runtimeHash: "1111111111111111111111111111111111111111",
      localHash: "1111111111111111111111111111111111111111",
      remoteHash: "2222222222222222222222222222222222222222",
      mergeBaseHash: "1111111111111111111111111111111111111111",
      dirty: true,
      checkedAt: "2026-01-01T00:00:00.000Z",
      message: "A newer dev commit is available at 222222222222.",
    } satisfies DesktopSourceUpdateState);
    window.desktopBridge = createDesktopBridgeStub({
      sourceUpdateState: {
        status: "behind",
        branch: "dev",
        trackedBranch: "dev",
        runtimeHash: "1111111111111111111111111111111111111111",
        localHash: "1111111111111111111111111111111111111111",
        remoteHash: "2222222222222222222222222222222222222222",
        mergeBaseHash: "1111111111111111111111111111111111111111",
        dirty: true,
        checkedAt: "2026-01-01T00:00:00.000Z",
        message: "A newer dev commit is available at 222222222222.",
      },
      checkSourceUpdate,
    });
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <SystemSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("(dev branch)", { exact: false })).toBeInTheDocument();
    await expect.element(page.getByText("Current: 111111111111 (dirty)")).toBeInTheDocument();
    await expect.element(page.getByText("Running build: 111111111111")).toBeInTheDocument();
    await expect.element(page.getByText("Latest origin/dev: 222222222222")).toBeInTheDocument();
    await expect
      .element(page.getByText("Newer dev commit available: 222222222222"))
      .toBeInTheDocument();

    await page.getByRole("button", { name: "Check for Updates" }).click();
    await vi.waitFor(() => {
      expect(checkSourceUpdate).toHaveBeenCalledTimes(1);
    });
  });

  it("shows rebuild-required source status when the running build hash is stale", async () => {
    window.desktopBridge = createDesktopBridgeStub({
      sourceUpdateState: {
        status: "current",
        branch: "dev",
        trackedBranch: "dev",
        runtimeHash: "1111111111111111111111111111111111111111",
        localHash: "2222222222222222222222222222222222222222",
        remoteHash: "2222222222222222222222222222222222222222",
        mergeBaseHash: "2222222222222222222222222222222222222222",
        dirty: false,
        checkedAt: "2026-01-01T00:00:00.000Z",
        message: "This checkout is current with origin.",
      },
    });
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <SystemSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Current: 222222222222 (clean)")).toBeInTheDocument();
    await expect.element(page.getByText("Running build: 111111111111")).toBeInTheDocument();
    await expect.element(page.getByText("Rebuild to apply (dev)")).toBeInTheDocument();
  });

  it("persists the keep-awake preference from System settings", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <SystemSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Keep awake")).toBeInTheDocument();
    await page.getByLabelText("Keep awake").click();

    await page.getByText("During chats", { exact: true }).click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ powerSaveBlockerMode: "during-chats" });
    });
  });

  it("persists the chat selection copy preference from Chat settings", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <ChatSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Chat selection copy")).toBeInTheDocument();
    await expect.element(page.getByText("Markdown", { exact: true })).toBeInTheDocument();
    await page.getByLabelText("Chat selection copy format").click();
    await page.getByText("Plain text", { exact: true }).click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ chatCopyFormat: "plainText" });
    });
  });

  it("saves and switches persistent local settings profiles in one action", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const nameInput = page.getByLabelText("Settings profile name");
    await nameInput.fill("Mobile");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.element(page.getByText("Saved “Mobile”.", { exact: true })).toBeInTheDocument();

    await page.getByLabelText("Keep animations running in background").click();
    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({
        continueBackgroundAnimations: true,
      });
    });
    await page.getByLabelText("Theme preference").click();
    await page.getByText("Light", { exact: true }).click();

    await nameInput.fill("Desktop");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.element(page.getByText("Saved “Desktop”.", { exact: true })).toBeInTheDocument();

    await page.getByRole("combobox", { name: "Active settings profile" }).click();
    await page.getByRole("option", { name: "Mobile" }).click();

    await vi.waitFor(() => {
      const profilePatch = updateClientSettings.mock.calls.at(-1)?.[0];
      expect(profilePatch).toMatchObject({
        continueBackgroundAnimations: false,
      });
      expect(profilePatch).not.toHaveProperty("autoNudgeMode");
      expect(profilePatch).not.toHaveProperty("providerModelPreferences");
      expect(profilePatch).not.toHaveProperty("modelPacingEnabled");
    });
    await expect.element(page.getByText("Loaded “Mobile”.", { exact: true })).toBeInTheDocument();
    await expect.element(page.getByLabelText("Theme preference")).toHaveTextContent("Dark");

    // The active select cannot emit its current value. A dedicated Reload action
    // lets the user discard later edits without switching through another profile.
    await page.getByLabelText("Keep animations running in background").click();
    await vi.waitFor(() => {
      expect(updateClientSettings.mock.calls.at(-1)?.[0]).toEqual({
        continueBackgroundAnimations: true,
      });
    });
    await page.getByRole("button", { name: "Reload active settings profile" }).click();
    await vi.waitFor(() => {
      expect(updateClientSettings.mock.calls.at(-1)?.[0]).toMatchObject({
        continueBackgroundAnimations: false,
      });
    });

    await page.getByLabelText("Keep animations running in background").click();
    await page.getByRole("button", { name: "Update active" }).click();
    await expect.element(page.getByText("Updated “Mobile”.", { exact: true })).toBeInTheDocument();
    await page.getByLabelText("Keep animations running in background").click();
    await page.getByRole("button", { name: "Reload active settings profile" }).click();
    await vi.waitFor(() => {
      expect(updateClientSettings.mock.calls.at(-1)?.[0]).toMatchObject({
        continueBackgroundAnimations: true,
      });
    });

    const persistedProfiles = JSON.parse(
      localStorage.getItem(SETTINGS_PROFILE_LIBRARY_STORAGE_KEY) ?? "{}",
    );
    expect(persistedProfiles.activeProfileId).toBe("profile:mobile");
    expect(persistedProfiles.profiles.map((profile: { name: string }) => profile.name)).toEqual([
      "Mobile",
      "Desktop",
    ]);
  });

  it("rolls the theme back and keeps the prior active profile when loading settings fails", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const nameInput = page.getByLabelText("Settings profile name");
    await nameInput.fill("Mobile");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByLabelText("Keep animations running in background").click();
    await page.getByLabelText("Theme preference").click();
    await page.getByText("Light", { exact: true }).click();
    await nameInput.fill("Desktop");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    const localSettingsWrite = vi.mocked(desktopBridge.setClientSettings);
    localSettingsWrite.mockClear();
    updateClientSettings.mockRejectedValueOnce(new Error("profile write failed"));
    await page.getByRole("combobox", { name: "Active settings profile" }).click();
    await page.getByRole("option", { name: "Mobile" }).click();

    await expect
      .element(page.getByText("profile write failed", { exact: true }))
      .toBeInTheDocument();
    await expect.element(page.getByLabelText("Theme preference")).toHaveTextContent("Light");
    await expect
      .element(page.getByLabelText("Keep animations running in background"))
      .toBeChecked();
    // Mobile presentation is renderer-local and is part of every captured
    // profile. A rejected shared write must stop before that local document is
    // persisted, otherwise the switch would be partial across a restart.
    expect(localSettingsWrite).not.toHaveBeenCalled();
    expect(settingsProfileLibraryStore.getSnapshot().activeProfileId).toBe("profile:desktop");
  });

  it("restores shared preferences when renderer-local profile persistence fails", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const nameInput = page.getByLabelText("Settings profile name");
    await nameInput.fill("Mobile");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByLabelText("Keep animations running in background").click();
    await page.getByLabelText("Theme preference").click();
    await page.getByText("Light", { exact: true }).click();
    await nameInput.fill("Desktop");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    updateClientSettings.mockClear();
    const localSettingsWrite = vi.mocked(desktopBridge.setClientSettings);
    localSettingsWrite.mockClear();
    localSettingsWrite.mockRejectedValueOnce(new Error("local profile write failed"));

    await page.getByRole("combobox", { name: "Active settings profile" }).click();
    await page.getByRole("option", { name: "Mobile" }).click();

    await expect
      .element(page.getByText("local profile write failed", { exact: true }))
      .toBeInTheDocument();
    expect(updateClientSettings).toHaveBeenCalledTimes(2);
    expect(updateClientSettings.mock.calls[0]?.[0]).toMatchObject({
      continueBackgroundAnimations: false,
    });
    expect(updateClientSettings.mock.calls[1]?.[0]).toMatchObject({
      continueBackgroundAnimations: true,
    });
    expect(localSettingsWrite).toHaveBeenCalledOnce();
    await expect.element(page.getByLabelText("Theme preference")).toHaveTextContent("Light");
    await expect
      .element(page.getByLabelText("Keep animations running in background"))
      .toBeChecked();
    expect(getServerConfig()?.clientSettings.continueBackgroundAnimations).toBe(true);
    expect(settingsProfileLibraryStore.getSnapshot().activeProfileId).toBe("profile:desktop");
  });

  it("reports when a renderer-local failure cannot restore the committed shared profile patch", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const nameInput = page.getByLabelText("Settings profile name");
    await nameInput.fill("Mobile");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByLabelText("Keep animations running in background").click();
    await nameInput.fill("Desktop");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    updateClientSettings.mockClear();
    updateClientSettings
      .mockResolvedValueOnce(DEFAULT_CLIENT_SETTINGS)
      .mockRejectedValueOnce(new Error("profile rollback unavailable"));
    vi.mocked(desktopBridge.setClientSettings).mockRejectedValueOnce(
      new Error("local profile write failed"),
    );

    await page.getByRole("combobox", { name: "Active settings profile" }).click();
    await page.getByRole("option", { name: "Mobile" }).click();

    await expect
      .element(
        page.getByText(
          "local profile write failed The prior shared settings could not be restored: profile rollback unavailable",
          { exact: true },
        ),
      )
      .toBeInTheDocument();
    expect(updateClientSettings).toHaveBeenCalledTimes(2);
    expect(settingsProfileLibraryStore.getSnapshot().activeProfileId).toBe("profile:desktop");
  });

  it("refreshes the visible profile library after another window changes local storage", async () => {
    setServerConfigSnapshot(createBaseServerConfig());
    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    localStorage.setItem(
      SETTINGS_PROFILE_LIBRARY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeProfileId: "profile:mobile",
        profiles: [
          {
            name: "Mobile",
            theme: "dark",
            clientSettings: { sidebarThreadPreviewCount: 2 },
            createdAt: "2026-07-29T08:00:00.000Z",
            updatedAt: "2026-07-29T08:00:00.000Z",
          },
        ],
      }),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: SETTINGS_PROFILE_LIBRARY_STORAGE_KEY,
      }),
    );

    await expect
      .element(page.getByRole("combobox", { name: "Active settings profile" }))
      .toHaveTextContent("Mobile");
  });

  it("persists appearance preferences from Appearance settings", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Accent color")).toBeInTheDocument();
    setColorInput("Branding prefix", "Acme");

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ brandWordmarkPrefix: "Acme" });
    });

    const uploadFetch = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/api/branding/sidebar-image") && init?.method === "POST") {
        expect(init.body).toBeInstanceOf(File);
        expect(init.headers).toMatchObject({ "content-type": "image/png" });
        return new Response(
          JSON.stringify({
            sidebarBrandImage: {
              id: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
              url: "/api/branding/sidebar-image/sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
              mimeType: "image/png",
              width: 128,
              height: 160,
              sizeBytes: 1234,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.endsWith("/api/ambient-media/image") && init?.method === "POST") {
        const file = init.body as File;
        const digest = file.name.startsWith("second") ? "b".repeat(64) : "a".repeat(64);
        const extension = file.type === "image/gif" ? "gif" : "png";
        return new Response(
          JSON.stringify({
            ambientImage: {
              id: `sha256-${digest}.${extension}`,
              url: `/api/ambient-media/image/sha256-${digest}.${extension}`,
              mimeType: file.type,
              width: 128,
              height: 128,
              sizeBytes: file.size,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      throw new Error(`Unhandled fetch ${url}`);
    });
    vi.stubGlobal("fetch", uploadFetch);

    await expect.element(page.getByRole("heading", { name: "Sidebar image" })).toBeInTheDocument();
    const imageInput = document.querySelector(
      'input[aria-label="Sidebar image file"]',
    ) as HTMLInputElement | null;
    expect(imageInput).not.toBeNull();
    Object.defineProperty(imageInput, "files", {
      configurable: true,
      value: [new File(["image"], "brand.png", { type: "image/png" })],
    });
    imageInput!.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          sidebarBrandImage: {
            id: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
            url: "/api/branding/sidebar-image/sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png",
            mimeType: "image/png",
            width: 128,
            height: 160,
            sizeBytes: 1234,
          },
          sidebarBrandImageDataUrl: "",
        }),
      );
    });
    expect(uploadFetch).toHaveBeenCalledTimes(1);

    const callsBeforeUnsupportedImage = updateClientSettings.mock.calls.length;
    Object.defineProperty(imageInput, "files", {
      configurable: true,
      value: [new File(["<svg />"], "brand.svg", { type: "image/svg+xml" })],
    });
    imageInput!.dispatchEvent(new Event("change", { bubbles: true }));

    await expect
      .element(page.getByText("Choose a PNG, JPEG, GIF, or WebP image."))
      .toBeInTheDocument();
    expect(updateClientSettings).toHaveBeenCalledTimes(callsBeforeUnsupportedImage);

    const callsBeforeOversizedImage = updateClientSettings.mock.calls.length;
    Object.defineProperty(imageInput, "files", {
      configurable: true,
      value: [
        new File([new Uint8Array(MAX_SIDEBAR_BRAND_IMAGE_FILE_BYTES + 1)], "brand.png", {
          type: "image/png",
        }),
      ],
    });
    imageInput!.dispatchEvent(new Event("change", { bubbles: true }));

    await expect.element(page.getByText("Choose an image under 1 MB.")).toBeInTheDocument();
    expect(updateClientSettings).toHaveBeenCalledTimes(callsBeforeOversizedImage);

    const ambientImageInput = document.querySelector(
      'input[aria-label="Ambient image file"]',
    ) as HTMLInputElement | null;
    expect(ambientImageInput).not.toBeNull();
    const oversizedAmbientImage = new File([], "ambient.gif", { type: "image/gif" });
    Object.defineProperty(oversizedAmbientImage, "size", {
      configurable: true,
      value: MAX_AMBIENT_IMAGE_FILE_BYTES + 1,
    });
    const fetchCallsBeforeOversizedAmbientImage = uploadFetch.mock.calls.length;
    Object.defineProperty(ambientImageInput, "files", {
      configurable: true,
      value: [oversizedAmbientImage],
    });
    ambientImageInput!.dispatchEvent(new Event("change", { bubbles: true }));

    await expect.element(page.getByText("Choose an image up to 10 MiB.")).toBeInTheDocument();
    expect(uploadFetch).toHaveBeenCalledTimes(fetchCallsBeforeOversizedAmbientImage);

    const ambientDirectoryInput = document.querySelector(
      'input[aria-label="Ambient image folder"]',
    ) as HTMLInputElement | null;
    expect(ambientDirectoryInput).not.toBeNull();
    Object.defineProperty(ambientDirectoryInput, "files", {
      configurable: true,
      value: [
        new File(["first"], "first.png", { type: "image/png" }),
        new File(["second"], "second.gif", { type: "image/gif" }),
      ],
    });
    ambientDirectoryInput!.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          ambientImageCycleEnabled: true,
          ambientImageCycleAssets: expect.arrayContaining([
            expect.objectContaining({ mimeType: "image/png" }),
            expect.objectContaining({ mimeType: "image/gif" }),
          ]),
        }),
      );
    });

    await expect.element(page.getByText("Accent color")).toBeInTheDocument();
    setColorInput("App accent color", "#dc2626");

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ appAccentColor: "#dc2626" });
    });

    await expect.element(page.getByText("Sidebar color")).toBeInTheDocument();
    setColorInput("Animated sidebar color", "#16a34a");

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ themeAccentColor: "#16a34a" });
    });

    await expect.element(page.getByText("Sidebar search")).toBeInTheDocument();
    await page.getByLabelText("Show sidebar search").click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ showSidebarSearch: false });
    });

    await expect.element(page.getByText("Sidebar mascot")).toBeInTheDocument();
    await page.getByLabelText("Show sidebar mascot").click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ showSidebarMascot: false });
    });

    await expect.element(page.getByText("Sidebar attribution")).toBeInTheDocument();
    await page.getByLabelText("Show sidebar attribution").click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ showSidebarAttribution: false });
    });

    await expect.element(page.getByText("Prompt automation controls")).toBeInTheDocument();
    await page.getByLabelText("Show prompt automation controls").click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({
        showComposerThreadAutomationControls: true,
      });
    });

    await expect.element(page.getByText("Background animations")).toBeInTheDocument();
    await page.getByLabelText("Keep animations running in background").click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ continueBackgroundAnimations: true });
    });

    await expect.element(page.getByText("Window atmosphere")).toBeInTheDocument();
    await expect.element(page.getByText("Matrix", { exact: true })).not.toBeInTheDocument();
    await page.getByLabelText("Show falling effects").click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectsEnabled: true });
    });

    await expect.element(page.getByText("Matrix color mode")).not.toBeInTheDocument();
    const snowEffect = page.getByRole("radio", { name: "Snow", exact: true });
    const rainEffect = page.getByRole("radio", { name: "Rain", exact: true });
    const matrixEffect = page.getByRole("radio", { name: "Matrix", exact: true });
    await expect.element(snowEffect).toHaveAttribute("aria-checked", "true");
    await rainEffect.click();
    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectKind: "rain" });
    });
    await expect.element(rainEffect).toHaveAttribute("aria-checked", "true");
    await snowEffect.click();
    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectKind: "snow" });
    });
    await matrixEffect.click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectKind: "matrix" });
    });
    await expect.element(matrixEffect).toHaveAttribute("aria-checked", "true");

    await expect.element(page.getByText("Matrix color mode")).toBeInTheDocument();
    await expect.element(page.getByText("Roman / Japanese mix")).toBeInTheDocument();
    await page.getByRole("radio", { name: "Rainbow", exact: true }).click();
    await page.getByRole("radio", { name: "Rainbow Extra", exact: true }).click();
    await page.getByRole("radio", { name: "Music reactive · uniform", exact: true }).click();
    await page.getByRole("radio", { name: "Music reactive · Rainbow Extra", exact: true }).click();
    await page.getByLabelText("Increase Matrix color-cycle speed").click();
    await page.getByRole("radio", { name: "Fixed", exact: true }).click();
    await page.getByRole("radio", { name: "Music reactive · Rainbow Extra", exact: true }).click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectMatrixColorMode: "fixed",
      });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectMatrixColorCycleSpeed: 1.25,
      });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectMatrixColorMode: "rainbow",
      });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectMatrixColorMode: "rainbow-extra",
      });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectMatrixColorMode: "music-reactive",
      });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectMatrixColorMode: "music-reactive-extra",
      });
    });
    await expect.element(page.getByText(/never read an iframe or microphone/)).toBeInTheDocument();
    await expect
      .element(page.getByRole("radio", { name: "Random independent", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(page.getByLabelText("Network / web")).not.toBeInTheDocument();
    await page.getByLabelText("Show provider activity links in Matrix rain").click();
    await expect.element(page.getByText("Activity inputs", { exact: true })).toBeInTheDocument();
    const networkActivityInput = page.getByRole("checkbox", {
      name: "Network / web",
      exact: true,
    });
    const databaseActivityInput = page.getByRole("checkbox", {
      name: "Database / query",
      exact: true,
    });
    const buildActivityInput = page.getByRole("checkbox", {
      name: "Build / compile",
      exact: true,
    });
    const agentActivityInput = page.getByRole("checkbox", {
      name: "Agent / delegation",
      exact: true,
    });
    await expect.element(networkActivityInput).toHaveAttribute("aria-checked", "true");
    await expect.element(databaseActivityInput).toHaveAttribute("aria-checked", "true");
    await expect.element(buildActivityInput).toHaveAttribute("aria-checked", "true");
    await expect.element(agentActivityInput).toHaveAttribute("aria-checked", "true");
    await networkActivityInput.click();
    await databaseActivityInput.click();
    await buildActivityInput.click();
    await agentActivityInput.click();
    await page.getByRole("radio", { name: "Follow Matrix colors", exact: true }).click();
    await page.getByRole("radio", { name: "Random independent", exact: true }).click();
    await page.getByRole("radio", { name: "Follow Matrix colors", exact: true }).click();
    await page.getByLabelText("Increase verified route visibility").click();
    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectActivityLinks: true });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectActivityLinkNetworkEnabled: false,
      });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectActivityLinkDatabaseEnabled: false,
      });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectActivityLinkBuildEnabled: false,
      });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectActivityLinkAgentEnabled: false,
      });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectActivityLinkColorMode: "random",
      });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectActivityLinkColorMode: "matrix",
      });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectActivityLinkRetentionSeconds: 31,
      });
    });
    await expect
      .element(page.getByText(/never invents data flow or renders prompts/))
      .toBeInTheDocument();

    setColorInput("Falling effect color", "#22c55e");

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectColor: "#22c55e" });
    });

    await page.getByLabelText("Increase falling effect opacity").click();
    await page.getByLabelText("Increase falling effect speed").click();
    await page.getByLabelText("Increase falling effect density").click();
    await page.getByLabelText("Increase Japanese stream ratio").click();
    await page.getByLabelText("Use 2ch-inspired Matrix enrichment").click();
    await page.getByLabelText("Use live work vocabulary in Matrix rain").click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectOpacity: 0.4 });
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectSpeed: 1.25 });
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectDensity: 1.25 });
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectJapaneseRatio: 0.5 });
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffect2chEnriched: true });
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectLiveWorkVocabulary: true,
      });
    });

    await page.getByLabelText("Show falling effects").click();
    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectsEnabled: false });
    });
    await expect.element(page.getByText("Matrix", { exact: true })).not.toBeInTheDocument();
    expect(getServerConfig()?.clientSettings).toMatchObject({
      fallingEffectsEnabled: false,
      fallingEffectKind: "matrix",
      fallingEffectMatrixColorMode: "music-reactive-extra",
      fallingEffectMatrixColorCycleSpeed: 1.25,
      fallingEffect2chEnriched: true,
      fallingEffectLiveWorkVocabulary: true,
      fallingEffectActivityLinks: true,
      fallingEffectActivityLinkNetworkEnabled: false,
      fallingEffectActivityLinkDatabaseEnabled: false,
      fallingEffectActivityLinkBuildEnabled: false,
      fallingEffectActivityLinkAgentEnabled: false,
      fallingEffectActivityLinkColorMode: "matrix",
      fallingEffectActivityLinkRetentionSeconds: 31,
    });

    await expect.element(page.getByText("Sidebar star speed")).toBeInTheDocument();
    await page.getByLabelText("Increase sidebar star speed").click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ sidebarStarSpeed: 1.25 });
    });
  });

  it("includes every Matrix preference in the global settings reset", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const desktopBridge = {
      ...createDesktopBridgeStub(),
      confirm,
    } satisfies DesktopBridge;
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    const config = createBaseServerConfig();
    setServerConfigSnapshot({
      ...config,
      clientSettings: {
        ...config.clientSettings,
        fallingEffectsOverCinemaEnabled: true,
        fallingEffectMatrixBaseFontSize: 28,
        fallingEffectMatrixColorMode: "rainbow-extra",
        fallingEffectMatrixColorCycleSpeed: 32,
        fallingEffectMatrixMotionMode: "tunnel",
        fallingEffectMatrixWalkStartFontSize: 12,
        fallingEffectMatrixWalkEndFontSize: 24,
        fallingEffect2chEnriched: true,
        fallingEffectLiveWorkVocabulary: true,
        fallingEffectActivityLinks: true,
        fallingEffectActivityLinkNetworkEnabled: false,
        fallingEffectActivityLinkDatabaseEnabled: false,
        fallingEffectActivityLinkBuildEnabled: false,
        fallingEffectActivityLinkAgentEnabled: false,
        fallingEffectActivityLinkColorMode: "matrix",
        fallingEffectActivityLinkRetentionSeconds: 90,
      },
    });
    const onRestored = vi.fn();

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <SettingsRestoreHarness onRestored={onRestored} />
      </AppAtomRegistryProvider>,
    );

    await expect
      .element(page.getByLabelText("Changed settings"))
      .toHaveTextContent(
        "Falling effects over cinema video | Matrix base font size | Matrix color mode | Matrix color-cycle speed | Atmosphere motion | Walk perspective sizes | 2ch-inspired Matrix enrichment | Matrix live work vocabulary | Matrix activity links | Matrix activity link inputs | Matrix activity link colors | Matrix verified route visibility",
      );
    await page.getByRole("button", { name: "Apply settings reset" }).click();

    await vi.waitFor(() => {
      expect(confirm).toHaveBeenCalledWith(
        expect.stringContaining(
          "Falling effects over cinema video, Matrix base font size, Matrix color mode, Matrix color-cycle speed, Atmosphere motion, Walk perspective sizes, 2ch-inspired Matrix enrichment, Matrix live work vocabulary, Matrix activity links, Matrix activity link inputs, Matrix activity link colors, Matrix verified route visibility",
        ),
      );
      expect(updateClientSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          fallingEffectsOverCinemaEnabled: false,
          fallingEffectMatrixBaseFontSize: 14,
          fallingEffectMatrixColorMode: "fixed",
          fallingEffectMatrixColorCycleSpeed: 1,
          fallingEffectMatrixMotionMode: "flat",
          fallingEffectMatrixWalkStartFontSize: 1,
          fallingEffectMatrixWalkEndFontSize: 72,
          fallingEffect2chEnriched: false,
          fallingEffectLiveWorkVocabulary: false,
          fallingEffectActivityLinks: false,
          fallingEffectActivityLinkNetworkEnabled: true,
          fallingEffectActivityLinkDatabaseEnabled: true,
          fallingEffectActivityLinkBuildEnabled: true,
          fallingEffectActivityLinkAgentEnabled: true,
          fallingEffectActivityLinkColorMode: "random",
          fallingEffectActivityLinkRetentionSeconds: 30,
        }),
      );
      expect(getServerConfig()?.clientSettings).toMatchObject({
        fallingEffectsOverCinemaEnabled: false,
        fallingEffectMatrixBaseFontSize: 14,
        fallingEffectMatrixColorMode: "fixed",
        fallingEffectMatrixColorCycleSpeed: 1,
        fallingEffectMatrixMotionMode: "flat",
        fallingEffectMatrixWalkStartFontSize: 1,
        fallingEffectMatrixWalkEndFontSize: 72,
        fallingEffect2chEnriched: false,
        fallingEffectLiveWorkVocabulary: false,
        fallingEffectActivityLinks: false,
        fallingEffectActivityLinkNetworkEnabled: true,
        fallingEffectActivityLinkDatabaseEnabled: true,
        fallingEffectActivityLinkBuildEnabled: true,
        fallingEffectActivityLinkAgentEnabled: true,
        fallingEffectActivityLinkColorMode: "random",
        fallingEffectActivityLinkRetentionSeconds: 30,
      });
      expect(onRestored).toHaveBeenCalledOnce();
    });
  });

  it("normalizes ambient streaming sources and commits native opacity on blur", async () => {
    youtubeUrlQueueStore.clear();
    const setWindowOpacityPreference = vi
      .fn<DesktopBridge["setWindowOpacityPreference"]>()
      .mockImplementation(async ({ enabled, opacity }) => ({
        supported: true,
        enabled,
        opacity,
        effectiveOpacity: enabled ? opacity : 1,
        reason: null,
      }));
    const desktopBridge = createDesktopBridgeStub({
      getWindowOpacityState: vi.fn().mockResolvedValue({
        supported: true,
        enabled: false,
        opacity: 1,
        effectiveOpacity: 1,
        reason: null,
      }),
      setWindowOpacityPreference,
    });
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Ambient streaming")).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          /videos that YouTube reports as unavailable or not allowed to be embedded are skipped automatically/i,
        ),
      )
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "K-pop", exact: true }))
      .toBeInTheDocument();
    await page.getByRole("button", { name: "EDM", exact: true }).click();
    await expect.element(page.getByText("URL 1 of 30")).toBeInTheDocument();
    await expect.element(page.getByText(/Accepted 30; skipped 1 invalid/)).toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "EDM", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Japanese music", exact: true }).click();
    await expect.element(page.getByText("URL 1 of 71")).toBeInTheDocument();
    await expect.element(page.getByText(/Accepted 71; skipped 3 invalid/)).toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Japanese music", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "K-pop", exact: true }).click();
    await expect.element(page.getByText("URL 1 of 8")).toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "K-pop", exact: true }))
      .toHaveAttribute("aria-pressed", "true");

    const queueInput = document.querySelector(
      'input[aria-label="Choose YouTube URL queue text file"]',
    ) as HTMLInputElement | null;
    expect(queueInput).not.toBeNull();
    Object.defineProperty(queueInput, "files", {
      configurable: true,
      value: [
        new File(["https://youtu.be/dQw4w9WgXcQ"], "EDMYoutubeList.txt", {
          type: "text/plain",
        }),
      ],
    });
    queueInput!.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.element(page.getByText(/EDM replaced\./)).toBeInTheDocument();
    await expect.element(page.getByText("URL 1 of 1")).toBeInTheDocument();
    expect(
      Array.from(document.querySelectorAll("button")).filter(
        (button) => button.textContent?.trim() === "EDM",
      ),
    ).toHaveLength(1);

    Object.defineProperty(queueInput, "files", {
      configurable: true,
      value: [
        new File(
          [["https://youtu.be/9bZkp7q19f0", "https://youtu.be/kJQP7kiw5Fk"].join("\n")],
          "Night Drive.txt",
          { type: "text/plain" },
        ),
      ],
    });
    queueInput!.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.element(page.getByText(/Night Drive added\./)).toBeInTheDocument();
    await expect.element(page.getByText("URL 1 of 2")).toBeInTheDocument();
    await page.getByRole("button", { name: "Japanese music", exact: true }).click();
    await page.getByRole("button", { name: "Night Drive", exact: true }).click();
    await expect.element(page.getByText("URL 1 of 2")).toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Night Drive", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ ambientVideoEnabled: true });
    });
    await page.getByLabelText("Ambient video glow").click();
    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ ambientVideoGlowEnabled: true });
    });
    await page.getByLabelText("Ambient video glow mode").click();
    await page.getByText("Match video", { exact: true }).click();
    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ ambientVideoGlowMode: "adaptive" });
    });
    await expect
      .element(page.getByText(/Uses the current YouTube video artwork/))
      .toBeInTheDocument();

    const sourceInput = document.querySelector(
      'input[aria-label="YouTube or Spotify media source"]',
    ) as HTMLInputElement | null;
    expect(sourceInput).not.toBeNull();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      sourceInput,
      "https://youtu.be/dQw4w9WgXcQ?t=7",
    );
    sourceInput!.dispatchEvent(new Event("input", { bubbles: true }));
    await page.getByRole("button", { name: "Apply", exact: true }).click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({
        ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
        ambientVideoEnabled: true,
      });
    });

    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      sourceInput,
      "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=discard-me",
    );
    sourceInput!.dispatchEvent(new Event("input", { bubbles: true }));
    await page.getByRole("button", { name: "Apply", exact: true }).click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({
        ambientVideoSource: {
          kind: "spotify",
          entityType: "playlist",
          id: "37i9dQZF1DXcBWIGoYBM5M",
        },
        ambientVideoEnabled: true,
      });
    });

    const searchInput = document.querySelector(
      'input[aria-label="Search YouTube"]',
    ) as HTMLInputElement | null;
    expect(searchInput?.disabled).toBe(false);

    await expect.element(page.getByText("Window transparency and safety")).toBeInTheDocument();
    const opacityInput = document.querySelector(
      'input[aria-label="Desktop window opacity"]',
    ) as HTMLInputElement | null;
    expect(opacityInput).not.toBeNull();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      opacityInput,
      "0.75",
    );
    opacityInput!.dispatchEvent(new Event("input", { bubbles: true }));
    opacityInput!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));

    await vi.waitFor(() => {
      expect(setWindowOpacityPreference).toHaveBeenCalledWith({
        enabled: false,
        opacity: 0.75,
      });
    });
  });

  it("disables ambient rendering without erasing saved choices or accepting a stale opacity read", async () => {
    type OpacityState = Awaited<ReturnType<DesktopBridge["getWindowOpacityState"]>>;
    let resolveInitialOpacity!: (state: OpacityState) => void;
    const initialOpacity = new Promise<OpacityState>((resolve) => {
      resolveInitialOpacity = resolve;
    });
    const getWindowOpacityState = vi
      .fn<DesktopBridge["getWindowOpacityState"]>()
      .mockImplementationOnce(() => initialOpacity)
      .mockResolvedValueOnce({
        supported: true,
        enabled: true,
        opacity: 0.68,
        effectiveOpacity: 0.68,
        reason: null,
      });
    const setWindowOpacityPreference = vi
      .fn<DesktopBridge["setWindowOpacityPreference"]>()
      .mockResolvedValue({
        supported: true,
        enabled: false,
        opacity: 0.68,
        effectiveOpacity: 1,
        reason: null,
      });
    const desktopBridge = createDesktopBridgeStub({
      getWindowOpacityState,
      setWindowOpacityPreference,
    });
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    const savedVideoSource = { kind: "video" as const, id: "dQw4w9WgXcQ" };
    const config = createBaseServerConfig();
    setServerConfigSnapshot({
      ...config,
      clientSettings: {
        ...config.clientSettings,
        fallingEffectsEnabled: true,
        fallingEffectKind: "matrix",
        ambientVideoEnabled: true,
        ambientVideoSource: savedVideoSource,
        ambientVideoGlowEnabled: true,
        ambientImageEnabled: true,
        ambientImageGlowEnabled: true,
      },
    });

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await vi.waitFor(() => {
      expect(getWindowOpacityState).toHaveBeenCalledTimes(1);
    });
    await page.getByRole("button", { name: "Restore appearance" }).click();

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectsEnabled: false,
        ambientVideoEnabled: false,
        ambientImageEnabled: false,
      });
      expect(setWindowOpacityPreference).toHaveBeenCalledWith({
        enabled: false,
        opacity: 0.68,
      });
    });

    const persistedPatch = updateClientSettings.mock.calls.at(-1)?.[0];
    expect(persistedPatch).not.toHaveProperty("ambientVideoSource");
    expect(persistedPatch).not.toHaveProperty("ambientVideoGlowEnabled");
    expect(persistedPatch).not.toHaveProperty("ambientImageGlowEnabled");
    expect(getServerConfig()?.clientSettings).toMatchObject({
      fallingEffectsEnabled: false,
      fallingEffectKind: "matrix",
      ambientVideoEnabled: false,
      ambientVideoSource: savedVideoSource,
      ambientVideoGlowEnabled: true,
      ambientImageEnabled: false,
      ambientImageGlowEnabled: true,
    });

    resolveInitialOpacity({
      supported: true,
      enabled: true,
      opacity: 0.42,
      effectiveOpacity: 0.42,
      reason: null,
    });
    await vi.waitFor(() => {
      expect(
        document
          .querySelector('[aria-label="Transparent desktop window"]')
          ?.getAttribute("aria-checked"),
      ).toBe("false");
    });
    await expect
      .element(page.getByText("All available ambient features are off. Saved choices were kept."))
      .toBeInTheDocument();
  });

  it("clears the current Local Media selection without persisting it when restoring appearance", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    expect(
      localMediaStore.selectFile(
        new File(["private session media"], "private-session-video.mp4", {
          type: "video/mp4",
        }),
      ),
    ).toBe(true);
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const restore = page.getByRole("button", { name: "Restore appearance" });
    await expect.element(restore).toBeEnabled();
    await restore.click();

    await vi.waitFor(() => {
      expect(localMediaStore.getSnapshot().source).toBeNull();
      expect(updateClientSettings).toHaveBeenCalledWith({
        fallingEffectsEnabled: false,
        ambientVideoEnabled: false,
        ambientImageEnabled: false,
      });
    });
    expect(updateClientSettings.mock.calls.at(-1)?.[0]).not.toHaveProperty("localMediaSource");
    await expect
      .element(
        page.getByText(
          "All available ambient features are off. Saved choices were kept; the current local media selection was cleared.",
        ),
      )
      .toBeInTheDocument();
  });

  it("keeps a newer Local Media selection made while appearance restore is pending", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    let resolveSettingsWrite!: (settings: ClientSettings) => void;
    updateClientSettings.mockImplementationOnce(
      () =>
        new Promise<ClientSettings>((resolve) => {
          resolveSettingsWrite = resolve;
        }),
    );
    expect(
      localMediaStore.selectFile(
        new File(["old media"], "old-session-video.mp4", { type: "video/mp4" }),
      ),
    ).toBe(true);
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Restore appearance" }).click();
    await vi.waitFor(() => {
      expect(localMediaStore.getSnapshot().source).toBeNull();
      expect(updateClientSettings).toHaveBeenCalledOnce();
    });

    expect(
      localMediaStore.selectFile(
        new File(["new media"], "new-session-video.mp4", { type: "video/mp4" }),
      ),
    ).toBe(true);
    const newerSource = localMediaStore.getSnapshot().source;
    resolveSettingsWrite(DEFAULT_CLIENT_SETTINGS);

    await expect
      .element(
        page.getByText(
          "Appearance restore completed. A newer local media selection remains active.",
        ),
      )
      .toBeInTheDocument();
    expect(localMediaStore.getSnapshot().source).toEqual(newerSource);
    expect(updateClientSettings.mock.calls.at(-1)?.[0]).not.toHaveProperty("localMediaSource");
  });

  it("rolls back failed Disable All settings and reports a retryable partial result", async () => {
    const desktopBridge = createDesktopBridgeStub({
      getWindowOpacityState: vi.fn().mockResolvedValue({
        supported: true,
        enabled: true,
        opacity: 0.76,
        effectiveOpacity: 0.76,
        reason: null,
      }),
      setWindowOpacityPreference: vi.fn().mockResolvedValue({
        supported: true,
        enabled: false,
        opacity: 0.76,
        effectiveOpacity: 1,
        reason: null,
      }),
    });
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    updateClientSettings.mockRejectedValue(new Error("settings RPC unavailable"));
    const toastSpy = vi.spyOn(toastManager, "add");
    const config = createBaseServerConfig();
    setServerConfigSnapshot({
      ...config,
      clientSettings: {
        ...config.clientSettings,
        fallingEffectsEnabled: true,
        ambientVideoEnabled: true,
        ambientVideoGlowEnabled: true,
      },
    });

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Restore appearance" }).click();

    await vi.waitFor(() => {
      expect(getServerConfig()?.clientSettings).toMatchObject({
        fallingEffectsEnabled: true,
        ambientVideoEnabled: true,
        ambientVideoGlowEnabled: true,
      });
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Appearance only partly restored",
          type: "error",
        }),
      );
    });
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("Appearance was only partly restored");
    await expect.element(page.getByRole("button", { name: "Restore appearance" })).toBeEnabled();
  });

  it("does not let an older failed optimistic write roll back a newer setting choice", async () => {
    let rejectFirstWrite!: (error: Error) => void;
    const firstWrite = new Promise<never>((_resolve, reject) => {
      rejectFirstWrite = reject;
    });
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    updateClientSettings
      .mockImplementationOnce(() => firstWrite)
      .mockResolvedValue(DEFAULT_CLIENT_SETTINGS);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const effectsSwitch = page.getByRole("switch", { name: "Show falling effects" });
    await effectsSwitch.click();
    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectsEnabled: true });
    });
    await effectsSwitch.click();
    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({ fallingEffectsEnabled: false });
    });

    rejectFirstWrite(new Error("older write failed"));
    await vi.waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(getServerConfig()?.clientSettings.fallingEffectsEnabled).toBe(false);
    });
  });

  it("searches public YouTube results in-app and selects a normalized source", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              kind: "video",
              id: "dQw4w9WgXcQ",
              title: "Late-night coding mix",
              thumbnail: null,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      ambientExperienceCapabilities: {
        ...DEFAULT_AMBIENT_EXPERIENCE_CAPABILITIES,
        youtubePlayer: true,
        youtubePublicDiscovery: true,
      },
    });

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByLabelText("Search YouTube").fill("late night coding");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect.element(page.getByText("Late-night coding mix")).toBeInTheDocument();

    expect(fetchMock).toHaveBeenCalledOnce();
    const discoveryUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(discoveryUrl.pathname).toBe("/api/ambient-media/youtube/search");
    expect(discoveryUrl.search).toBe("");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ query: "late night coding", maxResults: 8 }),
    });

    await page.getByText("Late-night coding mix").click();
    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({
        ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
        ambientVideoEnabled: true,
      });
    });
  });

  it("does not enable a discovered YouTube source without player capability", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            results: [
              {
                kind: "video",
                id: "dQw4w9WgXcQ",
                title: "Discovery without playback",
                thumbnail: null,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      ambientExperienceCapabilities: {
        ...DEFAULT_AMBIENT_EXPERIENCE_CAPABILITIES,
        youtubePlayer: false,
        youtubePublicDiscovery: true,
        spotifyEmbed: false,
      },
    });

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByLabelText("Search YouTube").fill("discovery only");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const result = page.getByRole("button", { name: /Discovery without playback/ });
    await expect.element(result).toBeDisabled();

    expect(updateClientSettings).not.toHaveBeenCalledWith({
      ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
      ambientVideoEnabled: true,
    });
  });

  it("loads and selects an owned YouTube playlist for a connected owner", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    const playlistId = "PL1234567890";
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/ambient-media/youtube/account/status")) {
        return new Response(JSON.stringify({ status: "connected" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/ambient-media/youtube/account/playlists")) {
        return new Response(
          JSON.stringify({
            playlists: [{ id: playlistId, title: "My coding mix", itemCount: 12 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected-test-request" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      ambientExperienceCapabilities: {
        ...DEFAULT_AMBIENT_EXPERIENCE_CAPABILITIES,
        youtubePlayer: true,
        youtubeAccountConnection: true,
      },
    });

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("My coding mix (12)")).toBeInTheDocument();
    const selector = document.querySelector(
      'select[aria-label="Owned YouTube playlist"]',
    ) as HTMLSelectElement | null;
    expect(selector).not.toBeNull();
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
      selector,
      playlistId,
    );
    selector!.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      expect(updateClientSettings).toHaveBeenCalledWith({
        ambientVideoSource: { kind: "playlist", id: playlistId },
        ambientVideoEnabled: true,
      });
    });

    const openPlaylist = page.getByRole("button", { name: "Open selected in YouTube" });
    await expect.element(openPlaylist).toBeEnabled();
    await openPlaylist.click();
    await vi.waitFor(() => {
      expect(desktopBridge.openExternal).toHaveBeenCalledWith(
        `https://www.youtube.com/playlist?list=${playlistId}`,
      );
    });
  });

  it("does not request owner account state when desktop account connection is unavailable", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    installClientSettingsNativeApi(desktopBridge);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      ambientExperienceCapabilities: {
        ...DEFAULT_AMBIENT_EXPERIENCE_CAPABILITIES,
        youtubePlayer: true,
        youtubeAccountConnection: false,
      },
    });

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <AppearanceSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByRole("button", { name: "Open playlists" })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows detected editor icons in the Files & Diffs default editor selector", async () => {
    const platformSpy = vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;
    const { updateClientSettings } = installClientSettingsNativeApi(desktopBridge);
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      availableEditors: ["vscode", "antigravity", "file-manager"],
    });

    try {
      mounted = await renderWithTestRouter(
        <AppAtomRegistryProvider>
          <FilesSettingsPanel />
        </AppAtomRegistryProvider>,
      );

      await page.getByLabelText("Default editor").click();

      await expect
        .element(page.getByTestId("default-editor-option-vscode-icon"))
        .toBeInTheDocument();
      await expect
        .element(page.getByTestId("default-editor-option-antigravity-icon"))
        .toBeInTheDocument();
      await expect
        .element(page.getByTestId("default-editor-option-file-manager-icon"))
        .toBeInTheDocument();
      await expect.element(page.getByText("Finder", { exact: true })).toBeInTheDocument();
      await expect.element(page.getByText("Cursor", { exact: true })).not.toBeInTheDocument();

      await page.getByText("VS Code", { exact: true }).click();

      await vi.waitFor(() => {
        expect(updateClientSettings).toHaveBeenCalledWith({ defaultEditor: "vscode" });
      });
      await expect
        .element(
          page.getByTestId("default-editor-selected-option").getByText("VS Code", { exact: true }),
        )
        .toBeInTheDocument();
      await expect
        .element(page.getByTestId("default-editor-selected-option-icon"))
        .toBeInTheDocument();
    } finally {
      platformSpy.mockRestore();
    }
  });

  it("creates and shows a pairing link when network access is enabled", async () => {
    window.desktopBridge = createDesktopBridgeStub({
      serverExposureState: {
        mode: "network-accessible",
        httpsEnabled: true,
        endpointUrl: "http://192.168.1.44:3773",
        advertisedHost: "192.168.1.44",
      },
    });
    let pairingLinks: Array<AuthAccessSnapshot["pairingLinks"][number]> = [];
    let clientSessions: Array<AuthAccessSnapshot["clientSessions"][number]> = [
      makeClientSession({
        sessionId: "session-owner",
        subject: "desktop-bootstrap",
        role: "owner",
        method: "browser-session-cookie",
        client: {
          label: "This Mac",
          deviceType: "desktop",
          os: "macOS",
          browser: "Electron",
          ipAddress: "127.0.0.1",
        },
        issuedAt: "2036-04-07T00:00:00.000Z",
        expiresAt: "2036-05-07T00:00:00.000Z",
        connected: true,
        current: true,
      }),
    ];
    authAccessHarness.setSnapshot({
      pairingLinks,
      clientSessions,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (url.endsWith("/api/auth/pairing-token") && method === "POST") {
          pairingLinks = [
            makePairingLink({
              id: "pairing-link-1",
              credential: "pairing-token",
              role: "client",
              subject: "one-time-token",
              label: "Julius iPhone",
              createdAt: "2036-04-07T00:00:00.000Z",
              expiresAt: "2036-04-10T00:05:00.000Z",
            }),
          ];
          clientSessions = [
            ...clientSessions,
            makeClientSession({
              sessionId: "session-client",
              subject: "one-time-token",
              role: "client",
              method: "browser-session-cookie",
              client: {
                label: "Julius iPhone",
                deviceType: "mobile",
                os: "iOS",
                browser: "Safari",
                ipAddress: "192.168.1.88",
              },
              issuedAt: "2036-04-07T00:01:00.000Z",
              expiresAt: "2036-05-07T00:01:00.000Z",
              connected: false,
              current: false,
            }),
          ];
          authAccessHarness.setSnapshot({
            pairingLinks,
            clientSessions,
          });
          return new Response(
            JSON.stringify({
              id: "pairing-link-1",
              credential: "pairing-token",
              label: "Julius iPhone",
              expiresAt: "2036-04-10T00:05:00.000Z",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }

        throw new Error(`Unhandled fetch ${method} ${url}`);
      }),
    );

    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Authorized clients")).toBeInTheDocument();
    await expect.element(page.getByText("Revoke others")).toBeInTheDocument();
    await expect.element(page.getByText("This Mac")).toBeInTheDocument();
    await page.getByRole("button", { name: "Create link", exact: true }).click();
    await expect.element(page.getByText("Create pairing link")).toBeInTheDocument();
    await page.getByRole("button", { name: "Create link", exact: true }).click();
    authAccessHarness.emitPairingLinkUpserted(pairingLinks[0]!);
    authAccessHarness.emitClientUpserted(clientSessions[1]!);
    await expect
      .element(page.getByText("Client · Mobile · iOS · Safari · 192.168.1.88"))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: /^Copy pairing URL for:/ }))
      .toBeInTheDocument();
    await expect.element(page.getByText("Revoke others")).toBeInTheDocument();
  });

  it("enables, changes, and disables admin password auth from settings", async () => {
    window.desktopBridge = createDesktopBridgeStub({
      serverExposureState: {
        mode: "network-accessible",
        httpsEnabled: true,
        endpointUrl: "http://192.168.1.44:3773",
        advertisedHost: "192.168.1.44",
      },
    });
    authAccessHarness.setSnapshot({
      pairingLinks: [],
      clientSessions: [],
    });
    let configured = false;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/auth/admin-password") && method === "GET") {
        return new Response(JSON.stringify({ configured }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/auth/admin-password") && method === "POST") {
        configured = true;
        return new Response(JSON.stringify({ configured }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/auth/admin-password/clear") && method === "POST") {
        configured = false;
        return new Response(JSON.stringify({ configured }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unhandled fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Admin password")).toBeInTheDocument();
    await expect.element(page.getByText("Password sign-in is off.")).toBeInTheDocument();
    await page.getByLabelText("Enable password authentication").click();
    await expect.element(page.getByText("Enable admin password")).toBeInTheDocument();
    await page
      .getByRole("textbox", { name: "Admin password", exact: true })
      .fill("correct horse battery staple");
    await page
      .getByRole("textbox", { name: "Confirm password", exact: true })
      .fill("correct horse battery staple");
    await page.getByRole("button", { name: "Enable", exact: true }).click();

    await expect.element(page.getByText("Password sign-in is on.")).toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Change", exact: true }))
      .toBeInTheDocument();

    await page.getByLabelText("Enable password authentication").click();
    await expect.element(page.getByText("Disable password authentication?")).toBeInTheDocument();
    await page.getByRole("button", { name: "Disable", exact: true }).click();

    await expect.element(page.getByText("Password sign-in is off.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:3773/api/auth/admin-password", {
      body: JSON.stringify({ password: "correct horse battery staple" }),
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
  });

  it("revokes all other paired clients from settings", async () => {
    window.desktopBridge = createDesktopBridgeStub({
      serverExposureState: {
        mode: "network-accessible",
        httpsEnabled: true,
        endpointUrl: "http://192.168.1.44:3773",
        advertisedHost: "192.168.1.44",
      },
    });
    let clientSessions: Array<AuthAccessSnapshot["clientSessions"][number]> = [
      makeClientSession({
        sessionId: "session-owner",
        subject: "desktop-bootstrap",
        role: "owner",
        method: "browser-session-cookie",
        client: {
          label: "This Mac",
          deviceType: "desktop",
          os: "macOS",
          browser: "Electron",
        },
        issuedAt: "2036-04-05T00:00:00.000Z",
        expiresAt: "2036-05-05T00:00:00.000Z",
        connected: true,
        current: true,
      }),
      makeClientSession({
        sessionId: "session-client",
        subject: "one-time-token",
        role: "client",
        method: "browser-session-cookie",
        client: {
          label: "Julius iPhone",
          deviceType: "mobile",
          os: "iOS",
          browser: "Safari",
          ipAddress: "192.168.1.88",
        },
        issuedAt: "2036-04-05T00:01:00.000Z",
        expiresAt: "2036-05-05T00:01:00.000Z",
        connected: false,
        current: false,
      }),
    ];
    authAccessHarness.setSnapshot({
      pairingLinks: [],
      clientSessions,
    });

    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/auth/clients/revoke-others") && method === "POST") {
        clientSessions = clientSessions.filter((session) => session.current);
        authAccessHarness.setSnapshot({
          pairingLinks: [],
          clientSessions,
        });
        authAccessHarness.emitClientRemoved("session-client");
        return new Response(JSON.stringify({ revokedCount: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      throw new Error(`Unhandled fetch ${method} ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Julius iPhone")).toBeInTheDocument();
    await page.getByRole("button", { name: "Revoke others", exact: true }).click();
    await expect.element(page.getByText("This Mac")).toBeInTheDocument();
    await expect.element(page.getByText("Julius iPhone")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it("shows a disabled network access toggle with guidance in desktop builds", async () => {
    const desktopBridge = createDesktopBridgeStub();
    window.desktopBridge = desktopBridge;

    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    const networkAccessToggle = page.getByLabelText("Enable network access");
    await expect.element(networkAccessToggle).not.toBeDisabled();
    await networkAccessToggle.click();
    await expect.element(page.getByText("Enable network access?")).toBeInTheDocument();
    await expect
      .element(
        page.getByText("Club Code will restart to expose this environment over the network."),
      )
      .toBeInTheDocument();
    await page.getByRole("button", { name: "Restart and enable", exact: true }).click();
    await vi.waitFor(() => {
      expect(desktopBridge.setServerExposureMode).toHaveBeenCalledWith("network-accessible");
    });
    await expect.element(page.getByText("http://192.168.1.44:3773")).toBeInTheDocument();
  });

  it("toggles desktop HTTPS separately from network access", async () => {
    const setServerHttpsEnabled = vi.fn().mockResolvedValue({
      mode: "local-only",
      httpsEnabled: false,
      endpointUrl: null,
      advertisedHost: null,
    });
    window.desktopBridge = createDesktopBridgeStub({
      setServerHttpsEnabled,
    });

    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ConnectionsSettings />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("WebUI uses HTTPS.")).toBeInTheDocument();
    await page.getByLabelText("Enable HTTPS").click();
    await expect.element(page.getByText("Disable HTTPS?")).toBeInTheDocument();
    await expect
      .element(page.getByText("Club Code will restart to update the backend listener."))
      .toBeInTheDocument();
    await page.getByRole("button", { name: "Restart and disable", exact: true }).click();
    await vi.waitFor(() => {
      expect(setServerHttpsEnabled).toHaveBeenCalledWith(false);
    });
    await expect.element(page.getByText("WebUI uses HTTP.")).toBeInTheDocument();
  });

  it("opens the logs folder in the preferred editor", async () => {
    const openInEditor = vi.fn<LocalApi["shell"]["openInEditor"]>().mockResolvedValue(undefined);
    window.nativeApi = {
      persistence: {
        getClientSettings: vi.fn().mockResolvedValue(null),
        setClientSettings: vi.fn().mockResolvedValue(undefined),
      },
      shell: {
        openInEditor,
      },
      server: {
        getProcessDiagnostics: vi.fn().mockResolvedValue({
          serverPid: 1234,
          readAt: makeUtc("2036-04-07T00:00:00.000Z"),
          processCount: 0,
          totalRssBytes: 0,
          totalCpuPercent: 0,
          processes: [],
          error: Option.none(),
        }),
        getProcessResourceHistory: vi
          .fn()
          .mockResolvedValue(createEmptyProcessResourceHistoryResult()),
        getRuntimeLayerDiagnostics: vi
          .fn()
          .mockResolvedValue(createRuntimeLayerDiagnosticsResult()),
        getTraceDiagnostics: vi.fn().mockResolvedValue({
          traceFilePath: "/repo/project/.t3/traces.jsonl",
          scannedFilePaths: ["/repo/project/.t3/traces.jsonl"],
          readAt: makeUtc("2036-04-07T00:00:00.000Z"),
          recordCount: 0,
          parseErrorCount: 0,
          firstSpanAt: Option.none(),
          lastSpanAt: Option.none(),
          failureCount: 0,
          interruptionCount: 0,
          slowSpanThresholdMs: 5_000,
          slowSpanCount: 0,
          logLevelCounts: {},
          topSpansByCount: [],
          slowestSpans: [],
          commonFailures: [],
          latestFailures: [],
          latestWarningAndErrorLogs: [],
          partialFailure: Option.none(),
          error: Option.none(),
        }),
      },
    } as unknown as LocalApi;

    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <DiagnosticsSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const openLogsButton = page.getByLabelText("Open logs folder");
    await expect
      .element(page.getByRole("heading", { name: "Runtime Overview", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Orchestrator Subprocesses", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Provider Daemon", exact: true }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Provider Supervisor", exact: true }))
      .toBeInTheDocument();
    await expect.element(page.getByText("not-configured", { exact: true })).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Optional provider supervisor is not configured; providers run in the daemon.",
          { exact: true },
        ),
      )
      .toBeInTheDocument();
    await openLogsButton.click();

    expect(openInEditor).toHaveBeenCalledWith("/repo/project/.t3/logs", "cursor");
  });

  it("opens the file-backed system prompt from Chat settings", async () => {
    const openSystemPromptFile = vi
      .fn<LocalApi["server"]["openSystemPromptFile"]>()
      .mockResolvedValue({
        path: "/repo/project/.t3code-system-prompt.md",
      });
    const getConfig = vi.fn<LocalApi["server"]["getConfig"]>().mockResolvedValue({
      ...createBaseServerConfig(),
      availableEditors: ["cursor"],
    });
    const openInEditor = vi.fn<LocalApi["shell"]["openInEditor"]>().mockResolvedValue(undefined);
    window.nativeApi = {
      persistence: {
        getClientSettings: vi.fn().mockResolvedValue(null),
        setClientSettings: vi.fn().mockResolvedValue(undefined),
      },
      server: {
        getConfig,
        openSystemPromptFile,
      },
      shell: {
        openInEditor,
      },
    } as unknown as LocalApi;
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await renderWithTestRouter(
      <AppAtomRegistryProvider>
        <ChatSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Open file" }).click();

    await vi.waitFor(() => {
      expect(openSystemPromptFile).toHaveBeenCalledTimes(1);
      expect(openInEditor).toHaveBeenCalledWith("/repo/project/.t3code-system-prompt.md", "cursor");
    });
  });

  it("runs one-click provider updates from the provider card", async () => {
    const updateProvider = vi.fn<LocalApi["server"]["updateProvider"]>().mockResolvedValue({
      providers: [createOutdatedProvider("codex")],
    });
    window.nativeApi = {
      persistence: {
        getClientSettings: vi.fn().mockResolvedValue(null),
        setClientSettings: vi.fn().mockResolvedValue(undefined),
      },
      server: {
        updateProvider,
      },
    } as unknown as LocalApi;

    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [createOutdatedProvider("codex")],
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <ProviderSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Update available — view details" }).click();
    await expect.element(page.getByRole("button", { name: "Update now" })).toBeInTheDocument();
    await page.getByRole("button", { name: "Update now" }).click();

    expect(updateProvider).toHaveBeenCalledWith({
      provider: ProviderDriverKind.make("codex"),
      instanceId: ProviderInstanceId.make("codex"),
    });
  });

  it("shows first-class LM Studio Local setup and adds its separate provider instance", async () => {
    const updateSettings = vi.fn<LocalApi["server"]["updateSettings"]>().mockResolvedValue({
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("lmstudio")]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
          displayName: "LM Studio Local",
          config: {
            ossMode: true,
            ossBaseUrl: "http://192.168.50.25:1234/v1",
          },
        },
      },
    });
    window.nativeApi = {
      persistence: {
        getClientSettings: vi.fn().mockResolvedValue(null),
        setClientSettings: vi.fn().mockResolvedValue(undefined),
      },
      server: {
        updateSettings,
      },
    } as unknown as LocalApi;
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ProviderSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect
      .element(page.getByRole("heading", { name: "LM Studio Local", exact: true }))
      .toBeInTheDocument();
    await expect.element(page.getByText(/OpenCode is a separate provider\./)).toBeInTheDocument();
    const addProviderButton = page.getByRole("button", { name: "Add provider instance" });
    await expect.element(addProviderButton).toHaveTextContent("Add provider");
    await page.getByRole("button", { name: "Set up LM Studio Local" }).click();
    await expect.element(page.getByText("LM Studio Local through Codex OSS")).toBeInTheDocument();
    await expect
      .element(page.getByLabelText("LM Studio server URL"))
      .toHaveValue(DEFAULT_LM_STUDIO_BASE_URL);
    await page.getByLabelText("LM Studio server URL").fill("http://models.example.com/v1");
    await page.getByRole("button", { name: "Add instance" }).click();
    await expect
      .element(page.getByText(/Plain HTTP is allowed only for localhost or a literal private/))
      .toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
    await page.getByLabelText("LM Studio server URL").fill("http://192.168.50.25:1234/v1");
    await page.getByRole("button", { name: "Add instance" }).click();

    await vi.waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({
        providerInstances: {
          lmstudio: {
            driver: ProviderDriverKind.make("codex"),
            enabled: true,
            displayName: "LM Studio Local",
            config: {
              ossMode: true,
              ossBaseUrl: "http://192.168.50.25:1234/v1",
            },
          },
        },
      });
    });
  });

  it("keeps LM Studio setup open and reports a rejected settings write", async () => {
    const updateSettings = vi
      .fn<LocalApi["server"]["updateSettings"]>()
      .mockRejectedValue(new Error("settings RPC unavailable"));
    const toastSpy = vi.spyOn(toastManager, "add");
    window.nativeApi = {
      persistence: {
        getClientSettings: vi.fn().mockResolvedValue(null),
        setClientSettings: vi.fn().mockResolvedValue(undefined),
      },
      server: {
        updateSettings,
      },
    } as unknown as LocalApi;
    setServerConfigSnapshot(createBaseServerConfig());

    mounted = await render(
      <AppAtomRegistryProvider>
        <ProviderSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Set up LM Studio Local" }).click();
    await page.getByRole("button", { name: "Add instance" }).click();

    await vi.waitFor(() => {
      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(toastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "error",
          title: "Could not add provider instance",
          description: "settings RPC unavailable",
        }),
      );
    });
    await expect.element(page.getByText("LM Studio Local through Codex OSS")).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Add instance" })).toBeEnabled();
  });

  it("keeps an existing LM Studio instance intact when its edited URL is unsafe", async () => {
    const updateSettings = vi.fn<LocalApi["server"]["updateSettings"]>().mockResolvedValue({
      ...DEFAULT_SERVER_SETTINGS,
    });
    window.nativeApi = {
      persistence: {
        getClientSettings: vi.fn().mockResolvedValue(null),
        setClientSettings: vi.fn().mockResolvedValue(undefined),
      },
      server: {
        updateSettings,
      },
    } as unknown as LocalApi;
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      settings: {
        ...DEFAULT_SERVER_SETTINGS,
        providerInstances: {
          [ProviderInstanceId.make("lmstudio")]: {
            driver: ProviderDriverKind.make("codex"),
            enabled: true,
            displayName: "LM Studio Local",
            config: {
              ossMode: true,
              ossBaseUrl: "http://192.168.50.25:1234/v1",
            },
          },
        },
      },
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <ProviderSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Open LM Studio Local settings" }).click();
    await expect
      .element(page.getByText(/LM Studio models are discovered from the configured server/))
      .toBeInTheDocument();
    await page.getByLabelText("LM Studio server URL").fill("http://models.example.com/v1");
    await page.getByText("New chat defaults and configuration for this provider instance.").click();

    await expect
      .element(page.getByText(/Plain HTTP is allowed only for localhost or a literal private/))
      .toBeInTheDocument();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("shows Codex reset availability above the reset schedule", async () => {
    const codexProvider: ServerProvider = {
      ...createOutdatedProvider("codex"),
      accountRateLimits: {
        checkedAt: "2026-07-27T00:00:00.000Z",
        rateLimits: {
          limitId: "codex",
          primary: {
            usedPercent: 25,
            windowDurationMins: 300,
            resetsAt: 1_784_944_800,
          },
          secondary: {
            usedPercent: 50,
            windowDurationMins: 10_080,
            resetsAt: 1_785_549_600,
          },
        },
        rateLimitResetCredits: {
          availableCount: 2,
          credits: null,
        },
      },
    };
    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [codexProvider],
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <ProviderSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect
      .element(page.getByText("Usage limit resets available: 2", { exact: true }))
      .toBeInTheDocument();
    await vi.waitFor(() => {
      const lines = Array.from(document.querySelectorAll<HTMLParagraphElement>("p"));
      const availabilityIndex = lines.findIndex(
        (line) => line.textContent === "Usage limit resets available: 2",
      );
      const resetScheduleIndex = lines.findIndex((line) =>
        line.textContent?.includes("Weekly reset:"),
      );

      expect(availabilityIndex).toBeGreaterThanOrEqual(0);
      expect(resetScheduleIndex).toBeGreaterThan(availabilityIndex);
    });
  });

  it("keeps long provider update commands inside the fixed-width popover", async () => {
    const longUpdateCommand =
      "npm install -g @anthropic-ai/claude-code@latest --registry=https://registry.npmjs.org --cache=/tmp/t3code-provider-update-cache";

    setServerConfigSnapshot({
      ...createBaseServerConfig(),
      providers: [createOutdatedProvider("codex", longUpdateCommand)],
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <ProviderSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await page.getByRole("button", { name: "Update available — view details" }).click();
    await expect.element(page.getByText(longUpdateCommand)).toBeInTheDocument();

    await vi.waitFor(() => {
      const popup = document.querySelector<HTMLElement>('[data-slot="popover-popup"]');
      const commandCode = Array.from(document.querySelectorAll<HTMLElement>("code")).find(
        (element) => element.textContent === longUpdateCommand,
      );
      const scrollViewport = commandCode?.closest<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );

      expect(popup).toBeTruthy();
      expect(commandCode).toBeTruthy();
      expect(scrollViewport).toBeTruthy();

      const popupRect = popup!.getBoundingClientRect();
      const viewportRect = scrollViewport!.getBoundingClientRect();

      expect(popupRect.width).toBeGreaterThan(300);
      expect(popupRect.width).toBeLessThanOrEqual(337);
      expect(viewportRect.right).toBeLessThanOrEqual(popupRect.right + 0.5);
      expect(scrollViewport!.scrollWidth).toBeGreaterThan(scrollViewport!.clientWidth);
    });
  });
});

describe("SourceControlSettingsPanel discovery states", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  beforeEach(async () => {
    resetAppAtomRegistryForTests();
    await __resetLocalApiForTests();
    document.body.innerHTML = "";
  });

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    Reflect.deleteProperty(window, "nativeApi");
    document.body.innerHTML = "";
    await __resetLocalApiForTests();
    resetAppAtomRegistryForTests();
  });

  function setSourceControlDiscoveryStub(
    discoverSourceControl: () => Promise<SourceControlDiscoveryResult>,
  ) {
    window.nativeApi = {
      persistence: {
        getClientSettings: vi.fn().mockResolvedValue(null),
        setClientSettings: vi.fn().mockResolvedValue(undefined),
      },
      server: {
        discoverSourceControl,
      },
    } as unknown as LocalApi;
  }

  it("shows skeleton sections while the first source control scan is pending", async () => {
    let finishDiscovery!: (result: SourceControlDiscoveryResult) => void;
    const pendingDiscovery = new Promise<SourceControlDiscoveryResult>((resolve) => {
      finishDiscovery = resolve;
    });
    setSourceControlDiscoveryStub(() => pendingDiscovery);

    mounted = await render(
      <AppAtomRegistryProvider>
        <SourceControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Version Control")).toBeInTheDocument();
    await expect.element(page.getByText("Source Control Providers")).toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Rescan server environment" }))
      .toBeDisabled();
    await expect.element(page.getByText("Nothing detected yet")).not.toBeInTheDocument();

    finishDiscovery({ versionControlSystems: [], sourceControlProviders: [] });
    await expect.element(page.getByText("Nothing detected yet")).toBeInTheDocument();
  });

  it("uses the shared empty state when discovery completes without tools", async () => {
    setSourceControlDiscoveryStub(async () => ({
      versionControlSystems: [],
      sourceControlProviders: [],
    }));

    mounted = await render(
      <AppAtomRegistryProvider>
        <SourceControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByText("Nothing detected yet")).toBeInTheDocument();
    await expect
      .element(
        page.getByText(
          "Install Git on the server, add optional hosting integrations or credentials your workspace needs, then rescan.",
        ),
      )
      .toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Scan" })).toBeInTheDocument();
  });

  it("keeps discovered rows instead of showing the empty state", async () => {
    setSourceControlDiscoveryStub(async () => ({
      versionControlSystems: [
        {
          kind: "git",
          label: "Git",
          executable: "git",
          status: "available",
          version: Option.some("git version 2.50.0"),
          installHint: "Install Git.",
          detail: Option.none(),
        },
      ],
      sourceControlProviders: [],
    }));

    mounted = await render(
      <AppAtomRegistryProvider>
        <SourceControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByRole("switch", { name: "Git availability" })).toBeDisabled();
    await expect.element(page.getByText("Nothing detected yet")).not.toBeInTheDocument();
  });

  it("shows Git fetch interval settings inside the Git details dropdown", async () => {
    setSourceControlDiscoveryStub(async () => ({
      versionControlSystems: [
        {
          kind: "git",
          label: "Git",
          executable: "git",
          status: "available",
          version: Option.some("git version 2.50.0"),
          installHint: "Install Git.",
          detail: Option.none(),
        },
      ],
      sourceControlProviders: [],
    }));

    mounted = await render(
      <AppAtomRegistryProvider>
        <SourceControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    const toggle = page.getByRole("button", { name: "Toggle Git details" });
    await expect.element(toggle).toHaveAttribute("aria-expanded", "false");

    await toggle.click();

    await expect.element(toggle).toHaveAttribute("aria-expanded", "true");
    await expect
      .element(page.getByLabelText("Automatic Git fetch interval in seconds"))
      .toBeVisible();
    await expect
      .element(page.getByText("Automatic Git fetches run every 30 seconds"))
      .not.toBeInTheDocument();
  });

  it("does not rescan on remount while the discovery atom is fresh", async () => {
    let calls = 0;
    setSourceControlDiscoveryStub(async () => {
      calls += 1;
      return {
        versionControlSystems: [
          {
            kind: "git",
            label: "Git",
            executable: "git",
            status: "available",
            version: Option.some("git version 2.50.0"),
            installHint: "Install Git.",
            detail: Option.none(),
          },
        ],
        sourceControlProviders: [],
      };
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <SourceControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByRole("switch", { name: "Git availability" })).toBeDisabled();
    expect(calls).toBe(1);

    const teardown = mounted.cleanup ?? mounted.unmount;
    await teardown?.call(mounted).catch(() => {});
    mounted = null;
    document.body.innerHTML = "";

    mounted = await render(
      <AppAtomRegistryProvider>
        <SourceControlSettingsPanel />
      </AppAtomRegistryProvider>,
    );

    await expect.element(page.getByRole("switch", { name: "Git availability" })).toBeDisabled();
    expect(calls).toBe(1);
  });
});
