import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as TestSqliteClient from "../TestSqliteClient.ts";
import ProjectionThreadGoals from "./068_ProjectionThreadGoals.ts";
import Migration0064 from "./064_ProviderPacingPendingLaunchCompatibility.ts";
import Migration0065 from "./065_ForkLineageCompatibility.ts";

type ColumnInfo = {
  readonly name: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
};

const recordMigration = (migrationId: number, name: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO effect_sql_migrations (migration_id, name)
      VALUES (${migrationId}, ${name})
    `;
  });

const createLegacyPacing62 = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE provider_pacing_pending_launches (
      thread_id TEXT PRIMARY KEY,
      source_event_id TEXT NOT NULL UNIQUE,
      source_sequence INTEGER NOT NULL UNIQUE,
      provider_instance_id TEXT NOT NULL,
      dispatch_source TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      CHECK (typeof(source_sequence) = 'integer' AND source_sequence >= 0),
      CHECK (dispatch_source = 'user')
    ) WITHOUT ROWID
  `;
  yield* sql`
    CREATE INDEX idx_provider_pacing_pending_launches_requested_at
    ON provider_pacing_pending_launches(requested_at, thread_id)
  `;
});

const upgradeLegacyPacing63 = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    ALTER TABLE provider_pacing_pending_launches
    ADD COLUMN environment_id TEXT NOT NULL DEFAULT 'legacy-unverified'
  `;
  yield* sql`
    ALTER TABLE provider_pacing_pending_launches
    ADD COLUMN provider_account_id TEXT NOT NULL DEFAULT 'legacy-unverified'
  `;
  yield* sql`
    ALTER TABLE provider_pacing_pending_launches
    ADD COLUMN launch_state TEXT NOT NULL DEFAULT 'waiting'
      CHECK (launch_state IN ('waiting', 'dispatching'))
  `;
  yield* sql`
    CREATE INDEX idx_provider_pacing_pending_launches_state
    ON provider_pacing_pending_launches(launch_state, requested_at, thread_id)
  `;
});

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

  const usageColumns = yield* sql<ColumnInfo>`
    PRAGMA table_info(usage_stats_token_breakdown_days)
  `;
  assert.deepStrictEqual(
    usageColumns
      .filter(({ name }) =>
        ["cached_input_tokens", "cache_write_input_tokens", "compacted_input_tokens"].includes(
          name,
        ),
      )
      .map(({ name, notnull, dflt_value: defaultValue }) => ({
        name,
        notnull,
        defaultValue,
      })),
    [
      { name: "cached_input_tokens", notnull: 1, defaultValue: "0" },
      { name: "cache_write_input_tokens", notnull: 1, defaultValue: "0" },
      { name: "compacted_input_tokens", notnull: 1, defaultValue: "0" },
    ],
  );

  const pacingColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(provider_pacing_pending_launches)
  `;
  assert.deepStrictEqual(
    pacingColumns.map(({ name }) => name),
    [
      "thread_id",
      "source_event_id",
      "source_sequence",
      "provider_instance_id",
      "dispatch_source",
      "requested_at",
      "environment_id",
      "provider_account_id",
      "launch_state",
    ],
  );

  const indexes = yield* sql<{ readonly name: string }>`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND name LIKE 'idx_provider_pacing_pending_launches_%'
    ORDER BY name
  `;
  assert.deepStrictEqual(indexes, [
    { name: "idx_provider_pacing_pending_launches_requested_at" },
    { name: "idx_provider_pacing_pending_launches_state" },
  ]);
});

