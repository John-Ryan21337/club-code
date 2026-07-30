import {
  EventId,
  type OrchestrationThreadActivity,
  TurnId,
  WORKFLOW_PROJECTION_MAX_NODES,
  WORKFLOW_PROJECTION_MAX_RECENT_ACTIVITIES,
} from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import { deriveWorkflowProjection } from "./workflowProjection";

const turnId = TurnId.make("turn-workflow");

function activity(
  id: string,
  sequence: number,
  kind: string,
  payload: Record<string, unknown>,
  summary = "Subagent task",
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    sequence,
    kind,
    payload,
    summary,
    tone: "tool",
    turnId,
    createdAt: new Date(Date.UTC(2026, 6, 23, 12, 0, sequence)).toISOString(),
  };
}

function codexAgentActivity(
  id: string,
  sequence: number,
  input: {
    readonly agentThreadId: string;
    readonly agentPath: string;
    readonly kind: "started" | "interacted" | "interrupted";
  },
): OrchestrationThreadActivity {
  return activity(
    id,
    sequence,
    "tool.completed",
    {
      itemType: "collab_agent_tool_call",
      itemId: `provider-item-${id}`,
      detail: `${input.kind} ${input.agentPath}`,
      data: {
        item: {
          type: "subAgentActivity",
          id: `provider-item-${id}`,
          ...input,
        },
      },
    },
    "Subagent task",
  );
}

