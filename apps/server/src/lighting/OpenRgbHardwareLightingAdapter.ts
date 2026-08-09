import { createHash } from "node:crypto";
import { Socket } from "node:net";

import type { HardwareLightingController, HardwareLightingControllerId } from "@cafecode/contracts";

import type {
  HardwareLightingAdapter,
  HardwareLightingColor,
  HardwareLightingFrame,
} from "./HardwareLightingSync.ts";

const OPENRGB_HOST = "127.0.0.1";
const OPENRGB_PORT = 6_742;
const OPENRGB_MAGIC = 0x4f524742;
const OPENRGB_PROTOCOL_VERSION = 5;
const MAX_PACKET_BYTES = 2 * 1024 * 1024;
const SOCKET_TIMEOUT_MS = 1_500;
const MODE_FLAG_HAS_PER_LED_COLOR = 1 << 5;

const PACKET = {
  requestControllerCount: 0,
  requestControllerData: 1,
  requestProtocolVersion: 40,
  setClientName: 50,
  updateLeds: 1_050,
  setCustomMode: 1_100,
  updateMode: 1_101,
} as const;

interface OpenRgbMode {
  readonly name: string;
  readonly value: number;
  readonly flags: number;
  readonly speedMin: number;
  readonly speedMax: number;
  readonly brightnessMin: number;
  readonly brightnessMax: number;
  readonly colorsMin: number;
  readonly colorsMax: number;
  readonly speed: number;
  readonly brightness: number;
  readonly direction: number;
  readonly colorMode: number;
  readonly colors: readonly number[];
}

interface OpenRgbControllerRecord {
  readonly deviceId: number;
  readonly id: HardwareLightingControllerId;
  readonly name: string;
  readonly vendor: string;
  readonly typeCode: number;
  readonly ledCount: number;
  readonly colors: readonly number[];
  readonly modes: readonly OpenRgbMode[];
  readonly activeMode: number;
  readonly supported: boolean;
}

interface RestoreSnapshot {
  readonly colors: readonly number[];
  readonly activeMode: number;
  readonly mode: OpenRgbMode | null;
}

interface PacketResponse {
  readonly deviceId: number;
  readonly packetId: number;
  readonly payload: Buffer;
}

