import type { CollaborationSharedTask, SharedProjectId } from "@cafecode/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  SHARED_TASK_PAGE_LIMIT,
  SHARED_TASK_VISIBLE_AGENT_LEASE_LIMIT,
  SharedTaskAgentCoordinationModel,
  classifySharedTaskClientError,
  type SharedTaskAgentClient,
  type SharedTaskAgentSnapshot,
  type SharedTaskCommandState,
  type SharedTaskCursor,
  type SharedTaskMutationRequest,
} from "../../cowork/taskAgentCoordinationModel";
import { Button } from "../ui/button";

export interface SharedTaskAgentPanelProps {
  readonly client: SharedTaskAgentClient | null;
  readonly sharedProjectId: SharedProjectId;
  readonly makeCommandId?: () => string;
}

export function SharedTaskAgentPanel(props: SharedTaskAgentPanelProps) {
  if (props.client === null) return null;
  return (
    <EnabledSharedTaskAgentPanel
      key={props.sharedProjectId}
      client={props.client}
      sharedProjectId={props.sharedProjectId}
      {...(props.makeCommandId === undefined ? {} : { makeCommandId: props.makeCommandId })}
    />
  );
}

function EnabledSharedTaskAgentPanel({
  client,
  sharedProjectId,
  makeCommandId,
}: Omit<SharedTaskAgentPanelProps, "client"> & { readonly client: SharedTaskAgentClient }) {
  const model = useMemo(
    () => new SharedTaskAgentCoordinationModel(sharedProjectId),
    [sharedProjectId],
  );
  const [snapshot, setSnapshot] = useState<SharedTaskAgentSnapshot>(() => model.snapshot());

  const publish = useCallback(() => setSnapshot(model.snapshot()), [model]);

  useEffect(() => {
    model.activate();
    publish();
    return () => model.dispose();
  }, [client, model, publish]);

  const loadPage = useCallback(
    async (cursor: SharedTaskCursor) => {
      const ticket = model.beginPage(cursor);
      if (ticket === null) return;
      publish();
      try {
        const page = await client.readPage({
          sharedProjectId,
          cursor,
          limit: SHARED_TASK_PAGE_LIMIT,
        });
        if (model.acceptPage(ticket, page)) publish();
      } catch {
        if (model.rejectPage(ticket)) publish();
      }
    },
    [client, model, publish, sharedProjectId],
  );

  useEffect(() => {
    void loadPage(null);
  }, [loadPage]);

  const dispatch = useCallback(
    async (request: SharedTaskMutationRequest) => {
      const ticket = model.beginCommand(request);
      publish();
      if (ticket === null) return;
      try {
        const result = await client.dispatch(ticket.request);
        if (model.acceptCommand(ticket, result)) publish();
      } catch (error) {
        if (model.rejectCommand(ticket, classifySharedTaskClientError(error))) publish();
      }
    },
    [client, model, publish],
  );

  const startCommand = useCallback(
    (task: CollaborationSharedTask, kind: SharedTaskMutationRequest["kind"]) => {
      const commandId = makeCommandId?.() ?? `task-ui:${crypto.randomUUID()}`;
      void dispatch({
        sharedProjectId,
        commandId,
        kind,
        taskId: task.taskId,
        expectedRevision: task.revision,
      });
    },
    [dispatch, makeCommandId, sharedProjectId],
  );

  const visibleLeaseTaskIds = new Set(
    snapshot.tasks
      .filter((task) => task.activeAgentLease !== null)
      .slice(0, SHARED_TASK_VISIBLE_AGENT_LEASE_LIMIT)
      .map((task) => task.taskId),
  );
  const leaseCount = snapshot.tasks.filter((task) => task.activeAgentLease !== null).length;

  return (
    <section
      aria-label="Shared task and agent coordination"
      aria-busy={snapshot.pageState === "loading"}
      className="flex min-h-0 flex-col gap-3 rounded-xl border border-border/70 bg-card/80 p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Shared coordination</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Operator-authored tasks only. Agent admission never starts from this panel.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={snapshot.pageState === "loading"}
          onClick={() => void loadPage(null)}
        >
          Refresh
        </Button>
      </header>

      <p className="sr-only">Current shared project: {sharedProjectId}</p>

      {snapshot.pageState === "loading" && snapshot.tasks.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading shared tasks…
        </p>
      ) : null}

      {snapshot.pageState === "error" ? (
        <div role="alert" className="rounded-md border border-amber-500/40 p-3 text-sm">
          <p>{snapshot.pageMessage}</p>
          <Button type="button" size="sm" className="mt-2" onClick={() => void loadPage(null)}>
            Retry task page
          </Button>
        </div>
      ) : null}

      {leaseCount > SHARED_TASK_VISIBLE_AGENT_LEASE_LIMIT ? (
        <p role="status" className="text-xs text-muted-foreground">
          Showing {SHARED_TASK_VISIBLE_AGENT_LEASE_LIMIT} of {leaseCount} recorded agent leases.
        </p>
      ) : null}

      {snapshot.tasks.length === 0 && snapshot.pageState !== "loading" ? (
        <p className="text-sm text-muted-foreground">No shared tasks are available.</p>
      ) : (
        <ul aria-label="Shared tasks" className="flex min-h-0 flex-col gap-2 overflow-auto">
          {snapshot.tasks.map((task) => (
            <SharedTaskRow
              key={task.taskId}
              task={task}
              commandState={snapshot.commandByTaskId.get(task.taskId) ?? { kind: "idle" }}
              revisionConflict={snapshot.revisionConflicts.has(task.taskId)}
              showLease={visibleLeaseTaskIds.has(task.taskId)}
              onStartCommand={startCommand}
              onRetryCommand={(request) => void dispatch(request)}
            />
          ))}
        </ul>
      )}

      {snapshot.nextCursor !== null && snapshot.pageState !== "error" ? (
        <Button
          type="button"
          variant="outline"
          disabled={snapshot.pageState === "loading"}
          onClick={() => void loadPage(snapshot.nextCursor)}
        >
          Load more tasks
        </Button>
      ) : null}
    </section>
  );
}

