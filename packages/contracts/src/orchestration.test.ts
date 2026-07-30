import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ClientOrchestrationCommand,
  ModelSelection,
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationLatestTurn,
  OrchestrationThread,
  OrchestrationThreadShell,
  ProjectCreatedPayload,
  ProjectMetaUpdatedPayload,
  OrchestrationProposedPlan,
  OrchestrationSession,
  ProjectCreateCommand,
  ThreadMetaUpdatedPayload,
  ThreadDuplicatedPayload,
  ThreadTurnStartCommand,
  ThreadCreatedPayload,
  ThreadTurnStartRequestedPayload,
  ProviderJournalMessageRepairResult,
  ProviderThreadAssistantMessagesRepairResult,
  WorkflowProjectionSnapshot,
  WORKFLOW_PROJECTION_MAX_NODES,
} from "./orchestration.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

const decodeProjectCreateCommand = Schema.decodeUnknownEffect(ProjectCreateCommand);
const decodeProjectCreatedPayload = Schema.decodeUnknownEffect(ProjectCreatedPayload);
const decodeProjectMetaUpdatedPayload = Schema.decodeUnknownEffect(ProjectMetaUpdatedPayload);
const decodeThreadTurnStartCommand = Schema.decodeUnknownEffect(ThreadTurnStartCommand);
const decodeThreadTurnStartRequestedPayload = Schema.decodeUnknownEffect(
  ThreadTurnStartRequestedPayload,
);
const decodeOrchestrationLatestTurn = Schema.decodeUnknownEffect(OrchestrationLatestTurn);
const decodeOrchestrationProposedPlan = Schema.decodeUnknownEffect(OrchestrationProposedPlan);
const decodeOrchestrationSession = Schema.decodeUnknownEffect(OrchestrationSession);
const encodeThreadCreatedPayload = Schema.encodeEffect(ThreadCreatedPayload);

function getOptionValue(
  options: ReadonlyArray<{ id: string; value: unknown }> | undefined,
  id: string,
): unknown {
  return options?.find((option) => option.id === id)?.value;
}
const decodeThreadCreatedPayload = Schema.decodeUnknownEffect(ThreadCreatedPayload);
const decodeThreadDuplicatedPayload = Schema.decodeUnknownEffect(ThreadDuplicatedPayload);
const decodeOrchestrationCommand = Schema.decodeUnknownEffect(OrchestrationCommand);
const decodeClientOrchestrationCommand = Schema.decodeUnknownEffect(ClientOrchestrationCommand);
const decodeOrchestrationEvent = Schema.decodeUnknownEffect(OrchestrationEvent);
const decodeOrchestrationThread = Schema.decodeUnknownEffect(OrchestrationThread);
const decodeOrchestrationThreadShell = Schema.decodeUnknownEffect(OrchestrationThreadShell);
const decodeThreadMetaUpdatedPayload = Schema.decodeUnknownEffect(ThreadMetaUpdatedPayload);
const decodeProviderJournalMessageRepairResult = Schema.decodeUnknownEffect(
  ProviderJournalMessageRepairResult,
);
const decodeProviderThreadAssistantMessagesRepairResult = Schema.decodeUnknownEffect(
  ProviderThreadAssistantMessagesRepairResult,
);
const decodeWorkflowProjectionSnapshot = Schema.decodeUnknownEffect(WorkflowProjectionSnapshot);

