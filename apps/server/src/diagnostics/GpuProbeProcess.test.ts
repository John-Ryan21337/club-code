import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { performance } from "node:perf_hooks";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { ServerSystemGpuTelemetry } from "@cafecode/contracts";
import * as Schema from "effect/Schema";

import {
  buildGpuProbeEnvironment,
  GPU_PROBE_ARGS,
  makeGpuProbeProcess,
  makeGpuProbeProcessForTest,
  resolveTrustedGpuProbePath,
  validatedWindowsSystemRoot,
} from "./GpuProbeProcess.ts";

const decodeGpuTelemetry = Schema.decodeUnknownSync(ServerSystemGpuTelemetry);

const WINDOWS_NVIDIA_SMI = "C:\\Windows\\System32\\nvidia-smi.exe";
const LINUX_NVIDIA_SMI = "/usr/bin/nvidia-smi";

const EXPECTED_ARGS = [
  "--query-gpu=name,index,utilization.gpu,memory.total,memory.used",
  "--format=csv,noheader,nounits",
];

interface SpawnCall {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: NodeJS.ProcessEnv;
  readonly shell: unknown;
  readonly stdio: unknown;
  readonly windowsHide: unknown;
}

/** Records the requested command/argv, then runs a real Node helper instead. */
function recordingSpawn(script: string) {
  const calls: SpawnCall[] = [];
  const children: ChildProcess[] = [];
  const spawnProcess = ((command: string, args: ReadonlyArray<string>, options: never) => {
    const opts = options as unknown as {
      env: NodeJS.ProcessEnv;
      shell: unknown;
      stdio: unknown;
      windowsHide: unknown;
    };
    calls.push({
      command,
      args: [...args],
      env: opts.env,
      shell: opts.shell,
      stdio: opts.stdio,
      windowsHide: opts.windowsHide,
    });
    const child = spawn(process.execPath, ["--eval", script], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    children.push(child);
    return child;
  }) as unknown as typeof spawn;
  return { calls, children, spawnProcess };
}

type FakeChild = ChildProcess & {
  readonly stdout: PassThrough | null;
  readonly stderr: PassThrough | null;
  readonly killSignals: string[];
  readonly unrefCalls: number[];
};

/** A helper that can be made to never emit `close`, which a real one can do. */
function makeFakeChild(
  options: {
    readonly withStdio?: boolean;
    readonly withStdout?: boolean;
    readonly withStderr?: boolean;
  } = {},
): FakeChild {
  const killSignals: string[] = [];
  const withStdio = options.withStdio ?? true;
  const unrefCalls: number[] = [];
  const child = new EventEmitter() as unknown as FakeChild;
  Object.assign(child, {
    stdout: (options.withStdout ?? withStdio) ? new PassThrough() : null,
    stderr: (options.withStderr ?? withStdio) ? new PassThrough() : null,
    stdin: null,
    killSignals,
    unrefCalls,
    kill: (signal?: string) => {
      killSignals.push(signal ?? "SIGTERM");
      return true;
    },
    unref: () => {
      unrefCalls.push(1);
    },
  });
  return child;
}

function fakeSpawn(child: ChildProcess) {
  return (() => child) as unknown as typeof spawn;
}

/**
 * Resolves once the OS process has actually been reaped. `child.killed` only
 * records that a signal was delivered, so termination assertions must wait for
 * a real `exit` rather than trusting the kill request.
 */
function waitForRealTermination(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const deadline = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(deadline);
      resolve();
    });
  });
}

