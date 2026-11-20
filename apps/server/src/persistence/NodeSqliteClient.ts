/**
 * Port of `@effect/sql-sqlite-node` that uses the native `node:sqlite`
 * bindings instead of `better-sqlite3`.
 *
 * @module SqliteClient
 */
import { backup as backupDatabase, DatabaseSync, type StatementSync } from "node:sqlite";

import * as Semaphore from "@cafecode/shared/InterruptSafeSemaphore";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Context from "effect/Context";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { SqlError, classifySqliteError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

import { makePreparedStatementCache } from "./preparedStatementCache.ts";

const ATTR_DB_SYSTEM_NAME = "db.system.name";

export const TypeId: TypeId = "~local/sqlite-node/SqliteClient";

export type TypeId = "~local/sqlite-node/SqliteClient";

/**
 * SqliteClient - Effect service tag for the sqlite SQL client.
 */
export const SqliteClient = Context.Service<Client.SqlClient>(
  "cafecode/persistence/NodeSqliteClient",
);

export interface SqliteBackupService {
  readonly backupTo: (path: string) => Effect.Effect<number, SqlError>;
}

export class SqliteBackup extends Context.Service<SqliteBackup, SqliteBackupService>()(
  "cafecode/persistence/NodeSqliteBackup",
) {}

export interface SqliteClientConfig {
  readonly filename: string;
  readonly readonly?: boolean | undefined;
  readonly allowExtension?: boolean | undefined;
  readonly busyTimeoutMs?: number | undefined;
  readonly prepareCacheSize?: number | undefined;
  readonly prepareCacheTTL?: Duration.Input | undefined;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
}

export interface SqliteMemoryClientConfig extends Omit<
  SqliteClientConfig,
  "filename" | "readonly"
> {}

/**
 * Verify that the current Node.js version includes the `node:sqlite` APIs
 * used by `NodeSqliteClient` — specifically `StatementSync.columns()` (added
 * in Node 22.16.0 / 23.11.0).
 *
 * @see https://github.com/nodejs/node/pull/57490
 */
const checkNodeSqliteCompat = () => {
  const parts = process.versions.node.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const supported = (major === 22 && minor >= 16) || (major === 23 && minor >= 11) || major >= 24;

  if (!supported) {
    return Effect.die(
      `Node.js ${process.versions.node} is missing required node:sqlite APIs ` +
        `(StatementSync.columns). Upgrade to Node.js >=22.16, >=23.11, or >=24.`,
    );
  }
  return Effect.void;
};

function normalizeBusyTimeoutMs(value: number | undefined): number {
  if (value === undefined) {
    return 0;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(60_000, Math.trunc(value));
}

const makeWithDatabase = Effect.fn("makeWithDatabase")(function* (
  options: SqliteClientConfig,
  openDatabase: () => DatabaseSync,
): Effect.fn.Return<
  { readonly client: Client.SqlClient; readonly backup: SqliteBackupService },
  never,
  Scope.Scope | Reactivity.Reactivity
> {
  yield* checkNodeSqliteCompat();

  const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
  const transformRows = options.transformResultNames
    ? Statement.defaultTransforms(options.transformResultNames).array
    : undefined;

  const makeConnection = Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const db = openDatabase();
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => db.close()),
    );
    const busyTimeoutMs = normalizeBusyTimeoutMs(options.busyTimeoutMs);
    if (busyTimeoutMs > 0) {
      db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
    }

    const statementReaderCache = new WeakMap<StatementSync, boolean>();
    const hasRows = (statement: StatementSync): boolean => {
      const cached = statementReaderCache.get(statement);
      if (cached !== undefined) {
        return cached;
      }
      const value = statement.columns().length > 0;
      statementReaderCache.set(statement, value);
      return value;
    };

    const prepareError = (cause: unknown) =>
      new SqlError({
        reason: classifySqliteError(cause, {
          message: "Failed to prepare statement",
          operation: "prepare",
        }),
      });
    const executeError = (cause: unknown) =>
      new SqlError({
        reason: classifySqliteError(cause, {
          message: "Failed to execute statement",
          operation: "execute",
        }),
      });

    // Prepared statements are cached in a plain synchronous map instead of
    // `effect/Cache`. `Cache.get` in Effect 4.0.0-beta.59 stores an in-flight
    // entry and then runs the lookup as a later fiber step; a fiber that is
    // interrupted at a scheduler yield between the two leaves that entry
    // unfinished (every later use of the same SQL text waits forever) or
    // caches the interruption as the result. Either outcome silently stops
    // that query for the rest of the process. See `preparedStatementCache.ts`.
    const statements = makePreparedStatementCache<StatementSync>({
      capacity: options.prepareCacheSize ?? 200,
      timeToLiveMs: Duration.toMillis(
        Duration.fromInputUnsafe(options.prepareCacheTTL ?? Duration.minutes(10)),
      ),
      prepare: (sql) => db.prepare(sql),
    });

    /**
     * Looks up or prepares a statement. Returns the classified error instead
     * of throwing so the caller can keep "prepare failed" and "execute
     * failed" apart.
     *
     * This is a synchronous function, not an Effect, on purpose. Callers run
     * it and the statement execution inside one `Effect.withFiber` body,
     * which is a single fiber operation. The scheduler can only yield, and
     * an interrupt can only be delivered, between fiber operations, so no
     * interrupt can land between "statement obtained" and "statement
     * executed and its row mode restored".
     */
    const statementFor = (
      sql: string,
      nowMs: number,
      cached: boolean,
    ): StatementSync | SqlError => {
      try {
        return cached ? statements.getOrPrepare(sql, nowMs) : db.prepare(sql);
      } catch (cause) {
        return prepareError(cause);
      }
    };

    const run = (sql: string, params: ReadonlyArray<unknown>, raw = false, cached = true) =>
      Effect.withFiber<ReadonlyArray<any>, SqlError>((fiber) => {
        // The fiber's clock, so tests that control time also control expiry.
        const statement = statementFor(
          sql,
          fiber.getRef(Clock.Clock).currentTimeMillisUnsafe(),
          cached,
        );
        if (statement instanceof SqlError) {
          return Effect.fail(statement);
        }
        try {
          statement.setReadBigInts(Boolean(Context.get(fiber.context, Client.SafeIntegers)));
          if (hasRows(statement)) {
            return Effect.succeed(statement.all(...(params as any)));
          }
          const result = statement.run(...(params as any));
          return Effect.succeed(raw ? (result as unknown as ReadonlyArray<any>) : []);
        } catch (cause) {
          return Effect.fail(executeError(cause));
        }
      });

    const runValues = (sql: string, params: ReadonlyArray<unknown>) =>
      Effect.withFiber<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>((fiber) => {
        const statement = statementFor(
          sql,
          fiber.getRef(Clock.Clock).currentTimeMillisUnsafe(),
          true,
        );
        if (statement instanceof SqlError) {
          return Effect.fail(statement);
        }
        try {
          if (!hasRows(statement)) {
            statement.run(...(params as any));
            return Effect.succeed([]);
          }
          // The statement object is shared through the cache, so array mode
          // must be switched back before anything else can use it. A plain
          // `finally` in the same synchronous step guarantees that; an
          // Effect-level release would run as a later fiber operation, and
          // an interrupt between the two would leave the shared statement
          // returning arrays to callers that expect row objects.
          statement.setReturnArrays(true);
          try {
            // Safe to cast to array after we've setReturnArrays(true)
            return Effect.succeed(
              statement.all(...(params as any)) as unknown as ReadonlyArray<ReadonlyArray<unknown>>,
            );
          } finally {
            statement.setReturnArrays(false);
          }
        } catch (cause) {
          return Effect.fail(executeError(cause));
        }
      });

    const connection = identity<Connection>({
      execute(sql, params, rowTransform) {
        return rowTransform ? Effect.map(run(sql, params), rowTransform) : run(sql, params);
      },
      executeRaw(sql, params) {
        return run(sql, params, true);
      },
      executeValues(sql, params) {
        return runValues(sql, params);
      },
      executeUnprepared(sql, params, rowTransform) {
        // Prepared inside the effect and not cached. A statement that fails
        // to prepare must surface as a typed `SqlError`, not as an exception
        // thrown while the query effect is still being built.
        const effect = run(sql, params ?? [], false, false);
        return rowTransform ? Effect.map(effect, rowTransform) : effect;
      },
      executeStream(sql, params, rowTransform) {
        // `node:sqlite` iterators can throw while the Stream is pulling rows,
        // outside the Effect error channel. Materialize through the same
        // classified execution path as normal statements so SQLite failures
        // remain typed `SqlError`s and the connection permit stays scoped to
        // the stream. Cafe's current persistence queries are bounded; if a
        // future call site needs cursor-scale streaming, add a pull adapter
        // that translates iterator failures before changing this contract.
        const rows = rowTransform ? Effect.map(run(sql, params), rowTransform) : run(sql, params);
        return Stream.fromIterableEffect(rows);
      },
    });
    return { connection, db };
  });

  // The connection lock: `node:sqlite` exposes one synchronous connection, so
  // every statement and every transaction takes this one permit.
  //
  // It must be the interruption-safe semaphore. With `effect/Semaphore` from
  // Effect 4.0.0-beta.59, a query fiber interrupted at a scheduler yield
  // during `withPermits` kept the permit counted as taken with no finalizer
  // registered to return it. Because this is the only permit, every later
  // query and transaction then waited forever: orchestration stopped
  // committing and provider-event ingestion stalled, while the process kept
  // answering health checks and logged nothing. Do not switch this back to
  // `effect/Semaphore` without re-running the interruption sweeps in
  // `NodeSqliteClient.test.ts`.
  const connectionLock = yield* Semaphore.make(1);
  const backupLock = yield* Semaphore.make(1);
  const { connection, db } = yield* makeConnection;

  const acquirer = connectionLock.withPermits(1)(Effect.succeed(connection));
  // A transaction holds the permit across several statements, so its release
  // is attached to the transaction's scope (which `SqlClient` provides and
  // closes when the transaction ends) instead of to a single effect.
  const transactionAcquirer = Effect.as(connectionLock.withPermitsScoped(1), connection);

  const client = yield* Client.make({
    acquirer,
    compiler,
    transactionAcquirer,
    spanAttributes: [
      ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
      [ATTR_DB_SYSTEM_NAME, "sqlite"],
    ],
    transformRows,
  });

  const backup: SqliteBackupService = {
    backupTo: (path) =>
      backupLock.withPermits(1)(
        Effect.tryPromise({
          // Use the same DatabaseSync connection as normal writes. Node's
          // sqlite backup API can incorporate writes from that connection
          // without restarting the full copy.
          try: () => backupDatabase(db, path, { rate: 4_096 }),
          catch: (cause) =>
            new SqlError({
              reason: classifySqliteError(cause, {
                message: "Failed to back up the database",
                operation: "backup",
              }),
            }),
        }),
      ),
  };

  return { client, backup };
});

