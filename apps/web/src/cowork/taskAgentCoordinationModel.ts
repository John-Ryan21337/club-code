import {
  COLLABORATION_TASK_PROJECT_LIMIT,
  type CollaborationSharedTask,
  type SharedProjectId,
} from "@cafecode/contracts";
import { DateTime } from "effect";

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
  readonly attempt: number;
  readonly projectId: SharedProjectId;
  readonly cursor: SharedTaskCursor;
}

export interface SharedTaskCommandTicket {
  readonly generation: number;
  readonly attempt: number;
  readonly projectId: SharedProjectId;
  readonly request: SharedTaskMutationRequest;
}

const copyTask = (task: CollaborationSharedTask): CollaborationSharedTask =>
  Object.freeze({
    ...task,
    dependencies: Object.freeze([...task.dependencies]),
    activeAgentLease:
      task.activeAgentLease === null ? null : Object.freeze({ ...task.activeAgentLease }),
  });

const copyRequest = (request: SharedTaskMutationRequest): SharedTaskMutationRequest =>
  Object.freeze({ ...request });

const copyCommandState = (state: SharedTaskCommandState): SharedTaskCommandState =>
  Object.freeze({ ...state });

const timestampMillis = (value: CollaborationSharedTask["updatedAt"]): number =>
  typeof value === "string" ? Date.parse(value) : DateTime.toEpochMillis(value);

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
    created: timestampMillis(task.createdAt),
    updated: timestampMillis(task.updatedAt),
  });

const requestFingerprint = (request: SharedTaskMutationRequest): string =>
  JSON.stringify([request.sharedProjectId, request.kind, request.taskId, request.expectedRevision]);

