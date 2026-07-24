import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as TestSqliteClient from "../TestSqliteClient.ts";
import ProjectionThreadGoals from "./068_ProjectionThreadGoals.ts";

const assertConvergedSchema = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
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
  const names = new Set(usageColumns.map(({ name }) => name));
  assert.isTrue(names.has("cached_input_tokens"));
  assert.isTrue(names.has("cache_write_input_tokens"));
  assert.isTrue(names.has("compacted_input_tokens"));
});

describe("065_ForkLineageCompatibility", () => {
  it.effect("converges a fresh database without reusing retired migration 63", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(
        migrationEntries.filter(([id]) => id >= 60).map(([id, name]) => [id, name]),
        [
          [60, "ProjectionTurnCheckpointCompletedAt"],
          [61, "UsageStatsTokenBreakdown"],
          [62, "UsageStatsTokenSavings"],
          [64, "ProviderPacingPendingLaunchCompatibility"],
          [65, "ForkLineageCompatibility"],
        ],
      );

      yield* runMigrations({ toMigrationInclusive: 65 });
      yield* assertConvergedSchema;
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("repairs a database that already recorded provider goals as migration 62", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* ProjectionThreadGoals;
      yield* sql`
        INSERT INTO projection_thread_goals (
          thread_id,
          objective,
          status,
          token_budget,
          tokens_used,
          time_used_seconds,
          created_at,
          updated_at
        ) VALUES (
          'goal-thread',
          'Preserve this goal',
          'active',
          1000,
          21,
          34,
          '2026-07-28T00:00:00.000Z',
          '2026-07-28T00:00:01.000Z'
        )
      `;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (62, 'ProjectionThreadGoals')
      `;

      const executed = yield* runMigrations({ toMigrationInclusive: 65 });
      assert.deepStrictEqual(executed, [
        [64, "ProviderPacingPendingLaunchCompatibility"],
        [65, "ForkLineageCompatibility"],
      ]);
      yield* assertConvergedSchema;

      const goals = yield* sql<{ readonly objective: string; readonly tokensUsed: number }>`
        SELECT objective, tokens_used AS "tokensUsed"
        FROM projection_thread_goals
        WHERE thread_id = 'goal-thread'
      `;
      assert.deepStrictEqual(goals, [{ objective: "Preserve this goal", tokensUsed: 21 }]);
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );
});
