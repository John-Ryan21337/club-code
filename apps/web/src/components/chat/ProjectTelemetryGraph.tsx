import {
  type EnvironmentId,
  type ProjectId,
  type ServerProjectSystemTelemetryResult,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CpuIcon,
  GaugeIcon,
  GripHorizontalIcon,
  HardDriveIcon,
  Maximize2Icon,
  MemoryStickIcon,
  NetworkIcon,
  ThermometerIcon,
} from "lucide-react";
import {
  type CSSProperties,
  type ComponentType,
  Fragment,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { readEnvironmentApi } from "../../environmentApi";
import {
  readCafeDocumentVisibilitySnapshot,
  subscribeCafeDocumentVisibility,
} from "../../documentVisibility";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { matrixColorFrameStore } from "../../matrixColorFrameStore";
import { cn } from "~/lib/utils";
import { Switch } from "../ui/switch";
import {
  clampProjectTelemetryPanelGeometry,
  PROJECT_TELEMETRY_PANEL_DEFAULT_GEOMETRY,
  type ProjectTelemetryPanelBounds,
  type ProjectTelemetryPanelGeometry,
} from "./ProjectTelemetryGraph.geometry";
import {
  appendBoundedTelemetryHistory,
  buildTelemetrySparklinePath,
  deriveProjectTelemetryStrokePalette,
  formatTelemetryBytes,
  normalizeTelemetryRateHistory,
  normalizeTemperatureHistory,
  PROJECT_TELEMETRY_METRIC_KEYS,
  PROJECT_TELEMETRY_HISTORY_LIMIT,
  projectTelemetryGpuAdapter,
  projectTelemetryTemperatureAdapter,
  type ProjectTelemetryGpuAdapter,
  type ProjectTelemetryGpuProjection,
  type ProjectTelemetryHistoryPoint,
  type ProjectTelemetryTemperatureProjection,
  toProjectTelemetryHistoryPoint,
} from "./ProjectTelemetryGraph.model";

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const ERROR_RETRY_INTERVAL_MS = 10_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const NARROW_TELEMETRY_WIDTH_PX = 900;
export const PROJECT_TELEMETRY_PANEL_STORAGE_KEY = "club-code:project-telemetry-panel:v1";
const ProjectTelemetryPanelGeometrySchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
const PROJECT_TELEMETRY_COLOR_VARIABLES = {
  cpu: "--cafe-project-telemetry-cpu",
  memory: "--cafe-project-telemetry-memory",
  disk: "--cafe-project-telemetry-disk",
  network: "--cafe-project-telemetry-network",
  gpu: "--cafe-project-telemetry-gpu",
  vram: "--cafe-project-telemetry-vram",
  tempCpu: "--cafe-project-telemetry-temp-cpu",
  tempGpu: "--cafe-project-telemetry-temp-gpu",
  tempMemory: "--cafe-project-telemetry-temp-memory",
  tempVram: "--cafe-project-telemetry-temp-vram",
  tempStorage: "--cafe-project-telemetry-temp-storage",
  tempAmbient: "--cafe-project-telemetry-temp-ambient",
  tempOther: "--cafe-project-telemetry-temp-other",
} as const;
const PROJECT_TELEMETRY_COLORS = {
  cpu: "var(--cafe-project-telemetry-cpu, #4ade80)",
  memory: "var(--cafe-project-telemetry-memory, #65dc76)",
  disk: "var(--cafe-project-telemetry-disk, #7ccf68)",
  network: "var(--cafe-project-telemetry-network, #4fd9a5)",
  gpu: "var(--cafe-project-telemetry-gpu, #92c85f)",
  vram: "var(--cafe-project-telemetry-vram, #42d9bd)",
  tempCpu: "var(--cafe-project-telemetry-temp-cpu, #4ade80)",
  tempGpu: "var(--cafe-project-telemetry-temp-gpu, #65dc76)",
  tempMemory: "var(--cafe-project-telemetry-temp-memory, #7ccf68)",
  tempVram: "var(--cafe-project-telemetry-temp-vram, #4fd9a5)",
  tempStorage: "var(--cafe-project-telemetry-temp-storage, #92c85f)",
  tempAmbient: "var(--cafe-project-telemetry-temp-ambient, #42d9bd)",
  tempOther: "var(--cafe-project-telemetry-temp-other, #57c7ff)",
} as const;

type ReadProjectTelemetry = (
  environmentId: EnvironmentId,
  projectId: ProjectId,
) => Promise<ServerProjectSystemTelemetryResult>;

interface TelemetryViewState {
  readonly targetKey: string;
  readonly snapshot: ServerProjectSystemTelemetryResult | null;
  readonly gpu: ProjectTelemetryGpuProjection;
  readonly temperatures: ProjectTelemetryTemperatureProjection;
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

interface PointerInteraction {
  readonly kind: "move" | "resize";
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly geometry: ProjectTelemetryPanelGeometry;
}

function emptyViewState(targetKey: string): TelemetryViewState {
  return {
    targetKey,
    snapshot: null,
    gpu: projectTelemetryGpuAdapter({} as ServerProjectSystemTelemetryResult),
    temperatures: projectTelemetryTemperatureAdapter({} as ServerProjectSystemTelemetryResult),
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

function useTelemetryOverlayContainer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<ProjectTelemetryPanelBounds>(() => ({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight,
  }));

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const rect = container.getBoundingClientRect();
      const width = container.clientWidth || rect.width || window.innerWidth;
      const height = container.clientHeight || rect.height || window.innerHeight;
      setBounds((current) =>
        current.width === width && current.height === height ? current : { width, height },
      );
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(container);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return [containerRef, bounds, bounds.width < NARROW_TELEMETRY_WIDTH_PX] as const;
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
    cpuPercent: null,
    memoryPercent: null,
    projectVolumePercent: null,
    networkReceiveBytesPerSecond: null,
    networkTransmitBytesPerSecond: null,
    gpuAdapters: [],
    gpuPercent: null,
    vramPercent: null,
    temperatureCpuCelsius: null,
    temperatureGpuCelsius: null,
    temperatureMemoryCelsius: null,
    temperatureVramCelsius: null,
    temperatureStorageCelsius: null,
    temperatureAmbientCelsius: null,
    temperatureOtherCelsius: null,
  };
}

function formatPercent(value: number | null): string {
  if (value === null) return "Unavailable";
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)}%`;
}

function formatTemperature(value: number | null): string {
  if (value === null) return "Unavailable";
  return `${Number(value.toFixed(1))}\u00b0C`;
}

function exactBytesTitle(label: string, bytes: number | null): string | undefined {
  return bytes === null ? undefined : `${label}: ${bytes.toLocaleString()} bytes`;
}

function gpuAdapterHistory(
  history: readonly ProjectTelemetryHistoryPoint[],
  key: string,
  measurement: "utilizationPercent" | "memoryUtilizationPercent" | "temperatureCelsius",
): readonly (number | null)[] {
  return history.map((point) => {
    const adapter = point.gpuAdapters.find((candidate) => candidate.key === key);
    return adapter?.[measurement] ?? null;
  });
}

function TelemetrySparkline(props: {
  readonly label: string;
  readonly color: string;
  readonly values: readonly (number | null)[];
  readonly measurement?: "utilization" | "temperature";
}) {
  const path = buildTelemetrySparklinePath(props.values);
  const latestIndex = props.values.findLastIndex((value) => value !== null);
  const latest = latestIndex < 0 ? null : (props.values[latestIndex] ?? null);
  const latestX =
    latestIndex < 0 || props.values.length === 1
      ? 0
      : (latestIndex * 100) / (props.values.length - 1);
  const latestY = latest === null ? null : 24 - (Math.max(0, Math.min(100, latest)) / 100) * 24;

  return (
    <svg
      aria-label={`${props.label} ${props.measurement ?? "utilization"} history`}
      className="h-7 w-full overflow-visible"
      data-project-telemetry-series={props.label}
      role="img"
      viewBox="0 0 100 24"
    >
      <title>{`${props.label} bounded recent ${props.measurement ?? "utilization"} history`}</title>
      <path d="M 0 6 H 100 M 0 12 H 100 M 0 18 H 100" opacity="0.12" stroke={props.color} />
      {path ? (
        <path
          d={path}
          fill="none"
          stroke={props.color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
          style={{ filter: `drop-shadow(0 0 2px ${props.color})` }}
        />
      ) : null}
      {latestY !== null ? <circle cx={latestX} cy={latestY} fill={props.color} r="1.8" /> : null}
    </svg>
  );
}

function TelemetryCard(props: {
  readonly icon: ComponentType<{ className?: string }>;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly title?: string | undefined;
  readonly color: string;
  readonly history: readonly (number | null)[];
  readonly historyMeasurement?: "utilization" | "temperature";
  readonly hideGraph?: boolean;
}) {
  const Icon = props.icon;
  return (
    <div
      aria-label={`${props.label}: ${props.value}. ${props.detail}`}
      className="min-w-0 rounded-lg border border-border/60 bg-transparent px-2 py-1.5"
      data-project-telemetry-card={props.label}
      role="group"
      title={props.title ?? props.detail}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="size-3 shrink-0" />
        <span className="truncate text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {props.label}
        </span>
        <span className="ml-auto truncate text-xs font-semibold text-foreground">
          {props.value}
        </span>
      </div>
      {props.hideGraph ? (
        <div aria-hidden="true" className="h-7" data-project-telemetry-graph-hidden="true" />
      ) : (
        <TelemetrySparkline
          color={props.color}
          label={props.label}
          {...(props.historyMeasurement === undefined
            ? {}
            : { measurement: props.historyMeasurement })}
          values={props.history}
        />
      )}
      <div className="truncate text-xs text-muted-foreground">{props.detail}</div>
    </div>
  );
}

export interface ProjectTelemetryGraphProps {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectName?: string;
  readonly className?: string;
  readonly gpuAdapter?: ProjectTelemetryGpuAdapter;
  readonly readTelemetry?: ReadProjectTelemetry;
  readonly pollIntervalMs?: number;
  readonly historyLimit?: number;
  readonly hideUnavailableGraphs?: boolean;
  readonly onHideUnavailableGraphsChange?: (checked: boolean) => void;
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
  const [containerRef, panelBounds, isNarrow] = useTelemetryOverlayContainer();
  const [storedGeometry, setStoredGeometry] = useLocalStorage(
    PROJECT_TELEMETRY_PANEL_STORAGE_KEY,
    PROJECT_TELEMETRY_PANEL_DEFAULT_GEOMETRY,
    ProjectTelemetryPanelGeometrySchema,
  );
  const [liveGeometry, setLiveGeometry] = useState<ProjectTelemetryPanelGeometry | null>(null);
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
  const palettePanelRef = useRef<HTMLElement>(null);
  const restoreToggleFocusRef = useRef(false);
  const interactionRef = useRef<PointerInteraction | null>(null);
  const pendingGeometryRef = useRef<ProjectTelemetryPanelGeometry | null>(null);
  const animationFrameRef = useRef(0);
  const pollingEnabled = documentVisible && !collapsed;
  const renderedGeometry = clampProjectTelemetryPanelGeometry(
    liveGeometry ?? storedGeometry,
    panelBounds,
  );
  const panelStyle: CSSProperties = {
    left: renderedGeometry.x,
    top: renderedGeometry.y,
    width: renderedGeometry.width,
    height: renderedGeometry.height,
  };

  const updateGeometry = useCallback(
    (geometry: ProjectTelemetryPanelGeometry) => {
      setStoredGeometry(clampProjectTelemetryPanelGeometry(geometry, panelBounds));
    },
    [panelBounds, setStoredGeometry],
  );

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (interaction === null || interaction.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      pendingGeometryRef.current = clampProjectTelemetryPanelGeometry(
        interaction.kind === "move"
          ? {
              ...interaction.geometry,
              x: interaction.geometry.x + deltaX,
              y: interaction.geometry.y + deltaY,
            }
          : {
              ...interaction.geometry,
              width: interaction.geometry.width + deltaX,
              height: interaction.geometry.height + deltaY,
            },
        panelBounds,
      );
      if (animationFrameRef.current !== 0) return;
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = 0;
        if (pendingGeometryRef.current !== null) {
          setLiveGeometry(pendingGeometryRef.current);
        }
      });
    };
    const finishCurrentInteraction = () => {
      interactionRef.current = null;
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
      const geometry = pendingGeometryRef.current;
      pendingGeometryRef.current = null;
      if (geometry !== null) updateGeometry(geometry);
      setLiveGeometry(null);
    };
    const finishPointerInteraction = (event: PointerEvent) => {
      if (interactionRef.current?.pointerId === event.pointerId) {
        finishCurrentInteraction();
      }
    };
    const finishOnBlur = () => {
      if (interactionRef.current !== null) finishCurrentInteraction();
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishPointerInteraction);
    window.addEventListener("pointercancel", finishPointerInteraction);
    window.addEventListener("blur", finishOnBlur);
    return () => {
      window.cancelAnimationFrame(animationFrameRef.current);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishPointerInteraction);
      window.removeEventListener("pointercancel", finishPointerInteraction);
      window.removeEventListener("blur", finishOnBlur);
    };
  }, [panelBounds, updateGeometry]);

  const beginInteraction = (
    kind: PointerInteraction["kind"],
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const panel = palettePanelRef.current;
    const container = containerRef.current;
    if (panel === null || container === null) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const panelRect = panel.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const geometry = clampProjectTelemetryPanelGeometry(
      {
        x: panelRect.left - containerRect.left,
        y: panelRect.top - containerRect.top,
        width: panelRect.width,
        height: panelRect.height,
      },
      panelBounds,
    );
    pendingGeometryRef.current = geometry;
    setLiveGeometry(geometry);
    interactionRef.current = {
      kind,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      geometry,
    };
  };

  const adjustGeometryWithKeyboard = (
    kind: PointerInteraction["kind"],
    key: string,
    fineAdjustment: boolean,
  ) => {
    if (!key.startsWith("Arrow")) return false;
    const delta = fineAdjustment ? 1 : 8;
    const horizontal = key === "ArrowLeft" ? -delta : key === "ArrowRight" ? delta : 0;
    const vertical = key === "ArrowUp" ? -delta : key === "ArrowDown" ? delta : 0;
    setStoredGeometry((current) => {
      const geometry = clampProjectTelemetryPanelGeometry(current, panelBounds);
      return clampProjectTelemetryPanelGeometry(
        kind === "move"
          ? {
              ...geometry,
              x: geometry.x + horizontal,
              y: geometry.y + vertical,
            }
          : {
              ...geometry,
              width: geometry.width + horizontal,
              height: geometry.height + vertical,
            },
        panelBounds,
      );
    });
    return true;
  };

  useEffect(() => {
    if (!restoreToggleFocusRef.current) return;
    restoreToggleFocusRef.current = false;
    toggleButtonRef.current?.focus();
  }, [collapsed]);

  useEffect(() => {
    const panel = palettePanelRef.current;
    if (!pollingEnabled || panel === null) return;

    const applyCurrentMatrixPalette = () => {
      const snapshot = matrixColorFrameStore.getSnapshot();
      if (snapshot === null) return;
      const palette = deriveProjectTelemetryStrokePalette(snapshot.frame);
      for (const metric of PROJECT_TELEMETRY_METRIC_KEYS) {
        panel.style.setProperty(PROJECT_TELEMETRY_COLOR_VARIABLES[metric], palette[metric]);
      }
      panel.dataset.matrixPaletteColor = snapshot.frame.color;
      panel.dataset.matrixPaletteMotion = snapshot.motion;
    };

    applyCurrentMatrixPalette();
    return matrixColorFrameStore.subscribe(applyCurrentMatrixPalette);
  }, [pollingEnabled]);

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
          const temperatures = projectTelemetryTemperatureAdapter(telemetry);
          const point = {
            ...toProjectTelemetryHistoryPoint(telemetry, gpu, temperatures),
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
            temperatures,
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
  const networkReceiveBytesPerSecond =
    telemetry?.network.status === "available" ? telemetry.network.receiveBytesPerSecond : null;
  const networkTransmitBytesPerSecond =
    telemetry?.network.status === "available" ? telemetry.network.transmitBytesPerSecond : null;
  const networkRateHistory = visibleView.history.map((point) => {
    if (
      point.networkReceiveBytesPerSecond === null ||
      point.networkTransmitBytesPerSecond === null
    ) {
      return null;
    }
    const total = point.networkReceiveBytesPerSecond + point.networkTransmitBytesPerSecond;
    return Number.isSafeInteger(total) ? total : null;
  });
  const colors = PROJECT_TELEMETRY_COLORS;
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
  const networkDetail =
    telemetry?.network.status === "available"
      ? "Aggregate throughput · no traffic inspection"
      : (telemetry?.network.detail ??
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
  const displayedGpuAdapters = gpuLoading || telemetryUnavailable ? [] : visibleView.gpu.adapters;
  const temperatureCards = [
    {
      key: "cpu",
      label: "CPU temp",
      color: colors.tempCpu,
      metric: visibleView.temperatures.cpu,
      history: visibleView.history.map((point) => point.temperatureCpuCelsius),
    },
    {
      key: "gpu",
      label: "GPU temp",
      color: colors.tempGpu,
      metric: visibleView.temperatures.gpu,
      history: visibleView.history.map((point) => point.temperatureGpuCelsius),
    },
    {
      key: "memory",
      label: "RAM temp",
      color: colors.tempMemory,
      metric: visibleView.temperatures.memory,
      history: visibleView.history.map((point) => point.temperatureMemoryCelsius),
    },
    {
      key: "vram",
      label: "VRAM temp",
      color: colors.tempVram,
      metric: visibleView.temperatures.vram,
      history: visibleView.history.map((point) => point.temperatureVramCelsius),
    },
    {
      key: "storage",
      label: "Disk temp",
      color: colors.tempStorage,
      metric: visibleView.temperatures.storage,
      history: visibleView.history.map((point) => point.temperatureStorageCelsius),
    },
    {
      key: "ambient",
      label: "Case / ambient",
      color: colors.tempAmbient,
      metric: visibleView.temperatures.ambient,
      history: visibleView.history.map((point) => point.temperatureAmbientCelsius),
    },
    {
      key: "other",
      label: "Other temp",
      color: colors.tempOther,
      metric: visibleView.temperatures.other,
      history: visibleView.history.map((point) => point.temperatureOtherCelsius),
    },
  ] as const;
  const lastSample =
    visibleView.snapshot === null
      ? null
      : new Date(DateTime.toEpochMillis(visibleView.snapshot.sampledAt));

  return (
    <div
      className={cn("pointer-events-none absolute inset-0 z-20 overflow-visible", className)}
      data-project-telemetry-positioning="overlay"
      data-project-telemetry-slot="true"
      ref={containerRef}
    >
      {collapsed ? (
        <button
          aria-expanded={false}
          aria-label="Expand Resources"
          className="pointer-events-auto absolute top-2 right-2 flex items-center gap-1.5 rounded-full border border-border/70 bg-transparent px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
          data-project-telemetry-collapsed="true"
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
          className="pointer-events-auto absolute flex min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-transparent p-2 text-foreground"
          data-matrix-palette-active={pollingEnabled}
          data-project-id={projectId}
          data-project-telemetry-panel="true"
          ref={palettePanelRef}
          style={panelStyle}
        >
          <div className="mb-1.5 flex min-w-0 items-center gap-2 px-0.5">
            <GaugeIcon className="size-3.5 shrink-0 text-cyan-500 dark:text-cyan-300" />
            <div className="mr-auto min-w-0">
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
              aria-label="Move project resource graphs"
              className="cursor-move touch-none rounded-md bg-transparent p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              onKeyDown={(event) => {
                if (adjustGeometryWithKeyboard("move", event.key, event.shiftKey)) {
                  event.preventDefault();
                }
              }}
              onPointerDown={(event) => beginInteraction("move", event)}
              title="Drag to move. Arrow keys move by 8 pixels; Shift+Arrow moves by 1."
              type="button"
            >
              <GripHorizontalIcon className="size-3.5" />
            </button>
            <button
              aria-controls={panelId}
              aria-expanded={true}
              aria-label="Collapse project resource graphs"
              className="rounded-md bg-transparent p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
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
          <label
            className="mb-1.5 flex items-center gap-2 px-0.5 text-xs text-muted-foreground"
            title="Keep unavailable readings and diagnostics visible without drawing an empty history graph."
          >
            <Switch
              aria-label="Hide unavailable resource graphs"
              checked={hideUnavailableGraphs}
              disabled={onHideUnavailableGraphsChange === undefined}
              onCheckedChange={(checked) => onHideUnavailableGraphsChange?.(Boolean(checked))}
            />
            Hide unavailable graphs
          </label>
          <div className="min-h-0 flex-1 overflow-auto pb-2" id={panelId}>
            <div className="grid grid-cols-2 gap-1.5">
              <TelemetryCard
                color={colors.cpu}
                detail={cpuDetail}
                hideGraph={hideUnavailableGraphs && cpuPercent === null}
                history={visibleView.history.map((point) => point.cpuPercent)}
                icon={CpuIcon}
                label="Host CPU"
                value={telemetry?.cpu.status === "warming" ? "Warming" : formatPercent(cpuPercent)}
              />
              <TelemetryCard
                color={colors.memory}
                detail={memoryDetail}
                hideGraph={hideUnavailableGraphs && memoryPercent === null}
                history={visibleView.history.map((point) => point.memoryPercent)}
                icon={MemoryStickIcon}
                label="Host RAM"
                title={exactBytesTitle(
                  "Available memory on selected environment",
                  telemetry?.memory.status === "available" ? telemetry.memory.availableBytes : null,
                )}
                value={formatPercent(memoryPercent)}
              />
              <TelemetryCard
                color={colors.disk}
                detail={diskDetail}
                hideGraph={hideUnavailableGraphs && diskPercent === null}
                history={visibleView.history.map((point) => point.projectVolumePercent)}
                icon={HardDriveIcon}
                label="Project disk"
                title={exactBytesTitle(
                  "Free space on selected project volume",
                  telemetry?.projectVolume.status === "available"
                    ? telemetry.projectVolume.availableBytes
                    : null,
                )}
                value={formatPercent(diskPercent)}
              />
              <TelemetryCard
                color={colors.network}
                detail={networkDetail}
                hideGraph={
                  hideUnavailableGraphs &&
                  (networkReceiveBytesPerSecond === null || networkTransmitBytesPerSecond === null)
                }
                history={normalizeTelemetryRateHistory(networkRateHistory)}
                icon={NetworkIcon}
                label="Host network"
                title="Aggregate receive/transmit rates only; no interfaces, addresses, endpoints, or packet contents leave the backend."
                value={
                  telemetry?.network.status === "warming"
                    ? "Warming"
                    : networkReceiveBytesPerSecond === null ||
                        networkTransmitBytesPerSecond === null
                      ? "Unavailable"
                      : `↓ ${formatTelemetryBytes(networkReceiveBytesPerSecond)}/s · ↑ ${formatTelemetryBytes(networkTransmitBytesPerSecond)}/s`
                }
              />
              {displayedGpuAdapters.length === 0 ? (
                <>
                  <TelemetryCard
                    color={colors.gpu}
                    detail={gpuDetail}
                    hideGraph={hideUnavailableGraphs && visibleView.gpu.gpuPercent === null}
                    history={visibleView.history.map((point) => point.gpuPercent)}
                    icon={GaugeIcon}
                    label="Host GPU"
                    value={
                      gpuLoading
                        ? "Waiting"
                        : formatPercent(telemetryUnavailable ? null : visibleView.gpu.gpuPercent)
                    }
                  />
                  <TelemetryCard
                    color={colors.vram}
                    detail={vramDetail}
                    hideGraph={hideUnavailableGraphs && visibleView.gpu.vramPercent === null}
                    history={visibleView.history.map((point) => point.vramPercent)}
                    icon={MemoryStickIcon}
                    label="Host VRAM"
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
                </>
              ) : (
                displayedGpuAdapters.map((adapter) => {
                  const memory =
                    adapter.memoryUsedBytes !== null &&
                    adapter.memoryTotalBytes !== null &&
                    adapter.memoryAvailableBytes !== null &&
                    adapter.memoryUtilizationPercent !== null
                      ? {
                          usedBytes: adapter.memoryUsedBytes,
                          totalBytes: adapter.memoryTotalBytes,
                          availableBytes: adapter.memoryAvailableBytes,
                          utilizationPercent: adapter.memoryUtilizationPercent,
                        }
                      : null;
                  const temperatureDetail =
                    adapter.temperatureCelsius === null
                      ? "temperature unavailable"
                      : formatTemperature(adapter.temperatureCelsius);
                  return (
                    <Fragment key={adapter.key}>
                      <TelemetryCard
                        color={colors.gpu}
                        detail={`${adapter.name} · ${temperatureDetail} · selected environment`}
                        history={gpuAdapterHistory(
                          visibleView.history,
                          adapter.key,
                          "utilizationPercent",
                        )}
                        icon={GaugeIcon}
                        label={adapter.label}
                        title={`${adapter.name} · ${
                          adapter.temperatureCelsius === null
                            ? "adapter temperature unavailable"
                            : `measured adapter temperature ${formatTemperature(adapter.temperatureCelsius)}`
                        }`}
                        value={formatPercent(adapter.utilizationPercent)}
                      />
                      <TelemetryCard
                        color={colors.vram}
                        detail={
                          memory === null
                            ? "GPU memory telemetry unavailable · selected environment"
                            : `${formatTelemetryBytes(memory.availableBytes)} free · ${formatPercent(memory.utilizationPercent)} used · selected environment`
                        }
                        hideGraph={hideUnavailableGraphs && memory === null}
                        history={gpuAdapterHistory(
                          visibleView.history,
                          adapter.key,
                          "memoryUtilizationPercent",
                        )}
                        icon={MemoryStickIcon}
                        label={`${adapter.label} VRAM`}
                        title={
                          memory === null
                            ? "GPU memory telemetry unavailable"
                            : `${adapter.label} GPU memory: ${memory.usedBytes.toLocaleString()} bytes used, ${memory.totalBytes.toLocaleString()} bytes total, ${memory.availableBytes.toLocaleString()} bytes free`
                        }
                        value={
                          memory === null
                            ? "Unavailable"
                            : `${formatTelemetryBytes(memory.usedBytes)} / ${formatTelemetryBytes(memory.totalBytes)}`
                        }
                      />
                    </Fragment>
                  );
                })
              )}
              <div className="col-span-2 mt-1 flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                <ThermometerIcon className="size-3" />
                Hardware temperatures
              </div>
              {temperatureCards.map((card) => (
                <TelemetryCard
                  color={card.color}
                  detail={
                    gpuLoading
                      ? "Waiting"
                      : telemetryUnavailable
                        ? "Telemetry unavailable"
                        : `${card.metric.detail} · selected environment`
                  }
                  hideGraph={hideUnavailableGraphs && card.metric.celsius === null}
                  history={normalizeTemperatureHistory(card.history)}
                  historyMeasurement="temperature"
                  icon={ThermometerIcon}
                  key={card.key}
                  label={card.label}
                  title="Measured host sensor temperature only; unavailable values are never estimated."
                  value={
                    gpuLoading
                      ? "Waiting"
                      : formatTemperature(telemetryUnavailable ? null : card.metric.celsius)
                  }
                />
              ))}
            </div>
          </div>
          <button
            aria-label="Resize project resource graphs"
            className="absolute right-0 bottom-0 cursor-nwse-resize touch-none rounded-tl bg-transparent p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
            onKeyDown={(event) => {
              if (adjustGeometryWithKeyboard("resize", event.key, event.shiftKey)) {
                event.preventDefault();
              }
            }}
            onPointerDown={(event) => beginInteraction("resize", event)}
            title="Drag to resize. Arrow keys resize by 8 pixels; Shift+Arrow resizes by 1."
            type="button"
          >
            <Maximize2Icon className="size-3" />
          </button>
        </aside>
      )}
    </div>
  );
}
