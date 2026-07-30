import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { EmbeddedBrowserWorkspace } from "./EmbeddedBrowserWorkspace";

const rpc = vi.hoisted(() => ({
  grant: vi.fn(),
  revoke: vi.fn(),
  poll: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: ({ select }: { select: (params: Record<string, string>) => unknown }) =>
    select({ environmentId: "environment-local", threadId: "thread-browser" }),
}));

vi.mock("../environments/primary", () => ({
  getPrimaryKnownEnvironment: () => ({ environmentId: "environment-local" }),
}));

vi.mock("../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    client: { agentBrowser: rpc },
  }),
}));

vi.mock("../store", () => ({
  useStore: (selector: (state: unknown) => unknown) =>
    selector({
      environmentStateById: {
        "environment-local": {
          threadShellById: {
            "thread-browser": {
              modelSelection: { instanceId: "codex", model: "gpt-5.6" },
            },
          },
        },
      },
    }),
}));

const privateState = {
  status: "open" as const,
  tabId: "tab-1",
  displayUrl: "https://example.test/",
  title: "Example",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  shared: false,
  sharedOrigin: null,
};
const sharedState = {
  ...privateState,
  shared: true,
  sharedOrigin: "https://example.test",
};
const grant = {
  status: "active" as const,
  grantId: "grant-1",
  threadId: "thread-browser",
  providerInstanceId: "codex",
  tabId: "tab-1",
  origin: "https://example.test",
  grantedAt: "2026-07-23T12:00:00.000Z",
  expiresAt: "2099-07-23T12:05:00.000Z",
  requestCount: 1,
  requestLimit: 40 as const,
  pendingAction: "Read a redacted DOM/accessibility snapshot",
};
const request = {
  requestId: "request-1",
  grantId: "grant-1",
  threadId: "thread-browser",
  providerInstanceId: "codex",
  tabId: "tab-1",
  origin: "https://example.test",
  action: { type: "snapshot" as const },
  summary: "Read a redacted DOM/accessibility snapshot",
  createdAt: "2026-07-23T12:00:00.000Z",
  expiresAt: "2099-07-23T12:01:30.000Z",
};
const snapshot = {
  snapshotId: "snapshot-1",
  mode: "dom-accessibility" as const,
  displayUrl: "https://example.test/",
  title: "Example",
  capturedAt: "2026-07-23T12:00:01.000Z",
  text: "Visible page text",
  targets: [],
  imageRegions: [],
  ocr: null,
  redactionNotice: "Form values omitted.",
};

describe("EmbeddedBrowserWorkspace agent grant", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("binds the active requester and executes a polled snapshot through the desktop bridge", async () => {
    rpc.grant.mockResolvedValue(grant);
    rpc.revoke.mockResolvedValue({ status: "inactive", reason: "revoked" });
    rpc.poll
      .mockResolvedValueOnce({ grant, request })
      .mockResolvedValue({ grant: { ...grant, pendingAction: null }, request: null });
    rpc.complete.mockResolvedValue({
      accepted: true,
      grant: { ...grant, pendingAction: null },
    });
    const desktopBridge = {
      openEmbeddedBrowser: vi.fn().mockResolvedValue(privateState),
      closeEmbeddedBrowser: vi.fn().mockResolvedValue(undefined),
      setEmbeddedBrowserBounds: vi.fn().mockResolvedValue(undefined),
      onEmbeddedBrowserState: vi.fn().mockReturnValue(() => undefined),
      shareEmbeddedBrowser: vi
        .fn()
        .mockResolvedValue({ status: "completed", message: "shared", state: sharedState }),
      snapshotEmbeddedBrowser: vi.fn().mockResolvedValue(snapshot),
      navigateEmbeddedBrowser: vi.fn(),
      controlEmbeddedBrowserHistory: vi.fn(),
      clickEmbeddedBrowser: vi.fn(),
      typeInEmbeddedBrowser: vi.fn(),
      confirm: vi.fn(),
    };
    window.desktopBridge = desktopBridge as unknown as NonNullable<typeof window.desktopBridge>;

    const rendered = await render(<EmbeddedBrowserWorkspace />);
    await userEvent.click(page.getByRole("button", { name: "Open isolated browser" }));
    await userEvent.click(page.getByRole("button", { name: "Share current origin" }));
    await userEvent.click(page.getByRole("button", { name: "Grant 5 minutes" }));

    await vi.waitFor(() => {
      expect(rpc.grant).toHaveBeenCalledWith({
        threadId: "thread-browser",
        providerInstanceId: "codex",
        tabId: "tab-1",
        origin: "https://example.test",
        durationSeconds: 300,
      });
      expect(desktopBridge.snapshotEmbeddedBrowser).toHaveBeenCalledWith({
        tabId: "tab-1",
        mode: "dom-accessibility",
      });
      expect(rpc.complete).toHaveBeenCalledWith(
        expect.objectContaining({
          context: { tabId: "tab-1", origin: "https://example.test" },
          requestId: "request-1",
          result: { type: "snapshot", snapshot },
        }),
      );
    });
    await expect.element(page.getByText(/thread thread-browser · provider codex/)).toBeVisible();
    await rendered.unmount();
  });
});
