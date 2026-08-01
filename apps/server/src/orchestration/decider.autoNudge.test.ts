import {
  CheckpointRef,
  CommandId,
  DEFAULT_THREAD_AUTO_NUDGE_CONFIG,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  THREAD_AUTO_NUDGE_MAX_AUTHORITY_REVISION,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
  type ThreadAutoNudgeConfig,
} from "@cafecode/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const SERVER_NOW = "2026-07-28T12:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-auto-nudge");
const THREAD_A = ThreadId.make("thread-auto-nudge-a");
const THREAD_B = ThreadId.make("thread-auto-nudge-b");
const TURN_BASELINE = TurnId.make("turn-baseline");
const TURN_COMPLETED = TurnId.make("turn-completed");

const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-sol",
} as const;

function makeCompletedTurn(turnId: TurnId, completedAt = SERVER_NOW) {
  return {
    turnId,
    state: "completed" as const,
    requestedAt: completedAt,
    startedAt: completedAt,
    completedAt,
    assistantMessageId: null,
  };
}

function makeThread(input: {
  readonly id: ThreadId;
  readonly autoNudge?: ThreadAutoNudgeConfig;
  readonly latestTurnId?: TurnId;
  readonly archivedAt?: string | null;
  readonly deletedAt?: string | null;
}): OrchestrationThread {
  return {
    id: input.id,
    projectId: PROJECT_ID,
    title: `Thread ${input.id}`,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    autoNudge: input.autoNudge ?? DEFAULT_THREAD_AUTO_NUDGE_CONFIG,
    manualFollowUps: [],
    latestTurn: input.latestTurnId === undefined ? null : makeCompletedTurn(input.latestTurnId),
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    archivedAt: input.archivedAt ?? null,
    deletedAt: input.deletedAt ?? null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
  };
}

function makeReadModel(threads: ReadonlyArray<OrchestrationThread>): OrchestrationReadModel {
  return {
    snapshotSequence: 10,
    updatedAt: SERVER_NOW,
    projects: [
      {
        id: PROJECT_ID,
        title: "Auto Nudge project",
        workspaceRoot: "/tmp/auto-nudge",
        defaultModelSelection: modelSelection,
        scripts: [],
        createdAt: "2026-07-28T00:00:00.000Z",
        updatedAt: "2026-07-28T00:00:00.000Z",
        deletedAt: null,
      },
    ],
    threads,
  };
}

type PlannedEvent = OrchestrationEvent extends infer Event
  ? Event extends OrchestrationEvent
    ? Omit<Event, "sequence">
    : never
  : never;

function asPlannedEvents(result: unknown): ReadonlyArray<PlannedEvent> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<PlannedEvent>;
  }
  if (typeof result === "object" && result !== null && "type" in result) {
    return [result as PlannedEvent];
  }
  throw new Error("Expected one or more planned orchestration events.");
}

const projectPlannedEvents = Effect.fn("projectPlannedAutoNudgeEvents")(function* (
  readModel: OrchestrationReadModel,
  events: ReadonlyArray<PlannedEvent>,
) {
  let next = readModel;
  let sequence = readModel.snapshotSequence;
  for (const event of events) {
    sequence += 1;
    next = yield* projectEvent(next, { ...event, sequence } as OrchestrationEvent);
  }
  return next;
});

function enabledConfig(
  overrides: Partial<Exclude<ThreadAutoNudgeConfig, { mode: "off" }>> = {},
): ThreadAutoNudgeConfig {
  return {
    authorityRevision: 5,
    mode: "steady-progress",
    prompt: "Prompt owned by thread A",
    backgroundContinuation: false,
    maxRounds: 5,
    armedAt: "2026-07-28T11:59:00.000Z",
    baselineSettledTurnId: TURN_BASELINE,
    lastDispatchedSettledTurnId: null,
    roundsDispatched: 0,
    lastDispatchedAt: null,
    ...overrides,
  };
}

