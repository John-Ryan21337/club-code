import { type ChildProcess, type execFile } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import {
  createWindowsSpeechRunnerForTest,
  windowsPowerShellExecutablePath,
} from "./WindowsCompletionSpeech.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("closes stdin and bounds unreaped helpers while settling callers independently", async () => {
  vi.useFakeTimers();
  vi.stubEnv("SystemRoot", "C:\\Windows");
  const callbacks: Array<(error: Error | null, output: string, stderr: string) => void> = [];
  const end = vi.fn();
  const kill = vi.fn();
  const unref = vi.fn();
  const execute = vi.fn((_path, _args, options, callback) => {
    callbacks.push(callback);
    expect(options).toMatchObject({
      shell: false,
      windowsHide: true,
      timeout: 10,
      maxBuffer: 262144,
    });
    return {
      stdin: { end, destroy: vi.fn() },
      stdout: { destroy: vi.fn() },
      stderr: { destroy: vi.fn() },
      kill,
      unref,
    } as unknown as ChildProcess;
  }) as unknown as typeof execFile;
  const run = createWindowsSpeechRunnerForTest(execute);
  const first = run("fixed").catch((error: Error) => error.message);
  const second = run("fixed").catch((error: Error) => error.message);
  await expect(run("fixed")).rejects.toThrow("busy");
  expect(end).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(510);
  await expect(first).resolves.toContain("did not finish");
  await expect(second).resolves.toContain("did not finish");
  expect(kill).toHaveBeenCalledTimes(2);
  expect(unref).toHaveBeenCalledTimes(2);
  await expect(run("fixed")).rejects.toThrow("busy");
  callbacks[0]!(new Error("late close"), "", "");
  const replacement = run("fixed");
  callbacks[2]!(null, "  []  ", "");
  await expect(replacement).resolves.toBe("[]");
  callbacks[1]!(new Error("late close"), "", "");
});

it("rejects a relative or traversing system directory before spawning", () => {
  vi.stubEnv("SystemRoot", "relative");
  expect(() => windowsPowerShellExecutablePath()).toThrow("invalid");
  vi.stubEnv("SystemRoot", "C:\\Windows\\..\\project");
  expect(() => windowsPowerShellExecutablePath()).toThrow("invalid");
});

it("releases the admission slot when the spawner fails synchronously", async () => {
  vi.stubEnv("SystemRoot", "C:\\Windows");
  const execute = vi.fn(() => {
    throw new Error("EPERM spawn");
  }) as unknown as typeof execFile;
  const run = createWindowsSpeechRunnerForTest(execute);
  // A spawn that never produced a child consumed no helper, so repeated
  // failures must keep rejecting with the real cause and never with "busy".
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await expect(run("fixed")).rejects.toThrow("EPERM spawn");
  }
  expect(execute).toHaveBeenCalledTimes(4);
});

it("quarantines a child whose setup throws after it was spawned", async () => {
  vi.useFakeTimers();
  vi.stubEnv("SystemRoot", "C:\\Windows");
  const callbacks: Array<(error: Error | null, output: string, stderr: string) => void> = [];
  const kill = vi.fn();
  const unref = vi.fn();
  const destroy = vi.fn();
  let spawns = 0;
  const execute = vi.fn((_path, _args, _options, callback) => {
    callbacks.push(callback);
    spawns += 1;
    const failing = spawns === 1;
    return {
      stdin: {
        end: () => {
          if (failing) throw new Error("stdin already closed");
        },
        destroy,
      },
      stdout: { destroy },
      stderr: { destroy },
      kill,
      unref,
    } as unknown as ChildProcess;
  }) as unknown as typeof execFile;
  const run = createWindowsSpeechRunnerForTest(execute);

  await expect(run("fixed")).rejects.toThrow("stdin already closed");
  expect(kill).toHaveBeenCalledWith("SIGKILL");
  expect(destroy).toHaveBeenCalledTimes(3);
  expect(unref).toHaveBeenCalledTimes(1);

  // The caller settled, but the spawned helper still holds its slot: one more
  // helper is admitted and the next request is refused until Node reaps it.
  const admitted = run("fixed").catch((error: Error) => error.message);
  await expect(run("fixed")).rejects.toThrow("busy");
  callbacks[0]!(new Error("killed"), "", "");
  const replacement = run("fixed").catch((error: Error) => error.message);
  expect(execute).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(510);
  await expect(admitted).resolves.toContain("did not finish");
  await expect(replacement).resolves.toContain("did not finish");
});
