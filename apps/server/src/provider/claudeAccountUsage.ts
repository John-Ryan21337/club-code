import type {
  ServerProviderAccountRateLimitSnapshot,
  ServerProviderAccountRateLimitWindow,
  ServerProviderAccountRateLimits,
  ServerProviderPaidUsage,
} from "@cafecode/contracts";

import {
  CLAUDE_SUBSCRIPTION_PLAN_TYPES,
  normalizeClaudeSubscriptionType,
} from "./claudeSubscription.ts";

const FIVE_HOUR_WINDOW_MINS = 300;
const SEVEN_DAY_WINDOW_MINS = 10_080;
const MAX_MODEL_SCOPED_WINDOWS = 32;
const MAX_LABEL_LENGTH = 80;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

type ParsedOptional<T> = { readonly valid: true; readonly value?: T } | { readonly valid: false };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readBoundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) return undefined;
  for (const character of trimmed) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return undefined;
  }
  return trimmed;
}

function readOptionalNonNegativeNumber(value: unknown): ParsedOptional<number | null> {
  if (value === undefined) return { valid: true };
  if (value === null) return { valid: true, value: null };
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? { valid: true, value }
    : { valid: false };
}

function readOptionalPercent(value: unknown): ParsedOptional<number | null> {
  const parsed = readOptionalNonNegativeNumber(value);
  if (!parsed.valid || parsed.value === undefined || parsed.value === null) return parsed;
  return parsed.value <= 100 ? parsed : { valid: false };
}

function readResetEpochSeconds(value: unknown): ParsedOptional<number | null> {
  if (value === undefined) return { valid: true };
  if (value === null) return { valid: true, value: null };
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) {
    return { valid: false };
  }
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? { valid: true, value: Math.floor(milliseconds / 1_000) }
    : { valid: false };
}

function parseWindow(
  value: unknown,
  windowDurationMins: number,
  checkedAt: string,
): ParsedOptional<ServerProviderAccountRateLimitWindow> {
  if (value === undefined || value === null) return { valid: true };
  const record = asRecord(value);
  if (!record) return { valid: false };

  const utilization = readOptionalPercent(record.utilization);
  const resetsAt = readResetEpochSeconds(record.resets_at);
  if (!utilization.valid || !resetsAt.valid) return { valid: false };

  return {
    valid: true,
    value: {
      ...(typeof utilization.value === "number" ? { usedPercent: utilization.value } : {}),
      windowDurationMins,
      ...(typeof resetsAt.value === "number" ? { resetsAt: resetsAt.value } : {}),
      checkedAt,
    },
  };
}

function canonicalDecimal(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(8)));
}

function parsePaidUsage(value: unknown): ParsedOptional<ServerProviderPaidUsage> {
  if (value === undefined || value === null) return { valid: true };
  const record = asRecord(value);
  if (!record || typeof record.is_enabled !== "boolean") return { valid: false };

  const monthlyLimit = readOptionalNonNegativeNumber(record.monthly_limit);
  const usedCredits = readOptionalNonNegativeNumber(record.used_credits);
  const utilization = readOptionalPercent(record.utilization);
  if (!monthlyLimit.valid || !usedCredits.valid || !utilization.valid) {
    return { valid: false };
  }

  let currency: string | undefined;
  if (record.currency !== undefined && record.currency !== null) {
    const rawCurrency = readBoundedString(record.currency, 3);
    if (!rawCurrency || !/^[a-z]{3}$/i.test(rawCurrency)) return { valid: false };
    currency = rawCurrency.toUpperCase();
  }

  const utilizationPercent = typeof utilization.value === "number" ? utilization.value : undefined;
  return {
    valid: true,
    value: {
      status: record.is_enabled ? "enabled" : "disabled",
      ...(typeof usedCredits.value === "number"
        ? { used: canonicalDecimal(usedCredits.value) }
        : {}),
      ...(typeof monthlyLimit.value === "number"
        ? { limit: canonicalDecimal(monthlyLimit.value) }
        : {}),
      ...(utilizationPercent !== undefined
        ? {
            utilizationPercent,
            remainingPercent: Math.max(0, 100 - utilizationPercent),
          }
        : {}),
      ...(currency ? { currency } : {}),
    },
  };
}

function makeWeeklySnapshot(input: {
  readonly limitId: string;
  readonly limitName: string;
  readonly window: ServerProviderAccountRateLimitWindow;
  readonly planType?: string;
}): ServerProviderAccountRateLimitSnapshot {
  return {
    limitId: input.limitId,
    limitName: input.limitName,
    ...(input.planType ? { planType: input.planType } : {}),
    secondary: input.window,
  };
}

