// @effect-diagnostics nodeBuiltinImport:off globalTimers:off

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { join, parse } from "node:path";
import { PassThrough } from "node:stream";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

import {
  buildProjectVolumeProbeEnvironment,
  makeProjectVolumeProbeProcess,
  makeProjectVolumeProbeProcessForTest,
} from "./ProjectVolumeProbeProcess.ts";

describe("ProjectVolumeProbeProcess", () => {
  it("reads the current project volume through the isolated helper", async () => {
    const probe = makeProjectVolumeProbeProcess();
    try {
      const counters = await probe.read(process.cwd(), 2_000);

      expect(counters.blockSize).toBeGreaterThan(0n);
      expect(counters.blocks).toBeGreaterThan(0n);
      expect(counters.freeBlocks).toBeGreaterThanOrEqual(counters.availableBlocks);
      expect(counters.blocks).toBeGreaterThanOrEqual(counters.freeBlocks);
    } finally {
      await probe.close();
    }
  });

  it("reads the drive for a missing Windows project and preserves other platform failures", async () => {
    const probe = makeProjectVolumeProbeProcess();
    const privatePath = join(process.cwd(), "private-telemetry-path-that-does-not-exist");
    try {
      if (process.platform === "win32") {
        const counters = await probe.read(privatePath, 2_000);
        const driveCounters = await probe.read(parse(privatePath).root, 2_000);
        expect(counters.blockSize).toBe(driveCounters.blockSize);
        expect(counters.blocks).toBe(driveCounters.blocks);
        return;
      }
      const error = await probe.read(privatePath, 2_000).catch((cause: unknown) => cause);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Project-volume probe failed.");
      expect((error as Error).message).not.toContain(privatePath);
      expect((error as Error).stack ?? "").not.toContain(privatePath);
    } finally {
      await probe.close();
    }
  });

  describe("missing project fallback boundary", () => {
    async function runProbe(platform: string, workspaceRoot: string, errors: string[]) {
      let script = "";
      const probe = makeProjectVolumeProbeProcessForTest({
        spawnProcess: ((_executable: string, args: string[]) => {
          script = args[1]!;
          throw new Error("Capture helper without starting a process.");
        }) as never,
      });
      await expect(probe.read(workspaceRoot, 2_000)).rejects.toThrow(
        "Project-volume probe failed.",
      );
      await probe.close();
      expect(script).toContain("statfs");

      const statfs = vi.fn(async () => {
        const code = errors.shift();
        if (code) throw Object.assign(new Error("private path detail"), { code });
        return { bsize: 4096n, blocks: 100n, bfree: 40n, bavail: 30n };
      });
      const setDeadline = vi.fn(() => 1);
      const clearDeadline = vi.fn();
      const output = await new Promise<string | null>((resolve) => {
        runInNewContext(script, {
          require: (name: string) => {
            expect(name).toBe("node:fs");
            return {
              readFileSync: () => JSON.stringify({ workspaceRoot, timeoutMs: 2_000 }),
              promises: { statfs },
            };
          },
          process: {
            platform,
            stdout: { write: resolve },
            exit: () => resolve(null),
            set exitCode(_value: number) {
              resolve(null);
            },
          },
          setTimeout: setDeadline,
          clearTimeout: clearDeadline,
        });
      });
      expect(setDeadline).toHaveBeenCalledTimes(1);
      expect(clearDeadline).toHaveBeenCalledTimes(1);
      return { output, paths: statfs.mock.calls.map((args) => (args as unknown[])[0]) };
    }

    it.each(["ENOENT", "ENOTDIR"])(
      "retries the drive once for %s within the same deadline",
      async (code) => {
        const result = await runProbe("win32", "M:\\deleted\\project", [code]);
        expect(result.paths).toEqual(["M:\\deleted\\project", "M:\\"]);
        expect(JSON.parse(result.output!)).toEqual(["4096", "100", "40", "30"]);
      },
    );

    it("accepts forward slashes without changing the drive", async () => {
      const result = await runProbe("win32", "m:/deleted/project", ["ENOENT"]);
      expect(result.paths).toEqual(["m:/deleted/project", "m:/"]);
      expect(result.output).not.toBeNull();
    });

    it("keeps existing projects on their exact volume", async () => {
      const result = await runProbe("win32", "M:\\mounted\\project", []);
      expect(result.paths).toEqual(["M:\\mounted\\project"]);
      expect(result.output).not.toBeNull();
    });

    it.each([
      ["linux", "M:/deleted/project", "ENOENT"],
      ["darwin", "/deleted/project", "ENOENT"],
      ["win32", "M:\\deleted", "EACCES"],
      ["win32", "M:\\deleted", "EIO"],
      ["win32", "M:relative", "ENOENT"],
      ["win32", "\\relative", "ENOENT"],
      ["win32", "\\\\server\\share\\deleted", "ENOENT"],
      ["win32", "\\\\?\\M:\\deleted", "ENOENT"],
      ["win32", "\\\\.\\M:\\deleted", "ENOENT"],
      ["win32", "M:\\deleted:stream", "ENOENT"],
      ["win32", "M:\\deleted\u0000path", "ENOENT"],
    ])("does not fall back for %s %s %s", async (platform, path, code) => {
      const result = await runProbe(platform, path, [code]);
      expect(result.paths).toEqual([path]);
      expect(result.output).toBeNull();
    });

    it("returns no private detail when the drive read also fails", async () => {
      const result = await runProbe("win32", "M:\\deleted", ["ENOENT", "EIO"]);
      expect(result.paths).toEqual(["M:\\deleted", "M:\\"]);
      expect(result.output).toBeNull();
    });
  });

  it("passes only the runtime environment needed by a packaged helper", () => {
    const environment = buildProjectVolumeProbeEnvironment({
      PATH: "test-path",
      SystemRoot: "test-system-root",
      TEMP: "test-temp",
      NODE_OPTIONS: "--require private-hook.cjs",
      ANTHROPIC_API_KEY: "private-claude-key",
      OPENAI_API_KEY: "private-openai-key",
    });

    expect(environment).toEqual({
      PATH: "test-path",
      SystemRoot: "test-system-root",
      TEMP: "test-temp",
      ELECTRON_RUN_AS_NODE: "1",
    });
    expect(JSON.stringify(environment)).not.toContain("private");
  });

  it("kills a helper that ignores the child-owned deadline and settles only after close", async () => {
    const probe = makeProjectVolumeProbeProcessForTest({
      probeScript: "process.stdin.resume(); setInterval(() => undefined, 1000);",
      parentKillGraceMs: 20,
    });
    const startedAt = performance.now();

    const error = await probe.read(process.cwd(), 20).catch((cause: unknown) => cause);
    const elapsedMs = performance.now() - startedAt;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Project-volume probe failed.");
    expect(elapsedMs).toBeGreaterThanOrEqual(25);
    await probe.close();
  });

  it("kills and awaits every live helper during owner shutdown", async () => {
    const probe = makeProjectVolumeProbeProcessForTest({
      probeScript: "process.stdin.resume(); setInterval(() => undefined, 1000);",
    });
    const pending = probe.read(process.cwd(), 10_000).catch((cause: unknown) => cause);
    await new Promise((resolve) => setTimeout(resolve, 25));

    await probe.close();
    const error = await pending;

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Project-volume probe failed.");
    await expect(probe.read(process.cwd(), 20)).rejects.toThrow("Project-volume probe failed.");
  });

  it("bounds owner shutdown when a helper does not acknowledge termination", async () => {
    let killCount = 0;
    const probe = makeProjectVolumeProbeProcessForTest({
      probeScript: `
        process.stdin.resume();
        setTimeout(() => process.exit(1), 100);
        setInterval(() => undefined, 1000);
      `,
      shutdownCloseGraceMs: 10,
      killProcess: () => {
        killCount += 1;
        return false;
      },
    });
    const pending = probe.read(process.cwd(), 1_000).catch((cause: unknown) => cause);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const startedAt = performance.now();

    await probe.close();
    const closeElapsedMs = performance.now() - startedAt;

    expect(closeElapsedMs).toBeLessThan(75);
    await probe.close();
    expect(killCount).toBe(1);
    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Project-volume probe failed.");
  });

  it("settles, detaches, and unrefs a helper that never emits exit or close", async () => {
    vi.useFakeTimers();
    try {
      const child = new EventEmitter() as EventEmitter & {
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
        kill: ReturnType<typeof vi.fn>;
        unref: ReturnType<typeof vi.fn>;
      };
      child.stdin = new PassThrough();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = vi.fn(() => false);
      child.unref = vi.fn();
      const probe = makeProjectVolumeProbeProcessForTest({
        spawnProcess: (() => child as unknown as ChildProcess) as never,
        shutdownCloseGraceMs: 10,
      });
      const pending = probe.read(process.cwd(), 10_000).catch((cause: unknown) => cause);

      const closing = probe.close();
      await vi.advanceTimersByTimeAsync(10);
      await expect(closing).resolves.toBeUndefined();
      const error = await pending;

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Project-volume probe failed.");
      expect(child.kill).toHaveBeenCalledWith("SIGKILL");
      expect(child.unref).toHaveBeenCalledTimes(1);
      expect(child.stdin.destroyed).toBe(true);
      expect(child.stdout.destroyed).toBe(true);
      expect(child.stderr.destroyed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 60_001])(
    "rejects an invalid timeout before launching a helper: %s",
    async (timeoutMs) => {
      let killCount = 0;
      const probe = makeProjectVolumeProbeProcessForTest({
        probeScript: "process.stdin.resume(); setInterval(() => undefined, 1000);",
        killProcess: () => {
          killCount += 1;
          return true;
        },
      });
      try {
        await expect(probe.read(process.cwd(), timeoutMs)).rejects.toThrow(
          "Project-volume probe failed.",
        );
        expect(killCount).toBe(0);
      } finally {
        await probe.close();
      }
    },
  );

  it("contains a throwing test kill implementation and still settles on child close", async () => {
    const probe = makeProjectVolumeProbeProcessForTest({
      probeScript: `
        process.stdin.resume();
        setTimeout(() => process.exit(1), 100);
        setInterval(() => undefined, 1000);
      `,
      killProcess: () => {
        throw new Error("private kill detail");
      },
      parentKillGraceMs: 20,
    });

    const error = await probe.read(process.cwd(), 20).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Project-volume probe failed.");
    await probe.close();
  });

  it.each([
    {
      name: "non-JSON output",
      probeScript: 'process.stdin.resume(); process.stdout.write("not-json");',
    },
    {
      name: "wrong-arity output",
      probeScript: 'process.stdin.resume(); process.stdout.write(JSON.stringify(["1","2"]));',
    },
    {
      name: "non-decimal output",
      probeScript:
        'process.stdin.resume(); process.stdout.write(JSON.stringify(["1","2","3","4x"]));',
    },
    {
      name: "oversized output",
      probeScript: 'process.stdin.resume(); process.stdout.write("x".repeat(4097));',
    },
  ])("sanitizes $name", async ({ probeScript }) => {
    const probe = makeProjectVolumeProbeProcessForTest({ probeScript });
    try {
      const error = await probe.read(process.cwd(), 2_000).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Project-volume probe failed.");
      expect((error as Error).message).not.toContain(probeScript);
    } finally {
      await probe.close();
    }
  });

  it("isolates two concurrent reads in separate helpers", async () => {
    const probe = makeProjectVolumeProbeProcessForTest({
      probeScript: `
        process.stdin.resume();
        setTimeout(() => {
          process.stdout.write(JSON.stringify(["1", "100", "25", "25"]));
        }, 25);
      `,
    });
    try {
      const [left, right] = await Promise.all([
        probe.read("first-project-root", 2_000),
        probe.read("second-project-root", 2_000),
      ]);
      expect(left).toEqual(right);
      expect(left).toEqual({
        blockSize: 1n,
        blocks: 100n,
        freeBlocks: 25n,
        availableBlocks: 25n,
      });
    } finally {
      await probe.close();
    }
  });
});