class BinaryReader {
  private offset = 0;
  private readonly buffer: Buffer;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  private take(length: number): Buffer {
    if (!Number.isSafeInteger(length) || length < 0 || this.offset + length > this.buffer.length) {
      throw new Error("OpenRGB returned a truncated or invalid controller payload.");
    }
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  u16(): number {
    return this.take(2).readUInt16LE(0);
  }

  u32(): number {
    return this.take(4).readUInt32LE(0);
  }

  i32(): number {
    return this.take(4).readInt32LE(0);
  }

  string(): string {
    const byteLength = this.u16();
    if (byteLength === 0 || byteLength > 4_096) {
      throw new Error("OpenRGB returned an invalid string length.");
    }
    const raw = this.take(byteLength);
    const content = raw[raw.length - 1] === 0 ? raw.subarray(0, -1) : raw;
    return content.toString("utf8").slice(0, 512);
  }

  skip(length: number): void {
    this.take(length);
  }
}

function encodeString(value: string): Buffer {
  const body = Buffer.from(value.slice(0, 512), "utf8");
  const output = Buffer.allocUnsafe(2 + body.length + 1);
  output.writeUInt16LE(body.length + 1, 0);
  body.copy(output, 2);
  output[output.length - 1] = 0;
  return output;
}

function encodeU32(value: number): Buffer {
  const output = Buffer.allocUnsafe(4);
  output.writeUInt32LE(value >>> 0, 0);
  return output;
}

function encodeI32(value: number): Buffer {
  const output = Buffer.allocUnsafe(4);
  output.writeInt32LE(value | 0, 0);
  return output;
}

function encodeMode(mode: OpenRgbMode): Buffer {
  const colorCount = Math.min(mode.colors.length, 4_096);
  const fixed = Buffer.allocUnsafe(50 + colorCount * 4);
  let offset = 0;
  fixed.writeInt32LE(mode.value | 0, offset);
  offset += 4;
  for (const value of [
    mode.flags,
    mode.speedMin,
    mode.speedMax,
    mode.brightnessMin,
    mode.brightnessMax,
    mode.colorsMin,
    mode.colorsMax,
    mode.speed,
    mode.brightness,
    mode.direction,
    mode.colorMode,
  ]) {
    fixed.writeUInt32LE(value >>> 0, offset);
    offset += 4;
  }
  fixed.writeUInt16LE(colorCount, offset);
  offset += 2;
  for (let index = 0; index < colorCount; index += 1) {
    fixed.writeUInt32LE(mode.colors[index]! >>> 0, offset);
    offset += 4;
  }
  return Buffer.concat([encodeString(mode.name), fixed]);
}

function parseMode(reader: BinaryReader): OpenRgbMode {
  const name = reader.string();
  const value = reader.i32();
  const flags = reader.u32();
  const speedMin = reader.u32();
  const speedMax = reader.u32();
  const brightnessMin = reader.u32();
  const brightnessMax = reader.u32();
  const colorsMin = reader.u32();
  const colorsMax = reader.u32();
  const speed = reader.u32();
  const brightness = reader.u32();
  const direction = reader.u32();
  const colorMode = reader.u32();
  const colorCount = reader.u16();
  if (colorCount > 4_096) throw new Error("OpenRGB mode exceeds the color safety limit.");
  const colors = Array.from({ length: colorCount }, () => reader.u32());
  return {
    name,
    value,
    flags,
    speedMin,
    speedMax,
    brightnessMin,
    brightnessMax,
    colorsMin,
    colorsMax,
    speed,
    brightness,
    direction,
    colorMode,
    colors,
  };
}

function controllerType(typeCode: number): HardwareLightingController["type"] {
  return (
    (
      [
        "motherboard",
        "dram",
        "gpu",
        "cooler",
        "led-strip",
        "keyboard",
        "mouse",
        "mouse-mat",
        "headset",
        "headset-stand",
        "gamepad",
        "light",
        "speaker",
        "virtual",
        "storage",
        "case",
      ] as const
    )[typeCode] ?? "unknown"
  );
}

function controllerId(parts: readonly (string | number)[]): HardwareLightingControllerId {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 32);
}

function parseControllerData(deviceId: number, payload: Buffer): OpenRgbControllerRecord {
  const reader = new BinaryReader(payload);
  const declaredSize = reader.u32();
  if (declaredSize > payload.length || declaredSize > MAX_PACKET_BYTES) {
    throw new Error("OpenRGB controller data exceeds the payload safety limit.");
  }
  const typeCode = reader.i32();
  const name = reader.string();
  const vendor = reader.string();
  reader.string(); // description
  reader.string(); // version
  const serial = reader.string();
  const location = reader.string();
  const modeCount = reader.u16();
  if (modeCount > 256) throw new Error("OpenRGB controller exposes too many modes.");
  const activeMode = reader.i32();
  const modes = Array.from({ length: modeCount }, () => parseMode(reader));

  const zoneCount = reader.u16();
  if (zoneCount > 512) throw new Error("OpenRGB controller exposes too many zones.");
  for (let index = 0; index < zoneCount; index += 1) {
    reader.string();
    reader.i32();
    reader.u32();
    reader.u32();
    reader.u32();
    reader.skip(reader.u16());
    const segmentCount = reader.u16();
    if (segmentCount > 4_096) throw new Error("OpenRGB zone exposes too many segments.");
    for (let segment = 0; segment < segmentCount; segment += 1) {
      reader.string();
      reader.i32();
      reader.u32();
      reader.u32();
    }
    reader.u32();
  }

  const ledCount = reader.u16();
  if (ledCount > 4_096) throw new Error("OpenRGB controller exceeds the LED safety limit.");
  for (let index = 0; index < ledCount; index += 1) {
    reader.string();
    reader.u32();
  }
  const colorCount = reader.u16();
  if (colorCount > 4_096) throw new Error("OpenRGB controller exceeds the color safety limit.");
  const colors = Array.from({ length: colorCount }, () => reader.u32());
  const alternateLedNameCount = reader.u16();
  if (alternateLedNameCount > 4_096) {
    throw new Error("OpenRGB controller exposes too many LED names.");
  }
  for (let index = 0; index < alternateLedNameCount; index += 1) reader.string();
  reader.u32(); // controller flags

  const supported =
    colorCount > 0 && modes.some((mode) => (mode.flags & MODE_FLAG_HAS_PER_LED_COLOR) !== 0);
  return {
    deviceId,
    id: controllerId([typeCode, vendor, name, serial, location, ledCount]),
    name: name.slice(0, 160),
    vendor: vendor.slice(0, 160),
    typeCode,
    ledCount: colorCount,
    colors,
    modes,
    activeMode,
    supported,
  };
}

