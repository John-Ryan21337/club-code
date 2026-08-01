import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendCoworkReplicaApplyPreviewPage,
  beginCoworkReplicaApplyPreviewView,
  COWORK_REPLICA_APPLY_PREVIEW_PAGE_LIMIT,
  decodeCoworkReplicaApplyApprovalResponse,
  decodeCoworkReplicaApplyPreviewPage,
  decodeCoworkReplicaApplyProjectId,
  makeCoworkReplicaApplyApprovalCommand,
  type CoworkReplicaApplyAction,
  type CoworkReplicaApplyApprovalCommand,
  type CoworkReplicaApplyPreviewEntry,
  type CoworkReplicaApplyPreviewView,
} from "../../coworkReplicaApplyPreviewModel";

export interface CoworkReplicaApplyPreviewClient {
  readonly createCommandId: () => string;
  readonly previewReplicaApplyPlan: (request: {
    readonly sharedProjectId: string;
    readonly cursor: string | null;
    readonly limit: number;
    readonly signal: AbortSignal;
  }) => Promise<unknown>;
  readonly approveReplicaApplyPlan: (
    command: CoworkReplicaApplyApprovalCommand,
    options: { readonly signal: AbortSignal },
  ) => Promise<unknown>;
}

export interface CoworkReplicaApplyPreviewPanelProps {
  readonly client: CoworkReplicaApplyPreviewClient | null;
  readonly sharedProjectId: string;
}

type PreviewState = "loading" | "ready" | "error";
type ApprovalState = "idle" | "submitting" | "indeterminate" | "accepted" | "rejected";

const actionLabel: Record<CoworkReplicaApplyAction, string> = {
  "publish-version": "Publish version if manifest head still matches",
  "apply-version": "Apply version only if local base hash still matches",
  "apply-tombstone": "Delete only if local base hash still matches",
  "database-snapshot": "Transfer immutable database snapshot only",
  "skip-volatile-sidecar": "Skip volatile database sidecar",
  "preserve-conflict": "Preserve local file and record conflict",
  "no-overwrite": "Preserve local file; no overwrite",
};

