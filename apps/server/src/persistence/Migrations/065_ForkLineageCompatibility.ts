import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import ProviderPacingPendingLaunchCompatibility from "./064_ProviderPacingPendingLaunchCompatibility.ts";

type TableColumn = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  /**
   * Migration 64 was published on current-dev before the active experience
   * branch's UsageStatsTokenSavings migration was merged. Re-run its
   * idempotent repair so 65 is a convergence boundary even for databases that
   * already recorded a different migration 64.
   */
  yield* ProviderPacingPendingLaunchCompatibility;

  const existingColumns = yield* sql<TableColumn>`
    PRAGMA table_info(usage_stats_token_breakdown_days)
  `;
  const columnNames = new Set(existingColumns.map(({ name }) => name));

  /**
   * Goals-62 and pacing-62/63 databases never ran the active branch's
   * token-savings migration. Add each column independently so the repair also
   * tolerates a partially applied manual reconciliation.
   */
  if (!columnNames.has("cached_input_tokens")) {
    yield* sql`
      ALTER TABLE usage_stats_token_breakdown_days
      ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0
      CHECK (typeof(cached_input_tokens) = 'integer' AND cached_input_tokens >= 0)
    `;
  }
  if (!columnNames.has("cache_write_input_tokens")) {
    yield* sql`
      ALTER TABLE usage_stats_token_breakdown_days
      ADD COLUMN cache_write_input_tokens INTEGER NOT NULL DEFAULT 0
      CHECK (typeof(cache_write_input_tokens) = 'integer' AND cache_write_input_tokens >= 0)
    `;
  }
  if (!columnNames.has("compacted_input_tokens")) {
    yield* sql`
      ALTER TABLE usage_stats_token_breakdown_days
      ADD COLUMN compacted_input_tokens INTEGER NOT NULL DEFAULT 0
      CHECK (typeof(compacted_input_tokens) = 'integer' AND compacted_input_tokens >= 0)
    `;
  }
});
