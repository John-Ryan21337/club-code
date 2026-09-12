import {
  EnvironmentId,
  type HardwareLightingFrameInput,
  type HardwareLightingStatus,
} from "@cafecode/contracts";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@cafecode/contracts/settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { matrixColorFrameStore } from "../matrixColorFrameStore";
import { HardwareLightingMatrixSync } from "./HardwareLightingMatrixSync";

const fixture = vi.hoisted(() => ({
  settings: null as UnifiedSettings | null,
  environmentId: null as EnvironmentId | null,
  connection: null as {
    client: {
      server: {
        applyHardwareLightingFrame: ReturnType<
          typeof vi.fn<(input: HardwareLightingFrameInput) => Promise<HardwareLightingStatus>>
        >;
      };
    };
  } | null,
  listeners: new Set<() => void>(),
}));
vi.mock("../hooks/useSettings", () => ({
  useSettings: <T,>(selector: (settings: UnifiedSettings) => T) =>
    selector(fixture.settings ?? DEFAULT_UNIFIED_SETTINGS),
}));
vi.mock("../environments/primary", () => ({
  usePrimaryEnvironmentId: () => fixture.environmentId,
}));
vi.mock("../environments/runtime", () => ({
  readEnvironmentConnection: () => fixture.connection,
  subscribeEnvironmentConnections: (listener: () => void) => {
    fixture.listeners.add(listener);
    return () => fixture.listeners.delete(listener);
  },
}));
vi.mock("../rpc/serverState", () => ({
  useServerConfig: () => ({ ambientExperienceCapabilities: { atmosphere: true } }),
}));

const result: HardwareLightingStatus = {
  state: "active",
  adapter: "OpenRGB SDK (loopback)",
  detail: "Synthetic adapter",
  protocolVersion: 5,
  controllers: [],
  selectedControllerCount: 0,
  lastFrameAt: null,
  lastDisposition: "applied",
};
const frame = (color: string) => ({
  color,
  perStream: false,
  baseHue: null,
  saturation: null,
  lightness: null,
});
let paletteOwner: object;
let priorBridge: PropertyDescriptor | undefined;

function connection() {
  return {
    client: {
      server: {
        applyHardwareLightingFrame: vi
          .fn<(input: HardwareLightingFrameInput) => Promise<HardwareLightingStatus>>()
          .mockResolvedValue(result),
      },
    },
  };
}

describe("HardwareLightingMatrixSync", () => {
  beforeEach(() => {
    priorBridge = Object.getOwnPropertyDescriptor(window, "desktopBridge");
    Object.defineProperty(window, "desktopBridge", { configurable: true, value: {} });
    fixture.environmentId = EnvironmentId.make("lighting-primary");
    fixture.connection = connection();
    fixture.settings = {
      ...DEFAULT_UNIFIED_SETTINGS,
      hardwareLightingSyncEnabled: true,
      hardwareLightingControllerIds: ["a".repeat(16)],
      fallingEffectsEnabled: true,
      fallingEffectKind: "matrix",
    };
    paletteOwner = {};
    matrixColorFrameStore.claim(paletteOwner);
    matrixColorFrameStore.publish(paletteOwner, frame("#123456"), "frozen");
  });
  afterEach(() => {
    matrixColorFrameStore.release(paletteOwner);
    if (priorBridge) Object.defineProperty(window, "desktopBridge", priorBridge);
    else Reflect.deleteProperty(window, "desktopBridge");
  });

  it("does not publish from an ordinary browser", async () => {
    Reflect.deleteProperty(window, "desktopBridge");
    const screen = await render(<HardwareLightingMatrixSync />);
    matrixColorFrameStore.publish(paletteOwner, frame("#abcdef"), "animated");
    await screen.unmount();
    expect(fixture.connection!.client.server.applyHardwareLightingFrame).not.toHaveBeenCalled();
  });

  it("keeps one frame in flight and sends only the newest waiting palette", async () => {
    const apply = fixture.connection!.client.server.applyHardwareLightingFrame;
    let resolve!: (value: HardwareLightingStatus) => void;
    apply.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const screen = await render(<HardwareLightingMatrixSync />);
    await expect.poll(() => apply.mock.calls.length).toBe(1);
    for (let i = 0; i < 30; i += 1)
      matrixColorFrameStore.publish(
        paletteOwner,
        frame(`#${i.toString(16).padStart(6, "0")}`),
        "animated",
      );
    await new Promise((done) => setTimeout(done, 80));
    expect(apply).toHaveBeenCalledTimes(1);
    resolve(result);
    await expect.poll(() => apply.mock.calls.length).toBe(2);
    expect(apply.mock.calls[1]![0].colors).toEqual([{ red: 0, green: 0, blue: 29 }]);
    await screen.unmount();
    expect(apply.mock.lastCall![0]).toMatchObject({ active: false, colors: [] });
  });

  it("keeps a frozen palette leased and drops an old connection's pending completion", async () => {
    const oldApply = fixture.connection!.client.server.applyHardwareLightingFrame;
    const screen = await render(<HardwareLightingMatrixSync />);
    await expect
      .poll(() => oldApply.mock.calls.length, { timeout: 2_000 })
      .toBeGreaterThanOrEqual(2);
    expect(oldApply.mock.calls[1]![0].colors).toEqual([{ red: 18, green: 52, blue: 86 }]);
    let resolve!: (value: HardwareLightingStatus) => void;
    oldApply.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    matrixColorFrameStore.publish(paletteOwner, frame("#445566"), "animated");
    await expect.poll(() => oldApply.mock.calls.length).toBe(3);
    matrixColorFrameStore.publish(paletteOwner, frame("#778899"), "animated");
    fixture.connection = connection();
    const nextApply = fixture.connection.client.server.applyHardwareLightingFrame;
    for (const notify of fixture.listeners) notify();
    await expect.poll(() => nextApply.mock.calls.length).toBe(1);
    resolve(result);
    await new Promise((done) => setTimeout(done, 80));
    expect(oldApply).toHaveBeenCalledTimes(3);
    expect(nextApply).toHaveBeenCalledTimes(1);
    expect(nextApply.mock.calls[0]![0].colors).toEqual([{ red: 119, green: 136, blue: 153 }]);
    await screen.unmount();
  });
});
