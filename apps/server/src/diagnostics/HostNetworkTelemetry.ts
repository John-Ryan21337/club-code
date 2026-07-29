import { performance } from "node:perf_hooks";

import type { ServerSystemNetworkTelemetry } from "@cafecode/contracts";

/**
 * Windows needs a protected PowerShell + NetAdapter module startup. Keeping
 * the aggregate host sample for 15 seconds prevents a visible monitor from
 * spending a material share of its time starting recurring probe processes.
 */
export const HOST_NETWORK_TELEMETRY_MINIMUM_SAMPLE_INTERVAL_MS = 15_000;

const NETWORK_WARMING_DETAIL = "Waiting for a second network sample.";
const NETWORK_UNAVAILABLE_DETAIL = "Network throughput telemetry is unavailable.";

export interface HostNetworkCounters {
  readonly receivedBytes: number;
  readonly transmittedBytes: number;
}

export interface HostNetworkCounterReaderShape {
  /**
   * Return aggregate host byte counters. Implementations must not expose
   * interface names, addresses, peers, ports, or traffic contents.
   */
  readonly read: () => Promise<HostNetworkCounters | null>;
}

export interface ClosableHostNetworkCounterReaderShape extends HostNetworkCounterReaderShape {
  readonly close: () => Promise<void>;
}

export interface HostNetworkTelemetrySamplerShape {
  readonly sample: () => Promise<ServerSystemNetworkTelemetry>;
}

export interface HostNetworkTelemetryClock {
  readonly nowMonotonicMillis: () => number;
}

interface CounterBaseline {
  readonly sampledAtMonotonicMs: number;
  readonly counters: HostNetworkCounters;
}

function validCounters(value: HostNetworkCounters | null): value is HostNetworkCounters {
  return (
    value !== null &&
    Number.isSafeInteger(value.receivedBytes) &&
    value.receivedBytes >= 0 &&
    Number.isSafeInteger(value.transmittedBytes) &&
    value.transmittedBytes >= 0
  );
}

function warmingNetworkTelemetry(): ServerSystemNetworkTelemetry {
  return {
    status: "warming",
    receiveBytesPerSecond: null,
    transmitBytesPerSecond: null,
    detail: NETWORK_WARMING_DETAIL,
  };
}

export function unavailableNetworkTelemetry(): ServerSystemNetworkTelemetry {
  return {
    status: "unavailable",
    receiveBytesPerSecond: null,
    transmitBytesPerSecond: null,
    detail: NETWORK_UNAVAILABLE_DETAIL,
  };
}

function boundedRate(deltaBytes: number, elapsedMs: number): number | null {
  if (
    !Number.isSafeInteger(deltaBytes) ||
    deltaBytes < 0 ||
    !Number.isFinite(elapsedMs) ||
    elapsedMs <= 0
  ) {
    return null;
  }
  const rate = Math.round((deltaBytes * 1_000) / elapsedMs);
  return Number.isSafeInteger(rate) && rate >= 0 ? rate : null;
}

/**
 * Convert monotonically increasing aggregate counters into bounded rates.
 *
 * Reads are globally coalesced and cached for the exported minimum interval.
 * This matters because
 * several project windows can request the same host sample concurrently; one
 * selected project must not multiply OS probes.
 */
export function makeHostNetworkTelemetrySampler(
  reader: HostNetworkCounterReaderShape,
  clock: HostNetworkTelemetryClock = {
    nowMonotonicMillis: performance.now.bind(performance),
  },
): HostNetworkTelemetrySamplerShape {
  let baseline: CounterBaseline | null = null;
  let cachedAtMonotonicMs = Number.NEGATIVE_INFINITY;
  let cached: ServerSystemNetworkTelemetry = warmingNetworkTelemetry();
  let inFlight: Promise<ServerSystemNetworkTelemetry> | null = null;

  const readClock = (): number | null => {
    try {
      const value = clock.nowMonotonicMillis();
      return Number.isFinite(value) && value >= 0 ? value : null;
    } catch {
      return null;
    }
  };

  const sample = (): Promise<ServerSystemNetworkTelemetry> => {
    const requestedAtMonotonicMs = readClock();
    if (requestedAtMonotonicMs === null) {
      baseline = null;
      cached = unavailableNetworkTelemetry();
      return Promise.resolve(cached);
    }
    if (
      requestedAtMonotonicMs >= cachedAtMonotonicMs &&
      requestedAtMonotonicMs - cachedAtMonotonicMs <
        HOST_NETWORK_TELEMETRY_MINIMUM_SAMPLE_INTERVAL_MS
    ) {
      return Promise.resolve(cached);
    }
    if (inFlight) return inFlight;

    inFlight = Promise.resolve()
      .then(() => reader.read())
      .then(
        (nextCounters): ServerSystemNetworkTelemetry => {
          const observedAtMonotonicMs = readClock();
          if (!validCounters(nextCounters)) {
            baseline = null;
            return unavailableNetworkTelemetry();
          }
          if (observedAtMonotonicMs === null) {
            baseline = null;
            return unavailableNetworkTelemetry();
          }

          const previous = baseline;
          baseline = {
            sampledAtMonotonicMs: observedAtMonotonicMs,
            counters: nextCounters,
          };
          if (
            previous === null ||
            observedAtMonotonicMs <= previous.sampledAtMonotonicMs ||
            nextCounters.receivedBytes < previous.counters.receivedBytes ||
            nextCounters.transmittedBytes < previous.counters.transmittedBytes
          ) {
            return warmingNetworkTelemetry();
          }

          const elapsedMs = observedAtMonotonicMs - previous.sampledAtMonotonicMs;
          const receiveBytesPerSecond = boundedRate(
            nextCounters.receivedBytes - previous.counters.receivedBytes,
            elapsedMs,
          );
          const transmitBytesPerSecond = boundedRate(
            nextCounters.transmittedBytes - previous.counters.transmittedBytes,
            elapsedMs,
          );
          if (receiveBytesPerSecond === null || transmitBytesPerSecond === null) {
            return unavailableNetworkTelemetry();
          }
          return {
            status: "available",
            receiveBytesPerSecond,
            transmitBytesPerSecond,
            detail: null,
          };
        },
        (): ServerSystemNetworkTelemetry => {
          baseline = null;
          return unavailableNetworkTelemetry();
        },
      )
      .then((metric) => {
        cachedAtMonotonicMs = readClock() ?? requestedAtMonotonicMs;
        cached = metric;
        return metric;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return { sample };
}
