// @effect-diagnostics nodeBuiltinImport:off
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSqlitePreview, SQLITE_PREVIEW_TIMEOUT_MS } from "./sqlitePreview.ts";
import * as Effect from "effect/Effect";
import { ProjectId } from "@cafecode/contracts";
import { makeWorkspaceObservatory } from "./Layers/WorkspaceObservatory.ts";

const spawnMock = vi.hoisted(() => vi.fn());
const openedFlags = vi.hoisted(() => [] as unknown[]);
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: (...args: Parameters<typeof original.open>) => {
      openedFlags.push(args[1]);
      return original.open(...args);
    },
  };
});
let directory = "";
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  spawnMock.mockReset();
  openedFlags.length = 0;
  if (
    dirname(resolve(directory)) === resolve(tmpdir()) &&
    basename(directory).startsWith("cafe-db-process-test-")
  )
    await rm(directory, { recursive: true, force: true });
});
async function setup() {
  directory = await mkdtemp(join(tmpdir(), "cafe-db-process-test-"));
  const filename = join(directory, "fixture.sqlite");
  const database = new DatabaseSync(filename);
  database.exec("CREATE TABLE items(id INTEGER)");
  database.close();
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: vi.fn(() => true),
  });
  let ready!: () => void;
  const started = new Promise<void>((done) => {
    ready = done;
  });
  spawnMock.mockImplementation(() => {
    ready();
    return child;
  });
  return { filename, child, started };
}

describe("SQLite child ownership", () => {
  it("refuses a result when the authoritative project root changes during the child read", async () => {
    const { child, started } = await setup();
    let currentRoot = directory;
    const replacement = join(directory, "replacement");
    await mkdir(replacement);
    const service = makeWorkspaceObservatory(() => Effect.sync(() => currentRoot));
    const observed = Effect.runPromise(
      service.tables({
        projectId: ProjectId.make("synthetic-project"),
        relativePath: "fixture.sqlite",
      }),
    ).then(
      () => "old result returned",
      () => "refused",
    );
    await started;
    currentRoot = replacement;
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ tables: [{ name: "old_private_table" }], truncated: false })),
    );
    child.emit("close", 0);
    expect(await observed).toBe("refused");
  });

  it("pins source descriptors with the same nonblocking policy as ordinary file previews", async () => {
    const { filename, child, started } = await setup();
    const observed = readSqlitePreview(filename, { operation: "tables" }, async () => {});
    await started;
    const sourceFlags = openedFlags.find((flags) => typeof flags === "number");
    expect(sourceFlags).toBe(
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    child.stdout.emit("data", Buffer.from('{"tables":[],"truncated":false}'));
    child.emit("close", 0);
    await observed;
  });

  it("kills at its deadline but retains completion until the child closes", async () => {
    const { filename, child, started } = await setup();
    vi.useFakeTimers();
    vi.stubEnv("NODE_OPTIONS", "--synthetic-private-option");
    vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-never-forward");
    let settled = false;
    const result = readSqlitePreview(filename, { operation: "tables" }, async () => {});
    const observed = result.then(
      () => {
        settled = true;
        return "unexpected";
      },
      (error) => {
        settled = true;
        return error.message;
      },
    );
    await started;
    const [binary, args, options] = spawnMock.mock.calls[0]!;
    expect(binary).toBe(process.execPath);
    expect(args.join(" ")).not.toContain(filename);
    expect(options).toMatchObject({
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
      env: { ELECTRON_RUN_AS_NODE: "1" },
    });
    expect(options.env.NODE_OPTIONS).toBeUndefined();
    expect(options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(child.stdin.writableEnded).toBe(true);
    await vi.advanceTimersByTimeAsync(SQLITE_PREVIEW_TIMEOUT_MS);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(settled).toBe(false);
    child.emit("close", 0);
    expect(await observed).toBe("The database preview is unavailable or changed while reading.");
  });

  it("rejects excess output and cancellation even when the child later exits zero", async () => {
    for (const reason of ["output", "abort"] as const) {
      const { filename, child, started } = await setup();
      const controller = new AbortController();
      const observed = readSqlitePreview(
        filename,
        { operation: "tables" },
        async () => {},
        controller.signal,
      ).catch((error) => error.message);
      await started;
      if (reason === "output") child.stdout.emit("data", Buffer.alloc(256 * 1024 + 1));
      else controller.abort();
      expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
      child.emit("close", 0);
      expect(await observed).toBe("The database preview is unavailable or changed while reading.");
      // Each fixture is an exact owned path, removed before the next setup.
      if (
        dirname(resolve(directory)) === resolve(tmpdir()) &&
        basename(directory).startsWith("cafe-db-process-test-")
      )
        await rm(directory, { recursive: true, force: true });
    }
  });
});
