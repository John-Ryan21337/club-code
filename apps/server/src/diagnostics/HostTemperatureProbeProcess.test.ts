import type { ChildProcess, execFile } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  makeHostTemperatureProbeProcessForTest,
  resolveTrustedTemperaturePowerShell,
  TEMPERATURE_PROBE_ARGS,
} from "./HostTemperatureProbeProcess.ts";
import { unavailableTemperatureTelemetry } from "./TemperatureTelemetry.ts";

const WINDOWS_POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

describe("HostTemperatureProbeProcess", () => {
  it("resolves only the fixed protected Windows PowerShell location", () => {
    expect(
      resolveTrustedTemperaturePowerShell(
        { SystemRoot: "C:\\Windows", windir: "C:\\Windows", SystemDrive: "C:" },
        (path) => path === WINDOWS_POWERSHELL,
      ),
    ).toBe(WINDOWS_POWERSHELL);
    expect(
      resolveTrustedTemperaturePowerShell(
        { SystemRoot: "C:\\Users\\me\\Windows", SystemDrive: "C:" },
        () => true,
      ),
    ).toBeNull();
  });

  it("uses fixed shell-free bounded WMI arguments and reports missing namespaces unsupported", async () => {
    let invocation:
      | {
          executable: string;
          args: readonly string[];
          options: Record<string, unknown>;
        }
      | undefined;
    const execute = ((
      executable: string,
      args: readonly string[],
      options: Record<string, unknown>,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      invocation = { executable, args, options };
      queueMicrotask(() => callback(null, "[]\r\n", ""));
      return { kill: vi.fn() } as unknown as ChildProcess;
    }) as unknown as typeof execFile;
    const probe = makeHostTemperatureProbeProcessForTest({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", windir: "C:\\Windows", SystemDrive: "C:" },
      isExecutable: (path) => path === WINDOWS_POWERSHELL,
      exec: execute,
    });

    await expect(probe.read()).resolves.toEqual(unavailableTemperatureTelemetry("unsupported"));
    if (!invocation) throw new Error("Expected the temperature probe to launch.");
    expect(invocation.executable).toBe(WINDOWS_POWERSHELL);
    expect(invocation.args).toEqual(TEMPERATURE_PROBE_ARGS);
    expect(invocation.options).toMatchObject({
      cwd: "C:\\Windows\\System32",
      shell: false,
      timeout: 2_000,
      maxBuffer: 16_384,
      windowsHide: true,
    });
    expect((invocation.options.env as NodeJS.ProcessEnv).PATH).toBeUndefined();
    expect(TEMPERATURE_PROBE_ARGS.join(" ")).toContain("root/LibreHardwareMonitor");
    expect(TEMPERATURE_PROBE_ARGS.join(" ")).toContain("root/OpenHardwareMonitor");
    await probe.close();
  });

  it("keeps unsupported platforms explicit without launching a helper", async () => {
    const execute = vi.fn();
    const probe = makeHostTemperatureProbeProcessForTest({
      platform: "darwin",
      exec: execute as unknown as typeof execFile,
    });
    await expect(probe.read()).resolves.toEqual(unavailableTemperatureTelemetry("unsupported"));
    expect(execute).not.toHaveBeenCalled();
  });
});
