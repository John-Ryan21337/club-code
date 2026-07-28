import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as TestSqliteClient from "../TestSqliteClient.ts";
import { DEFAULT_THREAD_AUTO_NUDGE_JSON } from "./065_ProjectionThreadAutoNudge.ts";

const layer = it.layer(Layer.mergeAll(TestSqliteClient.layerMemory()));

layer("065_ProjectionThreadAutoNudge", (it) => {
  it.effect("adds disabled exact-thread authority without consulting legacy settings", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 62 });
      // Simulate a database that already ran the published pacing migrations
      // occupying 63/64 on another active stack ref. Numeric latest-id gating
      // must still leave 65 eligible.
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (64, 'ProviderPacingCompatibilityRefs')
      `;
      const beforeColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.isFalse(beforeColumns.some((column) => column.name === "auto_nudge_json"));
      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at
        )
        VALUES (
          'thread-existing',
          'project-1',
          'Existing thread',
          NULL,
          NULL,
          NULL,
          '2026-07-28T00:00:00.000Z',
          '2026-07-28T00:00:00.000Z'
        )
      `;

      const executed = yield* runMigrations({ toMigrationInclusive: 65 });
      assert.deepEqual(
        executed.map(([id]) => id),
        [65],
      );

      const columns = yield* sql<{
        readonly name: string;
        readonly notnull: number;
        readonly dflt_value: string | null;
      }>`PRAGMA table_info(projection_threads)`;
      const column = columns.find((entry) => entry.name === "auto_nudge_json");
      assert.deepEqual(
        column === undefined
          ? null
          : {
              name: column.name,
              notnull: column.notnull,
              defaultValue: column.dflt_value,
            },
        {
          name: "auto_nudge_json",
          notnull: 1,
          defaultValue: `'${DEFAULT_THREAD_AUTO_NUDGE_JSON}'`,
        },
      );

      const rows = yield* sql<{ readonly autoNudgeJson: string }>`
        SELECT auto_nudge_json AS "autoNudgeJson"
        FROM projection_threads
        WHERE thread_id = 'thread-existing'
      `;
      assert.equal(rows[0]?.autoNudgeJson, DEFAULT_THREAD_AUTO_NUDGE_JSON);
      assert.equal(JSON.parse(rows[0]?.autoNudgeJson ?? "{}").mode, "off");
    }),
  );
});
