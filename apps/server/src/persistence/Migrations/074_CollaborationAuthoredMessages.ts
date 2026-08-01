import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Migration 073 owns collaboration device identity/key lifecycle. This
 * authored-message projection deliberately stacks after that authority.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_authored_message_write_locks (
      shared_project_id TEXT PRIMARY KEY
    ) STRICT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_authored_messages (
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      project_sequence INTEGER NOT NULL CHECK(
        project_sequence > 0 AND project_sequence <= 9007199254740991
      ),
      operator_sequence INTEGER NOT NULL CHECK(
        operator_sequence > 0 AND operator_sequence <= 9007199254740991
      ),
      message_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      input_sha256 TEXT NOT NULL CHECK(
        length(input_sha256) = 64 AND input_sha256 = lower(input_sha256) AND
        input_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      kind TEXT NOT NULL CHECK(kind IN ('operator-chat', 'authored-prompt')),
      body TEXT NOT NULL,
      body_sha256 TEXT NOT NULL CHECK(
        length(body_sha256) = 64 AND body_sha256 = lower(body_sha256) AND
        body_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      context_inclusion TEXT NOT NULL CHECK(
        context_inclusion IN ('eligible', 'excluded-sensitive')
      ),
      author_user_id TEXT NOT NULL,
      author_device_id TEXT NOT NULL,
      membership_epoch INTEGER NOT NULL CHECK(
        membership_epoch >= 0 AND membership_epoch <= 2147483647
      ),
      previous_message_sha256 TEXT CHECK(
        previous_message_sha256 IS NULL OR (
          length(previous_message_sha256) = 64 AND
          previous_message_sha256 = lower(previous_message_sha256) AND
          previous_message_sha256 NOT GLOB '*[^0-9a-f]*'
        )
      ),
      message_sha256 TEXT NOT NULL CHECK(
        length(message_sha256) = 64 AND message_sha256 = lower(message_sha256) AND
        message_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      occurred_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, project_sequence),
      UNIQUE(shared_project_id, message_id),
      UNIQUE(shared_project_id, command_id),
      UNIQUE(shared_project_id, author_user_id, operator_sequence)
    ) STRICT
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_collaboration_authored_messages_page
    ON collaboration_authored_messages(shared_project_id, project_sequence)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_authored_message_tombstones (
      shared_project_id TEXT NOT NULL,
      target_message_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      input_sha256 TEXT NOT NULL CHECK(
        length(input_sha256) = 64 AND input_sha256 = lower(input_sha256) AND
        input_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      actor_user_id TEXT NOT NULL,
      actor_device_id TEXT NOT NULL,
      membership_epoch INTEGER NOT NULL CHECK(
        membership_epoch >= 0 AND membership_epoch <= 2147483647
      ),
      reason TEXT NOT NULL,
      tombstone_sha256 TEXT NOT NULL CHECK(
        length(tombstone_sha256) = 64 AND tombstone_sha256 = lower(tombstone_sha256) AND
        tombstone_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      created_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, target_message_id),
      UNIQUE(shared_project_id, command_id),
      FOREIGN KEY(shared_project_id, target_message_id)
        REFERENCES collaboration_authored_messages(shared_project_id, message_id)
        ON DELETE RESTRICT
    ) STRICT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_context_packets (
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      packet_id TEXT NOT NULL,
      command_id TEXT NOT NULL,
      input_sha256 TEXT NOT NULL CHECK(
        length(input_sha256) = 64 AND input_sha256 = lower(input_sha256) AND
        input_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      base_packet_id TEXT,
      sources_json TEXT NOT NULL,
      excluded_sources_json TEXT NOT NULL,
      token_budget INTEGER NOT NULL CHECK(token_budget > 0),
      estimated_tokens INTEGER NOT NULL CHECK(estimated_tokens >= 0),
      encoded_bytes INTEGER NOT NULL CHECK(encoded_bytes >= 0),
      through_sequence INTEGER NOT NULL CHECK(
        through_sequence >= 0 AND through_sequence <= 9007199254740991
      ),
      packet_sha256 TEXT NOT NULL CHECK(
        length(packet_sha256) = 64 AND packet_sha256 = lower(packet_sha256) AND
        packet_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      created_by_user_id TEXT NOT NULL,
      created_by_device_id TEXT NOT NULL,
      membership_epoch INTEGER NOT NULL CHECK(
        membership_epoch >= 0 AND membership_epoch <= 2147483647
      ),
      created_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, packet_id),
      UNIQUE(shared_project_id, command_id),
      FOREIGN KEY(shared_project_id, base_packet_id)
        REFERENCES collaboration_context_packets(shared_project_id, packet_id)
        ON DELETE RESTRICT
    ) STRICT
  `;
});
