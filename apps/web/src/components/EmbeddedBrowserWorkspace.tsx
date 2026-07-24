import type {
  AgentBrowserGrantState,
  AgentBrowserRequest,
  EmbeddedBrowserActionResult,
  EmbeddedBrowserSnapshot,
  EmbeddedBrowserState,
} from "@cafecode/contracts";
import { useParams } from "@tanstack/react-router";
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
import { getPrimaryKnownEnvironment } from "../environments/primary";
import { useStore } from "../store";
import { resolveThreadRouteRef } from "../threadRoutes";

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
  const bridge = window.desktopBridge;
  const available = typeof bridge?.openEmbeddedBrowser === "function";
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<EmbeddedBrowserState>(CLOSED_STATE);
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
    reason: "No active operator grant.",
  });
  const [agentStatus, setAgentStatus] = useState(
    "Agent controls are off. Sharing a page does not grant an agent control.",
  );
  const [now, setNow] = useState(Date.now());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const tabIdRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const agentBusyRef = useRef(false);
  const agentGrantRef = useRef(agentGrant);
  agentGrantRef.current = agentGrant;
  const agentGrantTabId = agentGrant.status === "active" ? agentGrant.tabId : null;
  const agentGrantOrigin = agentGrant.status === "active" ? agentGrant.origin : null;
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
  const primaryEnvironmentId = getPrimaryKnownEnvironment()?.environmentId;
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
      if (agentGrantRef.current.status !== "active") return;
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
      const grant = agentGrantRef.current;
      if (
        grant.status === "active" &&
        (nextState.status !== "open" ||
          nextState.tabId !== grant.tabId ||
          !nextState.shared ||
          nextState.sharedOrigin !== grant.origin)
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
    const grant = agentGrantRef.current;
    if (grant.status !== "active") return;
    if (
      !requester ||
      requester.threadId !== grant.threadId ||
      requester.providerInstanceId !== grant.providerInstanceId
    ) {
      void revokeAgentGrant("thread-changed");
    }
  }, [requester, revokeAgentGrant]);

  useEffect(() => {
    if (agentGrant.status !== "active") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [agentGrant.status]);

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
        const bounds = viewport.getBoundingClientRect();
        if (bounds.width < 1 || bounds.height < 1) return;
        void bridge
          .setEmbeddedBrowserBounds({
            tabId: state.tabId!,
            bounds: {
              x: Math.max(0, Math.round(bounds.left)),
              y: Math.max(0, Math.round(bounds.top)),
              width: Math.max(1, Math.round(bounds.width)),
              height: Math.max(1, Math.round(bounds.height)),
            },
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
  }, [available, bridge, state.status, state.tabId, visible]);

  useEffect(
    () => () => {
      const tabId = tabIdRef.current;
      if (tabId && bridge) {
        void revokeAgentGrant("tab-closed");
        void bridge.closeEmbeddedBrowser({ tabId }).catch(() => undefined);
      }
    },
    [bridge, revokeAgentGrant],
  );

  const executeAgentRequest = useCallback(
    async (request: AgentBrowserRequest) => {
      if (!bridge || agentBusyRef.current) return;
      agentBusyRef.current = true;
      setAgentStatus(`Agent requested: ${request.summary}. Waiting for your native approval.`);
      try {
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
            ? "Agent action completed through the operator approval bridge."
            : "Agent action result was stale because its grant was revoked.",
        );
      } catch {
        setAgentStatus("Agent action stopped safely; no result was returned to the provider.");
      } finally {
        agentBusyRef.current = false;
      }
    },
    [bridge, updateState],
  );

  useEffect(() => {
    if (
      agentGrant.status !== "active" ||
      !state.tabId ||
      !state.sharedOrigin ||
      agentGrantTabId !== state.tabId ||
      agentGrantOrigin !== state.sharedOrigin
    ) {
      return;
    }
    let disposed = false;
    const poll = async () => {
      if (disposed || agentBusyRef.current) return;
      try {
        const next = await getPrimaryEnvironmentConnection().client.agentBrowser.poll({
          tabId: state.tabId!,
          origin: state.sharedOrigin!,
        });
        if (disposed) return;
        setAgentGrant(next.grant);
        if (next.request) await executeAgentRequest(next.request);
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
    agentGrant.status,
    agentGrantTabId,
    agentGrantOrigin,
    state.tabId,
    state.sharedOrigin,
    executeAgentRequest,
  ]);

  if (!available || !bridge) return null;

  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
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
      setStatus("Opening an isolated, temporary browser tab…");
      const nextState = await bridge.openEmbeddedBrowser({});
      updateState(nextState);
      setStatus("Browser ready. Navigation and sharing require explicit approval.");
    });

  const close = () =>
    run(async () => {
      const tabId = tabIdRef.current;
      setTypeValue("");
      setSnapshot(null);
      setSelectedTargetId("");
      if (tabId) await bridge.closeEmbeddedBrowser({ tabId });
      updateState(CLOSED_STATE);
      setVisible(false);
      setStatus("Browser closed and temporary site storage cleared.");
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
    });

  const grantAgentControl = () =>
    run(async () => {
      if (!requester || !state.tabId || !state.shared || !state.sharedOrigin) return;
      const grant = await getPrimaryEnvironmentConnection().client.agentBrowser.grant({
        ...requester,
        tabId: state.tabId,
        origin: state.sharedOrigin,
        durationSeconds: 300,
      });
      setAgentGrant(grant);
      setNow(Date.now());
      setAgentStatus(
        grant.status === "active"
          ? "Agent control granted. Every requested action still requires native approval."
          : grant.reason,
      );
    });

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
      if (!navigator.clipboard?.writeText) {
        setStatus("Clipboard access is unavailable. Select the OCR preview text to copy it.");
        return;
      }
      await navigator.clipboard.writeText(snapshot.ocr.text);
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

  if (!visible) {
    return (
      <Button
        aria-label="Open isolated browser"
        className="fixed right-5 bottom-5 z-[180] rounded-full shadow-xl"
        onClick={open}
        size="icon-xl"
      >
        <Globe2 />
      </Button>
    );
  }

  const selectedTarget = snapshot?.targets.find((target) => target.targetId === selectedTargetId);
  const grantSecondsRemaining =
    agentGrant.status === "active"
      ? Math.max(0, Math.ceil((Date.parse(agentGrant.expiresAt) - now) / 1_000))
      : 0;

  return (
    <section
      aria-label="Isolated browser workspace"
      className="fixed inset-3 z-[180] flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl sm:inset-6"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-card px-3 py-2">
        <div className="mr-1 flex min-w-0 items-center gap-2">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {state.title || "Isolated browser"}
            </div>
            <div className="truncate text-[11px] text-muted-foreground">
              Temporary session · no Node.js · downloads and popups blocked
            </div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
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
            aria-label="Close isolated browser"
            disabled={busy}
            onClick={close}
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
        className="relative min-h-40 flex-1 bg-black"
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

      <div className="max-h-[38vh] shrink-0 overflow-auto border-t border-border bg-card px-3 py-2">
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
            className={state.shared ? "text-xs text-emerald-600" : "text-xs text-muted-foreground"}
          >
            {state.shared
              ? `Shared only with ${state.sharedOrigin}; every snapshot and control asks again.`
              : "Private: page content and agent-style controls are unavailable."}
          </span>
        </div>

        <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">
          Direct interactions in the page are yours. Never share an inbox or secret-bearing page;
          paste credentials or 2FA codes only into the transient sensitive field below.
        </p>

        <div className="mt-2 rounded-lg border border-border bg-background/70 p-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto">
              <div className="text-xs font-semibold">Bounded agent control</div>
              <div className="text-[11px] text-muted-foreground">
                One thread, one provider, this tab and origin only. OCR is visible-viewport-only,
                transient, offline, and separately approved. No image storage, credentials,
                passwords, or verification codes.
              </div>
            </div>
            {agentGrant.status === "active" ? (
              <Button
                onClick={() => void revokeAgentGrant("operator")}
                size="xs"
                variant="destructive"
              >
                <Unplug />
                Revoke now
              </Button>
            ) : (
              <Button
                disabled={
                  busy || !requester || !state.shared || !state.tabId || !state.sharedOrigin
                }
                onClick={grantAgentControl}
                size="xs"
                variant="outline"
              >
                <ShieldCheck />
                Grant 5 minutes
              </Button>
            )}
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
              <dt className="font-medium">Limits</dt>
              <dd>
                {grantSecondsRemaining}s remaining · {agentGrant.requestCount}/
                {agentGrant.requestLimit} requests
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
              <label className="grid gap-1 text-xs font-medium" htmlFor="embedded-browser-target">
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
              <div className="text-[11px] text-muted-foreground">{snapshot.redactionNotice}</div>
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
      </div>
    </section>
  );
}
