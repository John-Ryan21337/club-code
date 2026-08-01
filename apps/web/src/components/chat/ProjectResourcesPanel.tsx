import {
  appendProjectResourcesHistory,
  PROJECT_RESOURCES_HISTORY_LIMIT,
  projectResourcesGapPoint,
  projectResourcesHistoryPoint,
  projectResourcesTelemetryFrame,
  type ProjectResourcesMetric,
  type ProjectResourcesTelemetryClient,
  type ProjectResourcesTelemetryFrame,
  type ProjectResourcesTelemetryHistoryPoint,
} from "@cafecode/client-runtime";
import type { ProjectId } from "@cafecode/contracts";
import { CpuIcon, GaugeIcon, MemoryStickIcon } from "lucide-react";
import { type ComponentType, useEffect, useId, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { Switch } from "../ui/switch.tsx";
import {
  buildProjectResourceSparklinePath,
  formatProjectResourcePercent,
  projectResourceMetricHistory,
  shouldRenderProjectResourceCard,
} from "./ProjectResourcesPanel.model.ts";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_AFTER_MS = 15_000;
const ERROR_RETRY_INTERVAL_MS = 10_000;
const MINIMUM_TIMER_MS = 250;
const MAXIMUM_TIMER_MS = 2_147_483_647;

interface ProjectResourcesView {
  readonly targetKey: string;
  readonly frame: ProjectResourcesTelemetryFrame | null;
  readonly history: readonly ProjectResourcesTelemetryHistoryPoint[];
  readonly state: "loading" | "ready" | "unavailable";
}

interface PollRequest {
  readonly token: number;
  readonly targetKey: string;
  readonly projectId: ProjectId;
  readonly client: ProjectResourcesTelemetryClient;
  readonly historyLimit: number;
  readonly pollIntervalMs: number;
  readonly requestTimeoutMs: number;
  readonly staleAfterMs: number;
}

interface PollRunner {
  token: number;
  desired: PollRequest | null;
  inFlight: Promise<void> | null;
  activeAbort: AbortController | null;
  activeToken: number | null;
  timer: ReturnType<typeof setTimeout> | null;
  staleTimer: ReturnType<typeof setTimeout> | null;
  failureReported: boolean;
}

const unavailableMetric = (detail: string): ProjectResourcesMetric => ({
  status: "unavailable",
  utilizationPercent: null,
  detail,
});

function emptyView(targetKey: string): ProjectResourcesView {
  return { targetKey, frame: null, history: [], state: "loading" };
}

function boundedTimer(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(MAXIMUM_TIMER_MS, Math.max(MINIMUM_TIMER_MS, Math.trunc(value)));
}

function boundedDelay(...values: readonly number[]): number {
  const finiteValues = values.filter(Number.isFinite);
  const value = finiteValues.length === 0 ? MINIMUM_TIMER_MS : Math.max(...finiteValues);
  return Math.min(MAXIMUM_TIMER_MS, Math.max(MINIMUM_TIMER_MS, Math.trunc(value)));
}

const safeFailureCode = (error: unknown): string => {
  const value = error instanceof Error ? error.name : typeof error;
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value) ? value : "TelemetryReadFailure";
};

