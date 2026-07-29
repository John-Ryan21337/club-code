import {
  MAX_HARDWARE_TEMPERATURE_CELSIUS,
  MAX_TEMPERATURE_SENSOR_LABEL_LENGTH,
  MAX_TEMPERATURE_SENSORS,
  MIN_HARDWARE_TEMPERATURE_CELSIUS,
  type ServerSystemGpuTelemetry,
  type ServerSystemTemperatureSensor,
  type ServerSystemTemperatureSensorKind,
  type ServerSystemTemperatureSource,
  type ServerSystemTemperatureTelemetry,
  type ServerSystemTemperatureUnavailableReason,
} from "@cafecode/contracts";

const TEMPERATURE_DETAIL: Readonly<Record<ServerSystemTemperatureUnavailableReason, string>> = {
  unsupported: "No supported hardware temperature source is available on this system.",
  "probe-failed": "The hardware temperature probe did not complete.",
  malformed: "The hardware temperature source reported unusable values.",
  stale: "The previous hardware temperature sample is no longer current.",
};

const UNSAFE_LABEL_CODE_POINTS = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]+/gu;

export interface RawTemperatureSample {
  readonly name?: unknown;
  readonly identifier?: unknown;
  readonly value?: unknown;
  readonly source?: unknown;
}

export function unavailableTemperatureTelemetry(
  reason: ServerSystemTemperatureUnavailableReason,
): ServerSystemTemperatureTelemetry {
  return {
    version: 1,
    status: "unavailable",
    sensors: [],
    reason,
    detail: TEMPERATURE_DETAIL[reason],
  };
}

export function sanitizeTemperatureSensorLabel(raw: unknown, fallback: string): string {
  const normalized =
    typeof raw === "string"
      ? raw.normalize("NFKC").replace(UNSAFE_LABEL_CODE_POINTS, " ").replace(/\s+/gu, " ").trim()
      : "";
  const candidate = normalized.length > 0 ? normalized : fallback;
  let bounded = candidate.slice(0, MAX_TEMPERATURE_SENSOR_LABEL_LENGTH).trim();
  if (/[\uD800-\uDBFF]$/u.test(bounded)) bounded = bounded.slice(0, -1);
  return bounded.length > 0 ? bounded : "Hardware temperature";
}

function temperatureKind(name: string, identifier: string): ServerSystemTemperatureSensorKind {
  const text = `${identifier} ${name}`.toLowerCase();
  if (/\b(vram|gpu memory|memory junction|hot spot memory)\b/u.test(text)) return "vram";
  if (/\/gpu|\\gpu|\bgpu\b|\bgraphics\b/u.test(text)) return "gpu";
  if (/\/cpu|\\cpu|\bcpu\b|\bpackage\b|\bcore\b|\btctl\b|\btdie\b/u.test(text)) return "cpu";
  if (/\b(ram|dimm|dram|memory)\b/u.test(text)) return "memory";
  if (/\/hdd|\/nvme|\/storage|\b(ssd|hdd|nvme|drive|disk)\b/u.test(text)) return "storage";
  if (/\b(ambient|case|system|mainboard|motherboard|pch)\b/u.test(text)) return "ambient";
  return "other";
}

function temperatureSource(value: unknown): ServerSystemTemperatureSource | null {
  switch (value) {
    case "libre-hardware-monitor":
    case "open-hardware-monitor":
    case "linux-hwmon":
      return value;
    default:
      return null;
  }
}

function measuredCelsius(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) &&
    number >= MIN_HARDWARE_TEMPERATURE_CELSIUS &&
    number <= MAX_HARDWARE_TEMPERATURE_CELSIUS
    ? number
    : null;
}

