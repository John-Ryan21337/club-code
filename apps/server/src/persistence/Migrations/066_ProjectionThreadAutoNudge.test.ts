import { ThreadAutoNudgeConfig } from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as TestSqliteClient from "../TestSqliteClient.ts";
import ProjectionThreadGoals from "./062_ProjectionThreadGoals.ts";
import { DEFAULT_THREAD_AUTO_NUDGE_JSON } from "./066_ProjectionThreadAutoNudge.ts";

const decodeThreadAutoNudgeConfig = Schema.decodeUnknownEffect(ThreadAutoNudgeConfig);

describe("066_ProjectionThreadAutoNudge", () => {
  it.effect("adds disabled exact-thread authority without consulting legacy settings", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 65 });
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

      const executed = yield* runMigrations({ toMigrationInclusive: 66 });
      assert.deepEqual(
        executed.map(([id]) => id),
        [66],
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
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("repairs a pre-release migration 65 database without replacing thread authority", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // Reproduce a fork-collision database: goals occupied 62, pacing
      // compatibility 64 was absent, and the pre-release Auto Nudge migration
      // advanced the ledger to 65.
      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* ProjectionThreadGoals;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (62, 'ProjectionThreadGoals')
      `;
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
          'thread-old-65',
          'project-1',
          'Old migration 65 thread',
          NULL,
          NULL,
          NULL,
          '2026-07-28T00:00:00.000Z',
          '2026-07-28T00:00:00.000Z'
        )
      `;
      yield* sql`
        ALTER TABLE projection_threads
        ADD COLUMN auto_nudge_json TEXT NOT NULL
        DEFAULT '{"authorityRevision":0,"mode":"off","prompt":"","backgroundContinuation":false,"maxRounds":5,"maxMinutes":30,"armedAt":null,"baselineSettledTurnId":null,"lastDispatchedSettledTurnId":null,"roundsDispatched":0,"lastDispatchedAt":null}'
      `;
      const oldAuthority =
        '{"authorityRevision":7,"mode":"steady-progress","prompt":"keep this exact thread moving","backgroundContinuation":false,"maxRounds":3,"maxMinutes":12,"armedAt":"2026-07-28T00:00:01.000Z","baselineSettledTurnId":"turn-7","lastDispatchedSettledTurnId":null,"roundsDispatched":0,"lastDispatchedAt":null}';
      yield* sql`
        UPDATE projection_threads
        SET auto_nudge_json = ${oldAuthority}
        WHERE thread_id = 'thread-old-65'
      `;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (65, 'ProjectionThreadAutoNudge')
      `;

      const executed = yield* runMigrations({ toMigrationInclusive: 66 });
      assert.deepStrictEqual(executed, [[66, "ProjectionThreadAutoNudge"]]);

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('projection_thread_goals', 'provider_pacing_pending_launches')
        ORDER BY name
      `;
      assert.deepStrictEqual(tables, [
        { name: "projection_thread_goals" },
        { name: "provider_pacing_pending_launches" },
      ]);

      const usageColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(usage_stats_token_breakdown_days)
      `;
      assert.deepStrictEqual(
        usageColumns
          .map(({ name }) => name)
          .filter((name) =>
            ["cached_input_tokens", "cache_write_input_tokens", "compacted_input_tokens"].includes(
              name,
            ),
          ),
        ["cached_input_tokens", "cache_write_input_tokens", "compacted_input_tokens"],
      );

      const rows = yield* sql<{ readonly autoNudgeJson: string }>`
        SELECT auto_nudge_json AS "autoNudgeJson"
        FROM projection_threads
        WHERE thread_id = 'thread-old-65'
      `;
      assert.equal(rows[0]?.autoNudgeJson, oldAuthority);
      const decodedAuthority = yield* decodeThreadAutoNudgeConfig(
        JSON.parse(rows[0]?.autoNudgeJson ?? "{}"),
      );
      assert.equal(decodedAuthority.mode, "steady-progress");
      assert.equal(decodedAuthority.prompt, "keep this exact thread moving");
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );
});
