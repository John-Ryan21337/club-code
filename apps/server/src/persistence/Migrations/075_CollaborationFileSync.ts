import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_file_write_locks (
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, relative_path)
    ) STRICT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_file_contents (
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      content_sha256 TEXT NOT NULL CHECK(
        length(content_sha256) = 64 AND content_sha256 = lower(content_sha256) AND
        content_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      byte_size INTEGER NOT NULL CHECK(
        byte_size >= 0 AND byte_size <= 1099511627776
      ),
      chunk_manifest_json TEXT NOT NULL CHECK(json_valid(chunk_manifest_json)),
      chunk_manifest_sha256 TEXT NOT NULL CHECK(
        length(chunk_manifest_sha256) = 64 AND chunk_manifest_sha256 = lower(chunk_manifest_sha256)
        AND chunk_manifest_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      created_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, content_sha256)
    ) STRICT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_file_chunks (
      shared_project_id TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      chunk_index INTEGER NOT NULL CHECK(chunk_index >= 0),
      chunk_offset INTEGER NOT NULL CHECK(chunk_offset >= 0),
      byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= 67108864),
      chunk_sha256 TEXT NOT NULL CHECK(
        length(chunk_sha256) = 64 AND chunk_sha256 = lower(chunk_sha256) AND
        chunk_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      PRIMARY KEY(shared_project_id, content_sha256, chunk_index),
      FOREIGN KEY(shared_project_id, content_sha256)
        REFERENCES collaboration_file_contents(shared_project_id, content_sha256)
        ON DELETE RESTRICT
    ) STRICT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_file_versions (
      version_id TEXT PRIMARY KEY CHECK(
        length(version_id) = 64 AND version_id = lower(version_id) AND
        version_id NOT GLOB '*[^0-9a-f]*'
      ),
      shared_project_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      content_sha256 TEXT NOT NULL,
      content_kind TEXT NOT NULL CHECK(content_kind IN ('regular-file', 'database')),
      content_kind_json TEXT NOT NULL CHECK(json_valid(content_kind_json)),
      created_by_user_id TEXT NOT NULL,
      created_by_device_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(shared_project_id, content_sha256)
        REFERENCES collaboration_file_contents(shared_project_id, content_sha256)
        ON DELETE RESTRICT,
      FOREIGN KEY(shared_project_id, created_by_device_id)
        REFERENCES collaboration_project_devices(shared_project_id, device_id)
        ON DELETE RESTRICT
    ) STRICT
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_collaboration_file_versions_path
    ON collaboration_file_versions(shared_project_id, relative_path, created_at, version_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_file_tombstones (
      tombstone_id TEXT PRIMARY KEY CHECK(
        length(tombstone_id) = 64 AND tombstone_id = lower(tombstone_id) AND
        tombstone_id NOT GLOB '*[^0-9a-f]*'
      ),
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      previous_head_revision_id TEXT CHECK(
        previous_head_revision_id IS NULL OR (
          length(previous_head_revision_id) = 64 AND
          previous_head_revision_id = lower(previous_head_revision_id) AND
          previous_head_revision_id NOT GLOB '*[^0-9a-f]*'
        )
      ),
      created_by_user_id TEXT NOT NULL,
      created_by_device_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(shared_project_id, created_by_device_id)
        REFERENCES collaboration_project_devices(shared_project_id, device_id)
        ON DELETE RESTRICT
    ) STRICT
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_collaboration_file_tombstones_path
    ON collaboration_file_tombstones(shared_project_id, relative_path, created_at, tombstone_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_file_heads (
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      revision_id TEXT NOT NULL CHECK(
        length(revision_id) = 64 AND revision_id = lower(revision_id) AND
        revision_id NOT GLOB '*[^0-9a-f]*'
      ),
      revision_kind TEXT NOT NULL CHECK(revision_kind IN ('version', 'tombstone')),
      version_id TEXT REFERENCES collaboration_file_versions(version_id) ON DELETE RESTRICT,
      tombstone_id TEXT REFERENCES collaboration_file_tombstones(tombstone_id) ON DELETE RESTRICT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, relative_path),
      CHECK(
        (revision_kind = 'version' AND version_id = revision_id AND tombstone_id IS NULL) OR
        (revision_kind = 'tombstone' AND tombstone_id = revision_id AND version_id IS NULL)
      )
    ) STRICT
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_file_conflicts (
      conflict_id TEXT PRIMARY KEY CHECK(
        length(conflict_id) = 64 AND conflict_id = lower(conflict_id) AND
        conflict_id NOT GLOB '*[^0-9a-f]*'
      ),
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      relative_path TEXT NOT NULL,
      expected_head_revision_id TEXT,
      observed_head_revision_id TEXT,
      proposed_revision_id TEXT NOT NULL,
      proposed_revision_kind TEXT NOT NULL CHECK(
        proposed_revision_kind IN ('version', 'tombstone')
      ),
      created_at TEXT NOT NULL
    ) STRICT
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_collaboration_file_conflicts_path
    ON collaboration_file_conflicts(shared_project_id, relative_path, created_at, conflict_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_file_command_receipts (
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      command_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK(operation IN ('publish', 'tombstone')),
      request_sha256 TEXT NOT NULL CHECK(
        length(request_sha256) = 64 AND request_sha256 = lower(request_sha256) AND
        request_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      actor_user_id TEXT NOT NULL,
      actor_device_id TEXT NOT NULL,
      actor_membership_epoch INTEGER NOT NULL CHECK(
        actor_membership_epoch >= 0 AND actor_membership_epoch <= 2147483647
      ),
      response_json TEXT NOT NULL CHECK(json_valid(response_json)),
      response_sha256 TEXT NOT NULL CHECK(
        length(response_sha256) = 64 AND response_sha256 = lower(response_sha256) AND
        response_sha256 NOT GLOB '*[^0-9a-f]*'
      ),
      created_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, command_id)
    ) STRICT
  `;
});
