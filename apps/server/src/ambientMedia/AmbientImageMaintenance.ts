/**
 * Startup recovery of ambient image bytes that nothing references.
 *
 * The hard part of this feature is not the deletion, it is proving that the
 * reference source is still when the decision is made. Two things establish
 * that, and both are load-bearing:
 *
 * 1. **Order.** `withAmbientImageMaintenanceGate` wraps the whole server
 *    application layer in `Layer.unwrap`. The application layer value does not
 *    even exist until maintenance has returned, so the router, its WebSocket
 *    RPC route, and the HTTPS sibling listener cannot be installed while
 *    maintenance is deciding. This is a data dependency, not a merge ordering
 *    that a future refactor could silently reorder.
 * 2. **Lock.** The decision itself runs inside
 *    `ServerClientSettings.withReferenceLock`, which holds the same single
 *    write permit as `updateSettings` and as the settings file watcher. Even if
 *    some other caller did reach a settings write early, it would wait rather
 *    than tear the check.
 *
 * Both bounds are deliberate. Order alone would still be racy against the
 * watcher; the lock alone would let a request that arrived before the sweep
 * queue up behind it, which is safe but pointlessly slow at startup.
 */
import type { ClientSettings } from "@cafecode/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerClientSettingsService } from "../serverClientSettings.ts";
import { AmbientImageStore, type AmbientImageSweepResult } from "./AmbientImageStore.ts";

/**
 * How long startup waits for the settings runtime to load its document.
 *
 * Reaching this bound means maintenance is skipped entirely. Nothing has been
 * deleted, no lock is held, and the maintenance gate releases. Shared settings
 * startup continues; other application services can still depend on it.
 */
export const AMBIENT_IMAGE_MAINTENANCE_SETTINGS_TIMEOUT = Duration.seconds(10);

/**
 * How long startup waits for the sweep itself.
 *
 * Reaching this bound does not cancel the sweep and does not release the
 * settings write permit. Startup stops *waiting*; the sweep keeps its lock, so
 * ambient image reference writes stay blocked until it finishes. That is the
 * intended failure shape: a wedged filesystem must not hold the whole server
 * hostage, and it must also not let reference mutations resume underneath a
 * destructive operation that is still running.
 */
export const AMBIENT_IMAGE_MAINTENANCE_SWEEP_TIMEOUT = Duration.seconds(15);

export type AmbientImageMaintenanceReport =
  | { readonly status: "completed"; readonly sweep: AmbientImageSweepResult }
  | {
      readonly status: "skipped";
      readonly reason: "settings-unavailable" | "settings-timeout";
    }
  | { readonly status: "failed" }
  /** Startup gave up waiting. The sweep still holds the settings write permit. */
  | { readonly status: "running" };

export interface AmbientImageMaintenanceShape {
  readonly report: AmbientImageMaintenanceReport;
}

export class AmbientImageMaintenance extends Context.Service<
  AmbientImageMaintenance,
  AmbientImageMaintenanceShape
>()("cafecode/ambientMedia/AmbientImageMaintenance") {}

/**
 * Every ambient image id the settings document points at.
 *
 * Both reference sites must be covered: the single selected asset and the
 * cycle list. Missing one of them would make maintenance delete a live image.
 */
export const referencedAmbientImageIds = (settings: ClientSettings): ReadonlySet<string> => {
  const referenced = new Set<string>();
  if (settings.ambientImageAsset) referenced.add(settings.ambientImageAsset.id);
  for (const asset of settings.ambientImageCycleAssets) referenced.add(asset.id);
  return referenced;
};

const runAmbientImageMaintenance = Effect.gen(function* () {
  const clientSettings = yield* ServerClientSettingsService;
  const store = yield* AmbientImageStore;

  // `start` is idempotent: whoever gets there first loads the document and the
  // rest await the same deferred. Calling it here means maintenance does not
  // depend on another startup phase having already forked it, which is what
  // keeps this off the startup dependency cycle.
  // Startup is shared with the rest of the application. Timing out this waiter
  // must not interrupt that startup and poison its shared readiness deferred.
  const startFiber = yield* Effect.forkScoped(clientSettings.start);
  const started = yield* Fiber.join(startFiber).pipe(
    Effect.timeoutOption(AMBIENT_IMAGE_MAINTENANCE_SETTINGS_TIMEOUT),
    Effect.exit,
  );
  if (Exit.isFailure(started)) {
    yield* Effect.logWarning("ambient image maintenance skipped", {
      reason: "settings-unavailable",
    });
    return { status: "skipped", reason: "settings-unavailable" } as const;
  }
  if (Option.isNone(started.value)) {
    yield* Effect.logWarning("ambient image maintenance skipped", {
      reason: "settings-timeout",
    });
    return { status: "skipped", reason: "settings-timeout" } as const;
  }

  // Forked into the layer scope rather than run inline, so the wait below can
  // be bounded without abandoning the work or the lock it holds. The fiber is
  // owned by the server scope: shutdown interrupts it, and the sweep's unlink
  // step is uninterruptible, so it stops between deletions rather than during
  // one. Nothing here is fire-and-forget.
  const sweepFiber = yield* Effect.forkScoped(
    clientSettings.withReferenceLock((settings) =>
      store.sweepUnreferencedImages({
        referencedIds: referencedAmbientImageIds(settings),
      }),
    ),
  );

  const finished = yield* Fiber.await(sweepFiber).pipe(
    Effect.timeoutOption(AMBIENT_IMAGE_MAINTENANCE_SWEEP_TIMEOUT),
  );
  if (Option.isNone(finished)) {
    yield* Effect.logWarning("ambient image maintenance is still running", {
      detail: "ambient image reference writes stay blocked until it finishes",
    });
    return { status: "running" } as const;
  }

  const exit = finished.value;
  if (Exit.isFailure(exit)) {
    yield* Effect.logWarning("ambient image maintenance failed");
    return { status: "failed" } as const;
  }

  yield* Effect.logDebug("ambient image maintenance complete", exit.value);
  return { status: "completed", sweep: exit.value } as const;
});

/**
 * Complete ambient image maintenance, then yield the server application layer.
 *
 * `Layer.unwrap` runs the effect and only then builds the layer it produced, so
 * this orders maintenance ahead of every member of `application` without
 * relying on any of them declaring a dependency on it.
 */
export const withAmbientImageMaintenanceGate = <A, E, R>(application: Layer.Layer<A, E, R>) =>
  Layer.unwrap(
    runAmbientImageMaintenance.pipe(
      Effect.map((report) =>
        Layer.provideMerge(application, Layer.succeed(AmbientImageMaintenance, { report })),
      ),
    ),
  );