describe("validatedWindowsSystemRoot", () => {
  it("accepts only a drive-root Windows directory and normalizes it", () => {
    expect(validatedWindowsSystemRoot({ SystemRoot: "C:\\Windows" })).toBe("C:\\Windows");
    expect(validatedWindowsSystemRoot({ SystemRoot: "C:/Windows/" })).toBe("C:\\Windows");
    expect(validatedWindowsSystemRoot({ SystemRoot: "  d:\\WINDOWS  ", SystemDrive: " d: " })).toBe(
      "D:\\Windows",
    );
  });

  it("derives the root from SystemDrive or the C drive when the root is absent", () => {
    expect(validatedWindowsSystemRoot({})).toBe("C:\\Windows");
    expect(validatedWindowsSystemRoot({ SystemDrive: "C:" })).toBe("C:\\Windows");
  });

  it("reads variables case-insensitively and accepts a non-C root only with a matching drive", () => {
    expect(validatedWindowsSystemRoot({ systemroot: "C:\\Windows" })).toBe("C:\\Windows");
    expect(validatedWindowsSystemRoot({ windir: "F:\\Windows", systemdrive: "F:" })).toBe(
      "F:\\Windows",
    );
    expect(
      validatedWindowsSystemRoot({
        SystemRoot: "f:/WINDOWS/",
        windir: "F:\\Windows",
        SystemDrive: "f:",
      }),
    ).toBe("F:\\Windows");
    expect(validatedWindowsSystemRoot({ SystemRoot: "D:\\Windows" })).toBeNull();
    expect(validatedWindowsSystemRoot({ SystemDrive: "D:" })).toBeNull();
    expect(validatedWindowsSystemRoot({ SystemRoot: "D:\\Windows", SystemDrive: "C:" })).toBeNull();
  });

  it.each([
    { label: "parent traversal", value: "C:\\Windows\\..\\Users\\public" },
    { label: "current-directory segment", value: "C:\\Windows\\.\\x" },
    { label: "nested user directory", value: "C:\\Users\\me\\evil" },
    { label: "nested system directory", value: "C:\\Windows\\System32" },
    { label: "non-Windows root name", value: "D:\\WinNT" },
    { label: "Unicode case-fold lookalike", value: "C:\\Windowſ" },
    { label: "UNC share", value: "\\\\attacker\\share" },
    { label: "relative path", value: "Windows" },
    { label: "bare drive-relative", value: "C:Windows" },
    { label: "wildcard", value: "C:\\Win*" },
    { label: "alternate data stream", value: "C:\\Windows:evil" },
    { label: "quote injection", value: 'C:\\Windows" "' },
    { label: "embedded newline", value: "C:\\Windows\nC:\\Evil" },
    { label: "NUL byte", value: "C:\\Windows\u0000" },
    { label: "blank value", value: "   " },
  ])("rejects a tampered SystemRoot: $label", ({ value }) => {
    expect(validatedWindowsSystemRoot({ SystemRoot: value })).toBeNull();
  });

  it.each(["C", "C:\\", "C:evil", "\\\\host\\share", "C:\n"])(
    "rejects a malformed SystemDrive: %s",
    (SystemDrive) => {
      expect(validatedWindowsSystemRoot({ SystemDrive })).toBeNull();
    },
  );

  it("rejects conflicting root aliases and case-duplicate environment keys", () => {
    expect(
      validatedWindowsSystemRoot({
        SystemRoot: "C:\\Windows",
        windir: "D:\\Windows",
        SystemDrive: "C:",
      }),
    ).toBeNull();
    expect(
      validatedWindowsSystemRoot({
        SystemRoot: "C:\\Windows",
        SYSTEMROOT: "C:\\Windows",
        SystemDrive: "C:",
      }),
    ).toBeNull();
    expect(
      validatedWindowsSystemRoot({
        SystemRoot: "C:\\Windows",
        SystemDrive: "C:",
        systemdrive: "C:",
      }),
    ).toBeNull();
  });
});