const threadBase = {
  id: "thread-auto-nudge",
  projectId: "project-auto-nudge",
  title: "Auto Nudge thread",
  modelSelection: { instanceId: "codex", model: "gpt-5.6-sol" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  latestTurn: null,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
} as const;

it.effect("Auto Nudge configure distinguishes off prompt storage from execution authority", () =>
  Effect.gen(function* () {
    const off = yield* decodeClientOrchestrationCommand({
      type: "thread.auto-nudge.configure",
      commandId: "command-off-save",
      threadId: threadBase.id,
      expectedAuthorityRevision: 0,
      mode: "off",
      prompt: "",
      backgroundContinuation: false,
      maxRounds: 5,
      createdAt: "2026-07-28T00:00:01.000Z",
    });
    assert.strictEqual(off.type, "thread.auto-nudge.configure");
    if (off.type === "thread.auto-nudge.configure") {
      assert.strictEqual(off.mode, "off");
      assert.strictEqual(off.prompt, "");
    }

    const enabled = yield* decodeClientOrchestrationCommand({
      type: "thread.auto-nudge.configure",
      commandId: "command-enable",
      threadId: threadBase.id,
      expectedAuthorityRevision: 1,
      mode: "steady-progress",
      prompt: "First line\nSecond line",
      backgroundContinuation: true,
      maxRounds: 5,
      createdAt: "2026-07-28T00:00:02.000Z",
    });
    assert.strictEqual(enabled.type, "thread.auto-nudge.configure");
    if (enabled.type === "thread.auto-nudge.configure") {
      assert.strictEqual(enabled.prompt, "First line\nSecond line");
    }

    const blankEnabled = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "thread.auto-nudge.configure",
        commandId: "command-blank-enable",
        threadId: threadBase.id,
        expectedAuthorityRevision: 1,
        mode: "steady-progress",
        prompt: " \n ",
        backgroundContinuation: false,
        maxRounds: 5,
        createdAt: "2026-07-28T00:00:03.000Z",
      }),
    );
    assert.strictEqual(blankEnabled._tag, "Failure");
  }),
);

it.effect("Auto Nudge dispatch carries no client prompt", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeClientOrchestrationCommand({
      type: "thread.auto-nudge.dispatch",
      commandId: "command-dispatch",
      threadId: threadBase.id,
      expectedAuthorityRevision: 4,
      completedTurnId: "turn-completed",
      dispatchSource: "foreground",
      messageId: "message-auto-nudge",
      createdAt: "2026-07-28T00:05:00.000Z",
      prompt: "renderer supplied text must be discarded",
    });
    assert.strictEqual(parsed.type, "thread.auto-nudge.dispatch");
    assert.strictEqual("prompt" in parsed, false);
  }),
);

it.effect("Auto Nudge shell summary events cannot carry prompt text", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationEvent({
      sequence: 12,
      eventId: "event-auto-nudge-shell-summary",
      type: "thread.auto-nudge-summary-changed",
      aggregateKind: "thread",
      aggregateId: threadBase.id,
      occurredAt: "2026-07-28T00:03:00.000Z",
      commandId: "command-auto-nudge-shell-summary",
      causationEventId: null,
      correlationId: "command-auto-nudge-shell-summary",
      metadata: {},
      payload: {
        threadId: threadBase.id,
        summary: {
          authorityRevision: 2,
          mode: "steady-progress",
          backgroundContinuation: true,
          maxRounds: 5,
          armedAt: "2026-07-28T00:03:00.000Z",
          baselineSettledTurnId: null,
          lastDispatchedSettledTurnId: null,
          roundsDispatched: 0,
          lastDispatchedAt: null,
          prompt: "must be discarded",
        },
        updatedAt: "2026-07-28T00:03:00.000Z",
      },
    });
    assert.strictEqual(parsed.type, "thread.auto-nudge-summary-changed");
    if (parsed.type === "thread.auto-nudge-summary-changed") {
      assert.strictEqual("prompt" in parsed.payload.summary, false);
    }
  }),
);

it.effect("manual follow-up enqueue preserves the bounded dispatch snapshot", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeClientOrchestrationCommand({
      type: "thread.manual-follow-up.enqueue",
      commandId: "command-manual-follow-up-enqueue",
      threadId: threadBase.id,
      followUpId: "manual-follow-up-1",
      message: {
        messageId: "manual-follow-up-message-1",
        role: "user",
        text: "Run this before any automatic continuation.",
        attachments: [],
      },
      dispatch: {
        modelSelection: {
          instanceId: "claude-local",
          model: "claude-opus-4-1",
        },
        titleSeed: "Queued title",
        runtimeMode: "approval-required",
        interactionMode: "plan",
        sourceProposedPlan: {
          threadId: threadBase.id,
          planId: "plan-1",
        },
      },
      createdAt: "2026-07-28T00:04:00.000Z",
    });

    assert.strictEqual(parsed.type, "thread.manual-follow-up.enqueue");
    if (parsed.type === "thread.manual-follow-up.enqueue") {
      assert.deepStrictEqual(parsed.dispatch, {
        modelSelection: {
          instanceId: ProviderInstanceId.make("claude-local"),
          model: "claude-opus-4-1",
        },
        titleSeed: "Queued title",
        runtimeMode: "approval-required",
        interactionMode: "plan",
        sourceProposedPlan: {
          threadId: threadBase.id,
          planId: "plan-1",
        },
      });
    }
  }),
);

