import "../../index.css";
import {
  DEFAULT_AMBIENT_EXPERIENCE_CAPABILITIES,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderUpdatedPayload,
} from "@cafecode/contracts";
import { page } from "vitest/browser";
import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import {
  applyServerConfigEvent,
  resetServerStateForTests,
  setServerConfigSnapshot,
} from "../../rpc/serverState";
import { ProviderUsageWidget } from "./ProviderUsageWidget";

const refreshProviders = vi.hoisted(() =>
  vi.fn<(input: { instanceId: ProviderInstanceId }) => Promise<ServerProviderUpdatedPayload>>(),
);

function renderUsage() {
  return render(
    <AppAtomRegistryProvider>
      <ProviderUsageWidget />
    </AppAtomRegistryProvider>,
  );
}
vi.mock("../../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    client: { server: { refreshProviders } },
  }),
}));
vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({
    providerUsageWidgetEnabled: true,
    providerUsagePollMinutes: 2,
    modelPacingEnabled: false,
  }),
}));

beforeEach(() => {
  resetServerStateForTests();
  refreshProviders.mockReset().mockResolvedValue({ providers: [] });
});

function setProviders(providers: ReadonlyArray<ServerProvider>) {
  setServerConfigSnapshot({
    environment: {
      environmentId: EnvironmentId.make("environment-local"),
      label: "Local environment",
      platform: { os: "windows", arch: "x64" },
      serverVersion: "0.0.0-test",
      capabilities: { repositoryIdentity: true },
    },
    auth: {
      policy: "loopback-browser",
      bootstrapMethods: ["one-time-token"],
      sessionMethods: ["browser-session-cookie"],
      sessionCookieName: "test_session",
    },
    cwd: "/workspace",
    keybindingsConfigPath: "/workspace/keybindings.json",
    systemPromptPath: "/workspace/system-prompt.md",
    keybindings: [],
    issues: [],
    providers,
    availableEditors: [],
    observability: {
      logsDirectoryPath: "/workspace/logs",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
    clientSettings: DEFAULT_CLIENT_SETTINGS,
    ambientExperienceCapabilities: DEFAULT_AMBIENT_EXPERIENCE_CAPABILITIES,
  });
}

function ultraProvider() {
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
  return {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: "2.1.327",
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
  } satisfies ServerProvider;
}

it("renders verified Ultra with only weekly bars, then a pending temporary session bar", async () => {
  const provider = ultraProvider();
  const { checkedAt, claudeAccount: account, rateLimits: snapshot } = provider.accountRateLimits;
  setProviders([provider]);
  refreshProviders.mockResolvedValue({ providers: [provider] });
  const screen = await renderUsage();
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
  setProviders([
    {
      ...provider,
      accountRateLimits: {
        checkedAt,
        claudeAccount: { ...account, verification: "pending", fiveHourLimit: "applies" },
        rateLimits: pending,
        rateLimitsByLimitId: { claude: pending },
      },
    },
  ]);
  await expect
    .element(page.getByText("Ultra verification pending: a temporary five-hour limit applies."))
    .toBeVisible();
  await expect
    .element(page.getByRole("meter", { name: /session/ }))
    .toHaveAttribute("aria-valuenow", "23");
  await screen.unmount();
});

it("keeps Claude usage from the config stream when parallel refresh replies arrive out of order", async () => {
  const { accountRateLimits, ...claudeWithoutUsage } = ultraProvider();
  const claude = { ...claudeWithoutUsage, accountRateLimits };
  const codex: ServerProvider = {
    instanceId: ProviderInstanceId.make("codex"),
    driver: ProviderDriverKind.make("codex"),
    enabled: true,
    installed: true,
    version: "0.169.1",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: claude.checkedAt,
    models: [],
    slashCommands: [],
    skills: [],
    runtimeCapabilities: {
      liveSteer: "supported",
      threadGoals: "supported",
      accountUsage: "supported",
    },
  };
  const initialProviders = [claudeWithoutUsage, codex];
  let resolveClaudeReply!: (payload: ServerProviderUpdatedPayload) => void;
  const claudeReply = new Promise<ServerProviderUpdatedPayload>((resolve) => {
    resolveClaudeReply = resolve;
  });
  refreshProviders.mockImplementation(({ instanceId }) =>
    instanceId === claude.instanceId
      ? claudeReply
      : Promise.resolve({ providers: initialProviders }),
  );
  setProviders(initialProviders);
  const screen = await renderUsage();
  await vi.waitFor(() => expect(refreshProviders).toHaveBeenCalledTimes(2));
  const payload = { providers: [claude, codex] };
  applyServerConfigEvent({ version: 1, type: "providerStatuses", payload });
  const claudeWeekly = page.getByRole("meter", { name: /^Claude Claude.*weekly/ });
  await expect.element(claudeWeekly).toHaveAttribute("aria-valuenow", "1");
  resolveClaudeReply(payload);

  await expect.element(page.getByRole("button", { name: "Refresh provider usage" })).toBeEnabled();
  await expect.element(claudeWeekly, { timeout: 2_000 }).toHaveAttribute("aria-valuenow", "1");
  await expect
    .element(page.getByRole("meter", { name: /Fable.*weekly/ }))
    .toHaveAttribute("aria-valuenow", "0");
  await screen.unmount();
});
