/**
 * Canonicalizes the Claude subscription/plan string that the Claude Agent SDK
 * reports through `account.subscriptionType` and the `/usage` control
 * response's `subscription_type`.
 *
 * That upstream value is presentational and has shipped in several decorated
 * forms for the same plan — `"max"`, `"maxPlan"`, `"Claude Max"`,
 * `"Claude Max 20x Subscription"`. Gating account-usage behavior on an exact
 * match against bare plan names therefore silently disables usage reporting
 * whenever upstream re-decorates the string, which is exactly how Claude
 * account usage regressed to "usage unknown".
 *
 * Every plan-gated decision must route through {@link normalizeClaudeSubscriptionType}
 * so the driver capability gate and the `/usage` decoder cannot drift apart.
 *
 * @module provider/claudeSubscription
 */

/**
 * Plan families recognized by Club Code. `free` is deliberately included so it
 * canonicalizes rather than falling through as an unknown plan, but it is not a
 * member of {@link CLAUDE_SUBSCRIPTION_PLAN_TYPES}.
 */
const CLAUDE_PLAN_FAMILIES = new Set(["pro", "max", "team", "enterprise", "free"]);

/**
 * Plan families that entitle an account to provider-reported subscription
 * usage. API-key and free authentication expose no subscription windows.
 */
export const CLAUDE_SUBSCRIPTION_PLAN_TYPES: ReadonlySet<string> = new Set([
  "pro",
  "max",
  "team",
  "enterprise",
]);

/**
 * Reduce a reported subscription string to its canonical plan family, or
 * `undefined` when it names no plan family Club Code recognizes.
 *
 * Decoration is stripped in a fixed order: separators and punctuation, then a
 * leading `claude`, then a trailing `subscription`/`plan`, then a trailing
 * capacity tier (`5`, `5x`, `20x`). Unknown plan names are rejected rather than
 * guessed, because their entitlement semantics are unknown.
 */
export function normalizeClaudeSubscriptionType(
  value: string | null | undefined,
): string | undefined {
  if (typeof value !== "string") return undefined;

  let normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.length === 0) return undefined;

  if (normalized.startsWith("claude")) {
    normalized = normalized.slice("claude".length);
  }
  if (normalized.endsWith("subscription")) {
    normalized = normalized.slice(0, -"subscription".length);
  }
  if (normalized.endsWith("plan")) {
    normalized = normalized.slice(0, -"plan".length);
  }
  // Capacity tiers (Max 5x / Max 20x) share their plan family's entitlements.
  normalized = normalized.replace(/[0-9]+x?$/, "");

  return CLAUDE_PLAN_FAMILIES.has(normalized) ? normalized : undefined;
}

/**
 * True when the reported subscription string names a plan family that receives
 * provider-reported subscription usage.
 */
export function isClaudeSubscriptionPlanType(value: string | null | undefined): boolean {
  const normalized = normalizeClaudeSubscriptionType(value);
  return normalized !== undefined && CLAUDE_SUBSCRIPTION_PLAN_TYPES.has(normalized);
}
