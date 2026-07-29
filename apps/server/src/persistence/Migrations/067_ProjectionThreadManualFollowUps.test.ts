import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as TestSqliteClient from "../TestSqliteClient.ts";
import { DEFAULT_THREAD_MANUAL_FOLLOW_UPS_JSON } from "./067_ProjectionThreadManualFollowUps.ts";

describe("067_ProjectionThreadManualFollowUps", () => {
  it.effect("adds an empty durable queue to existing threads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 66 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at
        )
        VALUES (
          'thread-existing',
          'project-existing',
          'Existing thread',
          NULL,
          NULL,
          NULL,
          '2026-07-28T00:00:00.000Z',
          '2026-07-28T00:00:00.000Z'
        )
      `;

      const executed = yield* runMigrations({ toMigrationInclusive: 67 });
      assert.deepStrictEqual(executed, [[67, "ProjectionThreadManualFollowUps"]]);

      const rows = yield* sql<{ readonly manualFollowUps: string }>`
        SELECT manual_follow_ups_json AS "manualFollowUps"
        FROM projection_threads
        WHERE thread_id = 'thread-existing'
      `;
      assert.equal(rows[0]?.manualFollowUps, DEFAULT_THREAD_MANUAL_FOLLOW_UPS_JSON);

      const columns = yield* sql<{
        readonly cid: number;
        readonly name: string;
        readonly type: string;
        readonly notnull: number;
        readonly dflt_value: string | null;
        readonly pk: number;
      }>`PRAGMA table_info(projection_threads)`;
      const column = columns.find((entry) => entry.name === "manual_follow_ups_json");
      assert.isDefined(column);
      assert.deepEqual(column, {
        cid: column.cid,
        name: "manual_follow_ups_json",
        type: column.type,
        notnull: 1,
        dflt_value: "'[]'",
        pk: column.pk,
      });
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );
});