describe("resolveTrustedGpuProbePath", () => {
  it("resolves the fixed Windows System32 path under a validated SystemRoot", () => {
    const queried: string[] = [];
    const resolved = resolveTrustedGpuProbePath("win32", { SystemRoot: "C:\\Windows" }, (path) => {
      queried.push(path);
      return path === WINDOWS_NVIDIA_SMI;
    });

    expect(resolved).toBe(WINDOWS_NVIDIA_SMI);
    expect(queried).toEqual([WINDOWS_NVIDIA_SMI]);
  });

  it("preserves a non-C Windows install only when the canonical root tuple agrees", () => {
    const queried: string[] = [];
    const expected = "D:\\Windows\\System32\\nvidia-smi.exe";
    const resolved = resolveTrustedGpuProbePath(
      "win32",
      {
        SystemRoot: "d:/WINDOWS/",
        windir: "D:\\Windows",
        SystemDrive: "d:",
      },
      (path) => {
        queried.push(path);
        return path === expected;
      },
    );

    expect(resolved).toBe(expected);
    expect(queried).toEqual([expected]);
  });

  it("resolves only distro-owned Linux paths, in order", () => {
    const queried: string[] = [];
    const resolved = resolveTrustedGpuProbePath("linux", {}, (path) => {
      queried.push(path);
      return path === "/bin/nvidia-smi";
    });

    expect(resolved).toBe("/bin/nvidia-smi");
    expect(queried).toEqual([LINUX_NVIDIA_SMI, "/bin/nvidia-smi"]);
  });

  it("ignores a helper planted on PATH, in the workspace, or in a user bin dir", () => {
    const planted = [
      "/tmp/evil/nvidia-smi",
      "/home/user/.local/bin/nvidia-smi",
      "/usr/local/bin/nvidia-smi",
      "/workspace/node_modules/.bin/nvidia-smi",
      "C:\\Users\\me\\AppData\\Roaming\\npm\\nvidia-smi.exe",
    ];
    const queried: string[] = [];
    // Only the planted copies exist; nothing is installed in a trusted location.
    const isExecutable = (path: string) => {
      queried.push(path);
      return planted.includes(path);
    };
    const hostileEnv = {
      PATH: "/tmp/evil:/home/user/.local/bin:/usr/local/bin",
      Path: "C:\\Users\\me\\AppData\\Roaming\\npm",
      LD_LIBRARY_PATH: "/tmp/evil",
      SystemRoot: "C:\\Windows",
    };

    expect(resolveTrustedGpuProbePath("linux", hostileEnv, isExecutable)).toBeNull();
    expect(resolveTrustedGpuProbePath("win32", hostileEnv, isExecutable)).toBeNull();
    // Nothing outside the trusted candidate list was even probed.
    expect(queried).toEqual([LINUX_NVIDIA_SMI, "/bin/nvidia-smi", WINDOWS_NVIDIA_SMI]);
    for (const path of planted) {
      expect(queried).not.toContain(path);
    }
  });

  it("refuses to resolve when SystemRoot is tampered with, even if a helper exists", () => {
    const isExecutable = vi.fn(() => true);
    expect(
      resolveTrustedGpuProbePath("win32", { SystemRoot: "C:\\Windows\\..\\Evil" }, isExecutable),
    ).toBeNull();
    expect(
      resolveTrustedGpuProbePath("win32", { SystemRoot: "C:\\Users\\me\\evil" }, isExecutable),
    ).toBeNull();
    expect(
      resolveTrustedGpuProbePath(
        "win32",
        {
          SystemRoot: "C:\\Windows",
          SYSTEMROOT: "D:\\Windows",
          SystemDrive: "C:",
        },
        isExecutable,
      ),
    ).toBeNull();
    expect(isExecutable).not.toHaveBeenCalled();
  });

  it.each(["darwin", "freebsd", "android", "aix"] as const)(
    "reports no trusted source on %s",
    (platform) => {
      expect(resolveTrustedGpuProbePath(platform, { PATH: "/usr/bin" }, () => true)).toBeNull();
    },
  );
});

describe("buildGpuProbeEnvironment", () => {
  it("fails closed without forwarding inherited values when Windows root aliases conflict", () => {
    const environment = buildGpuProbeEnvironment(
      {
        SystemRoot: "c:/WINDOWS/",
        windir: "Z:\\Evil",
        SystemDrive: "c:",
        TEMP: "C:\\Temp",
        TMPDIR: "/tmp",
      },
      "win32",
    );

    expect(environment).toEqual({});
  });

  it.each([
    "PATH",
    "Path",
    "path",
    "LD_LIBRARY_PATH",
    "ld_library_path",
    "LD_PRELOAD",
    "DYLD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "NODE_OPTIONS",
    "ELECTRON_RUN_AS_NODE",
    "ANTHROPIC_API_KEY",
    "SHELL",
    "HOME",
  ])("drops the loader/secret variable %s", (name) => {
    const environment = buildGpuProbeEnvironment(
      { [name]: "sensitive-value", TEMP: "/tmp" },
      "linux",
    );

    expect(environment).toEqual({ TEMP: "/tmp" });
    expect(JSON.stringify(environment)).not.toContain("sensitive-value");
  });

  it("matches temporary-variable names case-insensitively and skips undefined values", () => {
    expect(buildGpuProbeEnvironment({ systemroot: "a", TeMp: "b", TmP: "c" }, "linux")).toEqual({
      TeMp: "b",
      TmP: "c",
    });
    expect(buildGpuProbeEnvironment({ TEMP: undefined, PATH: "/bin" }, "linux")).toEqual({});
    expect(buildGpuProbeEnvironment({ TeMp: "/private/tmp", PATH: "/usr/bin" }, "darwin")).toEqual({
      TeMp: "/private/tmp",
    });
  });

  it("does not forward a rejected Windows root into the helper environment", () => {
    expect(
      buildGpuProbeEnvironment(
        {
          SystemRoot: "C:\\Users\\me\\evil",
          windir: "C:\\Users\\me\\evil",
          SystemDrive: "C:",
          TEMP: "C:\\Temp",
        },
        "win32",
      ),
    ).toEqual({});
  });

  it("emits only canonical Windows root variables from an accepted tuple", () => {
    expect(
      buildGpuProbeEnvironment(
        {
          SYSTEMROOT: "d:/WINDOWS/",
          WiNdIr: "D:\\Windows",
          systemdrive: "d:",
          TEMP: "D:\\Users\\me\\Temp",
          TMP: "D:\\Users\\me\\Tmp",
          PATH: "D:\\Users\\me\\bin",
        },
        "win32",
      ),
    ).toEqual({
      SystemRoot: "D:\\Windows",
      windir: "D:\\Windows",
      SystemDrive: "D:",
    });
  });
});