it.effect("manual follow-up activation requires an explicit server-enforced mode", () =>
  Effect.gen(function* () {
    for (const activationMode of ["automatic-after-settlement", "operator"] as const) {
      const parsed = yield* decodeClientOrchestrationCommand({
        type: "thread.manual-follow-up.activate",
        commandId: `command-manual-follow-up-activate-${activationMode}`,
        threadId: threadBase.id,
        followUpId: "manual-follow-up-1",
        activationMode,
        createdAt: "2026-07-28T00:04:01.000Z",
      });
      assert.strictEqual(parsed.type, "thread.manual-follow-up.activate");
      if (parsed.type === "thread.manual-follow-up.activate") {
        assert.strictEqual(parsed.activationMode, activationMode);
      }
    }

    const missingMode = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "thread.manual-follow-up.activate",
        commandId: "command-manual-follow-up-activate-missing-mode",
        threadId: threadBase.id,
        followUpId: "manual-follow-up-1",
        createdAt: "2026-07-28T00:04:01.000Z",
      }),
    );
    assert.strictEqual(missingMode._tag, "Failure");
  }),
);

it.effect("generic client turn commands cannot claim Auto Nudge provenance", () =>
  Effect.gen(function* () {
    const genericCommands = [
      {
        type: "thread.turn.start",
        commandId: "command-forged-auto-nudge-start",
        threadId: threadBase.id,
        message: {
          messageId: "message-forged-auto-nudge-start",
          role: "user",
          text: "Bypass exact-thread authority",
          attachments: [],
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        dispatchSource: "auto-nudge",
        createdAt: "2026-07-28T00:05:00.000Z",
      },
      {
        type: "thread.turn.steer",
        commandId: "command-forged-auto-nudge-steer",
        threadId: threadBase.id,
        message: {
          messageId: "message-forged-auto-nudge-steer",
          role: "user",
          text: "Bypass exact-thread authority",
          attachments: [],
        },
        dispatchSource: "auto-nudge",
        createdAt: "2026-07-28T00:05:00.000Z",
      },
    ];

    for (const command of genericCommands) {
      const result = yield* Effect.exit(decodeClientOrchestrationCommand(command));
      assert.strictEqual(result._tag, "Failure");
    }
  }),
);

it.effect("thread detail and shell decode missing Auto Nudge state to disabled defaults", () =>
  Effect.gen(function* () {
    const detail = yield* decodeOrchestrationThread({
      ...threadBase,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    });
    assert.strictEqual(detail.autoNudge.mode, "off");
    assert.strictEqual(detail.autoNudge.authorityRevision, 0);
    assert.strictEqual(detail.autoNudge.prompt, "");
    assert.deepStrictEqual(detail.manualFollowUps, []);

    const shell = yield* decodeOrchestrationThreadShell({
      ...threadBase,
      session: null,
      latestUserMessageAt: null,
      hasPendingApprovals: false,
      hasPendingUserInput: false,
      hasActionableProposedPlan: false,
    });
    assert.strictEqual(shell.autoNudge.mode, "off");
    assert.strictEqual("prompt" in shell.autoNudge, false);
    assert.strictEqual(shell.manualFollowUpCount, 0);
    assert.strictEqual("manualFollowUps" in shell, false);
  }),
);

it.effect("workflow projection accepts honest unavailable fields and canonical statuses", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeWorkflowProjectionSnapshot({
      version: 1,
      fidelity: "lifecycle-only",
      providerLabel: null,
      modelLabel: null,
      nodes: [
        {
          id: "task:one",
          parentId: null,
          path: null,
          name: null,
          taskLabel: "Audit the adapter",
          status: "waiting",
          startedAt: null,
          elapsedSeconds: null,
          latestActivitySummary: null,
          lastActivityAt: null,
          activityCount: 1,
          depth: 0,
        },
      ],
      recentActivities: [],
      sourceActivityCount: 1,
      omittedNodeCount: 0,
      omittedActivityCount: 0,
    });

    assert.strictEqual(parsed.nodes[0]?.status, "waiting");
    assert.strictEqual(parsed.nodes[0]?.elapsedSeconds, null);
  }),
);