function ProjectResourceSparkline(props: {
  readonly label: string;
  readonly color: string;
  readonly values: readonly (number | null)[];
}) {
  const path = buildProjectResourceSparklinePath(props.values);
  return (
    <svg
      aria-label={`${props.label} utilization history`}
      className="h-8 w-full overflow-visible"
      data-project-resource-graph={props.label.toLowerCase()}
      role="img"
      viewBox="0 0 100 24"
    >
      <title>{`${props.label} bounded recent utilization history`}</title>
      <path d="M 0 6 H 100 M 0 12 H 100 M 0 18 H 100" stroke="currentColor" opacity="0.09" />
      {path ? (
        <path
          d={path}
          fill="none"
          stroke={props.color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      ) : null}
    </svg>
  );
}

function ProjectResourceCard(props: {
  readonly icon: ComponentType<{ className?: string }>;
  readonly metricKey: "cpu" | "memory";
  readonly label: string;
  readonly metric: ProjectResourcesMetric;
  readonly detail: string;
  readonly history: readonly (number | null)[];
  readonly color: string;
}) {
  const Icon = props.icon;
  const value = formatProjectResourcePercent(props.metric);
  return (
    <section
      aria-label={`${props.label}: ${value}. ${props.detail}`}
      className="min-w-0 rounded-lg border border-border/60 bg-background/50 p-2"
      data-project-resource-card={props.metricKey}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0" />
        <span className="text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {props.label}
        </span>
        <span className="ml-auto text-xs font-semibold">{value}</span>
      </div>
      {props.metric.status === "available" ? (
        <ProjectResourceSparkline
          color={props.color}
          label={props.metricKey}
          values={props.history}
        />
      ) : null}
      <div className="mt-1 truncate text-xs text-muted-foreground" title={props.detail}>
        {props.detail}
      </div>
    </section>
  );
}

export interface ProjectResourcesPanelProps {
  readonly projectId: ProjectId;
  readonly projectName?: string;
  readonly client: ProjectResourcesTelemetryClient;
  readonly className?: string;
  readonly pollingEnabled?: boolean;
  readonly pollIntervalMs?: number;
  readonly requestTimeoutMs?: number;
  readonly staleAfterMs?: number;
  readonly historyLimit?: number;
  readonly hideUnavailableGraphs?: boolean;
  readonly onHideUnavailableGraphsChange?: (checked: boolean) => void;
  readonly onReadFailure?: (safeCode: string) => void;
  readonly now?: () => number;
}

export function ProjectResourcesPanel({
  projectId,
  projectName,
  client,
  className,
  pollingEnabled = true,
  pollIntervalMs,
  requestTimeoutMs,
  staleAfterMs,
  historyLimit = PROJECT_RESOURCES_HISTORY_LIMIT,
  hideUnavailableGraphs: controlledHideUnavailableGraphs,
  onHideUnavailableGraphsChange,
  onReadFailure,
  now = Date.now,
}: ProjectResourcesPanelProps) {
  const panelId = useId();
  const targetKey = String(projectId);
  const [internalHideUnavailableGraphs, setInternalHideUnavailableGraphs] = useState(false);
  const hideUnavailableGraphs = controlledHideUnavailableGraphs ?? internalHideUnavailableGraphs;
  const [view, setView] = useState<ProjectResourcesView>(() => emptyView(targetKey));
  const visibleView = view.targetKey === targetKey ? view : emptyView(targetKey);
  const runnerRef = useRef<PollRunner>({
    token: 0,
    desired: null,
    inFlight: null,
    activeAbort: null,
    activeToken: null,
    timer: null,
    staleTimer: null,
    failureReported: false,
  });

  useEffect(() => {
    const runner = runnerRef.current;
    runner.token += 1;
    const token = runner.token;
    if (runner.timer !== null) clearTimeout(runner.timer);
    if (runner.staleTimer !== null) clearTimeout(runner.staleTimer);
    runner.timer = null;
    runner.staleTimer = null;

    if (!pollingEnabled) {
      runner.desired = null;
      runner.activeAbort?.abort();
      setView((current) => ({
        targetKey,
        frame: null,
        history:
          current.targetKey === targetKey && current.frame !== null
            ? appendProjectResourcesHistory(
                current.history,
                projectResourcesGapPoint(now()),
                historyLimit,
              )
            : current.targetKey === targetKey
              ? current.history
              : [],
        state: "unavailable",
      }));
      return;
    }

    const request: PollRequest = {
      token,
      targetKey,
      projectId,
      client,
      historyLimit,
      pollIntervalMs: boundedTimer(pollIntervalMs, DEFAULT_POLL_INTERVAL_MS),
      requestTimeoutMs: boundedTimer(requestTimeoutMs, DEFAULT_REQUEST_TIMEOUT_MS),
      staleAfterMs: boundedTimer(staleAfterMs, DEFAULT_STALE_AFTER_MS),
    };
    runner.desired = request;
    runner.failureReported = false;
    if (runner.activeToken !== null && runner.activeToken !== token) runner.activeAbort?.abort();
    setView((current) => ({
      targetKey,
      frame: null,
      history: current.targetKey === targetKey ? current.history : [],
      state: "loading",
    }));

    const launch = () => {
      const currentRunner = runnerRef.current;
      const activeRequest = currentRunner.desired;
      if (activeRequest === null || currentRunner.inFlight !== null) return;

      const abort = new AbortController();
      currentRunner.activeAbort = abort;
      currentRunner.activeToken = activeRequest.token;
      let nextDelay = activeRequest.pollIntervalMs;
      let outageRecorded = false;
      const recordUnavailable = () => {
        if (outageRecorded || runnerRef.current.desired?.token !== activeRequest.token) return;
        outageRecorded = true;
        if (runnerRef.current.staleTimer !== null) {
          clearTimeout(runnerRef.current.staleTimer);
          runnerRef.current.staleTimer = null;
        }
        setView((current) => ({
          targetKey: activeRequest.targetKey,
          frame: null,
          history: appendProjectResourcesHistory(
            current.targetKey === activeRequest.targetKey ? current.history : [],
            projectResourcesGapPoint(now()),
            activeRequest.historyLimit,
          ),
          state: "unavailable",
        }));
      };
      const requestTimeout = setTimeout(() => {
        abort.abort();
        recordUnavailable();
      }, activeRequest.requestTimeoutMs);

      currentRunner.inFlight = Promise.resolve()
        .then(() =>
          activeRequest.client.readProjectResources({
            projectId: activeRequest.projectId,
            signal: abort.signal,
          }),
        )
        .then((telemetry) => {
          if (abort.signal.aborted || runnerRef.current.desired?.token !== activeRequest.token)
            return;
          if (telemetry.projectId !== activeRequest.projectId) {
            throw Object.assign(new Error(), { name: "ProjectResourcesProjectMismatch" });
          }
          const frame = projectResourcesTelemetryFrame(telemetry);
          runnerRef.current.failureReported = false;
          nextDelay = boundedDelay(activeRequest.pollIntervalMs, frame.minimumSampleIntervalMs);
          setView((current) => ({
            targetKey: activeRequest.targetKey,
            frame,
            history: appendProjectResourcesHistory(
              current.targetKey === activeRequest.targetKey ? current.history : [],
              projectResourcesHistoryPoint(frame),
              activeRequest.historyLimit,
            ),
            state: "ready",
          }));
          if (runnerRef.current.staleTimer !== null) clearTimeout(runnerRef.current.staleTimer);
          runnerRef.current.staleTimer = setTimeout(
            recordUnavailable,
            boundedDelay(activeRequest.staleAfterMs, nextDelay * 3),
          );
        })
        .catch((error: unknown) => {
          if (runnerRef.current.desired?.token !== activeRequest.token) return;
          recordUnavailable();
          nextDelay = boundedDelay(activeRequest.pollIntervalMs, ERROR_RETRY_INTERVAL_MS);
          if (!runnerRef.current.failureReported) {
            runnerRef.current.failureReported = true;
            onReadFailure?.(safeFailureCode(error));
          }
        })
        .finally(() => {
          clearTimeout(requestTimeout);
          const latestRunner = runnerRef.current;
          if (latestRunner.activeToken === activeRequest.token) {
            latestRunner.activeAbort = null;
            latestRunner.activeToken = null;
          }
          latestRunner.inFlight = null;
          const desired = latestRunner.desired;
          if (desired === null) return;
          if (desired.token !== activeRequest.token) {
            queueMicrotask(launch);
            return;
          }
          latestRunner.timer = setTimeout(
            () => {
              latestRunner.timer = null;
              launch();
            },
            Math.min(MAXIMUM_TIMER_MS, nextDelay),
          );
        });
    };

    // StrictMode setup/cleanup happens synchronously. Deferring admission
    // prevents the discarded setup from opening a duplicate client read.
    queueMicrotask(launch);
    return () => {
      if (runner.desired?.token === token) runner.desired = null;
      if (runner.timer !== null) clearTimeout(runner.timer);
      if (runner.staleTimer !== null) clearTimeout(runner.staleTimer);
      runner.timer = null;
      runner.staleTimer = null;
      if (runner.activeToken === token) runner.activeAbort?.abort();
    };
  }, [
    client,
    historyLimit,
    now,
    onReadFailure,
    pollIntervalMs,
    pollingEnabled,
    projectId,
    requestTimeoutMs,
    staleAfterMs,
    targetKey,
  ]);

  const cpu =
    visibleView.frame?.cpu ??
    unavailableMetric(
      visibleView.state === "loading" ? "Waiting for telemetry." : "Telemetry unavailable.",
    );
  const memory =
    visibleView.frame?.memory ??
    unavailableMetric(
      visibleView.state === "loading" ? "Waiting for telemetry." : "Telemetry unavailable.",
    );
  const cpuDetail =
    cpu.status === "available"
      ? "Measured host CPU utilization."
      : (cpu.detail ?? "CPU telemetry unavailable.");
  const memoryDetail =
    memory.status === "available"
      ? "Measured host memory utilization."
      : (memory.detail ?? "Memory telemetry unavailable.");
  const setHideUnavailableGraphs = (checked: boolean) => {
    if (controlledHideUnavailableGraphs === undefined) {
      setInternalHideUnavailableGraphs(checked);
    }
    onHideUnavailableGraphsChange?.(checked);
  };

  return (
    <aside
      aria-label="Project resources"
      className={cn(
        "w-full max-w-md rounded-xl border border-border/70 bg-card/95 p-3 text-foreground shadow-lg",
        className,
      )}
      data-project-id={projectId}
    >
      <div className="flex items-start gap-2">
        <GaugeIcon className="mt-0.5 size-4 shrink-0 text-cyan-500" />
        <div className="min-w-0">
          <h2 className="truncate text-xs font-semibold uppercase tracking-[0.1em]">
            Project resources
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {projectName ?? "Selected project"} · host measurements
          </p>
        </div>
        <label
          className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"
          htmlFor={panelId}
        >
          Hide unavailable graphs
          <Switch
            aria-label="Hide unavailable resource graphs"
            checked={hideUnavailableGraphs}
            id={panelId}
            onCheckedChange={(checked) => setHideUnavailableGraphs(Boolean(checked))}
          />
        </label>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {shouldRenderProjectResourceCard(cpu, hideUnavailableGraphs) ? (
          <ProjectResourceCard
            color="var(--cafe-project-telemetry-cpu, #0891b2)"
            detail={cpuDetail}
            history={projectResourceMetricHistory(visibleView.history, "cpu")}
            icon={CpuIcon}
            label="Host CPU"
            metric={cpu}
            metricKey="cpu"
          />
        ) : null}
        {shouldRenderProjectResourceCard(memory, hideUnavailableGraphs) ? (
          <ProjectResourceCard
            color="var(--cafe-project-telemetry-memory, #db2777)"
            detail={memoryDetail}
            history={projectResourceMetricHistory(visibleView.history, "memory")}
            icon={MemoryStickIcon}
            label="Host RAM"
            metric={memory}
            metricKey="memory"
          />
        ) : null}
      </div>
    </aside>
  );
}
