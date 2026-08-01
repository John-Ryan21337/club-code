import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";
import * as TestSqliteClient from "../TestSqliteClient.ts";

describe("076_CollaborationTaskCoordination", () => {
  it.effect("installs once with the bounded task authority tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 75 });
      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 76 }), [
        [76, "CollaborationTaskCoordination"],
      ]);
      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 76 }), []);
      const rows = yield* sql<{
        name: string;
      }>`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'collaboration_task_%' ORDER BY name`;
      assert.deepStrictEqual(
        rows.map((row) => row.name),
        [
          "collaboration_task_audit_events",
          "collaboration_task_dependencies",
          "collaboration_task_write_locks",
          "collaboration_tasks",
        ],
      );
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );
});
