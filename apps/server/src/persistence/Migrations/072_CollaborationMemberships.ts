import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_projects (
      shared_project_id TEXT PRIMARY KEY,
      membership_epoch INTEGER NOT NULL CHECK(
        membership_epoch >= 0 AND membership_epoch <= 2147483647
      ),
      updated_at TEXT NOT NULL
    ) STRICT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_project_members (
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'operator', 'contributor', 'viewer')),
      permissions_json TEXT NOT NULL,
      joined_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, user_id)
    ) STRICT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_project_invitations (
      invitation_id TEXT PRIMARY KEY,
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      secret_sha256 TEXT NOT NULL UNIQUE CHECK(
        length(secret_sha256) = 64 AND secret_sha256 = lower(secret_sha256)
      ),
      role TEXT NOT NULL CHECK(role IN ('admin', 'operator', 'contributor', 'viewer')),
      permissions_json TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      not_before TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      redeemed_at TEXT,
      redeemed_by_user_id TEXT,
      revoked_at TEXT,
      CHECK(not_before >= created_at),
      CHECK(expires_at > not_before),
      CHECK((redeemed_at IS NULL) = (redeemed_by_user_id IS NULL)),
      CHECK(NOT (redeemed_at IS NOT NULL AND revoked_at IS NOT NULL))
    ) STRICT
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_collaboration_invitations_project_active
    ON collaboration_project_invitations(shared_project_id, expires_at)
    WHERE redeemed_at IS NULL AND revoked_at IS NULL
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_membership_command_receipts (
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      command_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN (
        'invitation.create',
        'invitation.redeem',
        'invitation.revoke',
        'member.change-role',
        'member.remove'
      )),
      input_sha256 TEXT NOT NULL CHECK(length(input_sha256) = 64),
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, command_id)
    ) STRICT
  `;
});
