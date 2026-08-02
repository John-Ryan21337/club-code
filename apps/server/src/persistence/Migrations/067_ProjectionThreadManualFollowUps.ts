import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const DEFAULT_THREAD_MANUAL_FOLLOW_UPS_JSON = "[]";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const existingColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!existingColumns.some(({ name }) => name === "manual_follow_ups_json")) {
    // Existing threads have no durable future operator intent. The bounded
    // prompt-bearing queue is populated only by explicit enqueue commands.
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN manual_follow_ups_json TEXT NOT NULL
      DEFAULT '[]'
    `;
  }
});