const immutableTaskFingerprint = (task: CollaborationSharedTask): string =>
  JSON.stringify([
    task.sharedProjectId,
    task.taskId,
    task.provenance,
    task.title,
    task.body,
    task.createdByUserId,
    timestampMillis(task.createdAt),
  ]);

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
  readonly #commandAttemptByTaskId = new Map<string, number>();
  readonly #acceptedPageCursors = new Set<string>();
  #projectId: SharedProjectId;
  #generation = 1;
  #disposed = false;
  #pageAttempt = 0;
  #activePageAttempt: number | null = null;
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
    this.#commandAttemptByTaskId.clear();
    this.#revisionConflicts.clear();
    this.#acceptedPageCursors.clear();
    this.#nextCursor = null;
    this.#pageState = "idle";
    this.#pageMessage = null;
  }

  beginPage(cursor: SharedTaskCursor): SharedTaskPageTicket | null {
    if (this.#disposed || this.#pageState === "loading") return null;
    if (!isBoundedCursor(cursor) || (cursor !== null && cursor !== this.#nextCursor)) {
      this.#pageState = "error";
      this.#pageMessage = "The task cursor did not match the current bounded page chain.";
      return null;
    }
    this.#pageState = "loading";
    this.#pageMessage = null;
    this.#pageAttempt += 1;
    this.#activePageAttempt = this.#pageAttempt;
    return {
      generation: this.#generation,
      attempt: this.#pageAttempt,
      projectId: this.#projectId,
      cursor,
    };
  }

  acceptPage(ticket: SharedTaskPageTicket, page: SharedTaskPage): boolean {
    if (!this.#isCurrentPage(ticket)) return false;
    const priorCursors = ticket.cursor === null ? new Set<string>() : this.#acceptedPageCursors;
    if (
      page.sharedProjectId !== ticket.projectId ||
      page.requestCursor !== ticket.cursor ||
      page.tasks.length > SHARED_TASK_PAGE_LIMIT ||
      !isBoundedCursor(page.nextCursor) ||
      (ticket.cursor !== null &&
        this.#acceptedPageCursors.size >= COLLABORATION_TASK_PROJECT_LIMIT) ||
      (page.nextCursor !== null &&
        (page.nextCursor === ticket.cursor || priorCursors.has(page.nextCursor))) ||
      page.tasks.some((task) => task.sharedProjectId !== ticket.projectId) ||
      this.#tasks.size +
        new Set(
          page.tasks.filter((task) => !this.#tasks.has(task.taskId)).map((task) => task.taskId),
        ).size >
        COLLABORATION_TASK_PROJECT_LIMIT
    ) {
      this.#pageState = "error";
      this.#pageMessage = "The task page did not match the current project request.";
      this.#activePageAttempt = null;
      return true;
    }

    if (ticket.cursor === null) this.#acceptedPageCursors.clear();
    else this.#acceptedPageCursors.add(ticket.cursor);
    for (const task of page.tasks) {
      const merged = this.#mergeTask(copyTask(task));
      if (
        merged &&
        !this.#revisionConflicts.has(task.taskId) &&
        this.#commandByTaskId.get(task.taskId)?.kind === "conflict"
      ) {
        this.#commandByTaskId.set(task.taskId, { kind: "idle" });
      }
    }
    this.#nextCursor = page.nextCursor;
    this.#pageState = "idle";
    this.#pageMessage = null;
    this.#activePageAttempt = null;
    return true;
  }

  rejectPage(ticket: SharedTaskPageTicket, message = "Task coordination is unavailable."): boolean {
    if (!this.#isCurrentPage(ticket)) return false;
    this.#pageState = "error";
    this.#pageMessage = message;
    this.#activePageAttempt = null;
    return true;
  }

  beginCommand(request: SharedTaskMutationRequest): SharedTaskCommandTicket | null {
    if (this.#disposed || request.sharedProjectId !== this.#projectId) return null;
    const activeState = this.#commandByTaskId.get(request.taskId);
    if (activeState?.kind === "pending" || activeState?.kind === "conflict") return null;
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
    if (activeState?.kind === "retry" && requestFingerprint(activeState.request) !== fingerprint) {
      this.#commandByTaskId.set(request.taskId, {
        kind: "conflict",
        message: "Refresh before replacing an unacknowledged exact command.",
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
    const canonicalRequest =
      activeState?.kind === "retry" ? activeState.request : copyRequest(request);
    const attempt = (this.#commandAttemptByTaskId.get(request.taskId) ?? 0) + 1;
    this.#commandAttemptByTaskId.set(request.taskId, attempt);
    this.#commandFingerprints.set(request.commandId, fingerprint);
    this.#commandByTaskId.set(request.taskId, { kind: "pending", request: canonicalRequest });
    return {
      generation: this.#generation,
      attempt,
      projectId: this.#projectId,
      request: canonicalRequest,
    };
  }

  acceptCommand(ticket: SharedTaskCommandTicket, result: SharedTaskMutationResult): boolean {
    if (!this.#isCurrentCommand(ticket)) return false;
    if (
      result.sharedProjectId !== ticket.projectId ||
      result.commandId !== ticket.request.commandId ||
      result.task.taskId !== ticket.request.taskId ||
      result.task.sharedProjectId !== ticket.projectId ||
      result.task.revision !== ticket.request.expectedRevision + 1
    ) {
      this.#commandByTaskId.set(ticket.request.taskId, {
        kind: "conflict",
        message: "The command response did not match the exact submitted intent.",
      });
      return true;
    }
    this.#mergeTask(copyTask(result.task));
    this.#commandByTaskId.set(ticket.request.taskId, { kind: "idle" });
    return true;
  }

  rejectCommand(
    ticket: SharedTaskCommandTicket,
    failure: { readonly kind: "retry" | "conflict"; readonly message: string },
  ): boolean {
    if (!this.#isCurrentCommand(ticket)) return false;
    this.#commandByTaskId.set(
      ticket.request.taskId,
      failure.kind === "retry"
        ? { kind: "retry", request: ticket.request, message: failure.message }
        : { kind: "conflict", message: failure.message },
    );
    return true;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#activePageAttempt = null;
    if (this.#pageState === "loading") this.#pageState = "idle";
    for (const [taskId, state] of this.#commandByTaskId) {
      if (state.kind === "pending") {
        this.#commandByTaskId.set(taskId, {
          kind: "retry",
          request: state.request,
          message: "No acknowledgement was received. Retry sends the same ID.",
        });
      }
    }
  }

  activate(): void {
    if (!this.#disposed) return;
    this.#disposed = false;
    this.#generation += 1;
  }

  snapshot(): SharedTaskAgentSnapshot {
    return {
      projectId: this.#projectId,
      tasks: Object.freeze(
        Array.from(this.#tasks.values()).toSorted((left, right) =>
          left.taskId.localeCompare(right.taskId),
        ),
      ),
      nextCursor: this.#nextCursor,
      pageState: this.#pageState,
      pageMessage: this.#pageMessage,
      commandByTaskId: new Map(
        Array.from(this.#commandByTaskId, ([taskId, state]) => [taskId, copyCommandState(state)]),
      ),
      revisionConflicts: new Set(this.#revisionConflicts),
    };
  }

  #mergeTask(task: CollaborationSharedTask): boolean {
    if (task.sharedProjectId !== this.#projectId) return false;
    const key = task.taskId;
    const current = this.#tasks.get(key);
    if (current === undefined || task.revision > current.revision) {
      if (
        current !== undefined &&
        (task.fencingToken <= current.fencingToken ||
          immutableTaskFingerprint(task) !== immutableTaskFingerprint(current) ||
          timestampMillis(task.updatedAt) < timestampMillis(current.updatedAt) ||
          (task.activeAgentLease !== null &&
            current.activeAgentLease !== null &&
            task.activeAgentLease.membershipEpoch < current.activeAgentLease.membershipEpoch))
      ) {
        this.#revisionConflicts.add(key);
        return false;
      }
      this.#tasks.set(key, task);
      this.#revisionConflicts.delete(key);
      return true;
    }
    if (task.revision < current.revision) return false;
    if (taskFingerprint(task) !== taskFingerprint(current)) {
      this.#revisionConflicts.add(key);
      return false;
    }
    this.#revisionConflicts.delete(key);
    return true;
  }

  #isCurrent(generation: number, projectId: SharedProjectId): boolean {
    return !this.#disposed && generation === this.#generation && projectId === this.#projectId;
  }

  #isCurrentPage(ticket: SharedTaskPageTicket): boolean {
    return (
      this.#isCurrent(ticket.generation, ticket.projectId) &&
      ticket.attempt === this.#activePageAttempt
    );
  }

  #isCurrentCommand(ticket: SharedTaskCommandTicket): boolean {
    const state = this.#commandByTaskId.get(ticket.request.taskId);
    return (
      this.#isCurrent(ticket.generation, ticket.projectId) &&
      ticket.attempt === this.#commandAttemptByTaskId.get(ticket.request.taskId) &&
      state?.kind === "pending" &&
      state.request === ticket.request
    );
  }
}

export const classifySharedTaskClientError = (
  error: unknown,
): { readonly kind: "retry" | "conflict"; readonly message: string } => {
  try {
    if (
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      (error as { readonly reason?: unknown }).reason === "revision-conflict"
    ) {
      return { kind: "conflict", message: "This task changed elsewhere. Refresh before retrying." };
    }
  } catch {}
  return { kind: "retry", message: "No acknowledgement was received. Retry sends the same ID." };
};
