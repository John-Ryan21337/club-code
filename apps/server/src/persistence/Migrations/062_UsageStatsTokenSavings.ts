import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // These counters deliberately store provider-reported cache reads/writes
  // and observed context reduction, not a synthetic billing estimate.
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
});
