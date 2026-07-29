import { ProjectId } from "@cafecode/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

import { probeFailedGpuTelemetry, unsupportedGpuTelemetry } from "./GpuTelemetry.ts";
import {
  makeHostGpuTelemetrySampler,
  type HostGpuTelemetrySamplerShape,
} from "./HostGpuTelemetry.ts";
import {
  unavailableNetworkTelemetry,
  type HostNetworkTelemetrySamplerShape,
} from "./HostNetworkTelemetry.ts";
import type {
  HostSystemTelemetrySample,
  HostSystemTelemetrySamplerShape,
} from "./HostSystemTelemetry.ts";
import type { HostTemperatureTelemetrySamplerShape } from "./HostTemperatureTelemetry.ts";
import {
  makeProjectSystemTelemetry,
  PROJECT_SYSTEM_TELEMETRY_MINIMUM_SAMPLE_INTERVAL_MS,
  type ProjectSystemTelemetryRuntime,
} from "./ProjectSystemTelemetry.ts";
import type { ProjectVolumeSamplerShape } from "./ProjectVolumeSampler.ts";
import { unavailableProjectVolumeTelemetry } from "./ProjectVolumeTelemetry.ts";
import { unavailableTemperatureTelemetry } from "./TemperatureTelemetry.ts";

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
  readonly gpuRead?: HostGpuTelemetrySamplerShape["sample"];
  readonly gpuSampler?: HostGpuTelemetrySamplerShape;
  readonly networkSample?: HostNetworkTelemetrySamplerShape["sample"];
  readonly temperatureSample?: HostTemperatureTelemetrySamplerShape["sample"];
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
  const gpuSampler: HostGpuTelemetrySamplerShape = input.gpuSampler ?? {
    sample: input.gpuRead ?? (async () => unsupportedGpuTelemetry()),
  };
  const networkSampler: HostNetworkTelemetrySamplerShape = {
    sample: input.networkSample ?? (async () => unavailableNetworkTelemetry()),
  };
  const temperatureSampler: HostTemperatureTelemetrySamplerShape = {
    sample: input.temperatureSample ?? (async () => unavailableTemperatureTelemetry("unsupported")),
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
      networkSampler,
      gpuSampler,
      temperatureSampler,
      volumeSampler,
      runtime,
    }),
    hostCalls,
    volumeRoots,
  };
}

describe("ProjectSystemTelemetry", () => {
  it("merges measured GPU temperatures with optional host hardware sensors", () =>
    Effect.gen(function* () {
      const fixture = makeFixture({
        gpuRead: async () => ({
          status: "available",
          reason: null,
          detail: null,
          adapters: [
            {
              index: 0,
              name: "NVIDIA RTX",
              utilizationPercent: 20,
              memoryTotalBytes: 1_000,
              memoryUsedBytes: 100,
              memoryUtilizationPercent: 10,
              temperatureCelsius: 48,
            },
          ],
        }),
        temperatureSample: async () => ({
          version: 1,
          status: "available",
          sensors: [
            {
              kind: "cpu",
              label: "CPU Package",
              temperatureCelsius: 62,
              source: "libre-hardware-monitor",
            },
          ],
          reason: null,
          detail: null,
        }),
      });
      const result = yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project" });

      expect(result.temperatures?.status).toBe("available");
      expect(
        result.temperatures?.status === "available" ? result.temperatures.sensors : [],
      ).toEqual([
        expect.objectContaining({ kind: "cpu", temperatureCelsius: 62 }),
        expect.objectContaining({
          kind: "gpu",
          temperatureCelsius: 48,
          source: "nvidia-smi",
        }),
      ]);
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

  it("reports GPU as explicitly unsupported when no trusted probe source exists", () =>
    Effect.gen(function* () {
      const fixture = makeFixture({});
      const result = yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project" });

      expect(result.gpu).toEqual(unsupportedGpuTelemetry());
      expect(result.gpu.reason).toBe("unsupported");
    }));

  it("classifies an unexpected GPU probe rejection as a probe failure", () =>
    Effect.gen(function* () {
      const fixture = makeFixture({
        gpuRead: async () => {
          throw new Error("private GPU failure");
        },
      });
      const result = yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project" });

      expect(result.gpu).toEqual(probeFailedGpuTelemetry());
      expect(result.gpu.reason).toBe("probe-failed");
      expect(JSON.stringify(result)).not.toContain("private");
    }));

  it("shares one host GPU probe across concurrent reads for different projects", async () => {
    const availableGpu = {
      status: "available" as const,
      adapters: [
        {
          index: 0,
          name: "GPU 0",
          utilizationPercent: 40,
          memoryTotalBytes: 8_000,
          memoryUsedBytes: 2_000,
          memoryUtilizationPercent: 25,
        },
      ],
      reason: null,
      detail: null,
    };
    const pendingGpu = deferred<typeof availableGpu>();
    let gpuCalls = 0;
    const gpuSampler = makeHostGpuTelemetrySampler(
      {
        read: () => {
          gpuCalls += 1;
          return pendingGpu.promise;
        },
      },
      { nowMonotonicMillis: () => 1_000 },
    );
    const fixture = makeFixture({ gpuSampler });

    const left = Effect.runPromise(
      fixture.telemetry.read({
        projectId: ProjectId.make("gpu-project-left"),
        workspaceRoot: "/left",
      }),
    );
    const right = Effect.runPromise(
      fixture.telemetry.read({
        projectId: ProjectId.make("gpu-project-right"),
        workspaceRoot: "/right",
      }),
    );
    await Promise.resolve();
    pendingGpu.resolve(availableGpu);
    const [leftResult, rightResult] = await Promise.all([left, right]);

    expect(gpuCalls).toBe(1);
    expect(leftResult.gpu).toEqual(availableGpu);
    expect(rightResult.gpu).toEqual(availableGpu);
  });

  it("keeps bounded GPU and aggregate network measurements independent of volume reads", () =>
    Effect.gen(function* () {
      const fixture = makeFixture({
        gpuRead: async () => ({
          status: "available",
          adapters: [
            {
              index: 0,
              name: "GPU 0",
              utilizationPercent: 40,
              memoryTotalBytes: 8_000,
              memoryUsedBytes: 2_000,
              memoryUtilizationPercent: 25,
            },
          ],
          reason: null,
          detail: null,
        }),
        networkSample: async () => ({
          status: "available",
          receiveBytesPerSecond: 4_096,
          transmitBytesPerSecond: 2_048,
          detail: null,
        }),
        volumeRead: async () => {
          throw new Error("private volume failure");
        },
      });
      const result = yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project" });

      expect(result.gpu).toMatchObject({ status: "available" });
      expect(result.network).toEqual({
        status: "available",
        receiveBytesPerSecond: 4_096,
        transmitBytesPerSecond: 2_048,
        detail: null,
      });
      expect(result.projectVolume).toEqual(unavailableProjectVolumeTelemetry());
      expect(JSON.stringify(result)).not.toContain("private");
    }));

  it("keeps the GPU field present when the volume read fails", () =>
    Effect.gen(function* () {
      const fixture = makeFixture({
        volumeRead: async () => {
          throw new Error("/private/project");
        },
      });
      const result = yield* fixture.telemetry.read({ projectId, workspaceRoot: "/project" });

      expect(result.gpu).toEqual(unsupportedGpuTelemetry());
      expect(result.projectVolume).toEqual(unavailableProjectVolumeTelemetry());
      expect(result.cpu).toEqual(availableHost.cpu);
      expect(JSON.stringify(result)).not.toContain("private");
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
