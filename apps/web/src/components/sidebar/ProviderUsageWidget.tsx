import type { ServerProvider } from "@cafecode/contracts";
import { GaugeIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { useSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { useServerConfig, useServerProviders } from "../../rpc/serverState";
import { useSidebar } from "../ui/sidebar";
import {
  projectProviderUsageRows,
  type ProviderUsageDetail,
  type ProviderUsageRow,
} from "./providerUsageProjection";

function isRefreshable(provider: ServerProvider): boolean {
  return (
    provider.availability !== "unavailable" &&
    provider.enabled &&
    provider.installed &&
    (provider.status === "ready" || provider.status === "warning") &&
    provider.auth.status === "authenticated"
  );
}

function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const remainder = minutes % 60;
  if (days > 0) return `${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${remainder > 0 ? ` ${remainder}m` : ""}`;
  return `${remainder}m`;
}

function formatEpochSeconds(epochSeconds: number | null): string | null {
  if (epochSeconds === null) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(epochSeconds * 1_000));
}

function formatCheckedAt(checkedAt: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(checkedAt));
}

function detailValue(detail: ProviderUsageDetail): string {
  switch (detail.kind) {
    case "credits":
      return detail.availability === "unlimited"
        ? "Unlimited"
        : detail.availability === "available"
          ? "Available"
          : "Unavailable";
    case "individual-spend": {
      const remaining =
        detail.remainingPercent === null
          ? "Remaining usage unknown"
          : `${Math.round(detail.remainingPercent * 10) / 10}% remaining`;
      const reset = formatEpochSeconds(detail.resetsAt);
      return reset === null ? remaining : `${remaining} · resets ${reset}`;
    }
    case "reset-credits":
      return `${detail.availableCount} available`;
  }
}

function withOccurrenceKeys<T>(
  values: ReadonlyArray<T>,
  baseKey: (value: T) => string,
): ReadonlyArray<{ readonly key: string; readonly value: T }> {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const base = baseKey(value);
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return { key: `${base}:${occurrence}`, value };
  });
}

