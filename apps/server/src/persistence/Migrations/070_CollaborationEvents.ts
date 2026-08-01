import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_event_write_locks (
      shared_project_id TEXT PRIMARY KEY
    ) STRICT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_events (
      shared_project_id TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK(sequence > 0 AND sequence <= 9007199254740991),
      event_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      proposal_sha256 TEXT NOT NULL CHECK(length(proposal_sha256) = 64),
      envelope_sha256 TEXT NOT NULL CHECK(length(envelope_sha256) = 64),
      membership_epoch INTEGER NOT NULL CHECK(
        membership_epoch >= 0 AND membership_epoch <= 2147483647
      ),
      actor_json TEXT NOT NULL,
      device_key_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
      previous_event_sha256 TEXT CHECK(
        previous_event_sha256 IS NULL OR length(previous_event_sha256) = 64
      ),
      author_signature TEXT NOT NULL,
      causation_event_id TEXT,
      correlation_id TEXT,
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, sequence),
      UNIQUE(shared_project_id, event_id),
      UNIQUE(shared_project_id, command_id)
    ) STRICT
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_collaboration_events_project_replay
    ON collaboration_events(shared_project_id, sequence)
  `;
});
