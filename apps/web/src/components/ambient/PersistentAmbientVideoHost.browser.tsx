import "../../index.css";

import { QueryClient } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
  useLocation,
} from "@tanstack/react-router";
import { StrictMode, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

const mocks = vi.hoisted(() => ({
  authGateState: { status: "authenticated" } as
    | { status: "authenticated" }
    | {
        status: "requires-auth";
        auth: {
          policy: "remote-reachable";
          bootstrapMethods: ["one-time-token"];
          sessionMethods: ["browser-session-cookie"];
          sessionCookieName: string;
        };
      },
  settings: {
    ambientVideoEnabled: true,
    ambientVideoKeepAboveContent: false,
    ambientVideoSource: {
      kind: "video" as const,
      id: "dQw4w9WgXcQ",
    } as { kind: "video"; id: string } | null,
    ambientVideoPresetPlacement: "bottom-right" as "bottom-left" | "bottom-right",
    ambientVideoPresetSize: "medium" as "small" | "medium" | "large",
    ambientVideoPresentationMode: "floating" as "floating" | "cinema",
    powerSaveBlockerMode: "disabled",
    continueBackgroundAnimations: false,
    sidebarStarSpeed: 1,
  },
  settingsListeners: new Set<() => void>(),
  serverListeners: new Set<() => void>(),
  updateSettings: vi.fn(),
  resolveAuthGate: vi.fn(),
  // Injected render failure for the shell-owned player. The router shell mounts
  // the host above every route error boundary, so an uncaught throw here would
  // reach the React root and unmount the whole renderer.
  embedUrlFailure: null as Error | null,
  serverConfig: {
    ambientExperienceCapabilities: {
      youtubePlayer: true as boolean,
    },
    cwd: "/workspace",
    environment: {
      environmentId: "environment-test",
    },
  },
}));

vi.mock("../../hooks/useSettings", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useSettings: <T,>(selector?: (settings: typeof mocks.settings) => T) => {
      const settings = useSyncExternalStore(
        (listener) => {
          mocks.settingsListeners.add(listener);
          return () => mocks.settingsListeners.delete(listener);
        },
        () => mocks.settings,
      );
      return selector ? selector(settings) : settings;
    },
    useUpdateSettings: () => ({ updateSettings: mocks.updateSettings }),
  };
});

vi.mock("../../rpc/serverState", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    getServerConfigUpdatedNotification: () => null,
    startServerStateSync: () => undefined,
    useServerConfig: () =>
      useSyncExternalStore(
        (listener) => {
          mocks.serverListeners.add(listener);
          return () => mocks.serverListeners.delete(listener);
        },
        () => mocks.serverConfig,
      ),
    useServerConfigUpdatedSubscription: () => undefined,
    useServerWelcomeSubscription: () => undefined,
  };
});

vi.mock("../../ambientVideo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../ambientVideo")>();
  return {
    ...actual,
    youtubeEmbedUrl: (...args: Parameters<typeof actual.youtubeEmbedUrl>) => {
      if (mocks.embedUrlFailure) {
        throw mocks.embedUrlFailure;
      }
      return actual.youtubeEmbedUrl(...args);
    },
  };
});

vi.mock("../../environments/primary", () => ({
  ensurePrimaryEnvironmentReady: vi.fn(async () => undefined),
  getPrimaryKnownEnvironment: vi.fn(() => null),
  resolveInitialServerAuthGateState: mocks.resolveAuthGate,
  updatePrimaryEnvironmentDescriptor: vi.fn(),
}));

vi.mock("../../environments/runtime", () => ({
  ensureEnvironmentConnectionBootstrapped: vi.fn(async () => undefined),
  getPrimaryEnvironmentConnection: vi.fn(),
  startEnvironmentConnectionService: vi.fn(() => undefined),
}));

vi.mock("../AppSidebarLayout", () => ({
  AppSidebarLayout: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../CommandPalette", () => ({
  CommandPalette: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../InitialBackendBootstrapSurface", () => ({
  InitialBackendBootstrapSurface: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../OnboardingSurface", () => ({
  OnboardingSurface: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../DesktopNotificationWatcher", () => ({
  DesktopNotificationWatcher: () => null,
}));
vi.mock("../ProviderUpdateLaunchNotification", () => ({
  ProviderUpdateLaunchNotification: () => null,
}));
vi.mock("../WebSocketConnectionSurface", () => ({
  WebSocketConnectionCoordinator: () => null,
  WebSocketConnectionSurface: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../ui/toast", () => ({
  AnchoredToastProvider: ({ children }: { children: ReactNode }) => children,
  ToastProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="authenticated-shell">{children}</div>
  ),
  stackedThreadToast: (toast: unknown) => toast,
  toastManager: { add: vi.fn() },
}));
vi.mock("../../documentVisibility", () => ({
  applyCafeBackgroundAnimations: vi.fn(),
  clearCafeBackgroundAnimations: vi.fn(),
  startCafeDocumentVisibilitySync: vi.fn(() => undefined),
}));
vi.mock("../../editorPreferences", () => ({
  resolveAndPersistPreferredEditor: vi.fn(() => null),
}));
vi.mock("../../hooks/useTheme", () => ({
  syncBrowserChromeTheme: vi.fn(),
}));
vi.mock("../../localApi", () => ({
  readLocalApi: vi.fn(() => null),
}));
vi.mock("../../logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: vi.fn(() => null),
  derivePhysicalProjectKeyFromPath: vi.fn(() => null),
  selectProjectGroupingSettings: vi.fn(() => ({})),
}));
vi.mock("../../observability/clientTracing", () => ({
  configureClientTracing: vi.fn(async () => undefined),
}));
vi.mock("../../store", () => ({
  selectAnyThreadRunning: vi.fn(() => false),
  useStore: (selector: (state: { setActiveEnvironmentId: () => void }) => unknown) =>
    selector({ setActiveEnvironmentId: vi.fn() }),
}));
vi.mock("../../themeAccent", () => ({
  applyAppAccentColor: vi.fn(),
  applySidebarAccentColor: vi.fn(),
  applySidebarStarSpeed: vi.fn(),
}));
vi.mock("../../uiStateStore", () => ({
  useUiStateStore: (
    selector: (state: {
      setProjectExpanded: (projectKey: string, expanded: boolean) => void;
    }) => unknown,
  ) => selector({ setProjectExpanded: vi.fn() }),
}));

