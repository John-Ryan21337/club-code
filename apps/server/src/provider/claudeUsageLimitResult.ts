/**
 * Classifies a Claude Agent SDK `result` message as a genuine usage/session-
 * limit rejection (Cafe's 429-equivalent for Claude), distinct from other
 * `is_error` results such as authentication failures or generic execution
 * errors.
 *
 * The pinned SDK types `api_error_status?: number | null` only on
 * `SDKResultSuccess`, yet Cafe has observed it populated on genuine-error
 * results in practice (`is_error: true` alongside `subtype: "success"` and a
 * human-readable usage-limit `result` string). `ClaudeAdapter.ts`'s existing
 * `isClaudeAuthFailureResult` already reads `api_error_status` the same
 * defensive way (an untyped cast, checking `=== 401`) rather than narrowing
 * strictly by `subtype`; this module mirrors that shape for `429`.
 *
 * Prefer the structured `api_error_status === 429` signal over free-text
 * matching. The SDK's own `USAGE_LIMIT_ERROR_PREFIXES` (an `@alpha` export,
 * documented as the exact error-path output of the SDK's internal
 * `getLimitReachedText`/`getFableCreditsRequiredContent`) is used only as a
 * secondary confirmation when the numeric status is absent.
 *
 * @module claudeUsageLimitResult
 */
import { USAGE_LIMIT_ERROR_PREFIXES } from "@anthropic-ai/claude-agent-sdk";

const USAGE_LIMIT_API_ERROR_STATUS = 429;

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Mirrors `resultPrimaryError` in `ClaudeAdapter.ts`: `errors[0]` else `result`. */
function primaryResultText(record: Record<string, unknown>): string | undefined {
  if (Array.isArray(record.errors)) {
    const first = record.errors.find((entry): entry is string => typeof entry === "string");
    if (first !== undefined && first.trim().length > 0) return first;
  }
  return typeof record.result === "string" && record.result.trim().length > 0
    ? record.result
    : undefined;
}

/**
 * Whether a Claude Agent SDK `result` message represents a genuine usage or
 * session-limit rejection rather than a generic execution/auth failure.
 * Accepts `unknown` so callers can pass a raw native message without an
 * SDK-typed import at the call site.
 */
export function isClaudeUsageLimitResult(message: unknown): boolean {
  const record = recordValue(message);
  if (record === undefined || record.type !== "result" || record.is_error !== true) {
    return false;
  }
  if (record.api_error_status === USAGE_LIMIT_API_ERROR_STATUS) return true;

  const text = primaryResultText(record);
  return text !== undefined && USAGE_LIMIT_ERROR_PREFIXES.some((prefix) => text.startsWith(prefix));
}
