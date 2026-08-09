import { createServer, type Server, type Socket } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenRgbHardwareLightingAdapter } from "./OpenRgbHardwareLightingAdapter.ts";

const OPENRGB_MAGIC = 0x4f524742;

function u16(value: number): Buffer {
  const output = Buffer.alloc(2);
  output.writeUInt16LE(value, 0);
  return output;
}

function u32(value: number): Buffer {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value >>> 0, 0);
  return output;
}

function i32(value: number): Buffer {
  const output = Buffer.alloc(4);
  output.writeInt32LE(value | 0, 0);
  return output;
}

function text(value: string): Buffer {
  const body = Buffer.from(value, "utf8");
  return Buffer.concat([u16(body.length + 1), body, Buffer.from([0])]);
}

function mode(): Buffer {
  return Buffer.concat([
    text("Direct"),
    i32(7),
    u32(1 << 5),
    u32(0),
    u32(100),
    u32(0),
    u32(100),
    u32(1),
    u32(4_096),
    u32(50),
    u32(100),
    u32(0),
    u32(0),
    u16(1),
    u32(0x00112233),
  ]);
}

function controllerPayload(): Buffer {
  const body = Buffer.concat([
    i32(5),
    text("Test Keyboard"),
    text("Example Vendor"),
    text("test fixture"),
    text("1.0"),
    text("PRIVATE-SERIAL"),
    text("PRIVATE-PATH"),
    u16(1),
    i32(0),
    mode(),
    u16(0),
    u16(2),
    text("Key A"),
    u32(0),
    text("Key B"),
    u32(1),
    u16(2),
    u32(0x00030201),
    u32(0x00060504),
    u16(2),
    text("A"),
    text("B"),
    u32(0),
  ]);
  return Buffer.concat([u32(body.length + 4), body]);
}

interface ReceivedPacket {
  readonly deviceId: number;
  readonly packetId: number;
  readonly payload: Buffer;
}

function response(deviceId: number, packetId: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(OPENRGB_MAGIC, 0);
  header.writeUInt32LE(deviceId, 4);
  header.writeUInt32LE(packetId, 8);
  header.writeUInt32LE(payload.length, 12);
  return Buffer.concat([header, payload]);
}

async function startFakeOpenRgb(controllerCount = 1): Promise<{
  readonly port: number;
  readonly packets: ReceivedPacket[];
  readonly close: () => Promise<void>;
}> {
  const packets: ReceivedPacket[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffered = Buffer.alloc(0);
    socket.on("data", (data) => {
      buffered = Buffer.concat([buffered, data]);
      while (buffered.length >= 16) {
        const payloadLength = buffered.readUInt32LE(12);
        if (buffered.length < 16 + payloadLength) return;
        const packet = {
          deviceId: buffered.readUInt32LE(4),
          packetId: buffered.readUInt32LE(8),
          payload: Buffer.from(buffered.subarray(16, 16 + payloadLength)),
        };
        packets.push(packet);
        buffered = buffered.subarray(16 + payloadLength);
        if (packet.packetId === 40) socket.write(response(0, 40, u32(5)));
        if (packet.packetId === 0) socket.write(response(0, 0, u32(controllerCount)));
        if (packet.packetId === 1) {
          socket.write(response(packet.deviceId, 1, controllerPayload()));
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture did not bind TCP");
  return {
    port: address.port,
    packets,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const fixtures: Array<{ readonly close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()));
});

describe("OpenRgbHardwareLightingAdapter", () => {
  it("negotiates protocol 5, sanitizes inventory, streams colors, and restores state", async () => {
    const fixture = await startFakeOpenRgb();
    fixtures.push(fixture);
    const adapter = new OpenRgbHardwareLightingAdapter({ port: fixture.port, timeoutMs: 500 });

    const status = await adapter.refresh();
    expect(status.available).toBe(true);
    expect(status.protocolVersion).toBe(5);
    expect(status.controllers).toEqual([
      expect.objectContaining({
        name: "Test Keyboard",
        vendor: "Example Vendor",
        type: "keyboard",
        ledCount: 2,
        supported: true,
      }),
    ]);
    expect(JSON.stringify(status)).not.toContain("PRIVATE-SERIAL");
    expect(JSON.stringify(status)).not.toContain("PRIVATE-PATH");

    adapter.configure({
      selectedIds: [status.controllers[0]!.id],
      brightness: 0.5,
      restoreOnDisable: true,
    });
    await adapter.applyFrame({
      sequence: 1,
      colors: [
        { red: 200, green: 100, blue: 50 },
        { red: 20, green: 40, blue: 60 },
      ],
    });
    await adapter.restore();

    await vi.waitFor(() => {
      expect(fixture.packets.filter((packet) => packet.packetId === 1_050)).toHaveLength(2);
      expect(fixture.packets.some((packet) => packet.packetId === 1_101)).toBe(true);
    });
    const frame = fixture.packets.find((packet) => packet.packetId === 1_050)!.payload;
    expect(frame.readUInt32LE(0)).toBe(frame.length);
    expect(frame.readUInt16LE(4)).toBe(2);
    expect(frame.readUInt32LE(6)).toBe(100 | (50 << 8) | (25 << 16));
    const restore = fixture.packets.filter((packet) => packet.packetId === 1_050)[1]!.payload;
    expect(restore.readUInt32LE(6)).toBe(0x00030201);
    expect(restore.readUInt32LE(10)).toBe(0x00060504);
    const restoreMode = fixture.packets.find((packet) => packet.packetId === 1_101)!.payload;
    expect(restoreMode.readUInt32LE(0)).toBe(restoreMode.length);
    expect(restoreMode.readInt32LE(4)).toBe(0);
    await adapter.close();
  });

  it("fails closed when the SDK exposes more than the bounded controller count", async () => {
    const fixture = await startFakeOpenRgb(65);
    fixtures.push(fixture);
    const adapter = new OpenRgbHardwareLightingAdapter({ port: fixture.port, timeoutMs: 500 });

    const status = await adapter.refresh();
    expect(status.available).toBe(false);
    expect(status.controllers).toEqual([]);
    expect(status.detail).toContain("bounded OpenRGB loopback capability check");
  });
});
