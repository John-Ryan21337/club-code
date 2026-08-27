import * as NodeOs from "node:os";

import { describe, expect, it, vi } from "vitest";

import type { ProcessRow } from "../diagnostics/ProcessDiagnostics.ts";
import {
  collectProviderProcessTreePids,
  PROVIDER_PROCESS_PRIORITY,
  setProviderProcessPriority,
  spawnProviderProcessAtLowerPriority,
} from "./ProviderProcessPriority.ts";

function processRow(pid: number, ppid: number): ProcessRow {
  return {
    pid,
    ppid,
    pgid: null,
    status: "Live",
    cpuPercent: 0,
    rssBytes: 0,
    elapsed: "",
    command: `process-${pid}`,
  };
}

describe("ProviderProcessPriority", () => {
  it("selects only the provider root and its descendants", () => {
    const rows = [
      processRow(20, 10),
      processRow(21, 20),
      processRow(22, 21),
      processRow(30, 10),
      processRow(31, 30),
    ];

    expect(collectProviderProcessTreePids(rows, 20)).toEqual([20, 21, 22]);
  });

  it("requests below-normal priority for a valid provider process", () => {
    const setPriority = vi.fn();

    expect(setProviderProcessPriority(42, setPriority)).toEqual({
      pid: 42,
      priority: PROVIDER_PROCESS_PRIORITY,
      adjusted: true,
    });
    expect(setPriority).toHaveBeenCalledWith(42, PROVIDER_PROCESS_PRIORITY);
  });

  it("contains operating system failures so provider startup can continue", () => {
    const result = setProviderProcessPriority(42, () => {
      throw new Error("access denied");
    });

    expect(result).toEqual({
      pid: 42,
      priority: PROVIDER_PROCESS_PRIORITY,
      adjusted: false,
      error: "access denied",
    });
  });

  it("does not call the operating system for an invalid PID", () => {
    const setPriority = vi.fn();

    expect(setProviderProcessPriority(0, setPriority).adjusted).toBe(false);
    expect(setPriority).not.toHaveBeenCalled();
  });

  it("starts a real provider child below normal priority and preserves stderr", async () => {
    const abortController = new AbortController();
    const stderr = vi.fn();
    const child = spawnProviderProcessAtLowerPriority({
      command: process.execPath,
      args: ["-e", "process.stderr.write('provider-ready'); setTimeout(() => {}, 3000)"],
      env: process.env,
      signal: abortController.signal,
      onStderr: stderr,
    });

    try {
      expect(NodeOs.getPriority(child.pid as number)).toBe(PROVIDER_PROCESS_PRIORITY);
      await new Promise<void>((resolve) => child.stderr.once("data", () => resolve()));
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining("provider-ready"));
    } finally {
      child.kill();
    }
  });
});
