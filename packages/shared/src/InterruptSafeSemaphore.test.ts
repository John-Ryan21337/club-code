import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scheduler from "effect/Scheduler";
import * as Scope from "effect/Scope";
import * as UpstreamSemaphore from "effect/Semaphore";

import * as Semaphore from "./InterruptSafeSemaphore.ts";

/**
 * The fiber run loop yields to the scheduler whenever its operation budget is
 * spent, and an interrupt is delivered at such a yield. Shrinking the budget
 * turns every operation boundary into a possible interruption point, so the
 * sweeps below interrupt a fiber at each point of permit acquisition.
 *
 * Budgets below three cannot make progress: resuming from a forced yield costs
 * two operations, so the fiber would yield again before running real work.
 */
const YIELD_BUDGETS = [3, 4, 5, 7] as const;
/** More scheduler turns than acquire, run and release need at the budgets above. */
const MAX_INTERRUPT_TURNS = 40;
/** Scheduler turns a healthy acquisition is allowed before it counts as stuck. */
const PROBE_TURNS = 200;

const yieldTurns = (turns: number) =>
  Effect.gen(function* () {
    for (let turn = 0; turn < turns; turn++) {
      yield* Effect.yieldNow;
    }
  });

/**
 * Reports whether `effect` finishes within `PROBE_TURNS` scheduler turns.
 * Counting turns instead of using a timeout keeps a regression fast and lets
 * one run list every bad interruption point.
 */
const completes = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    for (let turn = 0; turn < PROBE_TURNS; turn++) {
      if (fiber.pollUnsafe() !== undefined) {
        return true;
      }
      yield* Effect.yieldNow;
    }
    yield* Fiber.interrupt(fiber);
    return false;
  });

/** Starts `effect` with a tiny operation budget and interrupts it after `turns`. */
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
    yield* yieldTurns(turns);
    yield* Fiber.interrupt(victim);
  });

/**
 * Interrupts a fresh one-permit lock at every yield and returns the
 * interruption points after which the lock could not be taken again.
 */
const strandedInterruptionPoints = (
  makeLock: () => <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const stranded: Array<string> = [];
    for (const budget of YIELD_BUDGETS) {
      for (let turns = 0; turns <= MAX_INTERRUPT_TURNS; turns++) {
        // A fresh lock per case: one stranded permit must not hide later cases.
        const withLock = makeLock();
        yield* interruptAfterTurns(withLock(Effect.yieldNow), budget, turns);
        if (!(yield* completes(withLock(Effect.void)))) {
          stranded.push(`budget ${budget}, turn ${turns}`);
        }
      }
    }
    return stranded;
  });

