import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";
import {
  buildProviderUsageRows,
  canRefreshProviderUsage,
  providerUsageState,
} from "./providerUsage";

export const provider = (overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make("usage-instance"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: "synthetic",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-09-12T00:00:00Z",
  models: [],
  slashCommands: [],
  skills: [],
  runtimeCapabilities: { liveSteer: "supported", threadGoals: "supported", accountUsage: true },
  ...overrides,
});
const now = Date.parse("2026-09-12T00:00:00Z");
describe("provider usage facts", () => {
  it("does not refresh older windows or paid metadata when another usage event arrives", () => {
    const old = new Date(now - 720_000).toISOString();
    const result = buildProviderUsageRows(
      provider({
        accountRateLimits: {
          checkedAt: new Date(now).toISOString(),
          rateLimits: { primary: { usedPercent: 25, checkedAt: old } },
          paidUsage: { status: "enabled", used: "12.5", limit: "100", checkedAt: old },
        },
      }),
      now,
      2,
    );
    expect(result.stale).toBe(false);
    expect(result.windows[0]?.stale).toBe(true);
    expect(result.paidUsageStale).toBe(true);
    expect(result.paidUsage?.currency).toBeUndefined();
  });
  it("does not infer polling support from a known driver or old usage data", () => {
    const { runtimeCapabilities: _capability, ...withoutCapability } = provider();
    expect(canRefreshProviderUsage(withoutCapability)).toBe(false);
    expect(canRefreshProviderUsage(provider())).toBe(true);
    expect(canRefreshProviderUsage(provider({ enabled: false }))).toBe(false);
    expect(canRefreshProviderUsage(provider({ auth: { status: "unknown" } }))).toBe(false);
  });
  it("keeps missing percentages and credit balances unknown", () => {
    const result = buildProviderUsageRows(
      provider({
        accountRateLimits: {
          checkedAt: new Date(now).toISOString(),
          rateLimits: { primary: { resetsAt: now / 1000 + 3600 } },
        },
      }),
      now,
      2,
    );
    expect(result.windows[0]?.usedPercent).toBeNull();
    expect(result.resetCredits).toBeNull();
    expect(result.stale).toBe(false);
  });
  it("uses the authoritative credit aggregate and preserves explicit zero", () => {
    for (const availableCount of [0, 7]) {
      const result = buildProviderUsageRows(
        provider({
          accountRateLimits: {
            checkedAt: new Date(now).toISOString(),
            rateLimits: {},
            rateLimitResetCredits: { availableCount, credits: [] },
          },
        }),
        now,
        2,
      );
      expect(result.resetCredits).toBe(availableCount);
    }
  });
  it("marks old and future-dated facts stale rather than offering current advice", () => {
    for (const checkedAt of [now - 601_000, now + 61_000]) {
      expect(
        buildProviderUsageRows(
          provider({
            accountRateLimits: {
              checkedAt: new Date(checkedAt).toISOString(),
              rateLimits: { primary: { usedPercent: 10 } },
            },
          }),
          now,
          2,
        ).stale,
      ).toBe(true);
    }
  });
  it("uses named windows without also duplicating the default snapshot", () => {
    const snapshot = { primary: { usedPercent: 25 } };
    const result = buildProviderUsageRows(
      provider({
        accountRateLimits: {
          checkedAt: new Date(now).toISOString(),
          rateLimits: snapshot,
          rateLimitsByLimitId: { account: snapshot },
        },
      }),
      now,
      2,
    );
    expect(result.windows).toHaveLength(1);
    expect(result.windows[0]?.identity.scope).toBe("shared");
  });
  it("does not display malformed epoch values as dates", () => {
    const result = buildProviderUsageRows(
      provider({
        accountRateLimits: {
          checkedAt: new Date(now).toISOString(),
          rateLimits: { primary: { usedPercent: 50, resetsAt: 9e20 } },
        },
      }),
      now,
      2,
    );
    expect(result.windows[0]?.resetsAt).toBeNull();
  });
  it("keeps provider states explicit even if old account data remains", () => {
    expect(
      providerUsageState(
        provider({
          auth: { status: "unauthenticated" },
          accountRateLimits: { checkedAt: new Date(now).toISOString(), rateLimits: {} },
        }),
      ),
    ).toContain("Sign in");
  });
});
