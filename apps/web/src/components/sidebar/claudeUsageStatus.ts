import type { ServerProvider } from "@cafecode/contracts";

/** Display telemetry only. This status never grants access or stops a turn. */
export function claudeUsageStatus(provider: ServerProvider, nowMs = Date.now()) {
  if (provider.driver !== "claudeAgent" || provider.auth.status !== "authenticated") return null;
  const account = provider.accountRateLimits?.claudeAccount;
  const ultra = account?.plan === "ultra" || /ultra/i.test(provider.auth.type ?? "");
  if (!ultra) return null;
  const checkedAtMs = Date.parse(account?.checkedAt ?? "");
  const stale = !Number.isFinite(checkedAtMs) || nowMs - checkedAtMs > 5 * 60_000;
  const verification = account?.verification ?? "unknown";
  const message =
    verification === "verified" && account?.fiveHourLimit === "removed"
      ? "Ultra verified: no five-hour limit. Weekly and model limits still apply."
      : verification === "pending" && account?.fiveHourLimit === "applies"
        ? "Ultra verification pending: a temporary five-hour limit applies."
        : "Ultra verification unknown. Refresh usage to check the five-hour limit.";
  return {
    verification,
    stale,
    message: stale && account ? `Last reported (stale): ${message}` : message,
    source:
      "Verification is inferred from Claude's account plan and usage windows, as documented by Anthropic. Phone verification is separate.",
  };
}
