import {
  CommandId,
  EnvironmentId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationSession,
  type ServerProvider,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "vitest";

import { ServerEnvironment } from "../../environment/Services/ServerEnvironment.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import type {
  ProviderPacingAcceptedLaunchInput,
  ProviderPacingActiveTurnLifecycleShape,
  ProviderPacingProjectedSessionInput,
} from "../Services/ProviderPacingActiveTurnLifecycle.ts";
import { ProviderPacingActiveTurnLifecycle } from "../Services/ProviderPacingActiveTurnLifecycle.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { createEmptyReadModel } from "../projector.ts";
import {
  ProviderPacingActiveTurnProjectionTracker,
  ProviderPacingActiveTurnReactorLive,
} from "./ProviderPacingActiveTurnReactor.ts";

const environmentId = EnvironmentId.make("environment-a");
const threadId = ThreadId.make("thread-a");
const NOW = "2026-07-26T17:00:00.000Z";

function provider(instanceId = "claude-primary"): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated", type: "oauth", email: "user@example.com" },
    checkedAt: NOW,
    models: [],
    slashCommands: [],
    skills: [],
  };
}

function session(
  status: OrchestrationSession["status"],
  providerInstanceId: string | undefined = "claude-primary",
): OrchestrationSession {
  return {
    threadId,
    status,
    providerName: "claudeAgent",
    ...(providerInstanceId === undefined
      ? {}
      : { providerInstanceId: ProviderInstanceId.make(providerInstanceId) }),
    runtimeMode: "approval-required",
    activeTurnId: status === "running" ? ("turn-a" as OrchestrationSession["activeTurnId"]) : null,
    lastError: null,
    updatedAt: NOW,
  };
}

function readModel(
  sequence: number,
  projectedSession: OrchestrationSession | null,
): OrchestrationReadModel {
  return {
    ...createEmptyReadModel(NOW),
    snapshotSequence: sequence,
    threads: [
      {
        id: threadId,
        projectId: ProjectId.make("project-a"),
        title: "Thread A",
        modelSelection: {
          instanceId: ProviderInstanceId.make("claude-primary"),
          model: "claude-sonnet",
        },
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: NOW,
        updatedAt: NOW,
        archivedAt: null,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: projectedSession,
      },
    ],
  };
}

