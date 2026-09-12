import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@cafecode/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HardwareLightingManager } from "./HardwareLightingService.ts";

const settings: ClientSettings = {
  ...DEFAULT_CLIENT_SETTINGS,
  hardwareLightingSyncEnabled: true,
  hardwareLightingControllerIds: ["a".repeat(32)],
  fallingEffectsEnabled: true,
  fallingEffectKind: "matrix",
};
const frame = { active: true, sequence: 1, colors: [{ red: 1, green: 2, blue: 3 }] };
function adapter() {
  return {
    configure: vi.fn(),
    snapshot: vi.fn(() => ({
      available: true,
      detail: "Synthetic adapter",
      protocolVersion: 5,
      controllers: [
        {
          id: "a".repeat(32),
          name: "Fixture",
          vendor: "Fixture",
          type: "keyboard" as const,
          ledCount: 1,
          supported: true,
        },
      ],
    })),
    refresh: vi.fn(async () => ({
      available: true,
      detail: "Synthetic adapter",
      protocolVersion: 5,
      controllers: [],
    })),
    probe: vi.fn(async () => ({ status: "available" as const, detail: "Synthetic adapter" })),
    applyFrame: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    abort: vi.fn(),
  };
}

describe("HardwareLightingManager ownership", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not probe or write until an explicit operation and restores an expired frame lease", async () => {
    const fake = adapter();
    const manager = new HardwareLightingManager({ adapter: fake, leaseMs: 30 });
    await manager.getStatus(DEFAULT_CLIENT_SETTINGS);
    expect(fake.refresh).not.toHaveBeenCalled();
    expect(fake.applyFrame).not.toHaveBeenCalled();
    expect((await manager.apply(settings, frame)).state).toBe("active");
    await vi.advanceTimersByTimeAsync(30);
    expect(fake.restore).toHaveBeenCalledTimes(1);
    expect((await manager.getStatus(settings)).state).toBe("available");
    await manager.close();
  });

  it("rejects concurrent operations and keeps a timed-out slot until the owned work settles", async () => {
    const fake = adapter();
    let release!: () => void;
    fake.applyFrame.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const manager = new HardwareLightingManager({ adapter: fake, timeoutMs: 50 });
    const first = manager.apply(settings, frame);
    await vi.advanceTimersByTimeAsync(0);
    expect((await manager.apply(settings, { ...frame, sequence: 2 })).lastDisposition).toBe("busy");
    await vi.advanceTimersByTimeAsync(50);
    expect((await first).state).toBe("error");
    expect(fake.abort).toHaveBeenCalledTimes(1);
    expect((await manager.refresh(settings)).lastDisposition).toBe("busy");
    expect(fake.applyFrame).toHaveBeenCalledTimes(1);
    expect(fake.refresh).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.restore).toHaveBeenCalledTimes(1);
    expect((await manager.getStatus(settings)).state).not.toBe("active");
    await manager.close();
  });

  it("applies the latest restoration preference to a stop deferred behind a frame", async () => {
    const fake = adapter();
    let release!: () => void;
    fake.applyFrame.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const manager = new HardwareLightingManager({ adapter: fake });
    const first = manager.apply(settings, frame);
    await vi.advanceTimersByTimeAsync(0);
    const disabled = {
      ...settings,
      hardwareLightingSyncEnabled: false,
      hardwareLightingRestoreOnDisable: false,
    };
    await manager.reconcile(disabled);
    expect(fake.restore).not.toHaveBeenCalled();
    release();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(fake.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({ restoreOnDisable: false }),
    );
    expect(fake.restore).toHaveBeenCalledTimes(1);
    await manager.close();
  });

  it("does not start cleanup or renew a lease after a bounded shutdown has returned", async () => {
    const fake = adapter();
    let release!: () => void;
    fake.applyFrame.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const manager = new HardwareLightingManager({ adapter: fake, timeoutMs: 50 });
    const first = manager.apply(settings, frame);
    await vi.advanceTimersByTimeAsync(0);
    const closing = manager.close();
    await vi.advanceTimersByTimeAsync(50);
    await closing;
    release();
    await first;
    await vi.advanceTimersByTimeAsync(100);
    expect(fake.close).not.toHaveBeenCalled();
    expect(fake.restore).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect((await manager.apply(settings, frame)).state).toBe("disabled");
  });
});
