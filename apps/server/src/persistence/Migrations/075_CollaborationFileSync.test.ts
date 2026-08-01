import { assert, describe, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import { runMigrations } from "../Migrations.ts";

describe("migration 075 collaboration file sync", () => {
  it.effect("keeps 074 reserved and installs the immutable file authority only at 075", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 73 });
      const sql = yield* SqlClient.SqlClient;
      const before = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name = 'collaboration_file_versions'
      `;
      assert.equal(before[0]?.count, 0);
      yield* runMigrations({ toMigrationInclusive: 75 });
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'collaboration_file_%'
        ORDER BY name
      `;
      assert.deepEqual(
        tables.map((row) => row.name),
        [
          "collaboration_file_chunks",
          "collaboration_file_command_receipts",
          "collaboration_file_conflicts",
          "collaboration_file_contents",
          "collaboration_file_heads",
          "collaboration_file_tombstones",
          "collaboration_file_versions",
          "collaboration_file_write_locks",
        ],
      );
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );
});
