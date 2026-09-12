// @effect-diagnostics nodeBuiltinImport:off
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm, writeFile, stat, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import { ProjectId, WorkspaceObservatoryRowsInput } from "@cafecode/contracts";
import * as Schema from "effect/Schema";

import {
  readSqlitePreview,
  SQLITE_PREVIEW_FILE_BYTES,
  SQLITE_PREVIEW_WAL_BYTES,
} from "./sqlitePreview.ts";
import { makeWorkspaceObservatory } from "./Layers/WorkspaceObservatory.ts";

let directory = "";
let filename = "";
const PROJECT = ProjectId.make("synthetic-database-project");
const decodeRowsInput = Schema.decodeUnknownSync(WorkspaceObservatoryRowsInput);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "cafe-database-test-"));
  filename = join(directory, " data.sqlite");
  const database = new DatabaseSync(filename);
  database.exec(
    "CREATE TABLE items(id INTEGER PRIMARY KEY, title TEXT, api_key TEXT, payload BLOB); INSERT INTO items VALUES(1,'Synthetic item','fake-fixture-secret',X'0011'); CREATE VIEW item_view AS SELECT * FROM items; CREATE TABLE generated (id INTEGER, computed TEXT AS (printf('%1000000s','x'))); INSERT INTO generated(id) VALUES(1); CREATE TABLE secrets(value TEXT);",
  );
  database.close();
});
afterEach(async () => {
  if (
    dirname(resolve(directory)) === resolve(tmpdir()) &&
    basename(directory).startsWith("cafe-database-test-")
  )
    await rm(directory, { recursive: true, force: true });
});

function observatory() {
  return makeWorkspaceObservatory((id) => Effect.succeed(id === PROJECT ? directory : null));
}

