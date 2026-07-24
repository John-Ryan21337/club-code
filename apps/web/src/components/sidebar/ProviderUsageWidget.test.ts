import type { ServerProvider } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import { buildProviderUsageRows } from "./ProviderUsageWidget";

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

  it("omits unauthenticated and unsupported providers without fabricating usage", () => {
    expect(
      buildProviderUsageRows([
        provider({ auth: { status: "unauthenticated" } }),
        provider({ driver: "opencode" as ServerProvider["driver"] }),
      ]),
    ).toEqual([]);
  });
});
