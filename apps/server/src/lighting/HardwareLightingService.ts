import type {
  ClientSettings,
  HardwareLightingFrameInput,
  HardwareLightingStatus,
} from "@cafecode/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  makeHardwareLightingSyncController,
  type HardwareLightingFrameDisposition,
} from "./HardwareLightingSync.ts";
import { OpenRgbHardwareLightingAdapter } from "./OpenRgbHardwareLightingAdapter.ts";

export const HARDWARE_LIGHTING_OPERATION_TIMEOUT_MS = 5_000;
export const HARDWARE_LIGHTING_LEASE_MS = 3_000;
type LightingAdapter = Pick<
  OpenRgbHardwareLightingAdapter,
  "configure" | "snapshot" | "refresh" | "probe" | "applyFrame" | "restore" | "close" | "abort"
>;

function isMatrixActive(settings: ClientSettings): boolean {
  return (
    settings.hardwareLightingSyncEnabled &&
    settings.fallingEffectsEnabled &&
    settings.fallingEffectKind === "matrix" &&
    settings.hardwareLightingControllerIds.length > 0
  );
}

function configurationKey(settings: ClientSettings): string {
  return JSON.stringify([
    settings.hardwareLightingControllerIds,
    settings.hardwareLightingBrightness,
    settings.hardwareLightingRestoreOnDisable,
  ]);
}

/** One owned operation, no request queue, and at most one pending stop. */
export class HardwareLightingManager {
  private readonly adapter: LightingAdapter;
  private readonly controller: ReturnType<typeof makeHardwareLightingSyncController>;
  private readonly timeoutMs: number;
  private readonly leaseMs: number;
  private current: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private settings: ClientSettings | null = null;
  private active = false;
  private closed = false;
  private generation = 0;
  private pendingStop = false;
  private configuredKey = "";
  private lease: ReturnType<typeof setTimeout> | null = null;
  private lastFrameAt: string | null = null;
  private lastDisposition: HardwareLightingFrameDisposition | null = null;

  constructor(options: { adapter?: LightingAdapter; timeoutMs?: number; leaseMs?: number } = {}) {
    this.adapter = options.adapter ?? new OpenRgbHardwareLightingAdapter();
    this.timeoutMs = options.timeoutMs ?? HARDWARE_LIGHTING_OPERATION_TIMEOUT_MS;
    this.leaseMs = options.leaseMs ?? HARDWARE_LIGHTING_LEASE_MS;
    this.controller = makeHardwareLightingSyncController({ enabled: true, adapter: this.adapter });
  }

  private clearLease(): void {
    if (this.lease !== null) clearTimeout(this.lease);
    this.lease = null;
  }

  private renewLease(): void {
    this.clearLease();
    this.lease = setTimeout(() => {
      this.lease = null;
      this.requestStop();
    }, this.leaseMs);
    this.lease.unref?.();
  }

  private status(settings: ClientSettings): HardwareLightingStatus {
    const snapshot = this.adapter.snapshot();
    const state =
      !settings.hardwareLightingSyncEnabled || this.closed
        ? "disabled"
        : this.active
          ? "active"
          : this.lastDisposition === "adapter-error"
            ? "error"
            : snapshot.available
              ? "available"
              : "unavailable";
    return {
      state,
      adapter: "OpenRGB SDK (loopback)",
      detail: this.pendingStop
        ? "A lighting stop is pending while the owned operation settles."
        : state === "disabled"
          ? "Hardware lighting sync is off. Restoration is best effort."
          : snapshot.detail,
      protocolVersion: snapshot.protocolVersion,
      controllers: snapshot.controllers,
      selectedControllerCount: snapshot.controllers.filter(
        (controller) =>
          controller.supported && settings.hardwareLightingControllerIds.includes(controller.id),
      ).length,
      lastFrameAt: this.lastFrameAt,
      lastDisposition: this.lastDisposition,
    };
  }

  private observeSettings(settings: ClientSettings): void {
    this.settings = settings;
    if (
      this.current !== null &&
      (!isMatrixActive(settings) ||
        (this.configuredKey !== "" && this.configuredKey !== configurationKey(settings)))
    ) {
      this.pendingStop = true;
    }
  }

  private async stopUnlocked(): Promise<void> {
    this.clearLease();
    this.active = false;
    await this.adapter.restore();
  }

  private async configure(
    settings: ClientSettings,
    valid: () => boolean,
    stopForChange = true,
  ): Promise<void> {
    const key = configurationKey(settings);
    const changed = this.active && key !== this.configuredKey;
    if (!valid()) return;
    this.configuredKey = key;
    this.adapter.configure({
      selectedIds: settings.hardwareLightingControllerIds,
      brightness: settings.hardwareLightingBrightness,
      restoreOnDisable: settings.hardwareLightingRestoreOnDisable,
    });
    if (changed && stopForChange) await this.stopUnlocked();
  }

  private requestStop(): void {
    if (this.closed || this.settings === null) return;
    if (this.current !== null) {
      this.pendingStop = true;
      return;
    }
    this.pendingStop = false;
    const settings = this.settings;
    void this.run(settings, async (valid) => {
      await this.configure(settings, valid, false);
      if (valid()) await this.stopUnlocked();
    });
  }

