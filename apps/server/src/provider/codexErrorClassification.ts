/**
 * Classifies Codex app-server's structured `codexErrorInfo` (carried on `error`
 * and `codex.subagent/error` notifications, `V2ErrorNotification.error.codexErrorInfo`)
 * into meaningful failure categories.
 *
 * `CodexAdapter.ts` currently decodes this field via the generated schema but only
 * reads sibling fields (`message`, `willRetry`) when mapping to a canonical
 * `runtime.error`/`runtime.warning` event, so `usageLimitExceeded` (a genuine
 * provider-issued quota/session-limit rejection, Cafe's 429-equivalent for Codex)
 * and `serverOverloaded` (a transient, retriable condition) currently receive
 * identical treatment. This module preserves that distinction using the exact
 * generated, version-pinned union as the source of truth instead of matching on
 * display text, so a future caller can tell them apart without re-parsing raw
 * provider payloads.
 *
 * @module codexErrorClassification
 */
import type * as EffectCodexSchema from "effect-codex-app-server/schema";

export type CodexErrorCategory =
  | "usage_limit"
  | "context_window"
  | "session_budget"
  | "overloaded"
  | "auth"
  | "bad_request"
  | "thread_rollback"
  | "sandbox"
  | "cyber_policy"
  | "internal"
  | "not_steerable"
  | "connection"
  | "other";

/**
 * Buckets a decoded `codexErrorInfo` value. Every known literal and
 * object-shaped variant of `V2ErrorNotification__CodexErrorInfo` maps to an
 * explicit category; a missing value or any future/unrecognized literal is
 * conservatively `"other"` rather than being misclassified as a quota
 * rejection or silently dropped.
 */
export function classifyCodexErrorInfo(
  codexErrorInfo: EffectCodexSchema.V2ErrorNotification__CodexErrorInfo | null | undefined,
): CodexErrorCategory {
  if (codexErrorInfo === null || codexErrorInfo === undefined) return "other";

  if (typeof codexErrorInfo === "string") {
    switch (codexErrorInfo) {
      case "usageLimitExceeded":
        return "usage_limit";
      case "contextWindowExceeded":
        return "context_window";
      case "sessionBudgetExceeded":
        return "session_budget";
      case "serverOverloaded":
        return "overloaded";
      case "unauthorized":
        return "auth";
      case "badRequest":
        return "bad_request";
      case "threadRollbackFailed":
        return "thread_rollback";
      case "sandboxError":
        return "sandbox";
      case "cyberPolicy":
        return "cyber_policy";
      case "internalServerError":
        return "internal";
      case "other":
        return "other";
      default:
        // Forward-compatible with a future SDK literal this pin predates.
        return "other";
    }
  }

  if ("activeTurnNotSteerable" in codexErrorInfo) return "not_steerable";
  // httpConnectionFailed / responseStreamConnectionFailed /
  // responseStreamDisconnected / responseTooManyFailedAttempts are all
  // transport-level connectivity failures, not provider-issued rejections.
  return "connection";
}

/** Whether `codexErrorInfo` is a genuine Codex usage/session-limit rejection. */
export function isCodexUsageLimitExceeded(
  codexErrorInfo: EffectCodexSchema.V2ErrorNotification__CodexErrorInfo | null | undefined,
): boolean {
  return classifyCodexErrorInfo(codexErrorInfo) === "usage_limit";
}
