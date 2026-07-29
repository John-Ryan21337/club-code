import type { ServerProjectSystemTelemetryResult } from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";

import type { MatrixColorFrame } from "../../windowAtmosphere";

export const PROJECT_TELEMETRY_HISTORY_LIMIT = 48;

export const PROJECT_TELEMETRY_METRIC_KEYS = [
  "cpu",
  "memory",
  "disk",
  "network",
  "gpu",
  "vram",
  "tempCpu",
  "tempGpu",
  "tempMemory",
  "tempVram",
  "tempStorage",
  "tempAmbient",
  "tempOther",
] as const;
export type ProjectTelemetryMetricKey = (typeof PROJECT_TELEMETRY_METRIC_KEYS)[number];
export type ProjectTelemetryStrokePalette = Readonly<Record<ProjectTelemetryMetricKey, string>>;

export interface ProjectTelemetryHistoryPoint {
  readonly sampledAtMs: number;
  readonly cpuPercent: number | null;
  readonly memoryPercent: number | null;
  readonly projectVolumePercent: number | null;
  readonly networkReceiveBytesPerSecond: number | null;
  readonly networkTransmitBytesPerSecond: number | null;
  readonly gpuPercent: number | null;
  readonly vramPercent: number | null;
  readonly temperatureCpuCelsius: number | null;
  readonly temperatureGpuCelsius: number | null;
  readonly temperatureMemoryCelsius: number | null;
  readonly temperatureVramCelsius: number | null;
  readonly temperatureStorageCelsius: number | null;
  readonly temperatureAmbientCelsius: number | null;
  readonly temperatureOtherCelsius: number | null;
}

export interface ProjectTelemetryGpuProjection {
  readonly gpuPercent: number | null;
  readonly gpuDetail: string;
  readonly vramPercent: number | null;
  readonly vramUsedBytes: number | null;
  readonly vramAvailableBytes: number | null;
  readonly vramDetail: string;
}

export type ProjectTelemetryGpuAdapter = (
  telemetry: ServerProjectSystemTelemetryResult,
) => ProjectTelemetryGpuProjection;

export const PROJECT_TELEMETRY_TEMPERATURE_KINDS = [
  "cpu",
  "gpu",
  "memory",
  "vram",
  "storage",
  "ambient",
  "other",
] as const;
export type ProjectTelemetryTemperatureKind = (typeof PROJECT_TELEMETRY_TEMPERATURE_KINDS)[number];
export interface ProjectTelemetryTemperatureMetric {
  readonly celsius: number | null;
  readonly detail: string;
}
export type ProjectTelemetryTemperatureProjection = Readonly<
  Record<ProjectTelemetryTemperatureKind, ProjectTelemetryTemperatureMetric>
>;

interface HslColor {
  readonly hue: number;
  readonly saturation: number;
  readonly lightness: number;
}

const UNIFORM_METRIC_HUE_OFFSETS = [
  0, -18, 18, -34, 34, 50, -50, 68, -68, 86, -86, 104, -104,
] as const;
const PER_STREAM_METRIC_HUE_OFFSETS = [
  0, 28, 56, 84, 112, 140, 168, 196, 224, 252, 280, 308, 336,
] as const;
const METRIC_LIGHTNESS_OFFSETS = [0, 5, -5, 9, -9, 14, -14, 3, -3, 7, -7, 11, -11] as const;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

