// @effect-diagnostics nodeBuiltinImport:off
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createApplicationStatePreview,
  APPLICATION_STATE_TIMEOUT_MS,
} from "./applicationStatePreview.ts";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
let root = "";
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  spawnMock.mockReset();
  if (
    root &&
    dirname(resolve(root)) === resolve(tmpdir()) &&
    basename(root).startsWith("cafe-state-process-test-")
  )
    await rm(root, { recursive: true, force: true });
});
function fakeProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: vi.fn(() => true),
  });
  let notify!: () => void;
  const started = new Promise<void>((done) => {
    notify = done;
  });
  spawnMock.mockImplementation(() => {
    notify();
    return child;
  });
  return { child, started };
}

describe("application state worker ownership", () => {
  it("kills at three seconds but refuses new work until actual child close", async () => {
    const { child, started } = fakeProcess();
    vi.useFakeTimers();
    vi.stubEnv("NODE_OPTIONS", "--synthetic-private-hook");
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-private-key");
    const reader = createApplicationStatePreview(join(tmpdir(), "synthetic-state.sqlite"));
    let settled = false;
    const result = reader.tables().then(
      () => "unexpected",
      (error) => {
        settled = true;
        return error.message;
      },
    );
    await started;
    const [executable, args, options] = spawnMock.mock.calls[0]!;
    expect(executable).toBe(process.execPath);
    expect(args.join(" ")).not.toContain("synthetic-state.sqlite");
    expect(options).toMatchObject({
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    expect(options.env.NODE_OPTIONS).toBeUndefined();
    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(basename(options.cwd)).toMatch(/^cafe-operational-state-/);
    expect(child.stdin.writableEnded).toBe(true);
    await vi.advanceTimersByTimeAsync(APPLICATION_STATE_TIMEOUT_MS);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(settled).toBe(false);
    await expect(reader.tables()).rejects.toThrow("unavailable");
    expect(spawnMock).toHaveBeenCalledTimes(1);
    child.emit("close", 0);
    expect(await result).toBe("The operational application state preview is unavailable.");
    await reader.close();
  });

  it("shutdown kills and awaits its pending child, and remains closed", async () => {
    const { child, started } = fakeProcess();
    const reader = createApplicationStatePreview(join(tmpdir(), "synthetic-state.sqlite"));
    const request = reader.tables().catch((error) => error.message);
    await started;
    let finished = false;
    const closing = reader.close().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(finished).toBe(false);
    await expect(reader.tables()).rejects.toThrow("unavailable");
    child.emit("close", 0);
    await closing;
    expect(await request).toContain("unavailable");
    await expect(reader.tables()).rejects.toThrow("unavailable");
  });

  it("rejects excess or unsanitized output even when the child exits successfully", async () => {
    for (const output of [
      Buffer.alloc(65537, 65),
      Buffer.from(
        JSON.stringify({
          database: "cafe-code-state",
          tables: [{ name: "synthetic-private-token" }],
        }),
      ),
    ]) {
      const { child, started } = fakeProcess();
      const reader = createApplicationStatePreview(join(tmpdir(), "synthetic-state.sqlite"));
      const observed = reader.tables().catch((error) => error.message);
      await started;
      child.stdout.emit("data", output);
      child.emit("close", 0);
      expect(await observed).toBe("The operational application state preview is unavailable.");
      await reader.close();
    }
  });

  it("refuses a deterministic file substitution between pinning and SQLite open", async () => {
    root = await mkdtemp(join(tmpdir(), "cafe-state-process-test-"));
    const filename = join(root, "state.sqlite"),
      replacement = join(root, "replacement.sqlite");
    for (const file of [filename, replacement]) {
      const db = new DatabaseSync(file);
      db.exec(
        "CREATE TABLE projection_state(projector TEXT PRIMARY KEY,last_applied_sequence INTEGER,updated_at TEXT)",
      );
      db.close();
    }
    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    spawnMock.mockImplementation(
      (executable: string, args: string[], options: Parameters<typeof actual.spawn>[2]) => {
        const modified = args.map((argument) =>
          argument.includes("db = new DatabaseSync(filename")
            ? argument.replace(
                "db = new DatabaseSync(filename",
                `require('node:fs').renameSync(${JSON.stringify(filename)}, ${JSON.stringify(filename + ".old")}); require('node:fs').copyFileSync(${JSON.stringify(replacement)}, ${JSON.stringify(filename)}); db = new DatabaseSync(filename`,
              )
            : argument,
        );
        return actual.spawn(executable, modified, options);
      },
    );
    const reader = createApplicationStatePreview(filename);
    try {
      await expect(reader.tables()).rejects.toThrow("unavailable");
    } finally {
      await reader.close();
    }
  });
});
