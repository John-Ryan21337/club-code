import type {
  TimestampFormat,
  WorkflowAgentNode,
  WorkflowAgentStatus,
  WorkflowProjectionSnapshot,
  WorkflowRecentActivity,
} from "@cafecode/contracts";
import { LegendList } from "@legendapp/list/react";
import {
  BotIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  Clock3Icon,
  PauseIcon,
  StopCircleIcon,
} from "lucide-react";
import { memo, type ReactNode } from "react";

import type { ActivePlanState } from "../session-logic";
import { formatTimestamp } from "../timestampFormat";
import { Badge } from "./ui/badge";

function statusPresentation(status: WorkflowAgentStatus): {
  readonly icon: ReactNode;
  readonly label: string;
  readonly className: string;
} {
  switch (status) {
    case "queued":
      return {
        icon: <Clock3Icon aria-hidden="true" className="size-3.5" />,
        label: "Queued",
        className: "text-amber-400",
      };
    case "running":
      return {
        icon: <CircleDashedIcon aria-hidden="true" className="size-3.5" />,
        label: "Running",
        className: "text-blue-400",
      };
    case "waiting":
      return {
        icon: <PauseIcon aria-hidden="true" className="size-3.5" />,
        label: "Waiting",
        className: "text-violet-400",
      };
    case "completed":
      return {
        icon: <CheckIcon aria-hidden="true" className="size-3.5" />,
        label: "Completed",
        className: "text-emerald-400",
      };
    case "failed":
      return {
        icon: <CircleAlertIcon aria-hidden="true" className="size-3.5" />,
        label: "Failed",
        className: "text-red-400",
      };
    case "interrupted":
      return {
        icon: <StopCircleIcon aria-hidden="true" className="size-3.5" />,
        label: "Interrupted",
        className: "text-orange-400",
      };
    case "unknown":
      return {
        icon: <BotIcon aria-hidden="true" className="size-3.5" />,
        label: "Unknown",
        className: "text-muted-foreground",
      };
  }
}

function fidelityLabel(fidelity: WorkflowProjectionSnapshot["fidelity"]): string {
  switch (fidelity) {
    case "live":
      return "Live";
    case "lifecycle-only":
      return "Lifecycle only";
    case "not-reported":
      return "Not reported";
  }
}

function nodeTitle(node: WorkflowAgentNode): string {
  return node.name ?? node.path ?? node.taskLabel ?? "Unnamed agent";
}

const WorkflowNodeCard = memo(function WorkflowNodeCard({
  node,
  expanded,
  onExpandedChange,
}: {
  readonly node: WorkflowAgentNode;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
}) {
  const status = statusPresentation(node.status);
  return (
    <li className="list-none" style={{ paddingInlineStart: `${Math.min(node.depth, 8) * 10}px` }}>
      <details
        open={expanded}
        onToggle={(event) => onExpandedChange(event.currentTarget.open)}
        className="group rounded-lg border border-border/50 bg-background/45 px-2.5 py-2"
      >
        <summary className="cursor-pointer list-none rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-foreground/90">
                {nodeTitle(node)}
              </p>
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground/55">
                {node.path ?? "Parent/path not reported"}
              </p>
            </div>
            <span
              className={`flex shrink-0 items-center gap-1 text-[10px] font-medium ${status.className}`}
            >
              {status.icon}
              {status.label}
            </span>
          </div>
        </summary>
        <div className="mt-2 space-y-1 border-t border-border/40 pt-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground/75">
            {node.taskLabel ?? "Task label not reported"}
          </p>
          <p className="text-[10px] text-muted-foreground/55">
            {node.elapsedSeconds === null
              ? "Duration unavailable"
              : `Provider duration: ${node.elapsedSeconds}s`}
          </p>
          <p className="text-[10px] leading-relaxed text-muted-foreground/65">
            {node.latestActivitySummary ?? "No recent activity"}
          </p>
        </div>
      </details>
    </li>
  );
});

function activityKey(activity: WorkflowRecentActivity): string {
  return `${activity.id}:${activity.nodeId ?? "unassigned"}:${activity.createdAt}`;
}