/**
 * Strictly decode the unstable Claude Agent SDK `/usage` control response into
 * the stable, redacted provider-usage contract. Session cost, transcript
 * behavior, account identity, and every unknown field are deliberately dropped.
 */
export function parseClaudeAccountUsage(
  raw: unknown,
  checkedAt: string,
): ServerProviderAccountRateLimits | undefined {
  const root = asRecord(raw);
  if (!root || typeof root.rate_limits_available !== "boolean") return undefined;

  let planType: string | undefined;
  if (root.subscription_type !== undefined && root.subscription_type !== null) {
    const rawPlanType = readBoundedString(root.subscription_type, MAX_LABEL_LENGTH);
    // Canonicalize the decorated upstream plan string before gating on it, so
    // this decoder and the driver capability gate cannot disagree.
    const normalizedPlanType = normalizeClaudeSubscriptionType(rawPlanType);
    if (
      !normalizedPlanType ||
      !CLAUDE_SUBSCRIPTION_PLAN_TYPES.has(normalizedPlanType) ||
      !rawPlanType
    ) {
      return undefined;
    }
    planType = normalizedPlanType;
  }

  const baseSnapshot: ServerProviderAccountRateLimitSnapshot = {
    limitId: "claude",
    limitName: "Claude",
    ...(planType ? { planType } : {}),
  };

  if (!root.rate_limits_available) {
    return { rateLimits: baseSnapshot, checkedAt };
  }
  if (!planType) return undefined;

  const rateLimits = asRecord(root.rate_limits);
  if (!rateLimits) return undefined;

  const fiveHour = parseWindow(rateLimits.five_hour, FIVE_HOUR_WINDOW_MINS, checkedAt);
  const sevenDay = parseWindow(rateLimits.seven_day, SEVEN_DAY_WINDOW_MINS, checkedAt);
  const oauthApps = parseWindow(rateLimits.seven_day_oauth_apps, SEVEN_DAY_WINDOW_MINS, checkedAt);
  const opus = parseWindow(rateLimits.seven_day_opus, SEVEN_DAY_WINDOW_MINS, checkedAt);
  const sonnet = parseWindow(rateLimits.seven_day_sonnet, SEVEN_DAY_WINDOW_MINS, checkedAt);
  const paidUsage = parsePaidUsage(rateLimits.extra_usage);
  if (
    !fiveHour.valid ||
    !sevenDay.valid ||
    !oauthApps.valid ||
    !opus.valid ||
    !sonnet.valid ||
    !paidUsage.valid
  ) {
    return undefined;
  }

  const primarySnapshot: ServerProviderAccountRateLimitSnapshot = {
    ...baseSnapshot,
    ...(fiveHour.value ? { primary: fiveHour.value } : {}),
    ...(sevenDay.value ? { secondary: sevenDay.value } : {}),
  };
  const byLimitId: Record<string, ServerProviderAccountRateLimitSnapshot> = {
    claude: primarySnapshot,
  };

  for (const [limitId, limitName, parsed] of [
    ["claude-oauth-apps", "OAuth apps", oauthApps],
    ["claude-opus", "Opus", opus],
    ["claude-sonnet", "Sonnet", sonnet],
  ] as const) {
    if (parsed.value) {
      byLimitId[limitId] = makeWeeklySnapshot({
        limitId,
        limitName,
        window: parsed.value,
        ...(planType ? { planType } : {}),
      });
    }
  }

  if (rateLimits.model_scoped !== undefined) {
    if (!Array.isArray(rateLimits.model_scoped)) return undefined;
    for (const [index, entry] of rateLimits.model_scoped
      .slice(0, MAX_MODEL_SCOPED_WINDOWS)
      .entries()) {
      const record = asRecord(entry);
      if (!record) return undefined;
      const displayName = readBoundedString(record.display_name, MAX_LABEL_LENGTH);
      const window = parseWindow(record, SEVEN_DAY_WINDOW_MINS, checkedAt);
      if (!displayName || !window.valid) return undefined;
      if (window.value) {
        const limitId = `claude-model-${index + 1}`;
        byLimitId[limitId] = makeWeeklySnapshot({
          limitId,
          limitName: displayName,
          window: window.value,
          ...(planType ? { planType } : {}),
        });
      }
    }
  }

  return {
    rateLimits: primarySnapshot,
    rateLimitsByLimitId: byLimitId,
    ...(paidUsage.value ? { paidUsage: { ...paidUsage.value, checkedAt } } : {}),
    checkedAt,
  };
}