it.effect("saves Off text for one exact thread without granting dispatch authority", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(SERVER_NOW));
    const initial = makeReadModel([
      makeThread({ id: THREAD_A, latestTurnId: TURN_COMPLETED }),
      makeThread({ id: THREAD_B, latestTurnId: TURN_COMPLETED }),
    ]);

    const configured = yield* decideOrchestrationCommand({
      readModel: initial,
      command: {
        type: "thread.auto-nudge.configure",
        commandId: CommandId.make("command-save-off"),
        threadId: THREAD_A,
        expectedAuthorityRevision: 0,
        mode: "off",
        prompt: "Saved while disabled",
        backgroundContinuation: false,
        maxRounds: 8,
        createdAt: "2000-01-01T00:00:00.000Z",
      },
    });
    const events = asPlannedEvents(configured);
    assert.equal(events.length, 1);
    const event = events[0];
    assert.equal(event?.type, "thread.auto-nudge-configured");
    if (event?.type !== "thread.auto-nudge-configured") {
      return yield* Effect.die("Expected an Auto Nudge configured event.");
    }
    assert.equal(event.occurredAt, SERVER_NOW);
    assert.deepEqual(event.payload.config, {
      authorityRevision: 1,
      mode: "off",
      prompt: "Saved while disabled",
      backgroundContinuation: false,
      maxRounds: 8,
      armedAt: null,
      baselineSettledTurnId: null,
      lastDispatchedSettledTurnId: null,
      roundsDispatched: 0,
      lastDispatchedAt: null,
    });

    const projected = yield* projectPlannedEvents(initial, events);
    assert.equal(
      projected.threads.find((thread) => thread.id === THREAD_A)?.autoNudge.prompt,
      "Saved while disabled",
    );
    assert.deepEqual(
      projected.threads.find((thread) => thread.id === THREAD_B)?.autoNudge,
      DEFAULT_THREAD_AUTO_NUDGE_CONFIG,
    );

    const dispatchFailure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: projected,
        command: {
          type: "thread.auto-nudge.dispatch",
          commandId: CommandId.make("command-dispatch-off"),
          threadId: THREAD_A,
          expectedAuthorityRevision: 1,
          completedTurnId: TURN_COMPLETED,
          dispatchSource: "foreground",
          messageId: MessageId.make("message-dispatch-off"),
          createdAt: SERVER_NOW,
        },
      }),
    );
    assert.match(dispatchFailure.detail, /is off/);
  }),
);

it.effect("rejects generic turn commands that claim Auto Nudge provenance", () =>
  Effect.gen(function* () {
    const readModel = makeReadModel([makeThread({ id: THREAD_A, latestTurnId: TURN_COMPLETED })]);
    const genericCommands = [
      {
        type: "thread.turn.start",
        commandId: CommandId.make("command-forged-auto-nudge-start"),
        threadId: THREAD_A,
        message: {
          messageId: MessageId.make("message-forged-auto-nudge-start"),
          role: "user",
          text: "Bypass exact-thread authority",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        dispatchSource: "auto-nudge",
        createdAt: SERVER_NOW,
      },
      {
        type: "thread.turn.steer",
        commandId: CommandId.make("command-forged-auto-nudge-steer"),
        threadId: THREAD_A,
        message: {
          messageId: MessageId.make("message-forged-auto-nudge-steer"),
          role: "user",
          text: "Bypass exact-thread authority",
          attachments: [],
        },
        dispatchSource: "auto-nudge",
        createdAt: SERVER_NOW,
      },
    ] satisfies ReadonlyArray<OrchestrationCommand>;

    for (const command of genericCommands) {
      const failure = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel,
          command,
        }),
      );
      assert.match(failure.detail, /must use exact-thread Auto Nudge dispatch authority/);
    }
  }),
);

it.effect("uses revision-checked configuration and a server-authored arming timestamp", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(SERVER_NOW));
    const initial = makeReadModel([
      makeThread({ id: THREAD_A, latestTurnId: TURN_COMPLETED }),
      makeThread({ id: THREAD_B, latestTurnId: TURN_COMPLETED }),
    ]);

    const configured = yield* decideOrchestrationCommand({
      readModel: initial,
      command: {
        type: "thread.auto-nudge.configure",
        commandId: CommandId.make("command-enable"),
        threadId: THREAD_A,
        expectedAuthorityRevision: 0,
        mode: "steady-progress",
        prompt: "Thread A only\nKeep moving",
        backgroundContinuation: true,
        maxRounds: 5,
        createdAt: "2099-01-01T00:00:00.000Z",
      },
    });
    const event = asPlannedEvents(configured)[0];
    assert.equal(event?.type, "thread.auto-nudge-configured");
    if (event?.type !== "thread.auto-nudge-configured") {
      return yield* Effect.die("Expected an Auto Nudge configured event.");
    }
    assert.equal(event.payload.config.armedAt, SERVER_NOW);
    assert.equal(event.payload.config.baselineSettledTurnId, TURN_COMPLETED);

    const projected = yield* projectPlannedEvents(initial, [event]);
    const staleFailure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: projected,
        command: {
          type: "thread.auto-nudge.configure",
          commandId: CommandId.make("command-stale-config"),
          threadId: THREAD_A,
          expectedAuthorityRevision: 0,
          mode: "off",
          prompt: "",
          backgroundContinuation: false,
          maxRounds: 5,
          createdAt: SERVER_NOW,
        },
      }),
    );
    assert.match(staleFailure.detail, /revision.*stale/i);
  }),
);

