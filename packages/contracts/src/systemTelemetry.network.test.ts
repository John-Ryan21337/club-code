import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { ServerSystemNetworkTelemetry } from "./systemTelemetry.ts";

const decode = Schema.decodeUnknownSync(ServerSystemNetworkTelemetry);
const available = {
  status: "available",
  receiveBytesPerSecond: 0,
  transmitBytesPerSecond: 2048,
  detail: null,
};

describe("network telemetry transport bounds", () => {
  it("preserves a measured zero and integer rates", () => {
    expect(decode(available)).toEqual(available);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe rates: %s",
    (rate) => {
      expect(() => decode({ ...available, receiveBytesPerSecond: rate })).toThrow();
      expect(() => decode({ ...available, transmitBytesPerSecond: rate })).toThrow();
    },
  );

  it.each(["warming", "unavailable"])("keeps %s separate from measured zero", (status) => {
    const missing = {
      status,
      receiveBytesPerSecond: null,
      transmitBytesPerSecond: null,
      detail: "Waiting for a source.",
    };
    expect(decode(missing)).toEqual(missing);
    expect(() => decode({ ...missing, receiveBytesPerSecond: 0 })).toThrow();
    expect(() => decode({ ...missing, detail: "x".repeat(161) })).toThrow();
  });
});
