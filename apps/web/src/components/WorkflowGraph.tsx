import type { WorkflowAgentNode, WorkflowAgentStatus } from "@cafecode/contracts";
import { MinusIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { deriveWorkflowGraphLayout } from "../workflowGraph";
import { Button } from "./ui/button";

const MIN_ZOOM = 0.6;
const MAX_ZOOM = 1.8;
const ZOOM_STEP = 0.2;

const STATUS_COLOR: Readonly<Record<WorkflowAgentStatus, string>> = {
  queued: "#f59e0b",
  running: "#60a5fa",
  waiting: "#a78bfa",
  idle: "#94a3b8",
  completed: "#34d399",
  failed: "#f87171",
  interrupted: "#fb923c",
  unknown: "#94a3b8",
};

function nodeLabel(node: WorkflowAgentNode): string {
  return node.name ?? node.path ?? node.taskLabel ?? "Unnamed agent";
}

interface PanOrigin {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly panX: number;
  readonly panY: number;
}

export function WorkflowGraph({ nodes }: { readonly nodes: readonly WorkflowAgentNode[] }) {
  const layout = useMemo(() => deriveWorkflowGraphLayout(nodes), [nodes]);
  const markerId = useId().replaceAll(":", "");
  const [selectedId, setSelectedId] = useState<string | null>(() => nodes[0]?.id ?? null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 12, y: 12 });
  const panOriginRef = useRef<PanOrigin | null>(null);

  useEffect(() => {
    if (selectedId && nodes.some((node) => node.id === selectedId)) return;
    setSelectedId(nodes[0]?.id ?? null);
  }, [nodes, selectedId]);

  const selected = nodes.find((node) => node.id === selectedId) ?? null;
  const resetViewport = () => {
    setZoom(1);
    setPan({ x: 12, y: 12 });
  };
  const startPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    panOriginRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePan = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = panOriginRef.current;
    if (!origin || origin.pointerId !== event.pointerId) return;
    setPan({
      x: origin.panX + event.clientX - origin.clientX,
      y: origin.panY + event.clientY - origin.clientY,
    });
  };
  const finishPan = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panOriginRef.current?.pointerId !== event.pointerId) return;
    panOriginRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] leading-relaxed text-muted-foreground/60">
          Edges appear only for provider-reported parent relationships. Drag the background to pan.
        </p>
        <div aria-label="Workflow graph viewport controls" className="flex items-center gap-1">
          <Button
            aria-label="Zoom workflow graph out"
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom((value) => Math.max(MIN_ZOOM, value - ZOOM_STEP))}
            size="icon-xs"
            variant="outline"
          >
            <MinusIcon />
          </Button>
          <output className="min-w-10 text-center text-[10px] text-muted-foreground">
            {Math.round(zoom * 100)}%
          </output>
          <Button
            aria-label="Zoom workflow graph in"
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + ZOOM_STEP))}
            size="icon-xs"
            variant="outline"
          >
            <PlusIcon />
          </Button>
          <Button
            aria-label="Reset workflow graph viewport"
            onClick={resetViewport}
            size="icon-xs"
            variant="outline"
          >
            <RotateCcwIcon />
          </Button>
        </div>
      </div>

      <div
        aria-label="Provider-reported workflow graph"
        className="relative h-80 touch-none overflow-hidden rounded-lg border border-border/50 bg-background/35 select-none"
        onPointerCancel={finishPan}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={finishPan}
        role="application"
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width: `${layout.width}px`,
            height: `${layout.height}px`,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-visible"
            height={layout.height}
            width={layout.width}
          >
            <defs>
              <marker
                id={markerId}
                markerHeight="6"
                markerWidth="7"
                orient="auto"
                refX="6"
                refY="3"
              >
                <path d="M 0 0 L 6 3 L 0 6 z" fill="currentColor" />
              </marker>
            </defs>
            {layout.edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.path}
                fill="none"
                markerEnd={`url(#${markerId})`}
                pathLength="1"
                stroke="currentColor"
                strokeOpacity="0.45"
                strokeWidth="1.5"
              />
            ))}
          </svg>

          {layout.nodes.map((entry) => {
            const active = entry.node.id === selectedId;
            const color = STATUS_COLOR[entry.node.status];
            return (
              <button
                key={entry.node.id}
                aria-pressed={active}
                className="absolute overflow-hidden rounded-lg border bg-card/95 px-2.5 py-2 text-left shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => setSelectedId(entry.node.id)}
                style={{
                  borderColor: active ? color : `color-mix(in srgb, ${color} 45%, transparent)`,
                  boxShadow: active ? `0 0 18px color-mix(in srgb, ${color} 28%, transparent)` : "",
                  height: entry.height,
                  left: entry.x,
                  top: entry.y,
                  width: entry.width,
                }}
                type="button"
              >
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="truncate text-[11px] font-medium">{nodeLabel(entry.node)}</span>
                </span>
                <span className="mt-1 block truncate text-[9px] text-muted-foreground">
                  {entry.node.status} · {entry.node.activityCount} observed update
                  {entry.node.activityCount === 1 ? "" : "s"}
                </span>
                <span className="mt-1 block truncate text-[9px] text-muted-foreground/70">
                  {entry.node.latestActivitySummary ?? "Current activity not reported"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {layout.unknownDependencyCount > 0 ? (
        <p className="text-[10px] text-amber-300/80">
          {layout.unknownDependencyCount} dependency{" "}
          {layout.unknownDependencyCount === 1 ? "is" : "relationships are"} unknown or cyclic and
          therefore not drawn.
        </p>
      ) : null}

      {selected ? (
        <section
          aria-label="Selected workflow node details"
          className="rounded-lg border border-border/45 bg-background/35 p-2"
        >
          <h3 className="text-[11px] font-medium">{nodeLabel(selected)}</h3>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {selected.taskLabel ?? "Task label not reported"}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground/70">
            Parent:{" "}
            {selected.parentId
              ? nodes.find((node) => node.id === selected.parentId)
                ? nodeLabel(nodes.find((node) => node.id === selected.parentId)!)
                : "Provider reported an unavailable parent"
              : "No parent reported"}
          </p>
        </section>
      ) : null}

      <ol className="sr-only" aria-label="Accessible provider-reported workflow relationships">
        {nodes.map((node) => (
          <li key={`accessible:${node.id}`}>
            {nodeLabel(node)}, status {node.status},{" "}
            {node.parentId
              ? `parent ${nodes.find((candidate) => candidate.id === node.parentId)?.name ?? "unavailable"}`
              : "no parent reported"}
          </li>
        ))}
      </ol>
    </div>
  );
}