function rgbColor(color: HardwareLightingColor, brightness: number): number {
  const red = Math.round(color.red * brightness);
  const green = Math.round(color.green * brightness);
  const blue = Math.round(color.blue * brightness);
  return red | (green << 8) | (blue << 16);
}

function mapPalette(
  colors: ReadonlyArray<HardwareLightingColor>,
  ledCount: number,
  brightness: number,
): readonly number[] {
  return Array.from({ length: ledCount }, (_, index) =>
    rgbColor(colors[Math.floor((index * colors.length) / Math.max(1, ledCount))]!, brightness),
  );
}

function updateLedsPayload(colors: readonly number[]): Buffer {
  const dataSize = 4 + 2 + colors.length * 4;
  const output = Buffer.allocUnsafe(dataSize);
  output.writeUInt32LE(output.length, 0);
  output.writeUInt16LE(colors.length, 4);
  colors.forEach((color, index) => output.writeUInt32LE(color >>> 0, 6 + index * 4));
  return output;
}

class OpenRgbConnection {
  private readonly socket = new Socket();
  private readonly port: number;
  private readonly timeoutMs: number;
  private buffer = Buffer.alloc(0);
  private pending: ((packet: PacketResponse) => void) | null = null;
  private pendingReject: ((error: Error) => void) | null = null;

  constructor(port: number, timeoutMs: number) {
    this.port = port;
    this.timeoutMs = timeoutMs;
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error) => reject(error);
      this.socket.once("error", fail);
      this.socket.setTimeout(this.timeoutMs, () => {
        this.socket.destroy(new Error("OpenRGB did not respond before the loopback timeout."));
      });
      this.socket.connect(this.port, OPENRGB_HOST, () => {
        this.socket.off("error", fail);
        resolve();
      });
    });
    this.socket.on("data", (data) => this.onData(data));
    this.socket.on("error", (error) => this.rejectPending(error));
    this.socket.on("close", () => this.rejectPending(new Error("OpenRGB closed the connection.")));
  }

  private rejectPending(error: Error): void {
    const reject = this.pendingReject;
    this.pending = null;
    this.pendingReject = null;
    reject?.(error);
  }

  private onData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= 16) {
      const magic = this.buffer.readUInt32LE(0);
      const payloadSize = this.buffer.readUInt32LE(12);
      if (magic !== OPENRGB_MAGIC || payloadSize > MAX_PACKET_BYTES) {
        this.socket.destroy(new Error("OpenRGB returned an invalid packet header."));
        return;
      }
      const packetSize = 16 + payloadSize;
      if (this.buffer.length < packetSize) return;
      const packet = {
        deviceId: this.buffer.readUInt32LE(4),
        packetId: this.buffer.readUInt32LE(8),
        payload: Buffer.from(this.buffer.subarray(16, packetSize)),
      };
      this.buffer = this.buffer.subarray(packetSize);
      if (packet.packetId === 100) {
        this.socket.destroy(new Error("OpenRGB reported that its device list changed."));
        return;
      }
      const resolve = this.pending;
      this.pending = null;
      this.pendingReject = null;
      resolve?.(packet);
    }
  }

  send(deviceId: number, packetId: number, payload: Uint8Array = Buffer.alloc(0)): Promise<void> {
    const header = Buffer.allocUnsafe(16);
    header.writeUInt32LE(OPENRGB_MAGIC, 0);
    header.writeUInt32LE(deviceId >>> 0, 4);
    header.writeUInt32LE(packetId >>> 0, 8);
    header.writeUInt32LE(payload.length, 12);
    return new Promise((resolve, reject) => {
      this.socket.write(Buffer.concat([header, payload]), (error) =>
        error ? reject(error) : resolve(),
      );
    });
  }

  async request(
    deviceId: number,
    packetId: number,
    payload: Uint8Array = Buffer.alloc(0),
  ): Promise<Buffer> {
    if (this.pending !== null) throw new Error("An OpenRGB request is already in flight.");
    const response = new Promise<PacketResponse>((resolve, reject) => {
      this.pending = resolve;
      this.pendingReject = reject;
    });
    await this.send(deviceId, packetId, payload);
    const packet = await response;
    if (packet.packetId !== packetId || packet.deviceId !== deviceId) {
      throw new Error("OpenRGB returned an unexpected response packet.");
    }
    return packet.payload;
  }

  close(): void {
    this.socket.destroy();
  }

  disableIdleTimeout(): void {
    this.socket.setTimeout(0);
  }
}