describe("deriveWorkflowProjection", () => {
  it("does not infer Codex parentage from similarly prefixed paths", () => {
    const parent = codexAgentActivity("event-parent", 1, {
      agentThreadId: "thread-worker",
      agentPath: "workers",
      kind: "started",
    });
    const child = codexAgentActivity("event-child", 2, {
      agentThreadId: "thread-audit",
      agentPath: "workers/audit",
      kind: "started",
    });
    const interacted = codexAgentActivity("event-interacted", 3, {
      agentThreadId: "thread-audit",
      agentPath: "workers/audit",
      kind: "interacted",
    });

    const snapshot = deriveWorkflowProjection({
      activities: [interacted, child, parent],
      turnId,
      providerName: "codex",
    });

    expect(snapshot.fidelity).toBe("live");
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.nodes.find((node) => node.id === "agent:thread-audit")).toMatchObject({
      parentId: null,
      path: "workers/audit",
      name: "audit",
      status: "running",
      activityCount: 2,
    });
  });

  it("is reconnect-safe under replay, ordering changes, and stale starts after a terminal event", () => {
    const started = codexAgentActivity("event-started", 1, {
      agentThreadId: "thread-audit",
      agentPath: "workers/audit",
      kind: "started",
    });
    const interrupted = codexAgentActivity("event-interrupted", 2, {
      agentThreadId: "thread-audit",
      agentPath: "workers/audit",
      kind: "interrupted",
    });
    const staleStart = codexAgentActivity("event-stale-start", 3, {
      agentThreadId: "thread-audit",
      agentPath: "workers/audit",
      kind: "started",
    });

    const snapshot = deriveWorkflowProjection({
      activities: [staleStart, interrupted, started, interrupted],
      turnId,
      providerName: "codex",
    });

    expect(snapshot.nodes).toHaveLength(1);
    expect(snapshot.nodes[0]).toMatchObject({
      id: "agent:thread-audit",
      status: "interrupted",
      activityCount: 2,
    });
    expect(snapshot.recentActivities).toHaveLength(2);
  });

  it("keeps the first terminal lifecycle result when replay later conflicts", () => {
    const interrupted = codexAgentActivity("event-interrupted-first", 1, {
      agentThreadId: "thread-audit",
      agentPath: "workers/audit",
      kind: "interrupted",
    });
    const failed = activity("event-failed-later", 2, "tool.completed", {
      itemType: "collab_agent_tool_call",
      data: {
        item: {
          type: "collabAgentToolCall",
          receiverThreadIds: ["thread-audit"],
          status: "failed",
        },
      },
    });

    const snapshot = deriveWorkflowProjection({
      activities: [failed, interrupted],
      turnId,
      providerName: "codex",
    });

    expect(snapshot.nodes[0]?.status).toBe("interrupted");
  });

  it("normalizes collaboration path separators without creating inferred edges", () => {
    const parent = codexAgentActivity("event-parent-windows", 1, {
      agentThreadId: "thread-worker",
      agentPath: "workers",
      kind: "started",
    });
    const child = codexAgentActivity("event-child-windows", 2, {
      agentThreadId: "thread-audit",
      agentPath: "workers\\audit",
      kind: "started",
    });

    const snapshot = deriveWorkflowProjection({
      activities: [child, parent],
      turnId,
      providerName: "codex",
    });

    expect(snapshot.nodes.find((node) => node.id === "agent:thread-audit")).toMatchObject({
      path: "workers/audit",
      parentId: null,
      name: "audit",
    });
  });

  it("uses Claude task progress without inventing hierarchy or local duration", () => {
    const started = activity(
      "task-started",
      1,
      "task.started",
      {
        taskId: "claude-task-1",
        taskType: "subagent",
        detail: "Audit the provider adapter",
      },
      "subagent task started",
    );
    const progress = activity(
      "task-progress",
      2,
      "task.progress",
      {
        taskId: "claude-task-1",
        detail: "Reviewing lifecycle fixtures",
        usage: { durationMs: 2_450 },
      },
      "Reasoning update",
    );
    const completed = activity(
      "task-completed",
      3,
      "task.completed",
      {
        taskId: "claude-task-1",
        status: "completed",
        detail: "Audit complete",
      },
      "Task completed",
    );

    const snapshot = deriveWorkflowProjection({
      activities: [started, progress, completed],
      turnId,
      providerName: "claudeAgent",
    });

    expect(snapshot.fidelity).toBe("live");
    expect(snapshot.nodes[0]).toMatchObject({
      parentId: null,
      path: null,
      status: "completed",
      elapsedSeconds: 2,
    });
  });

  it("preserves provider lifecycle start evidence and reports provider/model routing metadata", () => {
    const started = codexAgentActivity("event-idle-start", 1, {
      agentThreadId: "thread-idle",
      agentPath: "workers/idle",
      kind: "started",
    });
    const idle = activity("event-idle", 2, "tool.completed", {
      itemType: "collab_agent_tool_call",
      data: {
        item: {
          type: "collabAgentToolCall",
          receiverThreadIds: ["thread-idle"],
          agentsStates: { "thread-idle": { status: "idle" } },
        },
      },
    });

    const snapshot = deriveWorkflowProjection({
      activities: [idle, started],
      turnId,
      providerName: "codex",
      modelName: "gpt-5.6-codex",
    });

    expect(snapshot.providerLabel).toBe("codex");
    expect(snapshot.modelLabel).toBe("gpt-5.6-codex");
    expect(snapshot.nodes[0]).toMatchObject({
      status: "idle",
      startedAt: started.createdAt,
      lastActivityAt: idle.createdAt,
    });
  });

  it("shows lifecycle-only and not-reported fidelity honestly", () => {
    const claudeTool = activity(
      "claude-agent-call",
      1,
      "tool.started",
      {
        itemType: "collab_agent_tool_call",
        itemId: "tool-use-1",
        detail: "Audit the renderer",
      },
      "Subagent task started",
    );

    expect(
      deriveWorkflowProjection({
        activities: [claudeTool],
        turnId,
        providerName: "claudeAgent",
      }),
    ).toMatchObject({
      fidelity: "lifecycle-only",
      nodes: [{ path: null, parentId: null, elapsedSeconds: null, status: "running" }],
    });
    expect(
      deriveWorkflowProjection({
        activities: [
          activity("command", 1, "tool.started", {
            itemType: "command_execution",
            itemId: "command-1",
          }),
        ],
        turnId,
        providerName: "other",
      }),
    ).toMatchObject({
      fidelity: "not-reported",
      nodes: [],
      recentActivities: [],
    });
  });

  it("never copies raw prompts or provider data into display fields", () => {
    const snapshot = deriveWorkflowProjection({
      activities: [
        activity(
          "claude-secret",
          1,
          "tool.started",
          {
            itemType: "collab_agent_tool_call",
            itemId: "tool-use-secret",
            detail: "Safe task label",
            data: {
              input: {
                prompt: "DO NOT EXPOSE SECRET PROMPT",
                subagent_type: "auditor",
              },
              reasoning: "PRIVATE CHAIN OF THOUGHT",
            },
          },
          "Subagent task started",
        ),
      ],
      turnId,
      providerName: "claudeAgent",
    });

    expect(JSON.stringify(snapshot)).not.toContain("DO NOT EXPOSE");
    expect(JSON.stringify(snapshot)).not.toContain("PRIVATE CHAIN");
    expect(snapshot.nodes[0]).toMatchObject({
      name: "auditor",
      taskLabel: "Safe task label",
    });
  });

  it("bounds nodes and recent activity for long reconnect histories", () => {
    const activities = Array.from(
      { length: WORKFLOW_PROJECTION_MAX_RECENT_ACTIVITIES + 25 },
      (_, index) =>
        codexAgentActivity(`event-${index}`, index, {
          agentThreadId: `thread-${index}`,
          agentPath: `workers/agent-${index}`,
          kind: "started",
        }),
    );

    const snapshot = deriveWorkflowProjection({
      activities,
      turnId,
      providerName: "codex",
    });

    expect(snapshot.nodes).toHaveLength(WORKFLOW_PROJECTION_MAX_NODES);
    expect(snapshot.recentActivities).toHaveLength(WORKFLOW_PROJECTION_MAX_RECENT_ACTIVITIES);
    expect(snapshot.omittedNodeCount).toBe(activities.length - WORKFLOW_PROJECTION_MAX_NODES);
    expect(snapshot.omittedActivityCount).toBe(
      activities.length - WORKFLOW_PROJECTION_MAX_RECENT_ACTIVITIES,
    );
  });

  it("keeps other turns out of the current reconnect projection", () => {
    const current = codexAgentActivity("event-current", 1, {
      agentThreadId: "thread-current",
      agentPath: "workers/current",
      kind: "started",
    });
    const other = {
      ...codexAgentActivity("event-other", 2, {
        agentThreadId: "thread-other",
        agentPath: "workers/other",
        kind: "started",
      }),
      turnId: TurnId.make("turn-other"),
    };

    const snapshot = deriveWorkflowProjection({
      activities: [other, current],
      turnId,
      providerName: "codex",
    });

    expect(snapshot.nodes.map((node) => node.id)).toEqual(["agent:thread-current"]);
  });

  it("does not register the Codex root activity target as its own child", () => {
    const snapshot = deriveWorkflowProjection({
      activities: [
        codexAgentActivity("event-root", 1, {
          agentThreadId: "thread-root",
          agentPath: "/root",
          kind: "interacted",
        }),
      ],
      turnId,
      providerName: "codex",
    });

    expect(snapshot).toMatchObject({
      fidelity: "not-reported",
      nodes: [],
      recentActivities: [],
    });
  });
});
