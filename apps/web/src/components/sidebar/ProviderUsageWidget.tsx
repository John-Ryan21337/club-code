import type {
  ServerProvider,
  ServerProviderAccountRateLimitSnapshot,
  ServerProviderAccountRateLimitWindow,
  ServerProviderPaidUsage,
} from "@cafecode/contracts";
import { GaugeIcon, RefreshCwIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { useSettings } from "../../hooks/useSettings";
import { applyProvidersUpdated, useServerProviders } from "../../rpc/serverState";
import { cn } from "../../lib/utils";
import { useIsPhysicalMobile } from "../../hooks/useMediaQuery";
import { toastManager } from "../ui/toast";
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
  readonly stale: boolean;
}

interface UsageExhaustionNotice {
  readonly key: string;
  readonly label: string;
  readonly message: string;
}

type ProviderUsageState =
  | "available"
  | "unsupported"
  | "disabled"
  | "unavailable"
  | "unauthenticated"
  | "auth-unknown"
  | "no-data";

/**
 * Redeemable usage-limit reset credits for one provider.
 *
 * `availableCount` is always a number so the widget can state a balance rather
 * than hide the row: an absent or malformed upstream field reads as zero, which
 * is also the permanent answer for providers that grant no such credit at all.
 * Only the authoritative aggregate is trusted — the optional per-credit list can
 * be redacted, so counting its rows would understate the balance.
 */
interface ProviderResetCredits {
  readonly availableCount: number;
  readonly supported: boolean;
  readonly redeemable: boolean;
}

interface ProviderUsageRow {
  readonly instanceId: ServerProvider["instanceId"];
  readonly name: string;
  readonly driver: ServerProvider["driver"];
  readonly state: ProviderUsageState;
  readonly stateMessage: string | null;
  readonly checkedAt: string | null;
  readonly stale: boolean;
  readonly windows: ReadonlyArray<UsageWindowRow>;
  readonly exhaustionNotices: ReadonlyArray<UsageExhaustionNotice>;
  readonly paidUsage: ServerProviderPaidUsage | null;
  readonly paidUsageStale: boolean;
  readonly resetCredits: ProviderResetCredits;
}

export const PROVIDER_USAGE_HEIGHT_STORAGE_KEY = "cafe-code:provider-usage-height:v1";
export const DEFAULT_PROVIDER_USAGE_HEIGHT_PX = 448;
export const MIN_PROVIDER_USAGE_HEIGHT_PX = 128;
export const MIN_THREAD_REGION_HEIGHT_PX = 192;

export function clampProviderUsageHeight(height: number, viewportHeight: number): number {
  const maximum = Math.max(
    MIN_PROVIDER_USAGE_HEIGHT_PX,
    viewportHeight - MIN_THREAD_REGION_HEIGHT_PX,
  );
  return Math.round(Math.min(maximum, Math.max(MIN_PROVIDER_USAGE_HEIGHT_PX, height)));
}

function readStoredProviderUsageHeight(): number {
  if (typeof window === "undefined") return DEFAULT_PROVIDER_USAGE_HEIGHT_PX;
  try {
    const stored = Number.parseInt(
      window.localStorage.getItem(PROVIDER_USAGE_HEIGHT_STORAGE_KEY) ?? "",
      10,
    );
    return Number.isFinite(stored) ? stored : DEFAULT_PROVIDER_USAGE_HEIGHT_PX;
  } catch {
    return DEFAULT_PROVIDER_USAGE_HEIGHT_PX;
  }
}

function currentViewportHeight(): number {
  return typeof window === "undefined" ? 800 : window.innerHeight;
}

