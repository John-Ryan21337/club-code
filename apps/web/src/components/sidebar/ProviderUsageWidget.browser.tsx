import "../../index.css";
import {
  DEFAULT_CLIENT_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@cafecode/contracts";
import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { ProviderUsageWidget } from "./ProviderUsageWidget";

const harness = vi.hoisted(() => ({
  settings: {} as typeof DEFAULT_CLIENT_SETTINGS,
  providers: [] as ServerProvider[],
  refresh: vi.fn(),
  apply: vi.fn(),
  connection: {} as object,
}));
vi.mock("../../hooks/useSettings", () => ({ useSettings: () => harness.settings }));
vi.mock("../../rpc/serverState", () => ({
  useServerProviders: () => harness.providers,
  applyProvidersUpdated: harness.apply,
}));
vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => harness.connection,
}));
function provider(id = "usage-browser"): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(id),
    driver: ProviderDriverKind.make("codex"),
    displayName: "Synthetic account",
    enabled: true,
    installed: true,
    version: "synthetic",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: new Date().toISOString(),
    models: [],
    slashCommands: [],
    skills: [],
    runtimeCapabilities: { liveSteer: "supported", threadGoals: "supported", accountUsage: true },
    accountRateLimits: {
      checkedAt: new Date().toISOString(),
      rateLimits: {
        primary: {
          usedPercent: 30,
          windowDurationMins: 300,
          resetsAt: Math.floor(Date.now() / 1000) + 3600,
        },
      },
    },
  };
}
beforeEach(() => {
  harness.settings = { ...DEFAULT_CLIENT_SETTINGS, providerUsageWidgetEnabled: true };
  harness.providers = [provider()];
  harness.refresh.mockReset().mockResolvedValue({ providers: harness.providers });
  harness.apply.mockReset();
  harness.connection = { client: { server: { refreshProviders: harness.refresh } } };
});

it("remains absent and makes no refresh requests by default", async () => {
  harness.settings = DEFAULT_CLIENT_SETTINGS;
  const screen = await render(<ProviderUsageWidget />);
  await expect
    .element(screen.getByRole("region", { name: "Provider usage limits" }))
    .not.toBeInTheDocument();
  expect(harness.refresh).not.toHaveBeenCalled();
});

it("refreshes the exact instance through usage-only scope and displays known facts", async () => {
  const screen = await render(<ProviderUsageWidget />);
  await expect.poll(() => harness.refresh.mock.calls.length).toBe(1);
  expect(harness.refresh).toHaveBeenCalledWith({
    instanceId: harness.providers[0]!.instanceId,
    scope: "usage",
  });
  await expect.element(screen.getByText("30% used", { exact: true })).toBeVisible();
  await expect.element(screen.getByText("Reset credits: unknown", { exact: true })).toBeVisible();
  expect(harness.apply).toHaveBeenCalledOnce();
});

it("keeps stale facts visible and suppresses current pacing advice", async () => {
  harness.settings = { ...harness.settings, modelPacingEnabled: true };
  const old = provider();
  harness.providers = [
    {
      ...old,
      accountRateLimits: {
        ...old.accountRateLimits!,
        checkedAt: new Date(Date.now() - 720_000).toISOString(),
      },
    },
  ];
  const screen = await render(<ProviderUsageWidget />);
  await expect
    .element(screen.getByText("Stale: showing last reported values.", { exact: true }))
    .toBeVisible();
  expect(document.querySelector("[data-pacing-status]")).toBeNull();
});

it("stops queued instance refreshes and ignores a completed response after unmount", async () => {
  harness.providers = [provider("first"), provider("second")];
  let finish!: (result: { providers: ServerProvider[] }) => void;
  harness.refresh.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const screen = await render(<ProviderUsageWidget />);
  await expect.poll(() => harness.refresh.mock.calls.length).toBe(1);
  await screen.unmount();
  finish({ providers: harness.providers });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(harness.refresh).toHaveBeenCalledOnce();
  expect(harness.apply).not.toHaveBeenCalled();
});

it("stops the old connection's queued refreshes when the primary environment changes", async () => {
  harness.providers = [provider("first"), provider("second")];
  let finish!: (result: { providers: ServerProvider[] }) => void;
  harness.refresh.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render(<ProviderUsageWidget />);
  await expect.poll(() => harness.refresh.mock.calls.length).toBe(1);
  harness.connection = { client: { server: { refreshProviders: vi.fn() } } };
  finish({ providers: harness.providers });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(harness.refresh).toHaveBeenCalledOnce();
  expect(harness.apply).not.toHaveBeenCalled();
});

it.each(["spend", "window"] as const)(
  "suppresses pacing advice when the provider reports an exhausted %s limit",
  async (kind) => {
    harness.settings = { ...harness.settings, modelPacingEnabled: true };
    const current = provider();
    harness.providers = [
      {
        ...current,
        accountRateLimits: {
          ...current.accountRateLimits!,
          rateLimits: {
            ...current.accountRateLimits!.rateLimits,
            ...(kind === "spend"
              ? { spendControlReached: true }
              : { secondary: { usedPercent: 100 } }),
          },
        },
      },
    ];
    const screen = await render(<ProviderUsageWidget />);
    await expect
      .element(
        screen.getByText("The provider reports an exhausted usage or spend limit.", {
          exact: true,
        }),
      )
      .toBeVisible();
    expect(document.querySelector("[data-pacing-status]")).toBeNull();
  },
);

it("does not poll hidden documents or unavailable capabilities", async () => {
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  try {
    await render(<ProviderUsageWidget />);
    expect(harness.refresh).not.toHaveBeenCalled();
  } finally {
    visibility.mockRestore();
  }
});

it("bounds a long account list so the thread region stays visible on a small viewport", async () => {
  await page.viewport(390, 600);
  harness.providers = Array.from({ length: 12 }, (_, index) => {
    const { runtimeCapabilities: _capability, ...withoutCapability } = provider(`account-${index}`);
    return withoutCapability;
  });
  const screen = await render(
    <div className="flex h-dvh flex-col">
      <div className="min-h-0 flex-1" data-testid="threads">
        Thread list
      </div>
      <ProviderUsageWidget />
    </div>,
  );
  await expect.element(screen.getByTestId("threads")).toBeVisible();
  const bounds = screen
    .getByRole("region", { name: "Provider usage limits" })
    .element()
    .getBoundingClientRect();
  expect(bounds.height).toBeLessThanOrEqual(300);
  expect(bounds.height).toBeGreaterThan(100);
  expect(
    screen.getByTestId("threads").element().getBoundingClientRect().height,
  ).toBeGreaterThanOrEqual(290);
  expect(harness.refresh).not.toHaveBeenCalled();
});
