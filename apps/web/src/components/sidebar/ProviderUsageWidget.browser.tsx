import "../../index.css";

import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@cafecode/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { StrictMode } from "react";

import { ProviderUsageWidget } from "./ProviderUsageWidget";

function provider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make("codex-private-id"),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Codex Personal",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-25T20:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    accountRateLimits: {
      checkedAt: "2026-07-25T20:00:00.000Z",
      rateLimits: {
        primary: {
          usedPercent: 25,
          windowDurationMins: 300,
          resetsAt: 1_785_100_000,
        },
      },
    },
    ...overrides,
  } as ServerProvider;
}

const usageWidgetHarness = vi.hoisted(() => {
  let enabled = false;
  let collapsed = false;
  let providers: ReadonlyArray<ServerProvider> = [];
  const refreshProviderUsageSequentially = vi.fn(
    async (
      inputs: ReadonlyArray<{ readonly instanceId: string }>,
      _options?: {
        readonly shouldStartNext?: (
          input: { readonly instanceId: string },
          index: number,
        ) => boolean;
      },
    ): Promise<Array<{ readonly status: "fulfilled" | "rejected" | "not-started" }>> =>
      inputs.map(() => ({ status: "fulfilled" as const })),
  );

  return {
    refreshProviderUsageSequentially,
    get enabled() {
      return enabled;
    },
    get collapsed() {
      return collapsed;
    },
    get providers() {
      return providers;
    },
    setEnabled(nextEnabled: boolean) {
      enabled = nextEnabled;
    },
    setCollapsed(nextCollapsed: boolean) {
      collapsed = nextCollapsed;
    },
    setProviders(nextProviders: ReadonlyArray<ServerProvider>) {
      providers = nextProviders;
    },
    reset(input?: { readonly enabled?: boolean; readonly collapsed?: boolean }) {
      enabled = input?.enabled ?? false;
      collapsed = input?.collapsed ?? false;
      providers = [
        provider(),
        provider({
          instanceId: ProviderInstanceId.make("claude-private-id"),
          driver: ProviderDriverKind.make("claudeAgent"),
          displayName: "Claude Work",
          accountRateLimits: {
            checkedAt: "2026-07-25T20:01:00.000Z",
            rateLimits: {
              primary: {
                usedPercent: 42,
                windowDurationMins: 240,
                resetsAt: 1_785_200_000,
              },
            },
          },
        }),
        provider({
          instanceId: ProviderInstanceId.make("future-private-id"),
          driver: ProviderDriverKind.make("futureDriver"),
          displayName: "Future Provider",
          availability: "unavailable",
          unavailableReason: "C:\\private\\provider\\secret.txt",
          enabled: false,
          installed: false,
          status: "disabled",
          auth: { status: "unknown" },
        }),
      ];
      refreshProviderUsageSequentially.mockReset();
      refreshProviderUsageSequentially.mockImplementation(
        async (
          inputs: ReadonlyArray<{ readonly instanceId: string }>,
          _options?: {
            readonly shouldStartNext?: (
              input: { readonly instanceId: string },
              index: number,
            ) => boolean;
          },
        ) => inputs.map(() => ({ status: "fulfilled" as const })),
      );
    },
  };
});

function installDeferredSequentialRefresh(firstStatus: "fulfilled" | "rejected" = "fulfilled") {
  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  let finished!: () => void;
  const firstStartedPromise = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  const releaseFirstPromise = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const finishedPromise = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const started: string[] = [];
  usageWidgetHarness.refreshProviderUsageSequentially.mockImplementationOnce(
    async (inputs, options) => {
      const outcomes: Array<{
        readonly status: "fulfilled" | "rejected" | "not-started";
      }> = [];
      for (const [index, input] of inputs.entries()) {
        if (options?.shouldStartNext?.(input, index) === false) {
          while (outcomes.length < inputs.length) outcomes.push({ status: "not-started" });
          break;
        }
        started.push(input.instanceId);
        if (index === 0) {
          firstStarted();
          await releaseFirstPromise;
        }
        outcomes.push({ status: index === 0 ? firstStatus : "fulfilled" });
      }
      finished();
      return outcomes;
    },
  );
  return { firstStartedPromise, finishedPromise, releaseFirst, started };
}

vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    client: {
      server: {
        refreshProviderUsageSequentially: usageWidgetHarness.refreshProviderUsageSequentially,
      },
    },
  }),
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({
    providerUsageWidgetEnabled: usageWidgetHarness.enabled,
    providerUsagePollMinutes: 2,
  }),
}));

vi.mock("../../rpc/serverState", () => ({
  useServerConfig: () => ({ providers: usageWidgetHarness.providers }),
  useServerProviders: () => usageWidgetHarness.providers,
}));

vi.mock("../ui/sidebar", () => ({
  useSidebar: () => ({
    isMobile: false,
    openMobile: false,
    state: usageWidgetHarness.collapsed ? "collapsed" : "expanded",
  }),
}));

describe("ProviderUsageWidget", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  beforeEach(() => {
    usageWidgetHarness.reset();
  });

  afterEach(async () => {
    const teardown = mounted?.cleanup ?? mounted?.unmount;
    await teardown?.call(mounted).catch(() => {});
    mounted = null;
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("is absent and starts no provider refresh while the opt-in is off", async () => {
    mounted = await render(<ProviderUsageWidget />);

    await expect.element(page.getByText("Provider usage")).not.toBeInTheDocument();
    expect(usageWidgetHarness.refreshProviderUsageSequentially).not.toHaveBeenCalled();
  });

  it("shows every configured provider without exposing routing IDs or raw errors", async () => {
    usageWidgetHarness.reset({ enabled: true });
    mounted = await render(<ProviderUsageWidget />);

    await expect.element(page.getByText("Provider usage")).toBeVisible();
    await expect.element(page.getByText("Codex Personal")).toBeVisible();
    await expect.element(page.getByText("Claude Work")).toBeVisible();
    await expect.element(page.getByText("Future Provider")).toBeVisible();
    await expect.element(page.getByText("25% used")).toBeVisible();
    await expect.element(page.getByText("42% used")).toBeVisible();
    await expect.element(page.getByText("Driver unavailable")).toBeVisible();
    expect(document.body.textContent).not.toContain("private-id");
    expect(document.body.textContent).not.toContain("secret.txt");

    await expect
      .poll(() => usageWidgetHarness.refreshProviderUsageSequentially.mock.calls)
      .toHaveLength(1);
    const [inputs, options] =
      usageWidgetHarness.refreshProviderUsageSequentially.mock.calls[0] ?? [];
    expect(inputs).toEqual([
      { instanceId: "claude-private-id" },
      { instanceId: "codex-private-id" },
    ]);
    expect(options?.shouldStartNext).toEqual(expect.any(Function));
  });

  it("starts no refresh while the sidebar surface is collapsed", async () => {
    usageWidgetHarness.reset({ enabled: true, collapsed: true });
    mounted = await render(<ProviderUsageWidget />);

    await expect.element(page.getByText("Provider usage")).toBeInTheDocument();
    expect(usageWidgetHarness.refreshProviderUsageSequentially).not.toHaveBeenCalled();
  });

  it("does not start a provider that becomes ineligible during an active refresh", async () => {
    usageWidgetHarness.reset({ enabled: true });
    const sequence = installDeferredSequentialRefresh();
    mounted = await render(<ProviderUsageWidget />);
    await sequence.firstStartedPromise;

    usageWidgetHarness.setProviders(
      usageWidgetHarness.providers.map((candidate) =>
        candidate.instanceId === ProviderInstanceId.make("codex-private-id")
          ? { ...candidate, enabled: false, status: "disabled" }
          : candidate,
      ),
    );
    await mounted.rerender(<ProviderUsageWidget />);
    sequence.releaseFirst();
    await sequence.finishedPromise;

    expect(sequence.started).toEqual(["claude-private-id"]);
  });

  it.each(["disabled", "collapsed", "hidden", "unmounted"] as const)(
    "finishes the active refresh without starting the next when the monitor becomes %s",
    async (scenario) => {
      usageWidgetHarness.reset({ enabled: true });
      const sequence = installDeferredSequentialRefresh();
      mounted = await render(<ProviderUsageWidget />);
      await sequence.firstStartedPromise;
      let visibility: ReturnType<typeof vi.spyOn> | undefined;

      if (scenario === "disabled") {
        usageWidgetHarness.setEnabled(false);
        await mounted.rerender(<ProviderUsageWidget />);
      } else if (scenario === "collapsed") {
        usageWidgetHarness.setCollapsed(true);
        await mounted.rerender(<ProviderUsageWidget />);
      } else if (scenario === "hidden") {
        visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      } else {
        const teardown = mounted.cleanup ?? mounted.unmount;
        await teardown?.call(mounted);
        mounted = null;
      }

      sequence.releaseFirst();
      await sequence.finishedPromise;
      expect(sequence.started).toEqual(["claude-private-id"]);
      visibility?.mockRestore();
    },
  );

  it("does not restore a removed provider to the failure set when an old refresh finishes", async () => {
    usageWidgetHarness.reset({ enabled: true });
    const initialProviders = usageWidgetHarness.providers;
    const sequence = installDeferredSequentialRefresh("rejected");
    mounted = await render(<ProviderUsageWidget />);
    await sequence.firstStartedPromise;

    usageWidgetHarness.setProviders(
      initialProviders.filter(
        (candidate) => candidate.instanceId !== ProviderInstanceId.make("claude-private-id"),
      ),
    );
    usageWidgetHarness.setCollapsed(true);
    await mounted.rerender(<ProviderUsageWidget />);
    sequence.releaseFirst();
    await sequence.finishedPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    usageWidgetHarness.setProviders(initialProviders);
    await mounted.rerender(<ProviderUsageWidget />);
    await expect
      .element(
        page.getByText("The latest usage refresh failed; previously reported data may be stale."),
      )
      .not.toBeInTheDocument();
  });

  it("starts only one initial refresh under React Strict Mode", async () => {
    usageWidgetHarness.reset({ enabled: true });
    mounted = await render(
      <StrictMode>
        <ProviderUsageWidget />
      </StrictMode>,
    );

    await expect
      .poll(() => usageWidgetHarness.refreshProviderUsageSequentially.mock.calls.length)
      .toBe(1);
  });

  it("closes the captured admission gate when hidden, disabled, collapsed, or unmounted", async () => {
    usageWidgetHarness.reset({ enabled: true });
    mounted = await render(<ProviderUsageWidget />);
    await expect
      .poll(() => usageWidgetHarness.refreshProviderUsageSequentially.mock.calls.length)
      .toBeGreaterThan(0);
    const [inputs, options] =
      usageWidgetHarness.refreshProviderUsageSequentially.mock.calls[0] ?? [];
    const firstInput = inputs?.[0];
    expect(firstInput).toBeDefined();
    expect(options?.shouldStartNext?.(firstInput!, 0)).toBe(true);

    usageWidgetHarness.setCollapsed(true);
    await mounted.rerender(<ProviderUsageWidget />);
    expect(options?.shouldStartNext?.(firstInput!, 0)).toBe(false);

    usageWidgetHarness.setCollapsed(false);
    usageWidgetHarness.setEnabled(false);
    await mounted.rerender(<ProviderUsageWidget />);
    expect(options?.shouldStartNext?.(firstInput!, 0)).toBe(false);

    usageWidgetHarness.setEnabled(true);
    await mounted.rerender(<ProviderUsageWidget />);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    expect(options?.shouldStartNext?.(firstInput!, 0)).toBe(false);
    visibility.mockRestore();

    const teardown = mounted.cleanup ?? mounted.unmount;
    await teardown?.call(mounted);
    mounted = null;
    expect(options?.shouldStartNext?.(firstInput!, 0)).toBe(false);
  });

  it("shows a fixed refresh issue without exposing a rejected provider error", async () => {
    usageWidgetHarness.reset({ enabled: true });
    usageWidgetHarness.refreshProviderUsageSequentially.mockResolvedValueOnce([
      { status: "fulfilled" },
      { status: "rejected" },
    ]);
    mounted = await render(<ProviderUsageWidget />);

    await expect
      .element(
        page.getByText("The latest usage refresh failed; previously reported data may be stale."),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain("private-id");
  });
});
