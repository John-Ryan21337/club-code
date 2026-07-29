import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as TestSqliteClient from "../TestSqliteClient.ts";
import Migration0064 from "./064_ProviderPacingPendingLaunchCompatibility.ts";

const layer = it.layer(Layer.mergeAll(TestSqliteClient.layerMemory()));

layer("064_ProviderPacingPendingLaunchCompatibility", (it) => {
  it.effect("idempotently completes a partially repaired legacy pacing table", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        CREATE TABLE provider_pacing_pending_launches (
          thread_id TEXT PRIMARY KEY,
          source_event_id TEXT NOT NULL UNIQUE,
          source_sequence INTEGER NOT NULL UNIQUE,
          provider_instance_id TEXT NOT NULL,
          dispatch_source TEXT NOT NULL,
          requested_at TEXT NOT NULL,
          environment_id TEXT NOT NULL DEFAULT 'legacy-unverified',
          CHECK (typeof(source_sequence) = 'integer' AND source_sequence >= 0),
          CHECK (dispatch_source = 'user')
        ) WITHOUT ROWID
      `;
      yield* sql`
        INSERT INTO provider_pacing_pending_launches (
          thread_id,
          source_event_id,
          source_sequence,
          provider_instance_id,
          dispatch_source,
          requested_at,
          environment_id
        ) VALUES (
          'legacy-thread',
          'legacy-event',
          62,
          'claude-primary',
          'user',
          '2026-07-28T00:00:00.000Z',
          'environment-a'
        )
      `;

      yield* Migration0064;
      yield* Migration0064;

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('projection_thread_goals', 'provider_pacing_pending_launches')
        ORDER BY name
      `;
      assert.deepStrictEqual(tables, [
        { name: "projection_thread_goals" },
        { name: "provider_pacing_pending_launches" },
      ]);

      const columns = yield* sql<{
        readonly name: string;
        readonly dflt_value: string | null;
      }>`PRAGMA table_info(provider_pacing_pending_launches)`;
      assert.deepStrictEqual(
        columns.slice(-3).map(({ name, dflt_value: defaultValue }) => ({
          name,
          defaultValue,
        })),
        [
          { name: "environment_id", defaultValue: "'legacy-unverified'" },
          { name: "provider_account_id", defaultValue: "'legacy-unverified'" },
          { name: "launch_state", defaultValue: "'waiting'" },
        ],
      );

      const rows = yield* sql<{
        readonly environmentId: string;
        readonly providerAccountId: string;
        readonly launchState: string;
      }>`
        SELECT
          environment_id AS "environmentId",
          provider_account_id AS "providerAccountId",
          launch_state AS "launchState"
        FROM provider_pacing_pending_launches
        WHERE thread_id = 'legacy-thread'
      `;
      assert.deepStrictEqual(rows, [
        {
          environmentId: "environment-a",
          providerAccountId: "legacy-unverified",
          launchState: "waiting",
        },
      ]);

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND name LIKE 'idx_provider_pacing_pending_launches_%'
        ORDER BY name
      `;
      assert.deepStrictEqual(indexes, [
        { name: "idx_provider_pacing_pending_launches_requested_at" },
        { name: "idx_provider_pacing_pending_launches_state" },
      ]);
    }),
  );
});