const make = (
  options: SqliteClientConfig,
): Effect.Effect<
  { readonly client: Client.SqlClient; readonly backup: SqliteBackupService },
  never,
  Scope.Scope | Reactivity.Reactivity
> =>
  makeWithDatabase(
    options,
    () =>
      new DatabaseSync(options.filename, {
        readOnly: options.readonly ?? false,
        allowExtension: options.allowExtension ?? false,
      }),
  );

const makeMemory = (
  config: SqliteMemoryClientConfig = {},
): Effect.Effect<
  { readonly client: Client.SqlClient; readonly backup: SqliteBackupService },
  never,
  Scope.Scope | Reactivity.Reactivity
> =>
  makeWithDatabase(
    {
      ...config,
      filename: ":memory:",
      readonly: false,
    },
    () => {
      const database = new DatabaseSync(":memory:", {
        allowExtension: config.allowExtension ?? false,
      });
      return database;
    },
  );

export const layerConfig = (
  config: Config.Wrap<SqliteClientConfig>,
): Layer.Layer<Client.SqlClient | SqliteBackup, Config.ConfigError> =>
  Layer.effectContext(
    Config.unwrap(config)
      .asEffect()
      .pipe(
        Effect.flatMap(make),
        Effect.map(({ client, backup }) =>
          Context.make(SqliteClient, client).pipe(
            Context.add(Client.SqlClient, client),
            Context.add(SqliteBackup, backup),
          ),
        ),
      ),
  ).pipe(Layer.provide(Reactivity.layer));

export const layer = (config: SqliteClientConfig): Layer.Layer<Client.SqlClient | SqliteBackup> =>
  Layer.effectContext(
    Effect.map(make(config), ({ client, backup }) =>
      Context.make(SqliteClient, client).pipe(
        Context.add(Client.SqlClient, client),
        Context.add(SqliteBackup, backup),
      ),
    ),
  ).pipe(Layer.provide(Reactivity.layer));

export const layerMemory = (
  config: SqliteMemoryClientConfig = {},
): Layer.Layer<Client.SqlClient | SqliteBackup> =>
  Layer.effectContext(
    Effect.map(makeMemory(config), ({ client, backup }) =>
      Context.make(SqliteClient, client).pipe(
        Context.add(Client.SqlClient, client),
        Context.add(SqliteBackup, backup),
      ),
    ),
  ).pipe(Layer.provide(Reactivity.layer));
