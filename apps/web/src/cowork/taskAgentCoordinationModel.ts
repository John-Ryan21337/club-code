import {
  COLLABORATION_TASK_PROJECT_LIMIT,
  type CollaborationSharedTask,
  type SharedProjectId,
} from "@cafecode/contracts";

export const SHARED_TASK_PAGE_LIMIT = 128;
export const SHARED_TASK_VISIBLE_AGENT_LEASE_LIMIT = 8;

export type SharedTaskCursor = string | null;

export interface SharedTaskPage {
  readonly sharedProjectId: SharedProjectId;
  readonly requestCursor: SharedTaskCursor;
  readonly tasks: ReadonlyArray<CollaborationSharedTask>;
  readonly nextCursor: SharedTaskCursor;
}

export interface SharedTaskMutationRequest {
  readonly sharedProjectId: SharedProjectId;
  readonly commandId: string;
  readonly kind: "claim" | "complete";
  readonly taskId: CollaborationSharedTask["taskId"];
  readonly expectedRevision: number;
}

export interface SharedTaskMutationResult {
  readonly sharedProjectId: SharedProjectId;
  readonly commandId: string;
  readonly task: CollaborationSharedTask;
}

export interface SharedTaskAgentClient {
  readonly readPage: (request: {
    readonly sharedProjectId: SharedProjectId;
    readonly cursor: SharedTaskCursor;
    readonly limit: typeof SHARED_TASK_PAGE_LIMIT;
  }) => Promise<SharedTaskPage>;
  readonly dispatch: (request: SharedTaskMutationRequest) => Promise<SharedTaskMutationResult>;
}

export type SharedTaskCommandState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending"; readonly request: SharedTaskMutationRequest }
  | {
      readonly kind: "retry";
      readonly request: SharedTaskMutationRequest;
      readonly message: string;
    }
  | { readonly kind: "conflict"; readonly message: string };

export interface SharedTaskAgentSnapshot {
  readonly projectId: SharedProjectId;
  readonly tasks: ReadonlyArray<CollaborationSharedTask>;
  readonly nextCursor: SharedTaskCursor;
  readonly pageState: "idle" | "loading" | "error";
  readonly pageMessage: string | null;
  readonly commandByTaskId: ReadonlyMap<string, SharedTaskCommandState>;
  readonly revisionConflicts: ReadonlySet<string>;
}

export interface SharedTaskPageTicket {
  readonly generation: number;
  readonly projectId: SharedProjectId;
  readonly cursor: SharedTaskCursor;
}

export interface SharedTaskCommandTicket {
  readonly generation: number;
  readonly projectId: SharedProjectId;
  readonly request: SharedTaskMutationRequest;
}

const taskFingerprint = (task: CollaborationSharedTask): string =>
  JSON.stringify({
    project: task.sharedProjectId,
    task: task.taskId,
    provenance: task.provenance,
    title: task.title,
    body: task.body,
    status: task.status,
    owner: task.ownerUserId,
    dependencies: task.dependencies,
    revision: task.revision,
    fence: task.fencingToken,
    lease:
      task.activeAgentLease === null
        ? null
        : {
            lease: task.activeAgentLease.leaseId,
            agent: task.activeAgentLease.agentId,
            holder: task.activeAgentLease.holderUserId,
            device: task.activeAgentLease.holderDeviceId,
            epoch: task.activeAgentLease.membershipEpoch,
            fence: task.activeAgentLease.fencingToken,
            granted: String(task.activeAgentLease.grantedAt),
            expires: String(task.activeAgentLease.expiresAt),
          },
    creator: task.createdByUserId,
    created: String(task.createdAt),
    updated: String(task.updatedAt),
  });

const requestFingerprint = (request: SharedTaskMutationRequest): string =>
  JSON.stringify([request.sharedProjectId, request.kind, request.taskId, request.expectedRevision]);

const isBoundedOpaqueIdentifier = (value: string): boolean =>
  value.length > 0 && value.length <= 256 && /^[A-Za-z0-9._:-]+$/u.test(value);

const isBoundedCursor = (cursor: SharedTaskCursor): boolean =>
  cursor === null || isBoundedOpaqueIdentifier(cursor);

const isBoundedCommandId = (value: string): boolean =>
  value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/u.test(value);

export class SharedTaskAgentCoordinationModel {
  readonly #tasks = new Map<string, CollaborationSharedTask>();
  readonly #commandByTaskId = new Map<string, SharedTaskCommandState>();
  readonly #commandFingerprints = new Map<string, string>();
  readonly #revisionConflicts = new Set<string>();
  #projectId: SharedProjectId;
  #generation = 1;
  #disposed = false;
  #nextCursor: SharedTaskCursor = null;
  #pageState: SharedTaskAgentSnapshot["pageState"] = "idle";
  #pageMessage: string | null = null;

  constructor(projectId: SharedProjectId) {
    this.#projectId = projectId;
  }

