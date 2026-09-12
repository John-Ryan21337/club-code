import type {
  AgentBrowserGrantState,
  AgentBrowserRequest,
  EmbeddedBrowserActionResult,
  EmbeddedBrowserSnapshot,
  EmbeddedBrowserState,
} from "@cafecode/contracts";
import { useParams } from "@tanstack/react-router";
import { EMBEDDED_BROWSER_MAX_TABS } from "@cafecode/contracts";
import { useEmbeddedBrowserLayout } from "../hooks/useEmbeddedBrowserLayout";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Copy,
  Eye,
  EyeOff,
  Globe2,
  LoaderCircle,
  MessageSquarePlus,
  Minus,
  Columns2,
  Maximize2,
  PanelsTopLeft,
  Plus,
  Grip,
  MousePointerClick,
  RefreshCw,
  ScanText,
  Send,
  ShieldCheck,
  Square,
  Unplug,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "./ui/button";
import { dispatchEmbeddedBrowserSnapshotToActiveComposer } from "../embeddedBrowserChatHandoff";
import { getPrimaryEnvironmentConnection } from "../environments/runtime";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { useStore } from "../store";
import { resolveThreadRouteRef } from "../threadRoutes";
import { copyTextToClipboard } from "../lib/copyToClipboard";
import { useClientSettingsHydrated, useSettings, useUpdateSettings } from "../hooks/useSettings";

const CLOSED_STATE: EmbeddedBrowserState = {
  status: "closed",
  tabId: null,
  displayUrl: "about:blank",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  shared: false,
  sharedOrigin: null,
};

function actionMessage(result: EmbeddedBrowserActionResult): string {
  return result.message;
}

export function EmbeddedBrowserWorkspace() {
  if (typeof window.desktopBridge?.openEmbeddedBrowser !== "function") return null;
  return <AvailableEmbeddedBrowserWorkspace />;
}

