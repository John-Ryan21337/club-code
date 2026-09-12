import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import { ServerClientSettingsService } from "../serverClientSettings.ts";
import { AmbientImageStore } from "./AmbientImageStore.ts";
import {
  AmbientImageMaintenance,
  withAmbientImageMaintenanceGate,
} from "./AmbientImageMaintenance.ts";

it.effect("does not cancel shared settings startup when the maintenance waiter times out", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const ready = yield* Deferred.make<void>();
    let finalized = false;
    const settings = Layer.mock(ServerClientSettingsService)({
      start: Deferred.succeed(entered, undefined).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.andThen(Deferred.succeed(ready, undefined)),
        Effect.asVoid,
        Effect.ensuring(
          Effect.sync(() => {
            finalized = true;
          }),
        ),
      ),
    });
    const store = Layer.mock(AmbientImageStore)({});
    const build = yield* Layer.build(
      withAmbientImageMaintenanceGate(Layer.empty).pipe(
        Layer.provide(settings),
        Layer.provide(store),
      ),
    ).pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.await(entered);
    yield* TestClock.adjust("11 seconds");
    const context = yield* Fiber.join(build);
    assert.deepEqual(Context.get(context, AmbientImageMaintenance).report, {
      status: "skipped",
      reason: "settings-timeout",
    });
    assert.isFalse(finalized);
    yield* Deferred.succeed(release, undefined);
    yield* Deferred.await(ready);
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);
