import {
  MAX_GPU_ADAPTER_INDEX,
  MAX_GPU_ADAPTER_NAME_LENGTH,
  MAX_GPU_ADAPTERS,
  MAX_GPU_MEMORY_BYTES,
  type ServerSystemGpuAdapterTelemetry,
  type ServerSystemGpuTelemetry,
  type ServerSystemGpuUnavailableReason,
} from "@cafecode/contracts";

/**
 * Fixed operator-facing prose. These strings are the only `detail` values this
 * module can produce: raw tool output, executable paths, driver strings, and
 * error messages never reach the transport boundary.
 */
const GPU_TELEMETRY_DETAIL: Readonly<Record<ServerSystemGpuUnavailableReason, string>> = {
  unsupported: "No supported GPU telemetry source is available on this system.",
  "probe-failed": "The GPU telemetry probe did not complete.",
  malformed: "The GPU telemetry source reported unusable values.",
};

const BYTES_PER_MEBIBYTE = 1_024 * 1_024;
const CSV_FIELD_COUNT = 5;

/**
 * Mirrors the contract-level name rule so a rejected name fails here, in the
 * server's own validation, rather than as a transport encode error later.
 */
const GPU_ADAPTER_NAME_PATTERN = /^[^\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]+$/u;
const NON_NEGATIVE_INTEGER_PATTERN = /^\d+$/;

/** One vendor-tool CSV row, still string-typed and unvalidated. */
export interface RawGpuAdapterSample {
  readonly name: string;
  readonly index: string;
  readonly utilizationPercent: string;
  readonly memoryTotalMebibytes: string;
  readonly memoryUsedMebibytes: string;
}

export function unavailableGpuTelemetry(
  reason: ServerSystemGpuUnavailableReason,
): ServerSystemGpuTelemetry {
  return { status: "unavailable", adapters: [], reason, detail: GPU_TELEMETRY_DETAIL[reason] };
}

/** No trusted GPU telemetry source exists on this platform or system. */
export function unsupportedGpuTelemetry(): ServerSystemGpuTelemetry {
  return unavailableGpuTelemetry("unsupported");
}

/** A source exists but the read did not complete (absent, failed, timed out, killed). */
export function probeFailedGpuTelemetry(): ServerSystemGpuTelemetry {
  return unavailableGpuTelemetry("probe-failed");
}

/** A source ran and returned values that failed validation. */
export function malformedGpuTelemetry(): ServerSystemGpuTelemetry {
  return unavailableGpuTelemetry("malformed");
}

function boundedPercent(used: number, total: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(total) || used < 0 || total <= 0) {
    return null;
  }
  return Math.min(100, Math.max(0, (used / total) * 100));
}

function parseBoundedNonNegativeInteger(raw: string, maximum: number): number | null {
  const trimmed = raw.trim();
  if (!NON_NEGATIVE_INTEGER_PATTERN.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function parseAdapterName(raw: string): string | null {
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_GPU_ADAPTER_NAME_LENGTH) return null;
  return GPU_ADAPTER_NAME_PATTERN.test(name) ? name : null;
}

function parseGpuAdapter(sample: RawGpuAdapterSample): ServerSystemGpuAdapterTelemetry | null {
  const name = parseAdapterName(sample.name);
  if (name === null) return null;

  const index = parseBoundedNonNegativeInteger(sample.index, MAX_GPU_ADAPTER_INDEX);
  const utilizationPercent = parseBoundedNonNegativeInteger(sample.utilizationPercent, 100);
  const memoryTotalMebibytes = parseBoundedNonNegativeInteger(
    sample.memoryTotalMebibytes,
    MAX_GPU_MEMORY_BYTES,
  );
  const memoryUsedMebibytes = parseBoundedNonNegativeInteger(
    sample.memoryUsedMebibytes,
    MAX_GPU_MEMORY_BYTES,
  );
  if (
    index === null ||
    utilizationPercent === null ||
    memoryTotalMebibytes === null ||
    memoryTotalMebibytes <= 0 ||
    memoryUsedMebibytes === null ||
    memoryUsedMebibytes > memoryTotalMebibytes
  ) {
    return null;
  }

  const memoryTotalBytes = memoryTotalMebibytes * BYTES_PER_MEBIBYTE;
  const memoryUsedBytes = memoryUsedMebibytes * BYTES_PER_MEBIBYTE;
  if (
    !Number.isSafeInteger(memoryTotalBytes) ||
    !Number.isSafeInteger(memoryUsedBytes) ||
    memoryTotalBytes > MAX_GPU_MEMORY_BYTES
  ) {
    return null;
  }
  const memoryUtilizationPercent = boundedPercent(memoryUsedBytes, memoryTotalBytes);
  if (memoryUtilizationPercent === null) return null;

  return {
    index,
    name,
    utilizationPercent,
    memoryTotalBytes,
    memoryUsedBytes,
    memoryUtilizationPercent,
  };
}

/**
 * Fails closed to `malformed` on any impossible, duplicate-index, or
 * out-of-range row rather than publishing a partial adapter list.
 *
 * A single unreadable field therefore hides every adapter on the host. That is
 * deliberate — a half-populated list reads as authoritative — but it is why
 * `malformed` is a distinct reason from `unsupported`: a caller can tell
 * "this system has no GPU telemetry source" from "the source answered with
 * values this build will not publish".
 */
export function gpuTelemetryFromRawSamples(
  samples: ReadonlyArray<RawGpuAdapterSample>,
): ServerSystemGpuTelemetry {
  if (samples.length === 0 || samples.length > MAX_GPU_ADAPTERS) {
    return malformedGpuTelemetry();
  }

  const adapters: ServerSystemGpuAdapterTelemetry[] = [];
  const seenIndexes = new Set<number>();
  for (const sample of samples) {
    const adapter = parseGpuAdapter(sample);
    if (!adapter || seenIndexes.has(adapter.index)) {
      return malformedGpuTelemetry();
    }
    seenIndexes.add(adapter.index);
    adapters.push(adapter);
  }

  return { status: "available", adapters, reason: null, detail: null };
}

function parseCsvLine(line: string): RawGpuAdapterSample | null {
  const fields = line.split(",");
  if (fields.length !== CSV_FIELD_COUNT) return null;
  const [name, index, utilizationPercent, memoryTotalMebibytes, memoryUsedMebibytes] = fields;
  if (
    name === undefined ||
    index === undefined ||
    utilizationPercent === undefined ||
    memoryTotalMebibytes === undefined ||
    memoryUsedMebibytes === undefined
  ) {
    return null;
  }
  return {
    name: name.trim(),
    index: index.trim(),
    utilizationPercent: utilizationPercent.trim(),
    memoryTotalMebibytes: memoryTotalMebibytes.trim(),
    memoryUsedMebibytes: memoryUsedMebibytes.trim(),
  };
}

/**
 * Pure text-to-contract boundary for `name,index,utilization,total,used` CSV
 * rows with no header and no units. Total function: every input maps to a
 * valid `ServerSystemGpuTelemetry`, never a throw.
 */
export function parseGpuProbeOutput(output: string): ServerSystemGpuTelemetry {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0 || lines.length > MAX_GPU_ADAPTERS) {
    return malformedGpuTelemetry();
  }

  const samples: RawGpuAdapterSample[] = [];
  for (const line of lines) {
    const sample = parseCsvLine(line);
    if (!sample) return malformedGpuTelemetry();
    samples.push(sample);
  }
  return gpuTelemetryFromRawSamples(samples);
}
