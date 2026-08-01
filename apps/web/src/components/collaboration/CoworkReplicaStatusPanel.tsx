import { useCallback, useEffect, useRef, useState } from "react";

import {
  appendCoworkReplicaStatusPage,
  beginCoworkReplicaStatusView,
  COWORK_REPLICA_STATUS_PAGE_LIMIT,
  decodeCoworkSharedProjectId,
  decodeCoworkReplicaStatusPage,
  type CoworkReplicaOperatorAttention,
  type CoworkReplicaRevisionView,
  type CoworkReplicaStatusView,
} from "../../coworkReplicaStatusModel";

export interface CoworkReplicaStatusClient {
  readonly listReplicaStatus: (request: {
    readonly sharedProjectId: string;
    readonly cursor: string | null;
    readonly limit: number;
    readonly signal: AbortSignal;
  }) => Promise<unknown>;
}

export interface CoworkReplicaStatusPanelProps {
  readonly client: CoworkReplicaStatusClient | null;
  readonly sharedProjectId: string;
}

type LoadState = "loading" | "ready" | "error";

function compactHash(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-8)}`;
}

function RevisionReference({ label, value }: { label: string; value: CoworkReplicaRevisionView }) {
  return (
    <div className="grid min-w-0 gap-0.5 text-[11px] text-muted-foreground">
      <span className="font-medium text-foreground/80">{label}</span>
      <span className="truncate font-mono" title={value.revisionId}>
        revision {compactHash(value.revisionId)}
      </span>
      {value.contentSha256 ? (
        <span className="truncate font-mono" title={value.contentSha256}>
          content {compactHash(value.contentSha256)}
        </span>
      ) : (
        <span>no file content exposed</span>
      )}
      <span className="truncate font-mono" title={value.auditRef}>
        audit {compactHash(value.auditRef)}
      </span>
    </div>
  );
}

const materializationLabel = {
  current: "Materialized at current head",
  "not-materialized": "Not materialized on this replica",
  pending: "Materialization pending",
  "recovery-preserved": "Prior local version preserved for recovery",
  failed: "Materialization failed",
} as const;

const operatorAttentionLabel: Record<CoworkReplicaOperatorAttention, string> = {
  "conflict-needs-resolution": "Review and resolve the preserved conflict.",
  "database-fork-needs-selection": "Choose the canonical database snapshot.",
  "head-tombstoned": "Review the recoverable tombstone at the current head.",
  "materialization-failed": "Review the failed local materialization.",
  "recovery-copy-preserved": "Review the prior local version preserved for recovery.",
};

function ReplicaStatusContents({
  client,
  sharedProjectId,
}: {
  readonly client: CoworkReplicaStatusClient;
  readonly sharedProjectId: string;
}) {
  const [view, setView] = useState<CoworkReplicaStatusView | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const requestPage = useCallback(
    async (cursor: string | null, previous: CoworkReplicaStatusView | null) => {
      const sequence = ++requestSequence.current;
      activeRequest.current?.abort();
      const abort = new AbortController();
      activeRequest.current = abort;
      try {
        const payload = await client.listReplicaStatus({
          sharedProjectId,
          cursor,
          limit: COWORK_REPLICA_STATUS_PAGE_LIMIT,
          signal: abort.signal,
        });
        const page = decodeCoworkReplicaStatusPage(payload, sharedProjectId);
        const next = previous
          ? appendCoworkReplicaStatusPage(previous, page, cursor ?? "")
          : beginCoworkReplicaStatusView(page);
        if (!mounted.current || abort.signal.aborted || sequence !== requestSequence.current)
          return;
        setView(next);
        setLoadState("ready");
      } catch {
        if (!mounted.current || abort.signal.aborted || sequence !== requestSequence.current)
          return;
        setLoadState("error");
      } finally {
        if (mounted.current && sequence === requestSequence.current) setLoadingMore(false);
      }
    },
    [client, sharedProjectId],
  );

  useEffect(() => {
    mounted.current = true;
    setView(null);
    setLoadState("loading");
    setLoadingMore(false);
    void requestPage(null, null);
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
      activeRequest.current?.abort();
      activeRequest.current = null;
    };
  }, [requestPage]);

  if (loadState === "loading") {
    return (
      <p aria-live="polite" className="px-4 py-6 text-sm text-muted-foreground" role="status">
        Loading managed replica status…
      </p>
    );
  }

  if (loadState === "error" || view === null) {
    return (
      <div aria-live="assertive" className="px-4 py-6" role="alert">
        <p className="text-sm font-medium text-foreground">Replica status is unavailable.</p>
        <p className="mt-1 text-xs text-muted-foreground">
          The response was stale, malformed, outside this project, or could not be loaded. No file
          action was attempted.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="border-b border-border/60 px-4 py-3 text-xs text-muted-foreground">
        Project revision {view.projectRevision}. Read-only status: this panel cannot delete,
        restore, materialize, or resolve files.
      </div>
      {view.entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted-foreground" role="status">
          No managed replica files are visible in this project.
        </p>
      ) : (
        <ol aria-label="Managed replica files" className="divide-y divide-border/60">
          {view.entries.map((entry) => (
            <li className="min-w-0 px-4 py-4" key={entry.relativePath}>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3
                    className="truncate font-mono text-sm font-semibold"
                    title={entry.relativePath}
                  >
                    {entry.relativePath}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Manifest revision {entry.manifestRevision} ·{" "}
                    {materializationLabel[entry.materialization]}
                  </p>
                </div>
                {entry.operatorAttention.length > 0 ? (
                  <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                    Operator attention
                  </span>
                ) : (
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                    No action requested
                  </span>
                )}
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {entry.head ? (
                  <RevisionReference
                    label={entry.head.kind === "version" ? "Manifest head" : "Tombstone head"}
                    value={entry.head}
                  />
                ) : (
                  <p className="text-[11px] text-muted-foreground">No manifest head</p>
                )}
                {entry.forks.map((fork) => (
                  <RevisionReference
                    key={fork.revisionId}
                    label="Preserved conflict fork"
                    value={fork}
                  />
                ))}
                {entry.recoverableTombstones.map((tombstone) => (
                  <RevisionReference
                    key={tombstone.revisionId}
                    label="Recoverable tombstone"
                    value={tombstone}
                  />
                ))}
              </div>

              {entry.conflictRefs.length > 0 ? (
                <div className="mt-3 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground/80">Conflict audit references:</span>{" "}
                  {entry.conflictRefs.map((reference) => (
                    <span className="mr-2 font-mono" key={reference} title={reference}>
                      {compactHash(reference)}
                    </span>
                  ))}
                </div>
              ) : null}

              {entry.operatorAttention.length > 0 ? (
                <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                  <h4 className="text-xs font-semibold text-foreground">
                    Operator attention required
                  </h4>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                    {entry.operatorAttention.map((reason) => (
                      <li key={reason}>{operatorAttentionLabel[reason]}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
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
            {loadingMore ? "Loading more…" : "Load more replica files"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function CoworkReplicaStatusPanel({
  client,
  sharedProjectId,
}: CoworkReplicaStatusPanelProps) {
  if (client === null) return null;
  try {
    decodeCoworkSharedProjectId(sharedProjectId);
  } catch {
    return (
      <section aria-label="Shared project managed replica status" role="alert">
        Replica status is unavailable. No file action was attempted.
      </section>
    );
  }
  return (
    <section
      aria-label="Shared project managed replica status"
      className="overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="border-b border-border/60 px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Managed replica status</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Project-scoped manifest, recovery, conflict, and materialization evidence only.
        </p>
      </header>
      <ReplicaStatusContents client={client} sharedProjectId={sharedProjectId} />
    </section>
  );
}
