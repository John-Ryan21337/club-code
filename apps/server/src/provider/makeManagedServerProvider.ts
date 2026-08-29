import type {
  ServerProvider,
  ServerProviderAccountRateLimits,
  ServerProviderProbeDiagnostics,
  ServerProviderProbeOutcome,
  ServerProviderRateLimitResetCreditError,
  ServerProviderRateLimitResetCreditOutcome,
} from "@cafecode/contracts";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";

import type { ServerProviderShape } from "./Services/ServerProvider.ts";
import { ServerSettingsError } from "@cafecode/contracts";
import {
  DEFAULT_PROVIDER_INCONCLUSIVE_FAILURE_THRESHOLD,
  deterministicProviderProbePhaseOffsetMs,
  hasConclusiveProviderAuthState,
  retainConclusiveProviderState,
} from "./providerProbePolicy.ts";
import {
  hasProviderAccountBindingChanged,
  normalizedAccountBinding,
} from "./providerAccountBinding.ts";

interface ProviderSnapshotState {
  readonly snapshot: ServerProvider;
  readonly enrichmentGeneration: number;
}

interface ProviderProbeState {
  readonly attemptCount: number;
  readonly consecutiveInconclusiveCount: number;
}

/**
 * Upper bound on how long an `initialRefresh: "external"` provider waits for
 * its owner (ProviderRegistry) to admit the first probe. The registry is the
 * only admitter in production, so a registry that never runs — a build-time
 * failure, an interrupted sync, or a driver whose instance was constructed
 * outside the registry — would otherwise leave this provider permanently
 * "pending" with no periodic clock. Upstream has no such fallback.
 */
const EXTERNAL_INITIAL_REFRESH_FALLBACK_MS = 60_000;

const ACCOUNT_USAGE_REFRESH_COOLDOWN_MS = 30_000;

export interface ManagedProviderProbePolicy {
  /**
   * The ProviderRegistry owns initial refresh admission in production so it
   * can bound aggregate CLI process concurrency across configured instances.
   * Standalone users retain the historical background refresh by default.
   */
  readonly initialRefresh?: "background" | "external";
  /**
   * Bound on the wait for external admission before this provider performs
   * the background initial refresh itself. `null` restores upstream's hard
   * liveness dependency on the registry.
   */
  readonly externalInitialRefreshFallback?: Duration.Input | null;
  /**
   * Classify only protocol outcomes where the probe could not determine
   * health (for example, a bounded auth-status subprocess timing out). A
   * conclusive unauthenticated or error result must return false.
   */
  readonly isInconclusiveSnapshot?: (snapshot: ServerProvider) => boolean;
  /**
   * Known-good state is retained before this many consecutive inconclusive
   * results. The threshold is intentionally bounded so repeated failures
   * eventually become visible rather than being masked forever.
   */
  readonly inconclusiveFailureThreshold?: number;
}

const toIsoDateTime = (epochMs: number): ServerProvider["checkedAt"] =>
  new Date(epochMs).toISOString();

const advancePeriodicTargetPast = (
  scheduledAtMs: number,
  observedAtMs: number,
  intervalMs: number,
): number => {
  if (scheduledAtMs > observedAtMs) {
    return scheduledAtMs;
  }
  const missedIntervals = Math.floor((observedAtMs - scheduledAtMs) / intervalMs) + 1;
  return scheduledAtMs + missedIntervals * intervalMs;
};

const classifyProbeOutcome = (
  snapshot: ServerProvider,
  policy: ManagedProviderProbePolicy,
): ServerProviderProbeOutcome => {
  if (policy.isInconclusiveSnapshot?.(snapshot) === true) {
    return "inconclusive";
  }
  return snapshot.status;
};

interface SingleFlight<A, E> {
  readonly current: Effect.Effect<Deferred.Deferred<A, E> | null>;
  readonly run: (operation: Effect.Effect<A, E>) => Effect.Effect<A, E>;
}