function rgbToHsl(red: number, green: number, blue: number): HslColor {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;
  if (delta > 0) {
    if (maximum === r) hue = 60 * (((g - b) / delta) % 6);
    else if (maximum === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return {
    hue: wrapHue(hue),
    saturation: saturation * 100,
    lightness: lightness * 100,
  };
}

function parseFrameColor(frame: MatrixColorFrame): HslColor {
  if (
    frame.baseHue !== null &&
    frame.saturation !== null &&
    frame.lightness !== null &&
    Number.isFinite(frame.baseHue) &&
    Number.isFinite(frame.saturation) &&
    Number.isFinite(frame.lightness)
  ) {
    return {
      hue: wrapHue(frame.baseHue),
      saturation: clamp(frame.saturation, 0, 100),
      lightness: clamp(frame.lightness, 0, 100),
    };
  }

  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(frame.color);
  if (hex) {
    return rgbToHsl(
      Number.parseInt(hex[1]!, 16),
      Number.parseInt(hex[2]!, 16),
      Number.parseInt(hex[3]!, 16),
    );
  }

  const hsl = /^hsl\(\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*\)$/i.exec(
    frame.color,
  );
  if (hsl) {
    return {
      hue: wrapHue(Number(hsl[1])),
      saturation: clamp(Number(hsl[2]), 0, 100),
      lightness: clamp(Number(hsl[3]), 0, 100),
    };
  }

  // Matrix frames are produced as six-digit hex or modern HSL. This bounded
  // fallback keeps the monitor readable if a future renderer adds a new CSS
  // color representation before this projection learns to parse it.
  return { hue: 140, saturation: 70, lightness: 50 };
}

/**
 * Derive six distinguishable monitor strokes from the current Matrix frame.
 * Uniform modes stay close to the selected Matrix hue; Extra modes mirror the
 * falling streams' full deterministic phase distribution.
 */
export function deriveProjectTelemetryStrokePalette(
  frame: MatrixColorFrame,
): ProjectTelemetryStrokePalette {
  const base = parseFrameColor(frame);
  const hueOffsets = frame.perStream ? PER_STREAM_METRIC_HUE_OFFSETS : UNIFORM_METRIC_HUE_OFFSETS;
  return Object.fromEntries(
    PROJECT_TELEMETRY_METRIC_KEYS.map((key, index) => [
      key,
      `hsl(${wrapHue(base.hue + hueOffsets[index]!).toFixed(1)} ${clamp(
        Math.max(52, base.saturation),
        0,
        96,
      ).toFixed(1)}% ${clamp(base.lightness + METRIC_LIGHTNESS_OFFSETS[index]!, 24, 78).toFixed(
        1,
      )}%)`,
    ]),
  ) as ProjectTelemetryStrokePalette;
}

const unavailableGpuProjection = (): ProjectTelemetryGpuProjection => ({
  gpuPercent: null,
  gpuDetail: "GPU utilization is unavailable from this backend.",
  vramPercent: null,
  vramUsedBytes: null,
  vramAvailableBytes: null,
  vramDetail: "GPU memory telemetry is unavailable from this backend.",
});

function finitePercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function finiteNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readDetail(record: Record<string, unknown>, fallback: string): string {
  return typeof record.detail === "string" && record.detail.trim().length > 0
    ? record.detail
    : fallback;
}

/**
 * Reduce the bounded GPU contract into the panel's host-wide peak utilization
 * and combined VRAM view. The defensive object checks keep this boundary
 * fail-closed for stale remote clients or malformed injected test transports.
 */
export const projectTelemetryGpuAdapter: ProjectTelemetryGpuAdapter = (telemetry) => {
  const gpu = (telemetry as unknown as { readonly gpu?: unknown }).gpu;
  if (!gpu || typeof gpu !== "object") {
    return unavailableGpuProjection();
  }

  const gpuRecord = gpu as Record<string, unknown>;
  const detail = readDetail(gpuRecord, "GPU telemetry is unavailable.");
  const unavailable = { ...unavailableGpuProjection(), gpuDetail: detail, vramDetail: detail };
  const adapters = gpuRecord.adapters;
  if (
    gpuRecord.status !== "available" ||
    !Array.isArray(adapters) ||
    adapters.length === 0 ||
    adapters.length > 64
  ) {
    return unavailable;
  }

  let gpuPercent = 0;
  let vramUsedBytes = 0;
  let vramTotalBytes = 0;
  let vramAvailable = true;
  for (const adapter of adapters) {
    if (!adapter || typeof adapter !== "object") return unavailable;
    const record = adapter as Record<string, unknown>;
    const utilization = finitePercent(record.utilizationPercent);
    if (utilization === null) return unavailable;
    gpuPercent = Math.max(gpuPercent, utilization);
    const memoryPercent = finitePercent(record.memoryUtilizationPercent);
    const memoryTotal = finiteNonNegativeInteger(record.memoryTotalBytes);
    const memoryUsed = finiteNonNegativeInteger(record.memoryUsedBytes);
    if (
      memoryPercent === null ||
      memoryTotal === null ||
      memoryTotal === 0 ||
      memoryUsed === null ||
      memoryUsed > memoryTotal
    ) {
      vramAvailable = false;
      continue;
    }
    vramUsedBytes += memoryUsed;
    vramTotalBytes += memoryTotal;
  }
  const adapterLabel = `${adapters.length} GPU adapter${adapters.length === 1 ? "" : "s"}`;
  const gpuProjection = { ...unavailable, gpuPercent, gpuDetail: `Peak across ${adapterLabel}` };
  if (
    !vramAvailable ||
    !Number.isSafeInteger(vramUsedBytes) ||
    !Number.isSafeInteger(vramTotalBytes)
  ) {
    return gpuProjection;
  }

  return {
    ...gpuProjection,
    vramPercent: (vramUsedBytes / vramTotalBytes) * 100,
    vramUsedBytes,
    vramAvailableBytes: vramTotalBytes - vramUsedBytes,
    vramDetail: `Combined ${adapterLabel} memory`,
  };
};

const unavailableTemperatureProjection = (
  detail = "Hardware temperature telemetry is unavailable from this backend.",
): ProjectTelemetryTemperatureProjection =>
  Object.fromEntries(
    PROJECT_TELEMETRY_TEMPERATURE_KINDS.map((kind) => [kind, { celsius: null, detail }]),
  ) as unknown as ProjectTelemetryTemperatureProjection;

/**
 * Publish the hottest measured sensor in each class while retaining a count in
 * the detail. Missing classes stay null; utilization is never used to infer a
 * temperature.
 */
export function projectTelemetryTemperatureAdapter(
  telemetry: ServerProjectSystemTelemetryResult,
): ProjectTelemetryTemperatureProjection {
  const temperatures = (telemetry as unknown as { readonly temperatures?: unknown }).temperatures;
  if (!temperatures || typeof temperatures !== "object") return unavailableTemperatureProjection();
  const record = temperatures as Record<string, unknown>;
  const detail = readDetail(record, "Hardware temperature telemetry is unavailable.");
  if (
    record.version !== 1 ||
    record.status !== "available" ||
    !Array.isArray(record.sensors) ||
    record.sensors.length === 0 ||
    record.sensors.length > 64
  ) {
    return unavailableTemperatureProjection(detail);
  }

  const grouped = new Map<ProjectTelemetryTemperatureKind, number[]>();
  for (const sensor of record.sensors) {
    if (!sensor || typeof sensor !== "object") return unavailableTemperatureProjection(detail);
    const sensorRecord = sensor as Record<string, unknown>;
    const kind = sensorRecord.kind;
    const celsius = sensorRecord.temperatureCelsius;
    if (
      typeof kind !== "string" ||
      !PROJECT_TELEMETRY_TEMPERATURE_KINDS.includes(kind as ProjectTelemetryTemperatureKind) ||
      typeof celsius !== "number" ||
      !Number.isFinite(celsius) ||
      celsius < -100 ||
      celsius > 250
    ) {
      return unavailableTemperatureProjection(detail);
    }
    const typedKind = kind as ProjectTelemetryTemperatureKind;
    grouped.set(typedKind, [...(grouped.get(typedKind) ?? []), celsius]);
  }

  return Object.fromEntries(
    PROJECT_TELEMETRY_TEMPERATURE_KINDS.map((kind) => {
      const values = grouped.get(kind) ?? [];
      return [
        kind,
        values.length === 0
          ? {
              celsius: null,
              detail: `No supported ${kind} temperature sensor reported.`,
            }
          : {
              celsius: Math.max(...values),
              detail: `Hottest of ${values.length} measured ${kind} sensor${values.length === 1 ? "" : "s"}.`,
            },
      ];
    }),
  ) as unknown as ProjectTelemetryTemperatureProjection;
}

export function toProjectTelemetryHistoryPoint(
  telemetry: ServerProjectSystemTelemetryResult,
  gpu: ProjectTelemetryGpuProjection,
  temperatures = projectTelemetryTemperatureAdapter(telemetry),
): ProjectTelemetryHistoryPoint {
  return {
    sampledAtMs: DateTime.toEpochMillis(telemetry.sampledAt),
    cpuPercent: telemetry.cpu.status === "available" ? telemetry.cpu.utilizationPercent : null,
    memoryPercent:
      telemetry.memory.status === "available" ? telemetry.memory.utilizationPercent : null,
    projectVolumePercent:
      telemetry.projectVolume.status === "available"
        ? telemetry.projectVolume.utilizationPercent
        : null,
    networkReceiveBytesPerSecond:
      telemetry.network.status === "available" ? telemetry.network.receiveBytesPerSecond : null,
    networkTransmitBytesPerSecond:
      telemetry.network.status === "available" ? telemetry.network.transmitBytesPerSecond : null,
    gpuPercent: gpu.gpuPercent,
    vramPercent: gpu.vramPercent,
    temperatureCpuCelsius: temperatures.cpu.celsius,
    temperatureGpuCelsius: temperatures.gpu.celsius,
    temperatureMemoryCelsius: temperatures.memory.celsius,
    temperatureVramCelsius: temperatures.vram.celsius,
    temperatureStorageCelsius: temperatures.storage.celsius,
    temperatureAmbientCelsius: temperatures.ambient.celsius,
    temperatureOtherCelsius: temperatures.other.celsius,
  };
}

export function appendBoundedTelemetryHistory(
  history: readonly ProjectTelemetryHistoryPoint[],
  point: ProjectTelemetryHistoryPoint,
  limit = PROJECT_TELEMETRY_HISTORY_LIMIT,
): readonly ProjectTelemetryHistoryPoint[] {
  const boundedLimit =
    limit === Number.POSITIVE_INFINITY
      ? 120
      : Number.isFinite(limit)
        ? Math.max(1, Math.min(120, Math.trunc(limit)))
        : 1;
  return [...history.slice(Math.max(0, history.length - boundedLimit + 1)), point];
}

export function buildTelemetrySparklinePath(
  values: readonly (number | null)[],
  width = 100,
  height = 24,
): string {
  if (values.length === 0) return "";
  const xStep = values.length === 1 ? 0 : width / (values.length - 1);
  let path = "";
  let drawing = false;

  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      drawing = false;
      return;
    }
    const x = index * xStep;
    const y = height - (Math.max(0, Math.min(100, value)) / 100) * height;
    const point = `${x.toFixed(2)} ${y.toFixed(2)}`;
    path += drawing ? ` L ${point}` : `M ${point} L ${point}`;
    drawing = true;
  });

  return path.trim();
}