it.effect("dispatches only the persisted exact-thread prompt and rejects duplicate/cap lanes", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(SERVER_NOW));
    const initial = makeReadModel([
      makeThread({
        id: THREAD_A,
        latestTurnId: TURN_COMPLETED,
        autoNudge: enabledConfig(),
      }),
      makeThread({
        id: THREAD_B,
        latestTurnId: TURN_COMPLETED,
        autoNudge: enabledConfig({
          authorityRevision: 9,
          prompt: "Thread B secret",
        }),
      }),
    ]);

    const dispatched = yield* decideOrchestrationCommand({
      readModel: initial,
      command: {
        type: "thread.auto-nudge.dispatch",
        commandId: CommandId.make("command-dispatch"),
        threadId: THREAD_A,
        expectedAuthorityRevision: 5,
        completedTurnId: TURN_COMPLETED,
        dispatchSource: "foreground",
        messageId: MessageId.make("message-dispatch"),
        createdAt: "2000-01-01T00:00:00.000Z",
      },
    });
    const events = asPlannedEvents(dispatched);
    assert.deepEqual(
      events.map((event) => event.type),
      ["thread.auto-nudge-dispatched", "thread.message-sent", "thread.turn-start-requested"],
    );
    const messageEvent = events[1];
    assert.equal(messageEvent?.type, "thread.message-sent");
    if (messageEvent?.type !== "thread.message-sent") {
      return yield* Effect.die("Expected an Auto Nudge user message.");
    }
    assert.equal(messageEvent.payload.text, "Prompt owned by thread A");
    assert.equal(messageEvent.payload.createdAt, SERVER_NOW);
    assert.isFalse(JSON.stringify(events).includes("Thread B secret"));
    const turnStartEvent = events[2];
    assert.equal(turnStartEvent?.type, "thread.turn-start-requested");
    if (turnStartEvent?.type === "thread.turn-start-requested") {
      assert.equal(turnStartEvent.payload.dispatchSource, "auto-nudge");
    }

    const duplicateFailure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          makeThread({
            id: THREAD_A,
            latestTurnId: TURN_COMPLETED,
            autoNudge: enabledConfig({
              lastDispatchedSettledTurnId: TURN_COMPLETED,
              roundsDispatched: 1,
            }),
          }),
        ]),
        command: {
          type: "thread.auto-nudge.dispatch",
          commandId: CommandId.make("command-duplicate-dispatch"),
          threadId: THREAD_A,
          expectedAuthorityRevision: 5,
          completedTurnId: TURN_COMPLETED,
          dispatchSource: "foreground",
          messageId: MessageId.make("message-duplicate-dispatch"),
          createdAt: SERVER_NOW,
        },
      }),
    );
    assert.match(duplicateFailure.detail, /already dispatched/);

    const backgroundFailure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: initial,
        command: {
          type: "thread.auto-nudge.dispatch",
          commandId: CommandId.make("command-background-dispatch"),
          threadId: THREAD_A,
          expectedAuthorityRevision: 5,
          completedTurnId: TURN_COMPLETED,
          dispatchSource: "background",
          messageId: MessageId.make("message-background-dispatch"),
          createdAt: SERVER_NOW,
        },
      }),
    );
    assert.match(backgroundFailure.detail, /Background Auto Nudge is not enabled/);

    const capFailure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          makeThread({
            id: THREAD_A,
            latestTurnId: TURN_COMPLETED,
            autoNudge: enabledConfig({ maxRounds: 1, roundsDispatched: 1 }),
          }),
        ]),
        command: {
          type: "thread.auto-nudge.dispatch",
          commandId: CommandId.make("command-round-cap"),
          threadId: THREAD_A,
          expectedAuthorityRevision: 5,
          completedTurnId: TURN_COMPLETED,
          dispatchSource: "foreground",
          messageId: MessageId.make("message-round-cap"),
          createdAt: SERVER_NOW,
        },
      }),
    );
    assert.match(capFailure.detail, /round cap is exhausted/);

    const collisionThread = makeThread({
      id: THREAD_A,
      latestTurnId: TURN_COMPLETED,
      autoNudge: enabledConfig(),
    });
    const collisionFailure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          {
            ...collisionThread,
            messages: [
              {
                id: MessageId.make("message-collision"),
                role: "user",
                text: "existing",
                turnId: null,
                streaming: false,
                createdAt: SERVER_NOW,
                updatedAt: SERVER_NOW,
              },
            ],
          },
        ]),
        command: {
          type: "thread.auto-nudge.dispatch",
          commandId: CommandId.make("command-message-collision"),
          threadId: THREAD_A,
          expectedAuthorityRevision: 5,
          completedTurnId: TURN_COMPLETED,
          dispatchSource: "foreground",
          messageId: MessageId.make("message-collision"),
          createdAt: SERVER_NOW,
        },
      }),
    );
    assert.match(collisionFailure.detail, /already exists/);
  }),
);

