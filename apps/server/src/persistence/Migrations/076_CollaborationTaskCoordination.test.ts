import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";
import * as TestSqliteClient from "../TestSqliteClient.ts";

describe("076_CollaborationTaskCoordination", () => {
  it.effect("installs once with the bounded task authority tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 75 });
      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 76 }), [
        [76, "CollaborationTaskCoordination"],
      ]);
      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 76 }), []);
      const rows = yield* sql<{
        name: string;
      }>`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'collaboration_task_%' ORDER BY name`;
      assert.deepStrictEqual(
        rows.map((row) => row.name),
        [
          "collaboration_task_audit_events",
          "collaboration_task_dependencies",
          "collaboration_task_write_locks",
          "collaboration_tasks",
        ],
      );
      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type='index' AND name LIKE 'idx_collaboration_task_%'
        ORDER BY name
      `;
      assert.deepStrictEqual(
        indexes.map((row) => row.name),
        [
          "idx_collaboration_task_active_lease_ids",
          "idx_collaboration_task_active_leases",
          "idx_collaboration_task_audit_history",
          "idx_collaboration_task_dependents",
        ],
      );
      const lockForeignKeys = yield* sql<{ readonly table: string }>`
        PRAGMA foreign_key_list(collaboration_task_write_locks)
      `;
      assert.deepStrictEqual(
        lockForeignKeys.map((row) => row.table),
        ["collaboration_projects"],
      );
      yield* sql`INSERT INTO collaboration_projects(shared_project_id,membership_epoch,updated_at) VALUES('project-migration-task',1,'2026-08-01T12:00:00.000Z')`;
      const invalidClaimedTask = yield* sql`
        INSERT INTO collaboration_tasks(
          shared_project_id,task_id,provenance,title,body,status,owner_user_id,
          dependencies_json,revision,fencing_token,created_by_user_id,created_at,updated_at,record_sha256
        ) VALUES(
          'project-migration-task','invalid-task','operator-authored','Title','Body','claimed',NULL,
          '[]',1,0,'user-1','2026-08-01T12:00:00.000Z','2026-08-01T12:00:00.000Z',${"0".repeat(64)}
        )
      `.pipe(Effect.flip);
      assert.isDefined(invalidClaimedTask);
      yield* sql`INSERT INTO collaboration_project_members(
        shared_project_id,user_id,display_name,role,permissions_json,joined_at
      ) VALUES(
        'project-migration-task','former-owner','Former owner','operator','["task.read","task.manage"]','2026-08-01T12:00:00.000Z'
      )`;
      yield* sql`
        INSERT INTO collaboration_tasks(
          shared_project_id,task_id,provenance,title,body,status,owner_user_id,
          dependencies_json,revision,fencing_token,created_by_user_id,created_at,updated_at,record_sha256
        ) VALUES(
          'project-migration-task','retained-task','operator-authored','Title','Body','claimed','former-owner',
          '[]',1,0,'former-owner','2026-08-01T12:00:00.000Z','2026-08-01T12:00:00.000Z',${"0".repeat(64)}
        )
      `;
      // Task ownership is historical state, not a foreign-key authority edge:
      // revocation must never be blocked by an owned task.
      yield* sql`DELETE FROM collaboration_project_members WHERE shared_project_id='project-migration-task' AND user_id='former-owner'`;
      const retained = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM collaboration_tasks
        WHERE shared_project_id='project-migration-task' AND task_id='retained-task'
      `;
      assert.equal(retained[0]?.count, 1);
      const invalidFence = yield* sql`
        INSERT INTO collaboration_tasks(
          shared_project_id,task_id,provenance,title,body,status,owner_user_id,
          dependencies_json,revision,fencing_token,created_by_user_id,created_at,updated_at,record_sha256
        ) VALUES(
          'project-migration-task','invalid-fence','operator-authored','Title','Body','open',NULL,
          '[]',2,0,'user-1','2026-08-01T12:00:00.000Z','2026-08-01T12:00:00.000Z',${"0".repeat(64)}
        )
      `.pipe(Effect.flip);
      assert.isDefined(invalidFence);
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );
});
