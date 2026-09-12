import {
  MAX_HARDWARE_TEMPERATURE_CELSIUS,
  MIN_HARDWARE_TEMPERATURE_CELSIUS,
  MAX_TEMPERATURE_SENSORS,
  type ServerSystemTemperatureSensor,
  type ServerSystemTemperatureTelemetry,
} from "@cafecode/contracts";

export const TEMPERATURE_CATEGORIES = [
  "cpu",
  "gpu",
  "memory",
  "vram",
  "storage",
  "ambient",
  "other",
] as const;
export type TemperatureCategory = (typeof TEMPERATURE_CATEGORIES)[number];
export type TemperatureCategoryValues = Readonly<Record<TemperatureCategory, number | null>>;
export interface TemperatureCategoryReading {
  readonly celsius: number | null;
  readonly count: number;
}
export type TemperatureCategoryReadings = Readonly<
  Record<TemperatureCategory, TemperatureCategoryReading>
>;

export const emptyTemperatureCategoryValues = (): TemperatureCategoryValues => ({
  cpu: null,
  gpu: null,
  memory: null,
  vram: null,
  storage: null,
  ambient: null,
  other: null,
});

/** Use the hottest reported sensor per category. Missing categories stay empty. */
export function projectTemperatureCategories(
  telemetry: ServerSystemTemperatureTelemetry | undefined,
): TemperatureCategoryReadings {
  const result = Object.fromEntries(
    TEMPERATURE_CATEGORIES.map((kind) => [kind, { celsius: null, count: 0 }]),
  ) as Record<TemperatureCategory, { celsius: number | null; count: number }>;
  if (
    telemetry?.version !== 1 ||
    telemetry.status !== "available" ||
    !Array.isArray(telemetry.sensors) ||
    telemetry.sensors.length > MAX_TEMPERATURE_SENSORS
  )
    return result;
  // The RPC validates this shape. Keep direct/injected UI adapters fail closed too.
  if (
    telemetry.sensors.some(
      (sensor) =>
        !sensor ||
        !TEMPERATURE_CATEGORIES.includes(sensor.kind) ||
        !Number.isFinite(sensor.temperatureCelsius) ||
        sensor.temperatureCelsius < MIN_HARDWARE_TEMPERATURE_CELSIUS ||
        sensor.temperatureCelsius > MAX_HARDWARE_TEMPERATURE_CELSIUS,
    )
  )
    return result;
  for (const sensor of telemetry.sensors as readonly ServerSystemTemperatureSensor[]) {
    const current = result[sensor.kind];
    current.celsius =
      current.celsius === null
        ? sensor.temperatureCelsius
        : Math.max(current.celsius, sensor.temperatureCelsius);
    current.count += 1;
  }
  return result;
}

export function temperatureCategoryValues(
  telemetry: ServerSystemTemperatureTelemetry | undefined,
): TemperatureCategoryValues {
  const projected = projectTemperatureCategories(telemetry);
  return Object.fromEntries(
    TEMPERATURE_CATEGORIES.map((kind) => [kind, projected[kind].celsius]),
  ) as TemperatureCategoryValues;
}

/** Fixed -20..120 Celsius graph scale; labels retain the actual measurement. */
export function normalizeTemperatureHistory(
  values: readonly (number | null)[],
): readonly (number | null)[] {
  return values.map((value) =>
    value !== null &&
    Number.isFinite(value) &&
    value >= MIN_HARDWARE_TEMPERATURE_CELSIUS &&
    value <= MAX_HARDWARE_TEMPERATURE_CELSIUS
      ? ((Math.min(120, Math.max(-20, value)) + 20) / 140) * 100
      : null,
  );
}
