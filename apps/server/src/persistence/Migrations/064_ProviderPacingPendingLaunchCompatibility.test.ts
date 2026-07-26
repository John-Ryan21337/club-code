import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import Migration0064 from "./064_ProviderPacingPendingLaunchCompatibility.ts";
import { migrationEntries, runMigrations } from "../Migrations.ts";
import * as TestSqliteClient from "../TestSqliteClient.ts";

type ColumnInfo = {
  readonly name: string;
  readonly notnull: number;
  readonly dflt_value: string | null;
  readonly pk: number;
};

type IndexInfo = {
  readonly name: string;
  readonly unique: number;
};

type IndexColumnInfo = {
  readonly name: string;
  readonly seqno: number;
};

const recordLegacyMigration = (migrationId: number, name: string) =>
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

const assertGoalsAndFinalPacingSchema = Effect.gen(function* () {
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

  const columns = yield* sql<ColumnInfo>`
    PRAGMA table_info(provider_pacing_pending_launches)
  `;
  assert.deepStrictEqual(
    columns.map(({ name, notnull, dflt_value: defaultValue, pk }) => ({
      name,
      notnull,
      defaultValue,
      pk,
    })),
    [
      { name: "thread_id", notnull: 1, defaultValue: null, pk: 1 },
      { name: "source_event_id", notnull: 1, defaultValue: null, pk: 0 },
      { name: "source_sequence", notnull: 1, defaultValue: null, pk: 0 },
      { name: "provider_instance_id", notnull: 1, defaultValue: null, pk: 0 },
      { name: "dispatch_source", notnull: 1, defaultValue: null, pk: 0 },
      { name: "requested_at", notnull: 1, defaultValue: null, pk: 0 },
      {
        name: "environment_id",
        notnull: 1,
        defaultValue: "'legacy-unverified'",
        pk: 0,
      },
      {
        name: "provider_account_id",
        notnull: 1,
        defaultValue: "'legacy-unverified'",
        pk: 0,
      },
      { name: "launch_state", notnull: 1, defaultValue: "'waiting'", pk: 0 },
    ],
  );

  const indexes = yield* sql<IndexInfo>`
    PRAGMA index_list(provider_pacing_pending_launches)
  `;
  assert.deepStrictEqual(
    indexes
      .filter(({ name }) => name.startsWith("idx_provider_pacing_pending_launches_"))
      .map(({ name, unique }) => ({ name, unique }))
      .toSorted((left, right) => left.name.localeCompare(right.name)),
    [
      { name: "idx_provider_pacing_pending_launches_requested_at", unique: 0 },
      { name: "idx_provider_pacing_pending_launches_state", unique: 0 },
    ],
  );

  const requestedAtIndex = yield* sql<IndexColumnInfo>`
    PRAGMA index_info(idx_provider_pacing_pending_launches_requested_at)
  `;
  assert.deepStrictEqual(
    requestedAtIndex.map(({ name }) => name),
    ["requested_at", "thread_id"],
  );
  const stateIndex = yield* sql<IndexColumnInfo>`
    PRAGMA index_info(idx_provider_pacing_pending_launches_state)
  `;
  assert.deepStrictEqual(
    stateIndex.map(({ name }) => name),
    ["launch_state", "requested_at", "thread_id"],
  );

  // The canonical pacing table is intentionally WITHOUT ROWID. Besides
  // preserving the shipped schema exactly, this keeps the thread primary key
  // as the sole table key instead of maintaining a redundant hidden row id.
  yield* Effect.flip(sql`SELECT rowid FROM provider_pacing_pending_launches`);
});

