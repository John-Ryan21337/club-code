import { assert, it as effectIt } from "@effect/vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scheduler from "effect/Scheduler";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as SqliteClient from "./NodeSqliteClient.ts";

const layer = effectIt.layer(SqliteClient.layerMemory());

layer("NodeSqliteClient", (it) => {
  it.effect("runs prepared queries and returns positional values", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;
      yield* sql`INSERT INTO entries(name) VALUES (${"alpha"}), (${"beta"})`;

      const rows = yield* sql<{ readonly id: number; readonly name: string }>`
        SELECT id, name FROM entries ORDER BY id
      `;
      assert.equal(rows.length, 2);
      assert.equal(rows[0]?.name, "alpha");
      assert.equal(rows[1]?.name, "beta");

      const values = yield* sql`SELECT id, name FROM entries ORDER BY id`.values;
      assert.equal(values.length, 2);
      assert.equal(values[0]?.[1], "alpha");
      assert.equal(values[1]?.[1], "beta");

      const streamed = yield* Stream.runCollect(
        sql<{ readonly name: string }>`SELECT name FROM entries ORDER BY id`.stream,
      );
      assert.deepStrictEqual([...streamed], [{ name: "alpha" }, { name: "beta" }]);
    }),
  );

  it.effect("commits successful transactions and rolls back failures", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE transactions(value TEXT NOT NULL)`;

      yield* sql.withTransaction(sql`INSERT INTO transactions(value) VALUES (${"committed"})`);
      yield* Effect.flip(
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO transactions(value) VALUES (${"rolled-back"})`;
            return yield* Effect.fail("force rollback");
          }),
        ),
      );

      const rows = yield* sql<{ readonly value: string }>`SELECT value FROM transactions`;
      assert.deepStrictEqual(rows, [{ value: "committed" }]);
    }),
  );

  it.effect("supports raw and unprepared statement execution", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE execution_modes(value INTEGER NOT NULL)`;

      const raw = yield* sql`INSERT INTO execution_modes(value) VALUES (${42})`.raw;
      assert.isObject(raw);
      const rows = yield* sql<{ readonly value: number }>`SELECT value FROM execution_modes`
        .unprepared;
      assert.deepStrictEqual(rows, [{ value: 42 }]);
    }),
  );
});

const busyTimeoutLayer = effectIt.layer(SqliteClient.layerMemory({ busyTimeoutMs: 1234 }));

busyTimeoutLayer("NodeSqliteClient busy timeout", (it) => {
  it.effect("configures sqlite to wait for transient writer locks", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly timeout: number }>`PRAGMA busy_timeout`;

      assert.equal(rows[0]?.timeout, 1234);
    }),
  );
});

effectIt.effect("NodeSqliteClient closes file databases and reopens their data", () =>
  Effect.gen(function* () {
    const directory = mkdtempSync(join(tmpdir(), "cafecode-node-sqlite-reopen-"));
    const filename = join(directory, "state.sqlite");
    try {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`CREATE TABLE durable(value TEXT NOT NULL)`;
          yield* sql`INSERT INTO durable(value) VALUES (${"persisted"})`;
        }).pipe(Effect.provide(SqliteClient.layer({ filename }))),
      );

      const rows = yield* Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          return yield* sql<{ readonly value: string }>`SELECT value FROM durable`;
        }).pipe(Effect.provide(SqliteClient.layer({ filename }))),
      );
      assert.deepStrictEqual(rows, [{ value: "persisted" }]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }),
);

effectIt.effect("NodeSqliteClient reports writer lock contention through SqlError", () =>
  Effect.gen(function* () {
    const directory = mkdtempSync(join(tmpdir(), "cafecode-node-sqlite-lock-"));
    const filename = join(directory, "state.sqlite");
    const lockOwner = new DatabaseSync(filename);
    try {
      lockOwner.exec("CREATE TABLE locked(value TEXT NOT NULL); BEGIN IMMEDIATE;");
      const exit = yield* Effect.scoped(
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO locked(value) VALUES (${"blocked"})`;
        }).pipe(Effect.provide(SqliteClient.layer({ filename, busyTimeoutMs: 25 })), Effect.exit),
      );
      assert.equal(exit._tag, "Failure");
    } finally {
      lockOwner.exec("ROLLBACK");
      lockOwner.close();
      rmSync(directory, { recursive: true, force: true });
    }
  }),
);

