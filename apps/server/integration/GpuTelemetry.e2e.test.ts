import { describe, expect, it } from "vitest";
import { ServerSystemGpuTelemetry } from "@cafecode/contracts";
import * as Schema from "effect/Schema";
import { makeGpuProbeProcess } from "../src/diagnostics/GpuProbeProcess.ts";

const decodeGpuTelemetry = Schema.decodeUnknownSync(ServerSystemGpuTelemetry);

describe("GPU telemetry on the selected host (opt-in)", () => {
  it("resolves without throwing on this machine whichever hardware is present", async () => {
    const probe = makeGpuProbeProcess();
    const result = await probe.read();
    await probe.close();

    // Whatever this host is, the value must satisfy the transport contract and
    // must never be a fabricated measurement.
    expect(decodeGpuTelemetry(result)).toEqual(result);
    if (result.status === "unavailable") {
      expect(["unsupported", "probe-failed", "malformed"]).toContain(result.reason);
      expect(result.adapters).toEqual([]);
    } else {
      expect(result.adapters.length).toBeGreaterThan(0);
    }
  });
});