const assertFinalPacingConstraints = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO provider_pacing_pending_launches (
      thread_id,
      source_event_id,
      source_sequence,
      provider_instance_id,
      dispatch_source,
      requested_at
    ) VALUES (
      'constraint-control',
      'constraint-event',
      700,
      'claude-primary',
      'user',
      '2026-07-26T17:00:00.000Z'
    )
  `;

  for (const invalidInsert of [
    sql`
      INSERT INTO provider_pacing_pending_launches (
        thread_id, source_event_id, source_sequence, provider_instance_id,
        dispatch_source, requested_at
      ) VALUES (
        'duplicate-event', 'constraint-event', 701, 'claude-primary',
        'user', '2026-07-26T17:00:01.000Z'
      )
    `,
    sql`
      INSERT INTO provider_pacing_pending_launches (
        thread_id, source_event_id, source_sequence, provider_instance_id,
        dispatch_source, requested_at
      ) VALUES (
        'fractional-sequence', 'constraint-event-fractional', 7.5, 'claude-primary',
        'user', '2026-07-26T17:00:01.000Z'
      )
    `,
    sql`
      INSERT INTO provider_pacing_pending_launches (
        thread_id, source_event_id, source_sequence, provider_instance_id,
        dispatch_source, requested_at
      ) VALUES (
        'duplicate-sequence', 'constraint-event-2', 700, 'claude-primary',
        'user', '2026-07-26T17:00:01.000Z'
      )
    `,
    sql`
      INSERT INTO provider_pacing_pending_launches (
        thread_id, source_event_id, source_sequence, provider_instance_id,
        dispatch_source, requested_at
      ) VALUES (
        'negative-sequence', 'constraint-event-3', -1, 'claude-primary',
        'user', '2026-07-26T17:00:01.000Z'
      )
    `,
    sql`
      INSERT INTO provider_pacing_pending_launches (
        thread_id, source_event_id, source_sequence, provider_instance_id,
        dispatch_source, requested_at
      ) VALUES (
        'invalid-source', 'constraint-event-4', 704, 'claude-primary',
        'auto-nudge', '2026-07-26T17:00:01.000Z'
      )
    `,
    sql`
      INSERT INTO provider_pacing_pending_launches (
        thread_id, source_event_id, source_sequence, provider_instance_id,
        dispatch_source, requested_at, launch_state
      ) VALUES (
        'invalid-state', 'constraint-event-5', 705, 'claude-primary',
        'user', '2026-07-26T17:00:01.000Z', 'paused'
      )
    `,
  ]) {
    yield* Effect.flip(invalidInsert);
  }
});

describe("064_ProviderPacingPendingLaunchCompatibility", () => {
  it.effect("keeps canonical upstream migration 62, retires 63, and installs 64 from fresh", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      assert.deepStrictEqual(
        migrationEntries.filter(([id]) => id >= 60).map(([id, name]) => [id, name]),
        [
          [60, "ProjectionTurnCheckpointCompletedAt"],
          [61, "UsageStatsTokenBreakdown"],
          [62, "ProjectionThreadGoals"],
          [64, "ProviderPacingPendingLaunchCompatibility"],
        ],
      );

      yield* runMigrations({ toMigrationInclusive: 64 });
      const recorded = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 62
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(recorded, [
        { migration_id: 62, name: "ProjectionThreadGoals" },
        { migration_id: 64, name: "ProviderPacingPendingLaunchCompatibility" },
      ]);
      yield* assertGoalsAndFinalPacingSchema;
      yield* assertFinalPacingConstraints;
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("upgrades a database that already ran canonical upstream migration 62", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 62 });

      const before = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'provider_pacing_pending_launches'
      `;
      assert.deepStrictEqual(before, []);

      const executed = yield* runMigrations({ toMigrationInclusive: 64 });
      assert.deepStrictEqual(executed, [[64, "ProviderPacingPendingLaunchCompatibility"]]);
      yield* assertGoalsAndFinalPacingSchema;
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("upgrades legacy pacing migration 62 without losing its row or constraints", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* createLegacyPacing62;
      yield* sql`
        INSERT INTO provider_pacing_pending_launches (
          thread_id, source_event_id, source_sequence, provider_instance_id,
          dispatch_source, requested_at
        ) VALUES (
          'legacy-thread', 'legacy-event', 62, 'claude-primary',
          'user', '2026-07-26T17:00:00.000Z'
        )
      `;
      yield* recordLegacyMigration(62, "ProviderPacingPendingLaunches");

      const executed = yield* runMigrations({ toMigrationInclusive: 64 });
      assert.deepStrictEqual(executed, [[64, "ProviderPacingPendingLaunchCompatibility"]]);
      yield* assertGoalsAndFinalPacingSchema;

      const rows = yield* sql<{
        readonly threadId: string;
        readonly sourceEventId: string;
        readonly sourceSequence: number;
        readonly environmentId: string;
        readonly providerAccountId: string;
        readonly launchState: string;
      }>`
        SELECT
          thread_id AS "threadId",
          source_event_id AS "sourceEventId",
          source_sequence AS "sourceSequence",
          environment_id AS "environmentId",
          provider_account_id AS "providerAccountId",
          launch_state AS "launchState"
        FROM provider_pacing_pending_launches
      `;
      assert.deepStrictEqual(rows, [
        {
          threadId: "legacy-thread",
          sourceEventId: "legacy-event",
          sourceSequence: 62,
          environmentId: "legacy-unverified",
          providerAccountId: "legacy-unverified",
          launchState: "waiting",
        },
      ]);
      yield* assertFinalPacingConstraints;
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("preserves the completed legacy pacing 63 schema and dispatching row", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* createLegacyPacing62;
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
      yield* sql`
        INSERT INTO provider_pacing_pending_launches (
          thread_id, source_event_id, source_sequence, provider_instance_id,
          dispatch_source, requested_at, environment_id, provider_account_id, launch_state
        ) VALUES (
          'dispatching-thread', 'dispatching-event', 63, 'codex-primary',
          'user', '2026-07-26T17:00:00.000Z', 'environment-a', 'account-a', 'dispatching'
        )
      `;
      yield* recordLegacyMigration(62, "ProviderPacingPendingLaunches");
      yield* recordLegacyMigration(63, "ProviderPacingPendingLaunchState");

      const executed = yield* runMigrations({ toMigrationInclusive: 64 });
      assert.deepStrictEqual(executed, [[64, "ProviderPacingPendingLaunchCompatibility"]]);
      yield* assertGoalsAndFinalPacingSchema;
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
        WHERE thread_id = 'dispatching-thread'
      `;
      assert.deepStrictEqual(rows, [
        {
          environmentId: "environment-a",
          providerAccountId: "account-a",
          launchState: "dispatching",
        },
      ]);
      const recorded = yield* sql<{
        readonly migration_id: number;
        readonly name: string;
      }>`
        SELECT migration_id, name
        FROM effect_sql_migrations
        WHERE migration_id >= 62
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(recorded, [
        { migration_id: 62, name: "ProviderPacingPendingLaunches" },
        { migration_id: 63, name: "ProviderPacingPendingLaunchState" },
        { migration_id: 64, name: "ProviderPacingPendingLaunchCompatibility" },
      ]);
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );

  it.effect("repairs goals for an actual 4c9907c5 token-savings migration 62 database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 61 });
      yield* sql`
        ALTER TABLE usage_stats_token_breakdown_days
        ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(cached_input_tokens) = 'integer' AND cached_input_tokens >= 0)
      `;
      yield* sql`
        ALTER TABLE usage_stats_token_breakdown_days
        ADD COLUMN cache_write_input_tokens INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(cache_write_input_tokens) = 'integer' AND cache_write_input_tokens >= 0)
      `;
      yield* sql`
        ALTER TABLE usage_stats_token_breakdown_days
        ADD COLUMN compacted_input_tokens INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(compacted_input_tokens) = 'integer' AND compacted_input_tokens >= 0)
      `;
      yield* sql`
        INSERT INTO usage_stats_token_breakdown_days (
          day, provider_driver, model, output_tokens, cached_input_tokens,
          cache_write_input_tokens, compacted_input_tokens
        ) VALUES ('2026-07-26', 'codex', 'sol', 7, 11, 13, 17)
      `;
      yield* recordLegacyMigration(62, "UsageStatsTokenSavings");

      const executed = yield* runMigrations({ toMigrationInclusive: 64 });
      assert.deepStrictEqual(executed, [[64, "ProviderPacingPendingLaunchCompatibility"]]);
      yield* assertGoalsAndFinalPacingSchema;
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
        WHERE day = '2026-07-26' AND provider_driver = 'codex' AND model = 'sol'
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

  it.effect("is idempotent when reconciliation is invoked more than once", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 62 });
      yield* Migration0064;
      yield* Migration0064;
      yield* assertGoalsAndFinalPacingSchema;
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );
});
