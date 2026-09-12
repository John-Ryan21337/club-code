import {
  type EnvironmentId,
  type ProjectId,
  type ServerProjectSystemTelemetryResult,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CpuIcon,
  GaugeIcon,
  GripHorizontalIcon,
  ScalingIcon,
  RotateCcwIcon,
  HardDriveIcon,
  MemoryStickIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";

import { readEnvironmentApi } from "../../environmentApi";
import {
  readCafeDocumentVisibilitySnapshot,
  subscribeCafeDocumentVisibility,
} from "../../documentVisibility";
import { useTelemetryPanelLayout } from "./useTelemetryPanelLayout";
import { Switch } from "~/components/ui/switch";
import { cn } from "~/lib/utils";
import { TelemetryCard } from "./ProjectTelemetryCard";
import { ProjectGpuAdapterHistory } from "./ProjectGpuAdapterHistory";
import { ProjectTemperatureHistory } from "./ProjectTemperatureHistory";
import { emptyTemperatureCategoryValues } from "./ProjectTemperatureHistory.model";
import { ProjectTemperatureReadings } from "./ProjectTemperatureReadings";
import {
  appendBoundedTelemetryHistory,
  formatTelemetryBytes,
  PROJECT_TELEMETRY_HISTORY_LIMIT,
  projectTelemetryGpuAdapter,
  type ProjectTelemetryGpuAdapter,
  type ProjectTelemetryGpuProjection,
  type ProjectTelemetryHistoryPoint,
  toProjectTelemetryHistoryPoint,
} from "./ProjectTelemetryGraph.model";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const ERROR_RETRY_INTERVAL_MS = 10_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type ReadProjectTelemetry = (
  environmentId: EnvironmentId,
  projectId: ProjectId,
) => Promise<ServerProjectSystemTelemetryResult>;

interface TelemetryViewState {
  readonly targetKey: string;
  readonly snapshot: ServerProjectSystemTelemetryResult | null;
  readonly gpu: ProjectTelemetryGpuProjection;
  readonly history: readonly ProjectTelemetryHistoryPoint[];
  readonly status: "loading" | "ready" | "unavailable";
}

interface PollRequest {
  readonly token: number;
  readonly targetKey: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly readTelemetry: ReadProjectTelemetry;
  readonly gpuAdapter: ProjectTelemetryGpuAdapter;
  readonly pollIntervalMs: number;
  readonly historyLimit: number;
}

interface PollRunner {
  token: number;
  desired: PollRequest | null;
  inFlight: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  failureReported: boolean;
}

function emptyViewState(targetKey: string): TelemetryViewState {
  return {
    targetKey,
    snapshot: null,
    gpu: projectTelemetryGpuAdapter({} as ServerProjectSystemTelemetryResult),
    history: [],
    status: "loading",
  };
}

async function readSelectedProjectTelemetry(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): Promise<ServerProjectSystemTelemetryResult> {
  const api = readEnvironmentApi(environmentId);
  if (!api) {
    throw Object.assign(new Error(), { name: "ProjectTelemetryEnvironmentUnavailable" });
  }
  return api.systemTelemetry.readProject({ projectId });
}

function useDocumentVisible(): boolean {
  return (
    useSyncExternalStore(
      subscribeCafeDocumentVisibility,
      readCafeDocumentVisibilitySnapshot,
      () => "hidden",
    ) === "visible"
  );
}

const safeTelemetryErrorTag = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value) ? value : null;

function telemetryErrorDiscriminator(error: unknown): string {
  if (error instanceof Error) return safeTelemetryErrorTag(error.name) ?? "Error";
  if (!error || typeof error !== "object") return typeof error;
  const record = error as Record<string, unknown>;
  for (const key of ["_tag", "name", "kind", "code"]) {
    let value: unknown;
    try {
      value = record[key];
    } catch {
      continue;
    }
    const tag = safeTelemetryErrorTag(value);
    if (tag) return tag;
  }
  return "NonErrorObject";
}

function telemetryGapPoint(): ProjectTelemetryHistoryPoint {
  return {
    sampledAtMs: Date.now(),
    gpuAdapters: [],
    temperatures: emptyTemperatureCategoryValues(),
    cpuPercent: null,
    memoryPercent: null,
    projectVolumePercent: null,
    gpuPercent: null,
    vramPercent: null,
  };
}