/**
 * Regression coverage for the provider-ingestion stall of 2026-11-18/19.
 *
 * SQLite work is synchronous, so the only places a fiber running a query can
 * be interrupted are scheduler yields. Effect inserts such a yield at an
 * arbitrary operation boundary once a fiber exhausts its operation budget
 * (`Scheduler.MaxOpsBeforeYield`, 2048 by default). The earlier client had two
 * windows in which such an interrupt left permanent damage, both in primitives
 * from Effect 4.0.0-beta.59:
 *
 * 1. The connection lock was an `effect/Semaphore`. `withPermits` counted the
 *    permit as taken inside an interruptible region and registered the release
 *    only afterwards. An interrupt on a yield between the two kept the single
 *    connection permit taken forever, so every later query and transaction
 *    waited silently.
 * 2. Prepared statements lived in an `effect/Cache`, whose `get` registers a
 *    pending entry *before* the effect that completes it has started. An
 *    interrupt in that window left the entry pending forever (every later use
 *    of that exact SQL text waited, including inside a transaction that held
 *    the connection permit), and an interrupt a few operations later cached
 *    the interruption itself for the statement's whole time-to-live.
 *
 * The client now uses `@cafecode/shared/InterruptSafeSemaphore` and the
 * synchronous `preparedStatementCache`. The tests shrink the budget so that
 * every operation boundary becomes a yield, then interrupt the first caller of
 * a fresh SQL text after each possible number of scheduler turns. No clock is
 * involved: a probe counts scheduler turns instead of using a timeout, so a
 * regression fails fast with the exact interruption points instead of hanging
 * the suite. All three sweeps failed against the earlier client.
 */
const interruptionLayer = effectIt.layer(SqliteClient.layerMemory());

/**
 * Budgets below three cannot make progress: resuming from a forced yield costs
 * two operations, so the fiber would yield again before running real work.
 */
const YIELD_BUDGETS = [3, 4, 5, 7] as const;
/** More scheduler turns than any single statement needs at the budgets above. */
const MAX_INTERRUPT_TURNS = 80;
/** Scheduler turns a healthy statement is allowed before the probe calls it stuck. */
const PROBE_TURNS = 200;

type ProbeResult = "ok" | "stuck" | "failed";

/**
 * Runs `effect` on its own fiber and reports whether it finished within
 * `PROBE_TURNS` scheduler turns. A stuck fiber is interrupted so the test can
 * continue and report every bad interruption point in one run.
 */
const probe = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    for (let turn = 0; turn < PROBE_TURNS; turn++) {
      const exit = fiber.pollUnsafe();
      if (exit !== undefined) {
        return (exit._tag === "Success" ? "ok" : "failed") satisfies ProbeResult;
      }
      yield* Effect.yieldNow;
    }
    yield* Fiber.interrupt(fiber);
    return "stuck" satisfies ProbeResult;
  });

/**
 * Starts `effect` with a tiny operation budget, lets the scheduler run `turns`
 * times, then interrupts it. The effect may already have completed.
 */
const interruptAfterTurns = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  budget: number,
  turns: number,
) =>
  Effect.gen(function* () {
    const victim = yield* effect.pipe(
      Effect.provideService(Scheduler.MaxOpsBeforeYield, budget),
      Effect.forkChild,
    );
    for (let turn = 0; turn < turns; turn++) {
      yield* Effect.yieldNow;
    }
    yield* Fiber.interrupt(victim);
  });