function compactHash(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

function formatBytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MiB`;
  return `${(value / 1_073_741_824).toFixed(1)} GiB`;
}

function EvidenceHash({ label, value }: { readonly label: string; readonly value: string | null }) {
  return value === null ? null : (
    <span className="font-mono" title={value}>
      {label} {compactHash(value)}
    </span>
  );
}

function EntryEvidence({ entry }: { readonly entry: CoworkReplicaApplyPreviewEntry }) {
  return (
    <li className="min-w-0 px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-sm font-semibold" title={entry.relativePath}>
            {entry.relativePath}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{actionLabel[entry.action]}</p>
        </div>
        <span className="rounded-full border border-border px-2 py-1 text-[11px] text-muted-foreground">
          {formatBytes(entry.byteCount)}
        </span>
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <EvidenceHash label="base" value={entry.expectedBaseSha256} />
        <EvidenceHash label="content" value={entry.contentSha256} />
        <EvidenceHash label="snapshot" value={entry.databaseSnapshotSha256} />
        <EvidenceHash label="conflict" value={entry.conflictRef} />
      </div>
      {entry.action === "skip-volatile-sidecar" ? (
        <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
          WAL, SHM, and journal files are never synchronized. A consolidated immutable database
          snapshot is required instead.
        </p>
      ) : null}
      {entry.action === "preserve-conflict" || entry.action === "no-overwrite" ? (
        <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">
          Existing local content remains in place. This plan does not overwrite it.
        </p>
      ) : null}
    </li>
  );
}

function PreviewContents({
  client,
  sharedProjectId,
}: {
  readonly client: CoworkReplicaApplyPreviewClient;
  readonly sharedProjectId: string;
}) {
  const [view, setView] = useState<CoworkReplicaApplyPreviewView | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>("loading");
  const [approvalState, setApprovalState] = useState<ApprovalState>("idle");
  const [confirmed, setConfirmed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingCommand, setPendingCommand] = useState<CoworkReplicaApplyApprovalCommand | null>(
    null,
  );
  const mounted = useRef(false);
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const pendingCommandRef = useRef<CoworkReplicaApplyApprovalCommand | null>(null);

  const requestPage = useCallback(
    async (
      cursor: string | null,
      previous: CoworkReplicaApplyPreviewView | null,
      refreshNotice: string | null = null,
    ) => {
      const sequence = ++requestSequence.current;
      activeRequest.current?.abort();
      const abort = new AbortController();
      activeRequest.current = abort;
      if (cursor === null) {
        setPreviewState("loading");
        setView(null);
        setConfirmed(false);
        pendingCommandRef.current = null;
        setPendingCommand(null);
        setApprovalState("idle");
      }
      if (refreshNotice !== null) setNotice(refreshNotice);
      try {
        const payload = await client.previewReplicaApplyPlan({
          sharedProjectId,
          cursor,
          limit: COWORK_REPLICA_APPLY_PREVIEW_PAGE_LIMIT,
          signal: abort.signal,
        });
        const page = decodeCoworkReplicaApplyPreviewPage(payload, sharedProjectId);
        const next = previous
          ? appendCoworkReplicaApplyPreviewPage(previous, page, cursor ?? "")
          : beginCoworkReplicaApplyPreviewView(page);
        if (!mounted.current || abort.signal.aborted || sequence !== requestSequence.current)
          return;
        setView(next);
        setPreviewState("ready");
      } catch {
        if (!mounted.current || abort.signal.aborted || sequence !== requestSequence.current)
          return;
        setView(null);
        setPreviewState("error");
      } finally {
        if (mounted.current && sequence === requestSequence.current) setLoadingMore(false);
      }
    },
    [client, sharedProjectId],
  );

  useEffect(() => {
    mounted.current = true;
    setNotice(null);
    void requestPage(null, null);
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [requestPage]);

  const submitApproval = useCallback(
    async (command: CoworkReplicaApplyApprovalCommand) => {
      const sequence = ++requestSequence.current;
      activeRequest.current?.abort();
      const abort = new AbortController();
      activeRequest.current = abort;
      setApprovalState("submitting");
      setNotice(null);
      let payload: unknown;
      try {
        payload = await client.approveReplicaApplyPlan(command, { signal: abort.signal });
      } catch {
        if (!mounted.current || abort.signal.aborted || sequence !== requestSequence.current)
          return;
        setApprovalState("indeterminate");
        setNotice(
          "The approval acknowledgement is indeterminate. Retry only the exact frozen command, or refresh and discard it.",
        );
        return;
      }
      let response;
      try {
        response = decodeCoworkReplicaApplyApprovalResponse(payload, command);
      } catch {
        if (!mounted.current || abort.signal.aborted || sequence !== requestSequence.current)
          return;
        void requestPage(
          null,
          null,
          "The approval receipt was malformed or did not match current authority. The old plan was discarded.",
        );
        return;
      }
      try {
        if (!mounted.current || abort.signal.aborted || sequence !== requestSequence.current)
          return;
        if (response.status === "accepted" || response.status === "replayed") {
          setApprovalState("accepted");
          setNotice(
            response.status === "replayed"
              ? "The exact approval receipt was replayed. This is not proof that files were applied."
              : "Approval was accepted. This is not proof that files were applied.",
          );
          return;
        }
        if (response.status === "authority-changed") {
          void requestPage(
            null,
            null,
            "Project authority changed. The old plan was discarded; review the refreshed plan.",
          );
          return;
        }
        setPendingCommand(null);
        pendingCommandRef.current = null;
        setConfirmed(false);
        setApprovalState("rejected");
        setNotice("Approval was rejected. No applied outcome is claimed.");
      } catch {
        if (!mounted.current || abort.signal.aborted || sequence !== requestSequence.current)
          return;
        void requestPage(null, null, "Approval state changed unexpectedly. Review a fresh plan.");
      }
    },
    [client, requestPage],
  );

  if (previewState === "loading") {
    return (
      <p aria-live="polite" className="px-4 py-6 text-sm text-muted-foreground" role="status">
        Loading immutable apply preview…
      </p>
    );
  }

  if (previewState === "error" || view === null) {
    return (
      <div aria-live="assertive" className="px-4 py-6" role="alert">
        <p className="text-sm font-medium">Apply preview is unavailable.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The response was malformed, stale, outside this project, or exceeded a bound. No approval
          or file action was attempted.
        </p>
      </div>
    );
  }

  const complete = view.nextCursor === null && view.entries.length === view.summary.totalEntryCount;
  const canApprove =
    complete &&
    confirmed &&
    approvalState !== "submitting" &&
    approvalState !== "accepted" &&
    pendingCommand === null;

  return (
    <div className="min-w-0">
      <div className="border-b border-border/60 px-4 py-3 text-xs text-muted-foreground">
        <div className="grid gap-1 sm:grid-cols-2">
          <span>Plan {compactHash(view.planSha256)}</span>
          <span>Token {compactHash(view.planToken)}</span>
          <span>Device {view.deviceId}</span>
          <span>Membership epoch {view.membershipEpoch}</span>
          <span>Manifest revision {view.manifestRevision}</span>
          <span>Fence {view.fence}</span>
          <span title={view.manifestHeadSha256}>Head {compactHash(view.manifestHeadSha256)}</span>
          <span title={view.baseManifestSha256}>Base {compactHash(view.baseManifestSha256)}</span>
        </div>
        <p className="mt-2 font-medium text-foreground/80">
          Preview only. Nothing in this panel is applied file truth.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 border-b border-border/60 px-4 py-3 text-xs sm:grid-cols-4">
        <span>{view.summary.totalEntryCount} planned outcomes</span>
        <span>{formatBytes(view.summary.totalBytes)} bounded content</span>
        <span>{view.summary.conflictCount} conflicts preserved</span>
        <span>{view.summary.skippedSidecarCount} volatile sidecars skipped</span>
        <span>{view.summary.databaseSnapshotCount} database snapshots</span>
        <span>{view.summary.tombstoneCount} tombstones</span>
        <span>{view.summary.noOverwriteCount} no-overwrite outcomes</span>
      </div>

      {view.entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground" role="status">
          This immutable plan contains no file outcomes.
        </p>
      ) : (
        <ol aria-label="Managed replica apply plan" className="divide-y divide-border/60">
          {view.entries.map((entry) => (
            <EntryEvidence entry={entry} key={entry.relativePath} />
          ))}
        </ol>
      )}

      {view.nextCursor ? (
        <div className="border-t border-border/60 px-4 py-3">
          <button
            className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            disabled={loadingMore}
            onClick={() => {
              const nextCursor = view.nextCursor;
              if (!nextCursor || loadingMore) return;
              setLoadingMore(true);
              void requestPage(nextCursor, view);
            }}
            type="button"
          >
            {loadingMore ? "Loading more…" : "Load complete plan"}
          </button>
          <p className="mt-2 text-xs text-muted-foreground">
            Approval remains unavailable until every bounded page is loaded and reconciled.
          </p>
        </div>
      ) : (
        <div className="border-t border-border/60 px-4 py-4">
          <label className="flex items-start gap-2 text-xs text-foreground">
            <input
              checked={confirmed}
              className="mt-0.5"
              disabled={approvalState === "submitting" || approvalState === "accepted"}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>
              I reviewed the exact plan, conflicts, tombstones, database snapshots, skipped volatile
              sidecars, and no-overwrite outcomes. I understand approval is not applied truth.
            </span>
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              disabled={!canApprove}
              onClick={() => {
                if (!canApprove || pendingCommandRef.current !== null) return;
                try {
                  const command = makeCoworkReplicaApplyApprovalCommand(
                    view,
                    client.createCommandId(),
                  );
                  pendingCommandRef.current = command;
                  setPendingCommand(command);
                  void submitApproval(command);
                } catch {
                  setApprovalState("rejected");
                  setNotice("A safe immutable approval command could not be created.");
                }
              }}
              type="button"
            >
              {approvalState === "submitting" ? "Submitting approval…" : "Approve exact plan"}
            </button>
            {approvalState === "indeterminate" && pendingCommand ? (
              <button
                className="rounded-md border border-amber-500/60 bg-background px-3 py-1.5 text-xs font-semibold"
                onClick={() => void submitApproval(pendingCommand)}
                type="button"
              >
                Retry exact approval
              </button>
            ) : null}
            {approvalState === "indeterminate" ? (
              <button
                className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium"
                onClick={() =>
                  void requestPage(
                    null,
                    null,
                    "The indeterminate command was discarded locally. Review new authority before approval.",
                  )
                }
                type="button"
              >
                Discard and refresh
              </button>
            ) : null}
          </div>
          {notice ? (
            <p
              aria-live={approvalState === "accepted" ? "polite" : "assertive"}
              className="mt-3 text-xs font-medium text-amber-700 dark:text-amber-300"
              role={approvalState === "accepted" ? "status" : "alert"}
            >
              {notice}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function CoworkReplicaApplyPreviewPanel({
  client,
  sharedProjectId,
}: CoworkReplicaApplyPreviewPanelProps) {
  if (client === null) return null;
  try {
    decodeCoworkReplicaApplyProjectId(sharedProjectId);
  } catch {
    return (
      <section aria-label="Managed replica apply preview" role="alert">
        Apply preview is unavailable. No approval or file action was attempted.
      </section>
    );
  }
  return (
    <section
      aria-label="Managed replica apply preview"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-semibold">Managed replica apply preview</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Review a bounded, content-addressed plan before sending one explicit approval command.
        </p>
      </header>
      <PreviewContents client={client} sharedProjectId={sharedProjectId} />
    </section>
  );
}
