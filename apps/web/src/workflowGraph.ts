import type { WorkflowAgentNode } from "@cafecode/contracts";

export const WORKFLOW_GRAPH_NODE_WIDTH = 184;
export const WORKFLOW_GRAPH_NODE_HEIGHT = 72;
export const WORKFLOW_GRAPH_COLUMN_GAP = 88;
export const WORKFLOW_GRAPH_ROW_GAP = 28;
export const WORKFLOW_GRAPH_PADDING = 28;
export const WORKFLOW_GRAPH_MAX_LEVEL = 12;

export interface WorkflowGraphNodeLayout {
  readonly node: WorkflowAgentNode;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly level: number;
}

export interface WorkflowGraphEdgeLayout {
  readonly id: string;
  readonly parentId: string;
  readonly childId: string;
  readonly path: string;
}

export interface WorkflowGraphLayout {
  readonly nodes: readonly WorkflowGraphNodeLayout[];
  readonly edges: readonly WorkflowGraphEdgeLayout[];
  readonly width: number;
  readonly height: number;
  readonly unknownDependencyCount: number;
}

function explicitLevel(
  node: WorkflowAgentNode,
  byId: ReadonlyMap<string, WorkflowAgentNode>,
  memo: Map<string, number>,
  visiting: Set<string>,
): number {
  const known = memo.get(node.id);
  if (known !== undefined) return known;
  if (!node.parentId) {
    memo.set(node.id, 0);
    return 0;
  }
  if (visiting.has(node.id)) {
    memo.set(node.id, 0);
    return 0;
  }
  const parent = byId.get(node.parentId);
  if (!parent) {
    memo.set(node.id, 0);
    return 0;
  }
  visiting.add(node.id);
  const level = Math.min(WORKFLOW_GRAPH_MAX_LEVEL, explicitLevel(parent, byId, memo, visiting) + 1);
  visiting.delete(node.id);
  memo.set(node.id, level);
  return level;
}

function edgePath(parent: WorkflowGraphNodeLayout, child: WorkflowGraphNodeLayout): string {
  const startX = parent.x + parent.width;
  const startY = parent.y + parent.height / 2;
  const endX = child.x;
  const endY = child.y + child.height / 2;
  const midpointX = startX + Math.max(20, (endX - startX) / 2);
  return `M ${startX} ${startY} H ${midpointX} V ${endY} H ${endX}`;
}

/**
 * Build a deterministic node-edge view from explicit provider relationships.
 * Missing parent IDs and cycles remain unconnected instead of being inferred
 * from timing, labels, or array order.
 */
export function deriveWorkflowGraphLayout(
  sourceNodes: readonly WorkflowAgentNode[],
): WorkflowGraphLayout {
  if (sourceNodes.length === 0) {
    return {
      nodes: [],
      edges: [],
      width: WORKFLOW_GRAPH_NODE_WIDTH + WORKFLOW_GRAPH_PADDING * 2,
      height: WORKFLOW_GRAPH_NODE_HEIGHT + WORKFLOW_GRAPH_PADDING * 2,
      unknownDependencyCount: 0,
    };
  }

  const byId = new Map(sourceNodes.map((node) => [node.id, node] as const));
  const cyclicIds = new Set<string>();
  for (const node of sourceNodes) {
    const chain: string[] = [];
    const positions = new Map<string, number>();
    let current: WorkflowAgentNode | undefined = node;
    while (current) {
      const repeatedAt = positions.get(current.id);
      if (repeatedAt !== undefined) {
        for (const id of chain.slice(repeatedAt)) cyclicIds.add(id);
        break;
      }
      positions.set(current.id, chain.length);
      chain.push(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  const levelById = new Map<string, number>();
  const groups = new Map<number, WorkflowAgentNode[]>();
  let unknownDependencyCount = 0;

  for (const node of sourceNodes) {
    const level = cyclicIds.has(node.id) ? 0 : explicitLevel(node, byId, levelById, new Set());
    const group = groups.get(level) ?? [];
    group.push(node);
    groups.set(level, group);
    if (node.parentId && !byId.has(node.parentId)) unknownDependencyCount += 1;
  }

  const nodes: WorkflowGraphNodeLayout[] = [];
  let maxRows = 1;
  for (const [level, group] of Array.from(groups.entries()).toSorted(
    ([left], [right]) => left - right,
  )) {
    maxRows = Math.max(maxRows, group.length);
    for (const [row, node] of group.entries()) {
      nodes.push({
        node,
        level,
        x: WORKFLOW_GRAPH_PADDING + level * (WORKFLOW_GRAPH_NODE_WIDTH + WORKFLOW_GRAPH_COLUMN_GAP),
        y: WORKFLOW_GRAPH_PADDING + row * (WORKFLOW_GRAPH_NODE_HEIGHT + WORKFLOW_GRAPH_ROW_GAP),
        width: WORKFLOW_GRAPH_NODE_WIDTH,
        height: WORKFLOW_GRAPH_NODE_HEIGHT,
      });
    }
  }

  const layoutById = new Map(nodes.map((node) => [node.node.id, node] as const));
  const edges = nodes.flatMap((child) => {
    const parentId = child.node.parentId;
    if (!parentId) return [];
    const parent = layoutById.get(parentId);
    if (
      cyclicIds.has(child.node.id) ||
      cyclicIds.has(parentId) ||
      !parent ||
      parent.level >= child.level
    ) {
      unknownDependencyCount += parent ? 1 : 0;
      return [];
    }
    return [
      {
        id: `${parentId}->${child.node.id}`,
        parentId,
        childId: child.node.id,
        path: edgePath(parent, child),
      },
    ];
  });

  const maxLevel = Math.max(...nodes.map((node) => node.level), 0);
  return {
    nodes,
    edges,
    width:
      WORKFLOW_GRAPH_PADDING * 2 +
      (maxLevel + 1) * WORKFLOW_GRAPH_NODE_WIDTH +
      maxLevel * WORKFLOW_GRAPH_COLUMN_GAP,
    height:
      WORKFLOW_GRAPH_PADDING * 2 +
      maxRows * WORKFLOW_GRAPH_NODE_HEIGHT +
      (maxRows - 1) * WORKFLOW_GRAPH_ROW_GAP,
    unknownDependencyCount,
  };
}
