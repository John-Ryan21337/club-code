import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Durable task/agent authority. Transport, provider dispatch and UI are intentionally out of scope. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_task_write_locks (
      shared_project_id TEXT PRIMARY KEY REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE
    ) STRICT
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_tasks (
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id)
        ON DELETE CASCADE,
      task_id TEXT NOT NULL,
      provenance TEXT NOT NULL CHECK(provenance = 'operator-authored'),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open','claimed','completed','cancelled')),
      owner_user_id TEXT,
      dependencies_json TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK(revision > 0 AND revision <= 9007199254740991),
      fencing_token INTEGER NOT NULL CHECK(fencing_token >= 0 AND fencing_token <= 9007199254740991),
      active_lease_id TEXT,
      active_agent_id TEXT,
      active_holder_user_id TEXT,
      active_holder_device_id TEXT,
      active_membership_epoch INTEGER,
      active_lease_fencing_token INTEGER,
      active_lease_granted_at TEXT,
      active_lease_expires_at TEXT,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      record_sha256 TEXT NOT NULL CHECK(length(record_sha256) = 64 AND record_sha256 NOT GLOB '*[^0-9a-f]*'),
      PRIMARY KEY(shared_project_id, task_id),
      CHECK(length(CAST(title AS BLOB)) BETWEEN 1 AND 512),
      CHECK(length(CAST(body AS BLOB)) BETWEEN 1 AND 32768),
      CHECK(length(CAST(dependencies_json AS BLOB)) <= 8192),
      CHECK(length(created_at) = 24 AND length(updated_at) = 24),
      CHECK(fencing_token = revision - 1),
      CHECK(status <> 'open' OR owner_user_id IS NULL),
      CHECK(status NOT IN ('claimed','completed') OR owner_user_id IS NOT NULL),
      CHECK((active_lease_id IS NULL) = (active_agent_id IS NULL)),
      CHECK((active_lease_id IS NULL) = (active_holder_user_id IS NULL)),
      CHECK((active_lease_id IS NULL) = (active_holder_device_id IS NULL)),
      CHECK((active_lease_id IS NULL) = (active_membership_epoch IS NULL)),
      CHECK((active_lease_id IS NULL) = (active_lease_fencing_token IS NULL)),
      CHECK((active_lease_id IS NULL) = (active_lease_granted_at IS NULL)),
      CHECK((active_lease_id IS NULL) = (active_lease_expires_at IS NULL)),
      CHECK(active_membership_epoch IS NULL OR (
        active_membership_epoch >= 0 AND active_membership_epoch <= 2147483647
      )),
      CHECK(active_lease_id IS NULL OR status = 'claimed'),
      CHECK(active_lease_id IS NULL OR owner_user_id = active_holder_user_id),
      CHECK(active_lease_id IS NULL OR active_lease_fencing_token = fencing_token),
      CHECK(active_lease_id IS NULL OR (
        length(active_lease_granted_at) = 24 AND length(active_lease_expires_at) = 24
        AND active_lease_expires_at > active_lease_granted_at
      ))
    ) STRICT
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_task_dependencies (
      shared_project_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      depends_on_task_id TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, task_id, depends_on_task_id),
      FOREIGN KEY(shared_project_id, task_id)
        REFERENCES collaboration_tasks(shared_project_id, task_id) ON DELETE CASCADE,
      FOREIGN KEY(shared_project_id, depends_on_task_id)
        REFERENCES collaboration_tasks(shared_project_id, task_id) ON DELETE RESTRICT,
      CHECK(task_id <> depends_on_task_id)
    ) STRICT
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS collaboration_task_audit_events (
      shared_project_id TEXT NOT NULL REFERENCES collaboration_projects(shared_project_id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK(sequence > 0 AND sequence <= 9007199254740991),
      command_id TEXT NOT NULL,
      input_sha256 TEXT NOT NULL CHECK(length(input_sha256) = 64 AND input_sha256 NOT GLOB '*[^0-9a-f]*'),
      operation TEXT NOT NULL CHECK(operation IN (
        'create','claim','reassign','complete','cancel','reopen','set-dependencies',
        'agent.acquire','agent.renew','agent.release'
      )),
      task_id TEXT NOT NULL,
      task_json TEXT NOT NULL,
      actor_user_id TEXT NOT NULL,
      actor_device_id TEXT NOT NULL,
      membership_epoch INTEGER NOT NULL CHECK(membership_epoch >= 0 AND membership_epoch <= 2147483647),
      previous_event_sha256 TEXT,
      event_sha256 TEXT NOT NULL CHECK(length(event_sha256) = 64 AND event_sha256 NOT GLOB '*[^0-9a-f]*'),
      created_at TEXT NOT NULL,
      PRIMARY KEY(shared_project_id, sequence),
      UNIQUE(shared_project_id, command_id),
      CHECK(length(CAST(task_json AS BLOB)) <= 65536),
      CHECK(previous_event_sha256 IS NULL OR (
        length(previous_event_sha256) = 64 AND previous_event_sha256 NOT GLOB '*[^0-9a-f]*'
      )),
      CHECK((sequence = 1) = (previous_event_sha256 IS NULL)),
      CHECK(length(created_at) = 24),
      FOREIGN KEY(shared_project_id, task_id)
        REFERENCES collaboration_tasks(shared_project_id, task_id) ON DELETE RESTRICT
    ) STRICT
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_collaboration_task_audit_history
    ON collaboration_task_audit_events(shared_project_id, task_id, sequence)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_collaboration_task_active_leases
    ON collaboration_tasks(shared_project_id, active_lease_expires_at)
    WHERE active_lease_id IS NOT NULL
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_collaboration_task_active_lease_ids
    ON collaboration_tasks(shared_project_id, active_lease_id)
    WHERE active_lease_id IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_collaboration_task_dependents
    ON collaboration_task_dependencies(shared_project_id, depends_on_task_id, task_id)
  `;
});
