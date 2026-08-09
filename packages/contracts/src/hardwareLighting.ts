import * as Schema from "effect/Schema";

export const MAX_HARDWARE_LIGHTING_CONTROLLERS = 64;
export const MAX_HARDWARE_LIGHTING_FRAME_COLORS = 64;

export const HardwareLightingControllerId = Schema.String.check(
  Schema.isMinLength(16),
  Schema.isMaxLength(64),
  Schema.isPattern(/^[a-f0-9]+$/u),
);
export type HardwareLightingControllerId = typeof HardwareLightingControllerId.Type;

export const HardwareLightingControllerType = Schema.Literals([
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
  "unknown",
]);
export type HardwareLightingControllerType = typeof HardwareLightingControllerType.Type;

export const HardwareLightingController = Schema.Struct({
  id: HardwareLightingControllerId,
  name: Schema.String.check(Schema.isMaxLength(160)),
  vendor: Schema.String.check(Schema.isMaxLength(160)),
  type: HardwareLightingControllerType,
  ledCount: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 4_096 })),
  supported: Schema.Boolean,
});
export type HardwareLightingController = typeof HardwareLightingController.Type;

export const HardwareLightingStatus = Schema.Struct({
  state: Schema.Literals(["disabled", "unavailable", "available", "active", "error"]),
  adapter: Schema.Literal("OpenRGB SDK (loopback)"),
  detail: Schema.String.check(Schema.isMaxLength(500)),
  protocolVersion: Schema.NullOr(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }))),
  controllers: Schema.Array(HardwareLightingController).check(
    Schema.isMaxLength(MAX_HARDWARE_LIGHTING_CONTROLLERS),
  ),
  selectedControllerCount: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: MAX_HARDWARE_LIGHTING_CONTROLLERS }),
  ),
  lastFrameAt: Schema.NullOr(Schema.String),
  lastDisposition: Schema.NullOr(
    Schema.Literals(["applied", "disabled", "invalid", "rate-limited", "busy", "adapter-error"]),
  ),
});
export type HardwareLightingStatus = typeof HardwareLightingStatus.Type;

export const HardwareLightingColor = Schema.Struct({
  red: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  green: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
  blue: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 255 })),
});
export type HardwareLightingColor = typeof HardwareLightingColor.Type;

export const HardwareLightingFrameInput = Schema.Struct({
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  active: Schema.Boolean,
  colors: Schema.Array(HardwareLightingColor).check(
    Schema.isMaxLength(MAX_HARDWARE_LIGHTING_FRAME_COLORS),
  ),
});
export type HardwareLightingFrameInput = typeof HardwareLightingFrameInput.Type;

export class HardwareLightingRpcError extends Schema.TaggedErrorClass<HardwareLightingRpcError>()(
  "HardwareLightingRpcError",
  {
    detail: Schema.String,
  },
) {}
