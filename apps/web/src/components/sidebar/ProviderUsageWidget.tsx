import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GaugeIcon, RefreshCwIcon } from "lucide-react";
import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { useSettings } from "../../hooks/useSettings";
import { applyProvidersUpdated, useServerProviders } from "../../rpc/serverState";
import {
  buildProviderUsageRows,
  canRefreshProviderUsage,
  providerUsageState,
} from "../../providerUsage";
import { calculateModelPacing, formatModelPacingDuration } from "../../modelPacing";
import { Button } from "../ui/button";
import { ProviderUsageScrollRegion } from "./ProviderUsageScrollRegion";
import { ProviderResetCredit } from "./ProviderResetCredit";

export function ProviderUsageWidget() {
  const settings = useSettings();
  const providers = useServerProviders();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const current = useRef({ settings, providers });
  current.current = { settings, providers };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    if (
      inFlight.current ||
      !current.current.settings.providerUsageWidgetEnabled ||
      document.visibilityState !== "visible"
    )
      return;
    const targets = current.current.providers.filter(canRefreshProviderUsage);
    if (targets.length === 0) return;
    inFlight.current = true;
    setRefreshing(true);
    let failed = false;
    try {
      const connection = getPrimaryEnvironmentConnection();
      // Serial requests keep an unbounded instance list from becoming a probe burst.
      for (const provider of targets) {
        if (
          !mounted.current ||
          connection !== getPrimaryEnvironmentConnection() ||
          !current.current.settings.providerUsageWidgetEnabled ||
          document.visibilityState !== "visible" ||
          !current.current.providers.some(
            (candidate) =>
              candidate.instanceId === provider.instanceId && canRefreshProviderUsage(candidate),
          )
        )
          break;
        try {
          const result = await connection.client.server.refreshProviders({
            instanceId: provider.instanceId,
            scope: "usage",
          });
          if (mounted.current && connection === getPrimaryEnvironmentConnection())
            applyProvidersUpdated(result);
        } catch {
          failed = true;
        }
      }
    } catch {
      failed = true;
    } finally {
      inFlight.current = false;
      if (mounted.current) {
        setRefreshing(false);
        setRefreshFailed(failed);
        setNowMs(Date.now());
      }
    }
  }, []);
  const targetsKey = providers
    .filter(canRefreshProviderUsage)
    .map((provider) => provider.instanceId)
    .toSorted()
    .join("\u0000");
  useEffect(() => {
    if (!settings.providerUsageWidgetEnabled) return;
    const update = () => {
      if (document.visibilityState === "visible") {
        setNowMs(Date.now());
        void refresh();
      }
    };
    update();
    const poll = window.setInterval(update, settings.providerUsagePollMinutes * 60_000);
    const clock = window.setInterval(() => {
      if (document.visibilityState === "visible") setNowMs(Date.now());
    }, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", update);
    };
  }, [settings.providerUsageWidgetEnabled, settings.providerUsagePollMinutes, targetsKey, refresh]);
  const rows = useMemo(
    () =>
      providers.map((provider) => ({
        provider,
        ...buildProviderUsageRows(provider, nowMs, settings.providerUsagePollMinutes),
      })),
    [providers, nowMs, settings.providerUsagePollMinutes],
  );
  if (!settings.providerUsageWidgetEnabled) return null;
  return (
    <ProviderUsageScrollRegion>
      <div className="text-xs">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 font-medium">
            <GaugeIcon className="size-3.5" />
            Provider usage
          </h2>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Refresh provider usage"
            disabled={refreshing || targetsKey.length === 0}
            onClick={() => void refresh()}
          >
            <RefreshCwIcon className="size-3" />
          </Button>
        </div>
        {refreshFailed ? (
          <p role="status">Usage refresh was incomplete. Last reported values remain visible.</p>
        ) : null}
        {rows.length === 0 ? <p>No configured providers.</p> : null}
        {rows.map(({ provider, windows, stale, checkedAt, resetCredits, exhausted }) => (
          <div key={provider.instanceId} className="mb-3 space-y-1.5">
            <h3 className="truncate font-medium">{provider.displayName || provider.driver}</h3>
            {providerUsageState(provider) ? (
              <p className="text-muted-foreground">{providerUsageState(provider)}</p>
            ) : null}
            {checkedAt ? (
              <time dateTime={checkedAt} className="block text-[10px] text-muted-foreground">
                Checked {new Date(checkedAt).toLocaleTimeString()}
              </time>
            ) : null}
            {stale && windows.length > 0 ? (
              <p role="status" className="text-amber-600">
                Stale: showing last reported values.
              </p>
            ) : null}
            {exhausted ? (
              <p role="status">The provider reports an exhausted usage or spend limit.</p>
            ) : null}
            <p className="text-muted-foreground">Reset credits: {resetCredits ?? "unknown"}</p>
            <ProviderResetCredit
              key={`${provider.instanceId}:${provider.auth.email ?? ""}`}
              provider={provider}
              stale={stale}
            />
            {windows.map((row) => {
              const pacing =
                settings.modelPacingEnabled &&
                !stale &&
                !exhausted &&
                providerUsageState(provider) === null
                  ? calculateModelPacing({
                      window: row.window,
                      nowMs,
                      reservePercent: settings.modelPacingReservePercent,
                    })
                  : null;
              return (
                <div key={row.key} className="rounded-lg border border-sidebar-border p-2">
                  <div>
                    {row.identity.label} · {row.kind}
                  </div>
                  <div>
                    {row.usedPercent === null
                      ? "Usage unknown"
                      : `${Math.round(row.usedPercent)}% used`}
                  </div>
                  {row.usedPercent !== null ? (
                    <progress
                      className="h-1.5 w-full"
                      value={row.usedPercent}
                      max={100}
                      aria-label={`${row.identity.label} ${row.kind} usage`}
                    />
                  ) : null}
                  {row.resetsAt !== null ? (
                    <div className="text-muted-foreground">
                      Resets {new Date(row.resetsAt * 1_000).toLocaleString()}
                    </div>
                  ) : (
                    <div className="text-muted-foreground">Reset time unknown</div>
                  )}
                  {pacing ? (
                    <div className="mt-1 text-[10px]" data-pacing-status={pacing.status}>
                      <p>{pacing.recommendation}</p>
                      <p>
                        {formatModelPacingDuration(pacing.timeToResetMs)} ·{" "}
                        {settings.modelPacingReservePercent}% reserve
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
        {settings.modelPacingEnabled ? (
          <p className="text-[10px] text-muted-foreground">
            Pacing is advice only. Shared account limits do not identify a specific model. It never
            changes models or blocks requests.
          </p>
        ) : null}
      </div>
    </ProviderUsageScrollRegion>
  );
}