it.effect("workflow projection rejects node collections above the wire cap", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeWorkflowProjectionSnapshot({
        version: 1,
        fidelity: "live",
        providerLabel: null,
        modelLabel: null,
        nodes: Array.from({ length: WORKFLOW_PROJECTION_MAX_NODES + 1 }, (_, index) => ({
          id: `agent:${index}`,
          parentId: null,
          path: null,
          name: null,
          taskLabel: null,
          status: "running",
          startedAt: null,
          elapsedSeconds: null,
          latestActivitySummary: null,
          lastActivityAt: null,
          activityCount: 1,
          depth: 0,
        })),
        recentActivities: [],
        sourceActivityCount: WORKFLOW_PROJECTION_MAX_NODES + 1,
        omittedNodeCount: 0,
        omittedActivityCount: 0,
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims branded ids and command string fields at decode boundaries", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: " cmd-1 ",
      projectId: " project-1 ",
      title: " Project Title ",
      workspaceRoot: " /tmp/workspace ",
      additionalWorkspaceRoots: [" /tmp/docs ", " /tmp/tools "],
      defaultModelSelection: {
        provider: "codex",
        model: " gpt-5.2 ",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.commandId, "cmd-1");
    assert.strictEqual(parsed.projectId, "project-1");
    assert.strictEqual(parsed.title, "Project Title");
    assert.strictEqual(parsed.workspaceRoot, "/tmp/workspace");
    assert.deepStrictEqual(parsed.additionalWorkspaceRoots, ["/tmp/docs", "/tmp/tools"]);
    assert.strictEqual(parsed.createWorkspaceRootIfMissing, undefined);
    assert.deepStrictEqual(parsed.defaultModelSelection, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.2",
    });
  }),
);

it.effect("decodes project.create with createWorkspaceRootIfMissing enabled", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreateCommand({
      type: "project.create",
      commandId: "cmd-1",
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      createWorkspaceRootIfMissing: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.createWorkspaceRootIfMissing, true);
  }),
);

it.effect("decodes canonical text on internal assistant completion commands", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationCommand({
      type: "thread.message.assistant.complete",
      commandId: "cmd-assistant-complete",
      threadId: "thread-1",
      messageId: "assistant-message-1",
      turnId: "turn-1",
      finalText: "Canonical completed assistant text.",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.type, "thread.message.assistant.complete");
    if (parsed.type === "thread.message.assistant.complete") {
      assert.strictEqual(parsed.finalText, "Canonical completed assistant text.");
    }
  }),
);

it.effect("decodes thread.duplicate client commands and duplicated payloads", () =>
  Effect.gen(function* () {
    const command = yield* decodeClientOrchestrationCommand({
      type: "thread.duplicate",
      commandId: "cmd-duplicate",
      sourceThreadId: "source-thread",
      targetThreadId: "target-thread",
      title: "Source Thread (copy)",
      createdAt: "2026-06-05T00:00:00.000Z",
    });
    assert.strictEqual(command.type, "thread.duplicate");
    if (command.type !== "thread.duplicate") {
      return;
    }
    assert.strictEqual(command.sourceThreadId, "source-thread");
    assert.strictEqual(command.targetThreadId, "target-thread");

    const payload = yield* decodeThreadDuplicatedPayload({
      sourceThreadId: "source-thread",
      targetThreadId: "target-thread",
      duplicatedAt: "2026-06-05T00:00:00.000Z",
    });
    assert.strictEqual(payload.sourceThreadId, "source-thread");
    assert.strictEqual(payload.targetThreadId, "target-thread");
  }),
);

it.effect("decodes historical project.created payloads with a default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.instanceId, "codex");
    assert.strictEqual(parsed.additionalWorkspaceRoots, undefined);
  }),
);

it.effect("decodes populated project additional workspace roots", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Project Title",
      workspaceRoot: "/tmp/workspace",
      additionalWorkspaceRoots: ["/tmp/docs", " /tmp/tools "],
      defaultModelSelection: null,
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.additionalWorkspaceRoots, ["/tmp/docs", "/tmp/tools"]);
  }),
);