export function ProviderUsageScrollRegion({ children }: { readonly children: ReactNode }) {
  const isMobile = useIsPhysicalMobile();
  const regionRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ readonly pointerY: number; readonly height: number } | null>(null);
  const [height, setHeight] = useState(readStoredProviderUsageHeight);

  useEffect(() => {
    const clampToViewport = () => {
      setHeight((current) => clampProviderUsageHeight(current, window.innerHeight));
    };
    clampToViewport();
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);

  const persistHeight = useCallback((nextHeight: number) => {
    try {
      window.localStorage.setItem(PROVIDER_USAGE_HEIGHT_STORAGE_KEY, String(nextHeight));
    } catch {
      // Resizing remains available when browser privacy settings disable local storage.
    }
  }, []);

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      dragRef.current = {
        pointerY: event.clientY,
        height: regionRef.current?.getBoundingClientRect().height ?? height,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [height],
  );

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    setHeight(
      clampProviderUsageHeight(drag.height + event.clientY - drag.pointerY, window.innerHeight),
    );
  }, []);

  const finishPointerResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      setHeight((current) => {
        persistHeight(current);
        return current;
      });
    },
    [persistHeight],
  );

  const handleSeparatorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const delta = event.key === "ArrowUp" ? -32 : event.key === "ArrowDown" ? 32 : 0;
      if (delta === 0) return;
      event.preventDefault();
      setHeight((current) => {
        const next = clampProviderUsageHeight(current + delta, window.innerHeight);
        persistHeight(next);
        return next;
      });
    },
    [persistHeight],
  );

  const regionStyle = {
    "--provider-usage-height": `${height}px`,
  } as CSSProperties;

  return (
    <div className="mx-2 mb-1 shrink-0 group-data-[collapsible=icon]:hidden" style={regionStyle}>
      <section
        ref={regionRef}
        aria-label="Provider usage limits"
        className={cn(
          "overflow-y-auto overscroll-contain rounded-lg border border-sidebar-border/70 bg-sidebar-accent/25 p-2.5",
          isMobile
            ? "max-h-[min(30svh,14rem)]"
            : "max-h-[min(var(--provider-usage-height),calc(100svh-12rem))]",
        )}
        data-slot="provider-usage-widget"
      >
        {children}
      </section>
      {!isMobile ? (
        <div
          aria-label="Resize provider usage and thread sections"
          aria-orientation="horizontal"
          aria-valuemax={Math.max(
            MIN_PROVIDER_USAGE_HEIGHT_PX,
            currentViewportHeight() - MIN_THREAD_REGION_HEIGHT_PX,
          )}
          aria-valuemin={MIN_PROVIDER_USAGE_HEIGHT_PX}
          aria-valuenow={height}
          className="group/resizer relative flex h-2 cursor-row-resize touch-none items-center justify-center"
          data-slot="provider-usage-resizer"
          onKeyDown={handleSeparatorKeyDown}
          onPointerCancel={finishPointerResize}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerResize}
          role="separator"
          tabIndex={0}
        >
          <span className="h-px w-full bg-sidebar-border/70 transition-colors group-hover/resizer:bg-sidebar-ring group-focus-visible/resizer:bg-sidebar-ring" />
        </div>
      ) : null}
    </div>
  );
}

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));
const MIN_STALE_AFTER_MS = 10 * 60_000;

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
    stale: false,
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

function providerUsageName(provider: ServerProvider): string {
  if (provider.displayName) return provider.displayName;
  if (provider.driver === "codex") return "Codex";
  if (provider.driver === "claudeAgent") return "Claude";
  if (provider.driver === "opencode") return "OpenCode";
  return provider.driver;
}

function providerAccountUsageSupport(
  provider: ServerProvider,
): "supported" | "experimental" | "unsupported" {
  const declared = provider.runtimeCapabilities?.accountUsage;
  if (declared) return declared;
  // Legacy snapshots may contain genuine provider usage without the newer
  // capability marker. Data wins over an absent declaration.
  if (provider.accountRateLimits) {
    return provider.driver === "claudeAgent" ? "experimental" : "supported";
  }
  return "unsupported";
}

export function canRefreshProviderUsage(provider: ServerProvider): boolean {
  return (
    providerAccountUsageSupport(provider) !== "unsupported" &&
    provider.availability !== "unavailable" &&
    provider.enabled &&
    provider.installed &&
    provider.auth.status === "authenticated"
  );
}

