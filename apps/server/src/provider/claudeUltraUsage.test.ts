import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import { ServerProviderAccountRateLimits } from "@cafecode/contracts";
import { parseClaudeAccountUsage } from "./claudeAccountUsage.ts";
const checkedAt = "2026-11-03T08:00:00.000Z";
const weekly = { utilization: 1, resets_at: "2026-11-07T21:00:00.089154+00:00" };
const response = (limits: unknown) => ({
  subscription_type: "max",
  rate_limits_available: true,
  rate_limits: limits,
});
describe("Ultra usage and verification", () => {
  it.each([0, 2, 3])("converts reported currency precision %s accurately", (decimalPlaces) => {
    const result = parseClaudeAccountUsage(
      response({
        five_hour: null,
        seven_day: weekly,
        extra_usage: {
          is_enabled: true,
          used_credits: 27 * 10 ** decimalPlaces,
          monthly_limit: 100 * 10 ** decimalPlaces,
          currency: "JPY",
          decimal_places: decimalPlaces,
        },
      }),
      checkedAt,
      "Claude Ultra",
    );
    expect(result?.paidUsage?.used).toBe("27");
  });
  it("uses the same query's Ultra plan with explicit no-session and weekly evidence", () => {
    const result = parseClaudeAccountUsage(
      response({
        five_hour: null,
        seven_day: weekly,
        model_scoped: [{ ...weekly, display_name: "Fable", utilization: 0 }],
      }),
      checkedAt,
      "Claude Ultra",
    );
    expect(result?.claudeAccount).toEqual({
      plan: "ultra",
      verification: "verified",
      fiveHourLimit: "removed",
      checkedAt,
    });
    expect(result?.rateLimits.primary).toBeUndefined();
    expect(result?.rateLimits.secondary?.usedPercent).toBe(1);
    expect(result?.rateLimitsByLimitId?.["claude-model-1"]?.secondary?.usedPercent).toBe(0);
    expect(Schema.decodeUnknownSync(ServerProviderAccountRateLimits)(result)).toEqual(result);
  });
  it("keeps the temporary five-hour bar until verification", () => {
    const result = parseClaudeAccountUsage(
      response({ five_hour: { ...weekly, utilization: 24 }, seven_day: weekly }),
      checkedAt,
      "Claude Ultra",
    );
    expect(result?.claudeAccount).toMatchObject({
      verification: "pending",
      fiveHourLimit: "applies",
    });
    expect(result?.rateLimits.primary?.usedPercent).toBe(24);
  });
  it.each([
    { seven_day: weekly },
    { five_hour: null },
    { five_hour: null, seven_day: { utilization: null, resets_at: null } },
  ])("does not infer verification from incomplete usage: %j", (limits) => {
    expect(
      parseClaudeAccountUsage(response(limits), checkedAt, "Claude Ultra")?.claudeAccount
        ?.verification,
    ).toBe("unknown");
  });
  it("does not infer Ultra from a legacy Max plan, zero utilization, or API auth", () => {
    expect(
      parseClaudeAccountUsage(response({ five_hour: null, seven_day: weekly }), checkedAt)
        ?.claudeAccount,
    ).toBeUndefined();
    expect(
      parseClaudeAccountUsage(
        { subscription_type: null, rate_limits_available: false, rate_limits: null },
        checkedAt,
        "Claude Ultra",
      )?.claudeAccount,
    ).toBeUndefined();
    expect(parseClaudeAccountUsage(response(null), checkedAt, "Claude Ultra")).toBeUndefined();
    expect(
      parseClaudeAccountUsage(
        response({ five_hour: { utilization: NaN, resets_at: null } }),
        checkedAt,
        "Claude Ultra",
      ),
    ).toBeUndefined();
  });
  it("retains omitted model facts with their original date and clears explicit empty lists", () => {
    const old = parseClaudeAccountUsage(
      response({ model_scoped: [{ ...weekly, display_name: "Fable" }] }),
      checkedAt,
      "Claude Ultra",
    );
    const next = parseClaudeAccountUsage(
      response({ seven_day: weekly }),
      "2026-11-03T08:10:00.000Z",
      "Claude Ultra",
      old,
    );
    expect(next?.rateLimitsByLimitId?.["claude-model-1"]?.secondary?.checkedAt).toBe(checkedAt);
    expect(
      parseClaudeAccountUsage(response({ model_scoped: [] }), checkedAt, "Claude Ultra", old)
        ?.rateLimitsByLimitId?.["claude-model-1"],
    ).toBeUndefined();
  });
});