export interface OpenRgbAdapterSnapshot {
  readonly available: boolean;
  readonly detail: string;
  readonly protocolVersion: number | null;
  readonly controllers: readonly HardwareLightingController[];
}

export class OpenRgbHardwareLightingAdapter implements HardwareLightingAdapter {
  private connection: OpenRgbConnection | null = null;
  private protocolVersion: number | null = null;
  private controllers: readonly OpenRgbControllerRecord[] = [];
  private selectedIds = new Set<string>();
  private brightness = 1;
  private restoreOnDisable = true;
  private readonly restoreSnapshots = new Map<string, RestoreSnapshot>();
  private detail = "OpenRGB is not connected on 127.0.0.1:6742.";
  private readonly options: { readonly port?: number; readonly timeoutMs?: number };

  constructor(options: { readonly port?: number; readonly timeoutMs?: number } = {}) {
    this.options = options;
  }

  configure(input: {
    readonly selectedIds: readonly string[];
    readonly brightness: number;
    readonly restoreOnDisable: boolean;
  }): void {
    this.selectedIds = new Set(input.selectedIds);
    this.brightness = Math.min(1, Math.max(0.05, input.brightness));
    this.restoreOnDisable = input.restoreOnDisable;
  }

  snapshot(): OpenRgbAdapterSnapshot {
    return {
      available: this.connection !== null,
      detail: this.detail,
      protocolVersion: this.protocolVersion,
      controllers: this.controllers.map((controller) => ({
        id: controller.id,
        name: controller.name,
        vendor: controller.vendor,
        type: controllerType(controller.typeCode),
        ledCount: controller.ledCount,
        supported: controller.supported,
      })),
    };
  }

  private disconnect(): void {
    this.connection?.close();
    this.connection = null;
    this.protocolVersion = null;
  }

