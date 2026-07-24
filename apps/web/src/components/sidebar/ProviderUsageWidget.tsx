import type {
  ServerProvider,
  ServerProviderAccountRateLimitSnapshot,
  ServerProviderAccountRateLimitWindow,
} from "@cafecode/contracts";
import { GaugeIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { useSettings } from "../../hooks/useSettings";
import { applyProvidersUpdated, useServerProviders } from "../../rpc/serverState";
import { cn } from "../../lib/utils";
import {
  calculateModelPacing,
  formatModelPacingDuration,
  identifyModelPacingLimit,
  type ModelPacingLimitIdentity,
  type ModelPacingResult,
} from "../../modelPacing";

interface UsageWindowRow {
  readonly key: string;
  readonly label: string;
  readonly usedPercent: number | null;
  readonly resetsAt: number | null;
  readonly window: ServerProviderAccountRateLimitWindow;
  readonly identity: ModelPacingLimitIdentity;
}

interface UsageExhaustionNotice {
  readonly key: string;
  readonly label: string;
  readonly message: string;
}

interface ProviderUsageRow {
  readonly instanceId: ServerProvider["instanceId"];
  readonly name: string;
  readonly checkedAt: string;
  readonly windows: ReadonlyArray<UsageWindowRow>;
  readonly exhaustionNotices: ReadonlyArray<UsageExhaustionNotice>;
}

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));

function durationLabel(minutes: number | null | undefined): string | null {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  if (minutes < 1_440) {
    return `${Math.round(minutes / 60)}h`;
  }
  return `${Math.round(minutes / 1_440)}d`;
}

function resetLabel(epochSeconds: number | null): string | null {
  if (epochSeconds === null || !Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return null;
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(epochSeconds * 1_000));
}

function windowRow(
  key: string,
  fallbackLabel: string,
  window: ServerProviderAccountRateLimitWindow | null | undefined,
  identity: ModelPacingLimitIdentity,
): UsageWindowRow | null {
  if (!window) {
    return null;
  }
  const usedPercent =
    typeof window.usedPercent === "number" && Number.isFinite(window.usedPercent)
      ? clampPercent(window.usedPercent)
      : null;
  const resetsAt =
    typeof window.resetsAt === "number" && Number.isFinite(window.resetsAt)
      ? window.resetsAt
      : null;
  if (usedPercent === null && resetsAt === null) {
    return null;
  }
  const duration = durationLabel(window.windowDurationMins);
  return {
    key,
    label: duration ? `${fallbackLabel} · ${duration}` : fallbackLabel,
    usedPercent,
    resetsAt,
    window,
    identity,
  };
}

function snapshotWindows(
  snapshotKey: string,
  snapshot: ServerProviderAccountRateLimitSnapshot,
  provider: ServerProvider,
): ReadonlyArray<UsageWindowRow> {
  const identity = identifyModelPacingLimit({
    snapshotKey,
    snapshot,
    models: provider.models,
  });
  const snapshotLabel = identity.label;
  return [
    windowRow(`${snapshotKey}:primary`, `${snapshotLabel} session`, snapshot.primary, identity),
    windowRow(`${snapshotKey}:secondary`, `${snapshotLabel} weekly`, snapshot.secondary, identity),
  ].filter((row): row is UsageWindowRow => row !== null);
}

function snapshotExhaustionNotices(
  snapshotKey: string,
  snapshot: ServerProviderAccountRateLimitSnapshot,
  provider: ServerProvider,
): ReadonlyArray<UsageExhaustionNotice> {
  const identity = identifyModelPacingLimit({
    snapshotKey,
    snapshot,
    models: provider.models,
  });
  const notices: UsageExhaustionNotice[] = [];
  const add = (suffix: string, message: string) => {
    notices.push({
      key: `${snapshotKey}:${suffix}`,
      label: identity.label,
      message,
    });
  };

  if (snapshot.rateLimitReachedType) {
    add("provider-reached", "The provider reports that this usage limit has been reached.");
  }
  if (snapshot.spendControlReached) {
    add("spend-control", "The provider reports that this spend control has been reached.");
  }
  if ((snapshot.primary?.usedPercent ?? 0) >= 100) {
    add("primary", "The current session window is exhausted.");
  }
  if ((snapshot.secondary?.usedPercent ?? 0) >= 100) {
    add("secondary", "The weekly window is exhausted.");
  }
  if ((snapshot.individualLimit?.remainingPercent ?? 1) <= 0) {
    add("individual", "The provider reports no remaining individual spend allowance.");
  }

  return notices;
}