function deduplicateSensors(
  sensors: ReadonlyArray<ServerSystemTemperatureSensor>,
): ServerSystemTemperatureSensor[] {
  const result: ServerSystemTemperatureSensor[] = [];
  const keys = new Set<string>();
  for (const sensor of sensors) {
    const baseKey = `${sensor.source}\u0000${sensor.kind}\u0000${sensor.label}`;
    let label = sensor.label;
    let key = baseKey;
    let occurrence = 1;
    while (keys.has(key)) {
      occurrence += 1;
      label = sanitizeTemperatureSensorLabel(
        `${sensor.label.slice(0, Math.max(1, MAX_TEMPERATURE_SENSOR_LABEL_LENGTH - 8))} (${occurrence})`,
        `${sensor.kind.toUpperCase()} temperature ${occurrence}`,
      );
      key = `${sensor.source}\u0000${sensor.kind}\u0000${label}`;
    }
    keys.add(key);
    result.push(label === sensor.label ? sensor : { ...sensor, label });
    if (result.length === MAX_TEMPERATURE_SENSORS) break;
  }
  return result;
}

export function temperatureTelemetryFromRawSamples(
  samples: ReadonlyArray<RawTemperatureSample>,
): ServerSystemTemperatureTelemetry {
  if (samples.length === 0) return unavailableTemperatureTelemetry("unsupported");
  const sensors: ServerSystemTemperatureSensor[] = [];
  let sawSourceRecord = false;
  for (const sample of samples.slice(0, MAX_TEMPERATURE_SENSORS * 2)) {
    const source = temperatureSource(sample.source);
    if (source === null) continue;
    sawSourceRecord = true;
    const temperatureCelsius = measuredCelsius(sample.value);
    if (temperatureCelsius === null) continue;
    const rawName = typeof sample.name === "string" ? sample.name : "";
    const rawIdentifier = typeof sample.identifier === "string" ? sample.identifier : "";
    const kind = temperatureKind(rawName, rawIdentifier);
    sensors.push({
      kind,
      label: sanitizeTemperatureSensorLabel(rawName, `${kind.toUpperCase()} temperature`),
      temperatureCelsius,
      source,
    });
  }
  const bounded = deduplicateSensors(sensors);
  if (bounded.length === 0) {
    return unavailableTemperatureTelemetry(sawSourceRecord ? "malformed" : "unsupported");
  }
  return { version: 1, status: "available", sensors: bounded, reason: null, detail: null };
}

export function parseTemperatureProbeOutput(output: string): ServerSystemTemperatureTelemetry {
  if (output.length === 0) return unavailableTemperatureTelemetry("unsupported");
  try {
    const parsed: unknown = JSON.parse(output);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    if (values.length === 0) return unavailableTemperatureTelemetry("unsupported");
    if (
      values.length > MAX_TEMPERATURE_SENSORS * 2 ||
      values.some((value) => !value || typeof value !== "object" || Array.isArray(value))
    ) {
      return unavailableTemperatureTelemetry("malformed");
    }
    return temperatureTelemetryFromRawSamples(
      values.map((value) => {
        const record = value as Record<string, unknown>;
        return {
          name: record.Name ?? record.name,
          identifier: record.Identifier ?? record.identifier,
          value: record.Value ?? record.value,
          source: record.Source ?? record.source,
        };
      }),
    );
  } catch {
    return unavailableTemperatureTelemetry("malformed");
  }
}

export function mergeGpuTemperatureSensors(
  host: ServerSystemTemperatureTelemetry,
  gpu: ServerSystemGpuTelemetry,
): ServerSystemTemperatureTelemetry {
  const sensors =
    host.status === "available" ? [...host.sensors] : ([] as ServerSystemTemperatureSensor[]);
  if (gpu.status === "available") {
    for (const adapter of gpu.adapters) {
      if (adapter.temperatureCelsius === undefined) continue;
      sensors.push({
        kind: "gpu",
        label: sanitizeTemperatureSensorLabel(
          `${adapter.name} GPU ${adapter.index}`,
          `GPU ${adapter.index}`,
        ),
        temperatureCelsius: adapter.temperatureCelsius,
        source: "nvidia-smi",
      });
    }
  }
  const bounded = deduplicateSensors(sensors);
  return bounded.length > 0
    ? { version: 1, status: "available", sensors: bounded, reason: null, detail: null }
    : host;
}
