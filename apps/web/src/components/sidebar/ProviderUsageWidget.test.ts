import type { ServerProvider } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import { buildProviderUsageRows, canRefreshProviderUsage } from "./ProviderUsageWidget";

function provider(overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-07-23T20:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  } as ServerProvider;
}

describe("buildProviderUsageRows", () => {
  it("keeps every reported limit and both session/weekly windows", () => {
    expect(
      buildProviderUsageRows([
        provider({
          displayName: "Codex Personal",
          runtimeCapabilities: {
            liveSteer: "supported",
            threadGoals: "supported",
            accountUsage: "unsupported",
          },
          accountRateLimits: {
            checkedAt: "2026-07-23T20:05:00.000Z",
            rateLimits: {},
            rateLimitsByLimitId: {
              codex: {
                limitId: "codex",
                limitName: "GPT",
                primary: {
                  usedPercent: 25,
                  windowDurationMins: 300,
                  resetsAt: 1_785_000_000,
                },
                secondary: {
                  usedPercent: 70,
                  windowDurationMins: 10_080,
                  resetsAt: 1_785_500_000,
                },
              },
              review: {
                limitId: "review",
                primary: { usedPercent: 10, windowDurationMins: 60 },
              },
            },
          },
        }),
      ]),
    ).toMatchObject([
      {
        instanceId: "codex",
        name: "Codex Personal",
        checkedAt: "2026-07-23T20:05:00.000Z",
        state: "available",
        exhaustionNotices: [],
        windows: [
          {
            key: "codex:primary",
            label: "GPT (shared/account limit) session · 5h",
            usedPercent: 25,
            resetsAt: 1_785_000_000,
          },
          {
            key: "codex:secondary",
            label: "GPT (shared/account limit) weekly · 7d",
            usedPercent: 70,
            resetsAt: 1_785_500_000,
          },
          {
            key: "review:primary",
            label: "review (shared/account limit) session · 1h",
            usedPercent: 10,
            resetsAt: null,
          },
        ],
      },
    ]);
  });

  it("keeps unauthenticated and unsupported configured providers visible without fabricating usage", () => {
    expect(
      buildProviderUsageRows([
        provider({ auth: { status: "unauthenticated" } }),
        provider({
          instanceId: "opencode" as ServerProvider["instanceId"],
          driver: "opencode" as ServerProvider["driver"],
        }),
      ]),
    ).toMatchObject([
      {
        instanceId: "codex",
        state: "unauthenticated",
        stateMessage: "Sign in to read provider-reported usage.",
        checkedAt: null,
        windows: [],
        paidUsage: null,
      },
      {
        instanceId: "opencode",
        name: "OpenCode",
        state: "unsupported",
        stateMessage: "This provider does not expose account usage to Club Code.",
        checkedAt: null,
        windows: [],
        paidUsage: null,
      },
    ]);
  });

  it("distinguishes disabled, unavailable, unknown-auth, and supported no-data states", () => {
    expect(
      buildProviderUsageRows([
        provider({
          instanceId: "disabled" as ServerProvider["instanceId"],
          enabled: false,
          status: "disabled",
        }),
        provider({
          instanceId: "unavailable" as ServerProvider["instanceId"],
          availability: "unavailable",
          enabled: false,
          installed: false,
        }),
        provider({
          instanceId: "unknown-auth" as ServerProvider["instanceId"],
          auth: { status: "unknown" },
        }),
        provider({
          instanceId: "no-data" as ServerProvider["instanceId"],
          runtimeCapabilities: {
            liveSteer: "supported",
            threadGoals: "supported",
            accountUsage: "experimental",
          },
        }),
      ]).map(({ instanceId, state }) => ({ instanceId, state })),
    ).toEqual([
      { instanceId: "disabled", state: "disabled" },
      { instanceId: "unavailable", state: "unavailable" },
      { instanceId: "unknown-auth", state: "auth-unknown" },
      { instanceId: "no-data", state: "no-data" },
    ]);
  });

  it("surfaces provider-reported paid usage and marks old facts stale", () => {
    expect(
      buildProviderUsageRows(
        [
          provider({
            accountRateLimits: {
              checkedAt: "2026-07-23T20:05:00.000Z",
              rateLimits: {},
              paidUsage: {
                status: "enabled",
                balance: "35.00",
                used: "15.00",
                limit: "50.00",
                utilizationPercent: 30,
                remainingPercent: 70,
                currency: "USD",
              },
            },
          }),
        ],
        { nowMs: Date.parse("2026-07-23T20:20:01.000Z"), pollMinutes: 2 },
      ),
    ).toMatchObject([
      {
        state: "available",
        stale: true,
        paidUsageStale: true,
        paidUsage: {
          status: "enabled",
          balance: "35.00",
          used: "15.00",
          limit: "50.00",
          utilizationPercent: 30,
          remainingPercent: 70,
          currency: "USD",
        },
      },
    ]);
  });

  it("reports polled Codex reset-credit inventory and enables redemption only above zero", () => {
    const [withCredit, withoutCredit] = buildProviderUsageRows([
      provider({
        runtimeCapabilities: {
          liveSteer: "supported",
          threadGoals: "supported",
          accountUsage: "supported",
          accountRateLimitResets: "supported",
        },
        accountRateLimits: {
          checkedAt: "2026-07-23T20:05:00.000Z",
          rateLimits: {},
          rateLimitResetCredits: { availableCount: 2, credits: null },
        },
      }),
      provider({
        instanceId: "codex-zero" as ServerProvider["instanceId"],
        runtimeCapabilities: {
          liveSteer: "supported",
          threadGoals: "supported",
          accountUsage: "supported",
          accountRateLimitResets: "supported",
        },
        accountRateLimits: {
          checkedAt: "2026-07-23T20:05:00.000Z",
          rateLimits: {},
          rateLimitResetCredits: { availableCount: 0 },
        },
      }),
    ]);

    expect(withCredit?.resetCredits).toEqual({
      availableCount: 2,
      supported: true,
      redeemable: true,
    });
    expect(withoutCredit?.resetCredits).toEqual({
      availableCount: 0,
      supported: true,
      redeemable: false,
    });
  });

  it("renders Claude reset credits as an explicit zero without a false claim action", () => {
    const [claude] = buildProviderUsageRows([
      provider({
        instanceId: "claudeAgent" as ServerProvider["instanceId"],
        driver: "claudeAgent" as ServerProvider["driver"],
        runtimeCapabilities: {
          liveSteer: "supported",
          threadGoals: "unsupported",
          accountUsage: "experimental",
          accountRateLimitResets: "unsupported",
        },
      }),
    ]);

    expect(claude?.resetCredits).toEqual({
      availableCount: 0,
      supported: false,
      redeemable: false,
    });
  });

  it("keeps a fresh Claude event distinct from older keyed and paid facts", () => {
    const rows = buildProviderUsageRows(
      [
        provider({
          instanceId: "claudeAgent" as ServerProvider["instanceId"],
          driver: "claudeAgent" as ServerProvider["driver"],
          accountRateLimits: {
            checkedAt: "2026-07-23T20:15:00.000Z",
            rateLimits: {},
            rateLimitsByLimitId: {
              claude: {
                primary: {
                  usedPercent: 55,
                  checkedAt: "2026-07-23T20:15:00.000Z",
                },
                secondary: {
                  usedPercent: 40,
                  checkedAt: "2026-07-23T20:00:00.000Z",
                },
              },
            },
            paidUsage: {
              status: "enabled",
              used: "12",
              limit: "50",
              checkedAt: "2026-07-23T20:00:00.000Z",
            },
          },
        }),
      ],
      { nowMs: Date.parse("2026-07-23T20:16:00.000Z"), pollMinutes: 2 },
    );

    expect(rows[0]).toMatchObject({
      stale: false,
      paidUsageStale: true,
      windows: [
        { key: "claude:primary", stale: false },
        { key: "claude:secondary", stale: true },
      ],
    });
  });

  it("refreshes only authenticated, available providers that declare usage support", () => {
    expect(
      canRefreshProviderUsage(
        provider({
          runtimeCapabilities: {
            liveSteer: "supported",
            threadGoals: "supported",
            accountUsage: "supported",
          },
        }),
      ),
    ).toBe(true);
    expect(
      canRefreshProviderUsage(
        provider({
          driver: "opencode" as ServerProvider["driver"],
          runtimeCapabilities: {
            liveSteer: "unsupported",
            threadGoals: "unsupported",
            accountUsage: "unsupported",
          },
        }),
      ),
    ).toBe(false);
    expect(
      canRefreshProviderUsage(
        provider({
          runtimeCapabilities: {
            liveSteer: "supported",
            threadGoals: "supported",
            accountUsage: "experimental",
          },
          auth: { status: "unauthenticated" },
        }),
      ),
    ).toBe(false);
  });

  it("surfaces provider-declared exhaustion even when no usage window is available", () => {
    expect(
      buildProviderUsageRows([
        provider({
          accountRateLimits: {
            checkedAt: "2026-07-23T20:05:00.000Z",
            rateLimits: {
              limitId: "codex",
              limitName: "Codex",
              rateLimitReachedType: "primary",
              spendControlReached: true,
            },
          },
        }),
      ]),
    ).toMatchObject([
      {
        instanceId: "codex",
        windows: [],
        exhaustionNotices: [
          {
            key: "default:provider-reached",
            label: "Codex (shared/account limit)",
            message: "The provider reports that this usage limit has been reached.",
          },
          {
            key: "default:spend-control",
            label: "Codex (shared/account limit)",
            message: "The provider reports that this spend control has been reached.",
          },
        ],
      },
    ]);
  });

  it("marks exact exhausted session, weekly, and individual windows", () => {
    expect(
      buildProviderUsageRows([
        provider({
          accountRateLimits: {
            checkedAt: "2026-07-23T20:05:00.000Z",
            rateLimits: {
              primary: { usedPercent: 100 },
              secondary: { usedPercent: 100 },
              individualLimit: {
                limit: "$20",
                remainingPercent: 0,
                resetsAt: 1_785_500_000,
                used: "$20",
              },
            },
          },
        }),
      ])[0]?.exhaustionNotices,
    ).toEqual([
      {
        key: "default:primary",
        label: "default (shared/account limit)",
        message: "The current session window is exhausted.",
      },
      {
        key: "default:secondary",
        label: "default (shared/account limit)",
        message: "The weekly window is exhausted.",
      },
      {
        key: "default:individual",
        label: "default (shared/account limit)",
        message: "The provider reports no remaining individual spend allowance.",
      },
    ]);
  });
});
