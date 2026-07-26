import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const ServerProjectSystemTelemetryInput = Schema.Struct({
  projectId: ProjectId,
});
export type ServerProjectSystemTelemetryInput = typeof ServerProjectSystemTelemetryInput.Type;

export const ServerProjectSystemTelemetryErrorKind = Schema.Literals([
  "project-not-found",
  "project-lookup-failed",
]);
export type ServerProjectSystemTelemetryErrorKind =
  typeof ServerProjectSystemTelemetryErrorKind.Type;

export class ServerProjectSystemTelemetryError extends Schema.TaggedErrorClass<ServerProjectSystemTelemetryError>()(
  "ServerProjectSystemTelemetryError",
  {
    kind: ServerProjectSystemTelemetryErrorKind,
    message: TrimmedNonEmptyString,
  },
) {}

const ServerSystemTelemetryPercent = Schema.Number.check(
  Schema.isBetween({ minimum: 0, maximum: 100 }),
);

export const ServerSystemCpuTelemetry = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    utilizationPercent: ServerSystemTelemetryPercent,
    logicalProcessorCount: PositiveInt,
    detail: Schema.Null,
  }),
  Schema.Struct({
    status: Schema.Literal("warming"),
    utilizationPercent: Schema.Null,
    logicalProcessorCount: PositiveInt,
    detail: TrimmedNonEmptyString,
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    utilizationPercent: Schema.Null,
    logicalProcessorCount: NonNegativeInt,
    detail: TrimmedNonEmptyString,
  }),
]);
export type ServerSystemCpuTelemetry = typeof ServerSystemCpuTelemetry.Type;

export const ServerSystemMemoryTelemetry = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    totalBytes: PositiveInt,
    usedBytes: NonNegativeInt,
    // Runtime-reported memory available to Cafe. Platforms whose runtime
    // cannot distinguish reusable memory from raw free pages report unavailable.
    availableBytes: NonNegativeInt,
    utilizationPercent: ServerSystemTelemetryPercent,
    detail: Schema.Null,
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    totalBytes: Schema.Null,
    usedBytes: Schema.Null,
    availableBytes: Schema.Null,
    utilizationPercent: Schema.Null,
    detail: TrimmedNonEmptyString,
  }),
]);
export type ServerSystemMemoryTelemetry = typeof ServerSystemMemoryTelemetry.Type;

export const MAX_GPU_ADAPTERS = 64;
export const MAX_GPU_ADAPTER_NAME_LENGTH = 200;
export const MAX_GPU_ADAPTER_INDEX = 4_095;
export const MAX_GPU_MEMORY_BYTES = Number.MAX_SAFE_INTEGER;
const MAX_GPU_DETAIL_LENGTH = 160;

/**
 * Adapter names originate in a third-party vendor tool, so they are treated as
 * untrusted text. Control, format, lone-surrogate, private-use, and
 * line/paragraph separator code points are rejected outright: a corrupt or
 * hostile tool must not be able to smuggle terminal escapes, bidi overrides,
 * or zero-width joiners into a label the product later renders or logs.
 */
const GPU_ADAPTER_NAME_PATTERN = /^[^\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Zl}\p{Zp}]+$/u;

const ServerSystemGpuAdapterName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(MAX_GPU_ADAPTER_NAME_LENGTH),
  Schema.isPattern(GPU_ADAPTER_NAME_PATTERN),
);

/**
 * Why a measurement is missing, kept separate from the prose `detail` so a
 * caller can branch without string matching.
 *
 * - `unsupported`: this platform/system exposes no trusted GPU telemetry source.
 * - `probe-failed`: a source exists but the read did not complete.
 * - `malformed`: a source ran and returned values that failed validation.
 */
export const ServerSystemGpuUnavailableReason = Schema.Literals([
  "unsupported",
  "probe-failed",
  "malformed",
]);
export type ServerSystemGpuUnavailableReason = typeof ServerSystemGpuUnavailableReason.Type;

export const ServerSystemGpuAdapterTelemetry = Schema.Struct({
  index: NonNegativeInt.check(Schema.isLessThanOrEqualTo(MAX_GPU_ADAPTER_INDEX)),
  name: ServerSystemGpuAdapterName,
  utilizationPercent: ServerSystemTelemetryPercent,
  // `Schema.Int` alone admits values like 1e300, so byte counts carry an
  // explicit safe-integer ceiling rather than relying on integrality.
  memoryTotalBytes: PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_GPU_MEMORY_BYTES)),
  memoryUsedBytes: NonNegativeInt.check(Schema.isLessThanOrEqualTo(MAX_GPU_MEMORY_BYTES)),
  memoryUtilizationPercent: ServerSystemTelemetryPercent,
});
export type ServerSystemGpuAdapterTelemetry = typeof ServerSystemGpuAdapterTelemetry.Type;

export const ServerSystemGpuTelemetry = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    // Bounded so a malformed or hostile tool cannot force an unbounded payload.
    adapters: Schema.Array(ServerSystemGpuAdapterTelemetry).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(MAX_GPU_ADAPTERS),
    ),
    reason: Schema.Null,
    detail: Schema.Null,
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    adapters: Schema.Array(ServerSystemGpuAdapterTelemetry).check(Schema.isMaxLength(0)),
    reason: ServerSystemGpuUnavailableReason,
    // Fixed operator-facing prose. Raw tool output never reaches this field.
    detail: TrimmedNonEmptyString.check(Schema.isMaxLength(MAX_GPU_DETAIL_LENGTH)),
  }),
]);
export type ServerSystemGpuTelemetry = typeof ServerSystemGpuTelemetry.Type;

export const ServerProjectVolumeTelemetry = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("available"),
    totalBytes: PositiveInt,
    // `usedBytes + availableBytes` can be less than `totalBytes` when the
    // filesystem reserves blocks. `utilizationPercent` follows `df` Use%:
    // used / (used + process-available), not used / total.
    usedBytes: NonNegativeInt,
    // Available capacity on the volume containing the selected project only.
    availableBytes: NonNegativeInt,
    utilizationPercent: ServerSystemTelemetryPercent,
    projectVolumeOnly: Schema.Literal(true),
    detail: Schema.Null,
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    totalBytes: Schema.Null,
    usedBytes: Schema.Null,
    availableBytes: Schema.Null,
    utilizationPercent: Schema.Null,
    projectVolumeOnly: Schema.Literal(true),
    detail: TrimmedNonEmptyString,
  }),
]);
export type ServerProjectVolumeTelemetry = typeof ServerProjectVolumeTelemetry.Type;

export const ServerProjectSystemTelemetryResult = Schema.Struct({
  projectId: ProjectId,
  sampledAt: Schema.DateTimeUtc,
  minimumSampleIntervalMs: PositiveInt,
  platform: TrimmedNonEmptyString,
  architecture: TrimmedNonEmptyString,
  cpu: ServerSystemCpuTelemetry,
  memory: ServerSystemMemoryTelemetry,
  gpu: ServerSystemGpuTelemetry,
  projectVolume: ServerProjectVolumeTelemetry,
});
export type ServerProjectSystemTelemetryResult = typeof ServerProjectSystemTelemetryResult.Type;
