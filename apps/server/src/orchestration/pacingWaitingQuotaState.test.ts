import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-07-26T17:00:00.000Z";
const threadId = ThreadId.make("thread-waiting-quota");

function waitingReadModel(): OrchestrationReadModel {
  return {
    ...createEmptyReadModel(NOW),
    threads: [
      {
        id: threadId,
        projectId: ProjectId.make("project-a"),
        title: "Waiting thread",
        modelSelection: {
          instanceId: ProviderInstanceId.make("claude-primary"),
          model: "claude-sonnet-4-6",
        },
        runtimeMode: "full-access",
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
        session: {
          threadId,
          status: "waiting-quota",
          providerName: "claudeAgent",
          providerInstanceId: ProviderInstanceId.make("claude-primary"),
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: null,
          updatedAt: NOW,
        },
      },
    ],
  };
}

describe("waiting-quota orchestration state", () => {
  it("rejects both a second start and a steer instead of replacing the queued prompt", async () => {
    const readModel = waitingReadModel();
    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.turn.start",
            commandId: CommandId.make("command-second-start"),
            threadId,
            message: {
              messageId: MessageId.make("message-second-start"),
              role: "user",
              text: "Do not replace the first prompt.",
              attachments: [],
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            dispatchSource: "user",
            createdAt: NOW,
          },
        }),
      ),
    ).rejects.toThrow("already has a turn starting, waiting for provider quota, or running");

    await expect(
      Effect.runPromise(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.turn.steer",
            commandId: CommandId.make("command-steer-waiting"),
            threadId,
            message: {
              messageId: MessageId.make("message-steer-waiting"),
              role: "user",
              text: "Do not turn this into another queued start.",
              attachments: [],
            },
            dispatchSource: "user",
            createdAt: NOW,
          },
        }),
      ),
    ).rejects.toThrow("already has a manual turn waiting for provider quota");
  });

  it("projects an interrupt with no provider turn id as cancellation of the wait", async () => {
    const interruptedAt = "2026-07-26T17:01:00.000Z";
    const event = {
      sequence: 1,
      eventId: EventId.make("event-interrupt-wait"),
      type: "thread.turn-interrupt-requested",
      aggregateKind: "thread",
      aggregateId: threadId,
      occurredAt: interruptedAt,
      commandId: CommandId.make("command-interrupt-wait"),
      causationEventId: null,
      correlationId: null,
      metadata: {},
      payload: {
        threadId,
        createdAt: interruptedAt,
      },
    } satisfies OrchestrationEvent;

    const projected = await Effect.runPromise(projectEvent(waitingReadModel(), event));

    expect(projected.threads[0]?.session).toMatchObject({
      status: "interrupted",
      activeTurnId: null,
      updatedAt: interruptedAt,
    });
    expect(projected.threads[0]?.latestTurn).toBeNull();
  });
});
