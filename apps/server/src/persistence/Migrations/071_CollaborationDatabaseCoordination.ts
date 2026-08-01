import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_database_write_locks (
      shared_project_id TEXT PRIMARY KEY
    ) STRICT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_database_states (
      shared_project_id TEXT NOT NULL,
      database_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      engine TEXT NOT NULL CHECK(engine IN ('sqlite', 'duckdb', 'lmdb', 'unknown')),
      coordination_kind TEXT NOT NULL CHECK(
        coordination_kind IN ('external-service', 'private-forks', 'serialized-head')
      ),
      policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
      head_content_sha256 TEXT CHECK(
        head_content_sha256 IS NULL OR length(head_content_sha256) = 64
      ),
      head_snapshot_json TEXT CHECK(
        head_snapshot_json IS NULL OR json_valid(head_snapshot_json)
      ),
      last_fencing_token INTEGER NOT NULL DEFAULT 0 CHECK(
        last_fencing_token >= 0 AND last_fencing_token <= 9007199254740991
      ),
      active_lease_id TEXT,
      holder_user_id TEXT,
      holder_device_id TEXT,
      lease_membership_epoch INTEGER CHECK(
        lease_membership_epoch IS NULL OR (
          lease_membership_epoch >= 0 AND lease_membership_epoch <= 2147483647
        )
      ),
      lease_fencing_token INTEGER CHECK(
        lease_fencing_token IS NULL OR (
          lease_fencing_token > 0 AND lease_fencing_token <= 9007199254740991
        )
      ),
      lease_granted_at TEXT,
      lease_expires_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, database_id),
      CHECK(
        (head_content_sha256 IS NULL AND head_snapshot_json IS NULL) OR
        (head_content_sha256 IS NOT NULL AND head_snapshot_json IS NOT NULL)
      ),
      UNIQUE(shared_project_id, relative_path),
      CHECK(
        (active_lease_id IS NULL AND holder_user_id IS NULL AND holder_device_id IS NULL AND
          lease_membership_epoch IS NULL AND lease_fencing_token IS NULL AND
          lease_granted_at IS NULL AND lease_expires_at IS NULL) OR
        (active_lease_id IS NOT NULL AND holder_user_id IS NOT NULL AND
          holder_device_id IS NOT NULL AND lease_membership_epoch IS NOT NULL AND
          lease_fencing_token IS NOT NULL AND lease_granted_at IS NOT NULL AND
          lease_expires_at IS NOT NULL)
      )
    ) STRICT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_database_command_receipts (
      shared_project_id TEXT NOT NULL,
      database_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(
        operation IN ('configure', 'acquire', 'renew', 'release', 'publish')
      ),
      request_sha256 TEXT NOT NULL CHECK(length(request_sha256) = 64),
      response_json TEXT NOT NULL CHECK(json_valid(response_json)),
      response_sha256 TEXT NOT NULL CHECK(length(response_sha256) = 64),
      created_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, database_id, command_id),
      FOREIGN KEY(shared_project_id, database_id)
        REFERENCES collaboration_database_states(shared_project_id, database_id)
    ) STRICT
  `;
});
