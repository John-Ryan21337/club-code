import type {
  EnvironmentId,
  WorkspaceObservatoryDatabaseRef,
  WorkspaceObservatoryObservation,
  WorkspaceObservatoryRowsResult,
  WorkspaceObservatoryTreeEntry,
} from "@cafecode/contracts";
import {
  DatabaseIcon,
  FileIcon,
  FolderIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readEnvironmentApi } from "~/environmentApi";
import {
  type FileLineDiff,
  type RowSnapshotDiff,
  diffFileLines,
  diffRows,
  isObservationRelevantToDirectory,
  observationKey,
  stableAgentColorIndex,
} from "~/workspaceObservatoryDiff";
import { Button } from "./ui/button";
import { Dialog, DialogDescription, DialogPopup, DialogTitle } from "./ui/dialog";

type Pane =
  | { readonly id: string; readonly kind: "empty" }
  | {
      readonly id: string;
      readonly kind: "file";
      readonly path: string;
      readonly content: string;
      readonly truncated: boolean;
      readonly redacted: boolean;
      readonly lineDiff?: FileLineDiff;
      readonly attribution?: SnapshotAttribution;
      readonly refreshedAt?: string;
    }
  | {
      readonly id: string;
      readonly kind: "table";
      readonly database: WorkspaceObservatoryDatabaseRef;
      readonly table: string;
      readonly rows: WorkspaceObservatoryRowsResult;
      readonly rowDiff?: RowSnapshotDiff;
      readonly attribution?: SnapshotAttribution;
      readonly refreshedAt?: string;
    };
type ErrorSource = "activity" | "content" | "databases" | "tables" | "tree";
type SnapshotAttribution =
  | {
      readonly kind: "observed-focus" | "observed-operation" | "inferred-correlation";
      readonly observation: WorkspaceObservatoryObservation;
    }
  | { readonly kind: "unknown" };

