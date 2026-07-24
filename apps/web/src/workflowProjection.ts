import type {
  OrchestrationThreadActivity,
  WorkflowAgentNode,
  WorkflowAgentStatus,
  WorkflowProjectionSnapshot,
  WorkflowRecentActivity,
} from "@cafecode/contracts";
import {
  WORKFLOW_PROJECTION_MAX_NODES,
  WORKFLOW_PROJECTION_MAX_RECENT_ACTIVITIES,
  WORKFLOW_PROJECTION_MAX_TEXT_CHARS,
} from "@cafecode/contracts";

interface WorkflowProjectionInput {
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  readonly turnId?: string | null;
  readonly providerName?: string | null;
  readonly modelName?: string | null;
}

interface MutableWorkflowNode {
  id: string;
  parentCandidateId: string | null;
  path: string | null;
  name: string | null;
  taskLabel: string | null;
  status: WorkflowAgentStatus;
  startedAt: string | null;
  elapsedSeconds: number | null;
  latestActivitySummary: string | null;
  lastActivityAt: string | null;
  activityCount: number;
  depth: number;
}

interface WorkflowNodeUpdate {
  readonly id: string;
  readonly parentCandidateId?: string | null;
  readonly path?: string | null;
  readonly name?: string | null;
  readonly taskLabel?: string | null;
  readonly status?: WorkflowAgentStatus;
  readonly elapsedSeconds?: number | null;
  readonly isLive: boolean;
}

const TERMINAL_STATUSES = new Set<WorkflowAgentStatus>(["completed", "failed", "interrupted"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return normalized.slice(0, WORKFLOW_PROJECTION_MAX_TEXT_CHARS);
}

function recordAt(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function stringArray(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const text = boundedText(entry);
    return text ? [text] : [];
  });
}

function explicitElapsedSeconds(
  ...records: ReadonlyArray<Record<string, unknown> | null>
): number | null {
  for (const record of records) {
    if (!record) continue;
    const seconds = record.elapsedSeconds ?? record.durationSeconds;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) {
      return Math.floor(seconds);
    }
    const milliseconds = record.durationMs ?? record.duration_ms;
    if (typeof milliseconds === "number" && Number.isFinite(milliseconds) && milliseconds >= 0) {
      return Math.floor(milliseconds / 1_000);
    }
  }
  return null;
}

function statusFromValue(value: unknown): WorkflowAgentStatus | null {
  switch (value) {
    case "pending":
    case "pendingInit":
    case "queued":
      return "queued";
    case "inProgress":
    case "running":
      return "running";
    case "waiting":
      return "waiting";
    case "idle":
    case "ready":
      return "idle";
    case "completed":
    case "shutdown":
      return "completed";
    case "failed":
    case "errored":
      return "failed";
    case "interrupted":
    case "stopped":
    case "cancelled":
      return "interrupted";
    case "notFound":
    case "unknown":
      return "unknown";
    default:
      return null;
  }
}

function statusFromSubAgentKind(value: unknown): WorkflowAgentStatus | null {
  switch (value) {
    case "started":
    case "interacted":
      return "running";
    case "interrupted":
      return "interrupted";
    default:
      return null;
  }
}

function pathDepth(path: string | null): number {
  if (!path) return 0;
  return Math.min(
    32,
    path
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean).length,
  );
}

/**
 * Collaboration paths are provider identifiers, not filesystem paths. Normalize
 * separators so reconnects from Windows and POSIX hosts use one node hierarchy.
 */
function normalizeAgentPath(path: string | null): string | null {
  if (!path) return null;
  const segments = path
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.length > 0 ? segments.join("/") : null;
}

function nameFromPath(path: string | null): string | null {
  if (!path) return null;
  const segments = path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return segments.at(-1) ?? null;
}

function isRootAgentPath(path: string | null): boolean {
  return normalizeAgentPath(path) === "root";
}

function activityOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (
    left.sequence !== undefined &&
    right.sequence !== undefined &&
    left.sequence !== right.sequence
  ) {
    return left.sequence - right.sequence;
  }
  const byTime = left.createdAt.localeCompare(right.createdAt);
  return byTime !== 0 ? byTime : String(left.id).localeCompare(String(right.id));
}

function isCollaborationPayload(payload: Record<string, unknown>): boolean {
  return payload.itemType === "collab_agent_tool_call";
}

