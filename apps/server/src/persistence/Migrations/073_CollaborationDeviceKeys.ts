import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_project_devices (
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      device_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      first_enrolled_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, device_id)
    ) STRICT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_device_keys (
      device_key_id TEXT PRIMARY KEY,
      shared_project_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      public_key_spki_der BLOB NOT NULL CHECK(length(public_key_spki_der) = 44),
      membership_epoch INTEGER NOT NULL CHECK(
        membership_epoch >= 0 AND membership_epoch <= 2147483647
      ),
      activated_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY(shared_project_id, device_id)
        REFERENCES collaboration_project_devices(shared_project_id, device_id)
        ON DELETE CASCADE,
      CHECK(revoked_at IS NULL OR revoked_at >= activated_at)
    ) STRICT
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_collaboration_device_keys_one_active
    ON collaboration_device_keys(shared_project_id, device_id)
    WHERE revoked_at IS NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_collaboration_device_keys_authority
    ON collaboration_device_keys(shared_project_id, user_id, device_id, device_key_id, revoked_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_device_enrollment_challenges (
      challenge_id TEXT PRIMARY KEY,
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      device_key_id TEXT NOT NULL UNIQUE,
      public_key_spki_der BLOB NOT NULL CHECK(length(public_key_spki_der) = 44),
      nonce_sha256 TEXT NOT NULL CHECK(
        length(nonce_sha256) = 64 AND nonce_sha256 = lower(nonce_sha256) AND
        nonce_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      membership_epoch INTEGER NOT NULL CHECK(
        membership_epoch >= 0 AND membership_epoch <= 2147483647
      ),
      issued_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed_at TEXT,
      CHECK(expires_at > issued_at),
      CHECK(completed_at IS NULL OR completed_at >= issued_at)
    ) STRICT
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_collaboration_device_challenges_project_active
    ON collaboration_device_enrollment_challenges(shared_project_id, expires_at)
    WHERE completed_at IS NULL
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_device_command_receipts (
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      command_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN (
        'device-enrollment.begin',
        'device-enrollment.complete',
        'device-key.revoke'
      )),
      input_sha256 TEXT NOT NULL CHECK(
        length(input_sha256) = 64 AND input_sha256 = lower(input_sha256) AND
        input_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      actor_user_id TEXT NOT NULL,
      actor_device_id TEXT NOT NULL,
      actor_membership_epoch INTEGER NOT NULL CHECK(
        actor_membership_epoch >= 0 AND actor_membership_epoch <= 2147483647
      ),
      result_json TEXT NOT NULL,
      result_sha256 TEXT NOT NULL CHECK(
        length(result_sha256) = 64 AND result_sha256 = lower(result_sha256) AND
        result_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      created_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, command_id)
    ) STRICT
  `;
});