type SingleFlightAdmission<A, E> =
  | { readonly deferred: Deferred.Deferred<A, E>; readonly leader: true }
  | { readonly deferred: Deferred.Deferred<A, E>; readonly leader: false };

/**
 * Share one provider probe among every caller that arrives while that probe is
 * running. A semaphore alone is insufficient here: it serializes duplicate
 * work, which means an initial refresh, a periodic refresh, and a manual
 * refresh can all execute back-to-back after one slow CLI invocation.
 *
 * The worker is forked into the managed provider's owning scope. Callers may
 * therefore stop waiting without interrupting the shared probe for all other
 * callers. The admission transition and worker fork are uninterruptible so an
 * interrupt cannot leave an uncompleted Deferred installed in `inFlightRef`;
 * the provider operation itself remains interruptible and is always converted
 * to an Exit that completes every waiter.
 */
const makeSingleFlight = <A, E>(scope: Scope.Scope): Effect.Effect<SingleFlight<A, E>> =>
  Effect.gen(function* () {
    const inFlightRef = yield* Ref.make<Deferred.Deferred<A, E> | null>(null);

    const run = (operation: Effect.Effect<A, E>): Effect.Effect<A, E> =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const candidate = yield* Deferred.make<A, E>();
          const admission = yield* Ref.modify<
            Deferred.Deferred<A, E> | null,
            SingleFlightAdmission<A, E>
          >(
            inFlightRef,
            (current): readonly [SingleFlightAdmission<A, E>, Deferred.Deferred<A, E>] => {
              if (current !== null) {
                return [{ deferred: current, leader: false }, current];
              }
              return [{ deferred: candidate, leader: true }, candidate];
            },
          );

          if (!admission.leader) {
            return yield* restore(Deferred.await(admission.deferred));
          }

          yield* Effect.exit(Effect.interruptible(operation)).pipe(
            Effect.flatMap((exit) => Deferred.done(candidate, exit)),
            Effect.ensuring(
              Ref.update(inFlightRef, (current) => (current === candidate ? null : current)),
            ),
            Effect.forkIn(scope),
          );

          return yield* restore(Deferred.await(candidate));
        }),
      );

    return {
      current: Ref.get(inFlightRef),
      run,
    };
  });

