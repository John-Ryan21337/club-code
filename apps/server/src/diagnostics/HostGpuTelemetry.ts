import { performance } from "node:perf_hooks";

import type { ServerSystemGpuTelemetry } from "@cafecode/contracts";

import type { GpuProbeProcessShape } from "./GpuProbeProcess.ts";
import { probeFailedGpuTelemetry } from "./GpuTelemetry.ts";

export const HOST_GPU_TELEMETRY_MINIMUM_SAMPLE_INTERVAL_MS = 3_000;

export interface HostGpuTelemetrySamplerShape {
  readonly sample: () => Promise<ServerSystemGpuTelemetry>;
}

export interface HostGpuTelemetryClock {
  readonly nowMonotonicMillis: () => number;
}

/**
 * Share one bounded host-GPU observation across every selected project.
 *
 * GPU state is host-global, so project windows must neither race the probe's
 * single admission slot nor launch one vendor helper each. Failures are cached
 * too, preventing an unavailable driver from becoming a tight spawn loop.
 */
export function makeHostGpuTelemetrySampler(
  probe: Pick<GpuProbeProcessShape, "read">,
  clock: HostGpuTelemetryClock = {
    nowMonotonicMillis: performance.now.bind(performance),
  },
): HostGpuTelemetrySamplerShape {
  let cachedAtMonotonicMs = Number.NEGATIVE_INFINITY;
  let cached: ServerSystemGpuTelemetry = probeFailedGpuTelemetry();
  let inFlight: Promise<ServerSystemGpuTelemetry> | null = null;

  const readClock = (): number | null => {
    try {
      const value = clock.nowMonotonicMillis();
      return Number.isFinite(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  };

  const sample = (): Promise<ServerSystemGpuTelemetry> => {
    const requestedAtMonotonicMs = readClock();
    if (requestedAtMonotonicMs === null) {
      return Promise.resolve(probeFailedGpuTelemetry());
    }
    if (
      requestedAtMonotonicMs >= cachedAtMonotonicMs &&
      requestedAtMonotonicMs - cachedAtMonotonicMs < HOST_GPU_TELEMETRY_MINIMUM_SAMPLE_INTERVAL_MS
    ) {
      return Promise.resolve(cached);
    }
    if (inFlight) return inFlight;

    inFlight = Promise.resolve()
      .then(() => probe.read())
      .catch(probeFailedGpuTelemetry)
      .then((next) => {
        cached = next;
        cachedAtMonotonicMs = readClock() ?? requestedAtMonotonicMs;
        return next;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return { sample };
}