export function buildProviderUsageRows(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderUsageRow> {
  return providers.flatMap((provider) => {
    if (
      (provider.driver !== "codex" && provider.driver !== "claudeAgent") ||
      provider.auth.status !== "authenticated" ||
      !provider.accountRateLimits
    ) {
      return [];
    }
    const byLimitId = provider.accountRateLimits.rateLimitsByLimitId;
    const snapshots =
      byLimitId && Object.keys(byLimitId).length > 0
        ? Object.entries(byLimitId)
        : [["default", provider.accountRateLimits.rateLimits] as const];
    const windows = snapshots.flatMap(([key, snapshot]) =>
      snapshotWindows(key, snapshot, provider),
    );
    const exhaustionNotices = snapshots.flatMap(([key, snapshot]) =>
      snapshotExhaustionNotices(key, snapshot, provider),
    );
    if (windows.length === 0 && exhaustionNotices.length === 0) {
      return [];
    }
    return [
      {
        instanceId: provider.instanceId,
        name: provider.displayName ?? (provider.driver === "codex" ? "Codex" : "Claude"),
        checkedAt: provider.accountRateLimits.checkedAt,
        windows,
        exhaustionNotices,
      },
    ];
  });
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

function contextualRecommendation(
  pacing: ModelPacingResult,
  identity: ModelPacingLimitIdentity,
): string {
  if (identity.scope !== "model") {
    return pacing.recommendation;
  }
  if (pacing.status === "under-pace") {
    return `Under pace for ${identity.label}: room to use it.`;
  }
  if (pacing.status === "over-pace") {
    return `Over pace for ${identity.label}: conserve it until reset.`;
  }
  if (pacing.status === "on-pace") {
    return `${identity.label} is on pace.`;
  }
  return pacing.recommendation;
}

export function ProviderUsageWidget() {
  const settings = useSettings();
  const providers = useServerProviders();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const refreshInFlight = useRef(false);
  const currentRefreshableInstanceIds = useMemo(
    () =>
      providers
        .filter(
          (provider) =>
            (provider.driver === "codex" || provider.driver === "claudeAgent") &&
            provider.auth.status === "authenticated",
        )
        .map((provider) => provider.instanceId)
        .toSorted(),
    [providers],
  );
  const refreshableKey = currentRefreshableInstanceIds.join("\u0000");
  const refreshableInstanceIds = useMemo(
    () =>
      refreshableKey.length === 0
        ? []
        : refreshableKey
            .split("\u0000")
            .map((instanceId) => instanceId as (typeof currentRefreshableInstanceIds)[number]),
    [refreshableKey],
  );
  const rows = useMemo(() => buildProviderUsageRows(providers), [providers]);

  const refresh = useCallback(async () => {
    if (
      refreshInFlight.current ||
      document.visibilityState !== "visible" ||
      refreshableInstanceIds.length === 0
    ) {
      return;
    }
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const connection = getPrimaryEnvironmentConnection();
      const results = await Promise.allSettled(
        refreshableInstanceIds.map((instanceId) =>
          connection.client.server.refreshProviders({ instanceId, usageOnly: true }),
        ),
      );
      let failed = false;
      for (const result of results) {
        if (result.status === "fulfilled") {
          applyProvidersUpdated(result.value);
        } else {
          failed = true;
        }
      }
      setRefreshFailed(failed);
    } catch {
      // The primary environment can disappear between the visibility check
      // and the RPC lookup. Polling is optional UI telemetry; contain that
      // race and report an incomplete refresh instead of leaking an unhandled
      // rejection into the renderer.
      setRefreshFailed(true);
    } finally {
      refreshInFlight.current = false;
      setRefreshing(false);
    }
  }, [refreshableInstanceIds]);

  useEffect(() => {
    if (!settings.providerUsageWidgetEnabled) {
      return;
    }
    void refresh();
    const intervalId = window.setInterval(
      () => void refresh(),
      settings.providerUsagePollMinutes * 60_000,
    );
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh, settings.providerUsagePollMinutes, settings.providerUsageWidgetEnabled]);

  useEffect(() => {
    if (!settings.modelPacingEnabled) {
      return;
    }
    let intervalId: number | undefined;
    const updateClock = () => setNowMs(Date.now());
    const stopClock = () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    const startClock = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      updateClock();
      intervalId = window.setInterval(updateClock, 30_000);
    };
    const onVisibilityChange = () => {
      stopClock();
      startClock();
    };

    startClock();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      stopClock();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [settings.modelPacingEnabled]);

  if (!settings.providerUsageWidgetEnabled) {
    return null;
  }

  return (
    <section
      aria-label="Provider usage limits"
      className="mx-2 mb-1 rounded-lg border border-sidebar-border/70 bg-sidebar-accent/25 p-2.5 group-data-[collapsible=icon]:hidden"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-sidebar-foreground/85">
          <GaugeIcon aria-hidden className="size-3.5" />
          <span>Provider usage</span>
        </div>
        <button
          aria-label="Refresh provider usage"
          className="rounded p-1 text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-45"
          disabled={refreshing || refreshableInstanceIds.length === 0}
          onClick={() => void refresh()}
          title={refreshFailed ? "Last refresh was incomplete" : "Refresh usage"}
          type="button"
        >
          <RefreshCwIcon
            aria-hidden
            className={cn("size-3", refreshing && "animate-spin motion-reduce:animate-none")}
          />
        </button>
      </div>
      {settings.modelPacingEnabled ? (
        <p className="mt-1 text-[9px] leading-relaxed text-sidebar-foreground/45">
          Model Pacing reserves {settings.modelPacingReservePercent}% and never reroutes chats.
          Provider-reported exhaustion overrides pace advice.
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="mt-2 space-y-3">
          {rows.map((provider) => (
            <div key={provider.instanceId}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="truncate text-[10px] font-medium text-sidebar-foreground/75">
                  {provider.name}
                </span>
                <time
                  className="shrink-0 text-[9px] tabular-nums text-sidebar-foreground/40"
                  dateTime={provider.checkedAt}
                  title={`Checked ${new Date(provider.checkedAt).toLocaleString()}`}
                >
                  checked{" "}
                  {new Date(provider.checkedAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <div className="space-y-2">
                {provider.exhaustionNotices.map((notice) => (
                  <div
                    className="rounded border border-destructive/45 bg-destructive/10 px-1.5 py-1 text-[9px] font-medium leading-relaxed text-destructive"
                    data-provider-usage-exhausted
                    key={notice.key}
                    role="alert"
                  >
                    {notice.label}: {notice.message}
                  </div>
                ))}
                {provider.windows.map((window) => {
                  const reset = resetLabel(window.resetsAt);
                  const pacing = settings.modelPacingEnabled
                    ? calculateModelPacing({
                        window: window.window,
                        nowMs,
                        reservePercent: settings.modelPacingReservePercent,
                      })
                    : null;
                  return (
                    <div key={window.key}>
                      <div className="flex items-center justify-between gap-2 text-[9px]">
                        <span className="min-w-0 truncate text-sidebar-foreground/55">
                          {window.label}
                        </span>
                        <span className="shrink-0 font-medium tabular-nums text-sidebar-foreground/75">
                          {window.usedPercent === null
                            ? "usage unknown"
                            : `${Math.round(window.usedPercent * 10) / 10}% used`}
                        </span>
                      </div>
                      {window.usedPercent !== null ? (
                        <div
                          aria-label={`${provider.name} ${window.label}`}
                          aria-valuemax={100}
                          aria-valuemin={0}
                          aria-valuenow={window.usedPercent}
                          className="mt-1 h-1 overflow-hidden rounded-full bg-sidebar-border/70"
                          role="meter"
                        >
                          <div
                            aria-hidden
                            className={cn(
                              "h-full rounded-full",
                              window.usedPercent >= 90
                                ? "bg-destructive/80"
                                : window.usedPercent >= 70
                                  ? "bg-amber-500/75"
                                  : "bg-primary/70",
                            )}
                            style={{ width: `${window.usedPercent}%` }}
                          />
                        </div>
                      ) : null}
                      {reset ? (
                        <div className="mt-0.5 text-right text-[9px] tabular-nums text-sidebar-foreground/40">
                          resets {reset}
                        </div>
                      ) : null}
                      {pacing ? (
                        <div
                          className={cn(
                            "mt-1 rounded border px-1.5 py-1 text-[9px] leading-relaxed",
                            pacing.status === "over-pace"
                              ? "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : pacing.status === "under-pace"
                                ? "border-primary/30 bg-primary/10 text-sidebar-foreground/75"
                                : "border-sidebar-border/60 bg-sidebar-accent/35 text-sidebar-foreground/60",
                          )}
                          data-model-pacing-status={pacing.status}
                        >
                          <div className="flex flex-wrap justify-between gap-x-2 tabular-nums">
                            <span>
                              {pacing.remainingPercent === null
                                ? "remaining unknown"
                                : `${formatPercent(pacing.remainingPercent)} remaining`}
                            </span>
                            <span>{formatModelPacingDuration(pacing.timeToResetMs)}</span>
                          </div>
                          {pacing.targetUsedPercent !== null &&
                          pacing.targetRemainingPercent !== null ? (
                            <div className="text-sidebar-foreground/50 tabular-nums">
                              Target now: {formatPercent(pacing.targetUsedPercent)} used /{" "}
                              {formatPercent(pacing.targetRemainingPercent)} remaining
                            </div>
                          ) : null}
                          <div className="font-medium">
                            {contextualRecommendation(pacing, window.identity)}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[10px] leading-relaxed text-sidebar-foreground/50">
          Usage appears when an authenticated provider reports limits.
        </p>
      )}
      {refreshFailed ? (
        <p className="mt-1.5 text-[9px] text-amber-600 dark:text-amber-400">
          Some usage windows could not refresh.
        </p>
      ) : null}
    </section>
  );
}
