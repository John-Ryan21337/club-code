import { describe, expect, it } from "vitest";

import { MAX_GPU_ADAPTERS, ServerSystemGpuTelemetry } from "@cafecode/contracts";
import * as Schema from "effect/Schema";

import {
  gpuTelemetryFromRawSamples,
  malformedGpuTelemetry,
  parseGpuProbeOutput,
  probeFailedGpuTelemetry,
  unsupportedGpuTelemetry,
  type RawGpuAdapterSample,
} from "./GpuTelemetry.ts";

const decodeGpuTelemetry = Schema.decodeUnknownSync(ServerSystemGpuTelemetry);

function sample(overrides: Partial<RawGpuAdapterSample> = {}): RawGpuAdapterSample {
  return {
    name: "NVIDIA GeForce RTX 4090",
    index: "0",
    utilizationPercent: "15",
    memoryTotalMebibytes: "24564",
    memoryUsedMebibytes: "3421",
    ...overrides,
  };
}

/** Built from code points so this source file stays pure ASCII. */
function nameWith(codePoint: number): string {
  return `NVIDIA ${String.fromCodePoint(codePoint)} RTX`;
}

describe("GpuTelemetry unavailable reasons", () => {
  it("keeps unsupported, probe-failed, and malformed distinguishable without leaking raw data", () => {
    const results = [unsupportedGpuTelemetry(), probeFailedGpuTelemetry(), malformedGpuTelemetry()];

    expect(results.map((result) => result.reason)).toEqual([
      "unsupported",
      "probe-failed",
      "malformed",
    ]);
    // Distinct prose per reason, so the three states are not collapsed in the UI.
    expect(new Set(results.map((result) => result.detail)).size).toBe(3);
    for (const result of results) {
      expect(result.status).toBe("unavailable");
      expect(result.adapters).toEqual([]);
      expect(decodeGpuTelemetry(result)).toEqual(result);
    }
  });

  it("never fabricates measured data on any unavailable path", () => {
    expect(unsupportedGpuTelemetry()).toEqual({
      status: "unavailable",
      adapters: [],
      reason: "unsupported",
      detail: "No supported GPU telemetry source is available on this system.",
    });
  });
});

describe("gpuTelemetryFromRawSamples", () => {
  it("derives available telemetry with bytes converted from mebibytes", () => {
    const result = gpuTelemetryFromRawSamples([sample()]);

    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("unreachable");
    expect(result.adapters).toEqual([
      {
        index: 0,
        name: "NVIDIA GeForce RTX 4090",
        utilizationPercent: 15,
        memoryTotalBytes: 24_564 * 1_024 * 1_024,
        memoryUsedBytes: 3_421 * 1_024 * 1_024,
        memoryUtilizationPercent: (3_421 / 24_564) * 100,
      },
    ]);
    expect(result.reason).toBeNull();
    expect(decodeGpuTelemetry(result)).toEqual(result);
  });

  it("supports multiple adapters keyed by distinct index", () => {
    const result = gpuTelemetryFromRawSamples([
      sample({ index: "0", name: "GPU 0" }),
      sample({ index: "1", name: "GPU 1", utilizationPercent: "80" }),
    ]);

    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("unreachable");
    expect(result.adapters.map((adapter) => adapter.index)).toEqual([0, 1]);
    expect(decodeGpuTelemetry(result)).toEqual(result);
  });

  it("accepts exactly the maximum adapter count and rejects one more", () => {
    const build = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        sample({ index: String(index), name: `GPU ${index}` }),
      );

    const atLimit = gpuTelemetryFromRawSamples(build(MAX_GPU_ADAPTERS));
    expect(atLimit.status).toBe("available");
    expect(atLimit.status === "available" ? atLimit.adapters : []).toHaveLength(MAX_GPU_ADAPTERS);
    expect(decodeGpuTelemetry(atLimit)).toEqual(atLimit);

    expect(gpuTelemetryFromRawSamples(build(MAX_GPU_ADAPTERS + 1))).toEqual(
      malformedGpuTelemetry(),
    );
  });

  it("returns malformed for an empty sample list", () => {
    expect(gpuTelemetryFromRawSamples([])).toEqual(malformedGpuTelemetry());
  });

  it("fails closed on a duplicate adapter index instead of reporting a partial list", () => {
    const result = gpuTelemetryFromRawSamples([
      sample({ index: "0", name: "GPU A" }),
      sample({ index: "0", name: "GPU B" }),
    ]);

    expect(result).toEqual(malformedGpuTelemetry());
  });

  it("fails closed when any single adapter is unreadable, hiding the whole list", () => {
    const result = gpuTelemetryFromRawSamples([
      sample({ index: "0", name: "Good GPU" }),
      sample({ index: "1", name: "WSL2 GPU", utilizationPercent: "[N/A]" }),
    ]);

    expect(result).toEqual(malformedGpuTelemetry());
    expect(result.reason).toBe("malformed");
  });

  it.each([
    { label: "utilization over 100", overrides: { utilizationPercent: "150" } },
    { label: "nvidia-smi [N/A] utilization", overrides: { utilizationPercent: "[N/A]" } },
    { label: "nvidia-smi [Not Supported]", overrides: { utilizationPercent: "[Not Supported]" } },
    { label: "signed utilization", overrides: { utilizationPercent: "-1" } },
    { label: "float utilization", overrides: { utilizationPercent: "15.5" } },
    { label: "exponent-notation memory", overrides: { memoryTotalMebibytes: "1e3" } },
    { label: "hex index", overrides: { index: "0x10" } },
    { label: "used memory exceeding total", overrides: { memoryUsedMebibytes: "99999" } },
    { label: "zero total memory", overrides: { memoryTotalMebibytes: "0" } },
    { label: "non-numeric index", overrides: { index: "gpu-0" } },
    { label: "index past the bounded maximum", overrides: { index: "4096" } },
    { label: "empty name", overrides: { name: "   " } },
    { label: "oversized name", overrides: { name: "x".repeat(201) } },
    {
      label: "memory that overflows safe-integer bytes",
      overrides: { memoryTotalMebibytes: "99999999999999", memoryUsedMebibytes: "1" },
    },
  ])("fails closed on impossible/malformed value: $label", ({ overrides }) => {
    expect(gpuTelemetryFromRawSamples([sample(overrides)])).toEqual(malformedGpuTelemetry());
  });

  it.each([
    { label: "NUL", codePoint: 0x00 },
    { label: "bell", codePoint: 0x07 },
    { label: "tab", codePoint: 0x09 },
    { label: "ANSI escape", codePoint: 0x1b },
    { label: "delete", codePoint: 0x7f },
    { label: "C1 control", codePoint: 0x9b },
    { label: "soft hyphen (Cf)", codePoint: 0xad },
    { label: "zero-width joiner (Cf)", codePoint: 0x200d },
    { label: "right-to-left override (Cf)", codePoint: 0x202e },
    { label: "line separator (Zl)", codePoint: 0x2028 },
    { label: "paragraph separator (Zp)", codePoint: 0x2029 },
    { label: "private-use (Co)", codePoint: 0xe000 },
  ])("rejects a control/format code point in the adapter name: $label", ({ codePoint }) => {
    expect(gpuTelemetryFromRawSamples([sample({ name: nameWith(codePoint) })])).toEqual(
      malformedGpuTelemetry(),
    );
  });

  it("rejects a lone surrogate in the adapter name", () => {
    expect(gpuTelemetryFromRawSamples([sample({ name: `NVIDIA ${"\ud800"} RTX` })])).toEqual(
      malformedGpuTelemetry(),
    );
  });

  it("keeps legitimate non-ASCII adapter names and astral code points", () => {
    for (const name of ["NVIDIA RTX A6000 (企業版)", `GPU ${"\u{1f600}"}`]) {
      const result = gpuTelemetryFromRawSamples([sample({ name })]);
      expect(result.status).toBe("available");
      expect(decodeGpuTelemetry(result)).toEqual(result);
    }
  });
});

