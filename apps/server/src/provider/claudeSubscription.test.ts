import { describe, expect, it } from "vitest";

import {
  CLAUDE_SUBSCRIPTION_PLAN_TYPES,
  isClaudeSubscriptionPlanType,
  normalizeClaudeSubscriptionType,
} from "./claudeSubscription.ts";

describe("normalizeClaudeSubscriptionType", () => {
  it("canonicalizes the bare plan names the SDK originally reported", () => {
    expect(normalizeClaudeSubscriptionType("max")).toBe("max");
    expect(normalizeClaudeSubscriptionType("pro")).toBe("pro");
    expect(normalizeClaudeSubscriptionType("team")).toBe("team");
    expect(normalizeClaudeSubscriptionType("enterprise")).toBe("enterprise");
  });

  it("canonicalizes the decorated forms that regressed account usage", () => {
    // Observed live: `auth.type` of "Claude Max" disabled account usage
    // entirely because the gate exact-matched bare plan names.
    expect(normalizeClaudeSubscriptionType("Claude Max")).toBe("max");
    expect(normalizeClaudeSubscriptionType("Claude Pro")).toBe("pro");
    expect(normalizeClaudeSubscriptionType("Claude Max Subscription")).toBe("max");
    expect(normalizeClaudeSubscriptionType("Claude Team Subscription")).toBe("team");
    expect(normalizeClaudeSubscriptionType("Claude Enterprise Subscription")).toBe("enterprise");
  });

  it("ignores separators, casing, and surrounding whitespace", () => {
    expect(normalizeClaudeSubscriptionType("claude_max")).toBe("max");
    expect(normalizeClaudeSubscriptionType("claude-max")).toBe("max");
    expect(normalizeClaudeSubscriptionType("  CLAUDE   MAX  ")).toBe("max");
    expect(normalizeClaudeSubscriptionType("maxPlan")).toBe("max");
  });

  it("collapses capacity tiers onto their plan family", () => {
    expect(normalizeClaudeSubscriptionType("max5")).toBe("max");
    expect(normalizeClaudeSubscriptionType("Max 5x")).toBe("max");
    expect(normalizeClaudeSubscriptionType("Max 20x")).toBe("max");
    expect(normalizeClaudeSubscriptionType("Claude Max 20x Subscription")).toBe("max");
  });

  it("rejects non-subscription and unknown authentication strings", () => {
    expect(normalizeClaudeSubscriptionType("apiKey")).toBeUndefined();
    expect(normalizeClaudeSubscriptionType("Anthropic API Key")).toBeUndefined();
    expect(normalizeClaudeSubscriptionType("claude")).toBeUndefined();
    expect(normalizeClaudeSubscriptionType("some-future-plan")).toBeUndefined();
    expect(normalizeClaudeSubscriptionType("")).toBeUndefined();
    expect(normalizeClaudeSubscriptionType("   ")).toBeUndefined();
    expect(normalizeClaudeSubscriptionType(undefined)).toBeUndefined();
    expect(normalizeClaudeSubscriptionType(null)).toBeUndefined();
  });

  it("canonicalizes free without granting it subscription entitlements", () => {
    expect(normalizeClaudeSubscriptionType("Claude Free Subscription")).toBe("free");
    expect(CLAUDE_SUBSCRIPTION_PLAN_TYPES.has("free")).toBe(false);
    expect(isClaudeSubscriptionPlanType("Claude Free Subscription")).toBe(false);
  });
});

describe("isClaudeSubscriptionPlanType", () => {
  it("accepts every entitled plan family in bare and decorated form", () => {
    for (const value of [
      "max",
      "Claude Max",
      "Claude Max 20x Subscription",
      "pro",
      "Claude Pro Subscription",
      "team",
      "Claude Team Subscription",
      "enterprise",
      "Claude Enterprise Subscription",
    ]) {
      expect(isClaudeSubscriptionPlanType(value)).toBe(true);
    }
  });

  it("rejects unentitled and unknown values", () => {
    for (const value of ["apiKey", "free", "Claude Free Subscription", "", undefined, null]) {
      expect(isClaudeSubscriptionPlanType(value)).toBe(false);
    }
  });
});