export const makeManagedServerProvider = Effect.fn("makeManagedServerProvider")(function* <
  Settings,
>(input: {
  readonly maintenanceCapabilities: ServerProviderShape["maintenanceCapabilities"];
  readonly getSettings: Effect.Effect<Settings>;
  readonly streamSettings: Stream.Stream<Settings>;
  readonly haveSettingsChanged: (previous: Settings, next: Settings) => boolean;
  readonly initialSnapshot: (settings: Settings) => Effect.Effect<ServerProvider>;
  readonly checkProvider: Effect.Effect<ServerProvider, ServerSettingsError>;
  readonly refreshAccountUsage?: (input: {
    readonly settings: Settings;
    readonly snapshot: ServerProvider;
  }) => Effect.Effect<ServerProviderAccountRateLimits | undefined, ServerSettingsError>;
  /**
   * Redeem one usage-limit reset credit for this instance. Only providers that
   * can hold redeemable credits supply this; supplying it also requires
   * `refreshAccountUsage`, which re-reads the post-redemption balance.
   */
  readonly consumeRateLimitResetCredit?: (input: {
    readonly settings: Settings;
    readonly snapshot: ServerProvider;
    readonly attemptId: string;
    readonly creditId?: string;
  }) => Effect.Effect<
    ServerProviderRateLimitResetCreditOutcome,
    ServerProviderRateLimitResetCreditError
  >;
  readonly enrichSnapshot?: (input: {
    readonly settings: Settings;
    readonly snapshot: ServerProvider;
    readonly getSnapshot: Effect.Effect<ServerProvider>;
    readonly publishSnapshot: (snapshot: ServerProvider) => Effect.Effect<void>;
  }) => Effect.Effect<void>;
  readonly refreshInterval?: Duration.Input | null;
  readonly probePolicy?: ManagedProviderProbePolicy;
}): Effect.fn.Return<ServerProviderShape, ServerSettingsError, Scope.Scope> {
  // Full probes, settings changes, and usage-only updates all mutate the same
  // snapshot. Keep those writes serialized even though duplicate calls of the
  // same operation are coalesced independently below.
  const snapshotMutationSemaphore = yield* Semaphore.make(1);
  const lastAccountUsageAttemptRef = yield* Ref.make<number | null>(null);
  const changesPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<ServerProvider>(),
    PubSub.shutdown,
  );
  const initialSettings = yield* input.getSettings;
  const rawInitialSnapshot = yield* input.initialSnapshot(initialSettings);
  const normalizedRefreshInterval =
    input.refreshInterval === null
      ? null
      : Duration.fromInputUnsafe(input.refreshInterval ?? "60 seconds");
  const refreshIntervalMs =
    normalizedRefreshInterval === null
      ? null
      : Math.max(1, Math.floor(Duration.toMillis(normalizedRefreshInterval)));
  const periodicPhaseOffsetMs =
    refreshIntervalMs === null
      ? null
      : deterministicProviderProbePhaseOffsetMs(rawInitialSnapshot.instanceId, refreshIntervalMs);
  const initialPeriodicDelayMs =
    refreshIntervalMs === null || periodicPhaseOffsetMs === null
      ? null
      : refreshIntervalMs + periodicPhaseOffsetMs;
  const waitsForExternalInitialRefresh = input.probePolicy?.initialRefresh === "external";
  const externalInitialRefreshFallback =
    input.probePolicy?.externalInitialRefreshFallback === null
      ? null
      : Duration.fromInputUnsafe(
          input.probePolicy?.externalInitialRefreshFallback ??
            Duration.millis(EXTERNAL_INITIAL_REFRESH_FALLBACK_MS),
        );
  const initializedAtMs = yield* Clock.currentTimeMillis;
  const initialPeriodicScheduledAtMs =
    initialPeriodicDelayMs === null || waitsForExternalInitialRefresh
      ? null
      : initializedAtMs + initialPeriodicDelayMs;
  const nextScheduledAtRef = yield* Ref.make<number | null>(initialPeriodicScheduledAtMs);
  const externalInitialRefreshCompletedAt = yield* Deferred.make<number>();
  const externalInitialRefreshRegisteredRef = yield* Ref.make(false);
  const probeStateRef = yield* Ref.make<ProviderProbeState>({
    attemptCount: 0,
    consecutiveInconclusiveCount: 0,
  });
  const initialSnapshot: ServerProvider = input.probePolicy
    ? {
        ...rawInitialSnapshot,
        probeDiagnostics: {
          attemptCount: 0,
          consecutiveInconclusiveCount: 0,
          lastOutcome: "pending",
          lastStartedAt: null,
          lastFinishedAt: null,
          lastDurationMs: null,
          periodicIntervalMs: refreshIntervalMs,
          periodicPhaseOffsetMs,
          nextScheduledAt:
            initialPeriodicScheduledAtMs === null
              ? null
              : toIsoDateTime(initialPeriodicScheduledAtMs),
        },
      }
    : rawInitialSnapshot;
  const snapshotStateRef = yield* Ref.make<ProviderSnapshotState>({
    snapshot: initialSnapshot,
    enrichmentGeneration: 0,
  });
  const settingsRef = yield* Ref.make(initialSettings);
  const enrichmentFiberRef = yield* Ref.make<Fiber.Fiber<void, unknown> | null>(null);
  const scope = yield* Effect.scope;
  const fullRefreshSingleFlight = yield* makeSingleFlight<ServerProvider, ServerSettingsError>(
    scope,
  );
  const accountUsageSingleFlight = yield* makeSingleFlight<ServerProvider, ServerSettingsError>(
    scope,
  );

  const publishEnrichedSnapshot = Effect.fn("publishEnrichedSnapshot")(function* (
    generation: number,
    nextSnapshot: ServerProvider,
  ) {
    const snapshotToPublish = yield* Ref.modify(snapshotStateRef, (state) => {
      if (state.enrichmentGeneration !== generation) {
        return [null, state] as const;
      }
      // Enrichment starts from the just-probed base snapshot. A pathologically
      // slow probe can make the scheduler skip one or more fixed-rate slots
      // immediately afterward; preserve that newer schedule metadata when the
      // asynchronous enrichment callback eventually lands.
      const correlatedSnapshot = state.snapshot.probeDiagnostics
        ? { ...nextSnapshot, probeDiagnostics: state.snapshot.probeDiagnostics }
        : nextSnapshot;
      if (Equal.equals(state.snapshot, correlatedSnapshot)) {
        return [null, state] as const;
      }
      return [
        correlatedSnapshot,
        {
          ...state,
          snapshot: correlatedSnapshot,
        },
      ] as const;
    });
    if (snapshotToPublish === null) {
      return;
    }
    yield* PubSub.publish(changesPubSub, snapshotToPublish);
  });

  const publishNextScheduledAt = Effect.fn("publishNextScheduledAt")(function* (
    nextScheduledAtMs: number,
  ) {
    const snapshotToPublish = yield* Ref.modify(snapshotStateRef, (state) => {
      if (!state.snapshot.probeDiagnostics) {
        return [null, state] as const;
      }
      const nextScheduledAt = toIsoDateTime(nextScheduledAtMs);
      if (state.snapshot.probeDiagnostics.nextScheduledAt === nextScheduledAt) {
        return [null, state] as const;
      }
      const nextSnapshot: ServerProvider = {
        ...state.snapshot,
        probeDiagnostics: {
          ...state.snapshot.probeDiagnostics,
          nextScheduledAt,
        },
      };
      return [nextSnapshot, { ...state, snapshot: nextSnapshot }] as const;
    });
    if (snapshotToPublish !== null) {
      yield* PubSub.publish(changesPubSub, snapshotToPublish);
    }
  });

  const registerExternalInitialRefreshCompletion = Effect.fn(
    "registerExternalInitialRefreshCompletion",
  )(function* () {
    const isFirstCompletion = yield* Ref.modify(
      externalInitialRefreshRegisteredRef,
      (alreadyRegistered) => [!alreadyRegistered, true] as const,
    );
    if (!isFirstCompletion) {
      return;
    }

    const completedAtMs = yield* Clock.currentTimeMillis;
    // Establish and publish the first periodic target before releasing either
    // the registry caller or the periodic fiber. Otherwise the schedule-only
    // stream update can race with the direct refresh return and be overwritten
    // by that return's older `nextScheduledAt: null` snapshot.
    if (initialPeriodicDelayMs !== null) {
      const scheduledAtMs = completedAtMs + initialPeriodicDelayMs;
      yield* Ref.set(nextScheduledAtRef, scheduledAtMs);
      yield* publishNextScheduledAt(scheduledAtMs);
    }
    yield* Deferred.succeed(externalInitialRefreshCompletedAt, completedAtMs).pipe(Effect.ignore);
  });

  const restartSnapshotEnrichment = Effect.fn("restartSnapshotEnrichment")(function* (
    settings: Settings,
    snapshot: ServerProvider,
    generation: number,
  ) {
    const previousFiber = yield* Ref.getAndSet(enrichmentFiberRef, null);
    if (previousFiber) {
      yield* Fiber.interrupt(previousFiber).pipe(Effect.ignore);
    }

    if (!input.enrichSnapshot) {
      return;
    }

    const fiber = yield* input
      .enrichSnapshot({
        settings,
        snapshot,
        getSnapshot: Ref.get(snapshotStateRef).pipe(Effect.map((state) => state.snapshot)),
        publishSnapshot: (nextSnapshot) => publishEnrichedSnapshot(generation, nextSnapshot),
      })
      .pipe(Effect.ignoreCause({ log: true }), Effect.forkIn(scope));

    yield* Ref.set(enrichmentFiberRef, fiber);
  });

  const applySnapshotBase = Effect.fn("applySnapshot")(function* (
    nextSettings: Settings,
    options?: { readonly forceRefresh?: boolean },
  ) {
    const forceRefresh = options?.forceRefresh === true;
    const previousSettings = yield* Ref.get(settingsRef);
    if (!forceRefresh && !input.haveSettingsChanged(previousSettings, nextSettings)) {
      yield* Ref.set(settingsRef, nextSettings);
      return yield* Ref.get(snapshotStateRef).pipe(Effect.map((state) => state.snapshot));
    }

    const startedAtMs = yield* Clock.currentTimeMillis;
    const probedSnapshot = yield* input.checkProvider;
    const finishedAtMs = yield* Clock.currentTimeMillis;
    const previousSnapshot = yield* Ref.get(snapshotStateRef).pipe(
      Effect.map((state) => state.snapshot),
    );
    // Account-usage endpoints authenticate with short-lived tokens that only
    // the provider's own CLI refreshes. A full health probe that cannot fetch
    // usage right now (e.g. Codex's ChatGPT token expired during a long
    // Claude-only session) must not erase the last known usage for the same
    // authenticated account — the sidebar marks it stale by `checkedAt` age
    // instead. Logout and account replacement still clear it, because the auth
    // identity below no longer matches. The identity comparison uses the same
    // trim/case normalization as `hasProviderAccountBindingChanged` so the two
    // account-binding decisions in this function can never disagree.
    const usageRetainedSnapshot: ServerProvider =
      probedSnapshot.accountRateLimits === undefined &&
      previousSnapshot.accountRateLimits !== undefined &&
      probedSnapshot.auth.status === "authenticated" &&
      previousSnapshot.auth.status === "authenticated" &&
      normalizedAccountBinding(probedSnapshot.auth.email) ===
        normalizedAccountBinding(previousSnapshot.auth.email) &&
      normalizedAccountBinding(probedSnapshot.auth.type) ===
        normalizedAccountBinding(previousSnapshot.auth.type)
        ? {
            ...probedSnapshot,
            accountRateLimits: previousSnapshot.accountRateLimits,
          }
        : probedSnapshot;
    const nextSnapshot: ServerProvider = input.probePolicy
      ? yield* Effect.gen(function* () {
          const probePolicy = input.probePolicy!;
          const outcome = classifyProbeOutcome(usageRetainedSnapshot, probePolicy);
          const probeState = yield* Ref.modify(probeStateRef, (previous) => {
            const next: ProviderProbeState = {
              attemptCount: previous.attemptCount + 1,
              consecutiveInconclusiveCount:
                outcome === "inconclusive" ? previous.consecutiveInconclusiveCount + 1 : 0,
            };
            return [next, next] as const;
          });
          const threshold = Math.max(
            1,
            Math.floor(
              probePolicy.inconclusiveFailureThreshold ??
                DEFAULT_PROVIDER_INCONCLUSIVE_FAILURE_THRESHOLD,
            ),
          );
          const shouldRetainConclusiveState =
            outcome === "inconclusive" &&
            probeState.consecutiveInconclusiveCount < threshold &&
            hasConclusiveProviderAuthState(previousSnapshot);
          const reconciledSnapshot = shouldRetainConclusiveState
            ? retainConclusiveProviderState(previousSnapshot, usageRetainedSnapshot)
            : usageRetainedSnapshot;
          const nextScheduledAtMs = yield* Ref.get(nextScheduledAtRef);
          const probeDiagnostics: ServerProviderProbeDiagnostics = {
            attemptCount: probeState.attemptCount,
            consecutiveInconclusiveCount: probeState.consecutiveInconclusiveCount,
            lastOutcome: outcome,
            lastStartedAt: toIsoDateTime(startedAtMs),
            lastFinishedAt: toIsoDateTime(finishedAtMs),
            lastDurationMs: Math.max(0, Math.floor(finishedAtMs - startedAtMs)),
            periodicIntervalMs: refreshIntervalMs,
            periodicPhaseOffsetMs,
            nextScheduledAt: nextScheduledAtMs === null ? null : toIsoDateTime(nextScheduledAtMs),
          };
          return {
            ...reconciledSnapshot,
            probeDiagnostics,
          } satisfies ServerProvider;
        })
      : usageRetainedSnapshot;
    // A usage attempt made while credentials are expiring or signed out must
    // not suppress the first poll after the operator signs in again. Keep the
    // cooldown for one stable account, but clear it whenever the observable
    // authentication binding changes.
    if (hasProviderAccountBindingChanged(previousSnapshot.auth, nextSnapshot.auth)) {
      yield* Ref.set(lastAccountUsageAttemptRef, null);
    }
    const nextGeneration = yield* Ref.modify(snapshotStateRef, (state) => {
      const generation = input.enrichSnapshot
        ? state.enrichmentGeneration + 1
        : state.enrichmentGeneration;
      return [
        generation,
        {
          snapshot: nextSnapshot,
          enrichmentGeneration: generation,
        },
      ] as const;
    });
    yield* Ref.set(settingsRef, nextSettings);
    yield* PubSub.publish(changesPubSub, nextSnapshot);
    yield* restartSnapshotEnrichment(nextSettings, nextSnapshot, nextGeneration);
    return nextSnapshot;
  });
  const applySnapshot = (nextSettings: Settings, options?: { readonly forceRefresh?: boolean }) =>
    snapshotMutationSemaphore.withPermits(1)(applySnapshotBase(nextSettings, options));

  const refreshSnapshot = Effect.fn("refreshSnapshot")(function* () {
    const operation = input.getSettings.pipe(
      Effect.flatMap((nextSettings) => applySnapshot(nextSettings, { forceRefresh: true })),
    );
    const externallyAdmittedOperation = waitsForExternalInitialRefresh
      ? operation.pipe(
          Effect.ensuring(registerExternalInitialRefreshCompletion()),
          // The operation's original return value was created before the
          // completion finalizer installed the periodic target. Correlate the
          // direct result with the authoritative in-memory snapshot so every
          // delivery path carries the same schedule metadata.
          Effect.andThen(Ref.get(snapshotStateRef).pipe(Effect.map((state) => state.snapshot))),
        )
      : operation;
    return yield* fullRefreshSingleFlight.run(externallyAdmittedOperation);
  });

  const applyAccountUsageBase = Effect.fn("applyAccountUsage")(function* () {
    if (!input.refreshAccountUsage) {
      return yield* Ref.get(snapshotStateRef).pipe(Effect.map((state) => state.snapshot));
    }

    const settings = yield* input.getSettings;
    const currentState = yield* Ref.get(snapshotStateRef);
    const accountRateLimits = yield* input.refreshAccountUsage({
      settings,
      snapshot: currentState.snapshot,
    });
    // A transient usage endpoint failure must not erase a known-good usage
    // snapshot. Full provider health refreshes remain authoritative for
    // clearing account-bound data after logout or account replacement.
    if (accountRateLimits === undefined) {
      return currentState.snapshot;
    }

    const nextSnapshot: ServerProvider = {
      ...currentState.snapshot,
      accountRateLimits,
    };
    if (Equal.equals(currentState.snapshot, nextSnapshot)) {
      return currentState.snapshot;
    }

    // Usage can land while asynchronous version enrichment is still working
    // from an older base snapshot. Advance the generation and restart that
    // enrichment so its eventual full-snapshot publish cannot overwrite the
    // newer account usage.
    const nextGeneration = input.enrichSnapshot
      ? currentState.enrichmentGeneration + 1
      : currentState.enrichmentGeneration;
    yield* Ref.set(snapshotStateRef, {
      snapshot: nextSnapshot,
      enrichmentGeneration: nextGeneration,
    });
    yield* PubSub.publish(changesPubSub, nextSnapshot);
    yield* restartSnapshotEnrichment(settings, nextSnapshot, nextGeneration);
    return nextSnapshot;
  });

  const refreshAccountUsageSnapshot = Effect.fn("refreshAccountUsageSnapshot")(function* () {
    // A full status refresh may include account usage. Share it first, then
    // issue a usage-only refresh only when that result is not itself fresh
    // (Claude's health probe intentionally does not scan account usage).
    const activeFullRefresh = yield* fullRefreshSingleFlight.current;
    if (activeFullRefresh !== null) {
      const refreshed = yield* Deferred.await(activeFullRefresh);
      const now = yield* Clock.currentTimeMillis;
      const checkedAt = refreshed.accountRateLimits
        ? Date.parse(refreshed.accountRateLimits.checkedAt)
        : Number.NaN;
      if (Number.isFinite(checkedAt) && now - checkedAt < ACCOUNT_USAGE_REFRESH_COOLDOWN_MS) {
        return refreshed;
      }
    }
    return yield* accountUsageSingleFlight.run(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const admitted = yield* Ref.modify(lastAccountUsageAttemptRef, (lastAttempt) =>
          lastAttempt !== null && now - lastAttempt < ACCOUNT_USAGE_REFRESH_COOLDOWN_MS
            ? ([false, lastAttempt] as const)
            : ([true, now] as const),
        );
        if (!admitted) {
          return (yield* Ref.get(snapshotStateRef)).snapshot;
        }
        return yield* snapshotMutationSemaphore.withPermits(1)(applyAccountUsageBase());
      }),
    );
  });

  const consumeRateLimitResetCredit = Effect.fn("consumeRateLimitResetCredit")(
    function* (consumeInput: { readonly attemptId: string; readonly creditId?: string }) {
      const consume = input.consumeRateLimitResetCredit;
      if (!consume) {
        // Unreachable via the shape: the capability is only exposed when the
        // driver supplies an implementation.
        return {
          outcome: "noCredit" as const,
          snapshot: (yield* Ref.get(snapshotStateRef)).snapshot,
        };
      }

      const settings = yield* input.getSettings;
      const outcome = yield* consume({
        settings,
        snapshot: (yield* Ref.get(snapshotStateRef)).snapshot,
        attemptId: consumeInput.attemptId,
        ...(consumeInput.creditId !== undefined ? { creditId: consumeInput.creditId } : {}),
      });

      // Redemption changes both the credit balance and (on `reset`) the limit
      // windows, so re-read usage directly rather than through the polling path:
      // the cooldown gate and the usage single-flight would both happily hand
      // back a snapshot read before this redemption landed.
      yield* Ref.set(lastAccountUsageAttemptRef, yield* Clock.currentTimeMillis);
      const snapshot = yield* snapshotMutationSemaphore
        .withPermits(1)(applyAccountUsageBase())
        .pipe(
          // A failed post-redemption read must not mask a completed redemption.
          // Report the outcome against the last known snapshot; the next poll
          // reconciles the balance.
          Effect.catchCause(() =>
            Ref.get(snapshotStateRef).pipe(Effect.map((state) => state.snapshot)),
          ),
        );

      return { outcome, snapshot };
    },
  );

  yield* Stream.runForEach(input.streamSettings, (nextSettings) =>
    Effect.asVoid(applySnapshot(nextSettings)),
  ).pipe(Effect.forkScoped);

  if (
    normalizedRefreshInterval !== null &&
    refreshIntervalMs !== null &&
    initialPeriodicDelayMs !== null
  ) {
    yield* Effect.gen(function* () {
      // Production Codex/Claude providers delegate their first refresh to the
      // registry's two-wide admission queue. Do not start this provider's
      // periodic clock until that admitted operation actually settles; with an
      // unbounded instance registry, construction-relative timers could
      // otherwise bypass the queue while later instances were still waiting.
      const periodicBaselineAtMs = waitsForExternalInitialRefresh
        ? yield* Deferred.await(externalInitialRefreshCompletedAt)
        : initializedAtMs;
      let scheduledAtMs = periodicBaselineAtMs + initialPeriodicDelayMs;
      while (true) {
        const beforeSleepMs = yield* Clock.currentTimeMillis;
        yield* Effect.sleep(Duration.millis(Math.max(0, scheduledAtMs - beforeSleepMs)));
        const startedAtMs = yield* Clock.currentTimeMillis;
        // Advance from the prior target, not from completion time, so probe
        // duration cannot gradually synchronize otherwise-staggered workers.
        // If the event loop or a previous probe missed whole periods, skip
        // those slots instead of launching a catch-up burst.
        let nextScheduledAtMs = advancePeriodicTargetPast(
          scheduledAtMs + refreshIntervalMs,
          startedAtMs,
          refreshIntervalMs,
        );
        yield* Ref.set(nextScheduledAtRef, nextScheduledAtMs);
        yield* refreshSnapshot().pipe(Effect.ignoreCause({ log: true }));
        const finishedAtMs = yield* Clock.currentTimeMillis;
        const advancedScheduledAtMs = advancePeriodicTargetPast(
          nextScheduledAtMs,
          finishedAtMs,
          refreshIntervalMs,
        );
        if (advancedScheduledAtMs !== nextScheduledAtMs) {
          nextScheduledAtMs = advancedScheduledAtMs;
          yield* Ref.set(nextScheduledAtRef, nextScheduledAtMs);
          // The completed probe published the pre-overrun target. Correct it
          // immediately so diagnostics describe the actual next wakeup.
          yield* publishNextScheduledAt(nextScheduledAtMs);
        }
        scheduledAtMs = nextScheduledAtMs;
      }
    }).pipe(Effect.forkScoped);
  }

  if (waitsForExternalInitialRefresh) {
    if (externalInitialRefreshFallback !== null) {
      // Liveness backstop: external admission is a coordination optimisation,
      // not a correctness requirement. If the owning registry never admits this
      // instance, fall back to the historical background refresh so the
      // provider still reports real health and still starts its periodic
      // clock. `registerExternalInitialRefreshCompletion` is idempotent and the
      // refresh is single-flighted, so a late registry admission joins the
      // in-flight probe instead of duplicating it.
      yield* Effect.gen(function* () {
        const admitted = yield* Deferred.await(externalInitialRefreshCompletedAt).pipe(
          Effect.timeoutOption(externalInitialRefreshFallback),
        );
        if (Option.isSome(admitted)) {
          return;
        }
        yield* Effect.logWarning("provider.probe.externalInitialRefreshFallback", {
          instanceId: rawInitialSnapshot.instanceId,
          waitedMs: Math.floor(Duration.toMillis(externalInitialRefreshFallback)),
        });
        yield* refreshSnapshot().pipe(Effect.ignoreCause({ log: true }));
      }).pipe(Effect.forkScoped);
    }
  } else {
    yield* refreshSnapshot().pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);
  }

  return {
    maintenanceCapabilities: input.maintenanceCapabilities,
    getSnapshot: input.getSettings.pipe(
      Effect.flatMap(applySnapshot),
      Effect.tapError(Effect.logError),
      Effect.orDie,
    ),
    refresh: refreshSnapshot().pipe(Effect.tapError(Effect.logError), Effect.orDie),
    ...(input.refreshAccountUsage
      ? {
          refreshAccountUsage: refreshAccountUsageSnapshot().pipe(
            Effect.tapError(Effect.logError),
            Effect.orDie,
          ),
        }
      : {}),
    ...(input.consumeRateLimitResetCredit
      ? { consumeRateLimitResetCredit: consumeRateLimitResetCredit }
      : {}),
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies ServerProviderShape;
});
