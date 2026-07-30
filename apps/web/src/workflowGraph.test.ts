import type { WorkflowAgentNode } from "@cafecode/contracts";
import { describe, expect, it } from "vitest";

import {
  deriveWorkflowGraphLayout,
  WORKFLOW_GRAPH_COLUMN_GAP,
  WORKFLOW_GRAPH_NODE_WIDTH,
} from "./workflowGraph";

function node(id: string, parentId: string | null): WorkflowAgentNode {
  return {
    id,
    parentId,
    path: null,
    name: id,
    taskLabel: null,
    status: "running",
    startedAt: "2026-07-23T12:00:00.000Z",
    elapsedSeconds: null,
    latestActivitySummary: null,
    lastActivityAt: "2026-07-23T12:00:00.000Z",
    activityCount: 1,
    depth: 0,
  };
}

describe("workflow graph layout", () => {
  it("draws edges only for explicit parent relationships", () => {
    const layout = deriveWorkflowGraphLayout([
      node("root", null),
      node("child", "root"),
      node("unknown", "provider-did-not-report-this-parent"),
    ]);

    expect(layout.edges).toEqual([expect.objectContaining({ parentId: "root", childId: "child" })]);
    expect(layout.unknownDependencyCount).toBe(1);
    const root = layout.nodes.find((entry) => entry.node.id === "root")!;
    const child = layout.nodes.find((entry) => entry.node.id === "child")!;
    expect(child.x - root.x).toBe(WORKFLOW_GRAPH_NODE_WIDTH + WORKFLOW_GRAPH_COLUMN_GAP);
  });

  it("fails closed on a cyclic provider relationship", () => {
    const layout = deriveWorkflowGraphLayout([node("one", "two"), node("two", "one")]);
    expect(layout.edges).toEqual([]);
    expect(layout.unknownDependencyCount).toBeGreaterThan(0);
    expect(
      layout.nodes.every((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y)),
    ).toBe(true);
  });

  it("returns a stable bounded viewport for an empty graph", () => {
    expect(deriveWorkflowGraphLayout([])).toMatchObject({
      nodes: [],
      edges: [],
      unknownDependencyCount: 0,
    });
  });
});
