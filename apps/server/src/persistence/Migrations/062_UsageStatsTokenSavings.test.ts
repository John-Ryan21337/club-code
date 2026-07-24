import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as TestSqliteClient from "../TestSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(TestSqliteClient.layerMemory()));

layer("062_UsageStatsTokenSavings", (it) => {
  it.effect("adds bounded cache and observed-compaction counters", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 62 });
      const columns = yield* sql<{
        readonly name: string;
        readonly notnull: number;
        readonly dflt_value: string | null;
      }>`PRAGMA table_info(usage_stats_token_breakdown_days)`;

      assert.deepEqual(
        columns
          .filter((column) =>
            ["cached_input_tokens", "cache_write_input_tokens", "compacted_input_tokens"].includes(
              column.name,
            ),
          )
          .map((column) => ({
            name: column.name,
            notnull: column.notnull,
            defaultValue: column.dflt_value,
          })),
        [
          { name: "cached_input_tokens", notnull: 1, defaultValue: "0" },
          { name: "cache_write_input_tokens", notnull: 1, defaultValue: "0" },
          { name: "compacted_input_tokens", notnull: 1, defaultValue: "0" },
        ],
      );
    }),
  );
});
