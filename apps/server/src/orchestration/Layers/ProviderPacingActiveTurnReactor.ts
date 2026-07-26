import type {
  EnvironmentId,
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationSession,
  ServerProvider,
  ThreadId,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { ServerEnvironment } from "../../environment/Services/ServerEnvironment.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import {
  ProviderPacingActiveTurnLifecycle,
  type ProviderPacingActiveTurnLifecycleShape,
} from "../Services/ProviderPacingActiveTurnLifecycle.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";

interface TrackedProjectedSession {
  readonly threadId: ThreadId;
  readonly session: OrchestrationSession;
}

type ActiveTurnSourceUpdate =
  | { readonly type: "providers-changed" }
  | { readonly type: "orchestration-event"; readonly event: OrchestrationEvent };

function sessionIdentity(threadId: ThreadId): string {
  return String(threadId);
}

function reconcileSafely(operation: () => void, source: "startup" | "providers" | "orchestration") {
  return Effect.sync(operation).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Provider pacing active-turn reconciliation was deferred.", {
        source,
        cause,
      }),
    ),
  );
}

/**
 * Serializes persisted orchestration session truth into active-turn leases.
 *
 * Event sequence guards make the startup snapshot authoritative over buffered
 * older events. Provider stream payloads are intentionally not trusted here:
 * the reactor re-reads ProviderRegistry's current in-memory snapshot whenever
 * a signal arrives, avoiding an older buffered full-array emission replacing
 * the exact account identity read during startup.
 */
export class ProviderPacingActiveTurnProjectionTracker {
  private readonly providers = new Map<string, ServerProvider>();
  private readonly sessions = new Map<string, TrackedProjectedSession>();
  private readonly environmentId: EnvironmentId;
  private readonly lifecycle: ProviderPacingActiveTurnLifecycleShape;
  private latestSequence = 0;

  constructor(environmentId: EnvironmentId, lifecycle: ProviderPacingActiveTurnLifecycleShape) {
    this.environmentId = environmentId;
    this.lifecycle = lifecycle;
  }

  applySnapshot(snapshot: OrchestrationReadModel, providers: ReadonlyArray<ServerProvider>): void {
    this.replaceProviders(providers);
    this.latestSequence = Math.max(this.latestSequence, snapshot.snapshotSequence);

    const authoritativeThreads = new Set<string>();
    for (const thread of snapshot.threads) {
      if (thread.deletedAt !== null || thread.session === null) continue;
      const identity = sessionIdentity(thread.id);
      authoritativeThreads.add(identity);
      this.sessions.set(identity, { threadId: thread.id, session: thread.session });
      this.noteSession(thread.id, thread.session);
    }

    for (const tracked of this.sessions.values()) {
      if (authoritativeThreads.has(sessionIdentity(tracked.threadId))) continue;
      this.sessions.delete(sessionIdentity(tracked.threadId));
      this.lifecycle.forgetThread(this.environmentId, tracked.threadId);
    }
  }

  replaceProviders(providers: ReadonlyArray<ServerProvider>): void {
    this.providers.clear();
    for (const provider of providers) {
      this.providers.set(String(provider.instanceId), provider);
    }
    for (const tracked of this.sessions.values()) {
      this.adoptIfRunning(tracked.threadId, tracked.session);
    }
  }

  applyEvent(event: OrchestrationEvent): boolean {
    if (event.sequence <= this.latestSequence) return false;
    this.latestSequence = event.sequence;

    if (event.type === "thread.session-set") {
      const identity = sessionIdentity(event.payload.threadId);
      this.sessions.set(identity, {
        threadId: event.payload.threadId,
        session: event.payload.session,
      });
      this.noteSession(event.payload.threadId, event.payload.session);
      return true;
    }

    if (event.type === "thread.deleted") {
      this.sessions.delete(sessionIdentity(event.payload.threadId));
      this.lifecycle.forgetThread(this.environmentId, event.payload.threadId);
      return true;
    }

    return false;
  }

  private noteSession(threadId: ThreadId, session: OrchestrationSession): void {
    this.lifecycle.noteProjectedSession({
      environmentId: this.environmentId,
      threadId,
      status: session.status,
    });
    this.adoptIfRunning(threadId, session);
  }

  private adoptIfRunning(threadId: ThreadId, session: OrchestrationSession): void {
    if (session.status !== "running" || session.providerInstanceId === undefined) return;
    const provider = this.providers.get(String(session.providerInstanceId));
    if (provider === undefined) return;
    this.lifecycle.adoptObservedRunning({
      environmentId: this.environmentId,
      provider,
      threadId,
    });
  }
}

/**
 * Subscribes before the startup snapshot so session transitions cannot be lost
 * between persistence hydration and hot-stream attachment.
 */
export const ProviderPacingActiveTurnReactorLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const environment = yield* ServerEnvironment;
    const providerRegistry = yield* ProviderRegistry;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
    const lifecycle = yield* ProviderPacingActiveTurnLifecycle;

    const providerSignals = yield* Stream.toQueue(
      providerRegistry.streamChanges.pipe(
        Stream.map((): ActiveTurnSourceUpdate => ({ type: "providers-changed" })),
      ),
      { capacity: "unbounded" },
    );
    const orchestrationEvents = yield* Stream.toQueue(
      orchestrationEngine.streamDomainEvents.pipe(
        Stream.map(
          (event): ActiveTurnSourceUpdate => ({
            type: "orchestration-event",
            event,
          }),
        ),
      ),
      { capacity: "unbounded" },
    );
    yield* Effect.yieldNow;

    const environmentId = yield* environment.getEnvironmentId;
    const tracker = new ProviderPacingActiveTurnProjectionTracker(environmentId, lifecycle);
    const initialProviders = yield* providerRegistry.getProviders;
    const initialSnapshot = yield* projectionSnapshotQuery.getCommandReadModel();
    yield* reconcileSafely(
      () => tracker.applySnapshot(initialSnapshot, initialProviders),
      "startup",
    );

    yield* Stream.runForEach(
      Stream.merge(Stream.fromQueue(providerSignals), Stream.fromQueue(orchestrationEvents)),
      (update) =>
        Effect.gen(function* () {
          if (update.type === "providers-changed") {
            const providers = yield* providerRegistry.getProviders;
            yield* reconcileSafely(() => tracker.replaceProviders(providers), "providers");
            return;
          }

          // A running-session transition must bind to the registry's current
          // account snapshot, not a possibly older buffered provider array.
          if (
            update.event.type === "thread.session-set" &&
            update.event.payload.session.status === "running"
          ) {
            const providers = yield* providerRegistry.getProviders;
            yield* reconcileSafely(() => tracker.replaceProviders(providers), "providers");
          }
          yield* reconcileSafely(() => tracker.applyEvent(update.event), "orchestration");
        }),
    ).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("Failed to reconcile provider pacing active-turn accounting.", { cause }),
      ),
      Effect.forkScoped,
    );
  }),
);
