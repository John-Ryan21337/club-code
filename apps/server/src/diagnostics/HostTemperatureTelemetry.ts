import { performance } from "node:perf_hooks";

import type { ServerSystemTemperatureTelemetry } from "@cafecode/contracts";

import type { HostTemperatureProbeProcessShape } from "./HostTemperatureProbeProcess.ts";
import { unavailableTemperatureTelemetry } from "./TemperatureTelemetry.ts";

export const HOST_TEMPERATURE_MINIMUM_SAMPLE_INTERVAL_MS = 5_000;

export interface HostTemperatureTelemetrySamplerShape {
  readonly sample: () => Promise<ServerSystemTemperatureTelemetry>;
}

export interface HostTemperatureTelemetryClock {
  readonly nowMonotonicMillis: () => number;
}

/**
 * One host-global cache prevents a one-second project panel poll from launching
 * WMI/sysfs work continuously. Expired failures replace prior data: a vanished
 * sensor cannot remain displayed indefinitely as if it were current.
 */
export function makeHostTemperatureTelemetrySampler(
  probe: Pick<HostTemperatureProbeProcessShape, "read">,
  clock: HostTemperatureTelemetryClock = {
    nowMonotonicMillis: performance.now.bind(performance),
  },
): HostTemperatureTelemetrySamplerShape {
  let cachedAtMonotonicMs = Number.NEGATIVE_INFINITY;
  let cached = unavailableTemperatureTelemetry("unsupported");
  let inFlight: Promise<ServerSystemTemperatureTelemetry> | null = null;

  const readClock = () => {
    try {
      const value = clock.nowMonotonicMillis();
      return Number.isFinite(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  };

  const sample = (): Promise<ServerSystemTemperatureTelemetry> => {
    const requestedAt = readClock();
    if (requestedAt === null) {
      return Promise.resolve(unavailableTemperatureTelemetry("stale"));
    }
    if (requestedAt < cachedAtMonotonicMs) {
      cached = unavailableTemperatureTelemetry("stale");
      cachedAtMonotonicMs = requestedAt;
      return Promise.resolve(cached);
    }
    if (requestedAt - cachedAtMonotonicMs < HOST_TEMPERATURE_MINIMUM_SAMPLE_INTERVAL_MS) {
      return Promise.resolve(cached);
    }
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(() => probe.read())
      .catch(() => unavailableTemperatureTelemetry("probe-failed"))
      .then((next) => {
        cached = next;
        cachedAtMonotonicMs = readClock() ?? requestedAt;
        return next;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return { sample };
}