describe("GpuProbeProcess spawn contract", () => {
  it("launches the trusted executable with fixed argv, no shell, and no inherited stdin", async () => {
    const recorder = recordingSpawn(
      String.raw`process.stdout.write("NVIDIA A, 0, 15, 24564, 3421\n")`,
    );
    const probe = makeGpuProbeProcessForTest({
      platform: "win32",
      env: { SystemRoot: "C:\\Windows", PATH: "C:\\Users\\me\\AppData\\Roaming\\npm" },
      isExecutableFile: (path) => path === WINDOWS_NVIDIA_SMI,
      spawnProcess: recorder.spawnProcess,
    });

    const result = await probe.read();
    await probe.close();

    expect(recorder.calls).toHaveLength(1);
    const call = recorder.calls[0]!;
    expect(call.command).toBe(WINDOWS_NVIDIA_SMI);
    expect(call.args).toEqual(EXPECTED_ARGS);
    expect([...GPU_PROBE_ARGS]).toEqual(EXPECTED_ARGS);
    expect(call.shell).toBe(false);
    expect(call.stdio).toEqual(["ignore", "pipe", "pipe"]);
    expect(call.windowsHide).toBe(true);
    expect(call.env).toEqual({
      SystemRoot: "C:\\Windows",
      windir: "C:\\Windows",
      SystemDrive: "C:",
    });
    expect(result.status).toBe("available");
    expect(decodeGpuTelemetry(result)).toEqual(result);
  });

  it("reports unsupported without spawning when no trusted helper exists", async () => {
    const recorder = recordingSpawn("");
    const probe = makeGpuProbeProcessForTest({
      platform: "darwin",
      env: { PATH: "/usr/bin" },
      spawnProcess: recorder.spawnProcess,
    });

    const result = await probe.read();

    expect(result.reason).toBe("unsupported");
    expect(recorder.calls).toEqual([]);
  });

  it("refuses the test seam outside a test environment", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => makeGpuProbeProcessForTest({ platform: "linux" })).toThrow(
        "GPU probe test overrides are unavailable.",
      );
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

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

describe("GpuProbeProcess output handling", () => {
  const cases = [
    {
      label: "valid multi-adapter CSV",
      script: String.raw`process.stdout.write("A, 0, 15, 24564, 3421\nB, 1, 80, 24564, 12000\n")`,
      expected: "available",
    },
    {
      label: "unsupported metric placeholder",
      script: String.raw`process.stdout.write("A, 0, [N/A], 24564, 3421\n")`,
      expected: "malformed",
    },
    {
      label: "non-CSV output",
      script: `process.stdout.write("not-csv-data")`,
      expected: "malformed",
    },
    {
      label: "non-zero exit",
      script: `process.stdout.write("A, 0, 15, 100, 10\n"); process.exit(1);`,
      expected: "probe-failed",
    },
    {
      label: "empty output",
      script: "",
      expected: "malformed",
    },
    {
      label: "output past the byte cap",
      script: `process.stdout.write("x".repeat(20000)); setInterval(() => {}, 1000);`,
      expected: "probe-failed",
    },
    {
      label: "stderr noise with a clean body",
      script: String.raw`process.stderr.write("driver warning: /opt/secret\n"); process.stdout.write("A, 0, 15, 100, 10\n")`,
      expected: "available",
    },
  ];

  it.each(cases)("maps $label to $expected", async ({ script, expected }) => {
    const recorder = recordingSpawn(script);
    const probe = makeGpuProbeProcessForTest({
      platform: "linux",
      env: {},
      isExecutableFile: (path) => path === LINUX_NVIDIA_SMI,
      spawnProcess: recorder.spawnProcess,
      probeTimeoutMs: 3_000,
      forceSettleGraceMs: 500,
    });

    const result = await probe.read();
    await probe.close();

    const actual = result.status === "available" ? "available" : result.reason;
    expect(actual).toBe(expected);
    expect(decodeGpuTelemetry(result)).toEqual(result);
    // Nothing the helper printed on stderr reaches the caller.
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("GpuProbeProcess lifetime bounds", () => {
  it("settles and makes a final bounded reap attempt when the helper never terminates", async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild();
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: fakeSpawn(child),
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        retiredReapGraceMs: 100,
        shutdownCloseGraceMs: 50,
      });

      const pending = probe.read();
      let settled = false;
      void pending.then(() => {
        settled = true;
      });

      expect(() => {
        child.emit("error", new Error("first kill error"));
        child.emit("error", new Error("second kill error"));
      }).not.toThrow();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(child.killSignals).toEqual(["SIGKILL"]);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(250);
      const result = await pending;
      expect(result.reason).toBe("probe-failed");
      // Killed once by the timeout and again by the force-settle deadline.
      expect(child.killSignals).toEqual(["SIGKILL", "SIGKILL"]);

      await vi.advanceTimersByTimeAsync(100);
      expect(child.killSignals).toEqual(["SIGKILL", "SIGKILL", "SIGKILL"]);

      const closing = probe.close();
      await vi.advanceTimersByTimeAsync(50);
      await closing;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases the active slot after bounded retirement and admits healthy replacements", async () => {
    vi.useFakeTimers();
    try {
      const first = makeFakeChild();
      const second = makeFakeChild();
      const third = makeFakeChild();
      const children = [first, second, third];
      let spawnCount = 0;
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: (() => {
          const child = children[spawnCount];
          spawnCount += 1;
          if (!child) throw new Error("unexpected fourth spawn");
          return child;
        }) as unknown as typeof spawn,
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        retiredReapGraceMs: 100,
        shutdownCloseGraceMs: 50,
      });

      const firstRead = probe.read();
      const concurrent = await probe.read();
      expect(concurrent.reason).toBe("probe-failed");
      expect(spawnCount).toBe(1);

      await vi.advanceTimersByTimeAsync(1_250);
      expect((await firstRead).reason).toBe("probe-failed");

      const secondRead = probe.read();
      expect(spawnCount).toBe(2);
      second.stdout!.write("NVIDIA A, 0, 15, 24564, 3421\n");
      second.emit("close", 0);
      expect((await secondRead).status).toBe("available");

      // The original helper still has not terminated, but one bounded
      // quarantine entry does not pin later healthy samples.
      const thirdRead = probe.read();
      expect(spawnCount).toBe(3);
      third.stdout!.write("NVIDIA A, 0, 20, 24564, 4000\n");
      third.emit("close", 0);
      expect((await thirdRead).status).toBe("available");

      const closing = probe.close();
      await vi.advanceTimersByTimeAsync(50);
      await closing;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens a bounded circuit after two unreaped helpers and recovers on a late exit", async () => {
    vi.useFakeTimers();
    try {
      const first = makeFakeChild();
      const second = makeFakeChild();
      const recovered = makeFakeChild();
      const children = [first, second, recovered];
      let spawnCount = 0;
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: (() => {
          const child = children[spawnCount];
          spawnCount += 1;
          if (!child) throw new Error("unbounded GPU helper admission");
          return child;
        }) as unknown as typeof spawn,
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        retiredReapGraceMs: 100,
        shutdownCloseGraceMs: 50,
      });

      const firstRead = probe.read();
      await vi.advanceTimersByTimeAsync(1_250);
      expect((await firstRead).reason).toBe("probe-failed");

      const secondRead = probe.read();
      await vi.advanceTimersByTimeAsync(1_250);
      expect((await secondRead).reason).toBe("probe-failed");

      // A third unkillable process is never started. The two-child cap is an
      // explicit circuit breaker, not another permanently occupied active slot.
      expect((await probe.read()).reason).toBe("probe-failed");
      expect(spawnCount).toBe(2);

      first.emit("exit", null, "SIGKILL");
      await vi.advanceTimersByTimeAsync(0);

      const recoveredRead = probe.read();
      expect(spawnCount).toBe(3);
      recovered.stdout!.write("NVIDIA A, 0, 25, 24564, 5000\n");
      recovered.emit("close", 0);
      expect((await recoveredRead).status).toBe("available");

      const closing = probe.close();
      await vi.advanceTimersByTimeAsync(50);
      await closing;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not consume circuit capacity when the helper exits but never closes", async () => {
    vi.useFakeTimers();
    try {
      // A grandchild inheriting the pipes is the realistic reason `close` never
      // arrives even though the helper itself exited. That must stay repeatable:
      // an already-exited helper is not OS-unreaped and must never occupy the
      // bounded quarantine that guards the circuit.
      const children = [makeFakeChild(), makeFakeChild(), makeFakeChild(), makeFakeChild()];
      let spawnCount = 0;
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: (() => {
          const child = children[spawnCount];
          spawnCount += 1;
          if (!child) throw new Error("unexpected extra spawn");
          return child;
        }) as unknown as typeof spawn,
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        retiredReapGraceMs: 100,
        shutdownCloseGraceMs: 50,
      });

      for (const child of children.slice(0, 3)) {
        const pending = probe.read();
        child.emit("exit", 0, null);
        await vi.advanceTimersByTimeAsync(1_250);
        expect((await pending).reason).toBe("probe-failed");
        // Killed by the timeout and by force-settle, then dropped entirely: no
        // quarantine entry, so no further reap deadline is scheduled.
        expect(child.killSignals).toEqual(["SIGKILL", "SIGKILL"]);
        expect(vi.getTimerCount()).toBe(0);
      }

      expect(spawnCount).toBe(3);
      const healthy = children[3]!;
      const healthyRead = probe.read();
      expect(spawnCount).toBe(4);
      healthy.stdout!.write("NVIDIA A, 0, 15, 24564, 3421\n");
      healthy.emit("close", 0);
      expect((await healthyRead).status).toBe("available");

      await probe.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still parses helper output delivered between exit and close", async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild();
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: fakeSpawn(child),
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        retiredReapGraceMs: 100,
        shutdownCloseGraceMs: 50,
      });

      const pending = probe.read();
      child.stdout!.write("NVIDIA A, 0, 15, 24564, 3421\n");
      // `exit` precedes the pipe drain. The read must not settle early and must
      // not drop the buffered tail that arrives before `close`.
      child.emit("exit", 0, null);
      child.stdout!.write("NVIDIA B, 1, 80, 24564, 12000\n");
      child.emit("close", 0);

      const result = await pending;
      expect(result.status).toBe("available");
      expect(result.adapters.map((adapter) => adapter.index)).toEqual([0, 1]);
      expect(decodeGpuTelemetry(result)).toEqual(result);

      expect(vi.getTimerCount()).toBe(0);
      await probe.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores circuit capacity when a quarantined helper finally closes", async () => {
    vi.useFakeTimers();
    try {
      const first = makeFakeChild();
      const second = makeFakeChild();
      const recovered = makeFakeChild();
      const children = [first, second, recovered];
      let spawnCount = 0;
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: (() => {
          const child = children[spawnCount];
          spawnCount += 1;
          if (!child) throw new Error("unbounded GPU helper admission");
          return child;
        }) as unknown as typeof spawn,
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        retiredReapGraceMs: 100,
        shutdownCloseGraceMs: 50,
      });

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const pending = probe.read();
        await vi.advanceTimersByTimeAsync(1_250);
        expect((await pending).reason).toBe("probe-failed");
      }
      expect(spawnCount).toBe(2);
      expect((await probe.read()).reason).toBe("probe-failed");
      expect(spawnCount).toBe(2);

      second.emit("close", null, "SIGKILL");
      await vi.advanceTimersByTimeAsync(0);

      const recoveredRead = probe.read();
      expect(spawnCount).toBe(3);
      recovered.stdout!.write("NVIDIA A, 0, 25, 24564, 5000\n");
      recovered.emit("close", 0);
      expect((await recoveredRead).status).toBe("available");

      const closing = probe.close();
      await vi.advanceTimersByTimeAsync(50);
      await closing;
      expect(first.killSignals).toContain("SIGKILL");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("isolates late retired-child events from the replacement read", async () => {
    vi.useFakeTimers();
    try {
      const retired = makeFakeChild();
      const replacement = makeFakeChild();
      const children = [retired, replacement];
      let spawnCount = 0;
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: (() => children[spawnCount++]!) as unknown as typeof spawn,
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        retiredReapGraceMs: 100,
        shutdownCloseGraceMs: 50,
      });

      const retiredRead = probe.read();
      let retiredResolutionCount = 0;
      void retiredRead.then(() => {
        retiredResolutionCount += 1;
      });
      await vi.advanceTimersByTimeAsync(1_250);
      expect((await retiredRead).reason).toBe("probe-failed");
      expect(retiredResolutionCount).toBe(1);

      const replacementRead = probe.read();
      let replacementSettled = false;
      void replacementRead.then(() => {
        replacementSettled = true;
      });

      // All of these belong to the retired record. They cannot settle, fail,
      // or release the active replacement's admission slot.
      expect(retired.stdout!.listenerCount("data")).toBe(0);
      retired.stdout!.emit("data", "late, invalid, output");
      retired.stderr!.emit("error", new Error("late retired stderr error"));
      retired.emit("error", new Error("late retired error"));
      retired.emit("exit", null, "SIGKILL");
      retired.emit("close", 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(retiredResolutionCount).toBe(1);
      expect(replacementSettled).toBe(false);
      expect((await probe.read()).reason).toBe("probe-failed");
      expect(spawnCount).toBe(2);

      replacement.stdout!.write("NVIDIA A, 0, 30, 24564, 6000\n");
      replacement.emit("close", 0);
      expect((await replacementRead).status).toBe("available");

      // Lifecycle handlers are detached after termination, while one static
      // non-capturing error guard keeps an impossible-but-late error non-fatal.
      expect(() => retired.emit("error", new Error("post-cleanup error"))).not.toThrow();

      await probe.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retires immediately and frees the slot when the runtime hands back null stdio", async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild({ withStdio: false });
      const replacement = makeFakeChild();
      const children: FakeChild[] = [child, replacement];
      let spawnCount = 0;
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: (() => children[spawnCount++]!) as unknown as typeof spawn,
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        retiredReapGraceMs: 100,
        shutdownCloseGraceMs: 50,
      });

      const pending = probe.read();
      // A read that can never observe output is retired at once instead of
      // parking the single admission slot for the full force-settle window.
      expect(child.killSignals).toEqual(["SIGKILL"]);
      expect((await pending).reason).toBe("probe-failed");

      const replacementRead = probe.read();
      expect(spawnCount).toBe(2);
      replacement.stdout!.write("NVIDIA A, 0, 15, 24564, 3421\n");
      replacement.emit("close", 0);
      expect((await replacementRead).status).toBe("available");

      // The unusable child receives exactly one bounded reap attempt.
      await vi.advanceTimersByTimeAsync(100);
      expect(child.killSignals).toEqual(["SIGKILL", "SIGKILL"]);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(child.killSignals).toEqual(["SIGKILL", "SIGKILL"]);

      const closing = probe.close();
      await vi.advanceTimersByTimeAsync(50);
      await closing;
      expect(child.unrefCalls).toEqual([1]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("guards and destroys a partial stdio pipe before delayed errors can escape", async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild({ withStdout: true, withStderr: false });
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: fakeSpawn(child),
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        retiredReapGraceMs: 100,
        shutdownCloseGraceMs: 50,
      });

      expect((await probe.read()).reason).toBe("probe-failed");
      expect(child.stdout!.destroyed).toBe(true);
      expect(() =>
        child.stdout!.emit("error", new Error("late partial-stdio error")),
      ).not.toThrow();

      const closing = probe.close();
      await vi.advanceTimersByTimeAsync(50);
      await closing;
      expect(child.unrefCalls).toEqual([1]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes a retired helper immediately when its close event finally arrives", async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild();
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: fakeSpawn(child),
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        retiredReapGraceMs: 100,
        shutdownCloseGraceMs: 5_000,
      });

      const pending = probe.read();
      await vi.advanceTimersByTimeAsync(1_250);
      expect((await pending).reason).toBe("probe-failed");

      child.emit("close", null, "SIGKILL");
      await vi.advanceTimersByTimeAsync(0);

      let closeSettled = false;
      void probe.close().then(() => {
        closeSettled = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(closeSettled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reaps a still-running helper on close and returns within the shutdown grace", async () => {
    const recorder = recordingSpawn("setInterval(() => {}, 1000)");
    const probe = makeGpuProbeProcessForTest({
      platform: "linux",
      env: {},
      isExecutableFile: () => true,
      spawnProcess: recorder.spawnProcess,
      probeTimeoutMs: 20,
      forceSettleGraceMs: 20,
      shutdownCloseGraceMs: 2_000,
    });

    const startedAt = performance.now();
    expect((await probe.read()).reason).toBe("probe-failed");
    await probe.close();
    const elapsed = performance.now() - startedAt;

    const child = recorder.children[0]!;
    await waitForRealTermination(child, 10_000);
    // The OS process is actually gone, not merely abandoned by its promise.
    // `killed` alone would pass for a helper that survived the signal.
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(elapsed).toBeLessThan(10_000);
  });

  it("returns from close within the grace even if a child never exits", async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild();
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: fakeSpawn(child),
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        shutdownCloseGraceMs: 500,
      });

      void probe.read();
      await vi.advanceTimersByTimeAsync(1_250);
      // Retirement releases admission but retains the Node process handle:
      // the owner still promises a bounded shutdown reap and late-exit
      // observation while it remains open.
      expect(child.unrefCalls).toEqual([]);

      let closed = false;
      void probe.close().then(() => {
        closed = true;
      });
      // The shutdown sweep kills immediately, but releasing the handle before
      // its grace expires could let an otherwise-idle Node exit before close()
      // settles.
      await vi.advanceTimersByTimeAsync(0);
      expect(child.killSignals).toContain("SIGKILL");
      expect(child.unrefCalls).toEqual([]);
      await vi.advanceTimersByTimeAsync(499);
      expect(closed).toBe(false);
      expect(child.unrefCalls).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(closed).toBe(true);
      expect(child.killSignals).toContain("SIGKILL");
      expect(child.unrefCalls).toEqual([1]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("finishes the shutdown sweep even if one child's cleanup throws", async () => {
    vi.useFakeTimers();
    try {
      const hostile = makeFakeChild();
      const healthy = makeFakeChild();
      // Hostile listener bookkeeping and unref behavior must not abort the
      // sweep, strand the second helper, retain tracking state, or reject close.
      Object.assign(hostile, {
        removeListener: () => {
          throw new Error("hostile child cleanup");
        },
        unref: () => {
          throw new Error("hostile child unref");
        },
      });
      const children = [hostile, healthy];
      let spawnCount = 0;
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: (() => children[spawnCount++]!) as unknown as typeof spawn,
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        retiredReapGraceMs: 100,
        shutdownCloseGraceMs: 50,
      });

      const hostileRead = probe.read();
      await vi.advanceTimersByTimeAsync(1_250);
      expect((await hostileRead).reason).toBe("probe-failed");

      const healthyRead = probe.read();
      const closing = probe.close();
      await vi.advanceTimersByTimeAsync(50);
      await expect(closing).resolves.toBeUndefined();

      expect((await healthyRead).reason).toBe("probe-failed");
      expect(hostile.killSignals.length).toBeGreaterThan(0);
      expect(healthy.killSignals).toEqual(["SIGKILL"]);
      expect(healthy.unrefCalls).toEqual([1]);
      expect(vi.getTimerCount()).toBe(0);
      expect((await probe.read()).reason).toBe("probe-failed");
      expect(spawnCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("disposes an active and a retired helper without double settlement or timer leaks", async () => {
    vi.useFakeTimers();
    try {
      const retired = makeFakeChild();
      const active = makeFakeChild();
      const children = [retired, active];
      let spawnCount = 0;
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: (() => children[spawnCount++]!) as unknown as typeof spawn,
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
        retiredReapGraceMs: 100,
        shutdownCloseGraceMs: 500,
      });

      const retiredRead = probe.read();
      await vi.advanceTimersByTimeAsync(1_250);
      expect((await retiredRead).reason).toBe("probe-failed");

      const activeRead = probe.read();
      let activeResolutionCount = 0;
      void activeRead.then(() => {
        activeResolutionCount += 1;
      });

      let closeSettled = false;
      const firstClose = probe.close();
      void firstClose.then(() => {
        closeSettled = true;
      });
      expect(probe.close()).toBe(firstClose);
      await vi.advanceTimersByTimeAsync(0);
      expect((await activeRead).reason).toBe("probe-failed");
      expect(activeResolutionCount).toBe(1);
      expect(closeSettled).toBe(false);
      expect(retired.killSignals).toEqual(["SIGKILL", "SIGKILL", "SIGKILL"]);
      expect(active.killSignals).toEqual(["SIGKILL"]);

      await vi.advanceTimersByTimeAsync(499);
      expect(closeSettled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await firstClose;
      expect(closeSettled).toBe(true);
      expect(retired.unrefCalls).toEqual([1]);
      expect(active.unrefCalls).toEqual([1]);
      expect(vi.getTimerCount()).toBe(0);

      expect((await probe.read()).reason).toBe("probe-failed");
      expect(spawnCount).toBe(2);

      // Owner disposal detached per-read closures. Late process and stream
      // errors are swallowed by static guards and cannot re-settle the caller.
      expect(() => retired.emit("error", new Error("late retired error"))).not.toThrow();
      expect(() => active.emit("error", new Error("late active error"))).not.toThrow();
      expect(() => active.stdout!.emit("error", new Error("late stdout error"))).not.toThrow();
      active.emit("exit", null, "SIGKILL");
      active.emit("close", 0);
      await vi.advanceTimersByTimeAsync(0);
      expect(activeResolutionCount).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to start new work after close", async () => {
    const recorder = recordingSpawn("");
    const probe = makeGpuProbeProcessForTest({
      platform: "linux",
      env: {},
      isExecutableFile: () => true,
      spawnProcess: recorder.spawnProcess,
    });

    await probe.close();
    const result = await probe.read();

    expect(result.reason).toBe("probe-failed");
    expect(recorder.calls).toEqual([]);
    // close is idempotent
    await expect(probe.close()).resolves.toBeUndefined();
  });

  it("settles probe-failed when spawn itself throws", async () => {
    const probe = makeGpuProbeProcessForTest({
      platform: "linux",
      env: {},
      isExecutableFile: () => true,
      spawnProcess: (() => {
        throw new Error("EACCES /usr/bin/nvidia-smi");
      }) as unknown as typeof spawn,
    });

    const result = await probe.read();

    expect(result.reason).toBe("probe-failed");
    expect(JSON.stringify(result)).not.toContain("EACCES");
  });
});
