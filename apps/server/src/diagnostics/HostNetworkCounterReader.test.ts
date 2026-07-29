import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  HOST_NETWORK_WINDOWS_ARGS,
  makeHostNetworkCounterReaderForTest,
  parseLinuxNetworkCounterSource,
  parseWindowsNetworkCounterOutput,
  resolveTrustedWindowsNetworkProbePath,
} from "./HostNetworkCounterReader.ts";

describe("HostNetworkCounterReader", () => {
  it("parses aggregate Linux counters without returning interface identity", () => {
    const result = parseLinuxNetworkCounterSource(
      [
        "Inter-| Receive | Transmit",
        " face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed",
        "lo: 100 1 0 0 0 0 0 0 200 1 0 0 0 0 0 0",
        "eth-secret: 300 2 0 0 0 0 0 0 400 2 0 0 0 0 0 0",
      ].join("\n"),
    );

    expect(result).toEqual({ receivedBytes: 400, transmittedBytes: 600 });
    expect(JSON.stringify(result)).not.toContain("eth-secret");
    expect(JSON.stringify(result)).not.toContain("lo");
  });

  it("rejects malformed, oversized, and unsafe counter output", () => {
    expect(parseWindowsNetworkCounterOutput("12,34")).toEqual({
      receivedBytes: 12,
      transmittedBytes: 34,
    });
    expect(parseWindowsNetworkCounterOutput("adapter,12,34")).toBeNull();
    expect(parseWindowsNetworkCounterOutput(`${Number.MAX_SAFE_INTEGER + 1},1`)).toBeNull();
    expect(parseLinuxNetworkCounterSource("eth0: 1 2")).toBeNull();
  });

  it("resolves only the fixed system PowerShell path", () => {
    const checked: string[] = [];
    expect(
      resolveTrustedWindowsNetworkProbePath({ SystemRoot: "C:\\Windows" }, (candidate) => {
        checked.push(candidate);
        return true;
      }),
    ).toBe("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    expect(checked).toEqual(["C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"]);
    expect(
      resolveTrustedWindowsNetworkProbePath(
        { SystemRoot: "C:\\Users\\attacker\\Windows" },
        () => true,
      ),
    ).toBeNull();
  });

  it("uses fixed argv, closed stdin, bounded output, and returns only two counters", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    const spawnProcess = vi.fn(() => child);
    const reader = makeHostNetworkCounterReaderForTest({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", PRIVATE_TOKEN: "do-not-forward" },
      isExecutableFile: () => true,
      spawnProcess: spawnProcess as never,
    });

    const pending = reader.read();
    child.stdout.write("1234,5678");
    child.emit("close", 0);

    await expect(pending).resolves.toEqual({
      receivedBytes: 1_234,
      transmittedBytes: 5_678,
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      HOST_NETWORK_WINDOWS_ARGS,
      expect.objectContaining({
        cwd: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0",
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    const spawnOptions = (spawnProcess.mock.calls[0] as unknown[] | undefined)?.[2] as
      | { readonly env?: NodeJS.ProcessEnv }
      | undefined;
    expect(spawnOptions?.env).not.toHaveProperty("PRIVATE_TOKEN");
  });

  it("disables module autoload and imports the protected NetAdapter module explicitly", () => {
    const script = HOST_NETWORK_WINDOWS_ARGS.at(-1);

    expect(script).toContain("$PSModuleAutoLoadingPreference='None'");
    expect(script).toContain(
      "$env:SystemRoot+'\\System32\\WindowsPowerShell\\v1.0\\Modules\\NetAdapter\\NetAdapter.psd1'",
    );
    expect(script).toContain("Microsoft.PowerShell.Core\\Import-Module");
    expect(script).toContain("NetAdapter\\Get-NetAdapterStatistics");
    expect(script).not.toMatch(/(?<!NetAdapter\\)Get-NetAdapterStatistics/u);
    expect(script).not.toContain("PSModulePath");
  });

  it("retires an errored helper slot even when close never arrives", async () => {
    const children = Array.from({ length: 2 }, () => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: PassThrough;
        stderr: PassThrough;
        kill: ReturnType<typeof vi.fn>;
        unref: ReturnType<typeof vi.fn>;
      };
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn(() => true);
      child.unref = vi.fn();
      return child;
    });
    const spawnProcess = vi.fn(() => children.shift()!);
    const reader = makeHostNetworkCounterReaderForTest({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      isExecutableFile: () => true,
      spawnProcess: spawnProcess as never,
    });

    const failed = reader.read();
    const first = spawnProcess.mock.results[0]!.value as (typeof children)[number];
    first.emit("error", new Error("spawn failed without close"));
    await expect(failed).resolves.toBeNull();

    const recovered = reader.read();
    const second = spawnProcess.mock.results[1]!.value as (typeof children)[number];
    second.stdout.write("99,101");
    second.emit("close", 0);
    await expect(recovered).resolves.toEqual({
      receivedBytes: 99,
      transmittedBytes: 101,
    });
    expect(spawnProcess).toHaveBeenCalledTimes(2);
  });

  it("retires a timed-out no-close helper and permits one bounded recovery", async () => {
    vi.useFakeTimers();
    try {
      const children = Array.from({ length: 2 }, () => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough;
          stderr: PassThrough;
          kill: ReturnType<typeof vi.fn>;
          unref: ReturnType<typeof vi.fn>;
        };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = vi.fn(() => true);
        child.unref = vi.fn();
        return child;
      });
      const spawnProcess = vi.fn(() => children.shift()!);
      const reader = makeHostNetworkCounterReaderForTest({
        platform: "win32",
        env: { SystemRoot: "C:\\Windows" },
        isExecutableFile: () => true,
        spawnProcess: spawnProcess as never,
        timeoutMs: 10,
        forceSettleGraceMs: 5,
        shutdownCloseGraceMs: 5,
      });

      const timedOut = reader.read();
      await vi.advanceTimersByTimeAsync(15);
      await expect(timedOut).resolves.toBeNull();

      const recovered = reader.read();
      const second = spawnProcess.mock.results[1]!.value as (typeof children)[number];
      second.stdout.write("10,20");
      second.emit("close", 0);
      await expect(recovered).resolves.toEqual({
        receivedBytes: 10,
        transmittedBytes: 20,
      });
      expect(spawnProcess).toHaveBeenCalledTimes(2);
      const closing = reader.close();
      await vi.advanceTimersByTimeAsync(5);
      await closing;
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases an exit-without-close record after bounded force settlement", async () => {
    vi.useFakeTimers();
    try {
      const children = Array.from({ length: 2 }, () => {
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough;
          stderr: PassThrough;
          kill: ReturnType<typeof vi.fn>;
          unref: ReturnType<typeof vi.fn>;
        };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = vi.fn(() => true);
        child.unref = vi.fn();
        return child;
      });
      const spawnProcess = vi.fn(() => children.shift()!);
      const reader = makeHostNetworkCounterReaderForTest({
        platform: "win32",
        env: { SystemRoot: "C:\\Windows" },
        isExecutableFile: () => true,
        spawnProcess: spawnProcess as never,
        timeoutMs: 10,
        forceSettleGraceMs: 5,
      });

      const exitedWithoutClose = reader.read();
      const first = spawnProcess.mock.results[0]!.value as (typeof children)[number];
      first.stdout.write("1,2");
      first.emit("exit", 0);
      await vi.advanceTimersByTimeAsync(15);
      await expect(exitedWithoutClose).resolves.toBeNull();

      const recovered = reader.read();
      const second = spawnProcess.mock.results[1]!.value as (typeof children)[number];
      second.stdout.write("30,40");
      second.emit("close", 0);
      await expect(recovered).resolves.toEqual({
        receivedBytes: 30,
        transmittedBytes: 40,
      });
      expect(spawnProcess).toHaveBeenCalledTimes(2);
      await reader.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("detaches a tracked helper when owner close lands between exit and close", async () => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: ReturnType<typeof vi.fn>;
      unref: ReturnType<typeof vi.fn>;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = vi.fn(() => true);
    child.unref = vi.fn();
    const reader = makeHostNetworkCounterReaderForTest({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      isExecutableFile: () => true,
      spawnProcess: (() => child) as never,
      shutdownCloseGraceMs: 10,
    });
    const pending = reader.read();
    child.emit("exit", 0);

    await expect(reader.close()).resolves.toBeUndefined();
    await expect(pending).resolves.toBeNull();
    expect(child.kill).toHaveBeenCalled();
    expect(child.unref).toHaveBeenCalled();
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    await expect(reader.read()).resolves.toBeNull();
  });
});
