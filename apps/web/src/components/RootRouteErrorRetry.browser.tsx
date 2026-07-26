import "../index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

const mocks = vi.hoisted(() => ({
  resolveAuthGate: vi.fn(),
}));

vi.mock("../environments/primary", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../environments/primary")>()),
  ensurePrimaryEnvironmentReady: vi.fn(async () => undefined),
  getPrimaryKnownEnvironment: vi.fn(() => null),
  resolveInitialServerAuthGateState: mocks.resolveAuthGate,
  updatePrimaryEnvironmentDescriptor: vi.fn(),
}));

vi.mock("../documentVisibility", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../documentVisibility")>()),
  applyCafeBackgroundAnimations: vi.fn(),
  clearCafeBackgroundAnimations: vi.fn(),
  startCafeDocumentVisibilitySync: vi.fn(() => undefined),
}));

vi.mock("../hooks/useTheme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../hooks/useTheme")>()),
  syncBrowserChromeTheme: vi.fn(),
}));

import { Route as RootRoute } from "../routes/__root";

const requiresAuthState = {
  status: "requires-auth" as const,
  auth: {
    policy: "remote-reachable" as const,
    bootstrapMethods: ["one-time-token" as const],
    sessionMethods: ["browser-session-cookie" as const],
    sessionCookieName: "cafe_session",
  },
};

function RouteSurface() {
  return <main data-testid="route-content">Recovered route content</main>;
}

const indexRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/",
  component: RouteSurface,
});
const routeTree = RootRoute.addChildren([indexRoute]);

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
    Wrap: ({ children }) => createElement(QueryClientProvider, { client: queryClient }, children),
  });
}

describe("root route error recovery", () => {
  beforeEach(() => {
    mocks.resolveAuthGate.mockReset();
    mocks.resolveAuthGate.mockResolvedValue(requiresAuthState);
  });

  it("re-runs a failed root loader when Try again is selected", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const router = createTestRouter();
    const screen = await render(<RouterProvider router={router} />);

    try {
      await expect.element(page.getByTestId("route-content")).toBeVisible();

      mocks.resolveAuthGate.mockRejectedValueOnce(new Error("Controlled root loader failure"));
      await router.invalidate({ sync: true });

      await expect
        .element(page.getByRole("heading", { name: "Something went wrong." }))
        .toBeVisible();
      await expect.element(page.getByTestId("route-content")).not.toBeInTheDocument();

      const loaderCallsBeforeRetry = mocks.resolveAuthGate.mock.calls.length;
      await page.getByRole("button", { name: "Try again" }).click();

      await expect.element(page.getByTestId("route-content")).toBeVisible();
      await expect
        .element(page.getByRole("heading", { name: "Something went wrong." }))
        .not.toBeInTheDocument();
      expect(mocks.resolveAuthGate.mock.calls.length).toBeGreaterThan(loaderCallsBeforeRetry);
    } finally {
      consoleError.mockRestore();
      consoleWarn.mockRestore();
      await screen.unmount();
    }
  });
});