function taskUpdates(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
  providerName: string | null | undefined,
): ReadonlyArray<WorkflowNodeUpdate> {
  if (
    providerName !== "claudeAgent" ||
    (activity.kind !== "task.started" &&
      activity.kind !== "task.progress" &&
      activity.kind !== "task.completed")
  ) {
    return [];
  }
  const taskId = boundedText(payload.taskId);
  if (!taskId) return [];

  const usage = recordAt(payload, "usage");
  const taskLabel = boundedText(payload.detail) ?? boundedText(payload.summary);
  const explicitStatus =
    activity.kind === "task.completed"
      ? (statusFromValue(payload.status) ?? "completed")
      : activity.kind === "task.started" || activity.kind === "task.progress"
        ? "running"
        : "unknown";

  return [
    {
      id: `task:${taskId}`,
      taskLabel,
      status: explicitStatus,
      elapsedSeconds: explicitElapsedSeconds(payload, usage),
      isLive: activity.kind === "task.progress",
    },
  ];
}

function collaborationUpdates(
  activity: OrchestrationThreadActivity,
  payload: Record<string, unknown>,
): ReadonlyArray<WorkflowNodeUpdate> {
  if (!activity.kind.startsWith("tool.") || !isCollaborationPayload(payload)) return [];

  const data = recordAt(payload, "data");
  const item = recordAt(data, "item");
  if (item?.type === "subAgentActivity") {
    const agentThreadId = boundedText(item.agentThreadId);
    const agentPath = normalizeAgentPath(boundedText(item.agentPath));
    if (isRootAgentPath(agentPath)) return [];
    const itemId = boundedText(item.id) ?? boundedText(payload.itemId);
    const id = agentThreadId
      ? `agent:${agentThreadId}`
      : agentPath
        ? `path:${agentPath}`
        : itemId
          ? `item:${itemId}`
          : null;
    if (!id) return [];
    return [
      {
        id,
        path: agentPath,
        name: nameFromPath(agentPath),
        status: statusFromSubAgentKind(item.kind) ?? "unknown",
        elapsedSeconds: explicitElapsedSeconds(payload, item),
        isLive: agentPath !== null,
      },
    ];
  }

  if (item?.type === "collabAgentToolCall") {
    const receiverIds = stringArray(item.receiverThreadIds);
    const agentsStates = recordAt(item, "agentsStates");
    const senderId = boundedText(item.senderThreadId);
    const correlatedIds = new Set([...receiverIds, ...Object.keys(agentsStates ?? {})]);
    return Array.from(correlatedIds)
      .slice(0, WORKFLOW_PROJECTION_MAX_NODES)
      .map((agentId) => {
        const state = agentsStates && recordAt(agentsStates, agentId);
        return {
          id: `agent:${agentId}`,
          parentCandidateId: senderId ? `agent:${senderId}` : null,
          status: statusFromValue(state?.status) ?? statusFromValue(item.status) ?? "unknown",
          elapsedSeconds: explicitElapsedSeconds(payload, item),
          isLive: true,
        };
      });
  }

  const itemId = boundedText(payload.itemId);
  if (!itemId) return [];
  const claudeInput = recordAt(data, "input");
  const taskLabel = boundedText(payload.detail);
  const name = boundedText(claudeInput?.subagent_type);
  const status =
    statusFromValue(payload.status) ??
    (activity.kind === "tool.completed"
      ? "completed"
      : activity.kind === "tool.started" || activity.kind === "tool.updated"
        ? "running"
        : "unknown");
  return [
    {
      id: `item:${itemId}`,
      name,
      taskLabel,
      status,
      elapsedSeconds: explicitElapsedSeconds(payload, data),
      isLive: activity.kind === "tool.updated",
    },
  ];
}

function applyStatus(
  current: WorkflowAgentStatus,
  incoming: WorkflowAgentStatus | undefined,
): WorkflowAgentStatus {
  if (!incoming) return current;
  // Reconnect/replay streams can contain stale starts and conflicting terminal
  // records after the authoritative lifecycle result.
  if (TERMINAL_STATUSES.has(current)) return current;
  return incoming;
}

