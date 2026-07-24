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

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(provider_pacing_pending_launches)
      `;
      assert.deepStrictEqual(
        columns.slice(-3).map(({ name }) => name),
        ["environment_id", "provider_account_id", "launch_state"],
      );

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
