import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import ProjectionThreadGoals from "./068_ProjectionThreadGoals.ts";

type TableColumn = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  /**
   * Migration id 62 was published with three different meanings while the
   * fork and upstream were moving independently:
   *
   * - current upstream: projection thread goals;
   * - build 4c9907c5: usage-stat token-savings columns;
   * - an early pacing stack: the pending-launch table.
   *
   * Effect's migrator advances by numeric id, so a database that ran either
   * fork migration will skip the alternate goals-at-62 migration forever.
   * Re-running the idempotent goal-table effect preserves the already-published
   * migration-64 compatibility boundary. Migration 68 records that table on
   * the active lineage without reusing migration 62.
   */
  yield* ProjectionThreadGoals;

  const existingColumns = yield* sql<TableColumn>`
    PRAGMA table_info(provider_pacing_pending_launches)
  `;
  const columnNames = new Set(existingColumns.map(({ name }) => name));

  if (existingColumns.length === 0) {
    yield* sql`
      CREATE TABLE provider_pacing_pending_launches (
        thread_id TEXT PRIMARY KEY,
        source_event_id TEXT NOT NULL UNIQUE,
        source_sequence INTEGER NOT NULL UNIQUE,
        provider_instance_id TEXT NOT NULL,
        dispatch_source TEXT NOT NULL,
        requested_at TEXT NOT NULL,
        environment_id TEXT NOT NULL DEFAULT 'legacy-unverified',
        provider_account_id TEXT NOT NULL DEFAULT 'legacy-unverified',
        launch_state TEXT NOT NULL DEFAULT 'waiting'
          CHECK (launch_state IN ('waiting', 'dispatching')),
        CHECK (typeof(source_sequence) = 'integer' AND source_sequence >= 0),
        CHECK (dispatch_source = 'user')
      ) WITHOUT ROWID
    `;
  } else {
    if (!columnNames.has("environment_id")) {
      yield* sql`
        ALTER TABLE provider_pacing_pending_launches
        ADD COLUMN environment_id TEXT NOT NULL DEFAULT 'legacy-unverified'
      `;
    }
    if (!columnNames.has("provider_account_id")) {
      yield* sql`
        ALTER TABLE provider_pacing_pending_launches
        ADD COLUMN provider_account_id TEXT NOT NULL DEFAULT 'legacy-unverified'
      `;
    }
    if (!columnNames.has("launch_state")) {
      yield* sql`
        ALTER TABLE provider_pacing_pending_launches
        ADD COLUMN launch_state TEXT NOT NULL DEFAULT 'waiting'
          CHECK (launch_state IN ('waiting', 'dispatching'))
      `;
    }
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_pacing_pending_launches_requested_at
    ON provider_pacing_pending_launches(requested_at, thread_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_provider_pacing_pending_launches_state
    ON provider_pacing_pending_launches(launch_state, requested_at, thread_id)
  `;
});