function SharedTaskRow({
  task,
  commandState,
  revisionConflict,
  showLease,
  onStartCommand,
  onRetryCommand,
}: {
  readonly task: CollaborationSharedTask;
  readonly commandState: SharedTaskCommandState;
  readonly revisionConflict: boolean;
  readonly showLease: boolean;
  readonly onStartCommand: (
    task: CollaborationSharedTask,
    kind: SharedTaskMutationRequest["kind"],
  ) => void;
  readonly onRetryCommand: (request: SharedTaskMutationRequest) => void;
}) {
  const lease = task.activeAgentLease;
  const isPending = commandState.kind === "pending";
  const commandBlocked = isPending || commandState.kind === "conflict" || revisionConflict;

  return (
    <li className="rounded-lg border border-border/60 bg-background/50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-medium text-foreground">{task.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {task.status} · revision {task.revision} · fence {task.fencingToken}
          </p>
        </div>
        <span className="max-w-full break-all rounded-full border border-border/60 px-2 py-0.5 text-[11px]">
          {task.ownerUserId === null ? "Unassigned" : `Owner ${task.ownerUserId}`}
        </span>
      </div>

      {task.dependencies.length > 0 ? (
        <p className="mt-2 break-words text-xs text-muted-foreground">
          Depends on: {task.dependencies.join(", ")}
        </p>
      ) : null}

      {lease !== null && showLease ? (
        <div className="mt-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-2 text-xs">
          <p>Agent {lease.agentId}</p>
          <p>
            Lease fence {lease.fencingToken} · membership epoch {lease.membershipEpoch}
          </p>
          <p className="font-medium text-amber-600 dark:text-amber-400">Admission: not started</p>
        </div>
      ) : null}

      {lease !== null && !showLease ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Lease record hidden by the eight-agent display cap.
        </p>
      ) : null}

      {revisionConflict ? (
        <p role="alert" className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          Conflicting snapshots have the same revision. Refresh before acting.
        </p>
      ) : null}

      {commandState.kind === "conflict" ? (
        <p role="alert" className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {commandState.message}
        </p>
      ) : null}

      {commandState.kind === "retry" ? (
        <div className="mt-2 text-xs">
          <p role="status">{commandState.message}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => onRetryCommand(commandState.request)}
          >
            Retry exact command
          </Button>
        </div>
      ) : null}

      <div className="mt-3 flex gap-2">
        {task.status === "open" ? (
          <Button
            type="button"
            size="sm"
            disabled={commandBlocked}
            onClick={() => onStartCommand(task, "claim")}
          >
            {isPending ? "Claiming…" : "Claim task"}
          </Button>
        ) : null}
        {task.status === "claimed" ? (
          <Button
            type="button"
            size="sm"
            disabled={commandBlocked}
            onClick={() => onStartCommand(task, "complete")}
          >
            {isPending ? "Completing…" : "Complete task"}
          </Button>
        ) : null}
      </div>
    </li>
  );
}
