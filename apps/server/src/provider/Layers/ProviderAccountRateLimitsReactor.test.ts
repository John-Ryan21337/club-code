import {
  EventId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ProviderRuntimeEvent,
} from "@cafecode/contracts";
import { assert, it } from "@effect/vitest";

import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import { ProviderRegistry, type ProviderRegistryShape } from "../Services/ProviderRegistry.ts";
import { ProviderService, type ProviderServiceShape } from "../Services/ProviderService.ts";
import { ProviderAccountRateLimitsReactorLive } from "./ProviderAccountRateLimitsReactor.ts";

it.effect("routes a Claude rate-limit event to its exact non-default provider instance", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const events = yield* PubSub.unbounded<ProviderRuntimeEvent>();
      const updated = yield* Deferred.make<void>();
      const updates = yield* Ref.make<
        ReadonlyArray<Parameters<ProviderRegistryShape["updateProviderAccountRateLimits"]>[0]>
      >([]);
      const providerInstanceId = ProviderInstanceId.make("claude-work");
      const providerService = {
        streamEvents: Stream.fromPubSub(events),
      } as ProviderServiceShape;
      const providerRegistry = {
        updateProviderAccountRateLimits: (input) =>
          Ref.update(updates, (current) => [...current, input]).pipe(
            Effect.andThen(Deferred.succeed(updated, undefined)),
            Effect.asVoid,
          ),
      } as ProviderRegistryShape;

      yield* Layer.build(
        ProviderAccountRateLimitsReactorLive.pipe(
          Layer.provide(Layer.succeed(ProviderService, providerService)),
          Layer.provide(Layer.succeed(ProviderRegistry, providerRegistry)),
        ),
      );
      yield* Effect.yieldNow;
      yield* PubSub.publish(events, {
        type: "account.rate-limits.updated",
        eventId: EventId.make("evt-claude-work-rate-limit"),
        provider: ProviderDriverKind.make("claudeAgent"),
        providerInstanceId,
        createdAt: "2026-07-25T20:00:00.000Z",
        threadId: ThreadId.make("thread-claude-child-agent"),
        payload: {
          rateLimits: {
            type: "rate_limit_event",
            rate_limit_info: {
              rateLimitType: "five_hour",
              utilization: 0.42,
              resetsAt: 1_785_100_000,
            },
          },
        },
      });
      yield* Deferred.await(updated);

      const [update] = yield* Ref.get(updates);
      assert.equal(update?.instanceId, providerInstanceId);
      assert.notEqual(update?.instanceId, ProviderInstanceId.make("claudeAgent"));
      assert.equal(update?.slot, "primary");
      assert.deepEqual(update?.window, {
        usedPercent: 42,
        windowDurationMins: 300,
        resetsAt: 1_785_100_000,
      });
    }),
  ),
);