describe("InterruptSafeSemaphore", () => {
  it.effect("never strands a permit when the holder is interrupted at any yield", () =>
    Effect.gen(function* () {
      const stranded = yield* strandedInterruptionPoints(() => Semaphore.makeUnsafe(1).withPermit);
      expect(stranded).toEqual([]);
    }),
  );

  it.effect("the sweep detects the upstream semaphore's stranded permit", () =>
    Effect.gen(function* () {
      // Guards the sweep itself. If a future Effect release fixes
      // `Semaphore.withPermits`, this assertion fails and the local
      // replacement can be reconsidered; until then it proves the test above
      // exercises the interruption window that caused the production wedge.
      const stranded = yield* strandedInterruptionPoints(
        () => UpstreamSemaphore.makeUnsafe(1).withPermit,
      );
      expect(stranded.length).toBeGreaterThan(0);
    }),
  );

  it.effect("never strands a scoped permit when acquisition is interrupted at any yield", () =>
    Effect.gen(function* () {
      const stranded: Array<string> = [];
      for (const budget of YIELD_BUDGETS) {
        for (let turns = 0; turns <= MAX_INTERRUPT_TURNS; turns++) {
          const semaphore = Semaphore.makeUnsafe(1);
          yield* interruptAfterTurns(
            Effect.scoped(Effect.andThen(semaphore.withPermitsScoped(1), Effect.yieldNow)),
            budget,
            turns,
          );
          if (!(yield* completes(semaphore.withPermit(Effect.void)))) {
            stranded.push(`budget ${budget}, turn ${turns}`);
          }
        }
      }
      expect(stranded).toEqual([]);
    }),
  );

  it.effect("holds a scoped permit until the scope closes", () =>
    Effect.gen(function* () {
      const semaphore = yield* Semaphore.make(1);
      const scope = yield* Scope.make();
      yield* Scope.provide(semaphore.withPermitsScoped(1), scope);

      expect(yield* completes(semaphore.withPermit(Effect.void))).toBe(false);
      yield* Scope.close(scope, Exit.void);
      expect(yield* completes(semaphore.withPermit(Effect.void))).toBe(true);
    }),
  );

  it.effect("returns the permit when the body succeeds, fails, or dies", () =>
    Effect.gen(function* () {
      const semaphore = yield* Semaphore.make(1);

      expect(yield* semaphore.withPermit(Effect.succeed("value"))).toBe("value");
      expect(yield* Effect.flip(semaphore.withPermit(Effect.fail("failure")))).toBe("failure");
      const died = yield* Effect.exit(semaphore.withPermit(Effect.die("defect")));
      expect(Exit.isFailure(died)).toBe(true);

      expect(yield* completes(semaphore.withPermit(Effect.void))).toBe(true);
    }),
  );

  it.effect("never runs more holders at once than there are permits", () =>
    Effect.gen(function* () {
      const semaphore = yield* Semaphore.make(2);
      let running = 0;
      let peak = 0;
      let finished = 0;

      const holder = semaphore.withPermit(
        Effect.gen(function* () {
          running += 1;
          peak = Math.max(peak, running);
          yield* yieldTurns(3);
          running -= 1;
          finished += 1;
        }),
      );

      yield* Effect.all(
        Array.from({ length: 12 }, () => holder),
        { concurrency: "unbounded" },
      );

      expect(peak).toBe(2);
      expect(finished).toBe(12);
    }),
  );

  it.effect("makes a multi-permit request wait until enough permits are free", () =>
    Effect.gen(function* () {
      const semaphore = yield* Semaphore.make(2);
      const releaseFirst = yield* Deferred.make<void>();
      const releaseSecond = yield* Deferred.make<void>();
      const first = yield* Effect.forkChild(semaphore.withPermit(Deferred.await(releaseFirst)));
      const second = yield* Effect.forkChild(semaphore.withPermit(Deferred.await(releaseSecond)));
      yield* yieldTurns(5);

      const both = yield* Effect.forkChild(semaphore.withPermits(2)(Effect.succeed("both")));
      yield* yieldTurns(5);
      expect(both.pollUnsafe()).toBeUndefined();

      // One free permit is not enough: the waiter is woken, loses, and waits again.
      yield* Deferred.succeed(releaseFirst, undefined);
      yield* Fiber.join(first);
      yield* yieldTurns(10);
      expect(both.pollUnsafe()).toBeUndefined();

      yield* Deferred.succeed(releaseSecond, undefined);
      yield* Fiber.join(second);
      expect(yield* Fiber.join(both)).toBe("both");
    }),
  );

  it.effect("drops an interrupted waiter without disturbing the holder or later waiters", () =>
    Effect.gen(function* () {
      const semaphore = yield* Semaphore.make(1);
      const releaseHolder = yield* Deferred.make<void>();
      const holder = yield* Effect.forkChild(semaphore.withPermit(Deferred.await(releaseHolder)));
      yield* yieldTurns(5);

      let interruptedWaiterRan = false;
      const interruptedWaiter = yield* Effect.forkChild(
        semaphore.withPermit(
          Effect.sync(() => {
            interruptedWaiterRan = true;
          }),
        ),
      );
      const survivingWaiter = yield* Effect.forkChild(
        semaphore.withPermit(Effect.succeed("survivor")),
      );
      yield* yieldTurns(5);

      yield* Fiber.interrupt(interruptedWaiter);
      yield* Deferred.succeed(releaseHolder, undefined);
      yield* Fiber.join(holder);

      expect(yield* Fiber.join(survivingWaiter)).toBe("survivor");
      expect(interruptedWaiterRan).toBe(false);
      expect(yield* completes(semaphore.withPermit(Effect.void))).toBe(true);
    }),
  );

  it.effect("hands the permit on when a woken waiter is interrupted before it retries", () =>
    Effect.gen(function* () {
      // The first waiter is interrupted in the same turn that the holder
      // releases, before the scheduled wake can run it. Waking only that one
      // fiber would leave the second waiter asleep beside a free permit.
      const semaphore = yield* Semaphore.make(1);
      const releaseHolder = yield* Deferred.make<void>();
      const holder = yield* Effect.forkChild(semaphore.withPermit(Deferred.await(releaseHolder)));
      yield* yieldTurns(5);

      const firstWaiter = yield* Effect.forkChild(semaphore.withPermit(Effect.succeed("first")));
      const secondWaiter = yield* Effect.forkChild(semaphore.withPermit(Effect.succeed("second")));
      yield* yieldTurns(5);

      yield* Deferred.succeed(releaseHolder, undefined);
      yield* Fiber.interrupt(firstWaiter);
      yield* Fiber.join(holder);

      expect(yield* Fiber.join(secondWaiter)).toBe("second");
    }),
  );

  it("rejects a capacity or request that could never be satisfied", () => {
    expect(() => Semaphore.makeUnsafe(0)).toThrow(RangeError);
    expect(() => Semaphore.makeUnsafe(1.5)).toThrow(RangeError);
    const semaphore = Semaphore.makeUnsafe(2);
    expect(() => semaphore.withPermits(3)).toThrow(RangeError);
    expect(() => semaphore.withPermits(0)).toThrow(RangeError);
    expect(() => semaphore.withPermitsScoped(3)).toThrow(RangeError);
  });
});