function upsertNode(
  nodes: Map<string, MutableWorkflowNode>,
  update: WorkflowNodeUpdate,
  activity: OrchestrationThreadActivity,
): boolean {
  const summary =
    boundedText(isRecord(activity.payload) ? activity.payload.detail : null) ??
    boundedText(activity.summary);
  const existing = nodes.get(update.id);
  if (existing) {
    if (
      TERMINAL_STATUSES.has(existing.status) &&
      update.status !== undefined &&
      !TERMINAL_STATUSES.has(update.status)
    ) {
      return false;
    }
    existing.parentCandidateId ??= update.parentCandidateId ?? null;
    existing.path ??= update.path ?? null;
    existing.name ??= update.name ?? null;
    existing.taskLabel ??= update.taskLabel ?? null;
    existing.status = applyStatus(existing.status, update.status);
    // The first provider/orchestration lifecycle event is the only safe start
    // marker we have. Keep it stable under reconnect replay.
    existing.startedAt ??= activity.createdAt;
    existing.elapsedSeconds ??= update.elapsedSeconds ?? null;
    existing.latestActivitySummary = summary ?? existing.latestActivitySummary;
    existing.lastActivityAt = activity.createdAt;
    existing.activityCount += 1;
    existing.depth = pathDepth(existing.path);
    return true;
  }
  if (nodes.size >= WORKFLOW_PROJECTION_MAX_NODES) return false;
  nodes.set(update.id, {
    id: update.id,
    parentCandidateId: update.parentCandidateId ?? null,
    path: update.path ?? null,
    name: update.name ?? null,
    taskLabel: update.taskLabel ?? null,
    status: update.status ?? "unknown",
    startedAt: activity.createdAt,
    elapsedSeconds: update.elapsedSeconds ?? null,
    latestActivitySummary: summary,
    lastActivityAt: activity.createdAt,
    activityCount: 1,
    depth: pathDepth(update.path ?? null),
  });
  return true;
}

export function deriveWorkflowProjection({
  activities,
  turnId,
  providerName,
  modelName,
}: WorkflowProjectionInput): WorkflowProjectionSnapshot {
  const scopedActivities = activities
    .filter((activity) => turnId === undefined || activity.turnId === turnId)
    .toSorted(activityOrder);
  const seenActivityIds = new Set<string>();
  const deduplicatedActivities = scopedActivities.filter((activity) => {
    if (seenActivityIds.has(activity.id)) return false;
    seenActivityIds.add(activity.id);
    return true;
  });
  const nodes = new Map<string, MutableWorkflowNode>();
  const attemptedNodeIds = new Set<string>();
  const recentActivities: WorkflowRecentActivity[] = [];
  let liveSignalSeen = false;
  let recognizedUpdateCount = 0;

  for (const activity of deduplicatedActivities) {
    if (!isRecord(activity.payload)) continue;
    const updates = [
      ...collaborationUpdates(activity, activity.payload),
      ...taskUpdates(activity, activity.payload, providerName),
    ];
    if (updates.length === 0) continue;
    recognizedUpdateCount += updates.length;
    liveSignalSeen ||= updates.some((update) => update.isLive);
    for (const update of updates) {
      attemptedNodeIds.add(update.id);
      const nodeWasOmittedByCap =
        !nodes.has(update.id) && nodes.size >= WORKFLOW_PROJECTION_MAX_NODES;
      if (!upsertNode(nodes, update, activity) && !nodeWasOmittedByCap) continue;
      recentActivities.push({
        id: activity.id,
        nodeId: nodeWasOmittedByCap ? null : update.id,
        kind: boundedText(activity.kind) ?? "activity",
        summary: boundedText(activity.summary) ?? "Activity",
        tone: activity.tone,
        status: update.status ?? null,
        createdAt: activity.createdAt,
      });
      if (recentActivities.length > WORKFLOW_PROJECTION_MAX_RECENT_ACTIVITIES) {
        recentActivities.shift();
      }
    }
  }

  const immutableNodes: WorkflowAgentNode[] = Array.from(nodes.values()).map((node) => {
    // Paths are display metadata. A shared path prefix is not proof that one
    // agent spawned another, so graph edges require an explicit provider
    // parent identifier from the collaboration event.
    const parentId =
      node.parentCandidateId && nodes.has(node.parentCandidateId) ? node.parentCandidateId : null;
    return {
      id: node.id,
      parentId,
      path: node.path,
      name: node.name,
      taskLabel: node.taskLabel,
      status: node.status,
      startedAt: node.startedAt,
      elapsedSeconds: node.elapsedSeconds,
      latestActivitySummary: node.latestActivitySummary,
      lastActivityAt: node.lastActivityAt,
      activityCount: node.activityCount,
      depth: node.depth,
    };
  });

  return {
    version: 1,
    fidelity:
      immutableNodes.length === 0 ? "not-reported" : liveSignalSeen ? "live" : "lifecycle-only",
    nodes: immutableNodes,
    providerLabel: boundedText(providerName),
    modelLabel: boundedText(modelName),
    recentActivities: recentActivities.toReversed(),
    sourceActivityCount: scopedActivities.length,
    omittedNodeCount: Math.max(0, attemptedNodeIds.size - immutableNodes.length),
    omittedActivityCount: Math.max(
      0,
      recognizedUpdateCount - WORKFLOW_PROJECTION_MAX_RECENT_ACTIVITIES,
    ),
  };
}
