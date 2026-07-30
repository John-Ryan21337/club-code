import { performance } from "node:perf_hooks";

export const MAX_HARDWARE_LIGHTING_COLORS = 4_096;
export const HARDWARE_LIGHTING_MINIMUM_FRAME_INTERVAL_MS = 50;

export interface HardwareLightingColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

export interface HardwareLightingFrame {
  readonly sequence: number;
  readonly colors: ReadonlyArray<HardwareLightingColor>;
}

export interface HardwareLightingAdapterStatus {
  readonly status: "available" | "unavailable";
  /**
   * Fixed adapter-owned prose only. Device paths, serial numbers, raw protocol
   * payloads, and vendor-tool output must not cross this boundary.
   */
  readonly detail: string;
}

export interface HardwareLightingAdapter {
  readonly probe: () => Promise<HardwareLightingAdapterStatus>;
  readonly applyFrame: (frame: HardwareLightingFrame) => Promise<void>;
  readonly close: () => Promise<void>;
}

export interface HardwareLightingSyncClock {
  readonly nowMonotonicMillis: () => number;
}

export type HardwareLightingFrameDisposition =
  | "applied"
  | "disabled"
  | "invalid"
  | "rate-limited"
  | "busy"
  | "adapter-error";

export interface HardwareLightingSyncController {
  readonly probe: () => Promise<HardwareLightingAdapterStatus>;
  readonly applyFrame: (frame: HardwareLightingFrame) => Promise<HardwareLightingFrameDisposition>;
  readonly close: () => Promise<void>;
}

interface HardwareLightingSyncOptions {
  readonly enabled?: boolean;
  readonly adapter: HardwareLightingAdapter;
  readonly clock?: HardwareLightingSyncClock;
  readonly minimumFrameIntervalMs?: number;
}

const DISABLED_STATUS: HardwareLightingAdapterStatus = {
  status: "unavailable",
  detail: "Hardware lighting sync is off. Club Code will not access lighting devices.",
};

function validColorChannel(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 255;
}

function validFrame(frame: HardwareLightingFrame): boolean {
  return (
    Number.isSafeInteger(frame.sequence) &&
    frame.sequence >= 0 &&
    frame.colors.length > 0 &&
    frame.colors.length <= MAX_HARDWARE_LIGHTING_COLORS &&
    frame.colors.every(
      (color) =>
        validColorChannel(color.red) &&
        validColorChannel(color.green) &&
        validColorChannel(color.blue),
    )
  );
}

function boundedFrameInterval(value: number | undefined): number {
  return value !== undefined &&
    Number.isSafeInteger(value) &&
    value >= HARDWARE_LIGHTING_MINIMUM_FRAME_INTERVAL_MS &&
    value <= 10_000
    ? value
    : HARDWARE_LIGHTING_MINIMUM_FRAME_INTERVAL_MS;
}

/**
 * A provider-neutral safety boundary for future OpenRGB-style adapters.
 *
 * The controller is inert unless the operator-facing caller explicitly opts
 * in. It does not discover or execute vendor software, scan PATH/registry
 * locations, open a network socket, or infer device support. Concrete
 * adapters must be supplied by a separately reviewed integration.
 */
export function makeHardwareLightingSyncController(
  options: HardwareLightingSyncOptions,
): HardwareLightingSyncController {
  const enabled = options.enabled === true;
  const clock = options.clock ?? { nowMonotonicMillis: () => performance.now() };
  const minimumFrameIntervalMs = boundedFrameInterval(options.minimumFrameIntervalMs);
  let lastAppliedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;
  let closed = false;

  const probe = async (): Promise<HardwareLightingAdapterStatus> => {
    if (!enabled || closed) return DISABLED_STATUS;
    try {
      const status = await options.adapter.probe();
      return status.status === "available"
        ? {
            status: "available",
            detail: "The selected hardware lighting adapter is available.",
          }
        : {
            status: "unavailable",
            detail: "The selected hardware lighting adapter is unavailable.",
          };
    } catch {
      return {
        status: "unavailable",
        detail: "The selected hardware lighting adapter did not complete its capability check.",
      };
    }
  };

  const applyFrame = async (
    frame: HardwareLightingFrame,
  ): Promise<HardwareLightingFrameDisposition> => {
    if (!enabled || closed) return "disabled";
    if (!validFrame(frame)) return "invalid";
    if (inFlight !== null) return "busy";
    let now: number;
    try {
      now = clock.nowMonotonicMillis();
    } catch {
      return "adapter-error";
    }
    if (!Number.isFinite(now) || now < 0) return "adapter-error";
    if (now - lastAppliedAt < minimumFrameIntervalMs) return "rate-limited";

    const boundedFrame = {
      sequence: frame.sequence,
      colors: frame.colors.map(({ red, green, blue }) => ({ red, green, blue })),
    };
    const write = Promise.resolve().then(() => options.adapter.applyFrame(boundedFrame));
    inFlight = write;
    try {
      await write;
      lastAppliedAt = now;
      return "applied";
    } catch {
      return "adapter-error";
    } finally {
      if (inFlight === write) inFlight = null;
    }
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (!enabled) return;
    if (inFlight !== null) {
      try {
        await inFlight;
      } catch {
        // A failed write is already contained by applyFrame.
      }
    }
    try {
      await options.adapter.close();
    } catch {
      // Adapter cleanup is best effort and cannot reactivate the controller.
    }
  };

  return { probe, applyFrame, close };
}