function ProviderUsageRowView({ row }: { readonly row: ProviderUsageRow }) {
  return (
    <div data-provider-usage-row>
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-medium text-sidebar-foreground/80">
            {row.name}
          </div>
          {row.name === row.driverLabel ? null : (
            <div className="truncate text-[9px] text-sidebar-foreground/45">{row.driverLabel}</div>
          )}
        </div>
        {row.checkedAt === null ? null : (
          <time
            className="shrink-0 text-[9px] tabular-nums text-sidebar-foreground/45"
            dateTime={row.checkedAt}
          >
            checked {formatCheckedAt(row.checkedAt)}
          </time>
        )}
      </div>

      {row.state !== "reported" ? (
        <div
          className="rounded border border-sidebar-border/60 bg-sidebar-accent/30 px-1.5 py-1"
          data-provider-usage-state={row.state}
        >
          <div className="text-[9px] font-medium text-sidebar-foreground/70">{row.stateLabel}</div>
          {row.stateDetail === null ? null : (
            <div className="mt-0.5 text-[9px] leading-relaxed text-sidebar-foreground/50">
              {row.stateDetail}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {withOccurrenceKeys(
            row.exhaustionNotices,
            (notice) => `${notice.label}:${notice.message}`,
          ).map(({ key, value: notice }) => (
            <div
              className="rounded border border-destructive/45 bg-destructive/10 px-1.5 py-1 text-[9px] font-medium leading-relaxed text-destructive"
              data-provider-usage-exhausted
              key={key}
              role="status"
            >
              {notice.label}: {notice.message}
            </div>
          ))}
          {withOccurrenceKeys(row.issues, (issue) => issue.code).map(({ key, value: issue }) => (
            <div
              className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[9px] leading-relaxed text-amber-700 dark:text-amber-300"
              data-provider-usage-issue={issue.code}
              key={key}
              role="status"
            >
              {issue.message}
            </div>
          ))}
          {withOccurrenceKeys(row.windows, (window) => window.label).map(
            ({ key, value: window }) => {
              const duration = formatDuration(window.windowDurationMins);
              const reset = formatEpochSeconds(window.resetsAt);
              const label = duration === null ? window.label : `${window.label} · ${duration}`;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between gap-2 text-[9px]">
                    <span className="min-w-0 truncate text-sidebar-foreground/60">{label}</span>
                    <span className="shrink-0 font-medium tabular-nums text-sidebar-foreground/80">
                      {window.usedPercent === null
                        ? "usage unknown"
                        : `${Math.round(window.usedPercent * 10) / 10}% used`}
                    </span>
                  </div>
                  {window.usedPercent === null ? null : (
                    <div
                      aria-label={`${row.name} ${window.label}`}
                      aria-valuemax={100}
                      aria-valuemin={0}
                      aria-valuenow={window.usedPercent}
                      aria-valuetext={`${Math.round(window.usedPercent * 10) / 10}% used`}
                      className="mt-1 h-1 overflow-hidden rounded-full bg-sidebar-border/70"
                      role="meter"
                    >
                      <div
                        aria-hidden
                        className={cn(
                          "h-full rounded-full",
                          window.exhausted || window.usedPercent >= 90
                            ? "bg-destructive/80"
                            : window.usedPercent >= 70
                              ? "bg-amber-500/75"
                              : "bg-primary/70",
                        )}
                        style={{ width: `${window.usedPercent}%` }}
                      />
                    </div>
                  )}
                  {reset === null ? null : (
                    <div className="mt-0.5 text-right text-[9px] tabular-nums text-sidebar-foreground/45">
                      resets {reset}
                    </div>
                  )}
                </div>
              );
            },
          )}
          {withOccurrenceKeys(row.details, (detail) => `${detail.kind}:${detail.label}`).map(
            ({ key, value: detail }) => (
              <div className="flex items-start justify-between gap-2 text-[9px]" key={key}>
                <span className="text-sidebar-foreground/60">{detail.label}</span>
                <span className="text-right font-medium text-sidebar-foreground/80">
                  {detailValue(detail)}
                </span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function ProviderUsageWidget() {
  const settings = useSettings();
  const serverConfig = useServerConfig();
  const providers = useServerProviders();
  const { isMobile, openMobile, state: sidebarState } = useSidebar();
  const [refreshing, setRefreshing] = useState(false);
  const [failedInstanceIds, setFailedInstanceIds] = useState<
    ReadonlySet<ServerProvider["instanceId"]>
  >(() => new Set());
  const refreshInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const surfaceVisible = isMobile ? openMobile : sidebarState === "expanded";
  const refreshAllowed = settings.providerUsageWidgetEnabled && surfaceVisible;
  const inputs = useMemo(
    () =>
      providers
        .filter(isRefreshable)
        .map((provider) => ({ instanceId: provider.instanceId }))
        .toSorted((left, right) => String(left.instanceId).localeCompare(String(right.instanceId))),
    [providers],
  );
  const inputsKey = inputs.map(({ instanceId }) => instanceId).join("\u0000");
  const eligibleInstanceIds = useMemo(
    () => new Set(inputs.map(({ instanceId }) => instanceId)),
    [inputs],
  );
  const configuredInstanceIds = useMemo(
    () => new Set(providers.map(({ instanceId }) => instanceId)),
    [providers],
  );
  const refreshAllowedRef = useRef(refreshAllowed);
  const inputsRef = useRef(inputs);
  const eligibleInstanceIdsRef = useRef(eligibleInstanceIds);
  const configuredInstanceIdsRef = useRef(configuredInstanceIds);
  refreshAllowedRef.current = refreshAllowed;
  inputsRef.current = inputs;
  eligibleInstanceIdsRef.current = eligibleInstanceIds;
  configuredInstanceIdsRef.current = configuredInstanceIds;

  const rows = useMemo(
    () =>
      projectProviderUsageRows(providers, {
        refreshFailedInstanceIds: failedInstanceIds,
      }),
    [failedInstanceIds, providers],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setFailedInstanceIds((current) => {
      const next = new Set(
        [...current].filter((instanceId) => configuredInstanceIds.has(instanceId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [configuredInstanceIds]);

  const refresh = useCallback(async () => {
    const pendingInputs = inputsRef.current;
    if (
      pendingInputs.length === 0 ||
      refreshInFlightRef.current ||
      !refreshAllowedRef.current ||
      document.visibilityState !== "visible"
    ) {
      return;
    }

    refreshInFlightRef.current = true;
    if (mountedRef.current) setRefreshing(true);
    try {
      const connection = getPrimaryEnvironmentConnection();
      const outcomes = await connection.client.server.refreshProviderUsageSequentially(
        pendingInputs,
        {
          shouldStartNext: (input) =>
            mountedRef.current &&
            refreshAllowedRef.current &&
            document.visibilityState === "visible" &&
            eligibleInstanceIdsRef.current.has(input.instanceId),
        },
      );
      if (!mountedRef.current) return;
      setFailedInstanceIds((current) => {
        const currentlyConfigured = configuredInstanceIdsRef.current;
        const next = new Set(
          [...current].filter((instanceId) => currentlyConfigured.has(instanceId)),
        );
        outcomes.forEach((outcome, index) => {
          const instanceId = pendingInputs[index]?.instanceId;
          if (
            instanceId === undefined ||
            !currentlyConfigured.has(instanceId) ||
            outcome.status === "not-started"
          ) {
            return;
          }
          if (outcome.status === "rejected") {
            next.add(instanceId);
          } else {
            next.delete(instanceId);
          }
        });
        return next;
      });
    } catch {
      if (mountedRef.current) {
        setFailedInstanceIds(
          new Set(
            pendingInputs
              .map(({ instanceId }) => instanceId)
              .filter((instanceId) => configuredInstanceIdsRef.current.has(instanceId)),
          ),
        );
      }
    } finally {
      refreshInFlightRef.current = false;
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!refreshAllowed) return;

    void refresh();
    const intervalId = window.setInterval(
      () => void refresh(),
      settings.providerUsagePollMinutes * 60_000,
    );
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [inputsKey, refresh, refreshAllowed, settings.providerUsagePollMinutes]);

  if (!settings.providerUsageWidgetEnabled) return null;

  return (
    <section
      aria-label="Provider usage limits"
      className="mx-2 mb-1 max-h-[38vh] shrink-0 overflow-y-auto rounded-lg border border-sidebar-border/70 bg-sidebar-accent/25 p-2.5 group-data-[collapsible=icon]:hidden"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-sidebar-foreground/85">
          <GaugeIcon aria-hidden className="size-3.5" />
          <span>Provider usage</span>
        </div>
        <button
          aria-label="Refresh provider usage"
          className="rounded p-1 text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-45"
          disabled={refreshing || inputs.length === 0 || !surfaceVisible}
          onClick={() => void refresh()}
          title={inputs.length === 0 ? "No eligible provider can refresh usage" : "Refresh usage"}
          type="button"
        >
          <RefreshCwIcon
            aria-hidden
            className={cn("size-3", refreshing && "animate-spin motion-reduce:animate-none")}
          />
        </button>
      </div>

      {serverConfig === null ? (
        <p className="mt-2 text-[10px] leading-relaxed text-sidebar-foreground/50">
          Loading provider instances…
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-[10px] leading-relaxed text-sidebar-foreground/50">
          No provider instances are configured.
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          {withOccurrenceKeys(rows, (row) => `${row.driverLabel}:${row.name}`).map(
            ({ key, value: row }) => (
              <ProviderUsageRowView key={key} row={row} />
            ),
          )}
        </div>
      )}
    </section>
  );
}