it.effect("decodes project.meta-updated payloads with explicit default provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectMetaUpdatedPayload({
      projectId: "project-1",
      additionalWorkspaceRoots: [" /tmp/docs "],
      defaultModelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.defaultModelSelection?.instanceId, "claudeAgent");
    assert.deepStrictEqual(parsed.additionalWorkspaceRoots, ["/tmp/docs"]);
  }),
);

it.effect("rejects command fields that become empty after trim", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeProjectCreateCommand({
        type: "project.create",
        commandId: "cmd-1",
        projectId: "project-1",
        title: "  ",
        workspaceRoot: "/tmp/workspace",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes safe provider journal message repair results", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProviderJournalMessageRepairResult({
      status: "repaired",
      threadId: "thread-1",
      messageId: "assistant:item-1",
      reason: "suffix-appended",
      oldLength: 5,
      newLength: 12,
      appendedLength: 7,
      candidateCount: 1,
      provider: "codex",
      providerInstanceId: "codex",
      itemId: "item-1",
      sourceEventId: "evt-item-completed",
      source: "provider-journal",
    });

    assert.strictEqual(parsed.status, "repaired");
    assert.strictEqual(parsed.threadId, "thread-1");
    assert.strictEqual(parsed.messageId, "assistant:item-1");
    assert.strictEqual("suffix" in parsed, false);
    assert.strictEqual("completionText" in parsed, false);
  }),
);

it.effect("decodes safe thread assistant message repair aggregates", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProviderThreadAssistantMessagesRepairResult({
      threadId: "thread-1",
      sourcePolicy: "local-then-upstream",
      counts: {
        totalMessages: 2,
        eligibleMessages: 2,
        localAttempts: 2,
        upstreamAttempts: 1,
        repaired: 1,
        unchanged: 0,
        notEligible: 0,
        sourceNotFound: 0,
        ambiguousSource: 0,
        diverged: 0,
        upstreamUnavailable: 1,
        failed: 0,
      },
      results: [
        {
          status: "repaired",
          threadId: "thread-1",
          messageId: "assistant:item-1",
          oldLength: 5,
          newLength: 12,
          appendedLength: 7,
          provider: "codex",
          providerInstanceId: "codex",
          itemId: "item-1",
          source: "upstream-provider",
        },
        {
          status: "upstream-unavailable",
          threadId: "thread-1",
          messageId: "assistant:item-2",
          reason: "upstream-thread-read-failed",
          source: "upstream-provider",
        },
      ],
    });

    assert.strictEqual(parsed.counts.repaired, 1);
    assert.strictEqual(parsed.results[0]?.source, "upstream-provider");
    assert.strictEqual("suffix" in parsed.results[0]!, false);
    assert.strictEqual("completionText" in parsed.results[0]!, false);
  }),
);

it.effect("keeps provider journal repair out of client-dispatchable commands", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeClientOrchestrationCommand({
        type: "thread.message.assistant.repair-suffix",
        commandId: "cmd-repair",
        threadId: "thread-1",
        messageId: "assistant:item-1",
        turnId: "turn-1",
        suffix: "raw provider suffix",
        provider: "codex",
        sourceEventId: "evt-item-completed",
        oldLength: 5,
        newLength: 24,
        appendedLength: 19,
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("decodes thread.turn.start defaults for provider and runtime mode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-1",
      threadId: "thread-1",
      message: {
        messageId: "msg-1",
        role: "user",
        text: "hello",
        attachments: [],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection, undefined);
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
  }),
);

it.effect("preserves explicit provider and runtime mode in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-2",
      threadId: "thread-1",
      message: {
        messageId: "msg-2",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      runtimeMode: "full-access",
      interactionMode: "auto",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "codex");
    assert.strictEqual(parsed.runtimeMode, "full-access");
    assert.strictEqual(parsed.interactionMode, "auto");
  }),
);