function event(
  sequence: number,
  input:
    | { readonly type: "thread.session-set"; readonly session: OrchestrationSession }
    | { readonly type: "thread.deleted" },
): OrchestrationEvent {
  return {
    sequence,
    eventId: EventId.make(`event-${sequence}`),
    type: input.type,
    aggregateKind: "thread",
    aggregateId: threadId,
    occurredAt: NOW,
    commandId: CommandId.make(`command-${sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload:
      input.type === "thread.session-set"
        ? { threadId, session: input.session }
        : { threadId, deletedAt: NOW },
  } as OrchestrationEvent;
}

function lifecycleHarness() {
  const notes: ProviderPacingProjectedSessionInput[] = [];
  const adoptions: ProviderPacingAcceptedLaunchInput[] = [];
  const forgotten: Array<{ readonly environmentId: EnvironmentId; readonly threadId: ThreadId }> =
    [];
  const lifecycle: ProviderPacingActiveTurnLifecycleShape = {
    noteProjectedSession: (input) => notes.push(input),
    adoptAcceptedLaunch: () => {
      throw new Error("not used");
    },
    adoptObservedRunning: (input) => {
      adoptions.push(input);
      return adoptions.length === 1;
    },
    forgetThread: (forgottenEnvironmentId, forgottenThreadId) => {
      forgotten.push({
        environmentId: forgottenEnvironmentId,
        threadId: forgottenThreadId,
      });
      return true;
    },
    getCounts: () => ({ trackedSessions: notes.length, activeLeases: adoptions.length }),
    dispose: () => undefined,
  };
  return { lifecycle, notes, adoptions, forgotten };
}

describe("ProviderPacingActiveTurnProjectionTracker", () => {
  it("adopts startup-running work and ignores buffered events at the snapshot sequence", () => {
    const harness = lifecycleHarness();
    const tracker = new ProviderPacingActiveTurnProjectionTracker(environmentId, harness.lifecycle);
    tracker.applySnapshot(readModel(5, session("running")), [provider()]);

    expect(harness.notes.map((input) => input.status)).toEqual(["running"]);
    expect(harness.adoptions).toHaveLength(1);
    expect(
      tracker.applyEvent(event(5, { type: "thread.session-set", session: session("ready") })),
    ).toBe(false);
    expect(harness.notes.map((input) => input.status)).toEqual(["running"]);

    expect(
      tracker.applyEvent(event(6, { type: "thread.session-set", session: session("ready") })),
    ).toBe(true);
    expect(harness.notes.map((input) => input.status)).toEqual(["running", "ready"]);
  });

  it("waits for exact provider identity before adopting a projected running session", () => {
    const harness = lifecycleHarness();
    const tracker = new ProviderPacingActiveTurnProjectionTracker(environmentId, harness.lifecycle);
    tracker.applySnapshot(readModel(1, session("starting")), []);
    expect(harness.adoptions).toHaveLength(0);

    tracker.applyEvent(event(2, { type: "thread.session-set", session: session("running") }));
    expect(harness.adoptions).toHaveLength(0);

    tracker.replaceProviders([provider()]);
    expect(harness.adoptions).toHaveLength(1);
    expect(harness.adoptions[0]?.provider.instanceId).toBe("claude-primary");
  });

  it("releases lifecycle accounting when a thread is deleted", () => {
    const harness = lifecycleHarness();
    const tracker = new ProviderPacingActiveTurnProjectionTracker(environmentId, harness.lifecycle);
    tracker.applySnapshot(readModel(2, session("running")), [provider()]);

    expect(tracker.applyEvent(event(3, { type: "thread.deleted" }))).toBe(true);
    expect(harness.forgotten).toEqual([{ environmentId, threadId }]);
  });

  it("reconciles a thread omitted by a later authoritative snapshot", () => {
    const harness = lifecycleHarness();
    const tracker = new ProviderPacingActiveTurnProjectionTracker(environmentId, harness.lifecycle);
    tracker.applySnapshot(readModel(2, session("running")), [provider()]);
    tracker.applySnapshot({ ...createEmptyReadModel(NOW), snapshotSequence: 3 }, [provider()]);

    expect(harness.forgotten).toEqual([{ environmentId, threadId }]);
  });
});

it("subscribes before startup hydration and applies later persisted session truth", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const orchestrationEvents = yield* PubSub.unbounded<OrchestrationEvent>();
        const providerChanges = yield* PubSub.unbounded<ReadonlyArray<ServerProvider>>();
        const harness = lifecycleHarness();
        const dependencies = Layer.mergeAll(
          Layer.mock(ServerEnvironment)({
            getEnvironmentId: Effect.succeed(environmentId),
          }),
          Layer.mock(ProviderRegistry)({
            getProviders: Effect.succeed([provider()]),
            streamChanges: Stream.fromPubSub(providerChanges),
          }),
          Layer.mock(OrchestrationEngineService)({
            streamDomainEvents: Stream.fromPubSub(orchestrationEvents),
          }),
          Layer.mock(ProjectionSnapshotQuery)({
            getCommandReadModel: () => Effect.succeed(readModel(1, session("running"))),
          }),
          Layer.succeed(ProviderPacingActiveTurnLifecycle, harness.lifecycle),
        );

        yield* Layer.build(ProviderPacingActiveTurnReactorLive.pipe(Layer.provide(dependencies)));
        expect(harness.adoptions).toHaveLength(1);

        yield* PubSub.publish(
          orchestrationEvents,
          event(2, { type: "thread.session-set", session: session("ready") }),
        );
        for (
          let attempt = 0;
          attempt < 20 && harness.notes.at(-1)?.status !== "ready";
          attempt += 1
        ) {
          yield* Effect.yieldNow;
        }
        expect(harness.notes.at(-1)?.status).toBe("ready");
      }),
    ),
  );
});
