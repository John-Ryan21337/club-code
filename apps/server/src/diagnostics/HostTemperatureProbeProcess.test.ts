import type { ChildProcess, execFile } from "node:child_process";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  makeHostTemperatureProbeProcessForTest,
  resolveTrustedTemperaturePowerShell,
  TEMPERATURE_PROBE_ARGS,
} from "./HostTemperatureProbeProcess.ts";
import { unavailableTemperatureTelemetry } from "./TemperatureTelemetry.ts";

const WINDOWS_POWERSHELL = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";

afterEach(() => {
  vi.useRealTimers();
});

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

  it("uses fixed shell-free bounded WMI arguments and reports a missing provider", async () => {
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
      queueMicrotask(() =>
        callback(null, '{"CafeCodeTemperatureStatus":"provider-missing"}\r\n', ""),
      );
      return { kill: vi.fn() } as unknown as ChildProcess;
    }) as unknown as typeof execFile;
    const probe = makeHostTemperatureProbeProcessForTest({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", windir: "C:\\Windows", SystemDrive: "C:" },
      isExecutable: (path) => path === WINDOWS_POWERSHELL,
      exec: execute,
    });

    await expect(probe.read()).resolves.toEqual({
      version: 1,
      status: "unavailable",
      sensors: [],
      reason: "unsupported",
      detail:
        "Libre Hardware Monitor or Open Hardware Monitor WMI is not available. Install and run a supported sensor provider to expose measured host temperatures.",
    });
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
    expect(TEMPERATURE_PROBE_ARGS.join(" ")).toContain("Get-CimClass");
    await probe.close();
  });

  it("force-settles an unreaped helper and does not accumulate replacements", async () => {
    vi.useFakeTimers();
    const kill = vi.fn(() => true);
    const destroyStdin = vi.fn();
    const destroyStdout = vi.fn();
    const destroyStderr = vi.fn();
    const unref = vi.fn();
    let complete!: (error: Error | null, stdout: string, stderr: string) => void;
    const execute = vi.fn(
      (
        _executable: string,
        _args: readonly string[],
        _options: Record<string, unknown>,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        complete = callback;
        return {
          kill,
          unref,
          stdin: { destroy: destroyStdin },
          stdout: { destroy: destroyStdout },
          stderr: { destroy: destroyStderr },
        } as unknown as ChildProcess;
      },
    ) as unknown as typeof execFile;
    const probe = makeHostTemperatureProbeProcessForTest({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", windir: "C:\\Windows", SystemDrive: "C:" },
      isExecutable: (path) => path === WINDOWS_POWERSHELL,
      exec: execute,
      probeTimeoutMs: 10,
      forceSettleGraceMs: 5,
    });

    const first = probe.read();
    expect(probe.read()).toBe(first);
    expect(execute).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(15);
    await expect(first).resolves.toEqual(unavailableTemperatureTelemetry("probe-failed"));
    await expect(probe.read()).resolves.toEqual(unavailableTemperatureTelemetry("probe-failed"));
    expect(execute).toHaveBeenCalledOnce();
    expect(kill).toHaveBeenCalledWith("SIGKILL");
    expect(destroyStdin).toHaveBeenCalledOnce();
    expect(destroyStdout).toHaveBeenCalledOnce();
    expect(destroyStderr).toHaveBeenCalledOnce();
    expect(unref).toHaveBeenCalledOnce();

    complete(new Error("late process close"), "", "");
    const replacement = probe.read();
    expect(execute).toHaveBeenCalledTimes(2);
    await probe.close();
    await expect(replacement).resolves.toEqual(unavailableTemperatureTelemetry("probe-failed"));
  });

  it("settles and retires an active helper during close", async () => {
    const kill = vi.fn(() => true);
    const execute = ((
      _executable: string,
      _args: readonly string[],
      _options: Record<string, unknown>,
      _callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) =>
      ({
        kill,
        unref: vi.fn(),
        stdin: null,
        stdout: null,
        stderr: null,
      }) as unknown as ChildProcess) as unknown as typeof execFile;
    const probe = makeHostTemperatureProbeProcessForTest({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", windir: "C:\\Windows", SystemDrive: "C:" },
      isExecutable: (path) => path === WINDOWS_POWERSHELL,
      exec: execute,
    });

    const pending = probe.read();
    await probe.close();

    await expect(pending).resolves.toEqual(unavailableTemperatureTelemetry("probe-failed"));
    await expect(probe.read()).resolves.toEqual(unavailableTemperatureTelemetry("probe-failed"));
    expect(kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("handles an exec implementation that invokes its callback synchronously", async () => {
    const execute = ((
      _executable: string,
      _args: readonly string[],
      _options: Record<string, unknown>,
      callback: (error: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "[]\r\n", "");
      return {
        kill: vi.fn(),
        unref: vi.fn(),
        stdin: null,
        stdout: null,
        stderr: null,
      } as unknown as ChildProcess;
    }) as unknown as typeof execFile;
    const probe = makeHostTemperatureProbeProcessForTest({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", windir: "C:\\Windows", SystemDrive: "C:" },
      isExecutable: (path) => path === WINDOWS_POWERSHELL,
      exec: execute,
    });

    await expect(probe.read()).resolves.toEqual(unavailableTemperatureTelemetry("unsupported"));
    await expect(probe.read()).resolves.toEqual(unavailableTemperatureTelemetry("unsupported"));
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