it.effect("decodes thread.turn.steer for client upload and normalized command payloads", () =>
  Effect.gen(function* () {
    const clientParsed = yield* decodeClientOrchestrationCommand({
      type: "thread.turn.steer",
      commandId: "cmd-steer-1",
      threadId: "thread-1",
      message: {
        messageId: "msg-steer-1",
        role: "user",
        text: "adjust course",
        attachments: [
          {
            type: "image",
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 16,
            dataUrl: "data:image/png;base64,AAAA",
          },
        ],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(clientParsed.type, "thread.turn.steer");
    assert.strictEqual(clientParsed.message.attachments[0]?.type, "image");

    const normalizedParsed = yield* decodeOrchestrationCommand({
      type: "thread.turn.steer",
      commandId: "cmd-steer-2",
      threadId: "thread-1",
      message: {
        messageId: "msg-steer-2",
        role: "user",
        text: "adjust course",
        attachments: [
          {
            type: "image",
            id: "thread-1-att-1",
            name: "screen.png",
            mimeType: "image/png",
            sizeBytes: 16,
          },
        ],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(normalizedParsed.type, "thread.turn.steer");
  }),
);

it.effect("accepts bootstrap metadata in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-bootstrap",
      threadId: "thread-1",
      message: {
        messageId: "msg-bootstrap",
        role: "user",
        text: "hello",
        attachments: [],
      },
      bootstrap: {
        createThread: {
          projectId: "project-1",
          title: "Bootstrap thread",
          modelSelection: {
            provider: "codex",
            model: "gpt-5.4",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
        prepareWorktree: {
          projectCwd: "/tmp/workspace",
          baseBranch: "main",
          branch: "t3code/example",
        },
        runSetupScript: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.bootstrap?.createThread?.projectId, "project-1");
    assert.strictEqual(parsed.bootstrap?.prepareWorktree?.baseBranch, "main");
    assert.strictEqual(parsed.bootstrap?.runSetupScript, true);
  }),
);

it.effect("decodes thread.created runtime mode for historical events", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Thread title",
      modelSelection: {
        provider: "codex",
        model: "gpt-5.4",
      },
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
    assert.strictEqual(parsed.modelSelection.instanceId, "codex");
  }),
);

it.effect("decodes thread.meta-updated payloads with explicit provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadMetaUpdatedPayload({
      threadId: "thread-1",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
      },
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "claudeAgent");
  }),
);

it.effect("decodes thread project moves through thread meta updates", () =>
  Effect.gen(function* () {
    const command = yield* decodeOrchestrationCommand({
      type: "thread.meta.update",
      commandId: "cmd-move-thread",
      threadId: "thread-1",
      projectId: "project-2",
    });
    assert.strictEqual(command.type, "thread.meta.update");
    assert.strictEqual(command.projectId, "project-2");

    const payload = yield* decodeThreadMetaUpdatedPayload({
      threadId: "thread-1",
      projectId: "project-2",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(payload.projectId, "project-2");
  }),
);

it.effect("decodes thread archive and unarchive commands", () =>
  Effect.gen(function* () {
    const archive = yield* decodeOrchestrationCommand({
      type: "thread.archive",
      commandId: "cmd-archive-1",
      threadId: "thread-1",
    });
    const unarchive = yield* decodeOrchestrationCommand({
      type: "thread.unarchive",
      commandId: "cmd-unarchive-1",
      threadId: "thread-1",
    });

    assert.strictEqual(archive.type, "thread.archive");
    assert.strictEqual(unarchive.type, "thread.unarchive");
  }),
);

it.effect("decodes thread archived and unarchived events", () =>
  Effect.gen(function* () {
    const archived = yield* decodeOrchestrationEvent({
      sequence: 1,
      eventId: "event-archive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.archived",
      occurredAt: "2026-01-01T00:00:00.000Z",
      commandId: "cmd-archive-1",
      causationEventId: null,
      correlationId: "cmd-archive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        archivedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    const unarchived = yield* decodeOrchestrationEvent({
      sequence: 2,
      eventId: "event-unarchive-1",
      aggregateKind: "thread",
      aggregateId: "thread-1",
      type: "thread.unarchived",
      occurredAt: "2026-01-02T00:00:00.000Z",
      commandId: "cmd-unarchive-1",
      causationEventId: null,
      correlationId: "cmd-unarchive-1",
      metadata: {},
      payload: {
        threadId: "thread-1",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    });

    assert.strictEqual(archived.type, "thread.archived");
    assert.strictEqual(archived.payload.archivedAt, "2026-01-01T00:00:00.000Z");
    assert.strictEqual(unarchived.type, "thread.unarchived");
  }),
);

it.effect("accepts provider-scoped model options in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-options",
      threadId: "thread-1",
      message: {
        messageId: "msg-options",
        role: "user",
        text: "hello",
        attachments: [],
      },
      modelSelection: {
        provider: "codex",
        model: "gpt-5.3-codex",
        options: [
          { id: "reasoningEffort", value: "high" },
          { id: "fastMode", value: true },
        ],
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.modelSelection?.instanceId, "codex");
    assert.strictEqual(getOptionValue(parsed.modelSelection?.options, "reasoningEffort"), "high");
    assert.strictEqual(getOptionValue(parsed.modelSelection?.options, "fastMode"), true);
  }),
);

it.effect("normalizes legacy object-shaped modelSelection.options on decode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadCreatedPayload({
      threadId: "thread-1",
      projectId: "project-1",
      title: "Legacy options thread",
      modelSelection: {
        provider: "claudeAgent",
        model: "claude-opus-4-6",
        options: {
          effort: "max",
          fastMode: true,
          // Falsy/garbage entries are dropped, matching migration 026.
          emptyStr: "   ",
          nullish: null,
          nested: { foo: 1 },
        },
      },
      branch: null,
      worktreePath: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.strictEqual(parsed.modelSelection.instanceId, ProviderInstanceId.make("claudeAgent"));
    assert.deepStrictEqual(parsed.modelSelection.options, [
      { id: "effort", value: "max" },
      { id: "fastMode", value: true },
    ]);
  }),
);

