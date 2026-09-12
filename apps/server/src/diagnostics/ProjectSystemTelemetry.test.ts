import { ProjectId } from "@cafecode/contracts";
import { unavailableTemperatureTelemetry } from "./TemperatureTelemetry.ts";
import type { HostTemperatureTelemetrySamplerShape } from "./HostTemperatureTelemetry.ts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import type {
  HostSystemTelemetrySample,
  HostSystemTelemetrySamplerShape,
} from "./HostSystemTelemetry.ts";
import {
  makeProjectSystemTelemetry,
  PROJECT_SYSTEM_TELEMETRY_MINIMUM_SAMPLE_INTERVAL_MS,
  type ProjectSystemTelemetryRuntime,
} from "./ProjectSystemTelemetry.ts";
import type { ProjectVolumeSamplerShape } from "./ProjectVolumeSampler.ts";
import { unavailableProjectVolumeTelemetry } from "./ProjectVolumeTelemetry.ts";
import { probeFailedGpuTelemetry, unsupportedGpuTelemetry } from "./GpuTelemetry.ts";
import {
  makeHostGpuTelemetrySampler,
  type HostGpuTelemetrySamplerShape,
} from "./HostGpuTelemetry.ts";

const projectId = ProjectId.make("project-system-telemetry-test");
const availableHost: HostSystemTelemetrySample = {
  cpu: {
    status: "available",
    utilizationPercent: 25,
    logicalProcessorCount: 8,
    detail: null,
  },
  memory: {
    status: "available",
    totalBytes: 1_000,
    usedBytes: 750,
    availableBytes: 250,
    utilizationPercent: 75,
    detail: null,
  },
};
const availableVolume = {
  status: "available" as const,
  totalBytes: 2_000,
  usedBytes: 1_200,
  availableBytes: 800,
  utilizationPercent: 60,
  projectVolumeOnly: true as const,
  detail: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeFixture(input: {
  readonly now?: () => number;
  readonly hostSample?: HostSystemTelemetrySamplerShape["sample"];
  readonly volumeRead?: ProjectVolumeSamplerShape["read"];
  readonly gpuSampler?: HostGpuTelemetrySamplerShape;
  readonly temperatureSampler?: HostTemperatureTelemetrySamplerShape;
  readonly platform?: () => string;
  readonly architecture?: () => string;
}) {
  const now = input.now ?? (() => 1_000);
  const hostCalls: Array<{ readonly sampledAtMonotonicMs: number; readonly platform: string }> = [];
  const volumeRoots: string[] = [];
  const hostSampler: HostSystemTelemetrySamplerShape = {
    sample: (sampleInput) => {
      hostCalls.push(sampleInput);
      return input.hostSample?.(sampleInput) ?? availableHost;
    },
  };
  const volumeSampler: ProjectVolumeSamplerShape = {
    read: (root) => {
      volumeRoots.push(root);
      return input.volumeRead?.(root) ?? Promise.resolve(availableVolume);
    },
  };
  const runtime: ProjectSystemTelemetryRuntime = {
    nowMillis: now,
    nowMonotonicMillis: now,
    platform: input.platform ?? (() => "linux"),
    architecture: input.architecture ?? (() => "arm64"),
  };
  return {
    telemetry: makeProjectSystemTelemetry({
      hostSampler,
      temperatureSampler: input.temperatureSampler ?? {
        sample: async () => unavailableTemperatureTelemetry("unsupported"),
      },
      volumeSampler,
      gpuSampler: input.gpuSampler ?? { sample: async () => unsupportedGpuTelemetry() },
      runtime,
    }),
    hostCalls,
    volumeRoots,
  };
}

describe("ProjectSystemTelemetry", () => {
  it("preserves a measured vendor GPU temperature when host sensors are unavailable", () =>
    Effect.gen(function* () {
      const fixture = makeFixture({
        gpuSampler: {
          sample: async () => ({
            status: "available",
            reason: null,
            detail: null,
            adapters: [
              {
                index: 0,
                name: "NVIDIA Test GPU",
                utilizationPercent: 10,
                memoryTotalBytes: 1000,
                memoryUsedBytes: 100,
                memoryUtilizationPercent: 10,
                temperatureCelsius: 61,
              },
            ],
          }),
        },
        temperatureSampler: {
          sample: async () => {
            throw new Error("private WMI diagnostic");
          },
        },
      });
      const result = yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project" });
      expect(result.temperatures).toMatchObject({
        status: "available",
        sensors: [{ kind: "gpu", temperatureCelsius: 61, source: "nvidia-smi" }],
        hostSensorProbe: { status: "unavailable", reason: "probe-failed" },
      });
      expect(result.cpu).toEqual(availableHost.cpu);
      expect(result.projectVolume).toEqual(availableVolume);
      expect(JSON.stringify(result)).not.toContain("private");
    }));

  it("shares one GPU probe across projects while retaining their separate volume reads", () =>
    Effect.gen(function* () {
      let gpuReads = 0;
      const gpuSampler = makeHostGpuTelemetrySampler(
        {
          read: async () => {
            gpuReads += 1;
            return unsupportedGpuTelemetry();
          },
        },
        { nowMonotonicMillis: () => 1_000 },
      );
      const fixture = makeFixture({ gpuSampler });
      const [left, right] = yield* Effect.all(
        [
          fixture.telemetry.read({ projectId, workspaceRoot: "/left" }),
          fixture.telemetry.read({
            projectId: ProjectId.make("gpu-right"),
            workspaceRoot: "/right",
          }),
        ],
        { concurrency: "unbounded" },
      );
      expect(gpuReads).toBe(1);
      expect(left.gpu).toEqual(unsupportedGpuTelemetry());
      expect(right.gpu).toBe(left.gpu);
      expect(fixture.volumeRoots).toEqual(["/left", "/right"]);
    }));

  it("keeps CPU, RAM and storage available when the GPU sampler rejects", () =>
    Effect.gen(function* () {
      const fixture = makeFixture({
        gpuSampler: {
          sample: async () => {
            throw new Error("private driver diagnostic");
          },
        },
      });
      const result = yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project" });
      expect(result.gpu).toEqual(probeFailedGpuTelemetry());
      expect(result.cpu).toEqual(availableHost.cpu);
      expect(result.memory).toEqual(availableHost.memory);
      expect(result.projectVolume).toEqual(availableVolume);
      expect(JSON.stringify(result)).not.toContain("private");
    }));

  it("combines host and exact-project volume telemetry with bounded metadata", () =>
    Effect.gen(function* () {
      const fixture = makeFixture({});
      const result = yield* fixture.telemetry.read({
        projectId,
        workspaceRoot: "/selected/project",
      });

      expect(result).toMatchObject({
        projectId,
        minimumSampleIntervalMs: PROJECT_SYSTEM_TELEMETRY_MINIMUM_SAMPLE_INTERVAL_MS,
        platform: "linux",
        architecture: "arm64",
        cpu: availableHost.cpu,
        memory: availableHost.memory,
        projectVolume: availableVolume,
      });
      expect(DateTime.toEpochMillis(result.sampledAt)).toBe(1_000);
      expect(fixture.hostCalls).toEqual([{ sampledAtMonotonicMs: 1_000, platform: "linux" }]);
      expect(fixture.volumeRoots).toEqual(["/selected/project"]);
    }));

  it("returns the exact cached result inside one second", () =>
    Effect.gen(function* () {
      let now = 1_000;
      const fixture = makeFixture({ now: () => now });
      const first = yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project" });
      now = 1_999;
      const cached = yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project" });
      now = 2_000;
      const refreshed = yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project" });

      expect(cached).toBe(first);
      expect(refreshed).not.toBe(first);
      expect(fixture.hostCalls).toHaveLength(2);
      expect(fixture.volumeRoots).toEqual(["/project", "/project"]);
    }));

  it("invalidates a project cache immediately when its authoritative root changes", () =>
    Effect.gen(function* () {
      const fixture = makeFixture({});
      yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project/old" });
      yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project/new" });

      expect(fixture.volumeRoots).toEqual(["/project/old", "/project/new"]);
    }));

  it("coalesces concurrent reads only for the same project and root", () =>
    Effect.gen(function* () {
      const operation = deferred<typeof availableVolume>();
      const fixture = makeFixture({ volumeRead: () => operation.promise });
      const first = yield* fixture.telemetry
        .read({ projectId, workspaceRoot: "/project" })
        .pipe(Effect.forkScoped);
      const second = yield* fixture.telemetry
        .read({ projectId, workspaceRoot: "/project" })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;

      expect(fixture.volumeRoots).toEqual(["/project"]);
      operation.resolve(availableVolume);
      const [left, right] = yield* Effect.all([Fiber.join(first), Fiber.join(second)]);
      expect(right).toBe(left);
      expect(fixture.hostCalls).toHaveLength(1);
    }));

  it("does not let an older root overwrite a newer project generation", () =>
    Effect.gen(function* () {
      const oldOperation = deferred<typeof availableVolume>();
      const fixture = makeFixture({
        volumeRead: (root) =>
          root === "/old" ? oldOperation.promise : Promise.resolve(availableVolume),
      });
      const oldFiber = yield* fixture.telemetry
        .read({ projectId, workspaceRoot: "/old" })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      const newer = yield* fixture.telemetry.read({ projectId, workspaceRoot: "/new" });
      oldOperation.resolve({ ...availableVolume, usedBytes: 1_500 });
      const older = yield* Fiber.join(oldFiber);
      const cachedNewer = yield* fixture.telemetry.read({ projectId, workspaceRoot: "/new" });

      expect(older).toBe(newer);
      expect(cachedNewer).toBe(newer);
      expect(fixture.volumeRoots).toEqual(["/old", "/new"]);
    }));

  it("keeps projects and their volume samples isolated", () =>
    Effect.gen(function* () {
      const leftId = ProjectId.make("project-system-telemetry-left");
      const rightId = ProjectId.make("project-system-telemetry-right");
      const fixture = makeFixture({
        volumeRead: async (root) =>
          root === "/left" ? availableVolume : { ...availableVolume, usedBytes: 1_800 },
      });
      const left = yield* fixture.telemetry.read({ projectId: leftId, workspaceRoot: "/left" });
      const right = yield* fixture.telemetry.read({ projectId: rightId, workspaceRoot: "/right" });

      expect(left.projectVolume).toMatchObject({ usedBytes: 1_200 });
      expect(right.projectVolume).toMatchObject({ usedBytes: 1_800 });
      expect(fixture.volumeRoots).toEqual(["/left", "/right"]);
    }));

  it("sanitizes failed dependencies and invalid runtime labels", () =>
    Effect.gen(function* () {
      const fixture = makeFixture({
        hostSample: () => {
          throw new Error("private CPU counter");
        },
        volumeRead: async () => {
          throw new Error("/private/project");
        },
        platform: () => " ",
        architecture: () => {
          throw new Error("private architecture");
        },
      });
      const result = yield* fixture.telemetry.read({
        projectId,
        workspaceRoot: "/private/project",
      });

      expect(result).toMatchObject({
        platform: "unknown",
        architecture: "unknown",
        cpu: { status: "unavailable", utilizationPercent: null },
        memory: { status: "unavailable", totalBytes: null },
        projectVolume: unavailableProjectVolumeTelemetry(),
      });
      expect(JSON.stringify(result)).not.toContain("private");
    }));

  it("invalidates cache after a monotonic-clock rollback", () =>
    Effect.gen(function* () {
      let now = 1_000;
      const fixture = makeFixture({ now: () => now });
      yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project" });
      now = 500;
      yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project" });

      expect(fixture.hostCalls).toHaveLength(2);
      expect(fixture.volumeRoots).toEqual(["/project", "/project"]);
    }));

  it("bounds retained project results and keeps the newest write", () =>
    Effect.gen(function* () {
      let now = 1_000;
      const fixture = makeFixture({ now: () => now });
      for (let index = 0; index < 65; index += 1) {
        now += 1;
        yield* fixture.telemetry.read({
          projectId: ProjectId.make(`project-system-cache-${index}`),
          workspaceRoot: `/project/${index}`,
        });
      }

      yield* fixture.telemetry.read({
        projectId: ProjectId.make("project-system-cache-64"),
        workspaceRoot: "/project/64",
      });
      yield* fixture.telemetry.read({
        projectId: ProjectId.make("project-system-cache-0"),
        workspaceRoot: "/project/0",
      });

      expect(fixture.volumeRoots).toHaveLength(66);
      expect(fixture.volumeRoots.at(-1)).toBe("/project/0");
    }));
});