interruptionLayer("NodeSqliteClient interruption safety", (it) => {
  it.effect("keeps a statement usable after its first caller is interrupted at any yield", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const problems: Array<string> = [];

      for (const budget of YIELD_BUDGETS) {
        for (let turns = 0; turns <= MAX_INTERRUPT_TURNS; turns++) {
          // A distinct SQL text per case, so each case starts from a statement
          // the client has never prepared.
          const text = `SELECT ${budget * 1000 + turns} AS value`;
          yield* interruptAfterTurns(sql.unsafe(text), budget, turns);
          const result = yield* probe(sql.unsafe(text));
          if (result !== "ok") {
            problems.push(`rows budget=${budget} turns=${turns}: ${result}`);
          }
        }
      }

      assert.deepStrictEqual(problems, []);
    }),
  );

  it.effect("keeps positional-value statements usable after an interrupted first caller", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const problems: Array<string> = [];

      for (const budget of YIELD_BUDGETS) {
        for (let turns = 0; turns <= MAX_INTERRUPT_TURNS; turns++) {
          const text = `SELECT ${budget * 1000 + turns} AS positional`;
          yield* interruptAfterTurns(sql.unsafe(text).values, budget, turns);
          const rows = yield* probe(sql.unsafe(text).values);
          if (rows !== "ok") {
            problems.push(`values budget=${budget} turns=${turns}: ${rows}`);
            continue;
          }
          // `.values` switches the shared prepared statement to array rows for
          // one call. An interrupted call must not leave that mode set for the
          // next object-row caller.
          const objects = yield* sql.unsafe<{ readonly positional: number }>(text);
          if (objects[0]?.positional !== budget * 1000 + turns) {
            problems.push(`values budget=${budget} turns=${turns}: array mode leaked`);
          }
        }
      }

      assert.deepStrictEqual(problems, []);
    }),
  );

  it.effect("does not strand the connection permit when a transaction is interrupted", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE interrupted_writes(value INTEGER NOT NULL)`;
      const problems: Array<string> = [];

      for (const budget of YIELD_BUDGETS) {
        for (let turns = 0; turns <= MAX_INTERRUPT_TURNS; turns++) {
          const value = budget * 1000 + turns;
          const text = `INSERT INTO interrupted_writes(value) VALUES (${value})`;
          yield* interruptAfterTurns(sql.withTransaction(sql.unsafe(text)), budget, turns);

          // The same statement inside a new transaction is the production
          // shape that wedged: it waited on the abandoned statement while
          // holding the only connection permit, which blocked every other
          // transaction behind it. A probe that reports "failed" here also
          // covers an interrupted transaction that was never rolled back,
          // because the next `BEGIN` would then be rejected.
          const sameStatement = yield* probe(sql.withTransaction(sql.unsafe(text)));
          const otherTransaction = yield* probe(
            sql.withTransaction(sql`SELECT count(*) AS total FROM interrupted_writes`),
          );
          if (sameStatement !== "ok" || otherTransaction !== "ok") {
            problems.push(
              `transaction budget=${budget} turns=${turns}: same=${sameStatement} other=${otherTransaction}`,
            );
          }
        }
      }

      assert.deepStrictEqual(problems, []);
    }),
  );

  it.effect("retries a statement that failed to prepare instead of caching the failure", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const query = sql<{ readonly value: number }>`SELECT value FROM created_later`;

      // The table does not exist yet, so preparing the statement fails. The
      // failure must be a typed `SqlError` and must not be remembered: a
      // migration that creates the table later has to make the very same SQL
      // text work.
      const missing = yield* Effect.flip(query);
      assert.equal(missing._tag, "SqlError");

      yield* sql`CREATE TABLE created_later(value INTEGER NOT NULL)`;
      yield* sql`INSERT INTO created_later(value) VALUES (${7})`;

      assert.deepStrictEqual(yield* query, [{ value: 7 }]);
    }),
  );

  it.effect("reports an unprepared statement that cannot be prepared as a typed error", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // The failure must arrive through the error channel when the effect
      // runs. Building the query must not throw.
      const query = sql`SELECT value FROM never_created`.unprepared;
      const error = yield* Effect.flip(query);

      assert.equal(error._tag, "SqlError");
    }),
  );
});
