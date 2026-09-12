// @effect-diagnostics nodeBuiltinImport:off
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, stat, symlink, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplicationStatePreview } from "./applicationStatePreview.ts";

const usageSchema =
  "CREATE TABLE usage_stats_days(day TEXT PRIMARY KEY,generating_ms INTEGER,output_tokens INTEGER,user_messages INTEGER,input_tokens INTEGER,cached_input_tokens INTEGER,cache_write_input_tokens INTEGER,reasoning_output_tokens INTEGER)";
let root = "",
  filename = "";
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cafe-state-preview-test-"));
  filename = join(root, "state.sqlite");
});
afterEach(async () => {
  if (
    dirname(resolve(root)) === resolve(tmpdir()) &&
    basename(root).startsWith("cafe-state-preview-test-")
  )
    await rm(root, { recursive: true, force: true });
});
function write(sql: string) {
  const db = new DatabaseSync(filename);
  try {
    db.exec(sql);
  } finally {
    db.close();
  }
}

describe("operational application state preview", () => {
  it("reads allowed counters from a database above the project copy cap without exposing payload tables", async () => {
    write(`${usageSchema}; INSERT INTO usage_stats_days VALUES('2026-09-12',1200,20,2,30,4,5,6);
      CREATE TABLE projection_state(projector TEXT PRIMARY KEY,last_applied_sequence INTEGER,updated_at TEXT);
      INSERT INTO projection_state VALUES('projection.projects',42,'2026-09-12T12:00:00.000Z');
      CREATE TABLE orchestration_events(payload BLOB); INSERT INTO orchestration_events VALUES(zeroblob(34*1024*1024));
      CREATE TABLE auth_sessions(token TEXT); INSERT INTO auth_sessions VALUES('synthetic-private-token');`);
    expect((await stat(filename)).size).toBeGreaterThan(32 * 1024 * 1024);
    const reader = createApplicationStatePreview(filename);
    try {
      expect(await reader.tables()).toEqual({
        database: "cafe-code-state",
        tables: [{ name: "usage_stats_days" }, { name: "projection_state" }],
      });
      const usage = await reader.rows({ table: "usage_stats_days" });
      expect(usage.rows).toEqual([["2026-09-12", "1200", "20", "2", "30", "4", "5", "6"]]);
      expect(usage.columns).toHaveLength(8);
      expect(usage.truncated).toBe(false);
      expect((await reader.rows({ table: "projection_state" })).rows).toEqual([
        ["projection.projects", "42", "2026-09-12T12:00:00.000Z"],
      ]);
      expect(JSON.stringify(usage)).not.toContain(root);
      await expect(reader.rows({ table: "auth_sessions" as "usage_stats_days" })).rejects.toThrow(
        "operational application state preview is unavailable",
      );
    } finally {
      await reader.close();
    }
    await expect(reader.tables()).rejects.toThrow("unavailable");
  });

  it("reads committed WAL updates without logical writes and reports bounded truncation", async () => {
    const writer = new DatabaseSync(filename);
    writer.exec(
      `PRAGMA journal_mode=WAL; ${usageSchema}; INSERT INTO usage_stats_days VALUES('2026-09-11',1,2,3,4,5,6,7);`,
    );
    const reader = createApplicationStatePreview(filename);
    try {
      expect((await reader.rows({ table: "usage_stats_days" })).rows).toHaveLength(1);
      writer.exec("INSERT INTO usage_stats_days VALUES('2026-09-12',2,3,4,5,6,7,8)");
      const result = await reader.rows({ table: "usage_stats_days", limit: 1 });
      expect(result.truncated).toBe(true);
      expect(result.rows).toHaveLength(1);
      expect(writer.prepare("SELECT count(*) AS count FROM usage_stats_days").get()?.count).toBe(2);
      expect(writer.prepare("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
      expect((await reader.rows({ table: "usage_stats_days" })).rows).toHaveLength(2);
    } finally {
      await reader.close();
      writer.close();
    }
  });

  it("refuses unsafe counter, date, timestamp and projector values without returning their text", async () => {
    write(`${usageSchema}; INSERT INTO usage_stats_days VALUES('2026-09-12',1,2,3,4,5,6,7);
      CREATE TABLE projection_state(projector TEXT PRIMARY KEY,last_applied_sequence INTEGER,updated_at TEXT);
      INSERT INTO projection_state VALUES('projection.projects',42,'2026-09-12T12:00:00Z')`);
    const reader = createApplicationStatePreview(filename);
    try {
      for (const mutation of [
        "UPDATE usage_stats_days SET day='2026-09-12'||char(0)||'synthetic-private-suffix'",
        "UPDATE usage_stats_days SET day='2026-09-12',generating_ms=-1",
        "UPDATE usage_stats_days SET generating_ms=9007199254740992",
        "UPDATE usage_stats_days SET generating_ms='synthetic-private-prompt'",
        "UPDATE usage_stats_days SET generating_ms=zeroblob(4*1024*1024)",
        "UPDATE usage_stats_days SET generating_ms=1,day=printf('%.*c',1048576,'x')",
        "UPDATE usage_stats_days SET generating_ms=1,day='2026-02-30'",
      ]) {
        write(mutation);
        await expect(reader.rows({ table: "usage_stats_days" })).rejects.toThrow(
          "The operational application state preview is unavailable.",
        );
      }
      for (const mutation of [
        "UPDATE projection_state SET projector='synthetic-private-prompt'",
        "UPDATE projection_state SET projector='projection.projects',updated_at='2026-02-30T12:00:00Z'",
        "UPDATE projection_state SET updated_at='2026-09-12T12:00:00Z',last_applied_sequence=1.5",
      ]) {
        write(mutation);
        await expect(reader.rows({ table: "projection_state" })).rejects.toThrow(
          "The operational application state preview is unavailable.",
        );
      }
    } finally {
      await reader.close();
    }
  });

  it("refuses views and generated allowed columns instead of evaluating their expressions", async () => {
    write("CREATE VIEW usage_stats_days AS SELECT 'synthetic-private-prompt' AS day");
    const reader = createApplicationStatePreview(filename);
    try {
      await expect(reader.tables()).rejects.toThrow("unavailable");
      write(
        `DROP VIEW usage_stats_days; ${usageSchema.replace("generating_ms INTEGER", "generating_ms INTEGER GENERATED ALWAYS AS (length(day)) VIRTUAL")}`,
      );
      await expect(reader.tables()).rejects.toThrow("unavailable");
    } finally {
      await reader.close();
    }
  });

  it("accepts canonical parent aliases but refuses a final substituted directory", async () => {
    write(`${usageSchema}`);
    const alias = join(root, "alias");
    await symlink(root, alias, process.platform === "win32" ? "junction" : "dir");
    const reader = createApplicationStatePreview(join(alias, "state.sqlite"));
    try {
      expect((await reader.tables()).tables).toEqual([{ name: "usage_stats_days" }]);
      await rm(filename);
      await mkdir(filename);
      await expect(reader.tables()).rejects.toThrow("unavailable");
    } finally {
      await reader.close();
    }
  });
});
