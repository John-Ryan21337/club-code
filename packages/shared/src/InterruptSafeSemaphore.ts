/**
 * InterruptSafeSemaphore - a counting semaphore whose permits cannot be
 * stranded by fiber interruption.
 *
 * Why this exists instead of `effect/Semaphore`:
 *
 * Effect 4.0.0-beta.59 implements `Semaphore.withPermits` as
 *
 *   uninterruptibleMask((restore) =>
 *     flatMap(restore(take(n)), (permits) => onExit(restore(self), release)))
 *
 * `take` increments the taken-permit counter *inside* the interruptible
 * `restore` region, and the release finalizer is only registered by the
 * following `flatMap` continuation. The fiber run loop may insert a scheduler
 * yield between any two operations once its operation budget
 * (`Scheduler.MaxOpsBeforeYield`) is spent. If that yield lands between the
 * counter increment and the finalizer registration, and the fiber is
 * interrupted while it is parked there, the fiber unwinds with the permit
 * still counted as taken and nothing left to give it back. The semaphore is
 * then short one permit for the rest of the process, with nothing logged.
 *
 * For a one-permit lock that is a permanent, silent wedge. Club Code hit
 * exactly that on the SQLite connection lock: one interrupted query left
 * every later query waiting forever, which stalled provider-event ingestion
 * while the process still answered health checks.
 *
 * The rule this module enforces: the only interruptible step of acquisition
 * is *waiting*. Taking a permit and registering its release both happen in
 * one uninterruptible region, where an interrupt is deferred rather than
 * delivered, so no scheduler yield can separate them.
 *
 * The surface intentionally mirrors the subset of `effect/Semaphore` that
 * Club Code uses (`make`, `makeUnsafe`, `withPermits`, `withPermit`) so a
 * caller migrates by changing one import. Like the upstream semaphore it is
 * not strictly fair: a fiber that arrives while a permit is free takes it
 * even if older waiters have been woken but have not run yet.
 *
 * @module InterruptSafeSemaphore
 */
import * as Effect from "effect/Effect";
import type * as Fiber from "effect/Fiber";
import type * as Scope from "effect/Scope";

export interface Semaphore {
  /**
   * Runs `self` while holding `permits` permits. The permits are returned
   * when `self` succeeds, fails, or is interrupted.
   */
  readonly withPermits: (
    permits: number,
  ) => <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  /** `withPermits(1)`. */
  readonly withPermit: <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
  /**
   * Takes `permits` permits and returns them when the surrounding `Scope`
   * closes. Used where the holder outlives a single effect, such as a SQL
   * transaction that spans several statements.
   */
  readonly withPermitsScoped: (permits: number) => Effect.Effect<void, never, Scope.Scope>;
}

const assertPermitCount = (label: string, value: number, maximum: number): void => {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    // A request for more permits than exist could never be satisfied and
    // would wait forever; reject it loudly instead of creating a silent hang.
    throw new RangeError(
      `InterruptSafeSemaphore ${label} must be an integer between 1 and ${maximum}`,
    );
  }
};

/**
 * Creates a semaphore without an Effect wrapper, for module-level locks.
 */
export const makeUnsafe = (permits: number): Semaphore => {
  assertPermitCount("capacity", permits, Number.MAX_SAFE_INTEGER);

  let taken = 0;
  // Each entry resumes one fiber parked in `waitForRelease`.
  const waiters = new Set<() => void>();
  let wakeScheduled = false;

  const wakeWaiters = (): void => {
    wakeScheduled = false;
    if (waiters.size === 0) {
      return;
    }
    // Wake every waiter, not just as many as there are free permits. A woken
    // fiber can be interrupted before it retries; if only that one fiber had
    // been woken, the freed permit would sit unused while the others slept.
    // Each woken fiber re-checks the counter and re-registers when it loses
    // the race, so over-waking costs a retry and never a lost wakeup. The
    // set is snapshotted and cleared first so a fiber that re-registers
    // during this loop is not resumed twice by it.
    const woken = Array.from(waiters);
    waiters.clear();
    for (const wake of woken) {
      wake();
    }
  };

  const releaseUnsafe = (fiber: Fiber.Fiber<unknown, unknown>, count: number): void => {
    taken -= count;
    if (waiters.size === 0 || wakeScheduled) {
      return;
    }
    // Resuming an `Effect.callback` runs the waiting fiber's run loop inline
    // on the caller's stack. Release runs inside the holder's finalizer, so
    // waking inline would execute unrelated fibers in the middle of another
    // fiber's cleanup. Hand the wake to the fiber's scheduler instead (the
    // same hand-off the upstream semaphore uses). A fiber that starts waiting
    // before this task runs is still served: `waitForRelease` re-checks the
    // counter when it registers.
    wakeScheduled = true;
    fiber.currentDispatcher.scheduleTask(wakeWaiters, 0);
  };

  const release = (count: number): Effect.Effect<void> =>
    Effect.withFiber((fiber) => {
      releaseUnsafe(fiber, count);
      return Effect.void;
    });

  const waitForRelease = (count: number): Effect.Effect<void> =>
    Effect.callback<void>((resume) => {
      // Re-check here, synchronously with registration. A scheduler yield can
      // separate the failed attempt in `acquire` from this registration, and
      // a release in that gap would otherwise be missed.
      if (taken + count <= permits) {
        resume(Effect.void);
        return;
      }
      const wake = (): void => resume(Effect.void);
      waiters.add(wake);
      // Runs when the waiting fiber is interrupted: stop tracking it so the
      // set cannot grow with fibers that will never retry.
      return Effect.sync(() => {
        waiters.delete(wake);
      });
    });

  /**
   * Must be evaluated in an uninterruptible region. The check-and-increment
   * is one synchronous step, and because interrupts are deferred here the
   * caller's next step (registering the release) is guaranteed to run. Only
   * the wait itself is wrapped in `restore`, so a fiber that is interrupted
   * while waiting leaves without ever having taken a permit.
   */
  const acquire = (
    count: number,
    restore: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>,
  ): Effect.Effect<void> =>
    Effect.suspend(() => {
      if (taken + count <= permits) {
        taken += count;
        return Effect.void;
      }
      return Effect.flatMap(restore(waitForRelease(count)), () => acquire(count, restore));
    });

  const withPermits = (count: number) => {
    assertPermitCount("permit request", count, permits);
    return <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
      Effect.uninterruptibleMask((restore) =>
        Effect.flatMap(acquire(count, restore), () =>
          // `onExit` pushes its frame before `restore(self)` is evaluated, so
          // an interrupt that was deferred during acquisition and fires on
          // entry to `restore` still runs the release.
          Effect.onExit(restore(self), () => release(count)),
        ),
      );
  };

  const withPermitsScoped = (count: number): Effect.Effect<void, never, Scope.Scope> => {
    assertPermitCount("permit request", count, permits);
    return Effect.uninterruptibleMask((restore) =>
      Effect.flatMap(acquire(count, restore), () => Effect.addFinalizer(() => release(count))),
    );
  };

  return {
    withPermits,
    withPermit: withPermits(1),
    withPermitsScoped,
  };
};

/**
 * Creates a semaphore with `permits` permits.
 */
export const make = (permits: number): Effect.Effect<Semaphore> =>
  Effect.sync(() => makeUnsafe(permits));
