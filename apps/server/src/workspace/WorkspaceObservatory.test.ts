import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

import { WorkspaceObservatory } from "./WorkspaceObservatory.ts";

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

async function fixture() {
  temporaryRoot = await mkdtemp(join(tmpdir(), "cafe-code-observatory-"));
  const workspace = join(temporaryRoot, "workspace");
  await mkdir(workspace);
  await writeFile(join(workspace, "readme.txt"), "workspace contents");
  await writeFile(join(workspace, "binary.bin"), Buffer.from([0, 1, 2]));
  const state = join(temporaryRoot, "state.sqlite");
  const database = new DatabaseSync(state);
  database.exec(
    "CREATE TABLE secrets (id INTEGER, api_token TEXT, payload TEXT); INSERT INTO secrets VALUES (1, 'do-not-show', '{\"nestedSecret\":\"also-hidden\"}');",
  );
  database.close();
  return { workspace, state, observatory: new WorkspaceObservatory(state, workspace) };
}

describe("WorkspaceObservatory", () => {
  it("rejects traversal and binary workspace reads", async () => {
    const { workspace, observatory } = await fixture();
    await expect(
      observatory.readFile({ cwd: workspace, relativePath: "../state.sqlite" }),
    ).rejects.toThrow("project root");
    await expect(
      observatory.readFile({ cwd: workspace, relativePath: "binary.bin" }),
    ).rejects.toThrow("Binary");
  });

  it("does not let an authenticated environment inspect an unrelated workspace", async () => {
    const { workspace, observatory } = await fixture();
    const unrelated = join(temporaryRoot!, "unrelated");
    await mkdir(unrelated);
    await expect(observatory.tree({ cwd: unrelated })).rejects.toThrow("connected environment");
    await expect(observatory.tree({ cwd: workspace })).resolves.toMatchObject({
      entries: expect.any(Array),
    });
  });

  it("does not follow a symlink outside the workspace", async () => {
    const { workspace, state, observatory } = await fixture();
    try {
      await symlink(state, join(workspace, "outside.sqlite"));
    } catch {
      return;
    }
    const tree = await observatory.tree({ cwd: workspace });
    expect(tree.entries.some((entry) => entry.name === "outside.sqlite")).toBe(false);
    try {
      await symlink(join(workspace, "readme.txt"), join(workspace, "inside.txt"));
    } catch {
      return;
    }
    const refreshed = await observatory.tree({ cwd: workspace });
    expect(refreshed.entries.some((entry) => entry.name === "inside.txt")).toBe(false);
    await expect(
      observatory.readFile({ cwd: workspace, relativePath: "inside.txt" }),
    ).rejects.toThrow("links");
  });

  it("omits hidden and secret-looking files and redacts credential assignments", async () => {
    const { workspace, observatory } = await fixture();
    await writeFile(join(workspace, ".env"), "API_TOKEN=do-not-show");
    await writeFile(join(workspace, "credentials.json"), '{"password":"do-not-show"}');
    await writeFile(
      join(workspace, "config.ts"),
      'const apiToken = "do-not-show";\nconst ordinary = "visible";',
    );
    await writeFile(
      join(workspace, "config.json"),
      '{"password":"do-not-show","ordinary":"visible"}',
    );

    const tree = await observatory.tree({ cwd: workspace });
    expect(tree.entries.map((entry) => entry.name)).not.toContain(".env");
    expect(tree.entries.map((entry) => entry.name)).not.toContain("credentials.json");
    expect(tree.redacted).toBe(true);
    await expect(observatory.readFile({ cwd: workspace, relativePath: ".env" })).rejects.toThrow(
      "Sensitive",
    );
    const config = await observatory.readFile({
      cwd: workspace,
      relativePath: "config.ts",
    });
    expect(config.content).toContain("const apiToken = [redacted]");
    expect(config.content).toContain('const ordinary = "visible"');
    expect(config.redacted).toBe(true);
    const json = await observatory.readFile({
      cwd: workspace,
      relativePath: "config.json",
    });
    expect(json.content).toContain('"password": "[redacted]"');
    expect(json.content).toContain('"ordinary": "visible"');
  });

  it("returns valid UTF-8 while bounding large text and database cells", async () => {
    const { workspace, state, observatory } = await fixture();
    await writeFile(join(workspace, "large.txt"), "界".repeat(100_000));
    const file = await observatory.readFile({ cwd: workspace, relativePath: "large.txt" });
    expect(file.truncated).toBe(true);
    expect(Buffer.byteLength(file.content)).toBeLessThanOrEqual(128 * 1024);
    expect(file.content).not.toContain("\uFFFD");

    const database = new DatabaseSync(state);
    database.prepare("INSERT INTO secrets VALUES (?, ?, ?)").run(2, "hidden", "界".repeat(10_000));
    database.close();
    const rows = await observatory.rows({
      cwd: workspace,
      database: "cafe-code-state",
      table: "secrets",
    });
    expect(Buffer.byteLength(rows.rows[1]![2]!)).toBeLessThanOrEqual(4 * 1024);
    expect(rows.rows[1]![2]).not.toContain("\uFFFD");
  });

  it("only exposes bounded, redacted rows through validated identifiers", async () => {
    const { workspace, state, observatory } = await fixture();
    const rows = await observatory.rows({
      cwd: workspace,
      database: "cafe-code-state",
      table: "secrets",
    });
    expect(rows.rows).toEqual([["1", "[redacted]", '{"nestedSecret":"[redacted]"}']]);
    expect(rows.identityColumns).toEqual([]);
    const database = new DatabaseSync(state);
    database.exec(
      "CREATE TABLE settings (key TEXT, value TEXT); INSERT INTO settings VALUES ('apiToken', 'do-not-show'), ('ordinary', 'sk-1234567890abcdefghijkl');",
    );
    database.close();
    const settings = await observatory.rows({
      cwd: workspace,
      database: "cafe-code-state",
      table: "settings",
    });
    expect(settings.rows).toEqual([
      ["apiToken", "[redacted]"],
      ["ordinary", "[redacted]"],
    ]);
    await expect(
      observatory.rows({
        cwd: workspace,
        database: "cafe-code-state",
        table: "secrets; DROP TABLE secrets",
      }),
    ).rejects.toThrow("Invalid database identifier");
  });

  it("reports and orders only complete declared primary keys as proven row identity", async () => {
    const { workspace, state, observatory } = await fixture();
    const database = new DatabaseSync(state);
    database.exec(
      "CREATE TABLE keyed (tenant TEXT, id INTEGER, value TEXT, PRIMARY KEY (tenant, id));" +
        "INSERT INTO keyed VALUES ('b', 2, 'second'), ('a', 1, 'first');" +
        "CREATE TABLE unkeyed (value TEXT); INSERT INTO unkeyed VALUES ('same'), ('same');" +
        "CREATE TABLE unsafe_key (api_token TEXT PRIMARY KEY, value TEXT);" +
        "INSERT INTO unsafe_key VALUES ('sk-1234567890abcdefghijkl', 'visible');" +
        "CREATE TABLE nullable_key (key TEXT PRIMARY KEY, value TEXT);" +
        "INSERT INTO nullable_key VALUES (NULL, 'visible');",
    );
    database.close();

    const keyed = await observatory.rows({
      cwd: workspace,
      database: "cafe-code-state",
      table: "keyed",
    });
    expect(keyed.identityColumns).toEqual([0, 1]);
    expect(keyed.rows).toEqual([
      ["a", "1", "first"],
      ["b", "2", "second"],
    ]);
    const unkeyed = await observatory.rows({
      cwd: workspace,
      database: "cafe-code-state",
      table: "unkeyed",
    });
    expect(unkeyed.identityColumns).toEqual([]);
    const unsafe = await observatory.rows({
      cwd: workspace,
      database: "cafe-code-state",
      table: "unsafe_key",
    });
    expect(unsafe.identityColumns).toEqual([]);
    expect(unsafe.rows[0]?.[0]).toBe("[redacted]");
    const nullable = await observatory.rows({
      cwd: workspace,
      database: "cafe-code-state",
      table: "nullable_key",
    });
    expect(nullable.identityColumns).toEqual([]);
  });

  it("exposes only verified tables and releases database handles after each read", async () => {
    const { workspace, state, observatory } = await fixture();
    const database = new DatabaseSync(state);
    database.exec("CREATE VIEW secret_view AS SELECT * FROM secrets;");
    database.close();
    await expect(
      observatory.tables({ cwd: workspace, database: "cafe-code-state" }),
    ).resolves.toEqual([{ name: "secrets", type: "table" }]);
    await Promise.all(
      Array.from({ length: 16 }, () =>
        observatory.rows({
          cwd: workspace,
          database: "cafe-code-state",
          table: "secrets",
        }),
      ),
    );
    const moved = `${state}.moved`;
    await expect(rename(state, moved)).resolves.toBeUndefined();
    await rename(moved, state);
  });

  it("requires both a supported extension and the SQLite signature", async () => {
    const { workspace, observatory } = await fixture();
    await writeFile(join(workspace, "fake.db"), "not sqlite");
    const sqliteWithWrongExtension = join(workspace, "real.data");
    const database = new DatabaseSync(sqliteWithWrongExtension);
    database.exec("CREATE TABLE visible (id INTEGER);");
    database.close();
    const databases = await observatory.databases({ cwd: workspace });
    expect(databases.map((entry) => entry.database)).not.toContain("fake.db");
    expect(databases.map((entry) => entry.database)).not.toContain("real.data");
    await expect(observatory.tables({ cwd: workspace, database: "fake.db" })).rejects.toThrow(
      "verified SQLite",
    );
  });

  it("keeps the configured workspace usable with an older projection schema", async () => {
    const { workspace, state } = await fixture();
    const database = new DatabaseSync(state);
    database.exec("CREATE TABLE projection_projects (workspace_root TEXT);");
    database.prepare("INSERT INTO projection_projects VALUES (?)").run(workspace);
    database.close();
    const observatory = new WorkspaceObservatory(state, workspace);
    await expect(observatory.tree({ cwd: workspace })).resolves.toMatchObject({
      entries: expect.any(Array),
    });
  });

  it("does not infer agent provenance from arbitrary activity payload text", async () => {
    const { workspace, state, observatory } = await fixture();
    const database = new DatabaseSync(state);
    database.exec(
      "CREATE TABLE projection_thread_activities (thread_id TEXT, created_at TEXT, payload_json TEXT); INSERT INTO projection_thread_activities VALUES ('thread-1', '2026-01-01T00:00:00.000Z', '{\"command\":\"cat secret.txt\"}');",
    );
    database.close();
    await expect(observatory.activity({ cwd: workspace })).resolves.toEqual({ observations: [] });
  });

  it("filters explicit telemetry in SQL and rejects outside, secret, and free-form claims", async () => {
    const { workspace, state, observatory } = await fixture();
    const database = new DatabaseSync(state);
    database.exec(
      "CREATE TABLE projection_thread_activities (thread_id TEXT, created_at TEXT, payload_json TEXT);",
    );
    const insert = database.prepare("INSERT INTO projection_thread_activities VALUES (?, ?, ?)");
    for (let index = 0; index < 110; index += 1) {
      insert.run(
        `thread-${index}`,
        new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
        JSON.stringify({
          observed: {
            providerObserved: true,
            agentId: "agent-new",
            operation: "read",
            path: "readme.txt",
            status: "running",
          },
        }),
      );
    }
    insert.run(
      "thread-target",
      "2025-01-01T00:00:00.000Z",
      JSON.stringify({
        observed: {
          providerObserved: true,
          agentId: "agent-target",
          operation: "write",
          path: "readme.txt",
          status: "completed",
        },
      }),
    );
    for (const [threadId, operation, path] of [
      ["outside", "read", "../state.sqlite"],
      ["secret", "read", ".env"],
      ["free-form", "reading all your secrets", "readme.txt"],
    ] as const) {
      insert.run(
        threadId,
        "2027-01-01T00:00:00.000Z",
        JSON.stringify({
          observed: {
            providerObserved: true,
            agentId: "agent-target",
            operation,
            path,
            status: "trust me",
          },
        }),
      );
    }
    database.close();

    await expect(
      observatory.activity({ cwd: workspace, agentId: "agent-target" }),
    ).resolves.toEqual({
      observations: [
        {
          agentId: "agent-target",
          threadId: "thread-target",
          operation: "write",
          path: "readme.txt",
          status: "completed",
          timestamp: "2025-01-01T00:00:00.000Z",
          attribution: "observed",
        },
      ],
    });
  });
});
