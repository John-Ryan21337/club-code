import {
  COLLABORATION_PROJECT_MEMBER_LIMIT,
  type CollaborationProjectMember,
  type SharedProjectId,
  type UserId,
} from "@cafecode/contracts";
import { BookOpenTextIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button.tsx";
import {
  buildSharedOperatorPromptLaneWindow,
  SHARED_OPERATOR_PROMPT_VISIBLE_LANE_LIMIT,
} from "./SharedOperatorPromptLanes.model.ts";
import {
  appendSharedOperatorPromptPage,
  decodeSharedOperatorPromptPage,
  EMPTY_SHARED_OPERATOR_PROMPT_TIMELINE,
  isSharedOperatorPromptIdentifier,
  SHARED_OPERATOR_PROMPT_PAGE_LIMIT,
  snapshotSharedOperatorPromptAuthors,
  type SharedOperatorPromptConnectionState,
  type SharedOperatorPromptEntry,
  type SharedOperatorPromptTimelineClient,
  type SharedOperatorPromptTimelineState,
} from "./SharedOperatorPromptTimeline.model.ts";

const REMOVED_PROMPT_NOTICE = "This shared operator prompt was removed.";

type SharedOperatorPromptPresentationMode = "merged" | "lanes";

function formatOccurredAt(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(Date.parse(iso));
}

function SharedOperatorPromptRow(props: {
  readonly entry: SharedOperatorPromptEntry;
  readonly authorName: string;
  readonly isCurrentOperator: boolean;
}) {
  return (
    <li
      aria-label={`Prompt from ${props.authorName}`}
      className={cn(
        "rounded-lg border p-3",
        props.isCurrentOperator
          ? "border-cyan-500/30 bg-cyan-500/5"
          : "border-border/60 bg-card/60",
      )}
      data-prompt-id={props.entry.messageId}
    >
      <header className="flex min-w-0 items-baseline gap-2 text-xs">
        <strong className="truncate">{props.authorName}</strong>
        {props.isCurrentOperator ? (
          <span className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] uppercase text-cyan-700 dark:text-cyan-300">
            You
          </span>
        ) : null}
        <span className="text-muted-foreground">
          Operator prompt #{props.entry.operatorSequence}
        </span>
        <time
          className="ml-auto shrink-0 text-muted-foreground"
          dateTime={props.entry.occurredAtIso}
        >
          {formatOccurredAt(props.entry.occurredAtIso)}
        </time>
      </header>
      <p
        className={cn(
          "mt-2 whitespace-pre-wrap break-words text-sm [unicode-bidi:plaintext]",
          props.entry.body === null && "italic text-muted-foreground",
        )}
        dir="auto"
      >
        {props.entry.body ?? REMOVED_PROMPT_NOTICE}
      </p>
      <span className="sr-only">Project order {props.entry.projectSequence}</span>
    </li>
  );
}

export interface SharedOperatorPromptTimelineProps {
  readonly projectId: SharedProjectId;
  readonly currentUserId: UserId;
  readonly participants: readonly CollaborationProjectMember[];
  readonly client?: SharedOperatorPromptTimelineClient | null;
  readonly connectionState?: SharedOperatorPromptConnectionState;
  readonly className?: string;
}

