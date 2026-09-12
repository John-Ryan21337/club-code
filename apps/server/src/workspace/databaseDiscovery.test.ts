// @effect-diagnostics nodeBuiltinImport:off
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  ProjectId,
  WorkspaceObservatoryDatabasesResult,
  WORKSPACE_DATABASE_DISCOVERY_LIMITS,
} from "@cafecode/contracts";
import { makeWorkspaceObservatory } from "./Layers/WorkspaceObservatory.ts";

const PROJECT = ProjectId.make("synthetic-discovery-project");
const decodeDatabasesResult = Schema.decodeUnknownSync(WorkspaceObservatoryDatabasesResult);
const header = Buffer.from("SQLite format 3\0", "ascii");
let root = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cafe-discovery-test-"));
});
afterEach(async () => {
  if (
    dirname(resolve(root)) === resolve(tmpdir()) &&
    basename(root).startsWith("cafe-discovery-test-")
  )
    await rm(root, { recursive: true, force: true });
});
const scan = () =>
  Effect.runPromise(
    makeWorkspaceObservatory((id) => Effect.succeed(id === PROJECT ? root : null)).databases({
      projectId: PROJECT,
    }),
  );

describe("explicit project SQLite discovery", () => {
  it("finds real nested and extensionless databases without changing original bytes", async () => {
    await mkdir(join(root, "nested"));
    const filename = join(root, "nested", " data");
    const db = new DatabaseSync(filename);
    db.exec("CREATE TABLE item(id INTEGER PRIMARY KEY)");
    db.close();
    await writeFile(join(root, "looks.sqlite"), "This is ordinary text, not SQLite.");
    const before = await readFile(filename);
    expect(await scan()).toEqual({
      databases: [{ relativePath: "nested/ data" }],
      truncated: false,
      redacted: false,
    });
    expect(await readFile(filename)).toEqual(before);
  });

  it("withholds hidden, generated and sensitive paths while retaining a positive control", async () => {
    for (const folder of [".hidden", "node_modules", "dist", "credentials"]) {
      await mkdir(join(root, folder));
      await writeFile(join(root, folder, "data.sqlite"), header);
    }
    await writeFile(join(root, "secrets.sqlite"), header);
    await writeFile(join(root, "visible.sqlite"), header);
    expect(await scan()).toEqual({
      databases: [{ relativePath: "visible.sqlite" }],
      truncated: false,
      redacted: true,
    });
  });

  it("caps results and marks a partial scan", async () => {
    await Promise.all(
      Array.from({ length: 45 }, (_, i) =>
        writeFile(join(root, `db-${String(i).padStart(2, "0")}`), header),
      ),
    );
    const result = await scan();
    expect(result.databases).toHaveLength(WORKSPACE_DATABASE_DISCOVERY_LIMITS.results);
    expect(result.truncated).toBe(true);
    expect(decodeDatabasesResult(result)).toEqual(result);
  });

  it("bounds header probes even when ordinary files precede the database", async () => {
    await Promise.all(
      Array.from({ length: 64 }, (_, i) =>
        writeFile(
          join(root, `a-${String(i).padStart(2, "0")}`),
          "ordinary content without a database header",
        ),
      ),
    );
    await writeFile(join(root, "z-database"), header);
    expect(await scan()).toEqual({ databases: [], truncated: true, redacted: false });
  });

  it("stops descending at the depth budget and preserves discoveries above it", async () => {
    await writeFile(join(root, "visible"), header);
    let target = root;
    for (let i = 0; i < WORKSPACE_DATABASE_DISCOVERY_LIMITS.depth + 1; i++) {
      target = join(target, "nested");
      await mkdir(target);
    }
    await writeFile(join(target, "beyond"), header);
    expect(await scan()).toEqual({
      databases: [{ relativePath: "visible" }],
      truncated: true,
      redacted: false,
    });
  });

  it("bounds scheduled directories and reports that the listing is partial", async () => {
    await Promise.all(Array.from({ length: 130 }, (_, i) => mkdir(join(root, `dir-${i}`))));
    await writeFile(join(root, "visible"), header);
    expect(await scan()).toEqual({
      databases: [{ relativePath: "visible" }],
      truncated: true,
      redacted: false,
    });
  });

  it("does not follow a symlink even when its target has a SQLite header", async (context) => {
    await mkdir(join(root, "actual"));
    await writeFile(join(root, "actual", "db"), header);
    try {
      await symlink(join(root, "actual"), join(root, "alias"), "dir");
    } catch (error) {
      if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
        context.skip();
        return;
      }
      throw error;
    }
    expect((await scan()).databases).toEqual([{ relativePath: "actual/db" }]);
  });

  it("refuses an unknown project and a project removed before returning results", async () => {
    await writeFile(join(root, "visible"), header);
    await expect(
      Effect.runPromise(
        makeWorkspaceObservatory(() => Effect.succeed(null)).databases({ projectId: PROJECT }),
      ),
    ).rejects.toMatchObject({ reason: "unknown-project" });
    let resolutions = 0;
    const service = makeWorkspaceObservatory(() =>
      Effect.succeed(++resolutions === 1 ? root : null),
    );
    await expect(
      Effect.runPromise(service.databases({ projectId: PROJECT })),
    ).rejects.toMatchObject({ reason: "unknown-project" });
    expect(resolutions).toBe(2);
  });
});