it.effect("invalidates dispatch when provider text or activity continues after completion", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(SERVER_NOW));
    const dispatchCommand = {
      type: "thread.auto-nudge.dispatch",
      commandId: CommandId.make("command-post-completion-activity"),
      threadId: THREAD_A,
      expectedAuthorityRevision: 5,
      completedTurnId: TURN_COMPLETED,
      dispatchSource: "foreground",
      messageId: MessageId.make("message-post-completion-activity"),
      createdAt: SERVER_NOW,
    } satisfies Extract<OrchestrationCommand, { type: "thread.auto-nudge.dispatch" }>;
    const baseThread = makeThread({
      id: THREAD_A,
      latestTurnId: TURN_COMPLETED,
      autoNudge: enabledConfig(),
    });

    const streamingFailure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          {
            ...baseThread,
            messages: [
              {
                id: MessageId.make("message-late-stream"),
                role: "assistant",
                text: "Provider output is still arriving",
                turnId: TURN_COMPLETED,
                streaming: true,
                createdAt: SERVER_NOW,
                updatedAt: "2026-07-28T12:00:01.000Z",
              },
            ],
          },
        ]),
        command: dispatchCommand,
      }),
    );
    assert.match(streamingFailure.detail, /text or activity continued/i);

    const replacementFailure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          {
            ...baseThread,
            messages: [
              {
                id: MessageId.make("message-late-replacement"),
                role: "assistant",
                text: "Provider replaced its final response",
                turnId: TURN_COMPLETED,
                streaming: false,
                createdAt: SERVER_NOW,
                updatedAt: "2026-07-28T12:00:01.000Z",
              },
            ],
          },
        ]),
        command: {
          ...dispatchCommand,
          commandId: CommandId.make("command-late-replacement"),
          messageId: MessageId.make("message-dispatch-after-replacement"),
        },
      }),
    );
    assert.match(replacementFailure.detail, /text or activity continued/i);

    const activityFailure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          {
            ...baseThread,
            activities: [
              {
                id: EventId.make("activity-late-tool"),
                tone: "tool",
                kind: "tool.updated",
                summary: "Command is still producing output",
                payload: {},
                turnId: TURN_COMPLETED,
                createdAt: "2026-07-28T12:00:01.000Z",
              },
            ],
          },
        ]),
        command: {
          ...dispatchCommand,
          commandId: CommandId.make("command-late-activity"),
          messageId: MessageId.make("message-dispatch-after-activity"),
        },
      }),
    );
    assert.match(activityFailure.detail, /text or activity continued/i);

    const simultaneousFailure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          {
            ...baseThread,
            activities: [
              {
                id: EventId.make("activity-simultaneous-tool"),
                tone: "tool",
                kind: "tool.updated",
                summary: "Command activity shares the completion timestamp",
                payload: {},
                turnId: TURN_COMPLETED,
                createdAt: SERVER_NOW,
              },
            ],
          },
        ]),
        command: {
          ...dispatchCommand,
          commandId: CommandId.make("command-simultaneous-activity"),
          messageId: MessageId.make("message-dispatch-after-simultaneous-activity"),
        },
      }),
    );
    assert.match(simultaneousFailure.detail, /text or activity continued/i);

    const unaffectedDispatch = yield* decideOrchestrationCommand({
      readModel: makeReadModel([
        {
          ...baseThread,
          messages: [
            {
              id: MessageId.make("message-settled-before-completion"),
              role: "assistant",
              text: "Settled provider response",
              turnId: TURN_COMPLETED,
              // Some lifecycle paths close the provider turn before the
              // lightweight command projection observes the matching message
              // replacement. The terminal boundary still settles an older
              // streaming row; only text at/after that boundary invalidates
              // Auto Nudge.
              streaming: true,
              createdAt: "2026-07-28T11:59:58.000Z",
              updatedAt: "2026-07-28T11:59:59.000Z",
            },
          ],
          activities: [
            {
              id: EventId.make("activity-completed-at-boundary"),
              tone: "tool",
              kind: "tool.completed",
              summary: "Command completed",
              payload: {},
              turnId: TURN_COMPLETED,
              createdAt: SERVER_NOW,
            },
            {
              id: EventId.make("activity-late-context-window"),
              tone: "info",
              kind: "context-window.updated",
              summary: "Context window updated",
              payload: {},
              turnId: TURN_COMPLETED,
              createdAt: "2026-07-28T12:00:01.000Z",
            },
            {
              id: EventId.make("activity-late-checkpoint"),
              tone: "info",
              kind: "checkpoint.captured",
              summary: "Checkpoint captured",
              payload: {},
              turnId: TURN_COMPLETED,
              createdAt: "2026-07-28T12:00:02.000Z",
            },
          ],
        },
      ]),
      command: {
        ...dispatchCommand,
        commandId: CommandId.make("command-settled-activity"),
        messageId: MessageId.make("message-settled-activity"),
      },
    });
    assert.deepEqual(
      asPlannedEvents(unaffectedDispatch).map((event) => event.type),
      ["thread.auto-nudge-dispatched", "thread.message-sent", "thread.turn-start-requested"],
    );
  }),
);

