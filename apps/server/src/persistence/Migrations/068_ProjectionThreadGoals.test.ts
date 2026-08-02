import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as TestSqliteClient from "../TestSqliteClient.ts";
import ProjectionThreadGoals from "./068_ProjectionThreadGoals.ts";

const recordMigration = (migrationId: number, name: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO effect_sql_migrations (migration_id, name)
      VALUES (${migrationId}, ${name})
    `;
  });

const insertGoal = (threadId: string, objective: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
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
        ${threadId},
        ${objective},
        'active',
        1000,
        21,
        34,
        '2026-07-29T00:00:00.000Z',
        '2026-07-29T00:00:01.000Z'
      )
    `;
  });

describe("068_ProjectionThreadGoals", () => {
  it.effect("records goals at 68 without replacing migrations 62 or 64 through 67", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const through67 = yield* runMigrations({ toMigrationInclusive: 67 });
      assert.deepStrictEqual(
        through67.filter(([id]) => id >= 62),
        [
          [62, "UsageStatsTokenSavings"],
          [64, "ProviderPacingPendingLaunchCompatibility"],
          [65, "ForkLineageCompatibility"],
          [66, "ProjectionThreadAutoNudge"],
          [67, "ProjectionThreadManualFollowUps"],
        ],
      );
      yield* insertGoal("active-lineage-thread", "Preserve active-lineage goal");

      const executed = yield* runMigrations({ toMigrationInclusive: 68 });
      assert.deepStrictEqual(executed, [[68, "ProjectionThreadGoals"]]);

      const rows = yield* sql<{
        readonly objective: string;
        readonly tokensUsed: number;
        readonly timeUsedSeconds: number;
      }>`
        SELECT
          objective,
          tokens_used AS "tokensUsed",
          time_used_seconds AS "timeUsedSeconds"
        FROM projection_thread_goals
        WHERE thread_id = 'active-lineage-thread'
      `;
      assert.deepStrictEqual(rows, [
        {
          objective: "Preserve active-lineage goal",
          tokensUsed: 21,
          timeUsedSeconds: 34,
        },
      ]);
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("upgrades a database that previously recorded provider goals as migration 62", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* ProjectionThreadGoals;
      yield* insertGoal("alternate-lineage-thread", "Preserve alternate-lineage goal");
      yield* recordMigration(62, "ProjectionThreadGoals");

      const executed = yield* runMigrations({ toMigrationInclusive: 68 });
      assert.deepStrictEqual(executed, [
        [64, "ProviderPacingPendingLaunchCompatibility"],
        [65, "ForkLineageCompatibility"],
        [66, "ProjectionThreadAutoNudge"],
        [67, "ProjectionThreadManualFollowUps"],
        [68, "ProjectionThreadGoals"],
      ]);

      const rows = yield* sql<{
        readonly objective: string;
        readonly tokenBudget: number | null;
        readonly tokensUsed: number;
      }>`
        SELECT
          objective,
          token_budget AS "tokenBudget",
          tokens_used AS "tokensUsed"
        FROM projection_thread_goals
        WHERE thread_id = 'alternate-lineage-thread'
      `;
      assert.deepStrictEqual(rows, [
        {
          objective: "Preserve alternate-lineage goal",
          tokenBudget: 1000,
          tokensUsed: 21,
        },
      ]);

      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const threadColumnNames = new Set(threadColumns.map(({ name }) => name));
      assert.isTrue(threadColumnNames.has("auto_nudge_json"));
      assert.isTrue(threadColumnNames.has("manual_follow_ups_json"));

      const usageColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(usage_stats_token_breakdown_days)
      `;
      const usageColumnNames = new Set(usageColumns.map(({ name }) => name));
      assert.isTrue(usageColumnNames.has("cached_input_tokens"));
      assert.isTrue(usageColumnNames.has("cache_write_input_tokens"));
      assert.isTrue(usageColumnNames.has("compacted_input_tokens"));
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );
});
