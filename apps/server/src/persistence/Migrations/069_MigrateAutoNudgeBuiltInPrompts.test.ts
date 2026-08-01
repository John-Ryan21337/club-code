import { AUTO_NUDGE_BUILT_IN_PROMPTS, ThreadAutoNudgeConfig } from "@cafecode/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as TestSqliteClient from "../TestSqliteClient.ts";

const decodeConfig = Schema.decodeUnknownEffect(ThreadAutoNudgeConfig);

const configJson = (mode: "hardcore-fanout" | "steady-progress", prompt: string) =>
  JSON.stringify({
    authorityRevision: 1,
    mode,
    prompt,
    backgroundContinuation: false,
    maxRounds: 5,
    armedAt: "2026-07-30T00:00:00.000Z",
    baselineSettledTurnId: null,
    lastDispatchedSettledTurnId: null,
    roundsDispatched: 0,
    lastDispatchedAt: null,
  });

describe("069_MigrateAutoNudgeBuiltInPrompts", () => {
  it.effect("upgrades every recognized default and preserves custom thread text", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 68 });

      for (const [threadId, prompt] of [
        ["thread-hardcore", "Fan out and keep going"],
        ["thread-steady", "Keep a few lanes going, make steady progress"],
        ["thread-custom", "Keep my carefully customized workflow"],
      ] as const) {
        yield* sql`
          INSERT INTO projection_threads (
            thread_id,
            project_id,
            title,
            branch,
            worktree_path,
            latest_turn_id,
            created_at,
            updated_at,
            auto_nudge_json
          )
          VALUES (
            ${threadId},
            'project-1',
            ${threadId},
            NULL,
            NULL,
            NULL,
            '2026-07-30T00:00:00.000Z',
            '2026-07-30T00:00:00.000Z',
            ${configJson(threadId === "thread-hardcore" ? "hardcore-fanout" : "steady-progress", prompt)}
          )
        `;
      }

      const executed = yield* runMigrations({ toMigrationInclusive: 69 });
      assert.deepStrictEqual(executed, [[69, "MigrateAutoNudgeBuiltInPrompts"]]);

      const rows = yield* sql<{ readonly threadId: string; readonly config: string }>`
        SELECT thread_id AS "threadId", auto_nudge_json AS "config"
        FROM projection_threads
        WHERE thread_id LIKE 'thread-%'
        ORDER BY thread_id
      `;
      const decoded = yield* Effect.forEach(rows, (row) =>
        decodeConfig(JSON.parse(row.config)).pipe(
          Effect.map((config) => [row.threadId, config.prompt] as const),
        ),
      );
      assert.deepStrictEqual(Object.fromEntries(decoded), {
        "thread-custom": "Keep my carefully customized workflow",
        "thread-hardcore": AUTO_NUDGE_BUILT_IN_PROMPTS["hardcore-fanout"],
        "thread-steady": AUTO_NUDGE_BUILT_IN_PROMPTS["steady-progress"],
      });
    }).pipe(Effect.provide(TestSqliteClient.layerMemory())),
  );
});