  private async ensureConnected(force = false): Promise<void> {
    if (force) this.disconnect();
    if (this.connection !== null) return;
    const connection = new OpenRgbConnection(
      this.options.port ?? OPENRGB_PORT,
      this.options.timeoutMs ?? SOCKET_TIMEOUT_MS,
    );
    try {
      await connection.connect();
      const protocol = await connection.request(
        0,
        PACKET.requestProtocolVersion,
        encodeU32(OPENRGB_PROTOCOL_VERSION),
      );
      if (protocol.length !== 4) throw new Error("OpenRGB returned an invalid protocol response.");
      const protocolVersion = Math.min(OPENRGB_PROTOCOL_VERSION, protocol.readUInt32LE(0));
      await connection.send(0, PACKET.setClientName, Buffer.from("Club Code\0", "utf8"));
      const countPayload = await connection.request(0, PACKET.requestControllerCount);
      if (countPayload.length !== 4) throw new Error("OpenRGB returned an invalid device count.");
      const controllerCount = countPayload.readUInt32LE(0);
      if (controllerCount > 64) throw new Error("OpenRGB exposes more than 64 controllers.");
      const controllers: OpenRgbControllerRecord[] = [];
      for (let deviceId = 0; deviceId < controllerCount; deviceId += 1) {
        const data = await connection.request(
          deviceId,
          PACKET.requestControllerData,
          encodeU32(protocolVersion),
        );
        controllers.push(parseControllerData(deviceId, data));
      }
      connection.disableIdleTimeout();
      this.connection = connection;
      this.protocolVersion = protocolVersion;
      this.controllers = controllers;
      const supportedCount = controllers.filter((controller) => controller.supported).length;
      this.detail =
        supportedCount === 0
          ? "OpenRGB is connected, but no controller advertises direct per-LED color control."
          : `OpenRGB is connected with ${supportedCount} compatible controller${supportedCount === 1 ? "" : "s"}.`;
    } catch (error) {
      connection.close();
      this.disconnect();
      this.controllers = [];
      this.detail =
        error instanceof Error && error.message.includes("ECONNREFUSED")
          ? "OpenRGB is not listening on 127.0.0.1:6742. Start OpenRGB with its SDK server enabled."
          : "Club Code could not complete the bounded OpenRGB loopback capability check.";
      throw error;
    }
  }

  async refresh(): Promise<OpenRgbAdapterSnapshot> {
    try {
      await this.ensureConnected(true);
    } catch {
      // The sanitized snapshot carries the truthful operator-facing result.
    }
    return this.snapshot();
  }

  async probe() {
    try {
      await this.ensureConnected();
      return { status: "available" as const, detail: this.detail };
    } catch {
      return { status: "unavailable" as const, detail: this.detail };
    }
  }

  async applyFrame(frame: HardwareLightingFrame): Promise<void> {
    try {
      await this.ensureConnected();
      const connection = this.connection;
      if (connection === null) throw new Error("OpenRGB is unavailable.");
      const selected = this.controllers.filter(
        (controller) => controller.supported && this.selectedIds.has(controller.id),
      );
      if (selected.length === 0) throw new Error("No compatible OpenRGB controller is selected.");
      for (const controller of selected) {
        if (!this.restoreSnapshots.has(controller.id)) {
          this.restoreSnapshots.set(controller.id, {
            colors: [...controller.colors],
            activeMode: controller.activeMode,
            mode: controller.modes[controller.activeMode] ?? null,
          });
        }
        const colors = mapPalette(frame.colors, controller.ledCount, this.brightness);
        await connection.send(controller.deviceId, PACKET.setCustomMode);
        await connection.send(controller.deviceId, PACKET.updateLeds, updateLedsPayload(colors));
      }
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  async restore(): Promise<void> {
    if (!this.restoreOnDisable || this.restoreSnapshots.size === 0) {
      this.restoreSnapshots.clear();
      return;
    }
    let restored = false;
    try {
      await this.ensureConnected();
      const connection = this.connection;
      if (connection === null) return;
      for (const [controllerId, snapshot] of this.restoreSnapshots) {
        const currentController = this.controllers.find(
          (controller) => controller.id === controllerId,
        );
        if (currentController === undefined) continue;
        await connection.send(
          currentController.deviceId,
          PACKET.updateLeds,
          updateLedsPayload(snapshot.colors),
        );
        if (snapshot.mode !== null && snapshot.activeMode >= 0) {
          const mode = encodeMode(snapshot.mode);
          await connection.send(
            currentController.deviceId,
            PACKET.updateMode,
            Buffer.concat([encodeU32(8 + mode.length), encodeI32(snapshot.activeMode), mode]),
          );
        }
      }
      restored = true;
    } finally {
      if (restored) this.restoreSnapshots.clear();
    }
  }

  async close(): Promise<void> {
    try {
      await this.restore();
    } finally {
      this.disconnect();
    }
  }
}