describe("parseGpuProbeOutput", () => {
  it("parses a multi-adapter CSV body with CRLF endings and trailing blank lines", () => {
    const result = parseGpuProbeOutput(
      "NVIDIA A, 0, 15, 24564, 3421\r\nNVIDIA B, 1, 80, 24564, 12000\r\n\r\n",
    );

    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("unreachable");
    expect(result.adapters.map((adapter) => [adapter.name, adapter.index])).toEqual([
      ["NVIDIA A", 0],
      ["NVIDIA B", 1],
    ]);
    expect(decodeGpuTelemetry(result)).toEqual(result);
  });

  it.each([
    { label: "empty output", output: "" },
    { label: "whitespace-only output", output: "  \n\t\n " },
    { label: "non-CSV output", output: "not-csv-data" },
    { label: "too few columns", output: "GPU, 0, 15\n" },
    { label: "too many columns (comma inside a name)", output: "NVIDIA, Founders, 0, 15, 1, 1\n" },
    {
      label: "a good row followed by a bad row",
      output: "A, 0, 15, 100, 10\nB, 1, bad, 100, 10\n",
    },
    {
      label: "more rows than the bounded adapter maximum",
      output: Array.from({ length: MAX_GPU_ADAPTERS + 1 }, (_, i) => `G${i}, ${i}, 1, 100, 1`).join(
        "\n",
      ),
    },
    { label: "an embedded carriage return inside a field", output: "NVI\rDIA, 0, 15, 100, 10\n" },
  ])("returns malformed for $label", ({ output }) => {
    expect(parseGpuProbeOutput(output)).toEqual(malformedGpuTelemetry());
  });

  it("accepts exactly the maximum row count", () => {
    const output = Array.from(
      { length: MAX_GPU_ADAPTERS },
      (_, i) => `G${i}, ${i}, 1, 100, 1`,
    ).join("\n");

    expect(parseGpuProbeOutput(output).status).toBe("available");
  });

  it("never throws for adversarial text", () => {
    const inputs = [" ".repeat(64), ",,,,", ",".repeat(10_000), "\n".repeat(10_000), " "];

    for (const input of inputs) {
      const result = parseGpuProbeOutput(input);
      expect(decodeGpuTelemetry(result)).toEqual(result);
    }
  });
});
