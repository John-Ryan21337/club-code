import { describe, expect, it } from "vitest";

import { makePreparedStatementCache } from "./preparedStatementCache.ts";

/** A stand-in statement that records which preparation produced it. */
interface FakeStatement {
  readonly sql: string;
  readonly generation: number;
}

const makeHarness = (options: { readonly capacity: number; readonly timeToLiveMs: number }) => {
  const prepared: Array<string> = [];
  const failing = new Set<string>();
  const cache = makePreparedStatementCache<FakeStatement>({
    ...options,
    prepare: (sql) => {
      if (failing.has(sql)) {
        throw new Error(`cannot prepare ${sql}`);
      }
      prepared.push(sql);
      return { sql, generation: prepared.length };
    },
  });
  return { cache, prepared, failing };
};

describe("makePreparedStatementCache", () => {
  it("prepares a statement once and reuses it", () => {
    const { cache, prepared } = makeHarness({ capacity: 4, timeToLiveMs: 1_000 });

    const first = cache.getOrPrepare("select 1", 0);
    const second = cache.getOrPrepare("select 1", 500);

    expect(second).toBe(first);
    expect(prepared).toEqual(["select 1"]);
    expect(cache.size()).toBe(1);
  });

  it("prepares again once the time to live has passed, without extending it on use", () => {
    const { cache, prepared } = makeHarness({ capacity: 4, timeToLiveMs: 1_000 });

    const first = cache.getOrPrepare("select 1", 0);
    // A hit just before expiry must not push the expiry out.
    expect(cache.getOrPrepare("select 1", 999)).toBe(first);
    const afterExpiry = cache.getOrPrepare("select 1", 1_000);

    expect(afterExpiry).not.toBe(first);
    expect(prepared).toEqual(["select 1", "select 1"]);
    expect(cache.size()).toBe(1);
  });

  it("keeps statements for as long as they fit when the time to live is infinite", () => {
    const { cache, prepared } = makeHarness({
      capacity: 4,
      timeToLiveMs: Number.POSITIVE_INFINITY,
    });

    const first = cache.getOrPrepare("select 1", 0);

    expect(cache.getOrPrepare("select 1", Number.MAX_SAFE_INTEGER)).toBe(first);
    expect(prepared).toEqual(["select 1"]);
  });

  it("evicts the least recently used statement when over capacity", () => {
    const { cache, prepared } = makeHarness({ capacity: 2, timeToLiveMs: 1_000 });

    const a = cache.getOrPrepare("a", 0);
    cache.getOrPrepare("b", 0);
    // Touch `a` so `b` becomes the least recently used entry.
    expect(cache.getOrPrepare("a", 1)).toBe(a);
    cache.getOrPrepare("c", 2);

    expect(cache.size()).toBe(2);
    expect(cache.getOrPrepare("a", 3)).toBe(a);
    cache.getOrPrepare("b", 4);
    expect(prepared).toEqual(["a", "b", "c", "b"]);
  });

  it("does not cache a failed preparation", () => {
    const { cache, prepared, failing } = makeHarness({ capacity: 2, timeToLiveMs: 1_000 });

    failing.add("broken");
    expect(() => cache.getOrPrepare("broken", 0)).toThrow("cannot prepare broken");
    expect(cache.size()).toBe(0);

    // Once the cause is gone, for example after a migration created the
    // table, the same SQL text must prepare normally.
    failing.delete("broken");
    expect(cache.getOrPrepare("broken", 1).sql).toBe("broken");
    expect(prepared).toEqual(["broken"]);
  });

  it("keeps a healthy entry when an expired statement fails to prepare again", () => {
    const { cache, failing } = makeHarness({ capacity: 2, timeToLiveMs: 1_000 });

    const healthy = cache.getOrPrepare("healthy", 0);
    cache.getOrPrepare("expiring", 0);
    failing.add("expiring");

    expect(() => cache.getOrPrepare("expiring", 2_000)).toThrow("cannot prepare expiring");
    expect(cache.size()).toBe(1);
    expect(cache.getOrPrepare("healthy", 500)).toBe(healthy);
  });

  it("prepares on every call when caching is disabled", () => {
    for (const capacity of [0, -1, Number.NaN]) {
      const { cache, prepared } = makeHarness({ capacity, timeToLiveMs: 1_000 });

      const first = cache.getOrPrepare("select 1", 0);
      const second = cache.getOrPrepare("select 1", 0);

      expect(second).not.toBe(first);
      expect(prepared).toEqual(["select 1", "select 1"]);
      expect(cache.size()).toBe(0);
    }
  });
});