it.effect("rejects stale, baseline, non-current, unsettled, and inactive dispatch authority", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(SERVER_NOW));
    const baseCommand = {
      type: "thread.auto-nudge.dispatch",
      commandId: CommandId.make("command-authority-check"),
      threadId: THREAD_A,
      expectedAuthorityRevision: 5,
      completedTurnId: TURN_COMPLETED,
      dispatchSource: "foreground",
      messageId: MessageId.make("message-authority-check"),
      createdAt: SERVER_NOW,
    } satisfies Extract<OrchestrationCommand, { type: "thread.auto-nudge.dispatch" }>;

    const staleRevision = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          makeThread({
            id: THREAD_A,
            latestTurnId: TURN_COMPLETED,
            autoNudge: enabledConfig(),
          }),
        ]),
        command: {
          ...baseCommand,
          commandId: CommandId.make("command-stale-authority"),
          expectedAuthorityRevision: 4,
        },
      }),
    );
    assert.match(staleRevision.detail, /revision.*stale/i);

    const baseline = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          makeThread({
            id: THREAD_A,
            latestTurnId: TURN_COMPLETED,
            autoNudge: enabledConfig({ baselineSettledTurnId: TURN_COMPLETED }),
          }),
        ]),
        command: {
          ...baseCommand,
          commandId: CommandId.make("command-baseline-authority"),
        },
      }),
    );
    assert.match(baseline.detail, /baseline turn/);

    const nonCurrent = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          makeThread({
            id: THREAD_A,
            latestTurnId: TURN_COMPLETED,
            autoNudge: enabledConfig(),
          }),
        ]),
        command: {
          ...baseCommand,
          commandId: CommandId.make("command-non-current-authority"),
          completedTurnId: TURN_BASELINE,
        },
      }),
    );
    assert.match(nonCurrent.detail, /exact current completed turn/);

    const unsettledThread = makeThread({
      id: THREAD_A,
      latestTurnId: TURN_COMPLETED,
      autoNudge: enabledConfig(),
    });
    const unsettled = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          {
            ...unsettledThread,
            session: {
              threadId: THREAD_A,
              status: "starting",
              providerName: "codex",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: SERVER_NOW,
            },
          },
        ]),
        command: {
          ...baseCommand,
          commandId: CommandId.make("command-unsettled-authority"),
        },
      }),
    );
    assert.match(unsettled.detail, /pending or running provider work/);

    const archived = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          makeThread({
            id: THREAD_A,
            latestTurnId: TURN_COMPLETED,
            autoNudge: enabledConfig(),
            archivedAt: SERVER_NOW,
          }),
        ]),
        command: {
          ...baseCommand,
          commandId: CommandId.make("command-archived-authority"),
        },
      }),
    );
    assert.match(archived.detail, /archived/i);

    const deleted = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: makeReadModel([
          makeThread({
            id: THREAD_A,
            latestTurnId: TURN_COMPLETED,
            autoNudge: enabledConfig(),
            deletedAt: SERVER_NOW,
          }),
        ]),
        command: {
          ...baseCommand,
          commandId: CommandId.make("command-deleted-authority"),
        },
      }),
    );
    assert.match(deleted.detail, /Recycle Bin/);
  }),
);