  private async run(
    settings: ClientSettings,
    operation: (valid: () => boolean) => Promise<void>,
    recoverOnError = false,
  ): Promise<HardwareLightingStatus> {
    if (this.closed) return this.status(settings);
    if (this.current !== null) {
      this.lastDisposition = "busy";
      return this.status(settings);
    }
    const generation = ++this.generation;
    const valid = () => !this.closed && this.generation === generation;
    const failed = () => {
      this.lastDisposition = "adapter-error";
      this.active = false;
      this.clearLease();
      this.adapter.abort();
      if (recoverOnError) this.pendingStop = true;
    };
    const work = Promise.resolve()
      .then(() => operation(valid))
      .catch(() => {
        if (valid()) failed();
      })
      .finally(() => {
        if (this.current === work) this.current = null;
        if (this.pendingStop && !this.closed) this.requestStop();
      });
    this.current = work;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        if (valid()) {
          this.generation += 1;
          failed();
        }
        resolve();
      }, this.timeoutMs);
      timer.unref?.();
    });
    try {
      await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
    }
    // A timed-out operation retains the slot until its actual promise settles.
    return this.status(settings);
  }

  async getStatus(settings: ClientSettings): Promise<HardwareLightingStatus> {
    this.observeSettings(settings);
    if (!isMatrixActive(settings) && this.active) this.requestStop();
    return this.status(settings);
  }

  async refresh(settings: ClientSettings): Promise<HardwareLightingStatus> {
    this.observeSettings(settings);
    return this.run(settings, async (valid) => {
      await this.configure(settings, valid);
      if (!valid()) return;
      if (!isMatrixActive(settings)) await this.stopUnlocked();
      if (valid()) await this.adapter.refresh();
    });
  }

  async reconcile(settings: ClientSettings): Promise<HardwareLightingStatus> {
    this.observeSettings(settings);
    return this.run(settings, async (valid) => {
      await this.configure(settings, valid);
      if (valid() && !isMatrixActive(settings)) await this.stopUnlocked();
    });
  }

  async apply(
    settings: ClientSettings,
    input: HardwareLightingFrameInput,
  ): Promise<HardwareLightingStatus> {
    this.observeSettings(settings);
    if (!input.active) {
      this.requestStop();
      return this.status(settings);
    }
    return this.run(
      settings,
      async (valid) => {
        await this.configure(settings, valid);
        if (!valid()) return;
        if (!isMatrixActive(settings)) {
          this.lastDisposition = "disabled";
          await this.stopUnlocked();
          return;
        }
        const disposition = await this.controller.applyFrame({
          sequence: input.sequence,
          colors: input.colors,
        });
        if (!valid()) return;
        this.lastDisposition = disposition;
        if (disposition === "applied") {
          this.active = true;
          this.lastFrameAt = new Date().toISOString();
          this.renewLease();
        } else if (disposition === "adapter-error") {
          this.active = false;
          this.clearLease();
          this.pendingStop = true;
        }
      },
      true,
    );
  }

  close(): Promise<void> {
    if (this.closing !== null) return this.closing;
    this.closed = true;
    this.generation += 1;
    this.pendingStop = false;
    this.clearLease();
    this.adapter.abort();
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = Promise.resolve(this.current)
      .then(async () => {
        if (!expired) await this.adapter.close();
      })
      .catch(() => this.adapter.abort());
    this.closing = Promise.race([
      cleanup,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          this.adapter.abort();
          resolve();
        }, this.timeoutMs);
        timer.unref?.();
      }),
    ]).finally(() => clearTimeout(timer));
    return this.closing;
  }
}

export interface HardwareLightingServiceShape {
  readonly getStatus: (settings: ClientSettings) => Effect.Effect<HardwareLightingStatus>;
  readonly refresh: (settings: ClientSettings) => Effect.Effect<HardwareLightingStatus>;
  readonly reconcile: (settings: ClientSettings) => Effect.Effect<HardwareLightingStatus>;
  readonly applyFrame: (
    settings: ClientSettings,
    input: HardwareLightingFrameInput,
  ) => Effect.Effect<HardwareLightingStatus>;
}

export class HardwareLightingService extends Context.Service<
  HardwareLightingService,
  HardwareLightingServiceShape
>()("cafecode/lighting/HardwareLightingService") {}

export const HardwareLightingServiceLive = Layer.effect(
  HardwareLightingService,
  Effect.acquireRelease(
    Effect.sync(() => new HardwareLightingManager()),
    (manager) => Effect.promise(() => manager.close()),
  ).pipe(
    Effect.map((manager) => ({
      getStatus: (settings: ClientSettings) => Effect.promise(() => manager.getStatus(settings)),
      refresh: (settings: ClientSettings) => Effect.promise(() => manager.refresh(settings)),
      reconcile: (settings: ClientSettings) => Effect.promise(() => manager.reconcile(settings)),
      applyFrame: (settings: ClientSettings, input: HardwareLightingFrameInput) =>
        Effect.promise(() => manager.apply(settings, input)),
    })),
  ),
);
