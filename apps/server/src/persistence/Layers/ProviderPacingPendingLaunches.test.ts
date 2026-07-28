import { EventId, ProviderInstanceId, ThreadId } from "@cafecode/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { SqlitePersistenceMemory } from "./Sqlite.ts";
import { ProviderPacingPendingLaunchRepositoryLive } from "./ProviderPacingPendingLaunches.ts";
import { ProviderPacingPendingLaunchRepository } from "../Services/ProviderPacingPendingLaunches.ts";

const layer = it.layer(
  ProviderPacingPendingLaunchRepositoryLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

const claudeInstanceId = ProviderInstanceId.make("claude-primary");

layer("ProviderPacingPendingLaunchRepository", (it) => {
  it.effect("round-trips exact launch reconstruction metadata", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderPacingPendingLaunchRepository;
      const launch = {
        sourceEventId: EventId.make("event-a"),
        sourceSequence: 41,
        threadId: ThreadId.make("thread-a"),
        providerInstanceId: claudeInstanceId,
        dispatchSource: "user" as const,
        requestedAt: "2026-07-26T17:00:00.000Z",
      };

      yield* repository.upsert(launch);

      assert.deepStrictEqual(
        Option.getOrNull(yield* repository.getByThreadId({ threadId: launch.threadId })),
        launch,
      );
    }),
  );

  it.effect("claims one immutable source atomically without replacing the winner", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderPacingPendingLaunchRepository;
      const winner = {
        sourceEventId: EventId.make("event-claim-winner"),
        sourceSequence: 47,
        threadId: ThreadId.make("thread-claim"),
        providerInstanceId: claudeInstanceId,
        dispatchSource: "user" as const,
        requestedAt: "2026-07-26T17:00:00.000Z",
      };
      const loser = {
        ...winner,
        sourceEventId: EventId.make("event-claim-loser"),
        sourceSequence: 48,
        requestedAt: "2026-07-26T17:00:01.000Z",
      };

      assert.isTrue(yield* repository.insertIfAbsent(winner));
      assert.isFalse(yield* repository.insertIfAbsent(loser));
      assert.deepStrictEqual(
        Option.getOrNull(yield* repository.getByThreadId({ threadId: winner.threadId })),
        winner,
      );
      yield* repository.deleteByThreadId({ threadId: winner.threadId });
    }),
  );

  it.effect("allows only one concurrent claimant for the same source event", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderPacingPendingLaunchRepository;
      const sourceEventId = EventId.make("event-concurrent-claim");
      const sourceSequence = 49;
      const results = yield* Effect.all(
        [ThreadId.make("thread-claim-a"), ThreadId.make("thread-claim-b")].map((threadId) =>
          repository.insertIfAbsent({
            sourceEventId,
            sourceSequence,
            threadId,
            providerInstanceId: claudeInstanceId,
            dispatchSource: "user",
            requestedAt: "2026-07-26T17:00:00.000Z",
          }),
        ),
        { concurrency: "unbounded" },
      );

      assert.deepStrictEqual(results.toSorted(), [false, true]);
      yield* repository.deleteByThreadId({ threadId: ThreadId.make("thread-claim-a") });
      yield* repository.deleteByThreadId({ threadId: ThreadId.make("thread-claim-b") });
    }),
  );

  it.effect("replaces one thread atomically and lists waits in requested order", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderPacingPendingLaunchRepository;
      const threadA = ThreadId.make("thread-a");
      yield* repository.upsert({
        sourceEventId: EventId.make("event-old"),
        sourceSequence: 42,
        threadId: threadA,
        providerInstanceId: claudeInstanceId,
        dispatchSource: "user",
        requestedAt: "2026-07-26T17:00:02.000Z",
      });
      yield* repository.upsert({
        sourceEventId: EventId.make("event-b"),
        sourceSequence: 43,
        threadId: ThreadId.make("thread-b"),
        providerInstanceId: claudeInstanceId,
        dispatchSource: "user",
        requestedAt: "2026-07-26T17:00:01.000Z",
      });
      yield* repository.upsert({
        sourceEventId: EventId.make("event-new"),
        sourceSequence: 44,
        threadId: threadA,
        providerInstanceId: claudeInstanceId,
        dispatchSource: "user",
        requestedAt: "2026-07-26T17:00:03.000Z",
      });

      const launches = yield* repository.listAll;
      assert.deepStrictEqual(
        launches.map((launch) => [String(launch.threadId), String(launch.sourceEventId)]),
        [
          ["thread-b", "event-b"],
          ["thread-a", "event-new"],
        ],
      );
    }),
  );

  it.effect("deletes only the selected thread wait", () =>
    Effect.gen(function* () {
      const repository = yield* ProviderPacingPendingLaunchRepository;
      const threadA = ThreadId.make("thread-a");
      const threadB = ThreadId.make("thread-b");
      for (const [threadId, sourceEventId, sourceSequence] of [
        [threadA, EventId.make("event-a"), 45],
        [threadB, EventId.make("event-b"), 46],
      ] as const) {
        yield* repository.upsert({
          sourceEventId,
          sourceSequence,
          threadId,
          providerInstanceId: claudeInstanceId,
          dispatchSource: "user",
          requestedAt: "2026-07-26T17:00:00.000Z",
        });
      }

      yield* repository.deleteByThreadId({ threadId: threadA });

      assert.isTrue(Option.isNone(yield* repository.getByThreadId({ threadId: threadA })));
      assert.isTrue(Option.isSome(yield* repository.getByThreadId({ threadId: threadB })));
    }),
  );
});