it.effect("permits background dispatch only when the exact thread grants it", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(SERVER_NOW));
    const dispatched = yield* decideOrchestrationCommand({
      readModel: makeReadModel([
        makeThread({
          id: THREAD_A,
          latestTurnId: TURN_COMPLETED,
          autoNudge: enabledConfig({ backgroundContinuation: true }),
        }),
      ]),
      command: {
        type: "thread.auto-nudge.dispatch",
        commandId: CommandId.make("command-background-authorized"),
        threadId: THREAD_A,
        expectedAuthorityRevision: 5,
        completedTurnId: TURN_COMPLETED,
        dispatchSource: "background",
        messageId: MessageId.make("message-background-authorized"),
        createdAt: SERVER_NOW,
      },
    });
    const events = asPlannedEvents(dispatched);
    assert.equal(events[0]?.type, "thread.auto-nudge-dispatched");
    if (events[0]?.type === "thread.auto-nudge-dispatched") {
      assert.equal(events[0].payload.dispatchSource, "background");
    }
  }),
);

it.effect("advances every distinct Stop so an in-flight Off configure cannot re-arm later", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(SERVER_NOW));
    const initial = makeReadModel([
      makeThread({
        id: THREAD_A,
        latestTurnId: TURN_COMPLETED,
        autoNudge: enabledConfig({ authorityRevision: 5 }),
      }),
    ]);
    const firstStop = yield* decideOrchestrationCommand({
      readModel: initial,
      command: {
        type: "thread.auto-nudge.stop",
        commandId: CommandId.make("command-stop-first"),
        threadId: THREAD_A,
        createdAt: SERVER_NOW,
      },
    });
    const firstStopEvents = asPlannedEvents(firstStop);
    assert.equal(firstStopEvents[0]?.type, "thread.auto-nudge-stopped");
    if (firstStopEvents[0]?.type === "thread.auto-nudge-stopped") {
      assert.equal(firstStopEvents[0].payload.authorityRevision, 6);
    }
    const stopped = yield* projectPlannedEvents(initial, firstStopEvents);

    const repeatedStop = yield* decideOrchestrationCommand({
      readModel: stopped,
      command: {
        type: "thread.auto-nudge.stop",
        commandId: CommandId.make("command-stop-repeated"),
        threadId: THREAD_A,
        createdAt: SERVER_NOW,
      },
    });
    const repeatedStopEvents = asPlannedEvents(repeatedStop);
    assert.equal(repeatedStopEvents[0]?.type, "thread.auto-nudge-stopped");
    if (repeatedStopEvents[0]?.type === "thread.auto-nudge-stopped") {
      assert.equal(repeatedStopEvents[0].payload.authorityRevision, 7);
    }
    const repeatedlyStopped = yield* projectPlannedEvents(stopped, repeatedStopEvents);
    assert.equal(repeatedlyStopped.threads[0]?.autoNudge.authorityRevision, 7);

    const staleConfigure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: repeatedlyStopped,
        command: {
          type: "thread.auto-nudge.configure",
          commandId: CommandId.make("command-configure-after-stop-stale"),
          threadId: THREAD_A,
          expectedAuthorityRevision: 5,
          mode: "steady-progress",
          prompt: "must not re-arm",
          backgroundContinuation: false,
          maxRounds: 5,
          createdAt: SERVER_NOW,
        },
      }),
    );
    assert.match(staleConfigure.detail, /revision.*stale/i);

    const initiallyOff = makeReadModel([
      makeThread({
        id: THREAD_B,
        latestTurnId: TURN_COMPLETED,
        autoNudge: {
          ...DEFAULT_THREAD_AUTO_NUDGE_CONFIG,
          authorityRevision: 12,
          prompt: "saved while off",
        },
      }),
    ]);
    const stopBeforeConfigure = yield* decideOrchestrationCommand({
      readModel: initiallyOff,
      command: {
        type: "thread.auto-nudge.stop",
        commandId: CommandId.make("command-stop-before-inflight-configure"),
        threadId: THREAD_B,
        createdAt: SERVER_NOW,
      },
    });
    const stoppedBeforeConfigure = yield* projectPlannedEvents(
      initiallyOff,
      asPlannedEvents(stopBeforeConfigure),
    );
    assert.equal(stoppedBeforeConfigure.threads[0]?.autoNudge.authorityRevision, 13);
    const inFlightConfigure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: stoppedBeforeConfigure,
        command: {
          type: "thread.auto-nudge.configure",
          commandId: CommandId.make("command-inflight-configure-after-stop"),
          threadId: THREAD_B,
          expectedAuthorityRevision: 12,
          mode: "steady-progress",
          prompt: "must remain revoked",
          backgroundContinuation: true,
          maxRounds: 5,
          createdAt: SERVER_NOW,
        },
      }),
    );
    assert.match(inFlightConfigure.detail, /revision.*stale/i);

    const staleDispatch = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: repeatedlyStopped,
        command: {
          type: "thread.auto-nudge.dispatch",
          commandId: CommandId.make("command-dispatch-after-stop-stale"),
          threadId: THREAD_A,
          expectedAuthorityRevision: 5,
          completedTurnId: TURN_COMPLETED,
          dispatchSource: "foreground",
          messageId: MessageId.make("message-dispatch-after-stop-stale"),
          createdAt: SERVER_NOW,
        },
      }),
    );
    assert.match(staleDispatch.detail, /is off/);
  }),
);

