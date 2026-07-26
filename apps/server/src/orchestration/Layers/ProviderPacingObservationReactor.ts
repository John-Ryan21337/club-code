import type { ServerProvider, ServerSettings } from "@cafecode/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ServerEnvironment } from "../../environment/Services/ServerEnvironment.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import type { ProviderPacingObservationSettings } from "../providerPacingObservationTracker.ts";
import { ProviderPacingAdmission } from "../Services/ProviderPacingAdmission.ts";

type PacingSourceUpdate =
  | {
      readonly type: "providers";
      readonly providers: ReadonlyArray<ServerProvider>;
    }
  | {
      readonly type: "settings";
      readonly settings: ServerSettings;
    };

const STALE_TIMER_POLL_MS = 60_000;

export function providerPacingSettings(
  settings: ServerSettings,
): ProviderPacingObservationSettings {
  const pacingSettings = settings as ServerSettings &
    Partial<{
      readonly drainFirstPacingEnabled: boolean;
      readonly drainFirstPacingMinimumPauseMinutes: number;
    }>;
  return {
    enabled: pacingSettings.drainFirstPacingEnabled ?? false,
    minimumPauseMinutes: pacingSettings.drainFirstPacingMinimumPauseMinutes ?? 0,
  };
}

/**
 * Self-starting provider/settings observer for the shared pacing admission
 * runtime. Stream subscriptions are acquired before initial reads so updates
 * that race startup are buffered rather than lost.
 */
export const ProviderPacingObservationReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const admission = yield* ProviderPacingAdmission;
    const environment = yield* ServerEnvironment;
    const providerRegistry = yield* ProviderRegistry;
    const serverSettings = yield* ServerSettingsService;
    yield* serverSettings.ready;

    const providerUpdates = yield* Stream.toQueue(providerRegistry.streamChanges, {
      capacity: "unbounded",
    });
    const settingsUpdates = yield* Stream.toQueue(serverSettings.streamChanges, {
      capacity: "unbounded",
    });
    // Let both hot-stream drivers acquire their PubSub subscriptions before
    // taking the authoritative startup snapshots.
    yield* Effect.yieldNow;

    const environmentId = yield* environment.getEnvironmentId;
    let latestProviders = yield* providerRegistry.getProviders;
    let latestSettings = yield* serverSettings.getSettings;
    const applyLatest = Effect.fn("ProviderPacingObservationReactor.applyLatest")(function* () {
      const observedAtMs = yield* Clock.currentTimeMillis;
      yield* Effect.sync(() =>
        admission.applyProviderSnapshots({
          environmentId,
          providers: latestProviders,
          settings: providerPacingSettings(latestSettings),
          observedAtMs,
        }),
      );
    });
    yield* applyLatest();

    const bufferedUpdates = Stream.merge(
      Stream.fromQueue(providerUpdates).pipe(
        Stream.map(
          (providers): PacingSourceUpdate => ({
            type: "providers",
            providers,
          }),
        ),
      ),
      Stream.fromQueue(settingsUpdates).pipe(
        Stream.map(
          (settings): PacingSourceUpdate => ({
            type: "settings",
            settings,
          }),
        ),
      ),
    );
    yield* Stream.runForEach(bufferedUpdates, (update) => {
      if (update.type === "providers") {
        latestProviders = update.providers;
      } else {
        latestSettings = update.settings;
      }
      return applyLatest();
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Failed to apply a provider pacing observation update.", { cause }),
      ),
      Effect.forkScoped,
    );

    yield* Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const nextStaleAtMs = admission.nextStaleAtMs(now);
      const sleepMs =
        nextStaleAtMs === null
          ? STALE_TIMER_POLL_MS
          : Math.max(1, Math.min(STALE_TIMER_POLL_MS, nextStaleAtMs - now));
      yield* Effect.sleep(Duration.millis(sleepMs));
      const observedAtMs = yield* Clock.currentTimeMillis;
      yield* Effect.sync(() => admission.invalidateStaleEvidence(observedAtMs));
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Failed to expire provider pacing quota evidence.", { cause }),
      ),
      Effect.forever,
      Effect.forkScoped,
    );
  }),
);
