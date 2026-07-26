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
  projectVolume: ServerProjectVolumeTelemetry,
});
export type ServerProjectSystemTelemetryResult = typeof ServerProjectSystemTelemetryResult.Type;