function ActivityRow({
  activity,
  timestampFormat,
}: {
  readonly activity: WorkflowRecentActivity;
  readonly timestampFormat: TimestampFormat;
}) {
  const status = activity.status ? statusPresentation(activity.status) : null;
  return (
    <div className="flex min-w-0 gap-2 border-b border-border/35 px-1 py-2 last:border-b-0">
      <span className={status?.className ?? "text-muted-foreground/60"}>
        {status?.icon ?? <CircleDashedIcon aria-hidden="true" className="size-3.5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] text-foreground/80">{activity.summary}</p>
        <p className="mt-0.5 flex gap-1.5 text-[9px] text-muted-foreground/45">
          <span className="truncate">{activity.kind}</span>
          <span aria-hidden="true">·</span>
          <time dateTime={activity.createdAt}>
            {formatTimestamp(activity.createdAt, timestampFormat)}
          </time>
        </p>
      </div>
    </div>
  );
}

export const WorkflowObservatory = memo(function WorkflowObservatory({
  snapshot,
  timestampFormat,
  activePlan,
  expandedNodeById,
  onNodeExpandedChange,
}: {
  readonly snapshot: WorkflowProjectionSnapshot;
  readonly timestampFormat: TimestampFormat;
  readonly activePlan: ActivePlanState | null;
  readonly expandedNodeById: Readonly<Record<string, boolean>>;
  readonly onNodeExpandedChange: (nodeId: string, expanded: boolean) => void;
}) {
  const shouldVirtualize = snapshot.recentActivities.length > 20;

  return (
    <div className="space-y-4 p-3">
      <section aria-labelledby="workflow-plan-heading" className="space-y-2">
        <h2
          id="workflow-plan-heading"
          className="text-[10px] font-semibold tracking-widest text-muted-foreground/45 uppercase"
        >
          Current plan
        </h2>
        {activePlan?.steps.length ? (
          <ol className="space-y-1 rounded-lg border border-border/45 p-2">
            {activePlan.steps.map((step) => {
              const canonicalStatus =
                step.status === "completed"
                  ? "completed"
                  : step.status === "inProgress"
                    ? "running"
                    : "queued";
              const presentation = statusPresentation(canonicalStatus);
              return (
                <li
                  key={`${step.status}:${step.step}`}
                  className="flex items-start gap-2 text-[11px] text-foreground/80"
                >
                  <span className={`mt-0.5 shrink-0 ${presentation.className}`}>
                    {presentation.icon}
                    <span className="sr-only">{presentation.label}</span>
                  </span>
                  <span className="leading-relaxed">{step.step}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="rounded-lg border border-border/45 px-3 py-3 text-[11px] text-muted-foreground/50">
            No active plan
          </p>
        )}
      </section>

      <section aria-labelledby="workflow-agents-heading" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="workflow-agents-heading"
            className="text-[10px] font-semibold tracking-widest text-muted-foreground/45 uppercase"
          >
            Agents and tasks
          </h2>
          <Badge variant="secondary" className="h-5 rounded-md px-1.5 text-[9px]">
            {fidelityLabel(snapshot.fidelity)}
          </Badge>
        </div>

        {snapshot.nodes.length > 0 ? (
          <ul aria-label="Provider-reported workflow" className="space-y-1.5">
            {snapshot.nodes.map((node) => (
              <WorkflowNodeCard
                key={node.id}
                node={node}
                expanded={
                  expandedNodeById[node.id] ??
                  (node.status !== "completed" &&
                    node.status !== "failed" &&
                    node.status !== "interrupted")
                }
                onExpandedChange={(expanded) => onNodeExpandedChange(node.id, expanded)}
              />
            ))}
          </ul>
        ) : (
          <div className="rounded-lg border border-dashed border-border/60 px-3 py-8 text-center">
            <p className="text-[12px] text-muted-foreground/60">
              This provider has not reported a safe sub-agent lifecycle for the current turn.
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground/40">No recent activity</p>
          </div>
        )}

        {snapshot.omittedNodeCount > 0 ? (
          <p className="text-[10px] text-muted-foreground/50">
            {snapshot.omittedNodeCount} additional workflow nodes were omitted to keep this view
            responsive.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="workflow-activity-heading" className="space-y-2">
        <h2
          id="workflow-activity-heading"
          className="text-[10px] font-semibold tracking-widest text-muted-foreground/45 uppercase"
        >
          Recent activity
        </h2>
        {snapshot.recentActivities.length === 0 ? (
          <p className="rounded-lg border border-border/45 px-3 py-4 text-[11px] text-muted-foreground/50">
            No recent activity
          </p>
        ) : shouldVirtualize ? (
          <>
            <div
              aria-hidden="true"
              className="h-64 overflow-hidden rounded-lg border border-border/45"
            >
              <LegendList<WorkflowRecentActivity>
                data={snapshot.recentActivities}
                keyExtractor={activityKey}
                renderItem={({ item }) => (
                  <ActivityRow activity={item} timestampFormat={timestampFormat} />
                )}
                estimatedItemSize={45}
                drawDistance={180}
                style={{ height: "16rem" }}
              />
            </div>
            <ol className="sr-only" aria-label="Recent provider-reported workflow activity">
              {snapshot.recentActivities.map((activity) => (
                <li key={`accessible:${activityKey(activity)}`}>
                  {activity.summary}, {formatTimestamp(activity.createdAt, timestampFormat)}
                </li>
              ))}
            </ol>
          </>
        ) : (
          <ol
            aria-label="Recent provider-reported workflow activity"
            className="rounded-lg border border-border/45"
          >
            {snapshot.recentActivities.map((activity) => (
              <li key={activityKey(activity)}>
                <ActivityRow activity={activity} timestampFormat={timestampFormat} />
              </li>
            ))}
          </ol>
        )}
        {snapshot.omittedActivityCount > 0 ? (
          <p className="text-[10px] text-muted-foreground/50">
            {snapshot.omittedActivityCount} older activity updates were omitted.
          </p>
        ) : null}
      </section>
    </div>
  );
});