describe("065_ForkLineageCompatibility", () => {
  it.effect("converges a fresh database without reusing retired migration 63", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      assert.deepStrictEqual(
        migrationEntries.filter(([id]) => id >= 60).map(([id, name]) => [id, name]),
        [
          [60, "ProjectionTurnCheckpointCompletedAt"],
          [61, "UsageStatsTokenBreakdown"],
          [62, "UsageStatsTokenSavings"],
          [64, "ProviderPacingPendingLaunchCompatibility"],
          [65, "ForkLineageCompatibility"],
          [70, "CollaborationEvents"],
          [71, "CollaborationDatabaseCoordination"],
          [72, "CollaborationMemberships"],
          [73, "CollaborationDeviceKeys"],
          [74, "CollaborationAuthoredMessages"],
          [75, "CollaborationFileSync"],
          [76, "CollaborationTaskCoordination"],
        ],
      );

      yield* runMigrations({ toMigrationInclusive: 65 });
      yield* assertConvergedSchema;

      const recorded = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 62
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(recorded, [
        { migration_id: 62, name: "UsageStatsTokenSavings" },
        { migration_id: 64, name: "ProviderPacingPendingLaunchCompatibility" },
        { migration_id: 65, name: "ForkLineageCompatibility" },
      ]);

      yield* sql`
        INSERT INTO usage_stats_token_breakdown_days (
          day,
          provider_driver,
          model,
          output_tokens
        ) VALUES ('2026-07-28', 'codex', 'sol', 1)
      `;
      for (const invalidUpdate of [
        sql`
          UPDATE usage_stats_token_breakdown_days
          SET cached_input_tokens = -1
          WHERE day = '2026-07-28'
        `,
        sql`
          UPDATE usage_stats_token_breakdown_days
          SET cache_write_input_tokens = 1.5
          WHERE day = '2026-07-28'
        `,
        sql`
          UPDATE usage_stats_token_breakdown_days
          SET compacted_input_tokens = -1
          WHERE day = '2026-07-28'
        `,
      ]) {
        yield* Effect.flip(invalidUpdate);
      }

      yield* Effect.flip(sql`
        INSERT INTO provider_pacing_pending_launches (
          thread_id,
          source_event_id,
          source_sequence,
          provider_instance_id,
          dispatch_source,
          requested_at
        ) VALUES (
          'invalid-source',
          'event-invalid-source',
          1,
          'claude-primary',
          'auto-nudge',
          '2026-07-28T00:00:00.000Z'
        )
      `);
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("preserves an active UsageStatsTokenSavings migration 62 database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 62 });
      yield* sql`
        INSERT INTO usage_stats_token_breakdown_days (
          day,
          provider_driver,
          model,
          output_tokens,
          cached_input_tokens,
          cache_write_input_tokens,
          compacted_input_tokens
        ) VALUES ('2026-07-28', 'codex', 'sol', 7, 11, 13, 17)
      `;

      const executed = yield* runMigrations({ toMigrationInclusive: 65 });
      assert.deepStrictEqual(executed, [
        [64, "ProviderPacingPendingLaunchCompatibility"],
        [65, "ForkLineageCompatibility"],
      ]);
      yield* assertConvergedSchema;

      const rows = yield* sql<{
        readonly outputTokens: number;
        readonly cachedInputTokens: number;
        readonly cacheWriteInputTokens: number;
        readonly compactedInputTokens: number;
      }>`
        SELECT
          output_tokens AS "outputTokens",
          cached_input_tokens AS "cachedInputTokens",
          cache_write_input_tokens AS "cacheWriteInputTokens",
          compacted_input_tokens AS "compactedInputTokens"
        FROM usage_stats_token_breakdown_days
        WHERE day = '2026-07-28'
      `;
      assert.deepStrictEqual(rows, [
        {
          outputTokens: 7,
          cachedInputTokens: 11,
          cacheWriteInputTokens: 13,
          compactedInputTokens: 17,
        },
      ]);
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("repairs and preserves a ProjectionThreadGoals migration 62 database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* sql`
        INSERT INTO usage_stats_token_breakdown_days (
          day,
          provider_driver,
          model,
          output_tokens
        ) VALUES ('2026-07-28', 'claudeAgent', 'opus', 19)
      `;
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
      yield* recordMigration(62, "ProjectionThreadGoals");

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

      const usage = yield* sql<{
        readonly outputTokens: number;
        readonly cachedInputTokens: number;
        readonly cacheWriteInputTokens: number;
        readonly compactedInputTokens: number;
      }>`
        SELECT
          output_tokens AS "outputTokens",
          cached_input_tokens AS "cachedInputTokens",
          cache_write_input_tokens AS "cacheWriteInputTokens",
          compacted_input_tokens AS "compactedInputTokens"
        FROM usage_stats_token_breakdown_days
        WHERE day = '2026-07-28'
      `;
      assert.deepStrictEqual(usage, [
        {
          outputTokens: 19,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          compactedInputTokens: 0,
        },
      ]);
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("upgrades a legacy pacing migration 62 row without losing identity", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* createLegacyPacing62;
      yield* sql`
        INSERT INTO provider_pacing_pending_launches (
          thread_id,
          source_event_id,
          source_sequence,
          provider_instance_id,
          dispatch_source,
          requested_at
        ) VALUES (
          'pacing-62-thread',
          'pacing-62-event',
          62,
          'claude-primary',
          'user',
          '2026-07-28T00:00:00.000Z'
        )
      `;
      yield* recordMigration(62, "ProviderPacingPendingLaunches");

      const executed = yield* runMigrations({ toMigrationInclusive: 65 });
      assert.deepStrictEqual(executed, [
        [64, "ProviderPacingPendingLaunchCompatibility"],
        [65, "ForkLineageCompatibility"],
      ]);
      yield* assertConvergedSchema;

      const rows = yield* sql<{
        readonly sourceEventId: string;
        readonly sourceSequence: number;
        readonly environmentId: string;
        readonly providerAccountId: string;
        readonly launchState: string;
      }>`
        SELECT
          source_event_id AS "sourceEventId",
          source_sequence AS "sourceSequence",
          environment_id AS "environmentId",
          provider_account_id AS "providerAccountId",
          launch_state AS "launchState"
        FROM provider_pacing_pending_launches
        WHERE thread_id = 'pacing-62-thread'
      `;
      assert.deepStrictEqual(rows, [
        {
          sourceEventId: "pacing-62-event",
          sourceSequence: 62,
          environmentId: "legacy-unverified",
          providerAccountId: "legacy-unverified",
          launchState: "waiting",
        },
      ]);
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("preserves a completed pacing migration 63 dispatching row", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* createLegacyPacing62;
      yield* upgradeLegacyPacing63;
      yield* sql`
        INSERT INTO provider_pacing_pending_launches (
          thread_id,
          source_event_id,
          source_sequence,
          provider_instance_id,
          dispatch_source,
          requested_at,
          environment_id,
          provider_account_id,
          launch_state
        ) VALUES (
          'pacing-63-thread',
          'pacing-63-event',
          63,
          'codex-primary',
          'user',
          '2026-07-28T00:00:00.000Z',
          'environment-a',
          'account-a',
          'dispatching'
        )
      `;
      yield* recordMigration(62, "ProviderPacingPendingLaunches");
      yield* recordMigration(63, "ProviderPacingPendingLaunchState");

      const executed = yield* runMigrations({ toMigrationInclusive: 65 });
      assert.deepStrictEqual(executed, [
        [64, "ProviderPacingPendingLaunchCompatibility"],
        [65, "ForkLineageCompatibility"],
      ]);
      yield* assertConvergedSchema;

      const rows = yield* sql<{
        readonly environmentId: string;
        readonly providerAccountId: string;
        readonly launchState: string;
      }>`
        SELECT
          environment_id AS "environmentId",
          provider_account_id AS "providerAccountId",
          launch_state AS "launchState"
        FROM provider_pacing_pending_launches
        WHERE thread_id = 'pacing-63-thread'
      `;
      assert.deepStrictEqual(rows, [
        {
          environmentId: "environment-a",
          providerAccountId: "account-a",
          launchState: "dispatching",
        },
      ]);
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("repairs usage columns after current-dev migration 64 was already recorded", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* ProjectionThreadGoals;
      yield* recordMigration(62, "ProjectionThreadGoals");
      yield* Migration0064;
      yield* recordMigration(64, "ProviderPacingPendingLaunchCompatibility");

      const before = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(usage_stats_token_breakdown_days)
      `;
      assert.isFalse(before.some(({ name }) => name === "cached_input_tokens"));

      const executed = yield* runMigrations({ toMigrationInclusive: 65 });
      assert.deepStrictEqual(executed, [[65, "ForkLineageCompatibility"]]);
      yield* assertConvergedSchema;
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("fills a partial usage repair and remains idempotent", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* sql`
        ALTER TABLE usage_stats_token_breakdown_days
        ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(cached_input_tokens) = 'integer' AND cached_input_tokens >= 0)
      `;

      yield* Migration0065;
      yield* Migration0065;
      yield* assertConvergedSchema;
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );
});
