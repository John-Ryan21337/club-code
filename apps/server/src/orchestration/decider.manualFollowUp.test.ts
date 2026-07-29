import {
  CommandId,
  DEFAULT_THREAD_AUTO_NUDGE_CONFIG,
  ManualFollowUpId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@cafecode/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { decideOrchestrationCommand } from "./decider.ts";
import { projectEvent } from "./projector.ts";

const NOW = "2026-07-28T12:00:00.000Z";
const PROJECT_ID = ProjectId.make("project-manual-follow-up");
const THREAD_ID = ThreadId.make("thread-manual-follow-up");
const ACTIVE_TURN_ID = TurnId.make("turn-manual-follow-up-active");
const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.6-sol",
} as const;

type PlannedEvent = OrchestrationEvent extends infer Event
  ? Event extends OrchestrationEvent
    ? Omit<Event, "sequence">
    : never
  : never;

function asEvents(result: unknown): ReadonlyArray<PlannedEvent> {
  return Array.isArray(result) ? (result as ReadonlyArray<PlannedEvent>) : [result as PlannedEvent];
}

const projectEvents = Effect.fn("projectManualFollowUpEvents")(function* (
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

function makeThread(input?: {
  readonly running?: boolean;
  readonly autoNudgeEnabled?: boolean;
}): OrchestrationThread {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Durable queue",
    modelSelection: MODEL_SELECTION,
    runtimeMode: "approval-required",
    interactionMode: "plan",
    branch: null,
    worktreePath: null,
    autoNudge:
      input?.autoNudgeEnabled === true
        ? {
            ...DEFAULT_THREAD_AUTO_NUDGE_CONFIG,
            authorityRevision: 1,
            mode: "steady-progress",
            prompt: "automatic work must wait",
            armedAt: NOW,
          }
        : DEFAULT_THREAD_AUTO_NUDGE_CONFIG,
    manualFollowUps: [],
    latestTurn:
      input?.running === true
        ? {
            turnId: ACTIVE_TURN_ID,
            state: "running",
            requestedAt: NOW,
            startedAt: NOW,
            completedAt: null,
            assistantMessageId: null,
          }
        : {
            turnId: TurnId.make("turn-manual-follow-up-completed"),
            state: "completed",
            requestedAt: NOW,
            startedAt: NOW,
            completedAt: NOW,
            assistantMessageId: null,
          },
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session:
      input?.running === true
        ? {
            threadId: THREAD_ID,
            status: "running",
            providerName: "codex",
            providerInstanceId: ProviderInstanceId.make("codex"),
            runtimeMode: "approval-required",
            activeTurnId: ACTIVE_TURN_ID,
            lastError: null,
            updatedAt: NOW,
          }
        : null,
  };
}

function makeReadModel(thread = makeThread()): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    updatedAt: NOW,
    projects: [
      {
        id: PROJECT_ID,
        title: "Manual follow-up project",
        workspaceRoot: "M:\\ManualFollowUp",
        defaultModelSelection: MODEL_SELECTION,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
        deletedAt: null,
      },
    ],
    threads: [thread],
  };
}

function enqueueCommand(index: number) {
  return {
    type: "thread.manual-follow-up.enqueue" as const,
    commandId: CommandId.make(`command-enqueue-${index}`),
    threadId: THREAD_ID,
    followUpId: ManualFollowUpId.make(`follow-up-${index}`),
    message: {
      messageId: MessageId.make(`message-follow-up-${index}`),
      role: "user" as const,
      text: `manual follow-up ${index}`,
      attachments: [],
    },
    dispatch: {
      modelSelection: {
        instanceId: ProviderInstanceId.make("claude-account-at-enqueue"),
        model: "claude-opus-4-1",
      },
      titleSeed: "Title at enqueue",
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
    },
    createdAt: NOW,
  };
}