it.effect("always honors Stop and lifecycle revocation at max revision", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(SERVER_NOW));
    const atMax = enabledConfig({
      authorityRevision: THREAD_AUTO_NUDGE_MAX_AUTHORITY_REVISION,
      prompt: "Preserve this saved prompt",
      backgroundContinuation: true,
    });
    const initial = makeReadModel([
      makeThread({ id: THREAD_A, latestTurnId: TURN_COMPLETED, autoNudge: atMax }),
    ]);

    const stopped = yield* decideOrchestrationCommand({
      readModel: initial,
      command: {
        type: "thread.auto-nudge.stop",
        commandId: CommandId.make("command-stop-max"),
        threadId: THREAD_A,
        createdAt: "2000-01-01T00:00:00.000Z",
      },
    });
    const stopEvents = asPlannedEvents(stopped);
    const stoppedModel = yield* projectPlannedEvents(initial, stopEvents);
    const stoppedConfig = stoppedModel.threads[0]?.autoNudge;
    assert.equal(stoppedConfig?.mode, "off");
    assert.equal(stoppedConfig?.authorityRevision, THREAD_AUTO_NUDGE_MAX_AUTHORITY_REVISION);
    assert.equal(stoppedConfig?.prompt, "Preserve this saved prompt");
    assert.equal(stoppedConfig?.backgroundContinuation, false);

    const archived = yield* decideOrchestrationCommand({
      readModel: initial,
      command: {
        type: "thread.archive",
        commandId: CommandId.make("command-archive-max"),
        threadId: THREAD_A,
      },
    });
    assert.deepEqual(
      asPlannedEvents(archived).map((event) => event.type),
      ["thread.auto-nudge-stopped", "thread.archived"],
    );

    const deleted = yield* decideOrchestrationCommand({
      readModel: initial,
      command: {
        type: "thread.delete",
        commandId: CommandId.make("command-delete-max"),
        threadId: THREAD_A,
      },
    });
    assert.deepEqual(
      asPlannedEvents(deleted).map((event) => event.type),
      ["thread.auto-nudge-stopped", "thread.deleted"],
    );
  }),
);

it.effect("duplicates thread context without copying Auto Nudge authority", () =>
  Effect.gen(function* () {
    const initial = makeReadModel([
      makeThread({
        id: THREAD_A,
        latestTurnId: TURN_COMPLETED,
        autoNudge: enabledConfig(),
      }),
    ]);
    const duplicate = yield* decideOrchestrationCommand({
      readModel: initial,
      command: {
        type: "thread.duplicate",
        commandId: CommandId.make("command-duplicate"),
        sourceThreadId: THREAD_A,
        targetThreadId: THREAD_B,
        title: "Duplicated thread",
        createdAt: SERVER_NOW,
      },
    });
    const projected = yield* projectPlannedEvents(initial, asPlannedEvents(duplicate));
    assert.deepEqual(
      projected.threads.find((thread) => thread.id === THREAD_B)?.autoNudge,
      DEFAULT_THREAD_AUTO_NUDGE_CONFIG,
    );
  }),
);