function baseProviderUsageState(provider: ServerProvider): {
  readonly state: ProviderUsageState;
  readonly message: string | null;
} {
  if (provider.availability === "unavailable") {
    return {
      state: "unavailable",
      message: "This configured provider driver is unavailable in the current build.",
    };
  }
  if (!provider.enabled || provider.status === "disabled") {
    return { state: "disabled", message: "Provider usage polling is disabled with this provider." };
  }
  if (!provider.installed) {
    return {
      state: "unavailable",
      message: "The configured provider runtime is not currently available.",
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return { state: "unauthenticated", message: "Sign in to read provider-reported usage." };
  }
  if (provider.auth.status === "unknown") {
    return {
      state: "auth-unknown",
      message: "Authentication is unknown, so account usage is not being claimed.",
    };
  }
  // A provider event or legacy snapshot can contain genuine usage even when
  // the current runtime cannot poll. Display those dated facts, but keep
  // `canRefreshProviderUsage` capability-gated.
  if (provider.accountRateLimits) {
    return { state: "available", message: null };
  }
  if (providerAccountUsageSupport(provider) === "unsupported") {
    return {
      state: "unsupported",
      message: "This provider does not expose account usage to Club Code.",
    };
  }
  return {
    state: "no-data",
    message: "No provider-reported account usage has been received yet.",
  };
}

function resetCreditsForProvider(provider: ServerProvider): ProviderResetCredits {
  const supported = provider.runtimeCapabilities?.accountRateLimitResets === "supported";
  const reported = provider.accountRateLimits?.rateLimitResetCredits?.availableCount;
  const availableCount =
    typeof reported === "number" && Number.isSafeInteger(reported) && reported >= 0 ? reported : 0;
  return {
    availableCount,
    supported,
    // Never offer redemption on a provider that cannot redeem, and never offer
    // it against a zero balance — the request would only burn a round trip to
    // come back `noCredit`.
    redeemable: supported && availableCount > 0,
  };
}

export function buildProviderUsageRows(
  providers: ReadonlyArray<ServerProvider>,
  options: {
    readonly nowMs?: number;
    readonly pollMinutes?: number;
  } = {},
): ReadonlyArray<ProviderUsageRow> {
  const nowMs = options.nowMs ?? Date.now();
  const staleAfterMs = Math.max(MIN_STALE_AFTER_MS, (options.pollMinutes ?? 2) * 2 * 60_000);

  return providers.map((provider) => {
    const baseState = baseProviderUsageState(provider);
    const accountRateLimits = provider.accountRateLimits;
    if (!accountRateLimits) {
      return {
        instanceId: provider.instanceId,
        name: providerUsageName(provider),
        driver: provider.driver,
        state: baseState.state,
        stateMessage: baseState.message,
        checkedAt: null,
        stale: false,
        windows: [],
        exhaustionNotices: [],
        paidUsage: null,
        paidUsageStale: false,
        resetCredits: resetCreditsForProvider(provider),
      };
    }

    const byLimitId = accountRateLimits.rateLimitsByLimitId;
    const snapshots =
      byLimitId && Object.keys(byLimitId).length > 0
        ? Object.entries(byLimitId)
        : [["default", accountRateLimits.rateLimits] as const];
    const windows: UsageWindowRow[] = [];
    for (const row of snapshots.flatMap(([key, snapshot]) =>
      snapshotWindows(key, snapshot, provider),
    )) {
      const windowCheckedAtMs = Date.parse(row.window.checkedAt ?? accountRateLimits.checkedAt);
      windows.push({
        ...row,
        stale: !Number.isFinite(windowCheckedAtMs) || nowMs - windowCheckedAtMs > staleAfterMs,
      });
    }
    const exhaustionNotices = snapshots.flatMap(([key, snapshot]) =>
      snapshotExhaustionNotices(key, snapshot, provider),
    );
    const paidUsage = accountRateLimits.paidUsage ?? null;
    const hasReportedFacts =
      windows.length > 0 || exhaustionNotices.length > 0 || paidUsage !== null;
    const checkedAtMs = Date.parse(accountRateLimits.checkedAt);
    const stale = !Number.isFinite(checkedAtMs) || nowMs - checkedAtMs > staleAfterMs;
    const paidCheckedAtMs = paidUsage
      ? Date.parse(paidUsage.checkedAt ?? accountRateLimits.checkedAt)
      : Number.NaN;
    const paidUsageStale =
      paidUsage !== null &&
      (!Number.isFinite(paidCheckedAtMs) || nowMs - paidCheckedAtMs > staleAfterMs);
    const state =
      baseState.state === "available" && !hasReportedFacts ? ("no-data" as const) : baseState.state;
    const stateMessage =
      state === "no-data"
        ? "The provider reports no subscription limits for this authentication method."
        : baseState.message;

    return {
      instanceId: provider.instanceId,
      name: providerUsageName(provider),
      driver: provider.driver,
      state,
      stateMessage,
      checkedAt: accountRateLimits.checkedAt,
      stale,
      windows,
      exhaustionNotices,
      paidUsage,
      paidUsageStale,
      resetCredits: resetCreditsForProvider(provider),
    };
  });
}

function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

function formatPaidValue(value: string, currency: string | null | undefined): string {
  return currency ? `${currency} ${value}` : value;
}

function paidUsageLabel(driver: ServerProvider["driver"]): string {
  return driver === "claudeAgent" ? "Extra usage" : "Paid usage";
}

/**
 * Identity for one logical redemption attempt, forwarded upstream as the
 * idempotency key. A retry of the same attempt must reuse it so the backend
 * collapses the retry instead of spending a second credit; every new operator
 * click mints a fresh one.
 */
function newResetAttemptId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `reset-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

const RESET_OUTCOME_TOASTS = {
  reset: {
    type: "success",
    title: "Usage limit reset",
    description: "A reset credit was redeemed and the limit window was reset.",
  },
  nothingToReset: {
    type: "info",
    title: "Nothing to reset",
    description: "No usage limit was in effect, so no credit was spent.",
  },
  noCredit: {
    type: "warning",
    title: "No reset credit available",
    description: "This account holds no redeemable usage limit reset credit.",
  },
  alreadyRedeemed: {
    type: "info",
    title: "Reset credit already redeemed",
    description: "That credit was already spent; no additional credit was used.",
  },
} as const;

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
  // Redemption is irreversible, so the button arms a confirmation first rather
  // than spending a credit on a single stray click in a dense sidebar.
  const [armedResetInstanceId, setArmedResetInstanceId] = useState<
    ServerProvider["instanceId"] | null
  >(null);
  const [redeemingInstanceId, setRedeemingInstanceId] = useState<
    ServerProvider["instanceId"] | null
  >(null);
  const refreshInFlight = useRef(false);
  const currentRefreshableInstanceIds = useMemo(
    () =>
      providers
        .filter(canRefreshProviderUsage)
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
  const rows = useMemo(
    () =>
      buildProviderUsageRows(providers, {
        nowMs,
        pollMinutes: settings.providerUsagePollMinutes,
      }),
    [nowMs, providers, settings.providerUsagePollMinutes],
  );

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
      setNowMs(Date.now());
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

  const redeemResetCredit = useCallback(async (instanceId: ServerProvider["instanceId"]) => {
    setRedeemingInstanceId(instanceId);
    try {
      const connection = getPrimaryEnvironmentConnection();
      // One attempt id per confirmed click. This is deliberately not retried
      // here: a redemption whose result never arrived may still have been
      // applied upstream, and the refreshed balance is the honest answer.
      const result = await connection.client.server.consumeProviderRateLimitResetCredit({
        instanceId,
        attemptId: newResetAttemptId(),
      });
      applyProvidersUpdated({ providers: result.providers });
      setNowMs(Date.now());
      toastManager.add({ ...RESET_OUTCOME_TOASTS[result.outcome] });
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Usage limit reset failed",
        description:
          error instanceof Error ? error.message : "The provider rejected the reset request.",
      });
    } finally {
      setRedeemingInstanceId(null);
      setArmedResetInstanceId(null);
    }
  }, []);

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
    if (!settings.providerUsageWidgetEnabled) {
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
  }, [settings.providerUsageWidgetEnabled]);

  if (!settings.providerUsageWidgetEnabled) {
    return null;
  }

  return (
    <ProviderUsageScrollRegion>
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
          {rows.map((provider) => {
            const paidPercent =
              provider.paidUsage &&
              typeof provider.paidUsage.utilizationPercent === "number" &&
              Number.isFinite(provider.paidUsage.utilizationPercent)
                ? clampPercent(provider.paidUsage.utilizationPercent)
                : null;
            const paidReset = resetLabel(provider.paidUsage?.resetsAt ?? null);
            return (
              <div key={provider.instanceId}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] font-medium text-sidebar-foreground/75">
                    {provider.name}
                  </span>
                  <div className="flex shrink-0 items-center gap-1 text-[9px]">
                    {provider.stale ? (
                      <span
                        className="font-medium text-amber-600 dark:text-amber-400"
                        data-provider-usage-stale
                        role="status"
                      >
                        stale
                      </span>
                    ) : null}
                    {provider.checkedAt ? (
                      <time
                        className="tabular-nums text-sidebar-foreground/40"
                        dateTime={provider.checkedAt}
                        title={`Checked ${new Date(provider.checkedAt).toLocaleString()}`}
                      >
                        checked{" "}
                        {new Date(provider.checkedAt).toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-2">
                  {provider.stateMessage ? (
                    <div
                      className="rounded border border-sidebar-border/60 bg-sidebar-accent/35 px-1.5 py-1 text-[9px] leading-relaxed text-sidebar-foreground/55"
                      data-provider-usage-state={provider.state}
                    >
                      {provider.stateMessage}
                    </div>
                  ) : null}
                  {provider.stale && provider.state === "available" ? (
                    <div className="rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-1 text-[9px] leading-relaxed text-amber-700 dark:text-amber-300">
                      Showing the last provider-reported values; recent refreshes have not produced
                      newer data.
                    </div>
                  ) : null}
                  {provider.state === "available" && provider.paidUsage ? (
                    <div
                      className="rounded border border-primary/25 bg-primary/5 px-1.5 py-1.5 text-[9px] leading-relaxed text-sidebar-foreground/65"
                      data-provider-paid-usage
                      data-provider-paid-usage-stale={provider.paidUsageStale || undefined}
                    >
                      <div className="flex items-center justify-between gap-2 font-medium text-sidebar-foreground/75">
                        <span>{paidUsageLabel(provider.driver)}</span>
                        <span className="capitalize">{provider.paidUsage.status}</span>
                      </div>
                      {provider.paidUsage.balance ? (
                        <div className="mt-0.5 flex justify-between gap-2 tabular-nums">
                          <span>Current balance</span>
                          <span className="truncate font-medium">
                            {formatPaidValue(
                              provider.paidUsage.balance,
                              provider.paidUsage.currency,
                            )}
                          </span>
                        </div>
                      ) : provider.paidUsage.status === "enabled" ? (
                        <div className="mt-0.5 text-sidebar-foreground/45">
                          Current balance is not reported by this provider.
                        </div>
                      ) : null}
                      {provider.paidUsage.used || provider.paidUsage.limit ? (
                        <div className="mt-0.5 flex justify-between gap-2 tabular-nums">
                          <span>Used / limit</span>
                          <span className="truncate font-medium">
                            {provider.paidUsage.used
                              ? formatPaidValue(
                                  provider.paidUsage.used,
                                  provider.paidUsage.currency,
                                )
                              : "unknown"}{" "}
                            /{" "}
                            {provider.paidUsage.limit
                              ? formatPaidValue(
                                  provider.paidUsage.limit,
                                  provider.paidUsage.currency,
                                )
                              : "unknown"}
                          </span>
                        </div>
                      ) : null}
                      {paidPercent !== null ? (
                        <div
                          aria-label={`${provider.name} paid usage`}
                          aria-valuemax={100}
                          aria-valuemin={0}
                          aria-valuenow={paidPercent}
                          className="mt-1 h-1 overflow-hidden rounded-full bg-sidebar-border/70"
                          role="meter"
                        >
                          <div
                            aria-hidden
                            className={cn(
                              "h-full rounded-full",
                              paidPercent >= 90
                                ? "bg-destructive/80"
                                : paidPercent >= 70
                                  ? "bg-amber-500/75"
                                  : "bg-primary/70",
                            )}
                            style={{ width: `${paidPercent}%` }}
                          />
                        </div>
                      ) : null}
                      {typeof provider.paidUsage.remainingPercent === "number" &&
                      Number.isFinite(provider.paidUsage.remainingPercent) ? (
                        <div className="mt-0.5 text-right tabular-nums text-sidebar-foreground/45">
                          {formatPercent(clampPercent(provider.paidUsage.remainingPercent))}{" "}
                          remaining
                        </div>
                      ) : null}
                      {paidReset ? (
                        <div className="text-right tabular-nums text-sidebar-foreground/40">
                          resets {paidReset}
                        </div>
                      ) : null}
                      {provider.paidUsageStale ? (
                        <div
                          className="mt-0.5 font-medium text-amber-700 dark:text-amber-300"
                          role="status"
                        >
                          Paid usage is stale; showing the last provider-reported values.
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {provider.state === "available" ? (
                    <div
                      className="rounded border border-sidebar-border/60 bg-sidebar-accent/35 px-1.5 py-1.5 text-[9px] leading-relaxed text-sidebar-foreground/65"
                      data-provider-reset-credits={provider.resetCredits.availableCount}
                      data-provider-reset-credits-supported={
                        provider.resetCredits.supported || undefined
                      }
                    >
                      <div className="flex items-center justify-between gap-2 tabular-nums">
                        <span className="font-medium text-sidebar-foreground/75">
                          Usage limit resets
                        </span>
                        <span className="font-medium">
                          {provider.resetCredits.availableCount} available
                        </span>
                      </div>
                      {provider.resetCredits.supported ? (
                        provider.resetCredits.redeemable ? (
                          armedResetInstanceId === provider.instanceId ? (
                            <div className="mt-1 flex items-center justify-between gap-2">
                              <span className="min-w-0 text-sidebar-foreground/55">
                                Spend one credit? This cannot be undone.
                              </span>
                              <span className="flex shrink-0 items-center gap-1">
                                <button
                                  className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-medium text-sidebar-foreground/85 hover:bg-primary/20 disabled:opacity-45"
                                  disabled={redeemingInstanceId !== null}
                                  onClick={() => void redeemResetCredit(provider.instanceId)}
                                  type="button"
                                >
                                  {redeemingInstanceId === provider.instanceId
                                    ? "Resetting…"
                                    : "Confirm reset"}
                                </button>
                                <button
                                  className="rounded px-1.5 py-0.5 text-sidebar-foreground/55 hover:bg-sidebar-accent disabled:opacity-45"
                                  disabled={redeemingInstanceId !== null}
                                  onClick={() => setArmedResetInstanceId(null)}
                                  type="button"
                                >
                                  Cancel
                                </button>
                              </span>
                            </div>
                          ) : (
                            <div className="mt-1 flex justify-end">
                              <button
                                className="rounded border border-sidebar-border/70 px-1.5 py-0.5 font-medium text-sidebar-foreground/75 hover:bg-sidebar-accent disabled:opacity-45"
                                disabled={redeemingInstanceId !== null}
                                onClick={() => setArmedResetInstanceId(provider.instanceId)}
                                type="button"
                              >
                                Use a reset credit
                              </button>
                            </div>
                          )
                        ) : (
                          <div className="mt-0.5 text-sidebar-foreground/45">
                            A reset credit appears here when this account is granted one.
                          </div>
                        )
                      ) : (
                        <div className="mt-0.5 text-sidebar-foreground/45">
                          This provider does not grant usage limit reset credits.
                        </div>
                      )}
                    </div>
                  ) : null}
                  {provider.state === "available"
                    ? provider.exhaustionNotices.map((notice) => (
                        <div
                          className="rounded border border-destructive/45 bg-destructive/10 px-1.5 py-1 text-[9px] font-medium leading-relaxed text-destructive"
                          data-provider-usage-exhausted
                          key={notice.key}
                          role="alert"
                        >
                          {notice.label}: {notice.message}
                        </div>
                      ))
                    : null}
                  {provider.state === "available"
                    ? provider.windows.map((window) => {
                        const reset = resetLabel(window.resetsAt);
                        const pacing =
                          settings.modelPacingEnabled && !window.stale
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
                            {window.stale ? (
                              <div
                                className="mt-0.5 text-right font-medium text-amber-700 dark:text-amber-300"
                                role="status"
                              >
                                stale provider value
                              </div>
                            ) : null}
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
                      })
                    : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-[10px] leading-relaxed text-sidebar-foreground/50">
          No provider instances are configured.
        </p>
      )}
      {refreshFailed ? (
        <p className="mt-1.5 text-[9px] text-amber-600 dark:text-amber-400">
          Some usage windows could not refresh.
        </p>
      ) : null}
    </ProviderUsageScrollRegion>
  );
}
