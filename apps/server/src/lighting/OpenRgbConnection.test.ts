import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  connectHangs: false,
  writeHangs: false,
  writeThrows: false,
  sockets: [] as Array<{ destroyed: boolean; emit: (name: string, value?: unknown) => boolean }>,
}));

vi.mock("node:net", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    Socket: class extends EventEmitter {
      destroyed = false;
      constructor() {
        super();
        harness.sockets.push(this);
      }
      connect(_port: number, _host: string, callback: () => void) {
        if (!harness.connectHangs) callback();
        return this;
      }
      setTimeout() {
        return this;
      }
      write(_bytes: Buffer, callback: (error?: Error) => void) {
        if (harness.writeThrows) throw new Error("Fixture write failed");
        if (!harness.writeHangs) callback();
        return true;
      }
      destroy(error?: Error) {
        if (this.destroyed) return this;
        this.destroyed = true;
        if (error) this.emit("error", error);
        this.emit("close");
        return this;
      }
    },
  };
});

import { OpenRgbConnection } from "./OpenRgbHardwareLightingAdapter.ts";

describe("OpenRGB owned connection deadlines", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    harness.connectHangs = false;
    harness.writeHangs = false;
    harness.writeThrows = false;
    harness.sockets.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("retires a stalled write even after the idle timeout is disabled", async () => {
    const connection = new OpenRgbConnection(6742, 50);
    await connection.connect();
    connection.disableIdleTimeout();
    harness.writeHangs = true;
    const result = connection.send(0, 1050).then(
      () => "unexpected success",
      () => "refused",
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe("refused");
    expect(harness.sockets[0]?.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not extend a response deadline when incomplete bytes arrive", async () => {
    const connection = new OpenRgbConnection(6742, 50);
    await connection.connect();
    const result = connection.request(0, 40).then(
      () => "unexpected success",
      () => "refused",
    );
    for (let index = 0; index < 4; index += 1) {
      await vi.advanceTimersByTimeAsync(10);
      harness.sockets[0]!.emit("data", Buffer.from("O"));
    }
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toBe("refused");
    expect(harness.sockets[0]?.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles a connection attempt when its owner closes it", async () => {
    harness.connectHangs = true;
    const connection = new OpenRgbConnection(6742, 50);
    const result = connection.connect().then(
      () => "unexpected success",
      () => "refused",
    );
    connection.close();
    expect(await result).toBe("refused");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles both request branches when writing fails synchronously", async () => {
    const connection = new OpenRgbConnection(6742, 50);
    await connection.connect();
    harness.writeThrows = true;
    await expect(connection.request(0, 40)).rejects.toThrow("Fixture write failed");
    expect(harness.sockets[0]?.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