const MAX_PANES = 8;
const DEFAULT_REFRESH_SECONDS = 3;
const MIN_REFRESH_SECONDS = 1;
const MAX_REFRESH_SECONDS = 5;
const OBSERVATION_SIGNAL_TTL_MS = 10_000;
const EXPLICIT_MUTATIONS = new Set(["create", "delete", "rename", "write"]);
const AGENT_COLORS = [
  "border-cyan-400/70",
  "border-violet-400/70",
  "border-amber-400/70",
  "border-emerald-400/70",
  "border-rose-400/70",
  "border-sky-400/70",
  "border-fuchsia-400/70",
  "border-lime-400/70",
] as const;

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function WorkspaceObservatory({
  open,
  onOpenChange,
  environmentId,
  workspaceRoot,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly environmentId: EnvironmentId;
  readonly workspaceRoot: string | undefined;
}) {
  const observatory = useMemo(
    () => (open ? readEnvironmentApi(environmentId)?.workspaceObservatory : undefined),
    [environmentId, open],
  );
  const nextPaneId = useRef(2);
  const [entries, setEntries] = useState<readonly WorkspaceObservatoryTreeEntry[]>([]);
  const [directory, setDirectory] = useState("");
  const [treeRedacted, setTreeRedacted] = useState(false);
  const [treeTruncated, setTreeTruncated] = useState(false);
  const [databases, setDatabases] = useState<
    readonly { database: WorkspaceObservatoryDatabaseRef; label: string }[]
  >([]);
  const [selectedDatabase, setSelectedDatabase] = useState<WorkspaceObservatoryDatabaseRef | null>(
    null,
  );
  const [tables, setTables] = useState<readonly { name: string; type: "table" | "view" }[]>([]);
  const [panes, setPanes] = useState<readonly Pane[]>([{ id: "pane-1", kind: "empty" }]);
  const [activePane, setActivePane] = useState("pane-1");
  const [activity, setActivity] = useState<readonly WorkspaceObservatoryObservation[]>([]);
  const [agentFilter, setAgentFilter] = useState<string | null>(null);
  const [followAgent, setFollowAgent] = useState<string | null>(null);
  const [liveRefresh, setLiveRefresh] = useState(true);
  const [refreshSeconds, setRefreshSeconds] = useState(DEFAULT_REFRESH_SECONDS);
  const [visualizeCodeEdits, setVisualizeCodeEdits] = useState(false);
  const [treeRevision, setTreeRevision] = useState(0);
  const [followStatus, setFollowStatus] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ErrorSource, string>>>({});
  const [loadingTree, setLoadingTree] = useState(false);
  const [loadingDatabases, setLoadingDatabases] = useState(false);
  const panesRef = useRef(panes);
  const activePaneRef = useRef(activePane);
  const directoryRef = useRef(directory);
  const activityRef = useRef(activity);
  const seenObservationKeysRef = useRef<Set<string> | null>(null);
  const observationSignalsRef = useRef<
    Map<
      string,
      { readonly observation: WorkspaceObservatoryObservation; readonly receivedAt: number }
    >
  >(new Map());

  useEffect(() => {
    panesRef.current = panes;
  }, [panes]);
  useEffect(() => {
    activePaneRef.current = activePane;
  }, [activePane]);
  useEffect(() => {
    directoryRef.current = directory;
  }, [directory]);
  useEffect(() => {
    activityRef.current = activity;
  }, [activity]);

  useEffect(() => {
    setDirectory("");
    setEntries([]);
    setDatabases([]);
    setSelectedDatabase(null);
    setTables([]);
    setActivity([]);
    setAgentFilter(null);
    setFollowAgent(null);
    setFollowStatus(null);
    setPanes([{ id: "pane-1", kind: "empty" }]);
    panesRef.current = [{ id: "pane-1", kind: "empty" }];
    setActivePane("pane-1");
    activePaneRef.current = "pane-1";
    seenObservationKeysRef.current = null;
    observationSignalsRef.current.clear();
    setErrors({});
  }, [environmentId, workspaceRoot]);
  const setSurfaceError = useCallback((source: ErrorSource, message: string | null) => {
    setErrors((current) => {
      if (message) return { ...current, [source]: message };
      if (!(source in current)) return current;
      const next = { ...current };
      delete next[source];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!open || !observatory || !workspaceRoot) return;
    let active = true;
    setLoadingTree(true);
    void observatory
      .tree({
        cwd: workspaceRoot,
        ...(directory ? { relativePath: directory } : {}),
      })
      .then((tree) => {
        if (!active) return;
        setEntries(tree.entries);
        setTreeRedacted(tree.redacted ?? false);
        setTreeTruncated(tree.truncated);
        setSurfaceError("tree", null);
      })
      .catch((cause) => {
        if (active) setSurfaceError("tree", errorMessage(cause, "Unable to list workspace files."));
      })
      .finally(() => {
        if (active) setLoadingTree(false);
      });
    return () => {
      active = false;
    };
  }, [directory, observatory, open, setSurfaceError, treeRevision, workspaceRoot]);

  useEffect(() => {
    if (!open || !observatory || !workspaceRoot) return;
    let active = true;
    setLoadingDatabases(true);
    void observatory
      .databases({ cwd: workspaceRoot })
      .then((nextDatabases) => {
        if (!active) return;
        setDatabases(nextDatabases);
        setSelectedDatabase((current) =>
          current && nextDatabases.some((entry) => entry.database === current) ? current : null,
        );
        setSurfaceError("databases", null);
      })
      .catch((cause) => {
        if (active)
          setSurfaceError("databases", errorMessage(cause, "Unable to list workspace databases."));
      })
      .finally(() => {
        if (active) setLoadingDatabases(false);
      });
    return () => {
      active = false;
    };
  }, [observatory, open, setSurfaceError, workspaceRoot]);

  useEffect(() => {
    if (!open || !observatory || !workspaceRoot || !selectedDatabase) {
      setTables([]);
      return;
    }
    let active = true;
    setTables([]);
    void observatory
      .tables({ cwd: workspaceRoot, database: selectedDatabase })
      .then((nextTables) => {
        if (active) {
          setTables(nextTables);
          setSurfaceError("tables", null);
        }
      })
      .catch((cause) => {
        if (active) setSurfaceError("tables", errorMessage(cause, "Unable to list tables."));
      });
    return () => {
      active = false;
    };
  }, [observatory, open, selectedDatabase, setSurfaceError, workspaceRoot]);

  const updatePanes = useCallback((update: (current: readonly Pane[]) => readonly Pane[]) => {
    const next = update(panesRef.current);
    panesRef.current = next;
    setPanes(next);
  }, []);
  const assign = useCallback(
    (pane: Pane) =>
      updatePanes((current) =>
        current.map((entry) => (entry.id === activePaneRef.current ? pane : entry)),
      ),
    [updatePanes],
  );
  const openFile = useCallback(
    async (path: string) => {
      if (!observatory || !workspaceRoot) return;
      setSurfaceError("content", null);
      try {
        const file = await observatory.readFile({ cwd: workspaceRoot, relativePath: path });
        assign({
          id: activePaneRef.current,
          kind: "file",
          path: file.relativePath,
          content: file.content,
          truncated: file.truncated,
          redacted: file.redacted ?? false,
          attribution: { kind: "unknown" },
          refreshedAt: new Date().toISOString(),
        });
      } catch (cause) {
        setSurfaceError("content", errorMessage(cause, "Unable to display file."));
      }
    },
    [assign, observatory, setSurfaceError, workspaceRoot],
  );
  const openTable = useCallback(
    async (table: string) => {
      if (!observatory || !workspaceRoot || !selectedDatabase) return;
      setSurfaceError("content", null);
      try {
        const rows = await observatory.rows({
          cwd: workspaceRoot,
          database: selectedDatabase,
          table,
        });
        assign({
          id: activePaneRef.current,
          kind: "table",
          database: selectedDatabase,
          table,
          rows,
          attribution: { kind: "unknown" },
          refreshedAt: new Date().toISOString(),
        });
      } catch (cause) {
        setSurfaceError("content", errorMessage(cause, "Unable to display table."));
      }
    },
    [assign, observatory, selectedDatabase, setSurfaceError, workspaceRoot],
  );
  const focusObservedFile = useCallback(
    async (observation: WorkspaceObservatoryObservation) => {
      if (!observatory || !workspaceRoot || observation.attribution !== "observed") return;
      try {
        const file = await observatory.readFile({
          cwd: workspaceRoot,
          relativePath: observation.path,
        });
        const paneId = activePaneRef.current;
        updatePanes((current) =>
          current.map((pane) =>
            pane.id === paneId
              ? {
                  id: paneId,
                  kind: "file",
                  path: file.relativePath,
                  content: file.content,
                  truncated: file.truncated,
                  redacted: file.redacted ?? false,
                  attribution: { kind: "observed-focus", observation },
                  refreshedAt: new Date().toISOString(),
                }
              : pane,
          ),
        );
        setDirectory(observation.path.split("/").slice(0, -1).join("/"));
        setFollowStatus(`Following ${observation.agentId} at ${observation.path}.`);
        setSurfaceError("content", null);
      } catch {
        // Provider-observed paths may be directories, binaries, deleted files, or
        // excluded secrets. Follow mode never broadens the safe read contract.
        setFollowStatus(
          `${observation.agentId} observed ${observation.path}; it is not a displayable text file.`,
        );
      }
    },
    [observatory, setSurfaceError, updatePanes, workspaceRoot],
  );
  const addPane = useCallback(() => {
    if (panesRef.current.length >= MAX_PANES) return;
    const id = `pane-${nextPaneId.current++}`;
    updatePanes((current) => [...current, { id, kind: "empty" }]);
    setActivePane(id);
    activePaneRef.current = id;
  }, [updatePanes]);
  const removePane = useCallback((id: string) => {
    if (panesRef.current.length <= 1) return;
    const next = panesRef.current.filter((pane) => pane.id !== id);
    panesRef.current = next;
    setPanes(next);
    if (activePaneRef.current === id) {
      setActivePane(next[0]!.id);
      activePaneRef.current = next[0]!.id;
    }
  }, []);

  useEffect(() => {
    if (!open || !liveRefresh || !observatory || !workspaceRoot) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const intervalMs =
      Math.min(MAX_REFRESH_SECONDS, Math.max(MIN_REFRESH_SECONDS, refreshSeconds)) * 1_000;
    const schedule = () => {
      if (active) timer = setTimeout(() => void poll(), intervalMs);
    };
    const poll = async () => {
      if (!active) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        schedule();
        return;
      }
      try {
        const observed = await observatory.activity({ cwd: workspaceRoot });
        if (!active || (typeof document !== "undefined" && document.visibilityState !== "visible"))
          return;
        const keys = new Set(observed.observations.map(observationKey));
        const previousKeys = seenObservationKeysRef.current;
        const newlyObserved =
          previousKeys === null
            ? []
            : observed.observations.filter((item) => !previousKeys.has(observationKey(item)));
        seenObservationKeysRef.current = keys;
        const now = Date.now();
        for (const [path, signal] of observationSignalsRef.current) {
          if (now - signal.receivedAt > OBSERVATION_SIGNAL_TTL_MS)
            observationSignalsRef.current.delete(path);
        }
        const signaledPaths = new Set<string>();
        for (const item of newlyObserved) {
          if (item.attribution !== "observed") continue;
          if (signaledPaths.has(item.path)) continue;
          signaledPaths.add(item.path);
          observationSignalsRef.current.set(item.path, { observation: item, receivedAt: now });
        }
        if (
          newlyObserved.some((item) =>
            isObservationRelevantToDirectory(item.path, directoryRef.current),
          )
        )
          setTreeRevision((revision) => revision + 1);
        activityRef.current = observed.observations;
        setActivity(observed.observations);
        setSurfaceError("activity", null);
        const followTarget = newlyObserved.find(
          (item) => item.attribution === "observed" && item.agentId === followAgent,
        );
        if (followTarget) await focusObservedFile(followTarget);
      } catch (cause) {
        if (active)
          setSurfaceError("activity", errorMessage(cause, "Unable to read observed activity."));
      } finally {
        schedule();
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [
    focusObservedFile,
    followAgent,
    liveRefresh,
    observatory,
    open,
    refreshSeconds,
    setSurfaceError,
    workspaceRoot,
  ]);

  useEffect(() => {
    if (!open || !liveRefresh || !observatory || !workspaceRoot) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const intervalMs =
      Math.min(MAX_REFRESH_SECONDS, Math.max(MIN_REFRESH_SECONDS, refreshSeconds)) * 1_000;
    const schedule = () => {
      if (active) timer = setTimeout(() => void refresh(), intervalMs);
    };
    const refresh = async () => {
      if (!active) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        schedule();
        return;
      }
      const openPanes = panesRef.current.filter((pane) => pane.kind !== "empty");
      const refreshed = await Promise.all(
        openPanes.map(async (pane) => {
          try {
            if (pane.kind === "file") {
              const file = await observatory.readFile({
                cwd: workspaceRoot,
                relativePath: pane.path,
              });
              return {
                kind: "file",
                paneId: pane.id,
                expectedPath: pane.path,
                file,
              } as const;
            }
            const rows = await observatory.rows({
              cwd: workspaceRoot,
              database: pane.database,
              table: pane.table,
            });
            return {
              kind: "table",
              paneId: pane.id,
              expectedDatabase: pane.database,
              expectedTable: pane.table,
              rows,
            } as const;
          } catch {
            return null;
          }
        }),
      );
      if (!active || (typeof document !== "undefined" && document.visibilityState !== "visible")) {
        schedule();
        return;
      }
      const refreshedAt = new Date().toISOString();
      updatePanes((current) =>
        current.map((pane) => {
          const result = refreshed.find((candidate) => candidate?.paneId === pane.id);
          if (!result) return pane;
          if (result.kind === "file" && pane.kind === "file") {
            if (pane.path !== result.expectedPath) return pane;
            const lineDiff = visualizeCodeEdits
              ? diffFileLines(pane.content, result.file.content)
              : undefined;
            const signal = observationSignalsRef.current.get(pane.path);
            const attribution =
              lineDiff?.changed && signal
                ? {
                    kind: EXPLICIT_MUTATIONS.has(signal.observation.operation)
                      ? ("observed-operation" as const)
                      : ("inferred-correlation" as const),
                    observation: signal.observation,
                  }
                : pane.attribution;
            const { lineDiff: _previousLineDiff, ...paneWithoutLineDiff } = pane;
            return {
              ...paneWithoutLineDiff,
              content: result.file.content,
              truncated: result.file.truncated,
              redacted: result.file.redacted ?? false,
              ...(lineDiff ? { lineDiff } : {}),
              ...(attribution ? { attribution } : {}),
              refreshedAt,
            };
          }
          if (result.kind === "table" && pane.kind === "table") {
            if (pane.table !== result.expectedTable || pane.database !== result.expectedDatabase)
              return pane;
            const rowDiff = diffRows(pane.rows, result.rows);
            const signal =
              typeof pane.database === "string" && pane.database !== "cafe-code-state"
                ? observationSignalsRef.current.get(pane.database)
                : undefined;
            return {
              ...pane,
              rows: result.rows,
              rowDiff,
              ...(rowDiff.changed
                ? {
                    attribution: signal
                      ? ({ kind: "inferred-correlation", observation: signal.observation } as const)
                      : ({ kind: "unknown" } as const),
                  }
                : pane.attribution
                  ? { attribution: pane.attribution }
                  : {}),
              refreshedAt,
            };
          }
          return pane;
        }),
      );
      if (refreshed.some(Boolean)) setSurfaceError("content", null);
      schedule();
    };
    schedule();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [
    liveRefresh,
    observatory,
    open,
    refreshSeconds,
    setSurfaceError,
    updatePanes,
    visualizeCodeEdits,
    workspaceRoot,
  ]);

  const observedAgents = useMemo(
    () => [...new Set(activity.map((item) => item.agentId))].toSorted(),
    [activity],
  );
  const agentColors = useMemo(
    () =>
      new Map(
        observedAgents.map((agent) => [
          agent,
          AGENT_COLORS[stableAgentColorIndex(agent, AGENT_COLORS.length)]!,
        ]),
      ),
    [observedAgents],
  );
  const observedByPath = useMemo(() => {
    const result = new Map<string, WorkspaceObservatoryObservation>();
    for (const item of activity) {
      if (item.attribution === "observed" && !result.has(item.path)) result.set(item.path, item);
    }
    return result;
  }, [activity]);
  const displayedActivity = useMemo(
    () => activity.filter((item) => !agentFilter || item.agentId === agentFilter),
    [activity, agentFilter],
  );
  const toggleFollowAgent = useCallback(
    (agent: string) => {
      const next = followAgent === agent ? null : agent;
      setFollowAgent(next);
      setFollowStatus(next ? `Waiting for ${next}'s next explicit file observation.` : null);
      if (!next) return;
      const latest = activityRef.current.find(
        (item) => item.attribution === "observed" && item.agentId === next,
      );
      if (latest) void focusObservedFile(latest);
    },
    [focusObservedFile, followAgent],
  );

  const unavailableMessage = !workspaceRoot
    ? "Choose a project workspace to inspect."
    : !observatory
      ? "Workspace Observatory is unavailable for this connected environment."
      : null;
  const error = Object.values(errors)[0] ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="flex !h-[calc(100vh-2rem)] !w-[calc(100vw-2rem)] !max-w-none flex-col rounded-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
          <div className="min-w-0">
            <DialogTitle>Workspace Observatory</DialogTitle>
            <DialogDescription>
              Read-only inspection for this connected environment. Agent focus is explicit
              provider-observed telemetry, not omniscience.
            </DialogDescription>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Close Workspace Observatory"
            onClick={() => onOpenChange(false)}
          >
            <XIcon />
          </Button>
        </div>
        {unavailableMessage ? (
          <p role="status" className="mx-5 mt-3 rounded border p-2 text-sm">
            {unavailableMessage}
          </p>
        ) : null}
        {error ? (
          <p
            role="alert"
            aria-live="polite"
            className="mx-5 mt-3 rounded border border-destructive/40 p-2 text-sm"
          >
            {error}
          </p>
        ) : null}
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto md:grid-cols-[14rem_14rem_minmax(28rem,1fr)] md:overflow-hidden">
          <nav aria-label="Workspace files" className="min-h-48 overflow-auto border-r p-3">
            <h2 className="mb-2 text-sm font-semibold">Files</h2>
            <div className="mb-2 flex items-center gap-1 text-xs">
              <button
                type="button"
                disabled={!directory}
                onClick={() => setDirectory(directory.split("/").slice(0, -1).join("/"))}
                className="rounded px-1 hover:bg-muted disabled:opacity-40"
              >
                Up
              </button>
              <span className="truncate">/{directory}</span>
            </div>
            {loadingTree ? <p className="text-xs text-muted-foreground">Loading files…</p> : null}
            {entries.map((entry) => {
              const observation = observedByPath.get(entry.relativePath);
              const color = observation ? agentColors.get(observation.agentId) : undefined;
              return (
                <button
                  key={entry.relativePath}
                  type="button"
                  onClick={() =>
                    entry.kind === "file"
                      ? void openFile(entry.relativePath)
                      : setDirectory(entry.relativePath)
                  }
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted ${
                    color ? `${color} border-l-2` : ""
                  }`}
                >
                  {entry.kind === "directory" ? (
                    <FolderIcon aria-hidden="true" className="size-4 shrink-0" />
                  ) : (
                    <FileIcon aria-hidden="true" className="size-4 shrink-0" />
                  )}
                  <span className="truncate">{entry.name}</span>
                </button>
              );
            })}
            {treeRedacted ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Hidden and credential-like paths are omitted.
              </p>
            ) : null}
            {treeTruncated ? (
              <p className="mt-2 text-xs text-muted-foreground">
                This directory is capped for safe display.
              </p>
            ) : null}
          </nav>
          <section aria-label="Read-only databases" className="min-h-48 overflow-auto border-r p-3">
            <h2 className="mb-2 text-sm font-semibold">Databases</h2>
            {loadingDatabases ? (
              <p className="text-xs text-muted-foreground">Finding SQLite databases…</p>
            ) : null}
            {databases.map((database) => (
              <button
                key={database.database}
                type="button"
                onClick={() => setSelectedDatabase(database.database)}
                aria-pressed={selectedDatabase === database.database}
                className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted ${
                  selectedDatabase === database.database ? "bg-muted" : ""
                }`}
              >
                <DatabaseIcon aria-hidden="true" className="size-4 shrink-0" />
                <span className="truncate">{database.label}</span>
              </button>
            ))}
            {selectedDatabase ? (
              <div className="mt-3 border-t pt-2">
                {tables.map((table) => (
                  <button
                    key={table.name}
                    type="button"
                    onClick={() => void openTable(table.name)}
                    className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                  >
                    {table.name} <span className="text-muted-foreground">{table.type}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </section>
          <section className="flex min-h-[24rem] min-w-0 flex-col" aria-label="Observatory panes">
            <div className="flex flex-wrap items-center gap-2 border-b p-2">
              <p className="text-xs text-muted-foreground">
                Select a pane, then choose a file or table. {panes.length}/{MAX_PANES}
              </p>
              <button
                type="button"
                aria-label={liveRefresh ? "Pause live refresh" : "Resume live refresh"}
                aria-pressed={!liveRefresh}
                onClick={() => setLiveRefresh((enabled) => !enabled)}
                className="rounded border px-2 py-1 text-xs hover:bg-muted"
              >
                {liveRefresh ? (
                  <PauseIcon aria-hidden="true" className="mr-1 inline size-3" />
                ) : (
                  <PlayIcon aria-hidden="true" className="mr-1 inline size-3" />
                )}
                {liveRefresh ? "Pause" : "Resume"}
              </button>
              <label className="text-xs">
                Every{" "}
                <select
                  aria-label="Live refresh cadence"
                  value={refreshSeconds}
                  onChange={(event) =>
                    setRefreshSeconds(
                      Math.min(
                        MAX_REFRESH_SECONDS,
                        Math.max(MIN_REFRESH_SECONDS, Number(event.currentTarget.value)),
                      ),
                    )
                  }
                  className="rounded border bg-background px-1 py-0.5"
                >
                  {[1, 2, 3, 4, 5].map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds}s
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={visualizeCodeEdits}
                  onChange={(event) => setVisualizeCodeEdits(event.currentTarget.checked)}
                />
                Show live line changes
              </label>
              {panes.length < MAX_PANES ? (
                <button
                  type="button"
                  aria-label="Add observatory pane"
                  onClick={addPane}
                  className="ml-auto rounded p-1 hover:bg-muted"
                >
                  <PlusIcon aria-hidden="true" className="size-4" />
                </button>
              ) : null}
            </div>
            <div
              aria-label="Tiled observatory panes"
              className={`grid min-h-0 flex-1 auto-rows-[minmax(14rem,1fr)] gap-2 overflow-auto p-2 ${
                panes.length > 1 ? "lg:grid-cols-2" : ""
              } ${panes.length > 4 ? "2xl:grid-cols-3" : ""}`}
            >
              {panes.map((pane, index) => (
                <section
                  key={pane.id}
                  aria-label={`Observatory pane ${index + 1}`}
                  className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded border-2 ${
                    pane.id === activePane ? "border-primary" : "border-border"
                  }`}
                >
                  <header className="flex items-center border-b bg-muted/30 px-2 py-1">
                    <button
                      type="button"
                      aria-pressed={pane.id === activePane}
                      onClick={() => setActivePane(pane.id)}
                      className="min-w-0 flex-1 truncate text-left text-xs font-medium"
                    >
                      Pane {index + 1}
                      {pane.kind === "file"
                        ? ` · ${pane.path}`
                        : pane.kind === "table"
                          ? ` · ${pane.table}`
                          : ""}
                    </button>
                    {panes.length > 1 ? (
                      <button
                        type="button"
                        aria-label={`Remove observatory pane ${index + 1}`}
                        onClick={() => removePane(pane.id)}
                        className="rounded p-1 hover:bg-muted"
                      >
                        <XIcon aria-hidden="true" className="size-3" />
                      </button>
                    ) : null}
                  </header>
                  <div className="min-h-0 flex-1 overflow-auto p-3">
                    <PaneContent pane={pane} />
                  </div>
                </section>
              ))}
            </div>
            <aside aria-label="Observed activity" className="max-h-40 overflow-auto border-t p-3">
              <h2 className="text-sm font-semibold">Observed activity</h2>
              {observedAgents.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    aria-pressed={!agentFilter}
                    onClick={() => setAgentFilter(null)}
                    className="rounded border px-1 text-xs"
                  >
                    All agents
                  </button>
                  {observedAgents.map((agent) => (
                    <span key={agent} className="inline-flex">
                      <button
                        type="button"
                        aria-pressed={agentFilter === agent}
                        onClick={() => setAgentFilter(agent)}
                        className={`rounded-l border border-l-2 px-1 text-xs ${agentColors.get(agent)}`}
                      >
                        {agent}
                      </button>
                      <button
                        type="button"
                        aria-label={`${followAgent === agent ? "Stop following" : "Follow"} ${agent}`}
                        aria-pressed={followAgent === agent}
                        onClick={() => toggleFollowAgent(agent)}
                        className="rounded-r border border-l-0 px-1 text-xs"
                      >
                        {followAgent === agent ? "Following" : "Follow"}
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              {followStatus ? (
                <p role="status" className="mt-1 text-xs text-muted-foreground">
                  {followStatus}
                </p>
              ) : null}
              {displayedActivity.length ? (
                displayedActivity.slice(0, 8).map((item) => (
                  <p
                    key={`${item.threadId}:${item.timestamp}:${item.path}`}
                    className={`mt-1 border-l-2 pl-2 text-xs ${agentColors.get(item.agentId)}`}
                  >
                    {item.agentId}: {item.operation} {item.path} · {item.status}
                  </p>
                ))
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">
                  Unattributed — no explicit provider-observed operation/path/thread metadata is
                  available.
                </p>
              )}
            </aside>
          </section>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function PaneContent({ pane }: { readonly pane: Pane }) {
  if (pane.kind === "file") {
    return (
      <>
        <AttributionNotice attribution={pane.attribution} subject="file" />
        {pane.redacted ? (
          <p className="mb-2 text-xs text-muted-foreground">
            Credential-like assignments or private keys were redacted.
          </p>
        ) : null}
        {pane.lineDiff?.changed ? (
          <section
            aria-label="Latest file line changes"
            className="mb-3 rounded border p-2 text-xs"
          >
            <p className="font-medium">
              Latest snapshot line changes ({pane.lineDiff.changes.length}
              {pane.lineDiff.truncated ? "+" : ""})
            </p>
            {pane.lineDiff.changes.map((change) => (
              <div
                key={`${change.kind}:${change.line}`}
                className="mt-1 grid grid-cols-[4rem_minmax(0,1fr)] gap-1"
              >
                <span className="text-muted-foreground">
                  {change.kind} L{change.line}
                </span>
                <code className="min-w-0 whitespace-pre-wrap break-words">
                  {change.kind === "changed"
                    ? `${change.before} -> ${change.after}`
                    : change.kind === "added"
                      ? change.after
                      : change.before}
                </code>
              </div>
            ))}
            {pane.lineDiff.truncated ? (
              <p className="mt-1 text-muted-foreground">Change summary capped at 200 lines.</p>
            ) : null}
          </section>
        ) : null}
        <pre className="whitespace-pre-wrap break-words text-xs">{pane.content}</pre>
        {pane.truncated ? (
          <p className="mt-2 text-xs text-muted-foreground">File content is capped for display.</p>
        ) : null}
      </>
    );
  }
  if (pane.kind === "table") return <TablePane pane={pane} />;
  return (
    <p className="text-sm text-muted-foreground">
      Select this pane, then choose a file or database table.
    </p>
  );
}

function AttributionNotice({
  attribution,
  subject,
}: {
  readonly attribution: SnapshotAttribution | undefined;
  readonly subject: "file" | "rows";
}) {
  if (!attribution) return null;
  if (attribution.kind === "unknown")
    return (
      <p className="mb-2 text-xs text-muted-foreground">
        Snapshot changed; {subject === "rows" ? "row" : "edit"} attribution is unknown.
      </p>
    );
  if (attribution.kind === "observed-focus")
    return (
      <p className="mb-2 text-xs text-muted-foreground">
        Provider explicitly observed {attribution.observation.agentId} at{" "}
        {attribution.observation.path}; this identifies focus, not an edit.
      </p>
    );
  if (attribution.kind === "observed-operation")
    return (
      <p className="mb-2 text-xs text-muted-foreground">
        Provider explicitly observed {attribution.observation.agentId}{" "}
        {attribution.observation.operation} {attribution.observation.path}. Displayed line changes
        come from consecutive read-only snapshots.
      </p>
    );
  return (
    <p className="mb-2 text-xs text-muted-foreground">
      Temporal correlation only: {attribution.observation.agentId} was explicitly observed at{" "}
      {attribution.observation.path}; this does not prove they changed{" "}
      {subject === "rows" ? "any database row" : "the displayed lines"}.
    </p>
  );
}

function TablePane({ pane }: { readonly pane: Extract<Pane, { kind: "table" }> }) {
  const duplicateCounts = new Map<string, number>();
  const keyedRows = pane.rows.rows.map((row) => {
    const valueKey = JSON.stringify(row);
    const occurrence = duplicateCounts.get(valueKey) ?? 0;
    duplicateCounts.set(valueKey, occurrence + 1);
    return { key: `${valueKey}:${occurrence}`, row };
  });
  return (
    <>
      {pane.rowDiff?.changed ? (
        <AttributionNotice attribution={pane.attribution} subject="rows" />
      ) : null}
      <p className="mb-2 text-sm font-medium">
        {pane.table}
        {pane.rows.redacted ? " — credential-like fields redacted" : ""}
      </p>
      {pane.rowDiff?.changed ? (
        pane.rowDiff.identityProven ? (
          <p className="mb-2 text-xs text-muted-foreground">
            Primary-key identity proven: {pane.rowDiff.changes.length}
            {pane.rowDiff.truncated ? "+" : ""} added, removed, or changed row snapshots.
            Attribution remains unknown unless provider evidence names the database path; it never
            names a row.
          </p>
        ) : (
          <p className="mb-2 rounded border p-2 text-xs text-muted-foreground">
            Snapshot changed. Row identity is not proven, so Cafe Code will not invent
            added/removed/changed row claims.
          </p>
        )
      ) : null}
      {pane.rowDiff?.identityProven && pane.rowDiff.changes.length > 0 ? (
        <ul aria-label="Latest database row changes" className="mb-2 space-y-1 text-xs">
          {pane.rowDiff.changes.map((change) => (
            <li
              key={`${change.kind}:${JSON.stringify(change.identity)}`}
              className="rounded border px-2 py-1"
            >
              {change.kind} row key [{change.identity.join(", ")}]
              {change.kind === "changed"
                ? ` - columns ${change.changedColumns
                    .map((column) => pane.rows.columns[column])
                    .join(", ")}`
                : ""}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <caption className="sr-only">Read-only rows from {pane.table}</caption>
          <thead>
            <tr>
              {pane.rows.columns.map((column) => (
                <th key={column} scope="col" className="border p-1">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keyedRows.map(({ key, row }) => (
              <tr key={key}>
                {row.map((cell, column) => (
                  <td
                    key={pane.rows.columns[column]}
                    className="max-w-80 border p-1 align-top break-words"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pane.rows.truncated ? (
        <p className="mt-2 text-xs text-muted-foreground">Rows are capped for safe display.</p>
      ) : null}
    </>
  );
}