function AvailableEmbeddedBrowserWorkspace() {
  const bridge = window.desktopBridge;
  const available = typeof bridge?.openEmbeddedBrowser === "function";
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<EmbeddedBrowserState>(CLOSED_STATE);
  const [tabs, setTabs] = useState<EmbeddedBrowserState[]>([]);
  const tabsRef = useRef(tabs);
  const [agentExecuting, setAgentExecuting] = useState(false);
  const [geometryRevision, setGeometryRevision] = useState(0);
  const [url, setUrl] = useState("");
  const [snapshot, setSnapshot] = useState<EmbeddedBrowserSnapshot | null>(null);
  const [ocrLanguage, setOcrLanguage] = useState<"eng" | "jpn">("eng");
  const [selectedTargetId, setSelectedTargetId] = useState("");
  const [typeValue, setTypeValue] = useState("");
  const [sensitive, setSensitive] = useState(false);
  const [status, setStatus] = useState("Browser closed.");
  const [busy, setBusy] = useState(false);
  const [agentGrant, setAgentGrant] = useState<AgentBrowserGrantState>({
    status: "inactive",
    reason: "No pending browser action.",
  });
  const [agentStatus, setAgentStatus] = useState(
    "Thread access is on by default. Share a page to make it available to agents.",
  );
  const settingsHydrated = useClientSettingsHydrated();
  const disabledThreadIds = useSettings((settings) => settings.agentBrowserDisabledThreadIds);
  const { updateClientSettingsConfirmed } = useUpdateSettings();
  const disabledThreadIdsRef = useRef(disabledThreadIds);
  disabledThreadIdsRef.current = disabledThreadIds;
  const pendingThreadDenialsRef = useRef(new Set<string>());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const viewportHiddenRef = useRef(true);
  const viewportBoundsRef = useRef({ x: 0, y: 0, width: 1, height: 1 });
  const tabIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const agentBusyRef = useRef(false);
  const layout = useEmbeddedBrowserLayout(visible, tabs.length > 0, (hidden) => {
    viewportHiddenRef.current = hidden || !visible;
    const tabId = tabIdRef.current;
    if (hidden && tabId && bridge) {
      void bridge
        .setEmbeddedBrowserBounds({ tabId, bounds: viewportBoundsRef.current, visible: false })
        .catch(() => setStatus("Could not hide the browser view."));
    }
    setGeometryRevision((value) => value + 1);
  });
  const executedRequestIdsRef = useRef(new Set<string>());
  const agentGrantRef = useRef(agentGrant);
  agentGrantRef.current = agentGrant;
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const threadShell = useStore((store) =>
    routeThreadRef
      ? store.environmentStateById[routeThreadRef.environmentId]?.threadShellById[
          routeThreadRef.threadId
        ]
      : undefined,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const requester = useMemo(
    () =>
      routeThreadRef && threadShell && routeThreadRef.environmentId === primaryEnvironmentId
        ? {
            threadId: routeThreadRef.threadId,
            providerInstanceId: threadShell.modelSelection.instanceId,
          }
        : null,
    [routeThreadRef, threadShell, primaryEnvironmentId],
  );

  const revokeAgentGrant = useCallback(
    async (reason: "operator" | "origin-changed" | "tab-closed" | "thread-changed") => {
      agentGrantRef.current = {
        status: "inactive",
        reason: `Grant revoked: ${reason}.`,
      };
      setAgentGrant(agentGrantRef.current);
      setAgentStatus(`Agent browser grant revoked: ${reason}.`);
      try {
        await getPrimaryEnvironmentConnection().client.agentBrowser.revoke({ reason });
      } catch {
        // The local state is authoritative for stopping renderer polling even
        // if the provider process disappeared during revocation.
      }
    },
    [],
  );

  const updateState = useCallback(
    (nextState: EmbeddedBrowserState) => {
      if (nextState.tabId) {
        // Native startup and discarded tabs can still emit queued events. Only
        // the explicit open/select path may introduce a tab into this workspace.
        if (
          nextState.tabId !== tabIdRef.current &&
          !tabsRef.current.some((tab) => tab.tabId === nextState.tabId)
        )
          return;
        const remaining = tabsRef.current.filter((tab) => tab.tabId !== nextState.tabId);
        const existing = tabsRef.current.some((tab) => tab.tabId === nextState.tabId);
        tabsRef.current = existing
          ? tabsRef.current.map((tab) => (tab.tabId === nextState.tabId ? nextState : tab))
          : [...remaining, nextState];
        setTabs(tabsRef.current);
        // Background navigation must never select a tab or change agent authority.
        if (tabIdRef.current !== nextState.tabId) return;
      }
      const grant = agentGrantRef.current;
      if (
        nextState.status !== "open" ||
        !nextState.shared ||
        (grant.status === "active" &&
          (nextState.tabId !== grant.tabId || nextState.sharedOrigin !== grant.origin))
      ) {
        void revokeAgentGrant(nextState.status === "closed" ? "tab-closed" : "origin-changed");
      }
      setState(nextState);
      tabIdRef.current = nextState.tabId;
      setTypeValue("");
      setSnapshot(null);
      setSelectedTargetId("");
      if (nextState.status === "open") {
        setUrl(nextState.displayUrl === "about:blank" ? "" : nextState.displayUrl);
      }
    },
    [revokeAgentGrant],
  );

  useEffect(() => {
    if (!available || !bridge) return;
    return bridge.onEmbeddedBrowserState((nextState) => {
      updateState(nextState);
    });
  }, [available, bridge, updateState]);

  useEffect(() => {
    if (!available || !bridge || !visible || state.status !== "open" || !state.tabId) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    let frame: number | null = null;
    const updateBounds = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        if (viewportHiddenRef.current || tabIdRef.current !== state.tabId) return;
        const bounds = viewport.getBoundingClientRect();
        if (bounds.width < 1 || bounds.height < 1) {
          // Native views are outside DOM clipping. A collapsed viewport must
          // explicitly hide the old bounds until layout has room again.
          void bridge
            .setEmbeddedBrowserBounds({
              tabId: state.tabId!,
              bounds: viewportBoundsRef.current,
              visible: false,
            })
            .catch(() => setStatus("Could not hide the browser view."));
          return;
        }
        viewportBoundsRef.current = {
          x: Math.max(0, Math.round(bounds.left)),
          y: Math.max(0, Math.round(bounds.top)),
          width: Math.max(1, Math.round(bounds.width)),
          height: Math.max(1, Math.round(bounds.height)),
        };
        void bridge
          .setEmbeddedBrowserBounds({
            tabId: state.tabId!,
            bounds: viewportBoundsRef.current,
            visible: true,
          })
          .catch(() => {
            setStatus("Could not position the isolated browser view.");
          });
      });
    };

    updateBounds();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateBounds);
    observer?.observe(viewport);
    window.addEventListener("resize", updateBounds);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateBounds);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [
    available,
    bridge,
    state.status,
    state.tabId,
    visible,
    layout.panel.left,
    layout.panel.top,
    layout.panel.width,
    layout.panel.height,
    geometryRevision,
  ]);

  useEffect(
    () => () => {
      if (bridge) {
        void revokeAgentGrant("tab-closed");
        for (const tab of tabsRef.current) {
          if (tab.tabId)
            void bridge.closeEmbeddedBrowser({ tabId: tab.tabId }).catch(() => undefined);
        }
      }
    },
    [bridge, revokeAgentGrant],
  );

  const executeAgentRequest = useCallback(
    async (request: AgentBrowserRequest) => {
      if (
        !bridge ||
        agentBusyRef.current ||
        busyRef.current ||
        layout.interacting.current ||
        Date.now() >= Date.parse(request.expiresAt) ||
        tabIdRef.current !== request.tabId
      )
        return;
      if (
        disabledThreadIdsRef.current.includes(request.threadId) ||
        pendingThreadDenialsRef.current.has(request.threadId)
      )
        return;
      // Heartbeat polls continue during native approval. A delayed poll response
      // can repeat a request after completion; never execute that action twice.
      const executed = executedRequestIdsRef.current;
      if (executed.has(request.requestId)) return;
      executed.add(request.requestId);
      if (executed.size > 128) executed.delete(executed.values().next().value!);
      agentBusyRef.current = true;
      setAgentExecuting(true);
      setAgentStatus(`Agent requested: ${request.summary}. Using the shared origin authorization.`);
      try {
        // Restore the same tab before the requested action so the operator sees
        // the page. The frame boundary lets the viewport restore its bounds.
        viewportHiddenRef.current = false;
        setVisible(true);
        await bridge.setEmbeddedBrowserBounds({
          tabId: request.tabId,
          bounds: viewportBoundsRef.current,
          visible: true,
        });
        await new Promise<void>((resolve) =>
          window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
        );
        if (
          tabIdRef.current !== request.tabId ||
          Date.now() >= Date.parse(request.expiresAt) ||
          disabledThreadIdsRef.current.includes(request.threadId) ||
          pendingThreadDenialsRef.current.has(request.threadId)
        )
          return;
        let result;
        switch (request.action.type) {
          case "snapshot": {
            const nextSnapshot = await bridge.snapshotEmbeddedBrowser({
              tabId: request.tabId,
              mode: "dom-accessibility",
            });
            if (nextSnapshot) {
              setSnapshot(nextSnapshot);
              setSelectedTargetId(nextSnapshot.targets[0]?.targetId ?? "");
            }
            result = { type: "snapshot" as const, snapshot: nextSnapshot };
            break;
          }
          case "ocr": {
            const nextSnapshot = await bridge.snapshotEmbeddedBrowser({
              tabId: request.tabId,
              mode: "ocr",
              ocrLanguage: request.action.language,
            });
            if (nextSnapshot) {
              setSnapshot(nextSnapshot);
              setSelectedTargetId(nextSnapshot.targets[0]?.targetId ?? "");
            }
            result = { type: "snapshot" as const, snapshot: nextSnapshot };
            break;
          }
          case "navigate": {
            const actionResult = await bridge.navigateEmbeddedBrowser({
              tabId: request.tabId,
              url: request.action.url,
            });
            updateState(actionResult.state);
            result = { type: "action" as const, result: actionResult };
            break;
          }
          case "click": {
            const actionResult = await bridge.clickEmbeddedBrowser({
              tabId: request.tabId,
              snapshotId: request.action.snapshotId,
              targetId: request.action.targetId,
            });
            updateState(actionResult.state);
            result = { type: "action" as const, result: actionResult };
            break;
          }
          case "type": {
            const actionResult = await bridge.typeInEmbeddedBrowser({
              tabId: request.tabId,
              snapshotId: request.action.snapshotId,
              targetId: request.action.targetId,
              value: request.action.value,
              sensitive: false,
            });
            updateState(actionResult.state);
            result = { type: "action" as const, result: actionResult };
            break;
          }
          case "history": {
            const actionResult = await bridge.controlEmbeddedBrowserHistory({
              tabId: request.tabId,
              action: request.action.action,
            });
            updateState(actionResult.state);
            result = { type: "action" as const, result: actionResult };
            break;
          }
        }
        const completion = await getPrimaryEnvironmentConnection().client.agentBrowser.complete({
          context: { tabId: request.tabId, origin: request.origin },
          requestId: request.requestId,
          result,
        });
        setAgentGrant(completion.grant);
        setAgentStatus(
          completion.accepted
            ? result.type === "action"
              ? result.result.message
              : "Agent snapshot returned from the shared page."
            : "Agent action result was stale because its grant was revoked.",
        );
      } catch {
        setAgentStatus("Agent action stopped safely; no result was returned to the provider.");
      } finally {
        agentBusyRef.current = false;
        setAgentExecuting(false);
      }
    },
    [bridge, updateState, layout.interacting],
  );

  useEffect(() => {
    if (
      !settingsHydrated ||
      state.status !== "open" ||
      !state.shared ||
      !state.tabId ||
      !state.sharedOrigin
    ) {
      return;
    }
    let disposed = false;
    const poll = async () => {
      if (disposed || tabIdRef.current !== state.tabId) return;
      try {
        const next = await getPrimaryEnvironmentConnection().client.agentBrowser.poll({
          tabId: state.tabId!,
          origin: state.sharedOrigin!,
          defaultAccess: true,
        });
        if (disposed || tabIdRef.current !== state.tabId) return;
        setAgentGrant(next.grant);
        if (next.request && !agentBusyRef.current) await executeAgentRequest(next.request);
      } catch {
        if (!disposed) setAgentStatus("Could not reach the process-local agent browser broker.");
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 750);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    settingsHydrated,
    state.status,
    state.shared,
    state.tabId,
    state.sharedOrigin,
    executeAgentRequest,
    disabledThreadIds,
  ]);

  if (!available || !bridge) return null;

  const run = async (operation: () => Promise<void>, allowDuringAgent = false) => {
    if (busyRef.current || (agentBusyRef.current && !allowDuringAgent)) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await operation();
    } catch {
      setStatus("The isolated browser action failed safely.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const open = () =>
    run(async () => {
      setVisible(true);
      viewportHiddenRef.current = false;
      if (tabIdRef.current) {
        await bridge.setEmbeddedBrowserBounds({
          tabId: tabIdRef.current,
          bounds: viewportBoundsRef.current,
          visible: true,
        });
        return;
      }
      setStatus("Opening an isolated, temporary browser tab…");
      const nextState = await bridge.openEmbeddedBrowser({});
      tabIdRef.current = nextState.tabId;
      updateState(nextState);
      setStatus("Browser ready. Share an origin once to authorize routine agent actions.");
    });

  const selectTab = async (tab: EmbeddedBrowserState) => {
    if (!tab.tabId) return;
    const previous = tabIdRef.current;
    if (previous !== tab.tabId) {
      // Clear selection before awaiting revocation so stale requests cannot run.
      tabIdRef.current = null;
      if (previous)
        await bridge.setEmbeddedBrowserBounds({
          tabId: previous,
          bounds: viewportBoundsRef.current,
          visible: false,
        });
      await revokeAgentGrant("operator");
    }
    tabIdRef.current = tab.tabId;
    // A retained background tab may have navigated while revocation was pending.
    // Never overwrite its current sharing/origin state with the clicked render.
    updateState(tabsRef.current.find((current) => current.tabId === tab.tabId) ?? tab);
    viewportHiddenRef.current = false;
    setVisible(true);
    await bridge.setEmbeddedBrowserBounds({
      tabId: tab.tabId,
      bounds: viewportBoundsRef.current,
      visible: true,
    });
    setGeometryRevision((value) => value + 1);
  };

  const newTab = () =>
    run(async () => {
      if (tabsRef.current.length >= EMBEDDED_BROWSER_MAX_TABS) return;
      const next = await bridge.openEmbeddedBrowser({});
      await selectTab(next);
      setStatus("New tab ready.");
    });

  const close = () =>
    run(async () => {
      const tabId = tabIdRef.current;
      tabIdRef.current = null;
      viewportHiddenRef.current = true;
      setTypeValue("");
      setSnapshot(null);
      setSelectedTargetId("");
      await revokeAgentGrant("tab-closed");
      if (tabId) {
        await bridge.closeEmbeddedBrowser({ tabId });
        tabsRef.current = tabsRef.current.filter((tab) => tab.tabId !== tabId);
        setTabs(tabsRef.current);
      }
      const remaining = tabsRef.current[0];
      if (remaining) {
        await selectTab(remaining);
        setStatus("Tab session ended and its site storage cleared.");
        return;
      }
      updateState(CLOSED_STATE);
      setVisible(false);
      setStatus("Browser closed and temporary site storage cleared.");
    });

  const minimize = () =>
    run(async () => {
      viewportHiddenRef.current = true;
      if (!state.tabId) {
        setVisible(false);
        return;
      }
      await bridge.setEmbeddedBrowserBounds({
        tabId: state.tabId,
        bounds: viewportBoundsRef.current,
        visible: false,
      });
      if (viewportHiddenRef.current) setVisible(false);
    });

  const navigate = () =>
    run(async () => {
      if (!state.tabId || url.trim().length === 0) return;
      const result = await bridge.navigateEmbeddedBrowser({ tabId: state.tabId, url });
      updateState(result.state);
      setSnapshot(null);
      setSelectedTargetId("");
      setStatus(actionMessage(result));
    });

  const history = (action: "back" | "forward" | "reload" | "stop") =>
    run(async () => {
      if (!state.tabId) return;
      const result = await bridge.controlEmbeddedBrowserHistory({ tabId: state.tabId, action });
      updateState(result.state);
      if (action !== "stop") {
        setSnapshot(null);
        setSelectedTargetId("");
      }
      setStatus(actionMessage(result));
    });

  const toggleShare = () =>
    run(async () => {
      if (!state.tabId) return;
      const result = await bridge.shareEmbeddedBrowser({
        tabId: state.tabId,
        shared: !state.shared,
      });
      updateState(result.state);
      setStatus(actionMessage(result));
    }, state.shared);

  const toggleThreadAccess = () =>
    run(
      async () => {
        if (!requester || !settingsHydrated) return;
        const disabled = disabledThreadIds.includes(requester.threadId);
        const next = disabled
          ? disabledThreadIds.filter((id) => id !== requester.threadId)
          : [...disabledThreadIds, requester.threadId];
        // Block locally before waiting for persistence; the server also rejects
        // queued requests when the confirmed settings update disables a thread.
        disabledThreadIdsRef.current = next;
        if (!disabled) pendingThreadDenialsRef.current.add(requester.threadId);
        try {
          await updateClientSettingsConfirmed({ agentBrowserDisabledThreadIds: next });
        } catch (error) {
          disabledThreadIdsRef.current = disabledThreadIds;
          throw error;
        } finally {
          pendingThreadDenialsRef.current.delete(requester.threadId);
        }
        setAgentStatus(
          disabled
            ? "Agent Browser access enabled for this thread."
            : "Agent Browser access disabled for this thread.",
        );
      },
      requester !== null && !disabledThreadIds.includes(requester.threadId),
    );

  const takeSnapshot = (mode: "dom-accessibility" | "ocr") =>
    run(async () => {
      if (!state.tabId || !state.shared) return;
      const nextSnapshot = await bridge.snapshotEmbeddedBrowser({
        tabId: state.tabId,
        mode,
        ...(mode === "ocr" ? { ocrLanguage } : {}),
      });
      setSnapshot(nextSnapshot);
      setSelectedTargetId(nextSnapshot?.targets[0]?.targetId ?? "");
      setStatus(
        nextSnapshot
          ? nextSnapshot.ocr?.status === "unavailable"
            ? nextSnapshot.ocr.reason
            : "One approved, redacted page snapshot is ready."
          : "Snapshot was not approved or the page changed.",
      );
    });

  const addSnapshotToDraft = () =>
    run(async () => {
      if (!snapshot) return;
      const approved = await bridge.confirm(
        "Add this redacted browser snapshot as one-time context for the active chat? Review it before sending. It stays in memory only until removed or sent, but may contain rendered text below the current viewport, so cancel if the page contains secrets or inbox content.",
      );
      if (!approved) {
        setStatus("One-time chat context handoff was not approved.");
        return;
      }
      const dispatched = dispatchEmbeddedBrowserSnapshotToActiveComposer(snapshot);
      setStatus(
        dispatched
          ? "Redacted snapshot added as one-time chat context for review; it was not sent or saved."
          : "No active chat composer was found. Open a chat and try again.",
      );
    });

  const copyOcrText = () =>
    run(async () => {
      if (snapshot?.ocr?.status !== "completed") return;
      await copyTextToClipboard(snapshot.ocr.text);
      setStatus("Redacted visible-viewport OCR text copied to the clipboard.");
    });

  const clickTarget = () =>
    run(async () => {
      if (!state.tabId || !snapshot || !selectedTargetId) return;
      const result = await bridge.clickEmbeddedBrowser({
        tabId: state.tabId,
        snapshotId: snapshot.snapshotId,
        targetId: selectedTargetId,
      });
      updateState(result.state);
      setSnapshot(null);
      setSelectedTargetId("");
      setStatus(actionMessage(result));
    });

  const typeIntoTarget = () => {
    const value = typeValue;
    setTypeValue("");
    return run(async () => {
      if (!state.tabId || !snapshot || !selectedTargetId || value.length === 0) return;
      const result = await bridge.typeInEmbeddedBrowser({
        tabId: state.tabId,
        snapshotId: snapshot.snapshotId,
        targetId: selectedTargetId,
        value,
        sensitive,
      });
      updateState(result.state);
      setSnapshot(null);
      setSelectedTargetId("");
      setStatus(actionMessage(result));
    });
  };

  if (!visible && tabs.length === 0) {
    return (
      <Button
        aria-label={state.status === "open" ? "Resume Agent Browser" : "Open isolated browser"}
        className="fixed right-5 bottom-5 z-[180] rounded-full shadow-xl"
        onClick={open}
        size="icon-xl"
      >
        <Globe2 />
      </Button>
    );
  }

  const selectedTarget = snapshot?.targets.find((target) => target.targetId === selectedTargetId);
  const threadAccessDisabled = requester ? disabledThreadIds.includes(requester.threadId) : false;

  return (
    <>
      {tabs.length > 0 && (
        <nav
          aria-label="Browser tabs"
          className="fixed inset-x-0 bottom-0 z-[181] flex h-12 items-center gap-2 border-t border-border bg-card px-3 [-webkit-app-region:no-drag]"
        >
          <Globe2 className="size-4 shrink-0 text-primary" />
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <Button
                key={tab.tabId}
                aria-label={`${!visible && tab.tabId === state.tabId ? "Resume Agent Browser" : "Open browser tab"}: ${tab.title || "New tab"}`}
                aria-pressed={tab.tabId === state.tabId}
                disabled={busy || agentExecuting}
                className="max-w-60 shrink-0"
                size="sm"
                variant={tab.tabId === state.tabId ? "secondary" : "ghost"}
                onClick={() => run(() => selectTab(tab))}
              >
                <span className="truncate">{tab.title || "New tab"}</span>
              </Button>
            ))}
          </div>
          <Button
            aria-label="New browser tab"
            disabled={busy || agentExecuting || tabs.length >= EMBEDDED_BROWSER_MAX_TABS}
            onClick={newTab}
            size="icon-sm"
            variant="ghost"
          >
            <Plus />
          </Button>
        </nav>
      )}
      {visible && layout.mode === "split" && (
        <div
          role="separator"
          tabIndex={0}
          aria-label="Resize chat and browser"
          aria-orientation={layout.stacked ? "horizontal" : "vertical"}
          aria-valuenow={Math.round(layout.split)}
          aria-valuemin={25}
          aria-valuemax={75}
          className="fixed z-[182] touch-none bg-border hover:bg-primary focus:bg-primary [-webkit-app-region:no-drag]"
          style={
            layout.stacked
              ? {
                  left: 0,
                  top: layout.splitPosition - 4,
                  width: "100%",
                  height: 8,
                  cursor: "row-resize",
                }
              : {
                  left: layout.splitPosition - 4,
                  top: layout.topInset,
                  width: 8,
                  height: layout.height - layout.topInset,
                  cursor: "col-resize",
                }
          }
          {...layout.controls("split")}
          onKeyDown={(event) => {
            if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown", "Home"].includes(event.key)) {
              event.preventDefault();
              layout.setSplit(
                event.key === "Home"
                  ? 50
                  : Math.max(
                      25,
                      Math.min(
                        75,
                        layout.split + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -2 : 2),
                      ),
                    ),
              );
            }
          }}
        />
      )}
      {visible && (
        <section
          aria-label="Isolated browser workspace"
          style={layout.panel}
          className="fixed z-[180] flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl [-webkit-app-region:no-drag]"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
            <div
              role={layout.mode === "floating" ? "button" : undefined}
              tabIndex={layout.mode === "floating" ? 0 : undefined}
              aria-label={layout.mode === "floating" ? "Move browser" : undefined}
              className={`mr-1 flex min-w-0 flex-1 items-center gap-2 ${layout.mode === "floating" ? "cursor-move touch-none" : ""}`}
              {...(layout.mode === "floating" ? layout.controls("move") : {})}
            >
              <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">
                  {state.title || "Isolated browser"}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">
                  Tabs stay open when hidden
                </div>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <Button
                aria-label={
                  layout.mode === "split" ? "Use floating browser" : "Split chat and browser"
                }
                title={layout.mode === "split" ? "Use floating browser" : "Split chat and browser"}
                size="icon-sm"
                variant="ghost"
                onClick={() => layout.setMode(layout.mode === "split" ? "floating" : "split")}
              >
                {layout.mode === "split" ? <PanelsTopLeft /> : <Columns2 />}
              </Button>
              <Button
                aria-label={
                  layout.mode === "maximized" ? "Restore browser size" : "Maximize browser"
                }
                size="icon-sm"
                variant="ghost"
                onClick={() =>
                  layout.setMode(layout.mode === "maximized" ? "floating" : "maximized")
                }
              >
                <Maximize2 />
              </Button>
              <Button
                aria-label="Minimize Agent Browser"
                title="Keep this tab and login session open"
                disabled={busy || state.status !== "open"}
                onClick={minimize}
                size="icon-sm"
                variant="ghost"
              >
                <Minus />
              </Button>
              <Button
                aria-label={state.shared ? "Revoke page sharing" : "Share current origin"}
                disabled={busy || state.status !== "open" || state.displayUrl === "about:blank"}
                onClick={toggleShare}
                size="sm"
                variant={state.shared ? "default" : "outline"}
              >
                {state.shared ? <Eye /> : <EyeOff />}
                {state.shared ? "Shared" : "Private"}
              </Button>
              <Button
                aria-label="Hide Agent Browser"
                title="Hide browser and keep tabs open"
                disabled={busy}
                onClick={minimize}
                size="icon-sm"
                variant="ghost"
              >
                <X />
              </Button>
            </div>
          </header>

          <div className="flex shrink-0 items-center gap-1.5 border-b border-border bg-card/70 px-3 py-2">
            <Button
              aria-label="Go back"
              disabled={busy || !state.canGoBack}
              onClick={() => history("back")}
              size="icon-sm"
              variant="outline"
            >
              <ArrowLeft />
            </Button>
            <Button
              aria-label="Go forward"
              disabled={busy || !state.canGoForward}
              onClick={() => history("forward")}
              size="icon-sm"
              variant="outline"
            >
              <ArrowRight />
            </Button>
            <Button
              aria-label={state.loading ? "Stop loading" : "Reload"}
              disabled={busy || state.status !== "open"}
              onClick={() => history(state.loading ? "stop" : "reload")}
              size="icon-sm"
              variant="outline"
            >
              {state.loading ? <Square /> : <RefreshCw />}
            </Button>
            <label className="sr-only" htmlFor="embedded-browser-url">
              Browser address
            </label>
            <input
              autoCapitalize="none"
              autoComplete="off"
              className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              id="embedded-browser-url"
              onChange={(event) => setUrl(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void navigate();
              }}
              placeholder="https://portal.example"
              spellCheck={false}
              value={url}
            />
            <Button
              aria-label="Navigate"
              disabled={busy || !state.tabId || url.trim().length === 0}
              onClick={navigate}
              size="icon-sm"
            >
              <Send />
            </Button>
          </div>

          <div
            className="relative min-h-0 flex-1 bg-black"
            data-testid="embedded-browser-viewport"
            ref={viewportRef}
          >
            {state.status !== "open" ? (
              <div className="absolute inset-0 grid place-items-center text-sm text-white/70">
                <LoaderCircle className="mr-2 inline size-4 animate-spin" />
                Opening isolated browser…
              </div>
            ) : null}
          </div>

          <details className="max-h-[38%] shrink-0 overflow-auto border-t border-border bg-card px-3 py-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              Browser tools
            </summary>
            <Button
              disabled={busy || agentExecuting}
              onClick={close}
              size="xs"
              variant="outline"
              className="my-2"
            >
              End tab session
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={busy || !state.shared}
                onClick={() => takeSnapshot("dom-accessibility")}
                size="xs"
                variant="outline"
              >
                <Camera />
                Page snapshot
              </Button>
              <Button
                disabled={busy || !state.shared}
                onClick={() => takeSnapshot("ocr")}
                size="xs"
                title="Runs bounded offline OCR on only the currently visible isolated-browser viewport."
                variant="outline"
              >
                <ScanText />
                Visible image text
              </Button>
              <label className="sr-only" htmlFor="embedded-browser-ocr-language">
                OCR language
              </label>
              <select
                className="h-7 rounded-lg border border-input bg-background px-2 text-xs"
                disabled={busy}
                id="embedded-browser-ocr-language"
                onChange={(event) =>
                  setOcrLanguage(event.currentTarget.value === "jpn" ? "jpn" : "eng")
                }
                title="Packaged offline OCR language"
                value={ocrLanguage}
              >
                <option value="eng">English OCR</option>
                <option value="jpn">Japanese OCR</option>
              </select>
              <Button
                disabled={busy || !snapshot}
                onClick={addSnapshotToDraft}
                size="xs"
                variant="outline"
              >
                <MessageSquarePlus />
                Add to one-time chat context
              </Button>
              <span
                aria-live="polite"
                className={
                  state.shared ? "text-xs text-emerald-600" : "text-xs text-muted-foreground"
                }
              >
                {state.shared
                  ? `Shared origin: ${state.sharedOrigin}. Routine agent actions are authorized until sharing is revoked.`
                  : "Private: page content and agent-style controls are unavailable."}
              </span>
            </div>

            <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
              Direct interactions in the page are yours. Never share an inbox or secret-bearing
              page; paste credentials or 2FA codes only into the transient sensitive field below.
            </p>

            <div className="mt-2 rounded-lg border border-border bg-background/70 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="mr-auto">
                  <div className="text-xs font-semibold">Agent Browser access</div>
                  <div className="text-[11px] text-muted-foreground">
                    Threads have access by default. Disable access for the current thread below.
                    Sharing authorizes routine actions on this origin until you revoke access.
                  </div>
                </div>
                <Button
                  disabled={busy || !requester || !settingsHydrated}
                  onClick={toggleThreadAccess}
                  size="xs"
                  variant="outline"
                >
                  {threadAccessDisabled ? <ShieldCheck /> : <Unplug />}
                  {threadAccessDisabled ? "Enable for this thread" : "Disable for this thread"}
                </Button>
              </div>
              {agentGrant.status === "active" ? (
                <dl className="mt-2 grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-[auto_1fr]">
                  <dt className="font-medium">Requester</dt>
                  <dd className="min-w-0 break-all">
                    thread {agentGrant.threadId} · provider {agentGrant.providerInstanceId}
                  </dd>
                  <dt className="font-medium">Page</dt>
                  <dd className="min-w-0 break-all">
                    tab {agentGrant.tabId} · {agentGrant.origin}
                  </dd>
                  <dt className="font-medium">Pending</dt>
                  <dd>{agentGrant.pendingAction ?? "None"}</dd>
                </dl>
              ) : (
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {requester
                    ? `Ready for thread ${requester.threadId} · provider ${requester.providerInstanceId}.`
                    : "Open a local chat thread to select the exact requester."}
                </div>
              )}
              <div aria-live="polite" className="mt-1 text-[11px] text-muted-foreground">
                {agentStatus}
              </div>
            </div>

            {snapshot ? (
              <div className="mt-2 grid gap-2 border-t border-border/70 pt-2 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.2fr)]">
                <div className="grid content-start gap-2">
                  <label
                    className="grid gap-1 text-xs font-medium"
                    htmlFor="embedded-browser-target"
                  >
                    Approved snapshot target
                    <select
                      className="h-8 min-w-0 rounded-lg border border-input bg-background px-2 text-sm"
                      id="embedded-browser-target"
                      onChange={(event) => setSelectedTargetId(event.currentTarget.value)}
                      value={selectedTargetId}
                    >
                      {snapshot.targets.map((target) => (
                        <option key={target.targetId} value={target.targetId}>
                          {target.sensitive ? "Sensitive · " : ""}
                          {target.role}: {target.name || target.text || target.targetId}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      disabled={busy || !selectedTarget}
                      onClick={clickTarget}
                      size="xs"
                      variant="outline"
                    >
                      <MousePointerClick />
                      Click once
                    </Button>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      checked={sensitive}
                      onChange={(event) => setSensitive(event.currentTarget.checked)}
                      type="checkbox"
                    />
                    Sensitive credential / 2FA entry
                  </label>
                  <div className="flex gap-1.5">
                    <label className="sr-only" htmlFor="embedded-browser-type-value">
                      One-time text to enter
                    </label>
                    <input
                      autoComplete="off"
                      className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-sm"
                      id="embedded-browser-type-value"
                      onChange={(event) => setTypeValue(event.currentTarget.value)}
                      placeholder={sensitive ? "Transient sensitive value" : "Text to type once"}
                      type={sensitive ? "password" : "text"}
                      value={typeValue}
                    />
                    <Button
                      disabled={busy || !selectedTarget || typeValue.length === 0}
                      onClick={typeIntoTarget}
                      size="xs"
                    >
                      Type once
                    </Button>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[11px] text-muted-foreground">
                    {snapshot.redactionNotice}
                  </div>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-2 text-xs">
                    {snapshot.text || "No visible DOM text was returned."}
                  </pre>
                  {snapshot.ocr ? (
                    <div className="mt-2">
                      <div className="flex items-center gap-2">
                        <div className="mr-auto text-[11px] font-medium">
                          Visible-viewport offline OCR
                          {snapshot.ocr.status === "completed"
                            ? ` · ${snapshot.ocr.language} · ${snapshot.ocr.confidence.toFixed(1)} confidence`
                            : ""}
                        </div>
                        {snapshot.ocr.status === "completed" ? (
                          <Button
                            disabled={busy}
                            onClick={copyOcrText}
                            size="xs"
                            title="Copy the redacted OCR preview"
                            variant="outline"
                          >
                            <Copy />
                            Copy OCR
                          </Button>
                        ) : null}
                      </div>
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-background p-2 text-xs">
                        {snapshot.ocr.status === "completed"
                          ? snapshot.ocr.text || "No OCR text was returned."
                          : snapshot.ocr.reason}
                      </pre>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div aria-live="polite" className="mt-1.5 text-xs text-muted-foreground" role="status">
              {busy ? "Waiting for approval…" : status}
            </div>
          </details>
          {layout.mode === "floating" && (
            <div className="flex h-5 shrink-0 justify-end bg-card">
              <button
                aria-label="Resize browser"
                title="Drag to resize"
                className="flex w-8 touch-none cursor-se-resize items-center justify-center text-muted-foreground"
                {...layout.controls("resize")}
              >
                <Grip className="size-3" />
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
