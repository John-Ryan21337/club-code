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
          "mt-2 whitespace-pre-wrap break-words text-sm",
          props.entry.body === null && "italic text-muted-foreground",
        )}
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
        `${author.userId.length}:${author.userId}:${author.displayName.length}:${author.displayName}`,
    )
    .join("|");
  const authorNames = new Map((authors ?? []).map((author) => [author.userId, author.displayName]));
  const projectValid = isSharedOperatorPromptIdentifier(projectId);
  const currentUserValid = isSharedOperatorPromptIdentifier(currentUserId);
  const rosterValid = authors !== null;
  const currentUserInRoster = authors?.some((author) => author.userId === currentUserId) ?? false;
  const [timeline, setTimeline] = useState<SharedOperatorPromptTimelineState>(
    EMPTY_SHARED_OPERATOR_PROMPT_TIMELINE,
  );
  const timelineRef = useRef(timeline);
  const [pageState, setPageState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const generationRef = useRef(0);
  const generationAbortRef = useRef<AbortController | null>(null);
  const pageAbortRef = useRef<AbortController | null>(null);
  const pageInFlightRef = useRef(false);

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
      void client
        .readAuthoredMessages({
          sharedProjectId: projectId,
          afterSequence: requestedAfterSequence,
          limit: SHARED_OPERATOR_PROMPT_PAGE_LIMIT,
          kinds: ["authored-prompt"],
          signal: abort.signal,
        })
        .then((payload) => {
          if (abort.signal.aborted || generationRef.current !== expectedGeneration) return;
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
      currentUserValid,
      projectId,
      projectValid,
      rosterValid,
      updateTimeline,
    ],
  );

  useEffect(() => {
    generationAbortRef.current?.abort();
    const generationAbort = new AbortController();
    generationAbortRef.current = generationAbort;
    generationRef.current += 1;
    pageAbortRef.current?.abort();
    pageAbortRef.current = null;
    pageInFlightRef.current = false;
    updateTimeline(EMPTY_SHARED_OPERATOR_PROMPT_TIMELINE);
    setPageState("idle");
    return () => generationAbort.abort();
  }, [client, currentUserId, participantFingerprint, projectId, updateTimeline]);

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
      !currentUserInRoster
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
    currentUserValid,
    projectValid,
    requestPage,
    rosterValid,
  ]);

  if (client === null) return null;
  if (!projectValid || !currentUserValid || authors === null || !currentUserInRoster) {
    return (
      <section
        aria-label="Shared operator prompt timeline unavailable"
        className={cn("rounded-lg border border-destructive/50 p-3 text-sm", className)}
      >
        Shared operator prompts are unavailable because the project identity or roster is invalid.
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
            ? pageState === "error"
              ? "Prompt history is temporarily unavailable."
              : "Connected"
            : connectionState === "offline"
              ? "Offline"
              : "Reconnecting"}
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-center border-b border-border/40 p-1.5">
          <Button
            aria-label="Load more shared operator prompts"
            disabled={pageState === "loading" || !timeline.hasMore || connectionState !== "online"}
            onClick={() => requestPage(generationRef.current)}
            size="xs"
            variant="ghost"
          >
            <RefreshCwIcon className={cn(pageState === "loading" && "animate-spin")} />
            {timeline.truncated
              ? "Bounded prompt window reached"
              : timeline.hasMore
                ? "Load more shared prompts"
                : "Shared prompt history is current"}
          </Button>
        </div>
        {timeline.entries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
            {pageState === "error"
              ? "No prompt history was admitted."
              : "No project-visible operator prompts loaded."}
          </div>
        ) : (
          <ol
            aria-label="Project-visible operator prompts"
            className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden p-3"
          >
            {timeline.entries.map((entry) => (
              <SharedOperatorPromptRow
                authorName={authorNames.get(entry.authorUserId) ?? "Former project operator"}
                entry={entry}
                isCurrentOperator={entry.authorUserId === currentUserId}
                key={entry.messageId}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
