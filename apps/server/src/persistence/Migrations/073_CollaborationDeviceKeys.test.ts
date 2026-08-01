import { assert, describe, it } from "@effect/vitest";
import { Buffer } from "node:buffer";

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as TestSqliteClient from "../TestSqliteClient.ts";

describe("073_CollaborationDeviceKeys", () => {
  it.effect("migrates once, replays idempotently, and installs key authority constraints", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 72 });
      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 73 }), [
        [73, "CollaborationDeviceKeys"],
      ]);
      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 73 }), []);

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'collaboration_device_%'
        ORDER BY name
      `;
      assert.deepStrictEqual(tables, [
        { name: "collaboration_device_command_receipts" },
        { name: "collaboration_device_enrollment_challenges" },
        { name: "collaboration_device_keys" },
      ]);
      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_collaboration_device_keys_one_active'
      `;
      assert.deepStrictEqual(indexes, [{ name: "idx_collaboration_device_keys_one_active" }]);

      yield* sql`
        INSERT INTO collaboration_projects(shared_project_id, membership_epoch, updated_at)
        VALUES ('project-migration-73', 1, '2026-08-01T12:00:00.000Z')
      `;
      yield* sql`
        INSERT INTO collaboration_project_devices(
          shared_project_id, device_id, user_id, first_enrolled_at
        ) VALUES (
          'project-migration-73', 'device-1', 'user-1', '2026-08-01T12:00:00.000Z'
        )
      `;
      yield* sql`
        INSERT INTO collaboration_device_keys(
          device_key_id, shared_project_id, device_id, user_id,
          public_key_spki_der, membership_epoch, activated_at
        ) VALUES (
          'key-1', 'project-migration-73', 'device-1', 'user-1',
          ${Buffer.alloc(44)}, 1, '2026-08-01T12:00:00.000Z'
        )
      `;
      yield* Effect.flip(sql`
        INSERT INTO collaboration_device_keys(
          device_key_id, shared_project_id, device_id, user_id,
          public_key_spki_der, membership_epoch, activated_at
        ) VALUES (
          'key-2', 'project-migration-73', 'device-1', 'user-1',
          ${Buffer.alloc(44)}, 1, '2026-08-01T12:00:01.000Z'
        )
      `);
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );
});