/** Normalize a bounded throughput history against its own recent peak. */
export function normalizeTelemetryRateHistory(
  values: readonly (number | null)[],
): readonly (number | null)[] {
  const peak = values.reduce<number>(
    (maximum, value) =>
      value !== null && Number.isSafeInteger(value) && value >= 0
        ? Math.max(maximum, value)
        : maximum,
    0,
  );
  if (peak <= 0) {
    return values.map((value) =>
      value !== null && Number.isSafeInteger(value) && value >= 0 ? 0 : null,
    );
  }
  return values.map((value) =>
    value !== null && Number.isSafeInteger(value) && value >= 0 ? (value / peak) * 100 : null,
  );
}

/** Map real Celsius values onto sparkline coordinates without changing labels. */
export function normalizeTemperatureHistory(
  values: readonly (number | null)[],
): readonly (number | null)[] {
  const minimum = -20;
  const maximum = 120;
  return values.map((value) =>
    value !== null && Number.isFinite(value) && value >= -100 && value <= 250
      ? ((Math.min(maximum, Math.max(minimum, value)) - minimum) / (maximum - minimum)) * 100
      : null,
  );
}

export function formatTelemetryBytes(bytes: number | null): string {
  if (bytes === null || !Number.isSafeInteger(bytes) || bytes < 0) return "Unavailable";
  if (bytes === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const exponent = Math.max(0, Math.min(Math.floor(Math.log2(bytes) / 10), units.length - 1));
  const scaled = bytes / 1024 ** exponent;
  const digits = scaled >= 100 || exponent === 0 ? 0 : scaled >= 10 ? 1 : 2;
  return `${Number(scaled.toFixed(digits))} ${units[exponent]}`;
}
