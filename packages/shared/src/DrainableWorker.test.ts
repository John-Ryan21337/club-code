import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Logger from "effect/Logger";
import * as Scope from "effect/Scope";

import { makeDrainableWorker } from "./DrainableWorker.ts";

/** Collects log messages so a test can assert on what the worker reported. */
const makeLogCapture = () => {
  const messages: string[] = [];
  const logger = Logger.make(({ message }) => {
    messages.push(String(message));
  });
  return {
    messages,
    layer: Logger.layer([logger], { mergeWithExisting: false }),
  };
};

describe("makeDrainableWorker", () => {
  it.live("waits for work enqueued during active processing before draining", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const processed: string[] = [];
        const firstStarted = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const secondStarted = yield* Deferred.make<void>();
        const releaseSecond = yield* Deferred.make<void>();

        const worker = yield* makeDrainableWorker((item: string) =>
          Effect.gen(function* () {
            if (item === "first") {
              yield* Deferred.succeed(firstStarted, undefined).pipe(Effect.orDie);
              yield* Deferred.await(releaseFirst);
            }

            if (item === "second") {
              yield* Deferred.succeed(secondStarted, undefined).pipe(Effect.orDie);
              yield* Deferred.await(releaseSecond);
            }

            processed.push(item);
          }),
        );

        yield* worker.enqueue("first");
        yield* Deferred.await(firstStarted);

        const drained = yield* Deferred.make<void>();
        yield* Effect.forkChild(
          worker.drain.pipe(
            Effect.tap(() => Deferred.succeed(drained, undefined).pipe(Effect.orDie)),
          ),
        );

        yield* worker.enqueue("second");
        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Deferred.await(secondStarted);

        expect(yield* Deferred.isDone(drained)).toBe(false);

        yield* Deferred.succeed(releaseSecond, undefined);
        yield* Deferred.await(drained);

        expect(processed).toEqual(["first", "second"]);
      }),
    ),
  );

  // Regression: an item that failed with an interrupt-only cause used to end
  // the worker loop silently. Every later item was accepted and never
  // processed. The interruption here is not aimed at the worker fiber: it is
  // the kind of cause a caller receives from shared state that another,
  // cancelled fiber left behind.
  it.live("keeps processing after an item fails with an interruption aimed elsewhere", () => {
    const logs = makeLogCapture();

    return Effect.scoped(
      Effect.gen(function* () {
        const processed: string[] = [];

        const worker = yield* makeDrainableWorker(
          (item: string) =>
            item === "poisoned"
              ? Effect.failCause(Cause.interrupt(123))
              : Effect.sync(() => {
                  processed.push(item);
                }),
          { name: "test-worker" },
        );

        yield* worker.enqueue("before");
        yield* worker.enqueue("poisoned");
        yield* worker.enqueue("after");
        // `drain` resolves only if the poisoned item was accounted for and the
        // loop went on to process the item behind it.
        yield* worker.drain;

        expect(processed).toEqual(["before", "after"]);
        expect(
          logs.messages.filter((message) =>
            message.includes("interruption that was not aimed at the worker"),
          ),
        ).toHaveLength(1);
      }),
    ).pipe(Effect.provide(logs.layer));
  });

  it.live("keeps processing after an item fails or dies", () => {
    const logs = makeLogCapture();

    return Effect.scoped(
      Effect.gen(function* () {
        const processed: string[] = [];

        const worker = yield* makeDrainableWorker((item: string) => {
          if (item === "fails") {
            return Effect.fail("typed failure");
          }
          if (item === "dies") {
            return Effect.die(new Error("defect"));
          }
          return Effect.sync(() => {
            processed.push(item);
          });
        });

        yield* worker.enqueue("fails");
        yield* worker.enqueue("dies");
        yield* worker.enqueue("after");
        yield* worker.drain;

        expect(processed).toEqual(["after"]);
        expect(
          logs.messages.filter((message) => message.includes("drainable worker item failed")),
        ).toHaveLength(2);
      }),
    ).pipe(Effect.provide(logs.layer));
  });

  // The worker's failure handler must never see the worker's own interruption.
  // Effect 4.0.0-beta.59 skips failure handlers for a fiber that is being
  // interrupted, and the worker relies on that. If a later Effect version
  // changed it, the worker would log a misleading warning or take the next
  // item during shutdown; this test fails in both cases.
  it.live("stops when its scope closes while an item is in progress", () => {
    const logs = makeLogCapture();

    return Effect.gen(function* () {
      const scope = yield* Scope.make();
      const started = yield* Deferred.make<void>();
      const processed: string[] = [];

      const worker = yield* makeDrainableWorker((item: string) =>
        Effect.gen(function* () {
          if (item === "blocked") {
            yield* Deferred.succeed(started, undefined);
            yield* Effect.never;
          }
          processed.push(item);
        }),
      ).pipe(Scope.provide(scope));

      yield* worker.enqueue("blocked");
      yield* worker.enqueue("never-reached");
      yield* Deferred.await(started);

      // Fails the test by timing out if the worker ignores its interruption.
      yield* Scope.close(scope, Exit.void);

      expect(processed).toEqual([]);
      expect(logs.messages.filter((message) => message.includes("drainable worker"))).toEqual([]);
    }).pipe(Effect.provide(logs.layer));
  });
});