import { createRouterShell } from "../../routerShell";
import { Route as RootRoute } from "../../routes/__root";

function updateMockSettings(patch: Partial<typeof mocks.settings>) {
  mocks.settings = { ...mocks.settings, ...patch };
  for (const listener of mocks.settingsListeners) listener();
}

function updateMockCapability(enabled: boolean) {
  mocks.serverConfig = {
    ...mocks.serverConfig,
    ambientExperienceCapabilities: {
      youtubePlayer: enabled,
    },
  };
  for (const listener of mocks.serverListeners) listener();
}

function TestRouteSurface() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return <main data-testid="route-content">{pathname}</main>;
}

const indexRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/",
  component: TestRouteSurface,
});
const settingsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/settings",
  component: TestRouteSurface,
});
const pairRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/pair",
  component: TestRouteSurface,
});
const routeTree = RootRoute.addChildren([indexRoute, settingsRoute, pairRoute]);

function createTestRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { queryClient },
    Wrap: createRouterShell(queryClient),
  });
}

function currentFrame(): HTMLIFrameElement {
  const frame = document.querySelector<HTMLIFrameElement>(
    'iframe[title="Ambient YouTube video player"]',
  );
  expect(frame).not.toBeNull();
  return frame!;
}

function expectSameFrame(
  initialFrame: HTMLIFrameElement,
  initialParent: HTMLElement | null,
  initialSource: string,
) {
  expect(currentFrame()).toBe(initialFrame);
  expect(currentFrame().parentElement).toBe(initialParent);
  expect(currentFrame().src).toBe(initialSource);
  expect(document.querySelectorAll("iframe[src*='youtube-nocookie.com']")).toHaveLength(1);
  expect(document.querySelectorAll('[data-testid="persistent-ambient-video-host"]')).toHaveLength(
    1,
  );
}

