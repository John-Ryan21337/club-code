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

const HARDWARE_LIGHTING_LEASE_MS = 3_000;

function isMatrixActive(settings: ClientSettings): boolean {
  return (
    settings.hardwareLightingSyncEnabled &&
    settings.fallingEffectsEnabled &&
    settings.fallingEffectKind === "matrix"
  );
}

class HardwareLightingManager {
  private readonly adapter = new OpenRgbHardwareLightingAdapter();
  private readonly controller = makeHardwareLightingSyncController({
    enabled: true,
    adapter: this.adapter,
  });
  private active = false;
  private lastFrameAt: string | null = null;
  private lastDisposition: HardwareLightingFrameDisposition | null = null;
  private lease: ReturnType<typeof setTimeout> | null = null;
  private configurationKey = "";
  private operationTail: Promise<void> = Promise.resolve();

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async configure(settings: ClientSettings): Promise<void> {
    const key = JSON.stringify([
      settings.hardwareLightingControllerIds,
      settings.hardwareLightingBrightness,
      settings.hardwareLightingRestoreOnDisable,
    ]);
    if (this.configurationKey !== "" && this.configurationKey !== key && this.active) {
      await this.stopUnlocked();
    }
    this.configurationKey = key;
    this.adapter.configure({
      selectedIds: settings.hardwareLightingControllerIds,
      brightness: settings.hardwareLightingBrightness,
      restoreOnDisable: settings.hardwareLightingRestoreOnDisable,
    });
  }

  private clearLease(): void {
    if (this.lease !== null) clearTimeout(this.lease);
    this.lease = null;
  }

  private renewLease(): void {
    this.clearLease();
    this.lease = setTimeout(() => {
      void this.serialize(() => this.stopUnlocked());
    }, HARDWARE_LIGHTING_LEASE_MS);
    this.lease.unref?.();
  }

  private status(settings: ClientSettings): HardwareLightingStatus {
    const snapshot = this.adapter.snapshot();
    const selectedControllerCount = snapshot.controllers.filter(
      (controller) =>
        controller.supported && settings.hardwareLightingControllerIds.includes(controller.id),
    ).length;
    const state = !settings.hardwareLightingSyncEnabled
      ? "disabled"
      : this.active
        ? "active"
        : snapshot.available
          ? "available"
          : this.lastDisposition === "adapter-error"
            ? "error"
            : "unavailable";
    return {
      state,
      adapter: "OpenRGB SDK (loopback)",
      detail:
        state === "disabled"
          ? "Hardware lighting sync is off. Club Code will not write to lighting devices."
          : snapshot.detail,
      protocolVersion: snapshot.protocolVersion,
      controllers: snapshot.controllers,
      selectedControllerCount,
      lastFrameAt: this.lastFrameAt,
      lastDisposition: this.lastDisposition,
    };
  }

  async getStatus(settings: ClientSettings): Promise<HardwareLightingStatus> {
    return this.serialize(async () => {
      await this.configure(settings);
      if (!isMatrixActive(settings) && this.active) await this.stopUnlocked();
      return this.status(settings);
    });
  }

  async refresh(settings: ClientSettings): Promise<HardwareLightingStatus> {
    return this.serialize(async () => {
      await this.configure(settings);
      if (!isMatrixActive(settings) && this.active) await this.stopUnlocked();
      await this.adapter.refresh();
      return this.status(settings);
    });
  }

  async reconcile(settings: ClientSettings): Promise<HardwareLightingStatus> {
    return this.serialize(async () => {
      await this.configure(settings);
      if (!isMatrixActive(settings)) await this.stopUnlocked();
      return this.status(settings);
    });
  }

  async apply(
    settings: ClientSettings,
    input: HardwareLightingFrameInput,
  ): Promise<HardwareLightingStatus> {
    return this.serialize(async () => {
      await this.configure(settings);
      if (!isMatrixActive(settings) || !input.active) {
        this.lastDisposition = "disabled";
        await this.stopUnlocked();
        return this.status(settings);
      }
      if (settings.hardwareLightingControllerIds.length === 0 || input.colors.length === 0) {
        this.lastDisposition = "invalid";
        return this.status(settings);
      }
      const disposition = await this.controller.applyFrame({
        sequence: input.sequence,
        colors: input.colors,
      });
      this.lastDisposition = disposition;
      if (disposition === "applied") {
        this.active = true;
        this.lastFrameAt = new Date().toISOString();
        this.renewLease();
      }
      return this.status(settings);
    });
  }

  private async stopUnlocked(): Promise<void> {
    this.clearLease();
    try {
      if (this.active) await this.adapter.restore();
    } catch {
      this.lastDisposition = "adapter-error";
    } finally {
      this.active = false;
    }
  }

  async close(): Promise<void> {
    await this.serialize(async () => {
      this.clearLease();
      await this.controller.close();
      this.active = false;
    });
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
