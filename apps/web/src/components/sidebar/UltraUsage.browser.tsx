import "../../index.css";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@cafecode/contracts";
import { page } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ProviderUsageWidget } from "./ProviderUsageWidget";
const harness = vi.hoisted(() => ({ providers: [] as ServerProvider[] }));
vi.mock("../../rpc/serverState", () => ({
  useServerProviders: () => harness.providers,
  applyProvidersUpdated: vi.fn(),
}));
vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    client: { server: { refreshProviders: async () => [] } },
  }),
}));
vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({
    providerUsageWidgetEnabled: true,
    providerUsagePollMinutes: 2,
    modelPacingEnabled: false,
  }),
}));
it("renders verified Ultra with only weekly bars, then a pending temporary session bar", async () => {
  const checkedAt = new Date().toISOString();
  const account = {
    plan: "ultra",
    verification: "verified",
    fiveHourLimit: "removed",
    checkedAt,
  } as const;
  const snapshot = {
    limitId: "claude",
    limitName: "Claude",
    planType: "ultra",
    secondary: { usedPercent: 1, windowDurationMins: 10080, checkedAt },
  };
  const provider: ServerProvider = {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: "2.1.317",
    status: "ready",
    auth: { status: "authenticated", type: "Claude Ultra" },
    checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    runtimeCapabilities: {
      liveSteer: "supported",
      threadGoals: "unsupported",
      accountUsage: "experimental",
    },
    accountRateLimits: {
      checkedAt,
      claudeAccount: account,
      rateLimits: snapshot,
      rateLimitsByLimitId: {
        claude: snapshot,
        fable: {
          limitName: "Fable",
          secondary: { usedPercent: 0, windowDurationMins: 10080, checkedAt },
        },
      },
    },
  };
  harness.providers = [provider];
  const screen = await render(<ProviderUsageWidget />);
  await expect
    .element(
      page.getByText("Ultra verified: no five-hour limit. Weekly and model limits still apply."),
    )
    .toBeVisible();
  expect(document.querySelectorAll('[role="meter"]')).toHaveLength(2);
  await expect
    .element(page.getByRole("meter", { name: /Fable.*weekly/ }))
    .toHaveAttribute("aria-valuenow", "0");
  const primary = { usedPercent: 23, windowDurationMins: 300, checkedAt };
  const pending = { ...snapshot, primary };
  harness.providers = [
    {
      ...provider,
      accountRateLimits: {
        checkedAt,
        claudeAccount: { ...account, verification: "pending", fiveHourLimit: "applies" },
        rateLimits: pending,
        rateLimitsByLimitId: { claude: pending },
      },
    },
  ];
  await screen.rerender(<ProviderUsageWidget />);
  await expect
    .element(page.getByText("Ultra verification pending: a temporary five-hour limit applies."))
    .toBeVisible();
  await expect
    .element(page.getByRole("meter", { name: /session/ }))
    .toHaveAttribute("aria-valuenow", "23");
  await screen.unmount();
});
