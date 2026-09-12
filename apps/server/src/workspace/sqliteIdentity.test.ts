// @effect-diagnostics nodeBuiltinImport:off
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import { ProjectId } from "@cafecode/contracts";
import { makeWorkspaceObservatory } from "./Layers/WorkspaceObservatory.ts";

let root = "",
  filename = "";
const projectId = ProjectId.make("synthetic-key-project");
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cafe-sqlite-keys-"));
  filename = join(root, "data.db");
});
afterEach(async () => {
  if (
    dirname(resolve(root)) === resolve(tmpdir()) &&
    basename(root).startsWith("cafe-sqlite-keys-")
  )
    await rm(root, { recursive: true, force: true });
});
function sql(statement: string) {
  const db = new DatabaseSync(filename);
  try {
    db.exec(statement);
  } finally {
    db.close();
  }
}
function rows(table = "items", limit = 100) {
  return Effect.runPromise(
    makeWorkspaceObservatory(() => Effect.succeed(root)).rows({
      projectId,
      relativePath: "data.db",
      table,
      limit,
    }),
  );
}

describe("bounded typed primary-key metadata", () => {
  it("distinguishes exact typed bytes even when NULs and number casts make display keys alike", async () => {
    sql(
      "CREATE TABLE items(k PRIMARY KEY, label TEXT); INSERT INTO items VALUES(1,'number'),('1','text'),(CAST(X'610062' AS TEXT),'nul-b'),(CAST(X'610063' AS TEXT),'nul-c')",
    );
    const before = await rows();
    expect(before.identityColumns).toEqual([0]);
    expect(before.rowKeys).toHaveLength(4);
    expect(new Set(before.rowKeys).size).toBe(4);
    expect(before.rowKeys?.every((key) => /^[a-f0-9]{64}$/.test(key))).toBe(true);
    sql("UPDATE items SET label='updated'");
    const after = await rows();
    expect(after.rowKeys).toEqual(before.rowKeys);
    expect(after.rows).not.toEqual(before.rows);
  });

  it("uses all composite key columns in declared order", async () => {
    sql(
      "CREATE TABLE items(a TEXT,b INTEGER,label TEXT, PRIMARY KEY(b,a)); INSERT INTO items VALUES('a',1,'one'),('b',1,'two')",
    );
    const result = await rows();
    expect(result.identityColumns).toEqual([1, 0]);
    expect(new Set(result.rowKeys).size).toBe(2);
  });

  it("preserves close finite REAL keys across refresh and withholds nonfinite keys", async () => {
    sql(
      "CREATE TABLE items(k REAL PRIMARY KEY,label TEXT); CREATE TABLE infinite(k REAL PRIMARY KEY); INSERT INTO infinite VALUES(1e999),(-1e999)",
    );
    const db = new DatabaseSync(filename);
    try {
      const insert = db.prepare("INSERT INTO items VALUES(?,?)");
      insert.run(1.0000000000000002, "first");
      insert.run(1.0000000000000004, "second");
      insert.run(Number.MIN_VALUE, "smallest positive");
      insert.run(Number.MAX_VALUE, "largest finite");
    } finally {
      db.close();
    }
    const before = await rows();
    expect(before.rowKeys).toHaveLength(4);
    expect(new Set(before.rowKeys).size).toBe(4);
    sql("UPDATE items SET label='updated'");
    expect((await rows()).rowKeys).toEqual(before.rowKeys);
    expect((await rows("infinite")).rowKeys).toEqual([]);
  });

  it("withholds matching keys for missing, null, blob and oversized key values", async () => {
    sql(
      "CREATE TABLE missing(label TEXT); INSERT INTO missing VALUES('x'); CREATE TABLE nullable(k PRIMARY KEY); INSERT INTO nullable VALUES(NULL); CREATE TABLE binary(k BLOB PRIMARY KEY); INSERT INTO binary VALUES(X'0102'); CREATE TABLE large(k TEXT PRIMARY KEY); INSERT INTO large VALUES(printf('%4100s','x'))",
    );
    for (const table of ["missing", "nullable", "binary", "large"])
      expect((await rows(table)).rowKeys).toEqual([]);
  });

  it("withholds keys for masked or incomplete snapshots", async () => {
    sql(
      "CREATE TABLE masked(id INTEGER PRIMARY KEY,api_key TEXT); INSERT INTO masked VALUES(1,'synthetic'); CREATE TABLE items(id INTEGER PRIMARY KEY,label TEXT); INSERT INTO items VALUES(1,'a'),(2,'b'); CREATE TABLE labelled(k TEXT PRIMARY KEY); INSERT INTO labelled VALUES('token=synthetic'); CREATE TABLE sensitive(token TEXT PRIMARY KEY); INSERT INTO sensitive VALUES('synthetic')",
    );
    expect((await rows("masked")).rowKeys).toEqual([]);
    expect((await rows("items", 1)).rowKeys).toEqual([]);
    const labelled = await rows("labelled");
    expect(labelled.redacted).toBe(true);
    expect(labelled.rowKeys).toEqual([]);
    expect((await rows("sensitive")).identityColumns).toEqual([]);
  });
});
