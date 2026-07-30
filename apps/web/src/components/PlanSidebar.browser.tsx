import { EnvironmentId, EventId, type WorkflowProjectionSnapshot } from "@cafecode/contracts";
import "../index.css";

import { page, userEvent } from "vitest/browser";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { useState } from "react";

import type { RightPanelTab } from "../uiStateStore";
import PlanSidebar from "./PlanSidebar";

const workflowSnapshot: WorkflowProjectionSnapshot = {
  version: 1,
  fidelity: "lifecycle-only",
  providerLabel: "codex",
  modelLabel: "gpt-5.6-codex",
  nodes: [
    {
      id: "item:auditor",
      parentId: null,
      path: null,
      name: "auditor",
      taskLabel: "<script>safe text only</script>",
      status: "running",
      startedAt: "2026-07-23T11:59:00.000Z",
      elapsedSeconds: null,
      latestActivitySummary: null,
      lastActivityAt: "2026-07-23T12:00:00.000Z",
      activityCount: 1,
      depth: 0,
    },
  ],
  recentActivities: [
    {
      id: EventId.make("workflow-event"),
      nodeId: "item:auditor",
      kind: "tool.started",
      summary: "Subagent task started",
      tone: "tool",
      status: "running",
      createdAt: "2026-07-23T12:00:00.000Z",
    },
  ],
  sourceActivityCount: 1,
  omittedNodeCount: 0,
  omittedActivityCount: 0,
};

function PlanWorkflowHarness({
  workflowObservatoryEnabled = true,
}: {
  workflowObservatoryEnabled?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<RightPanelTab>("plan");
  const [expandedNodeById, setExpandedNodeById] = useState<Record<string, boolean>>({
    "item:auditor": true,
  });
  return (
    <div className="h-[720px] w-[360px]">
      <PlanSidebar
        activePlan={{
          createdAt: "2026-07-23T12:00:00.000Z",
          turnId: null,
          steps: [{ step: "Audit the adapter", status: "inProgress" }],
        }}
        activeProposedPlan={null}
        environmentId={EnvironmentId.make("environment-local")}
        markdownCwd={undefined}
        workspaceRoot={undefined}
        timestampFormat="24-hour"
        activeTab={activeTab}
        workflowSnapshot={workflowSnapshot}
        workflowNodeExpandedById={expandedNodeById}
        workflowObservatoryEnabled={workflowObservatoryEnabled}
        workflowStallWarningSeconds={180}
        onActiveTabChange={setActiveTab}
        onWorkflowNodeExpandedChange={(nodeId, expanded) =>
          setExpandedNodeById((previous) => ({ ...previous, [nodeId]: expanded }))
        }
        onClose={vi.fn()}
      />
    </div>
  );
}

it("switches from Plan to the semantic Workflow tree with honest unavailable fields", async () => {
  await render(<PlanWorkflowHarness />);

  const workflowTab = page.getByRole("tab", { name: "Workflow" });
  await expect.element(workflowTab).toHaveAttribute("aria-selected", "false");
  await workflowTab.click();

  await expect.element(workflowTab).toHaveAttribute("aria-selected", "true");
  workflowTab.element().focus();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(workflowTab).toHaveAttribute("aria-selected", "false");
  await expect
    .element(page.getByRole("tab", { name: "Plan" }))
    .toHaveAttribute("aria-selected", "true");
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(workflowTab).toHaveAttribute("aria-selected", "true");
  await expect
    .element(page.getByRole("list", { name: "Provider-reported workflow", exact: true }))
    .toBeVisible();
  await expect.element(page.getByText("Lifecycle only")).toBeVisible();
  await expect
    .element(page.getByText("Provider: codex · Selected model: gpt-5.6-codex"))
    .toBeVisible();
  await expect.element(page.getByText(/Possibly stalled warning:/)).toBeVisible();
  await expect.element(page.getByText(/This is not proof the agent stopped\./)).toBeVisible();
  await expect.element(page.getByText("<script>safe text only</script>")).toBeVisible();
  await expect.element(page.getByText("Audit the adapter")).toBeVisible();
});

it("hides the Workflow tab when the local observatory preference is off", async () => {
  await render(<PlanWorkflowHarness workflowObservatoryEnabled={false} />);

  await expect.element(page.getByRole("tab", { name: "Plan" })).toBeVisible();
  await expect.element(page.getByRole("tab", { name: "Workflow" })).not.toBeInTheDocument();
});
