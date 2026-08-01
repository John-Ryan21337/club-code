import type {
  ProjectResourcesMetric,
  ProjectResourcesTelemetryHistoryPoint,
} from "@cafecode/client-runtime";

export function shouldRenderProjectResourceCard(
  metric: ProjectResourcesMetric,
  hideUnavailableGraphs: boolean,
): boolean {
  return !hideUnavailableGraphs || isAvailableProjectResourceMetric(metric);
}

export function isAvailableProjectResourceMetric(metric: ProjectResourcesMetric): boolean {
  return (
    metric.status === "available" &&
    metric.utilizationPercent !== null &&
    Number.isFinite(metric.utilizationPercent) &&
    metric.utilizationPercent >= 0 &&
    metric.utilizationPercent <= 100
  );
}

export function formatProjectResourcePercent(metric: ProjectResourcesMetric): string {
  if (metric.status === "warming") return "Warming";
  if (!isAvailableProjectResourceMetric(metric)) return "Unavailable";
  const value = metric.utilizationPercent!;
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, "") : Math.round(value)}%`;
}

export function projectResourceMetricHistory(
  history: readonly ProjectResourcesTelemetryHistoryPoint[],
  metric: "cpu" | "memory",
): readonly (number | null)[] {
  return history.map((point) => (metric === "cpu" ? point.cpuPercent : point.memoryPercent));
}

export function buildProjectResourceSparklinePath(
  values: readonly (number | null)[],
  width = 100,
  height = 24,
): string {
  if (
    values.length === 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    return "";
  const xStep = values.length === 1 ? 0 : width / (values.length - 1);
  let path = "";
  let drawing = false;

  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value) || value < 0 || value > 100) {
      drawing = false;
      return;
    }
    const x = index * xStep;
    const y = height - (value / 100) * height;
    const point = `${x.toFixed(2)} ${y.toFixed(2)}`;
    path += drawing ? ` L ${point}` : `M ${point} L ${point}`;
    drawing = true;
  });

  return path.trim();
}