function formatPercent(value: number | null): string {
  if (value === null) return "Unavailable";
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)}%`;
}

function exactBytesTitle(label: string, bytes: number | null): string | undefined {
  return bytes === null ? undefined : `${label}: ${bytes.toLocaleString()} bytes`;
}

export interface ProjectTelemetryGraphProps {
  readonly hideUnavailableGraphs?: boolean;
  readonly onHideUnavailableGraphsChange?: (checked: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectName?: string;
  readonly className?: string;
  readonly gpuAdapter?: ProjectTelemetryGpuAdapter;
  readonly readTelemetry?: ReadProjectTelemetry;
  readonly pollIntervalMs?: number;
  readonly historyLimit?: number;
}

export function ProjectTelemetryGraph({
  environmentId,
  projectId,
  projectName,
  className,
  gpuAdapter = projectTelemetryGpuAdapter,
  readTelemetry = readSelectedProjectTelemetry,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  historyLimit = PROJECT_TELEMETRY_HISTORY_LIMIT,
  hideUnavailableGraphs = false,
  onHideUnavailableGraphsChange,
}: ProjectTelemetryGraphProps) {
  const layout = useTelemetryPanelLayout();
  const { containerRef, isNarrow } = layout;
  const documentVisible = useDocumentVisible();
  const panelId = useId();
  const [manuallyCollapsed, setManuallyCollapsed] = useState(false);
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  const collapsed = manuallyCollapsed || (isNarrow && !narrowExpanded);
  const targetKey = `${environmentId}\u0000${projectId}`;
  const [view, setView] = useState<TelemetryViewState>(() => emptyViewState(targetKey));
  const visibleView = view.targetKey === targetKey ? view : emptyViewState(targetKey);
  const runnerRef = useRef<PollRunner>({
    token: 0,
    desired: null,
    inFlight: null,
    timer: null,
    failureReported: false,
  });
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const restoreToggleFocusRef = useRef(false);
  const pollingEnabled = documentVisible && !collapsed;

  useEffect(() => {
    if (!restoreToggleFocusRef.current) return;
    restoreToggleFocusRef.current = false;
    toggleButtonRef.current?.focus();
  }, [collapsed]);

  useEffect(() => {
    const runner = runnerRef.current;
    runner.token += 1;
    const token = runner.token;
    if (runner.timer !== null) {
      clearTimeout(runner.timer);
      runner.timer = null;
    }

    if (!pollingEnabled) {
      runner.desired = null;
      setView((current) =>
        current.targetKey === targetKey && current.history.length > 0
          ? {
              ...current,
              history: appendBoundedTelemetryHistory(
                current.history,
                telemetryGapPoint(),
                historyLimit,
              ),
            }
          : current,
      );
      return;
    }

    const request: PollRequest = {
      token,
      targetKey,
      environmentId,
      projectId,
      readTelemetry,
      gpuAdapter,
      pollIntervalMs: Number.isFinite(pollIntervalMs)
        ? Math.min(MAX_TIMER_DELAY_MS, Math.max(250, pollIntervalMs))
        : DEFAULT_POLL_INTERVAL_MS,
      historyLimit,
    };
    runner.desired = request;
    runner.failureReported = false;
    setView((current) => (current.targetKey === targetKey ? current : emptyViewState(targetKey)));

    const launch = () => {
      const currentRunner = runnerRef.current;
      const desired = currentRunner.desired;
      if (currentRunner.inFlight !== null || desired === null) return;

      const activeRequest = desired;
      let nextDelay = activeRequest.pollIntervalMs;
      currentRunner.inFlight = Promise.resolve()
        .then(() =>
          activeRequest.readTelemetry(activeRequest.environmentId, activeRequest.projectId),
        )
        .then((telemetry) => {
          if (runnerRef.current.desired?.token !== activeRequest.token) return;
          if (telemetry.projectId !== activeRequest.projectId) {
            throw Object.assign(new Error(), { name: "ProjectTelemetryProjectMismatch" });
          }
          const gpu = activeRequest.gpuAdapter(telemetry);
          const point = {
            ...toProjectTelemetryHistoryPoint(telemetry, gpu),
            sampledAtMs: Date.now(),
          };
          runnerRef.current.failureReported = false;
          nextDelay = Math.min(
            MAX_TIMER_DELAY_MS,
            Math.max(activeRequest.pollIntervalMs, telemetry.minimumSampleIntervalMs),
          );
          setView((current) => ({
            targetKey: activeRequest.targetKey,
            snapshot: telemetry,
            gpu,
            history: appendBoundedTelemetryHistory(
              current.history,
              point,
              activeRequest.historyLimit,
            ),
            status: "ready",
          }));
        })
        .catch((error: unknown) => {
          if (runnerRef.current.desired?.token !== activeRequest.token) return;
          if (!runnerRef.current.failureReported) {
            console.error("[PROJECT_TELEMETRY] read failed", telemetryErrorDiscriminator(error));
            runnerRef.current.failureReported = true;
          }
          nextDelay = Math.min(
            MAX_TIMER_DELAY_MS,
            Math.max(activeRequest.pollIntervalMs, ERROR_RETRY_INTERVAL_MS),
          );
          setView((current) => ({
            ...(current.targetKey === activeRequest.targetKey
              ? current
              : emptyViewState(activeRequest.targetKey)),
            history: appendBoundedTelemetryHistory(
              current.targetKey === activeRequest.targetKey ? current.history : [],
              telemetryGapPoint(),
              activeRequest.historyLimit,
            ),
            status: "unavailable",
          }));
        })
        .finally(() => {
          const latestRunner = runnerRef.current;
          latestRunner.inFlight = null;
          const latestRequest = latestRunner.desired;
          if (latestRequest === null) return;
          if (latestRequest.token !== activeRequest.token) {
            queueMicrotask(launch);
            return;
          }
          latestRunner.timer = setTimeout(
            () => {
              latestRunner.timer = null;
              launch();
            },
            Math.min(MAX_TIMER_DELAY_MS, nextDelay),
          );
        });
    };

    // React StrictMode performs setup-cleanup-setup synchronously. Deferring
    // the first read lets the discarded setup retire before any RPC launches.
    queueMicrotask(launch);

    return () => {
      const latestRunner = runner;
      if (latestRunner.desired?.token === token) {
        latestRunner.desired = null;
      }
      if (latestRunner.timer !== null) {
        clearTimeout(latestRunner.timer);
        latestRunner.timer = null;
      }
    };
  }, [
    environmentId,
    gpuAdapter,
    historyLimit,
    pollIntervalMs,
    pollingEnabled,
    projectId,
    readTelemetry,
    targetKey,
  ]);

  const toggleCollapsed = () => {
    restoreToggleFocusRef.current = true;
    if (isNarrow) {
      setManuallyCollapsed(false);
      setNarrowExpanded(collapsed);
      return;
    }
    setManuallyCollapsed((current) => !current);
  };

  const telemetry = visibleView.status === "ready" ? visibleView.snapshot : null;
  const cpuPercent =
    telemetry?.cpu.status === "available" ? telemetry.cpu.utilizationPercent : null;
  const memoryPercent =
    telemetry?.memory.status === "available" ? telemetry.memory.utilizationPercent : null;
  const diskPercent =
    telemetry?.projectVolume.status === "available"
      ? telemetry.projectVolume.utilizationPercent
      : null;
  const colors = {
    cpu: "var(--cafe-project-telemetry-cpu, #0891b2)",
    memory: "var(--cafe-project-telemetry-memory, #db2777)",
    disk: "var(--cafe-project-telemetry-disk, #4d7c0f)",
    gpu: "var(--cafe-project-telemetry-gpu, #d97706)",
    vram: "var(--cafe-project-telemetry-vram, #7c3aed)",
  };
  const cpuDetail =
    telemetry?.cpu.status === "available"
      ? `${telemetry.cpu.logicalProcessorCount} logical CPUs · selected environment`
      : (telemetry?.cpu.detail ??
        (visibleView.status === "unavailable" ? "Telemetry unavailable" : "Waiting"));
  const memoryDetail =
    telemetry?.memory.status === "available"
      ? `${formatTelemetryBytes(telemetry.memory.availableBytes)} available · selected environment`
      : (telemetry?.memory.detail ??
        (visibleView.status === "unavailable" ? "Telemetry unavailable" : "Waiting"));
  const diskDetail =
    telemetry?.projectVolume.status === "available"
      ? `${formatTelemetryBytes(telemetry.projectVolume.availableBytes)} free · selected project volume`
      : (telemetry?.projectVolume.detail ??
        (visibleView.status === "unavailable" ? "Telemetry unavailable" : "Waiting"));
  const gpuLoading = visibleView.status === "loading";
  const telemetryUnavailable = visibleView.status === "unavailable";
  const gpuDetail = gpuLoading
    ? "Waiting"
    : telemetryUnavailable
      ? "Telemetry unavailable"
      : `${visibleView.gpu.gpuDetail} · selected environment`;
  const vramDetail = gpuLoading
    ? "Waiting"
    : telemetryUnavailable
      ? "Telemetry unavailable"
      : visibleView.gpu.vramAvailableBytes === null
        ? `${visibleView.gpu.vramDetail} · selected environment`
        : `${formatTelemetryBytes(visibleView.gpu.vramAvailableBytes)} available · selected environment`;
  const lastSample =
    visibleView.snapshot === null
      ? null
      : new Date(DateTime.toEpochMillis(visibleView.snapshot.sampledAt));

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-20 flex items-start justify-end p-2",
        className,
      )}
      data-project-telemetry-slot="true"
      ref={containerRef}
    >
      {collapsed ? (
        <button
          aria-expanded={false}
          aria-label="Expand Resources"
          className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/70 bg-card/95 px-2.5 py-1 text-xs text-muted-foreground shadow-lg shadow-cyan-500/10 backdrop-blur-md hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          onClick={toggleCollapsed}
          ref={toggleButtonRef}
          type="button"
        >
          <GaugeIcon className="size-3 text-cyan-500 dark:text-cyan-300" />
          Resources
          <ChevronDownIcon className="size-3" />
        </button>
      ) : (
        <aside
          aria-label="Selected project system telemetry"
          className="pointer-events-auto absolute flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card/95 p-2 text-foreground shadow-2xl shadow-black/20 backdrop-blur-xl"
          style={{
            left: layout.geometry.x,
            top: layout.geometry.y,
            width: layout.geometry.width,
            height: layout.geometry.height,
          }}
          data-project-id={projectId}
        >
          <div className="mb-1.5 flex shrink-0 min-w-0 items-center gap-2 px-0.5">
            <GaugeIcon className="size-3.5 shrink-0 text-cyan-500 dark:text-cyan-300" />
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold uppercase tracking-[0.1em]">
                Project resources
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {projectName ?? "Selected project"}
                {lastSample
                  ? ` · ${telemetryUnavailable ? "last successful " : ""}${lastSample.toLocaleString()}`
                  : ""}
              </div>
            </div>
            <button
              type="button"
              aria-label="Move project resource graphs"
              className="ml-auto min-h-9 min-w-9 cursor-move touch-none rounded-md text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
              title="Drag to move. Arrow keys move 8 pixels; Shift+Arrow moves 1 pixel."
              onPointerDown={(event) => layout.begin("move", event)}
              onLostPointerCapture={layout.finish}
              onKeyDown={(event) => {
                if (layout.adjustWithKeyboard("move", event.key, event.shiftKey))
                  event.preventDefault();
              }}
            >
              <GripHorizontalIcon className="mx-auto size-4" />
            </button>
            <button
              type="button"
              aria-label="Reset resource graph position and size"
              className="min-h-9 min-w-9 rounded-md text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={layout.reset}
            >
              <RotateCcwIcon className="mx-auto size-4" />
            </button>
            <button
              aria-controls={panelId}
              aria-expanded={true}
              aria-label="Collapse project resource graphs"
              className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              onClick={toggleCollapsed}
              ref={toggleButtonRef}
              title="Collapse resource graphs and stop polling"
              type="button"
            >
              <ChevronUpIcon className="size-3.5" />
            </button>
          </div>
          <div className="mb-1.5 truncate px-0.5 text-xs text-muted-foreground">
            Host metrics: selected environment · disk: selected project volume
          </div>
          <label className="mb-2 flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <Switch
              aria-label="Hide unavailable resource graphs"
              checked={hideUnavailableGraphs}
              disabled={!onHideUnavailableGraphsChange}
              onCheckedChange={(checked) => onHideUnavailableGraphsChange?.(checked)}
            />
            Hide unavailable graphs
          </label>
          <div className="min-h-0 flex-1 overflow-auto" id={panelId}>
            <div className="grid grid-cols-2 gap-1.5">
              <TelemetryCard
                color={colors.cpu}
                detail={cpuDetail}
                history={visibleView.history.map((point) => point.cpuPercent)}
                icon={CpuIcon}
                label="Host CPU"
                hidden={hideUnavailableGraphs && cpuPercent === null}
                value={telemetry?.cpu.status === "warming" ? "Warming" : formatPercent(cpuPercent)}
              />
              <TelemetryCard
                color={colors.memory}
                detail={memoryDetail}
                history={visibleView.history.map((point) => point.memoryPercent)}
                icon={MemoryStickIcon}
                label="Host RAM"
                hidden={hideUnavailableGraphs && memoryPercent === null}
                title={exactBytesTitle(
                  "Available memory on selected environment",
                  telemetry?.memory.status === "available" ? telemetry.memory.availableBytes : null,
                )}
                value={formatPercent(memoryPercent)}
              />
              <TelemetryCard
                color={colors.disk}
                detail={diskDetail}
                history={visibleView.history.map((point) => point.projectVolumePercent)}
                icon={HardDriveIcon}
                label="Project disk"
                hidden={hideUnavailableGraphs && diskPercent === null}
                title={exactBytesTitle(
                  "Free space on selected project volume",
                  telemetry?.projectVolume.status === "available"
                    ? telemetry.projectVolume.availableBytes
                    : null,
                )}
                value={formatPercent(diskPercent)}
              />
              <TelemetryCard
                color={colors.gpu}
                detail={gpuDetail}
                history={visibleView.history.map((point) => point.gpuPercent)}
                icon={GaugeIcon}
                label="Host GPU"
                hidden={
                  hideUnavailableGraphs &&
                  (telemetryUnavailable || visibleView.gpu.gpuPercent === null)
                }
                value={
                  gpuLoading
                    ? "Waiting"
                    : formatPercent(telemetryUnavailable ? null : visibleView.gpu.gpuPercent)
                }
              />
              <TelemetryCard
                color={colors.vram}
                detail={vramDetail}
                history={visibleView.history.map((point) => point.vramPercent)}
                icon={MemoryStickIcon}
                label="Host VRAM"
                hidden={
                  hideUnavailableGraphs &&
                  (telemetryUnavailable || visibleView.gpu.vramPercent === null)
                }
                title={exactBytesTitle(
                  "Available GPU memory on selected environment",
                  telemetryUnavailable ? null : visibleView.gpu.vramAvailableBytes,
                )}
                value={
                  gpuLoading
                    ? "Waiting"
                    : formatPercent(telemetryUnavailable ? null : visibleView.gpu.vramPercent)
                }
              />
            </div>
            <ProjectGpuAdapterHistory
              hideUnavailable={hideUnavailableGraphs}
              telemetry={telemetryUnavailable ? undefined : telemetry?.gpu}
              history={visibleView.history}
            />
            <ProjectTemperatureHistory
              hideUnavailable={hideUnavailableGraphs}
              telemetry={telemetryUnavailable ? undefined : telemetry?.temperatures}
              history={visibleView.history}
            />
            <ProjectTemperatureReadings
              telemetry={telemetryUnavailable ? undefined : telemetry?.temperatures}
            />
          </div>
          <button
            type="button"
            aria-label="Resize project resource graphs"
            className="ml-auto min-h-9 min-w-9 shrink-0 cursor-se-resize touch-none rounded-md text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            title="Drag to resize. Arrow keys resize 8 pixels; Shift+Arrow resizes 1 pixel."
            onPointerDown={(event) => layout.begin("resize", event)}
            onLostPointerCapture={layout.finish}
            onKeyDown={(event) => {
              if (layout.adjustWithKeyboard("resize", event.key, event.shiftKey))
                event.preventDefault();
            }}
          >
            <ScalingIcon className="mx-auto size-4" />
          </button>
        </aside>
      )}
    </div>
  );
}