it.effect("normalizes legacy object-shaped defaultModelSelection.options on decode", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeProjectCreatedPayload({
      projectId: "project-1",
      title: "Legacy default project",
      workspaceRoot: "/tmp/legacy",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5.4",
        options: { reasoningEffort: "low" },
      },
      scripts: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    assert.deepStrictEqual(parsed.defaultModelSelection?.options, [
      { id: "reasoningEffort", value: "low" },
    ]);
  }),
);

it.effect(
  "normalizes legacy object-shaped options on decode and re-encodes as canonical array",
  () =>
    Effect.gen(function* () {
      const decoded = yield* decodeThreadCreatedPayload({
        threadId: "thread-1",
        projectId: "project-1",
        title: "Round trip thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: { fastMode: true },
        },
        branch: null,
        worktreePath: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      const encoded = yield* encodeThreadCreatedPayload(decoded);
      assert.deepStrictEqual(encoded.modelSelection.options, [{ id: "fastMode", value: true }]);
    }),
);

it.effect("accepts a title seed in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-title-seed",
      threadId: "thread-1",
      message: {
        messageId: "msg-title-seed",
        role: "user",
        text: "hello",
        attachments: [],
      },
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("accepts a source proposed plan reference in thread.turn.start", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartCommand({
      type: "thread.turn.start",
      commandId: "cmd-turn-source-plan",
      threadId: "thread-2",
      message: {
        messageId: "msg-source-plan",
        role: "user",
        text: "implement this",
        attachments: [],
      },
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect(
  "decodes thread.turn-start-requested defaults for provider, runtime mode, and interaction mode",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeThreadTurnStartRequestedPayload({
        threadId: "thread-1",
        messageId: "msg-1",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      assert.strictEqual(parsed.modelSelection, undefined);
      assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
      assert.strictEqual(parsed.interactionMode, DEFAULT_PROVIDER_INTERACTION_MODE);
      assert.strictEqual(parsed.sourceProposedPlan, undefined);
    }),
);

it.effect("decodes thread.turn-start-requested source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes thread.turn-start-requested title seed when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeThreadTurnStartRequestedPayload({
      threadId: "thread-2",
      messageId: "msg-2",
      titleSeed: "Investigate reconnect failures",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.titleSeed, "Investigate reconnect failures");
  }),
);

it.effect("decodes latest turn source proposed plan metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationLatestTurn({
      turnId: "turn-2",
      state: "running",
      requestedAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-01T00:00:01.000Z",
      completedAt: null,
      assistantMessageId: null,
      sourceProposedPlan: {
        threadId: "thread-1",
        planId: "plan-1",
      },
    });
    assert.deepStrictEqual(parsed.sourceProposedPlan, {
      threadId: "thread-1",
      planId: "plan-1",
    });
  }),
);