describe("PersistentAmbientVideoHost router ownership", () => {
  beforeEach(() => {
    mocks.updateSettings.mockReset();
    mocks.resolveAuthGate.mockClear();
    mocks.resolveAuthGate.mockImplementation(async () => mocks.authGateState);
    mocks.authGateState = { status: "authenticated" };
    mocks.embedUrlFailure = null;
    updateMockSettings({
      ambientVideoEnabled: true,
      ambientVideoKeepAboveContent: false,
      ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" },
      ambientVideoPresetPlacement: "bottom-right",
      ambientVideoPresetSize: "medium",
      ambientVideoPresentationMode: "floating",
    });
    updateMockCapability(true);
  });

  it("preserves exact iframe identity through real root auth, refetch, and route transitions", async () => {
    const router = createTestRouter();
    const screen = await render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );

    try {
      await expect.element(page.getByTestId("route-content")).toHaveTextContent("/");
      await expect.element(page.getByTestId("authenticated-shell")).toBeInTheDocument();
      const initialFrame = currentFrame();
      const initialParent = initialFrame.parentElement;
      const initialSource = initialFrame.src;
      expectSameFrame(initialFrame, initialParent, initialSource);

      await router.navigate({ to: "/settings" });
      await expect.element(page.getByTestId("route-content")).toHaveTextContent("/settings");
      expectSameFrame(initialFrame, initialParent, initialSource);

      mocks.authGateState = {
        status: "requires-auth",
        auth: {
          policy: "remote-reachable",
          bootstrapMethods: ["one-time-token"],
          sessionMethods: ["browser-session-cookie"],
          sessionCookieName: "cafe_session",
        },
      };
      await router.invalidate({ sync: true });
      await expect.element(page.getByTestId("authenticated-shell")).not.toBeInTheDocument();
      expectSameFrame(initialFrame, initialParent, initialSource);

      mocks.authGateState = { status: "authenticated" };
      await router.invalidate({ sync: true });
      await router.invalidate({ sync: true });
      await expect.element(page.getByTestId("authenticated-shell")).toBeInTheDocument();
      expect(mocks.resolveAuthGate.mock.calls.length).toBeGreaterThanOrEqual(4);
      expectSameFrame(initialFrame, initialParent, initialSource);

      // A reconnect snapshot replaces the server-config object while retaining
      // the capability and configured source. Backend-authoritative settings
      // are re-decoded on that boundary, so the source arrives as a new object
      // carrying the same value; neither identity churn may remount the host
      // or rewrite the iframe's src.
      updateMockCapability(true);
      updateMockSettings({ ambientVideoSource: { kind: "video", id: "dQw4w9WgXcQ" } });
      expectSameFrame(initialFrame, initialParent, initialSource);

      await router.navigate({ to: "/pair" });
      await expect.element(page.getByTestId("route-content")).toHaveTextContent("/pair");
      await expect.element(page.getByTestId("authenticated-shell")).not.toBeInTheDocument();
      expectSameFrame(initialFrame, initialParent, initialSource);

      await router.navigate({ to: "/" });
      await expect.element(page.getByTestId("route-content")).toHaveTextContent("/");
      await expect.element(page.getByTestId("authenticated-shell")).toBeInTheDocument();
      expectSameFrame(initialFrame, initialParent, initialSource);
    } finally {
      await screen.unmount();
    }
  });

  it("preserves exact iframe identity through repeated root loader errors and recovery", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const router = createTestRouter();
    const screen = await render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );

    try {
      await expect.element(page.getByTestId("route-content")).toHaveTextContent("/");
      const initialFrame = currentFrame();
      const initialParent = initialFrame.parentElement;
      const initialSource = initialFrame.src;

      // Two full error/recovery cycles: re-entering the root error boundary
      // after it has already reset is where a shell that lived inside the route
      // tree would lose the player a second time.
      for (const attempt of [1, 2]) {
        mocks.resolveAuthGate.mockRejectedValueOnce(
          new Error(`Controlled root loader failure ${attempt}`),
        );
        await router.invalidate({ sync: true });
        await expect
          .element(page.getByRole("heading", { name: "Something went wrong." }))
          .toBeVisible();
        expectSameFrame(initialFrame, initialParent, initialSource);

        await router.invalidate({ sync: true });
        await expect.element(page.getByTestId("route-content")).toHaveTextContent("/");
        await expect.element(page.getByTestId("authenticated-shell")).toBeInTheDocument();
        expectSameFrame(initialFrame, initialParent, initialSource);
      }
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
      await screen.unmount();
    }
  });

  it("contains an ambient render failure instead of unmounting the renderer", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const router = createTestRouter();
    const screen = await render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );

    try {
      await expect.element(page.getByTestId("route-content")).toHaveTextContent("/");
      currentFrame();

      // The shell owns the player above every router error boundary, so an
      // ambient render failure has no boundary between it and the React root.
      // It must fail closed to a hidden player, never to a blank window. A
      // source change is used as the trigger because that is the one input the
      // compiler-memoized embed URL actually recomputes from.
      mocks.embedUrlFailure = new Error("Controlled ambient player render failure");
      updateMockSettings({ ambientVideoSource: { kind: "video", id: "9bZkp7q19f0" } });

      await expect.element(page.getByTitle("Ambient YouTube video player")).not.toBeInTheDocument();
      await expect.element(page.getByTestId("route-content")).toHaveTextContent("/");
      await expect.element(page.getByTestId("authenticated-shell")).toBeInTheDocument();
      expect(document.querySelectorAll("iframe[src*='youtube-nocookie.com']")).toHaveLength(0);
      expect(
        document.querySelectorAll('[data-testid="persistent-ambient-video-host"]'),
      ).toHaveLength(0);
      expect(
        consoleError.mock.calls.some((call) => String(call[0]).includes("[AMBIENT_VIDEO]")),
      ).toBe(true);

      // A contained failure must not keep re-rendering the broken subtree: the
      // player stays hidden until the documented renderer-reload boundary.
      mocks.embedUrlFailure = null;
      updateMockSettings({ ambientVideoSource: { kind: "video", id: "M7lc1UVf-VE" } });
      await expect.element(page.getByTestId("route-content")).toHaveTextContent("/");
      expect(document.querySelectorAll("iframe[src*='youtube-nocookie.com']")).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
      await screen.unmount();
    }
  });

  it.each(["disable", "clear source", "revoke capability"] as const)(
    "unmounts intentionally after %s",
    async (transition) => {
      const router = createTestRouter();
      const screen = await render(
        <StrictMode>
          <RouterProvider router={router} />
        </StrictMode>,
      );

      try {
        currentFrame();
        if (transition === "disable") {
          updateMockSettings({ ambientVideoEnabled: false });
        } else if (transition === "clear source") {
          updateMockSettings({ ambientVideoSource: null });
        } else {
          updateMockCapability(false);
        }
        await expect
          .element(page.getByTitle("Ambient YouTube video player"))
          .not.toBeInTheDocument();
      } finally {
        await screen.unmount();
      }
    },
  );
});