describe("read-only SQLite previews", () => {
  it("reads real tables and bounded rows through the project service without changing original bytes", async () => {
    const before = await readFile(filename);
    const metadata = await stat(filename);
    const tables = await Effect.runPromise(
      observatory().tables({ projectId: PROJECT, relativePath: " data.sqlite" }),
    );
    expect(tables).toEqual({
      relativePath: " data.sqlite",
      tables: [{ name: "generated" }, { name: "items" }],
      truncated: false,
    });
    const rows = await Effect.runPromise(
      observatory().rows({ projectId: PROJECT, relativePath: " data.sqlite", table: "items" }),
    );
    expect(rows).toEqual({
      relativePath: " data.sqlite",
      table: "items",
      columns: ["id", "title", "api_key", "payload"],
      rows: [["1", "Synthetic item", "[redacted]", "[blob omitted]"]],
      truncated: false,
      redacted: true,
    });
    expect(await readFile(filename)).toEqual(before);
    expect((await stat(filename)).mtimeMs).toBe(metadata.mtimeMs);
    await expect(stat(`${filename}-shm`)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reads a stable WAL snapshot without checkpointing or changing its source", async () => {
    const database = new DatabaseSync(filename);
    try {
      database.exec(
        "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; INSERT INTO items VALUES(2,'WAL item','synthetic-only',NULL)",
      );
      const before = await Promise.all([readFile(filename), readFile(`${filename}-wal`)]);
      const result = await readSqlitePreview(
        filename,
        { operation: "rows", table: "items", limit: 10 },
        async () => {},
      );
      expect(result).toMatchObject({
        rows: [
          ["1", "Synthetic item", "[redacted]", "[blob omitted]"],
          ["2", "WAL item", "[redacted]", "NULL"],
        ],
      });
      expect(await Promise.all([readFile(filename), readFile(`${filename}-wal`)])).toEqual(before);
    } finally {
      database.close();
    }
  });

  it("omits generated expressions, views and virtual tables", async () => {
    const database = new DatabaseSync(filename);
    database.exec("CREATE VIRTUAL TABLE search USING fts5(body)");
    database.close();
    const tables = await readSqlitePreview(filename, { operation: "tables" }, async () => {});
    expect(tables).toEqual({
      tables: [{ name: "generated" }, { name: "items" }],
      truncated: false,
    });
    expect(
      await readSqlitePreview(
        filename,
        { operation: "rows", table: "generated", limit: 10 },
        async () => {},
      ),
    ).toMatchObject({ columns: ["id"], rows: [["1"]], truncated: true });
    for (const table of ["item_view", "search", "items; DROP TABLE items", "secrets"])
      await expect(
        readSqlitePreview(filename, { operation: "rows", table, limit: 10 }, async () => {}),
      ).rejects.toThrow("preview is unavailable");
  });

  it("caps rows and cells, masks key/value credentials, and rejects hostile limits", async () => {
    const database = new DatabaseSync(filename);
    database.exec(
      "CREATE TABLE settings(name TEXT, value TEXT); INSERT INTO settings VALUES('api_key','synthetic-private'); CREATE TABLE large(body TEXT);",
    );
    const insert = database.prepare("INSERT INTO large VALUES(?)");
    for (let index = 0; index < 110; index++) insert.run("x".repeat(5000));
    database.close();
    expect(
      await readSqlitePreview(
        filename,
        { operation: "rows", table: "settings", limit: 5 },
        async () => {},
      ),
    ).toMatchObject({ rows: [["api_key", "[redacted]"]], redacted: true });
    const result = await Effect.runPromise(
      observatory().rows({
        projectId: PROJECT,
        relativePath: " data.sqlite",
        table: "large",
        limit: 2,
      }),
    );
    expect(result.truncated).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.[0]).toHaveLength(4096);
    for (const limit of [0, 101, 1.5, Infinity])
      expect(() =>
        decodeRowsInput({
          projectId: PROJECT,
          relativePath: " data.sqlite",
          table: "large",
          limit,
        }),
      ).toThrow();
  });

  it("refuses hot journals and non-database files with fixed errors", async () => {
    await writeFile(`${filename}-journal`, "synthetic journal");
    await expect(
      readSqlitePreview(filename, { operation: "tables" }, async () => {}),
    ).rejects.toThrow("The database preview is unavailable or changed while reading.");
    const text = join(directory, "notes.txt");
    await writeFile(text, "private fixture text");
    await expect(readSqlitePreview(text, { operation: "tables" }, async () => {})).rejects.toThrow(
      "The database preview is unavailable or changed while reading.",
    );
  });

  it("rejects oversized main and WAL files before querying and detects a newly created WAL", async () => {
    const original = await readFile(filename);
    await truncate(filename, SQLITE_PREVIEW_FILE_BYTES + 1);
    await expect(
      readSqlitePreview(filename, { operation: "tables" }, async () => {}),
    ).rejects.toThrow("preview is unavailable");
    await writeFile(filename, original);
    await writeFile(`${filename}-wal`, "");
    await truncate(`${filename}-wal`, SQLITE_PREVIEW_WAL_BYTES + 1);
    await expect(
      readSqlitePreview(filename, { operation: "tables" }, async () => {}),
    ).rejects.toThrow("preview is unavailable");
    await rm(`${filename}-wal`);
    await expect(
      readSqlitePreview(filename, { operation: "tables" }, async () => {
        await writeFile(`${filename}-wal`, "synthetic new WAL");
      }),
    ).rejects.toThrow("preview is unavailable");
    expect(await readFile(filename)).toEqual(original);
  });

  it("refuses changed scope, aborted calls and exact-path aliases", async () => {
    await expect(
      readSqlitePreview(filename, { operation: "tables" }, async () => {
        throw Error("synthetic private path");
      }),
    ).rejects.toThrow("The database preview is unavailable or changed while reading.");
    const controller = new AbortController();
    controller.abort();
    await expect(
      readSqlitePreview(filename, { operation: "tables" }, async () => {}, controller.signal),
    ).rejects.toThrow("preview is unavailable");
    for (const relativePath of ["../ data.sqlite", " data.sqlite ", " data.sqlite:stream"]) {
      const error = await Effect.runPromise(
        Effect.flip(observatory().tables({ projectId: PROJECT, relativePath })),
      );
      expect(error.reason).toBe("outside-root");
    }
    const error = await Effect.runPromise(
      Effect.flip(
        observatory().tables({
          projectId: ProjectId.make("unknown"),
          relativePath: " data.sqlite",
        }),
      ),
    );
    expect(error.reason).toBe("unknown-project");
  });
});
