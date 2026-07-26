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

type FakeChild = ChildProcess & { readonly killSignals: string[] };

/** A helper that can be made to never emit `close`, which a real one can do. */
function makeFakeChild(options: { readonly withStdio?: boolean } = {}): FakeChild {
  const killSignals: string[] = [];
  const withStdio = options.withStdio ?? true;
  const child = new EventEmitter() as unknown as FakeChild;
  Object.assign(child, {
    stdout: withStdio ? new PassThrough() : null,
    stderr: withStdio ? new PassThrough() : null,
    stdin: null,
    killSignals,
    kill: (signal?: string) => {
      killSignals.push(signal ?? "SIGTERM");
      return true;
    },
  });
  return child;
}

function fakeSpawn(child: ChildProcess) {
  return (() => child) as unknown as typeof spawn;
}

describe("validatedWindowsSystemRoot", () => {
  it("accepts an OS-shaped root and normalizes separators", () => {
    expect(validatedWindowsSystemRoot({ SystemRoot: "C:\\Windows" })).toBe("C:\\Windows");
    expect(validatedWindowsSystemRoot({ SystemRoot: "C:/Windows/" })).toBe("C:\\Windows");
    expect(validatedWindowsSystemRoot({ SystemRoot: "  D:\\WinNT  " })).toBe("D:\\WinNT");
  });

  it("falls back to the default root only when the variable is absent", () => {
    expect(validatedWindowsSystemRoot({})).toBe("C:\\Windows");
    expect(validatedWindowsSystemRoot({ SystemRoot: "   " })).toBe("C:\\Windows");
  });

  it("reads the variable case-insensitively and prefers SystemRoot over windir", () => {
    expect(validatedWindowsSystemRoot({ systemroot: "C:\\Windows" })).toBe("C:\\Windows");
    expect(validatedWindowsSystemRoot({ SYSTEMROOT: "E:\\Win" })).toBe("E:\\Win");
    expect(validatedWindowsSystemRoot({ windir: "F:\\Win" })).toBe("F:\\Win");
    expect(validatedWindowsSystemRoot({ SystemRoot: "C:\\Windows", windir: "Z:\\Evil" })).toBe(
      "C:\\Windows",
    );
  });

  it.each([
    { label: "parent traversal", value: "C:\\Windows\\..\\Users\\public" },
    { label: "current-directory segment", value: "C:\\Windows\\.\\x" },
    { label: "UNC share", value: "\\\\attacker\\share" },
    { label: "relative path", value: "Windows" },
    { label: "bare drive-relative", value: "C:Windows" },
    { label: "wildcard", value: "C:\\Win*" },
    { label: "alternate data stream", value: "C:\\Windows:evil" },
    { label: "quote injection", value: 'C:\\Windows" "' },
    { label: "embedded newline", value: "C:\\Windows\nC:\\Evil" },
    { label: "NUL byte", value: "C:\\Windows\u0000" },
    { label: "oversized", value: `C:\\${"w".repeat(300)}` },
  ])("rejects a tampered SystemRoot: $label", ({ value }) => {
    expect(validatedWindowsSystemRoot({ SystemRoot: value })).toBeNull();
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
    expect(
      resolveTrustedGpuProbePath("win32", { SystemRoot: "C:\\Windows\\..\\Evil" }, () => true),
    ).toBeNull();
  });

  it.each(["darwin", "freebsd", "android", "aix"] as const)(
    "reports no trusted source on %s",
    (platform) => {
      expect(resolveTrustedGpuProbePath(platform, { PATH: "/usr/bin" }, () => true)).toBeNull();
    },
  );
});

describe("buildGpuProbeEnvironment", () => {
  it("passes only the loader-neutral variables the helper needs", () => {
    const environment = buildGpuProbeEnvironment({
      SystemRoot: "C:\\Windows",
      windir: "C:\\Windows",
      SystemDrive: "C:",
      TEMP: "C:\\Temp",
      TMPDIR: "/tmp",
    });

    expect(environment).toEqual({
      SystemRoot: "C:\\Windows",
      windir: "C:\\Windows",
      SystemDrive: "C:",
      TEMP: "C:\\Temp",
      TMPDIR: "/tmp",
    });
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
    const environment = buildGpuProbeEnvironment({ [name]: "sensitive-value", TEMP: "/tmp" });

    expect(environment).toEqual({ TEMP: "/tmp" });
    expect(JSON.stringify(environment)).not.toContain("sensitive-value");
  });

  it("matches allowed names case-insensitively and skips undefined values", () => {
    expect(buildGpuProbeEnvironment({ systemroot: "a", TeMp: "b", TmP: "c" })).toEqual({
      systemroot: "a",
      TeMp: "b",
      TmP: "c",
    });
    expect(buildGpuProbeEnvironment({ TEMP: undefined, PATH: "/bin" })).toEqual({});
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
    expect(call.env).toEqual({ SystemRoot: "C:\\Windows" });
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
  it("settles a caller even when the helper never emits close", async () => {
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
      });

      const pending = probe.read();
      let settled = false;
      void pending.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(1_000);
      expect(child.killSignals).toEqual(["SIGKILL"]);
      expect(settled).toBe(false);

      await vi.advanceTimersByTimeAsync(250);
      const result = await pending;
      expect(result.reason).toBe("probe-failed");
      // Killed once by the timeout and again by the force-settle deadline.
      expect(child.killSignals).toEqual(["SIGKILL", "SIGKILL"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps at most one live helper and refuses a second read until the first exits", async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild();
      let spawnCount = 0;
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: (() => {
          spawnCount += 1;
          return child;
        }) as unknown as typeof spawn,
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
      });

      const first = probe.read();
      await vi.advanceTimersByTimeAsync(1_250);
      expect((await first).reason).toBe("probe-failed");

      // The helper is force-settled but still live, so a second read must not
      // stack another process behind it.
      const second = await probe.read();
      expect(second.reason).toBe("probe-failed");
      expect(spawnCount).toBe(1);

      // Once the OS reports the exit, the slot is released.
      child.emit("close", 0);
      await vi.advanceTimersByTimeAsync(0);
      void probe.read();
      await vi.advanceTimersByTimeAsync(0);
      expect(spawnCount).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles probe-failed when the runtime hands back null stdio streams", async () => {
    vi.useFakeTimers();
    try {
      const child = makeFakeChild({ withStdio: false });
      const probe = makeGpuProbeProcessForTest({
        platform: "linux",
        env: {},
        isExecutableFile: () => true,
        spawnProcess: fakeSpawn(child),
        probeTimeoutMs: 1_000,
        forceSettleGraceMs: 250,
      });

      const pending = probe.read();
      // The kill deadline is installed before stdio is touched, so this path is
      // still bounded rather than depending on a `close` that may never arrive.
      expect(child.killSignals).toEqual(["SIGKILL"]);
      await vi.advanceTimersByTimeAsync(1_250);

      expect((await pending).reason).toBe("probe-failed");
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
    // The OS process is actually gone, not merely abandoned by its promise.
    expect(child.killed || child.exitCode !== null || child.signalCode !== null).toBe(true);
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

      let closed = false;
      void probe.close().then(() => {
        closed = true;
      });
      await vi.advanceTimersByTimeAsync(499);
      expect(closed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(closed).toBe(true);
      expect(child.killSignals).toContain("SIGKILL");
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
