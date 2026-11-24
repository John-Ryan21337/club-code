/**
 * DrainableWorker - A queue-based worker that exposes a `drain()` effect.
 *
 * Wraps the common `Queue.unbounded` + `Effect.forever` pattern and adds
 * a signal that resolves when the queue is empty **and** the current item
 * has finished processing. This lets tests replace timing-sensitive
 * `Effect.sleep` calls with deterministic `drain()`.
 *
 * The worker outlives a failed item. A failure of one item, including an
 * interruption that was not aimed at the worker itself, is logged and the
 * worker moves on to the next item. Only closing the owning scope stops it.
 *
 * @module DrainableWorker
 */
import * as Cause from "effect/Cause";
import * as Scope from "effect/Scope";
import * as Effect from "effect/Effect";
import * as TxQueue from "effect/TxQueue";
import * as TxRef from "effect/TxRef";

export interface DrainableWorker<A> {
  /**
   * Enqueue a work item and track it for `drain()`.
   *
   * This wraps `Queue.offer` so drain state is updated atomically with the
   * enqueue path instead of inferring it from queue internals.
   */
  readonly enqueue: (item: A) => Effect.Effect<void>;

  /**
   * Resolves when the queue is empty and the worker is idle (not processing).
   */
  readonly drain: Effect.Effect<void>;
}

export interface DrainableWorkerOptions<A = never, E = never, R = never> {
  /**
   * Short fixed label written with the worker's own warnings, for example
   * `"provider-runtime-ingestion"`. It must not contain user content, paths,
   * or identifiers.
   */
  readonly name?: string;
  /**
   * Take a bounded FIFO batch of already queued items. The factory sets up
   * state for this batch. The worker invokes its processor once per item.
   */
  readonly batch?: {
    readonly maxSize: number;
    readonly makeProcessor: (
      items: ReadonlyArray<A>,
    ) => (item: A, index: number) => Effect.Effect<void, E, R>;
  };
}

/**
 * Create a drainable worker that processes items from an unbounded queue.
 *
 * The worker is forked into the current scope and will be interrupted when
 * the scope closes. A finalizer shuts down the queue.
 *
 * @param process - The effect to run for each queued item.
 * @param options - Optional warning label and batch processor.
 * @returns A `DrainableWorker` with `queue` and `drain`.
 */
export const makeDrainableWorker = <A, E, R>(
  process: (item: A) => Effect.Effect<void, E, R>,
  options?: DrainableWorkerOptions<A, E, R>,
): Effect.Effect<DrainableWorker<A>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const queue = yield* Effect.acquireRelease(TxQueue.unbounded<A>(), TxQueue.shutdown);
    const outstanding = yield* TxRef.make(0);
    const name = options?.name ?? "unnamed";

    /**
     * Runs one item and never lets its failure end the worker loop.
     *
     * Why an item failure must not end the loop: the loop is the only
     * consumer of the queue. If it stops, every later item is accepted by
     * `enqueue` and then never processed, and nothing reports it. That
     * happened in production: a query failed with an interrupt-only cause
     * that came from shared state left behind by another, cancelled fiber.
     * The callers rethrow interrupt-only causes because they look like a
     * normal shutdown, so the loop ended with no log line and provider event
     * ingestion stopped until the backend was restarted.
     *
     * Why catching interrupt-only causes here does not block shutdown: when
     * the worker fiber itself is interrupted (its scope is closing), Effect
     * 4.0.0-beta.59 skips failure handlers on the way out (`failCause` in
     * `effect/internal/core.ts` passes over them while the fiber is
     * interruptible and has a pending interruption). This handler therefore
     * runs only for causes that belong to the item, and an interrupt-only
     * cause that reaches it was never aimed at the worker. The test "stops
     * when its scope closes while an item is in progress" pins that behavior.
     *
     * Only item processing is guarded. A failure of `TxQueue.take`, for
     * example after the queue was shut down, still ends the loop, so a closed
     * worker cannot spin.
     */
    const processItem = (run: () => Effect.Effect<void, E, R>): Effect.Effect<void, never, R> =>
      Effect.ensuring(
        Effect.suspend(run),
        TxRef.update(outstanding, (n) => n - 1),
      ).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? // No cause text: an interrupt-only cause carries no detail, and
              // the item itself may hold user content.
              Effect.logWarning(
                "drainable worker item ended with an interruption that was not aimed at the worker; continuing with the next item",
                { worker: name },
              )
            : Effect.logWarning("drainable worker item failed; continuing with the next item", {
                worker: name,
                cause: Cause.pretty(cause),
              }),
        ),
      );

    const batch = options?.batch;
    const takeAndProcess =
      batch && Number.isSafeInteger(batch.maxSize) && batch.maxSize > 1
        ? TxQueue.takeBetween(queue, 1, batch.maxSize).pipe(
            Effect.flatMap((items) => {
              let processInBatch: ReturnType<typeof batch.makeProcessor> | undefined;
              return Effect.forEach(
                items,
                (item, index) =>
                  processItem(() => {
                    processInBatch ??= batch.makeProcessor(items);
                    return processInBatch(item, index);
                  }),
                { discard: true },
              );
            }),
          )
        : TxQueue.take(queue).pipe(Effect.tap((item) => processItem(() => process(item))));
    yield* takeAndProcess.pipe(Effect.forever, Effect.forkScoped);

    const drain: DrainableWorker<A>["drain"] = TxRef.get(outstanding).pipe(
      Effect.tap((n) => (n > 0 ? Effect.txRetry : Effect.void)),
      Effect.tx,
    );

    const enqueue = (element: A): Effect.Effect<boolean, never, never> =>
      TxQueue.offer(queue, element).pipe(
        Effect.tap(() => TxRef.update(outstanding, (n) => n + 1)),
        Effect.tx,
      );

    return { enqueue, drain } satisfies DrainableWorker<A>;
  });
