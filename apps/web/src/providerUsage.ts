import type {
  ServerProvider,
  ServerProviderAccountRateLimitSnapshot,
  ServerProviderAccountRateLimitWindow,
} from "@cafecode/contracts";
import { identifyModelPacingLimit } from "./modelPacing";

export function isProviderUsageStale(
  checkedAt: string | undefined,
  nowMs: number,
  pollMinutes: number,
): boolean {
  const checkedMs = checkedAt ? Date.parse(checkedAt) : Number.NaN;
  return (
    !Number.isFinite(checkedMs) ||
    nowMs - checkedMs > Math.max(600_000, pollMinutes * 120_000) ||
    checkedMs > nowMs + 60_000
  );
}

export function canRefreshProviderUsage(provider: ServerProvider): boolean {
  return (
    provider.runtimeCapabilities?.accountUsage === true &&
    provider.enabled &&
    provider.installed &&
    provider.availability !== "unavailable" &&
    provider.auth.status === "authenticated"
  );
}

export function providerUsageState(provider: ServerProvider): string | null {
  if (!provider.enabled || provider.status === "disabled") return "Provider is disabled.";
  if (!provider.installed || provider.availability === "unavailable")
    return "Provider runtime is unavailable.";
  if (provider.auth.status === "unauthenticated") return "Sign in to read account usage.";
  if (provider.auth.status === "unknown") return "Authentication is unknown.";
  if (provider.accountRateLimits) return null;
  return provider.runtimeCapabilities?.accountUsage === true
    ? "No provider-reported usage received yet."
    : "This provider has no account-usage polling capability.";
}

export function buildProviderUsageRows(
  provider: ServerProvider,
  nowMs: number,
  pollMinutes: number,
) {
  const account = provider.accountRateLimits;
  const snapshots: ReadonlyArray<readonly [string, ServerProviderAccountRateLimitSnapshot]> =
    account?.rateLimitsByLimitId && Object.keys(account.rateLimitsByLimitId).length > 0
      ? Object.entries(account.rateLimitsByLimitId)
      : account
        ? [["default", account.rateLimits]]
        : [];
  const checkedMs = account ? Date.parse(account.checkedAt) : Number.NaN;
  const stale = isProviderUsageStale(account?.checkedAt, nowMs, pollMinutes);
  const windows = snapshots.flatMap(([key, snapshot]) => {
    const identity = identifyModelPacingLimit({
      snapshotKey: key,
      snapshot,
      models: provider.models,
    });
    return (
      [
        ["primary", snapshot.primary],
        ["secondary", snapshot.secondary],
      ] as const
    ).flatMap(([kind, window]) => {
      if (!window) return [];
      const used = window.usedPercent;
      const usedPercent =
        typeof used === "number" && Number.isFinite(used) ? Math.max(0, Math.min(100, used)) : null;
      const reset = window.resetsAt;
      const resetsAt =
        typeof reset === "number" &&
        Number.isFinite(reset) &&
        reset > 0 &&
        reset * 1_000 <= 8_640_000_000_000_000
          ? reset
          : null;
      if (usedPercent === null && resetsAt === null) return [];
      return [
        {
          key: `${key}:${kind}`,
          kind,
          identity,
          usedPercent,
          resetsAt,
          stale: isProviderUsageStale(window.checkedAt ?? account?.checkedAt, nowMs, pollMinutes),
          window: window as ServerProviderAccountRateLimitWindow,
        },
      ];
    });
  });
  const count = account?.rateLimitResetCredits?.availableCount;
  const resetCredits =
    typeof count === "number" && Number.isSafeInteger(count) && count >= 0 ? count : null;
  const exhausted = snapshots.some(
    ([, snapshot]) =>
      Boolean(snapshot.rateLimitReachedType) ||
      snapshot.spendControlReached === true ||
      (snapshot.primary?.usedPercent ?? 0) >= 100 ||
      (snapshot.secondary?.usedPercent ?? 0) >= 100 ||
      (snapshot.individualLimit?.remainingPercent ?? 1) <= 0,
  );
  return {
    windows,
    stale,
    checkedAt: Number.isFinite(checkedMs) ? account!.checkedAt : null,
    resetCredits,
    exhausted,
    paidUsage: account?.paidUsage ?? null,
    paidUsageStale: isProviderUsageStale(account?.paidUsage?.checkedAt, nowMs, pollMinutes),
  };
}