it.effect("decodes orchestration session runtime mode defaults", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationSession({
      threadId: "thread-1",
      status: "idle",
      providerName: null,
      providerSessionId: null,
      providerThreadId: null,
      activeTurnId: null,
      lastError: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.runtimeMode, DEFAULT_RUNTIME_MODE);
  }),
);

it.effect("defaults proposed plan implementation metadata for historical rows", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-1",
      turnId: "turn-1",
      planMarkdown: "# Plan",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, null);
    assert.strictEqual(parsed.implementationThreadId, null);
  }),
);

it.effect("preserves proposed plan implementation metadata when present", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeOrchestrationProposedPlan({
      id: "plan-2",
      turnId: "turn-2",
      planMarkdown: "# Plan",
      implementedAt: "2026-01-02T00:00:00.000Z",
      implementationThreadId: "thread-2",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    assert.strictEqual(parsed.implementedAt, "2026-01-02T00:00:00.000Z");
    assert.strictEqual(parsed.implementationThreadId, "thread-2");
  }),
);

// ── ModelSelection: instance-keyed wire shape + legacy decoder ────────
//
// `ModelSelection` is routing-keyed on `instanceId` — never a driver kind.
// Persisted and in-flight payloads from pre-instance builds carry a
// `provider` field whose value was a driver kind; those payloads are migrated
// at the wire boundary by
// promoting `provider` to the default instance id for that driver
// (built-in drivers use the driver kind slug as their default instance id, so
// the migration is a 1:1 rename).
//
// These tests pin the rollback/fork tolerance invariant: legacy payloads
// decode cleanly for fork-provided drivers, and the decoded form uses
// `instanceId` uniformly regardless of origin.

const decodeModelSelection = Schema.decodeUnknownEffect(ModelSelection);
const encodeModelSelection = Schema.encodeUnknownEffect(ModelSelection);

it.effect("ModelSelection migrates legacy `provider` field to `instanceId`", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      provider: "codex",
      model: "gpt-5-codex",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex"));
    assert.strictEqual(parsed.model, "gpt-5-codex");
    assert.deepStrictEqual(parsed.options, [{ id: "reasoningEffort", value: "high" }]);
  }),
);

it.effect("ModelSelection accepts an explicit instanceId routing key", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      instanceId: "codex_personal",
      model: "gpt-5-codex",
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex_personal"));
  }),
);

it.effect("ModelSelection prefers explicit instanceId over legacy provider", () =>
  Effect.gen(function* () {
    const parsed = yield* decodeModelSelection({
      provider: "codex",
      instanceId: "codex_personal",
      model: "gpt-5-codex",
    });
    assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("codex_personal"));
  }),
);

it.effect(
  "ModelSelection decodes unknown driver kinds via legacy provider (rollback / fork invariant)",
  () =>
    Effect.gen(function* () {
      const parsed = yield* decodeModelSelection({
        provider: "ollama",
        model: "llama3:70b",
        options: [{ id: "temperature", value: "0.4" }],
      });
      assert.strictEqual(parsed.instanceId, ProviderInstanceId.make("ollama"));
      assert.strictEqual(parsed.model, "llama3:70b");
    }),
);

it.effect("ModelSelection encodes to the canonical instanceId wire form", () =>
  Effect.gen(function* () {
    const decoded = yield* decodeModelSelection({
      provider: "ollama",
      model: "llama3:70b",
      options: [{ id: "temperature", value: "0.4" }],
    });
    const encoded = yield* encodeModelSelection(decoded);
    assert.deepStrictEqual(encoded, {
      instanceId: "ollama",
      model: "llama3:70b",
      options: [{ id: "temperature", value: "0.4" }],
    });
  }),
);

it.effect("ModelSelection rejects malformed instance ids", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decodeModelSelection({
        instanceId: "1invalid", // must start with a letter
        model: "x",
      }),
    );
    assert.strictEqual(result._tag, "Failure");
  }),
);
