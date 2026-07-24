import type { WorkflowAgentNode } from "@cafecode/contracts";
import "../index.css";

import { page } from "vitest/browser";
import { afterEach, expect, it } from "vitest";
import { render } from "vitest-browser-react";

import { WorkflowGraph } from "./WorkflowGraph";

function node(input: {
  readonly id: string;
  readonly parentId: string | null;
  readonly status?: WorkflowAgentNode["status"];
}): WorkflowAgentNode {
  return {
    id: input.id,
    parentId: input.parentId,
    path: `workers/${input.id}`,
    name: input.id,
    taskLabel: `Task for ${input.id}`,
    status: input.status ?? "running",
    startedAt: "2026-07-23T12:00:00.000Z",
    elapsedSeconds: null,
    latestActivitySummary: `Working on ${input.id}`,
    lastActivityAt: "2026-07-23T12:00:01.000Z",
    activityCount: 2,
    depth: input.parentId ? 1 : 0,
  };
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

it("shows explicit relationships, selectable details, and bounded viewport controls", async () => {
  mounted = await render(
    <WorkflowGraph
      nodes={[
        node({ id: "root-agent", parentId: null }),
        node({ id: "audit-agent", parentId: "root-agent", status: "completed" }),
        node({ id: "unknown-agent", parentId: "missing-agent" }),
      ]}
    />,
  );

  await expect.element(page.getByLabelText("Provider-reported workflow graph")).toBeInTheDocument();
  await expect.element(page.getByText(/1 dependency is unknown or cyclic/)).toBeVisible();
  await page.getByRole("button", { name: /audit-agent/ }).click();
  await expect
    .element(page.getByRole("region", { name: "Selected workflow node details" }))
    .toHaveTextContent(/Parent: root-agent/);

  await page.getByRole("button", { name: "Zoom workflow graph in" }).click();
  await expect.element(page.getByText("120%")).toBeVisible();
  await page.getByRole("button", { name: "Reset workflow graph viewport" }).click();
  await expect.element(page.getByText("100%")).toBeVisible();
});