  selectProject(projectId: SharedProjectId): void {
    if (this.#disposed || projectId === this.#projectId) return;
    this.#projectId = projectId;
    this.#generation += 1;
    this.#tasks.clear();
    this.#commandByTaskId.clear();
    this.#commandFingerprints.clear();
    this.#revisionConflicts.clear();
    this.#nextCursor = null;
    this.#pageState = "idle";
    this.#pageMessage = null;
  }

  beginPage(cursor: SharedTaskCursor): SharedTaskPageTicket | null {
    if (this.#disposed || this.#pageState === "loading") return null;
    this.#pageState = "loading";
    this.#pageMessage = null;
    return { generation: this.#generation, projectId: this.#projectId, cursor };
  }

  acceptPage(ticket: SharedTaskPageTicket, page: SharedTaskPage): boolean {
    if (!this.#isCurrent(ticket.generation, ticket.projectId)) return false;
    if (
      page.sharedProjectId !== ticket.projectId ||
      page.requestCursor !== ticket.cursor ||
      page.tasks.length > SHARED_TASK_PAGE_LIMIT ||
      !isBoundedCursor(page.nextCursor) ||
      page.tasks.some((task) => task.sharedProjectId !== ticket.projectId) ||
      this.#tasks.size +
        new Set(
          page.tasks.filter((task) => !this.#tasks.has(task.taskId)).map((task) => task.taskId),
        ).size >
        COLLABORATION_TASK_PROJECT_LIMIT
    ) {
      this.#pageState = "error";
      this.#pageMessage = "The task page did not match the current project request.";
      return true;
    }

    for (const task of page.tasks) this.#mergeTask(task);
    this.#nextCursor = page.nextCursor;
    this.#pageState = "idle";
    this.#pageMessage = null;
    return true;
  }

  rejectPage(ticket: SharedTaskPageTicket, message = "Task coordination is unavailable."): boolean {
    if (!this.#isCurrent(ticket.generation, ticket.projectId)) return false;
    this.#pageState = "error";
    this.#pageMessage = message;
    return true;
  }

  beginCommand(request: SharedTaskMutationRequest): SharedTaskCommandTicket | null {
    if (this.#disposed || request.sharedProjectId !== this.#projectId) return null;
    const fingerprint = requestFingerprint(request);
    const priorFingerprint = this.#commandFingerprints.get(request.commandId);
    if (!isBoundedCommandId(request.commandId)) {
      this.#commandByTaskId.set(request.taskId, {
        kind: "conflict",
        message: "The command ID is not a bounded opaque identifier.",
      });
      return null;
    }
    if (priorFingerprint !== undefined && priorFingerprint !== fingerprint) {
      this.#commandByTaskId.set(request.taskId, {
        kind: "conflict",
        message: "That command ID is already bound to different task intent.",
      });
      return null;
    }
    const current = this.#tasks.get(request.taskId);
    if (
      priorFingerprint === undefined &&
      (current === undefined ||
        current.revision !== request.expectedRevision ||
        this.#revisionConflicts.has(request.taskId))
    ) {
      this.#commandByTaskId.set(request.taskId, {
        kind: "conflict",
        message: "The task revision is stale or conflicted. Refresh before acting.",
      });
      return null;
    }
    this.#commandFingerprints.set(request.commandId, fingerprint);
    this.#commandByTaskId.set(request.taskId, { kind: "pending", request });
    return { generation: this.#generation, projectId: this.#projectId, request };
  }

  acceptCommand(ticket: SharedTaskCommandTicket, result: SharedTaskMutationResult): boolean {
    if (!this.#isCurrent(ticket.generation, ticket.projectId)) return false;
    if (
      result.sharedProjectId !== ticket.projectId ||
      result.commandId !== ticket.request.commandId ||
      result.task.taskId !== ticket.request.taskId ||
      result.task.sharedProjectId !== ticket.projectId ||
      result.task.revision <= ticket.request.expectedRevision
    ) {
      this.#commandByTaskId.set(ticket.request.taskId, {
        kind: "conflict",
        message: "The command response did not match the exact submitted intent.",
      });
      return true;
    }
    this.#mergeTask(result.task);
    this.#commandByTaskId.set(ticket.request.taskId, { kind: "idle" });
    return true;
  }

  rejectCommand(
    ticket: SharedTaskCommandTicket,
    failure: { readonly kind: "retry" | "conflict"; readonly message: string },
  ): boolean {
    if (!this.#isCurrent(ticket.generation, ticket.projectId)) return false;
    this.#commandByTaskId.set(
      ticket.request.taskId,
      failure.kind === "retry"
        ? { kind: "retry", request: ticket.request, message: failure.message }
        : { kind: "conflict", message: failure.message },
    );
    return true;
  }

  dispose(): void {
    this.#disposed = true;
    this.#generation += 1;
  }

  snapshot(): SharedTaskAgentSnapshot {
    return {
      projectId: this.#projectId,
      tasks: Array.from(this.#tasks.values()).toSorted((left, right) =>
        left.taskId.localeCompare(right.taskId),
      ),
      nextCursor: this.#nextCursor,
      pageState: this.#pageState,
      pageMessage: this.#pageMessage,
      commandByTaskId: new Map(this.#commandByTaskId),
      revisionConflicts: new Set(this.#revisionConflicts),
    };
  }

  #mergeTask(task: CollaborationSharedTask): void {
    if (task.sharedProjectId !== this.#projectId) return;
    const key = task.taskId;
    const current = this.#tasks.get(key);
    if (current === undefined || task.revision > current.revision) {
      this.#tasks.set(key, task);
      this.#revisionConflicts.delete(key);
      return;
    }
    if (task.revision < current.revision) return;
    if (taskFingerprint(task) !== taskFingerprint(current)) this.#revisionConflicts.add(key);
  }

  #isCurrent(generation: number, projectId: SharedProjectId): boolean {
    return !this.#disposed && generation === this.#generation && projectId === this.#projectId;
  }
}

export const classifySharedTaskClientError = (
  error: unknown,
): { readonly kind: "retry" | "conflict"; readonly message: string } => {
  if (
    typeof error === "object" &&
    error !== null &&
    "reason" in error &&
    (error as { readonly reason?: unknown }).reason === "revision-conflict"
  ) {
    return { kind: "conflict", message: "This task changed elsewhere. Refresh before retrying." };
  }
  return { kind: "retry", message: "No acknowledgement was received. Retry sends the same ID." };
};
