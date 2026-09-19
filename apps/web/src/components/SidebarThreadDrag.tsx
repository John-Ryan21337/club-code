import {
  createContext,
  useCallback,
  useMemo,
  useContext,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import type { ScopedProjectRef, ScopedThreadRef } from "@cafecode/contracts";
import { scopedThreadKey } from "@cafecode/client-runtime";
import { readEnvironmentConnection } from "../environments/runtime";
import { readEnvironmentApi } from "../environmentApi";
import { selectProjectByRef, selectSidebarThreadSummaryByRef, useStore } from "../store";
import { newCommandId } from "../lib/utils";
import { useUiLocalization } from "../uiLocalization";
import { toastManager } from "./ui/toast";

const THREAD_DRAG_TYPE = "application/x-club-code-thread";
type ThreadDrag = {
  ref: ScopedThreadRef;
  projectId: string;
  api: NonNullable<ReturnType<typeof readEnvironmentApi>>;
  connection: ReturnType<typeof readEnvironmentConnection>;
};
const DragContext = createContext<{
  source: ThreadDrag | null;
  begin: (event: DragEvent, ref: ScopedThreadRef) => void;
  clear: () => void;
  drop: (event: DragEvent, refs: readonly ScopedProjectRef[], onMoved?: () => void) => void;
} | null>(null);

function destination(source: ThreadDrag | null, refs: readonly ScopedProjectRef[]) {
  if (!source) return null;
  // A grouped header can represent several projects. Never guess between two
  // projects on the same server, or move back into the source group.
  const local = refs.filter((ref) => ref.environmentId === source.ref.environmentId);
  if (local.length !== 1 || local[0]!.projectId === source.projectId) return null;
  return local[0]!;
}

export function SidebarThreadDragProvider({ children }: { children: ReactNode }) {
  const { t } = useUiLocalization();
  const [source, setSource] = useState<ThreadDrag | null>(null);
  const current = useRef<ThreadDrag | null>(null);
  const pending = useRef(new Set<string>());
  const clear = useCallback(() => {
    current.current = null;
    setSource(null);
  }, []);
  useEffect(() => {
    const cancel = () => {
      current.current = null;
      setSource(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    const hidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("dragend", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("dragend", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  const begin = useCallback(
    (event: DragEvent, ref: ScopedThreadRef) => {
      clear();
      const thread = selectSidebarThreadSummaryByRef(useStore.getState(), ref);
      const api = readEnvironmentApi(ref.environmentId);
      if (
        !thread ||
        thread.archivedAt ||
        !api ||
        pending.current.has(scopedThreadKey(ref)) ||
        (event.target instanceof Element &&
          event.target.closest("input,textarea,button,a,[contenteditable=true]"))
      ) {
        event.preventDefault();
        return;
      }
      const drag = {
        ref,
        projectId: thread.projectId,
        api,
        connection: readEnvironmentConnection(ref.environmentId),
      };
      current.current = drag;
      setSource(drag);
      event.dataTransfer.effectAllowed = "move";
      // Only an in-memory drag from this sidebar can authorize a move. Do not put
      // thread names, paths, IDs or server data in the system drag payload.
      event.dataTransfer.setData(THREAD_DRAG_TYPE, "thread");
      event.stopPropagation();
    },
    [clear],
  );

  const drop = useCallback(
    (event: DragEvent, refs: readonly ScopedProjectRef[], onMoved?: () => void) => {
      const drag = current.current;
      const target = destination(drag, refs);
      if (!drag || !target || !event.dataTransfer.types.includes(THREAD_DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      clear();
      const state = useStore.getState();
      const thread = selectSidebarThreadSummaryByRef(state, drag.ref);
      const project = selectProjectByRef(state, target);
      const key = scopedThreadKey(drag.ref);
      if (
        !thread ||
        thread.archivedAt ||
        thread.projectId !== drag.projectId ||
        !project ||
        drag.connection !== readEnvironmentConnection(drag.ref.environmentId) ||
        drag.api.orchestration.dispatchCommand !==
          readEnvironmentApi(drag.ref.environmentId)?.orchestration.dispatchCommand ||
        pending.current.has(key)
      )
        return;
      pending.current.add(key);
      void Promise.resolve()
        .then(() =>
          drag.api.orchestration.dispatchCommand({
            type: "thread.meta.update",
            commandId: newCommandId(),
            threadId: thread.id,
            projectId: project.id,
            worktreePath: null,
          }),
        )
        .then(() => {
          if (drag.connection !== readEnvironmentConnection(drag.ref.environmentId)) return;
          onMoved?.();
          toastManager.add({
            type: "success",
            title: t("Thread moved", "スレッドを移動しました"),
            description: project.name,
          });
        })
        .catch(() => {
          toastManager.add({
            type: "error",
            title: t("Unable to move thread", "スレッドを移動できません"),
            description: t(
              "Check the connection and try again.",
              "接続を確認して再試行してください。",
            ),
          });
        })
        .finally(() => pending.current.delete(key));
    },
    [clear, t],
  );
  const value = useMemo(() => ({ source, begin, clear, drop }), [source, begin, clear, drop]);
  return <DragContext.Provider value={value}>{children}</DragContext.Provider>;
}

export function useSidebarThreadDragSource(ref: ScopedThreadRef, disabled: boolean) {
  const context = useContext(DragContext);
  const { t } = useUiLocalization();
  return {
    draggable: !disabled && context !== null,
    "aria-description": t(
      "Drag to another project, or use Move Thread in the context menu.",
      "別のプロジェクトへドラッグするか、メニューのスレッド移動を使用してください。",
    ),
    onDragStart: (event: DragEvent) => {
      if (disabled) event.preventDefault();
      else context?.begin(event, ref);
    },
    onDragEnd: () => context?.clear(),
  };
}

export function SidebarThreadDropTarget({
  projectRefs,
  children,
  className,
  onMoved,
}: {
  projectRefs: readonly ScopedProjectRef[];
  children: ReactNode;
  className?: string;
  onMoved?: () => void;
}) {
  const context = useContext(DragContext);
  const { t } = useUiLocalization();
  const [over, setOver] = useState(false);
  const eligible = destination(context?.source ?? null, projectRefs) !== null;
  const accept = (event: DragEvent) => {
    if (eligible && event.dataTransfer.types.includes(THREAD_DRAG_TYPE)) {
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setOver(true);
    }
  };
  useEffect(() => {
    if (!context?.source) setOver(false);
  }, [context?.source]);
  return (
    <div
      className={`${className ?? ""} rounded-md ${eligible && over ? "bg-accent ring-2 ring-ring" : ""}`}
      data-thread-drop-active={eligible && over ? "true" : undefined}
      onDragEnter={accept}
      onDragOver={accept}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
        context?.drop(event, projectRefs, onMoved);
      }}
    >
      {children}
      {eligible && over && (
        <p role="status" className="px-2 py-1 text-xs text-foreground pointer-events-none">
          {t("Release to move thread", "離すとスレッドを移動します")}
        </p>
      )}
    </div>
  );
}