it.effect("persists bounded FIFO intent and rejects duplicate ids or out-of-order activation", () =>
  Effect.gen(function* () {
    let readModel = makeReadModel();
    const first = asEvents(
      yield* decideOrchestrationCommand({
        readModel,
        command: enqueueCommand(1),
      }),
    );
    assert.deepEqual(
      first.map((event) => event.type),
      ["thread.manual-follow-up-enqueued", "thread.manual-follow-up-count-changed"],
    );
    assert.equal(first[0]?.type, "thread.manual-follow-up-enqueued");
    if (first[0]?.type === "thread.manual-follow-up-enqueued") {
      assert.deepEqual(first[0].payload.item.dispatch, enqueueCommand(1).dispatch);
    }
    readModel = yield* projectEvents(readModel, first);

    const duplicate = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel,
        command: {
          ...enqueueCommand(1),
          commandId: CommandId.make("command-enqueue-duplicate"),
        },
      }),
    );
    assert.match(duplicate.detail, /already exists/i);

    const second = asEvents(
      yield* decideOrchestrationCommand({
        readModel,
        command: enqueueCommand(2),
      }),
    );
    readModel = yield* projectEvents(readModel, second);
    assert.deepEqual(
      readModel.threads[0]?.manualFollowUps.map((item) => item.id),
      [ManualFollowUpId.make("follow-up-1"), ManualFollowUpId.make("follow-up-2")],
    );

    const outOfOrder = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.manual-follow-up.activate",
          commandId: CommandId.make("command-activate-second"),
          threadId: THREAD_ID,
          followUpId: ManualFollowUpId.make("follow-up-2"),
          activationMode: "automatic-after-settlement",
          createdAt: NOW,
        },
      }),
    );
    assert.match(outOfOrder.detail, /FIFO head/i);

    for (let index = 3; index <= 32; index += 1) {
      readModel = yield* projectEvents(
        readModel,
        asEvents(
          yield* decideOrchestrationCommand({
            readModel,
            command: enqueueCommand(index),
          }),
        ),
      );
    }
    assert.equal(readModel.threads[0]?.manualFollowUps.length, 32);
    const overflow = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel,
        command: enqueueCommand(33),
      }),
    );
    assert.match(overflow.detail, /maximum 32 manual follow-ups/i);

    const cancelled = asEvents(
      yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.manual-follow-up.cancel",
          commandId: CommandId.make("command-cancel-queued"),
          threadId: THREAD_ID,
          followUpId: ManualFollowUpId.make("follow-up-32"),
          createdAt: NOW,
        },
      }),
    );
    assert.deepEqual(
      cancelled.map((event) => event.type),
      ["thread.manual-follow-up-cancelled", "thread.manual-follow-up-count-changed"],
    );
    readModel = yield* projectEvents(readModel, cancelled);
    assert.equal(readModel.threads[0]?.manualFollowUps.length, 31);
  }),
);

