import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import ForkLineageCompatibility from "./065_ForkLineageCompatibility.ts";

export const DEFAULT_THREAD_AUTO_NUDGE_JSON =
  '{"authorityRevision":0,"mode":"off","prompt":"","backgroundContinuation":false,"maxRounds":5,"maxMinutes":30,"armedAt":null,"baselineSettledTurnId":null,"lastDispatchedSettledTurnId":null,"roundsDispatched":0,"lastDispatchedAt":null}';

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  /**
   * A pre-release exact-thread build recorded migration 65 without first
   * loading published migration 64. Re-run the compatibility boundary here
   * and make the column addition conditional so those local databases can
   * converge without losing their exact-thread configuration.
   */
  yield* ForkLineageCompatibility;

  const existingColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!existingColumns.some(({ name }) => name === "auto_nudge_json")) {
    // Every pre-existing thread receives disabled authority. Legacy
    // profile-wide settings deliberately do not arm or configure any thread.
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN auto_nudge_json TEXT NOT NULL
      DEFAULT '{"authorityRevision":0,"mode":"off","prompt":"","backgroundContinuation":false,"maxRounds":5,"maxMinutes":30,"armedAt":null,"baselineSettledTurnId":null,"lastDispatchedSettledTurnId":null,"roundsDispatched":0,"lastDispatchedAt":null}'
    `;
  }
});