export function SharedOperatorPromptTimeline({
  projectId,
  currentUserId,
  participants,
  client = null,
  connectionState = "online",
  className,
}: SharedOperatorPromptTimelineProps) {
  let authors: ReturnType<typeof snapshotSharedOperatorPromptAuthors> | null = null;
  try {
    authors = snapshotSharedOperatorPromptAuthors(participants);
  } catch {
    authors = null;
  }
  const participantFingerprint = authors
    ?.map(
      (author) =>
        `${author.userId.length}:${author.userId}:${author.displayName.length}:${author.displayName}:${author.membershipFingerprint.length}:${author.membershipFingerprint}`,
    )
    .join("|");
  const authorNames = new Map((authors ?? []).map((author) => [author.userId, author.displayName]));
  const projectValid = isSharedOperatorPromptIdentifier(projectId);
  const currentUserValid = isSharedOperatorPromptIdentifier(currentUserId);
  const rosterValid = authors !== null;
  const currentAuthor = authors?.find((author) => author.userId === currentUserId);
  const currentUserInRoster = currentAuthor !== undefined;
  const currentUserCanRead = currentAuthor?.canReadTranscript === true;
  const scopeKey =
    projectValid && currentUserValid && participantFingerprint !== undefined
      ? JSON.stringify([projectId, currentUserId, participantFingerprint])
      : null;
  const [timeline, setTimeline] = useState<SharedOperatorPromptTimelineState>(
    EMPTY_SHARED_OPERATOR_PROMPT_TIMELINE,
  );
  const timelineRef = useRef(timeline);
  const [pageState, setPageState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [presentation, setPresentation] = useState<{
    readonly scopeKey: string | null;
    readonly mode: SharedOperatorPromptPresentationMode;
    readonly laneWindowStart: number;
  }>({ scopeKey: null, mode: "merged", laneWindowStart: 0 });
  const generationRef = useRef(0);
  const generationAbortRef = useRef<AbortController | null>(null);
  const pageAbortRef = useRef<AbortController | null>(null);
  const pageInFlightRef = useRef(false);
  const activeScopeRef = useRef<{
    readonly client: typeof client;
    readonly key: string | null;
  } | null>(null);

  const updateTimeline = useCallback((next: SharedOperatorPromptTimelineState) => {
    timelineRef.current = next;
    setTimeline(next);
  }, []);

  const requestPage = useCallback(
    (expectedGeneration: number) => {
      if (
        client === null ||
        connectionState !== "online" ||
        !projectValid ||
        !currentUserValid ||
        !rosterValid ||
        !currentUserInRoster ||
        !currentUserCanRead ||
        activeScopeRef.current?.client !== client ||
        activeScopeRef.current.key !== scopeKey ||
        !timelineRef.current.hasMore ||
        pageInFlightRef.current ||
        generationRef.current !== expectedGeneration
      ) {
        return;
      }
      const requestedAfterSequence = timelineRef.current.nextCursor;
      const generationSignal = generationAbortRef.current?.signal;
      if (generationSignal === undefined || generationSignal.aborted) return;
      const abort = new AbortController();
      generationSignal.addEventListener("abort", () => abort.abort(), { once: true });
      pageAbortRef.current = abort;
      pageInFlightRef.current = true;
      setPageState("loading");
      void Promise.resolve()
        .then(() => {
          if (
            abort.signal.aborted ||
            generationRef.current !== expectedGeneration ||
            activeScopeRef.current?.client !== client ||
            activeScopeRef.current.key !== scopeKey
          ) {
            throw new DOMException("The shared prompt read was superseded.", "AbortError");
          }
          return client.readAuthoredMessages({
            sharedProjectId: projectId,
            afterSequence: requestedAfterSequence,
            limit: SHARED_OPERATOR_PROMPT_PAGE_LIMIT,
            kinds: ["authored-prompt"],
            signal: abort.signal,
          });
        })
        .then((payload) => {
          if (
            abort.signal.aborted ||
            generationRef.current !== expectedGeneration ||
            activeScopeRef.current?.client !== client ||
            activeScopeRef.current.key !== scopeKey
          ) {
            return;
          }
          const page = decodeSharedOperatorPromptPage(
            payload,
            String(projectId),
            requestedAfterSequence,
          );
          const next = appendSharedOperatorPromptPage(
            timelineRef.current,
            page,
            requestedAfterSequence,
          );
          updateTimeline(next);
          setPageState("ready");
        })
        .catch(() => {
          if (!abort.signal.aborted && generationRef.current === expectedGeneration) {
            setPageState("error");
          }
        })
        .finally(() => {
          if (pageAbortRef.current === abort) {
            pageAbortRef.current = null;
            pageInFlightRef.current = false;
          }
        });
    },
    [
      client,
      connectionState,
      currentUserInRoster,
      currentUserCanRead,
      currentUserValid,
      projectId,
      projectValid,
      rosterValid,
      scopeKey,
      updateTimeline,
    ],
  );

  useEffect(() => {
    generationAbortRef.current?.abort();
    const generationAbort = new AbortController();
    const activeScope = { client, key: scopeKey };
    activeScopeRef.current = activeScope;
    generationAbortRef.current = generationAbort;
    generationRef.current += 1;
    pageAbortRef.current?.abort();
    pageAbortRef.current = null;
    pageInFlightRef.current = false;
    updateTimeline(EMPTY_SHARED_OPERATOR_PROMPT_TIMELINE);
    setPageState("idle");
    return () => {
      generationAbort.abort();
      if (activeScopeRef.current === activeScope) activeScopeRef.current = null;
    };
  }, [client, scopeKey, updateTimeline]);

  useEffect(() => {
    if (connectionState === "online") return;
    pageAbortRef.current?.abort();
    pageAbortRef.current = null;
    pageInFlightRef.current = false;
    setPageState((current) => (current === "loading" ? "idle" : current));
  }, [connectionState]);

  useEffect(() => {
    if (
      client === null ||
      connectionState !== "online" ||
      !projectValid ||
      !currentUserValid ||
      !rosterValid ||
      !currentUserInRoster ||
      !currentUserCanRead ||
      activeScopeRef.current?.client !== client ||
      activeScopeRef.current.key !== scopeKey
    ) {
      return;
    }
    const generation = generationRef.current;
    queueMicrotask(() => {
      if (
        generationRef.current === generation &&
        timelineRef.current.pageCount === 0 &&
        !pageInFlightRef.current
      ) {
        requestPage(generation);
      }
    });
  }, [
    client,
    connectionState,
    currentUserInRoster,
    currentUserCanRead,
    currentUserValid,
    projectValid,
    requestPage,
    rosterValid,
    scopeKey,
  ]);

  const scopeIsActive =
    activeScopeRef.current?.client === client &&
    activeScopeRef.current.key === scopeKey &&
    scopeKey !== null;
  const visibleTimeline = scopeIsActive ? timeline : EMPTY_SHARED_OPERATOR_PROMPT_TIMELINE;
  const visiblePageState = scopeIsActive ? pageState : "idle";
  const visiblePresentation =
    presentation.scopeKey === scopeKey
      ? presentation
      : { scopeKey, mode: "merged" as const, laneWindowStart: 0 };
  let laneWindow: ReturnType<typeof buildSharedOperatorPromptLaneWindow> | null = null;
  try {
    laneWindow = buildSharedOperatorPromptLaneWindow(
      visibleTimeline.entries,
      authors ?? [],
      visiblePresentation.laneWindowStart,
    );
  } catch {
    laneWindow = null;
  }

  if (client === null) return null;
  if (
    !projectValid ||
    !currentUserValid ||
    authors === null ||
    !currentUserInRoster ||
    !currentUserCanRead
  ) {
    return (
      <section
        aria-label="Shared operator prompt timeline unavailable"
        className={cn("rounded-lg border border-destructive/50 p-3 text-sm", className)}
      >
        Shared operator prompts are unavailable because the project identity, roster, or transcript
        permission is invalid.
      </section>
    );
  }

  return (
    <section
      aria-label="Shared operator prompt timeline"
      className={cn(
        "flex h-[32rem] min-h-0 w-full max-w-3xl flex-col rounded-xl border border-border/70 bg-background",
        className,
      )}
      data-shared-prompt-project-id={projectId}
    >
      <header className="border-b border-border/60 p-3">
        <div className="flex items-center gap-2">
          <BookOpenTextIcon className="size-4" />
          <h2 className="font-semibold">Shared operator prompts</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {authors.length}/{COLLABORATION_PROJECT_MEMBER_LIMIT} participants
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Read-only project prompts with explicit authorship. Nothing here is replayed or added to a
          model context automatically.
        </p>
        <p aria-live="polite" className="mt-1 text-xs text-muted-foreground">
          {connectionState === "online"
            ? visiblePageState === "error"
              ? "Prompt history is temporarily unavailable."
              : "Connected"
            : connectionState === "offline"
              ? "Offline"
              : "Reconnecting"}
        </p>
        <div
          aria-label="Shared prompt presentation"
          className="mt-2 inline-flex rounded-md border border-border/60 p-0.5"
          role="group"
        >
          <Button
            aria-pressed={visiblePresentation.mode === "merged"}
            onClick={() => setPresentation({ scopeKey, mode: "merged", laneWindowStart: 0 })}
            size="xs"
            type="button"
            variant={visiblePresentation.mode === "merged" ? "secondary" : "ghost"}
          >
            Merged
          </Button>
          <Button
            aria-pressed={visiblePresentation.mode === "lanes"}
            onClick={() => setPresentation({ scopeKey, mode: "lanes", laneWindowStart: 0 })}
            size="xs"
            type="button"
            variant={visiblePresentation.mode === "lanes" ? "secondary" : "ghost"}
          >
            Side by side
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-center border-b border-border/40 p-1.5">
          <Button
            aria-label="Load more shared operator prompts"
            disabled={
              visiblePageState === "loading" ||
              !visibleTimeline.hasMore ||
              connectionState !== "online" ||
              !scopeIsActive
            }
            onClick={() => requestPage(generationRef.current)}
            size="xs"
            variant="ghost"
          >
            <RefreshCwIcon className={cn(visiblePageState === "loading" && "animate-spin")} />
            {visibleTimeline.truncated
              ? "Bounded prompt window reached"
              : visibleTimeline.hasMore
                ? "Load more shared prompts"
                : "Shared prompt history is current"}
          </Button>
        </div>
        {laneWindow === null ? (
          <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
            No prompt history was admitted.
          </div>
        ) : visibleTimeline.entries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
            {visiblePageState === "error"
              ? "No prompt history was admitted."
              : "No project-visible operator prompts loaded."}
          </div>
        ) : visiblePresentation.mode === "merged" ? (
          <ol
            aria-label="Project-visible operator prompts"
            className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden p-3"
          >
            {visibleTimeline.entries.map((entry) => (
              <SharedOperatorPromptRow
                authorName={authorNames.get(entry.authorUserId) ?? "Former project operator"}
                entry={entry}
                isCurrentOperator={entry.authorUserId === currentUserId}
                key={entry.messageId}
              />
            ))}
          </ol>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col" data-shared-prompt-lanes="true">
            {laneWindow.totalLaneCount > SHARED_OPERATOR_PROMPT_VISIBLE_LANE_LIMIT ? (
              <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2 text-xs">
                <label htmlFor="shared-prompt-first-lane">First visible operator lane</label>
                <select
                  className="max-w-64 rounded-md border border-border bg-background px-2 py-1"
                  id="shared-prompt-first-lane"
                  onChange={(event) => {
                    const laneWindowStart = Number(event.currentTarget.value);
                    setPresentation({ scopeKey, mode: "lanes", laneWindowStart });
                  }}
                  value={laneWindow.windowStart}
                >
                  {authors.map((author, index) => (
                    <option key={author.userId} value={index}>
                      {author.displayName}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">
                  Showing at most {SHARED_OPERATOR_PROMPT_VISIBLE_LANE_LIMIT} of{" "}
                  {laneWindow.totalLaneCount}
                  {" operator lanes."}
                </span>
              </div>
            ) : null}
            {laneWindow.hiddenFormerOperatorPromptCount > 0 ? (
              <p className="border-b border-border/40 px-3 py-2 text-xs text-muted-foreground">
                {laneWindow.hiddenFormerOperatorPromptCount} prompt
                {laneWindow.hiddenFormerOperatorPromptCount === 1 ? "" : "s"} from former project
                operators remain available in the merged view.
              </p>
            ) : null}
            <div
              aria-label="Side-by-side current operator prompt lanes"
              className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3"
              role="region"
              tabIndex={0}
            >
              <div className="flex h-full min-w-max gap-3">
                {laneWindow.lanes.map((lane) => (
                  <section
                    aria-label={`Prompt lane for ${lane.displayName}`}
                    className="flex h-full w-72 shrink-0 flex-col rounded-lg border border-border/60 bg-card/30"
                    key={lane.userId}
                  >
                    <header className="border-b border-border/50 px-3 py-2">
                      <h3 className="truncate text-sm font-semibold" dir="auto">
                        {lane.displayName}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {lane.entries.length} authored prompt{lane.entries.length === 1 ? "" : "s"}
                      </p>
                    </header>
                    {lane.entries.length === 0 ? (
                      <p className="p-3 text-xs text-muted-foreground">
                        No prompts in this bounded window.
                      </p>
                    ) : (
                      <ol
                        aria-label={`Prompts authored by ${lane.displayName}`}
                        className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2"
                      >
                        {lane.entries.map((entry) => (
                          <SharedOperatorPromptRow
                            authorName={lane.displayName}
                            entry={entry}
                            isCurrentOperator={entry.authorUserId === currentUserId}
                            key={entry.messageId}
                          />
                        ))}
                      </ol>
                    )}
                  </section>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