it.effect(
  "atomically activates with queued dispatch settings, blocks Auto Nudge, and safely retries a released handoff",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(NOW) + 1_000);
      let readModel = makeReadModel(makeThread({ autoNudgeEnabled: true }));
      readModel = yield* projectEvents(
        readModel,
        asEvents(
          yield* decideOrchestrationCommand({
            readModel,
            command: enqueueCommand(1),
          }),
        ),
      );

      const blockedAutoNudge = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.auto-nudge.dispatch",
            commandId: CommandId.make("command-auto-nudge-blocked"),
            threadId: THREAD_ID,
            expectedAuthorityRevision: 1,
            completedTurnId: TurnId.make("turn-manual-follow-up-completed"),
            dispatchSource: "foreground",
            messageId: MessageId.make("message-auto-nudge-blocked"),
            createdAt: NOW,
          },
        }),
      );
      assert.match(blockedAutoNudge.detail, /manual.*priority/i);

      const activationCommandId = CommandId.make("command-activate-first");
      const activated = asEvents(
        yield* decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.manual-follow-up.activate",
            commandId: activationCommandId,
            threadId: THREAD_ID,
            followUpId: ManualFollowUpId.make("follow-up-1"),
            activationMode: "automatic-after-settlement",
            createdAt: NOW,
          },
        }),
      );
      assert.deepEqual(
        activated.map((event) => event.type),
        ["thread.manual-follow-up-activated", "thread.message-sent", "thread.turn-start-requested"],
      );
      const start = activated[2];
      assert.equal(start?.type, "thread.turn-start-requested");
      if (start?.type === "thread.turn-start-requested") {
        assert.equal(start.payload.modelSelection?.model, "claude-opus-4-1");
        assert.equal(start.payload.runtimeMode, "full-access");
        assert.equal(start.payload.interactionMode, "default");
        assert.equal(start.payload.titleSeed, "Title at enqueue");
        assert.equal(start.payload.manualFollowUpId, ManualFollowUpId.make("follow-up-1"));
        assert.equal(start.payload.manualFollowUpActivationCommandId, activationCommandId);
      }
      readModel = yield* projectEvents(readModel, activated);
      assert.equal(readModel.threads[0]?.manualFollowUps[0]?.status, "handoff");

      const inFlightCancel = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.manual-follow-up.cancel",
            commandId: CommandId.make("command-cancel-in-flight"),
            threadId: THREAD_ID,
            followUpId: ManualFollowUpId.make("follow-up-1"),
            createdAt: NOW,
          },
        }),
      );
      assert.match(inFlightCancel.detail, /unresolved provider handoff/i);

      const released = asEvents(
        yield* decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.manual-follow-up.release",
            commandId: CommandId.make("server:manual-follow-up-released"),
            threadId: THREAD_ID,
            followUpId: ManualFollowUpId.make("follow-up-1"),
            activationCommandId,
            releasedAt: NOW,
          },
        }),
      );
      readModel = yield* projectEvents(readModel, released);
      assert.equal(readModel.threads[0]?.manualFollowUps[0]?.status, "queued");
      readModel = yield* projectEvents(
        readModel,
        asEvents(
          yield* decideOrchestrationCommand({
            readModel,
            command: {
              type: "thread.session.set",
              commandId: CommandId.make("server:manual-follow-up-provider-failed"),
              threadId: THREAD_ID,
              session: {
                threadId: THREAD_ID,
                status: "error",
                providerName: "claude",
                providerInstanceId: ProviderInstanceId.make("claude-account-at-enqueue"),
                runtimeMode: "full-access",
                activeTurnId: null,
                lastError: "Provider rejected the queued follow-up.",
                updatedAt: NOW,
              },
              createdAt: NOW,
            },
          }),
        ),
      );

      const retryActivationCommandId = CommandId.make("command-activate-first-retry");
      const retried = asEvents(
        yield* decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.manual-follow-up.activate",
            commandId: retryActivationCommandId,
            threadId: THREAD_ID,
            followUpId: ManualFollowUpId.make("follow-up-1"),
            activationMode: "automatic-after-settlement",
            createdAt: NOW,
          },
        }),
      );
      assert.deepEqual(
        retried.map((event) => event.type),
        ["thread.manual-follow-up-activated", "thread.turn-start-requested"],
      );
      readModel = yield* projectEvents(readModel, retried);

      const staleAccept = yield* Effect.flip(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.manual-follow-up.accept",
            commandId: CommandId.make("server:manual-follow-up-stale-accept"),
            threadId: THREAD_ID,
            followUpId: ManualFollowUpId.make("follow-up-1"),
            activationCommandId,
            acceptedAt: NOW,
          },
        }),
      );
      assert.match(staleAccept.detail, /matching active provider handoff/i);

      const accepted = asEvents(
        yield* decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.manual-follow-up.accept",
            commandId: CommandId.make("server:manual-follow-up-accept"),
            threadId: THREAD_ID,
            followUpId: ManualFollowUpId.make("follow-up-1"),
            activationCommandId: retryActivationCommandId,
            acceptedAt: NOW,
          },
        }),
      );
      readModel = yield* projectEvents(readModel, accepted);
      assert.equal(readModel.threads[0]?.manualFollowUps.length, 0);
      assert.equal(
        readModel.threads[0]?.messages.filter(
          (message) => message.id === MessageId.make("message-follow-up-1"),
        ).length,
        1,
      );
    }),
);

it.effect("server-blocks raced automatic activation but permits an explicit FIFO steer", () =>
  Effect.gen(function* () {
    let readModel = makeReadModel(makeThread({ running: true }));
    readModel = yield* projectEvents(
      readModel,
      asEvents(
        yield* decideOrchestrationCommand({
          readModel,
          command: enqueueCommand(1),
        }),
      ),
    );
    const racedAutomaticActivation = yield* Effect.flip(
      decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.manual-follow-up.activate",
          commandId: CommandId.make("command-activate-raced-automatic"),
          threadId: THREAD_ID,
          followUpId: ManualFollowUpId.make("follow-up-1"),
          activationMode: "automatic-after-settlement",
          createdAt: NOW,
        },
      }),
    );
    assert.match(racedAutomaticActivation.detail, /became active.*remains pending/i);
    assert.equal(readModel.threads[0]?.manualFollowUps[0]?.status, "queued");
    assert.equal(readModel.threads[0]?.messages.length, 0);

    const activationCommandId = CommandId.make("command-activate-steer");
    const events = asEvents(
      yield* decideOrchestrationCommand({
        readModel,
        command: {
          type: "thread.manual-follow-up.activate",
          commandId: activationCommandId,
          threadId: THREAD_ID,
          followUpId: ManualFollowUpId.make("follow-up-1"),
          activationMode: "operator",
          createdAt: NOW,
        },
      }),
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ["thread.manual-follow-up-activated", "thread.message-sent", "thread.turn-steer-requested"],
    );
    const message = events[1];
    assert.equal(message?.type, "thread.message-sent");
    if (message?.type === "thread.message-sent") {
      assert.equal(message.payload.turnId, ACTIVE_TURN_ID);
    }
    const steer = events[2];
    assert.equal(steer?.type, "thread.turn-steer-requested");
    if (steer?.type === "thread.turn-steer-requested") {
      assert.equal(steer.payload.manualFollowUpActivationCommandId, activationCommandId);
    }
  }),
);
