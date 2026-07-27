import { describe, expect, it } from "vitest";

import { parseClaudeAccountUsage } from "./claudeAccountUsage.ts";

const CHECKED_AT = "2026-07-27T09:00:00.000Z";

describe("parseClaudeAccountUsage", () => {
  it("maps plan, model, and paid extra-usage facts without session or account details", () => {
    const parsed = parseClaudeAccountUsage(
      {
        session: {
          total_cost_usd: 42,
          model_usage: { secret: { inputTokens: 123 } },
        },
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: {
            utilization: 20,
            resets_at: "2026-07-27T10:00:00.000Z",
          },
          seven_day: {
            utilization: 45.5,
            resets_at: "2026-08-01T09:00:00.000Z",
          },
          seven_day_opus: {
            utilization: 60,
            resets_at: "2026-08-01T09:00:00.000Z",
          },
          model_scoped: [
            {
              display_name: "Fable",
              utilization: 12.5,
              resets_at: "2026-08-01T09:00:00.000Z",
            },
          ],
          extra_usage: {
            is_enabled: true,
            monthly_limit: 100,
            used_credits: 27.5,
            utilization: 27.5,
            currency: "USD",
          },
        },
        behaviors: {
          week: {
            skills: [{ name: "private-skill", pct: 100 }],
          },
        },
      },
      CHECKED_AT,
    );

    expect(parsed).toEqual({
      checkedAt: CHECKED_AT,
      rateLimits: {
        limitId: "claude",
        limitName: "Claude",
        planType: "max",
        primary: {
          usedPercent: 20,
          windowDurationMins: 300,
          resetsAt: 1_785_146_400,
          checkedAt: CHECKED_AT,
        },
        secondary: {
          usedPercent: 45.5,
          windowDurationMins: 10_080,
          resetsAt: 1_785_574_800,
          checkedAt: CHECKED_AT,
        },
      },
      rateLimitsByLimitId: {
        claude: expect.any(Object),
        "claude-opus": {
          limitId: "claude-opus",
          limitName: "Opus",
          planType: "max",
          secondary: {
            usedPercent: 60,
            windowDurationMins: 10_080,
            resetsAt: 1_785_574_800,
            checkedAt: CHECKED_AT,
          },
        },
        "claude-model-1": {
          limitId: "claude-model-1",
          limitName: "Fable",
          planType: "max",
          secondary: {
            usedPercent: 12.5,
            windowDurationMins: 10_080,
            resetsAt: 1_785_574_800,
            checkedAt: CHECKED_AT,
          },
        },
      },
      paidUsage: {
        status: "enabled",
        checkedAt: CHECKED_AT,
        used: "27.5",
        limit: "100",
        utilizationPercent: 27.5,
        remainingPercent: 72.5,
        currency: "USD",
      },
    });
    expect(JSON.stringify(parsed)).not.toContain("private-skill");
    expect(JSON.stringify(parsed)).not.toContain("total_cost_usd");
  });

  it("returns a checked empty snapshot when subscription limits do not apply", () => {
    expect(
      parseClaudeAccountUsage(
        {
          subscription_type: null,
          rate_limits_available: false,
          rate_limits: null,
        },
        CHECKED_AT,
      ),
    ).toEqual({
      checkedAt: CHECKED_AT,
      rateLimits: {
        limitId: "claude",
        limitName: "Claude",
      },
    });
  });

  it("preserves reset-only windows and disabled extra usage", () => {
    const parsed = parseClaudeAccountUsage(
      {
        subscription_type: "pro",
        rate_limits_available: true,
        rate_limits: {
          five_hour: {
            utilization: null,
            resets_at: "2026-07-27T10:00:00.000Z",
          },
          extra_usage: {
            is_enabled: false,
            monthly_limit: null,
            used_credits: null,
            utilization: null,
            currency: null,
          },
        },
      },
      CHECKED_AT,
    );

    expect(parsed?.rateLimits.primary).toEqual({
      windowDurationMins: 300,
      resetsAt: 1_785_146_400,
      checkedAt: CHECKED_AT,
    });
    expect(parsed?.paidUsage).toEqual({ status: "disabled", checkedAt: CHECKED_AT });
  });

  it("fails closed on malformed or out-of-range experimental responses", () => {
    expect(parseClaudeAccountUsage(null, CHECKED_AT)).toBeUndefined();
    expect(parseClaudeAccountUsage({ rate_limits_available: "yes" }, CHECKED_AT)).toBeUndefined();
    expect(
      parseClaudeAccountUsage(
        {
          subscription_type: "max",
          rate_limits_available: true,
          rate_limits: { five_hour: { utilization: 101, resets_at: null } },
        },
        CHECKED_AT,
      ),
    ).toBeUndefined();
    expect(
      parseClaudeAccountUsage(
        {
          subscription_type: null,
          rate_limits_available: true,
          rate_limits: {},
        },
        CHECKED_AT,
      ),
    ).toBeUndefined();
    expect(
      parseClaudeAccountUsage(
        {
          subscription_type: "max",
          rate_limits_available: true,
          rate_limits: {
            extra_usage: {
              is_enabled: true,
              monthly_limit: -1,
              used_credits: 0,
              utilization: 0,
            },
          },
        },
        CHECKED_AT,
      ),
    ).toBeUndefined();
    expect(
      parseClaudeAccountUsage(
        {
          subscription_type: "unexpected-enterprise-plan",
          rate_limits_available: false,
        },
        CHECKED_AT,
      ),
    ).toBeUndefined();
    expect(
      parseClaudeAccountUsage(
        {
          subscription_type: "max",
          rate_limits_available: true,
          rate_limits: {
            five_hour: { utilization: 1, resets_at: "next Tuesday" },
          },
        },
        CHECKED_AT,
      ),
    ).toBeUndefined();
    expect(
      parseClaudeAccountUsage(
        {
          subscription_type: "max",
          rate_limits_available: true,
          rate_limits: {
            extra_usage: {
              is_enabled: true,
              monthly_limit: 10,
              used_credits: 1,
              utilization: 10,
              currency: "$",
            },
          },
        },
        CHECKED_AT,
      ),
    ).toBeUndefined();
  });
});
