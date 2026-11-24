/**
 * preparedStatementCache - a synchronous, bounded cache of prepared SQL
 * statements.
 *
 * Why this exists instead of `effect/Cache`:
 *
 * `Cache.get` in Effect 4.0.0-beta.59 records an in-flight entry (a
 * `Deferred`) for the key and only then runs the lookup. The fiber run loop
 * can yield to the scheduler between those two steps once its operation
 * budget is spent, and a fiber interrupted at that yield leaves the entry
 * behind in one of two broken states:
 *
 * - the `Deferred` is never completed, so every later lookup of that SQL
 *   text waits forever; or
 * - the interruption itself is stored as the cached result, so every later
 *   lookup fails with an interrupt-only cause until the entry expires. A
 *   worker that treats interrupt-only causes as a normal shutdown then exits
 *   without logging anything.
 *
 * Preparing a `node:sqlite` statement is a synchronous call, so it needs no
 * in-flight state at all. This cache holds only finished statements, and
 * every operation is one synchronous step: there is no point at which an
 * interrupt can observe, or leave behind, a half-finished entry.
 *
 * Do not add asynchronous or deferred state here. If statement preparation
 * ever becomes asynchronous, the in-flight bookkeeping must be completed from
 * an uninterruptible region instead.
 *
 * @module preparedStatementCache
 */

export interface PreparedStatementCacheOptions<Statement> {
  /**
   * Maximum number of statements kept. Zero or less disables caching, so
   * every call prepares a fresh statement.
   */
  readonly capacity: number;
  /**
   * How long a statement is reused after it was prepared, in milliseconds.
   * `Infinity` keeps a statement until it is evicted for capacity.
   */
  readonly timeToLiveMs: number;
  /** Prepares a statement. May throw; a failure is never cached. */
  readonly prepare: (sql: string) => Statement;
}

export interface PreparedStatementCache<Statement> {
  /**
   * Returns the cached statement for `sql`, preparing it when it is missing
   * or expired. Rethrows whatever `prepare` throws.
   */
  readonly getOrPrepare: (sql: string, nowMs: number) => Statement;
  /** Number of statements currently cached. */
  readonly size: () => number;
}

interface Entry<Statement> {
  readonly statement: Statement;
  readonly expiresAtMs: number;
}

export const makePreparedStatementCache = <Statement>(
  options: PreparedStatementCacheOptions<Statement>,
): PreparedStatementCache<Statement> => {
  const capacity = Number.isFinite(options.capacity)
    ? Math.max(0, Math.trunc(options.capacity))
    : options.capacity > 0
      ? Number.POSITIVE_INFINITY
      : 0;
  // A `Map` iterates in insertion order. Re-inserting an entry on every hit
  // keeps the least recently used statement at the front, which is the one
  // evicted when the cache is over capacity.
  const entries = new Map<string, Entry<Statement>>();

  const getOrPrepare = (sql: string, nowMs: number): Statement => {
    if (capacity === 0) {
      return options.prepare(sql);
    }

    const cached = entries.get(sql);
    if (cached !== undefined) {
      entries.delete(sql);
      if (nowMs < cached.expiresAtMs) {
        entries.set(sql, cached);
        return cached.statement;
      }
      // Expired: fall through and prepare again. The expiry is fixed when the
      // statement is prepared and is not extended by use, so a statement
      // compiled against an old schema cannot be kept alive indefinitely by a
      // hot query.
    }

    // If this throws, nothing has been stored: the next call simply retries.
    const statement = options.prepare(sql);
    entries.set(sql, { statement, expiresAtMs: nowMs + options.timeToLiveMs });
    if (entries.size > capacity) {
      // Only one entry was added, so at most one needs to leave.
      const oldest = entries.keys().next();
      if (oldest.done !== true) {
        entries.delete(oldest.value);
      }
    }
    return statement;
  };

  return {
    getOrPrepare,
    size: () => entries.size,
  };
};
