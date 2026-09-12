import { page, userEvent } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { EmbeddedBrowserWorkspace } from "./EmbeddedBrowserWorkspace";
import type { EmbeddedBrowserState } from "@cafecode/contracts";
import "../index.css";

const originalOverlayDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "windowControlsOverlay",
);
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(navigator, "platform");

const rpc = vi.hoisted(() => ({
  grant: vi.fn(),
  revoke: vi.fn(),
  poll: vi.fn(),
  complete: vi.fn(),
}));

const settings = vi.hoisted(() => ({
  disabled: [] as string[],
  update: vi.fn(),
}));
const primaryEnvironmentId = vi.hoisted(() => vi.fn(() => "environment-local"));
vi.mock("../hooks/useSettings", () => ({
  useClientSettingsHydrated: () => true,
  useSettings: (selector: (value: unknown) => unknown) =>
    selector({ agentBrowserDisabledThreadIds: settings.disabled }),
  useUpdateSettings: () => ({ updateClientSettingsConfirmed: settings.update }),
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: ({ select }: { select: (params: Record<string, string>) => unknown }) =>
    select({ environmentId: "environment-local", threadId: "thread-browser" }),
}));

vi.mock("../environments/primary", () => ({
  usePrimaryEnvironmentId: primaryEnvironmentId,
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
  it("does not read environment or layout state when the desktop browser capability is absent", async () => {
    window.desktopBridge = { getDesktopAppVersion: vi.fn() } as unknown as NonNullable<
      typeof window.desktopBridge
    >;
    const screen = await render(<EmbeddedBrowserWorkspace />);
    expect(primaryEnvironmentId).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole("button", { name: "Open isolated browser" }))
      .not.toBeInTheDocument();
    screen.unmount();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    settings.disabled = [];
    settings.update.mockImplementation(
      async (patch: { agentBrowserDisabledThreadIds: string[] }) => {
        settings.disabled = patch.agentBrowserDisabledThreadIds;
      },
    );
  });
  afterEach(() => {
    Reflect.deleteProperty(window, "desktopBridge");
    if (originalOverlayDescriptor)
      Object.defineProperty(navigator, "windowControlsOverlay", originalOverlayDescriptor);
    else Reflect.deleteProperty(navigator, "windowControlsOverlay");
    if (originalPlatformDescriptor)
      Object.defineProperty(navigator, "platform", originalPlatformDescriptor);
    else Reflect.deleteProperty(navigator, "platform");
    vi.restoreAllMocks();
  });

  it("keeps browser controls below native window buttons through layout and titlebar changes", async () => {
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Win32" });
    await page.viewport(1440, 900);
    const overlay = Object.assign(new EventTarget(), {
      visible: true,
      height: 40,
      getTitlebarAreaRect() {
        return { y: 0, height: this.height };
      },
    });
    Object.defineProperty(navigator, "windowControlsOverlay", {
      configurable: true,
      value: overlay,
    });
    const desktopBridge = {
      openEmbeddedBrowser: vi.fn().mockResolvedValue(privateState),
      closeEmbeddedBrowser: vi.fn().mockResolvedValue(undefined),
      setEmbeddedBrowserBounds: vi.fn().mockResolvedValue(undefined),
      onEmbeddedBrowserState: vi.fn().mockReturnValue(() => undefined),
    };
    window.desktopBridge = desktopBridge as unknown as NonNullable<typeof window.desktopBridge>;
    const rendered = await render(
      <>
        <div
          data-testid="native-window-buttons"
          style={{
            position: "fixed",
            right: 0,
            top: 0,
            width: 144,
            height: 40,
            zIndex: 2147483647,
          }}
        >
          Window controls
        </div>
        <EmbeddedBrowserWorkspace />
      </>,
    );
    await userEvent.click(page.getByRole("button", { name: "Open isolated browser" }));
    await userEvent.click(page.getByRole("button", { name: "Split chat and browser" }));
    const panel = () =>
      document.querySelector<HTMLElement>('section[aria-label="Isolated browser workspace"]')!;
    const checkControls = (top: number) => {
      expect(panel().getBoundingClientRect().top).toBe(top);
      for (const button of panel().querySelectorAll("header button")) {
        const bounds = button.getBoundingClientRect();
        expect(bounds.top).toBeGreaterThanOrEqual(top);
        expect(
          button.contains(
            document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2),
          ),
        ).toBe(true);
      }
    };
    await vi.waitFor(() => checkControls(40));
    expect(
      document
        .querySelector('[role="separator"][aria-label="Resize chat and browser"]')!
        .getBoundingClientRect().top,
    ).toBe(40);
    await userEvent.click(page.getByRole("button", { name: "Maximize browser" }));
    await vi.waitFor(() => checkControls(40));
    overlay.height = 64;
    document.querySelector<HTMLElement>('[data-testid="native-window-buttons"]')!.style.height =
      "64px";
    overlay.dispatchEvent(new Event("geometrychange"));
    await vi.waitFor(() => checkControls(64));
    await userEvent.click(page.getByRole("button", { name: "Restore browser size" }));
    await userEvent.click(page.getByRole("button", { name: "Move browser" }));
    await userEvent.keyboard("{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}");
    await vi.waitFor(() => checkControls(64));
    await userEvent.click(page.getByRole("button", { name: "Split chat and browser" }));
    await page.viewport(800, 900);
    await vi.waitFor(() => checkControls(462));
    expect(panel().getBoundingClientRect().bottom).toBe(852);
    overlay.visible = false;
    document.querySelector<HTMLElement>('[data-testid="native-window-buttons"]')!.style.display =
      "none";
    overlay.dispatchEvent(new Event("geometrychange"));
    await userEvent.click(page.getByRole("button", { name: "Maximize browser" }));
    await vi.waitFor(() => checkControls(0));
    expect(desktopBridge.openEmbeddedBrowser).toHaveBeenCalledOnce();
    expect(desktopBridge.closeEmbeddedBrowser).not.toHaveBeenCalled();
    await rendered.unmount();
    await page.viewport(1280, 720);
  });

  it("allows hiding the panel and retrying when a native tab fails to open", async () => {
    window.desktopBridge = {
      openEmbeddedBrowser: vi
        .fn()
        .mockRejectedValueOnce(new Error("unavailable"))
        .mockResolvedValue(privateState),
      setEmbeddedBrowserBounds: vi.fn().mockResolvedValue(undefined),
      closeEmbeddedBrowser: vi.fn().mockResolvedValue(undefined),
      onEmbeddedBrowserState: vi.fn().mockReturnValue(() => undefined),
    } as unknown as NonNullable<typeof window.desktopBridge>;
    const rendered = await render(<EmbeddedBrowserWorkspace />);
    await userEvent.click(page.getByRole("button", { name: "Open isolated browser" }));
    await userEvent.click(page.getByRole("button", { name: "Hide Agent Browser" }));
    await userEvent.click(page.getByRole("button", { name: "Open isolated browser" }));
    await expect.element(page.getByRole("navigation", { name: "Browser tabs" })).toBeVisible();
    await rendered.unmount();
  });

  it("retains tabs while hidden and reflows a resizable split workspace", async () => {
    await page.viewport(1440, 900);
    rpc.revoke.mockResolvedValue({ status: "inactive", reason: "revoked" });
    rpc.poll.mockResolvedValue({ grant: { status: "inactive", reason: "idle" }, request: null });
    let publish!: (state: EmbeddedBrowserState) => void;
    const second = { ...privateState, tabId: "tab-2", title: "Second page" };
    const desktopBridge = {
      openEmbeddedBrowser: vi
        .fn()
        .mockResolvedValueOnce(privateState)
        .mockResolvedValueOnce(second),
      closeEmbeddedBrowser: vi.fn().mockResolvedValue(undefined),
      setEmbeddedBrowserBounds: vi.fn().mockResolvedValue(undefined),
      onEmbeddedBrowserState: vi.fn((listener: typeof publish) => {
        publish = listener;
        return () => undefined;
      }),
    };
    window.desktopBridge = desktopBridge as unknown as NonNullable<typeof window.desktopBridge>;
    const rendered = await render(
      <>
        <div
          data-testid="test-chat"
          style={{
            width: "var(--cafe-browser-chat-width, 100%)",
            height: "var(--cafe-browser-chat-height, 100dvh)",
          }}
        >
          Chat instructions
        </div>
        <EmbeddedBrowserWorkspace />
      </>,
    );
    await userEvent.click(page.getByRole("button", { name: "Open isolated browser" }));
    await userEvent.click(page.getByRole("button", { name: "New browser tab" }));
    await expect
      .element(page.getByRole("button", { name: "Open browser tab: Second page" }))
      .toHaveAttribute("aria-pressed", "true");
    publish({ ...sharedState, title: "Shared background" });
    let releaseRevoke!: () => void;
    rpc.revoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseRevoke = resolve;
        }),
    );
    await userEvent.click(
      page.getByRole("button", { name: "Open browser tab: Shared background" }),
    );
    await vi.waitFor(() => expect(releaseRevoke).toBeTypeOf("function"));
    publish({
      ...privateState,
      title: "Navigated while switching",
      displayUrl: "https://other.test/",
    });
    releaseRevoke();
    await expect
      .element(page.getByRole("button", { name: "Open browser tab: Navigated while switching" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect
      .element(page.getByRole("textbox", { name: "Browser address" }))
      .toHaveValue("https://other.test/");
    expect(rpc.poll).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole("button", { name: "Open browser tab: Second page" }));
    publish({ ...privateState, title: "Background updated" });
    await expect
      .element(page.getByRole("button", { name: "Open browser tab: Background updated" }))
      .toHaveAttribute("aria-pressed", "false");
    await userEvent.click(page.getByRole("button", { name: "Hide Agent Browser" }));
    expect(desktopBridge.closeEmbeddedBrowser).not.toHaveBeenCalled();
    await expect.element(page.getByRole("navigation", { name: "Browser tabs" })).toBeVisible();
    await userEvent.click(
      page.getByRole("button", { name: "Open browser tab: Background updated" }),
    );
    expect(desktopBridge.openEmbeddedBrowser).toHaveBeenCalledTimes(2);
    await vi.waitFor(() =>
      expect(desktopBridge.setEmbeddedBrowserBounds).toHaveBeenLastCalledWith(
        expect.objectContaining({ tabId: "tab-1", visible: true }),
      ),
    );

    const panel = () =>
      document
        .querySelector<HTMLElement>('section[aria-label="Isolated browser workspace"]')!
        .getBoundingClientRect();
    const chat = () =>
      document.querySelector<HTMLElement>('[data-testid="test-chat"]')!.getBoundingClientRect();
    await userEvent.click(page.getByRole("button", { name: "Split chat and browser" }));
    await vi.waitFor(() => {
      expect(chat().width).toBe(716);
      expect(panel().left).toBe(724);
      expect(panel().width).toBe(716);
      expect(panel().bottom).toBe(852);
    });
    const divider = page.getByRole("separator", { name: "Resize chat and browser" });
    await userEvent.click(divider);
    await userEvent.keyboard("{ArrowLeft}");
    await vi.waitFor(() => expect(chat().width).toBeLessThan(716));
    await userEvent.keyboard("{Home}");
    await vi.waitFor(() => expect(chat().width).toBe(716));
    await userEvent.click(page.getByRole("button", { name: "Use floating browser" }));
    const previousWidth = panel().width;
    await userEvent.click(page.getByRole("button", { name: "Resize browser" }));
    await userEvent.keyboard("{ArrowLeft}");
    await vi.waitFor(() => expect(panel().width).toBe(previousWidth - 16));
    await userEvent.click(page.getByRole("button", { name: "Split chat and browser" }));
    await page.viewport(800, 900);
    await vi.waitFor(() => {
      expect(chat().height).toBe(422);
      expect(panel().top).toBe(430);
      expect(panel().width).toBe(800);
    });
    await userEvent.click(page.getByRole("button", { name: "Minimize Agent Browser" }));
    await vi.waitFor(() => expect(chat().height).toBe(852));
    expect(desktopBridge.closeEmbeddedBrowser).not.toHaveBeenCalled();
    await rendered.unmount();
    expect(desktopBridge.closeEmbeddedBrowser).toHaveBeenCalledWith({ tabId: "tab-1" });
    expect(desktopBridge.closeEmbeddedBrowser).toHaveBeenCalledWith({ tabId: "tab-2" });
    await page.viewport(1280, 720);
  });

  it("reports a failed native action even when the broker accepts its result", async () => {
    rpc.revoke.mockResolvedValue({ status: "inactive", reason: "revoked" });
    rpc.poll.mockResolvedValue({
      grant,
      request: { ...request, action: { type: "history", action: "back" } },
    });
    rpc.complete.mockResolvedValue({ accepted: true, grant });
    const desktopBridge = {
      openEmbeddedBrowser: vi.fn().mockResolvedValue(sharedState),
      closeEmbeddedBrowser: vi.fn().mockResolvedValue(undefined),
      setEmbeddedBrowserBounds: vi.fn().mockResolvedValue(undefined),
      onEmbeddedBrowserState: vi.fn().mockReturnValue(() => undefined),
      controlEmbeddedBrowserHistory: vi.fn().mockResolvedValue({
        status: "failed",
        message: "Cannot go back.",
        state: sharedState,
      }),
    };
    window.desktopBridge = desktopBridge as unknown as NonNullable<typeof window.desktopBridge>;
    const rendered = await render(<EmbeddedBrowserWorkspace />);
    await userEvent.click(page.getByRole("button", { name: "Open isolated browser" }));
    await userEvent.click(page.getByText("Browser tools", { exact: true }));
    await expect.element(page.getByText("Cannot go back.", { exact: true })).toBeVisible();
    expect(desktopBridge.controlEmbeddedBrowserHistory).toHaveBeenCalledOnce();
    await rendered.unmount();
  });

  it.each(["page sharing", "thread access"])(
    "can revoke %s while an agent snapshot is running",
    async (scope) => {
      rpc.revoke.mockResolvedValue({ status: "inactive", reason: "revoked" });
      rpc.poll.mockResolvedValue({ grant, request });
      rpc.complete.mockResolvedValue({
        accepted: false,
        grant: { status: "inactive", reason: "revoked" },
      });
      let finishSnapshot!: () => void;
      const desktopBridge = {
        openEmbeddedBrowser: vi.fn().mockResolvedValue(sharedState),
        closeEmbeddedBrowser: vi.fn().mockResolvedValue(undefined),
        setEmbeddedBrowserBounds: vi.fn().mockResolvedValue(undefined),
        onEmbeddedBrowserState: vi.fn().mockReturnValue(() => undefined),
        shareEmbeddedBrowser: vi.fn().mockResolvedValue({
          status: "completed",
          message: "revoked",
          state: privateState,
        }),
        snapshotEmbeddedBrowser: vi.fn(
          () =>
            new Promise<null>((resolve) => {
              finishSnapshot = () => resolve(null);
            }),
        ),
      };
      window.desktopBridge = desktopBridge as unknown as NonNullable<typeof window.desktopBridge>;
      const rendered = await render(<EmbeddedBrowserWorkspace />);
      await userEvent.click(page.getByRole("button", { name: "Open isolated browser" }));
      await vi.waitFor(() => expect(desktopBridge.snapshotEmbeddedBrowser).toHaveBeenCalledOnce());
      if (scope === "page sharing") {
        await userEvent.click(page.getByRole("button", { name: "Revoke page sharing" }));
        expect(desktopBridge.shareEmbeddedBrowser).toHaveBeenCalledWith({
          tabId: "tab-1",
          shared: false,
        });
        await vi.waitFor(() =>
          expect(rpc.revoke).toHaveBeenCalledWith({ reason: "origin-changed" }),
        );
      } else {
        await userEvent.click(page.getByText("Browser tools", { exact: true }));
        await userEvent.click(page.getByRole("button", { name: "Disable for this thread" }));
        expect(settings.update).toHaveBeenCalledWith({
          agentBrowserDisabledThreadIds: ["thread-browser"],
        });
      }
      finishSnapshot();
      await vi.waitFor(() => expect(rpc.complete).toHaveBeenCalled());
      await rendered.unmount();
    },
  );

  it("discards an expired action from a delayed poll response", async () => {
    rpc.revoke.mockResolvedValue({ status: "inactive", reason: "revoked" });
    rpc.poll.mockResolvedValue({
      grant,
      request: { ...request, expiresAt: "2000-01-01T00:00:00.000Z" },
    });
    const desktopBridge = {
      openEmbeddedBrowser: vi.fn().mockResolvedValue(sharedState),
      closeEmbeddedBrowser: vi.fn().mockResolvedValue(undefined),
      setEmbeddedBrowserBounds: vi.fn().mockResolvedValue(undefined),
      onEmbeddedBrowserState: vi.fn().mockReturnValue(() => undefined),
      snapshotEmbeddedBrowser: vi.fn().mockResolvedValue(snapshot),
    };
    window.desktopBridge = desktopBridge as unknown as NonNullable<typeof window.desktopBridge>;
    const rendered = await render(<EmbeddedBrowserWorkspace />);
    await userEvent.click(page.getByRole("button", { name: "Open isolated browser" }));
    await vi.waitFor(() => expect(rpc.poll).toHaveBeenCalled());
    await vi.waitFor(() => expect(desktopBridge.setEmbeddedBrowserBounds).toHaveBeenCalled());
    expect(desktopBridge.snapshotEmbeddedBrowser).not.toHaveBeenCalled();
    expect(rpc.complete).not.toHaveBeenCalled();
    await rendered.unmount();
  });

  it("binds the active requester and executes a polled snapshot through the desktop bridge", async () => {
    let resolveSnapshot!: (value: typeof snapshot) => void;
    const pendingSnapshot = new Promise<typeof snapshot>((resolve) => {
      resolveSnapshot = resolve;
    });
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
      snapshotEmbeddedBrowser: vi
        .fn()
        .mockReturnValueOnce(pendingSnapshot)
        .mockResolvedValue(snapshot),
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

    await vi.waitFor(() => expect(desktopBridge.snapshotEmbeddedBrowser).toHaveBeenCalledTimes(1));
    const pendingPollCount = rpc.poll.mock.calls.length;
    await vi.waitFor(() => expect(rpc.poll.mock.calls.length).toBeGreaterThan(pendingPollCount), {
      timeout: 3_000,
    });
    expect(rpc.complete).not.toHaveBeenCalled();
    expect(desktopBridge.snapshotEmbeddedBrowser).toHaveBeenCalledTimes(1);
    resolveSnapshot(snapshot);
    await vi.waitFor(() => {
      expect(rpc.grant).not.toHaveBeenCalled();
      expect(rpc.poll).toHaveBeenCalledWith({
        tabId: "tab-1",
        origin: "https://example.test",
        defaultAccess: true,
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
    await userEvent.click(page.getByText("Browser tools", { exact: true }));
    await expect.element(page.getByText(/thread thread-browser · provider codex/)).toBeVisible();
    let confirmSettings!: () => void;
    settings.update.mockImplementationOnce(
      (patch: { agentBrowserDisabledThreadIds: string[] }) =>
        new Promise<void>((resolve) => {
          confirmSettings = () => {
            settings.disabled = patch.agentBrowserDisabledThreadIds;
            resolve();
          };
        }),
    );
    await userEvent.click(page.getByRole("button", { name: "Disable for this thread" }));
    expect(settings.update).toHaveBeenCalledWith({
      agentBrowserDisabledThreadIds: ["thread-browser"],
    });
    const pollCount = rpc.poll.mock.calls.length;
    rpc.poll.mockResolvedValueOnce({
      grant,
      request: { ...request, requestId: "request-during-disable" },
    });
    await vi.waitFor(() => expect(rpc.poll.mock.calls.length).toBeGreaterThan(pollCount), {
      timeout: 3_000,
    });
    // Polling causes renders while persistence is pending; they must not reset
    // the local deny and execute another request from the disabled thread.
    expect(desktopBridge.snapshotEmbeddedBrowser).toHaveBeenCalledTimes(1);
    confirmSettings();
    await expect
      .element(page.getByRole("button", { name: "Enable for this thread" }))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Minimize Agent Browser" }));
    expect(desktopBridge.setEmbeddedBrowserBounds).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "tab-1",
        visible: false,
      }),
    );
    expect(desktopBridge.closeEmbeddedBrowser).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole("button", { name: /Resume Agent Browser/ }));
    expect(desktopBridge.openEmbeddedBrowser).toHaveBeenCalledTimes(1);
    await vi.waitFor(() =>
      expect(desktopBridge.setEmbeddedBrowserBounds).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tabId: "tab-1",
          visible: true,
        }),
      ),
    );
    await userEvent.click(page.getByRole("button", { name: "Minimize Agent Browser" }));
    // Another enabled thread can request the browser while the current thread
    // remains disabled, and the request restores the existing logged-in tab.
    rpc.poll.mockResolvedValueOnce({
      grant,
      request: { ...request, requestId: "background-request", threadId: "background-thread" },
    });
    await vi.waitFor(() => expect(desktopBridge.snapshotEmbeddedBrowser).toHaveBeenCalledTimes(2), {
      timeout: 3_000,
    });
    await expect
      .element(page.getByRole("button", { name: "Minimize Agent Browser" }))
      .toBeVisible();
    expect(desktopBridge.openEmbeddedBrowser).toHaveBeenCalledTimes(1);
    expect(desktopBridge.closeEmbeddedBrowser).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(rpc.complete).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "background-request" }),
      ),
    );
    const completedPollCount = rpc.poll.mock.calls.length;
    rpc.poll.mockResolvedValueOnce({
      grant,
      request: { ...request, requestId: "background-request", threadId: "background-thread" },
    });
    await vi.waitFor(() => expect(rpc.poll.mock.calls.length).toBeGreaterThan(completedPollCount), {
      timeout: 3_000,
    });
    // A delayed heartbeat reply may still carry the completed action.
    expect(desktopBridge.snapshotEmbeddedBrowser).toHaveBeenCalledTimes(2);
    await userEvent.click(page.getByRole("button", { name: "Hide Agent Browser" }));
    expect(desktopBridge.closeEmbeddedBrowser).not.toHaveBeenCalled();
    await userEvent.click(page.getByRole("button", { name: /Resume Agent Browser/ }));
    await userEvent.click(page.getByText("Browser tools", { exact: true }));
    await userEvent.click(page.getByRole("button", { name: "End tab session" }));
    expect(desktopBridge.closeEmbeddedBrowser).toHaveBeenCalledWith({ tabId: "tab-1" });
    await rendered.unmount();
  });
});