it.effect("revokes Auto Nudge before a checkpoint rewind can expose a consumed turn", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(SERVER_NOW));
    const consumedTurn = TurnId.make("turn-consumed-before-rewind");
    const initial = makeReadModel([
      makeThread({
        id: THREAD_A,
        latestTurnId: TURN_COMPLETED,
        autoNudge: enabledConfig({
          lastDispatchedSettledTurnId: TURN_COMPLETED,
          roundsDispatched: 2,
        }),
      }),
    ]);

    const rewind = yield* decideOrchestrationCommand({
      readModel: initial,
      command: {
        type: "thread.checkpoint.revert",
        commandId: CommandId.make("command-auto-nudge-rewind"),
        threadId: THREAD_A,
        turnCount: 1,
        createdAt: SERVER_NOW,
      },
    });
    assert.deepEqual(
      asPlannedEvents(rewind).map((event) => event.type),
      ["thread.auto-nudge-stopped", "thread.checkpoint-revert-requested"],
    );
    const stopEvent = asPlannedEvents(rewind)[0];
    if (stopEvent === undefined) {
      return yield* Effect.die("Expected checkpoint rewind to revoke Auto Nudge.");
    }
    const stopped = yield* projectPlannedEvents(initial, [stopEvent]);
    const rewound = {
      ...stopped,
      threads: stopped.threads.map((thread) =>
        thread.id === THREAD_A
          ? Object.assign({}, thread, { latestTurn: makeCompletedTurn(consumedTurn) })
          : thread,
      ),
    };
    const failure = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel: rewound,
        command: {
          type: "thread.auto-nudge.dispatch",
          commandId: CommandId.make("command-auto-nudge-after-rewind"),
          threadId: THREAD_A,
          expectedAuthorityRevision: 6,
          completedTurnId: consumedTurn,
          dispatchSource: "foreground",
          messageId: MessageId.make("message-auto-nudge-after-rewind"),
          createdAt: SERVER_NOW,
        },
      }),
    );
    assert.match(failure.detail, /is off/);
  }),
);

it.effect("does not regress latest turn on a late older turn-diff completion", () =>
  Effect.gen(function* () {
    const newerTurn = TurnId.make("turn-newer");
    const olderTurn = TurnId.make("turn-older");
    const baseThread = makeThread({ id: THREAD_A });
    const initial = makeReadModel([
      {
        ...baseThread,
        latestTurn: makeCompletedTurn(newerTurn, "2026-07-28T12:03:00.000Z"),
      },
    ]);
    const projected = yield* projectEvent(initial, {
      sequence: initial.snapshotSequence + 1,
      eventId: EventId.make("event-late-older-turn-diff"),
      aggregateKind: "thread",
      aggregateId: THREAD_A,
      occurredAt: "2026-07-28T12:20:00.000Z",
      commandId: CommandId.make("command-late-older-turn-diff"),
      causationEventId: null,
      correlationId: CommandId.make("command-late-older-turn-diff"),
      metadata: {},
      type: "thread.turn-diff-completed",
      payload: {
        threadId: THREAD_A,
        turnId: olderTurn,
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("refs/cafe/checkpoints/older"),
        status: "ready",
        files: [],
        assistantMessageId: null,
        completedAt: "2026-07-28T12:05:00.000Z",
      },
    });
    assert.equal(projected.threads[0]?.latestTurn?.turnId, newerTurn);
    assert.equal(projected.threads[0]?.checkpoints[0]?.turnId, olderTurn);
  }),
);

it.effect("ignores out-of-order dispatch accounting with a mismatched authority revision", () =>
  Effect.gen(function* () {
    const initial = makeReadModel([
      makeThread({
        id: THREAD_A,
        autoNudge: enabledConfig({ authorityRevision: 8 }),
      }),
    ]);
    const projected = yield* projectEvent(initial, {
      sequence: initial.snapshotSequence + 1,
      eventId: EventId.make("event-stale-auto-nudge-dispatch"),
      aggregateKind: "thread",
      aggregateId: THREAD_A,
      occurredAt: SERVER_NOW,
      commandId: CommandId.make("command-stale-auto-nudge-dispatch"),
      causationEventId: null,
      correlationId: CommandId.make("command-stale-auto-nudge-dispatch"),
      metadata: {},
      type: "thread.auto-nudge-dispatched",
      payload: {
        threadId: THREAD_A,
        authorityRevision: 7,
        completedTurnId: TURN_COMPLETED,
        dispatchSource: "foreground",
        messageId: MessageId.make("message-stale-auto-nudge-dispatch"),
        roundsDispatched: 1,
        dispatchedAt: SERVER_NOW,
      },
    });
    assert.deepEqual(projected.threads[0]?.autoNudge, enabledConfig({ authorityRevision: 8 }));
  }),
);
