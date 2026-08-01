import {
  COLLABORATION_AUTHORED_MESSAGE_MAX_CHARS,
  COLLABORATION_AUTHORED_MESSAGE_MAX_UTF8_BYTES,
  COLLABORATION_PROJECT_MEMBER_LIMIT,
  CollaborationAuthoredMessageCommandId,
  CollaborationAuthoredMessageId,
  type CollaborationAppendAuthoredMessageRequest,
  type CollaborationAuthoredMessage,
  type CollaborationContextPacket,
  type CollaborationProjectMember,
  type SharedProjectId,
  type UserId,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import {
  AlertTriangleIcon,
  CheckIcon,
  MessageCircleIcon,
  RefreshCwIcon,
  SendIcon,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LegendList } from "@legendapp/list/react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button.tsx";
import { Textarea } from "../ui/textarea.tsx";
import {
  appendConfirmedSharedOperatorMessage,
  collaborationParticipantsAreValid,
  EMPTY_SHARED_OPERATOR_TIMELINE,
  mergeSharedOperatorMessagePage,
  safeCollaborationFailureCode,
  SHARED_OPERATOR_CHAT_PAGE_LIMIT,
  SHARED_OPERATOR_CHAT_PENDING_SEND_LIMIT,
  SHARED_OPERATOR_CHAT_VISIBLE_PARTICIPANT_LIMIT,
  SHARED_OPERATOR_CHAT_VISIBLE_POINTER_LIMIT,
  type SharedOperatorChatClient,
  type SharedOperatorChatConnectionState,
  type SharedOperatorTimelineState,
  visibleSharedOperatorContextPackets,
} from "./SharedOperatorChatPanel.model.ts";

type SendState = "pending" | "accepted" | "conflict" | "retry" | "retrying";

interface PendingSend {
  readonly request: CollaborationAppendAuthoredMessageRequest;
  readonly state: SendState;
  readonly safeCode: string | null;
}

export interface SharedOperatorChatIdFactory {
  readonly commandId: () => CollaborationAuthoredMessageCommandId;
  readonly messageId: () => CollaborationAuthoredMessageId;
}

const defaultIdFactory: SharedOperatorChatIdFactory = {
  commandId: () =>
    CollaborationAuthoredMessageCommandId.make(`chat-command-${crypto.randomUUID()}`),
  messageId: () => CollaborationAuthoredMessageId.make(`chat-message-${crypto.randomUUID()}`),
};

const MESSAGE_KINDS = ["operator-chat", "authored-prompt"] as const;
const EMPTY_CONTEXT_PACKETS: readonly CollaborationContextPacket[] = Object.freeze([]);

function formatOccurredAt(value: DateTime.DateTime): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(DateTime.toEpochMillis(value));
}

function SharedOperatorMessageRow(props: {
  readonly message: CollaborationAuthoredMessage;
  readonly authorName: string;
  readonly isCurrentOperator: boolean;
}) {
  const removed = props.message.tombstone !== null;
  return (
    <article
      aria-label={`${props.message.kind === "authored-prompt" ? "Shared prompt" : "Operator chat"} from ${props.authorName}`}
      className={cn(
        "mx-3 my-1.5 rounded-lg border p-2.5",
        props.isCurrentOperator
          ? "border-cyan-500/30 bg-cyan-500/5"
          : "border-border/60 bg-card/60",
      )}
      data-message-id={props.message.messageId}
    >
      <header className="flex min-w-0 items-baseline gap-2 text-xs">
        <strong className="truncate">{props.authorName}</strong>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
          {props.message.kind === "authored-prompt" ? "Shared prompt" : "Operator chat"}
        </span>
        <time
          className="ml-auto shrink-0 text-muted-foreground"
          dateTime={DateTime.formatIso(props.message.occurredAt)}
        >
          {formatOccurredAt(props.message.occurredAt)}
        </time>
      </header>
      <p
        className={cn(
          "mt-2 whitespace-pre-wrap break-words text-sm",
          removed && "italic text-muted-foreground",
        )}
      >
        {removed ? "This shared authored message was removed." : props.message.body}
      </p>
      <span className="sr-only">Project order {props.message.projectSequence}</span>
    </article>
  );
}

function ContextPacketSummary(props: { readonly packet: CollaborationContextPacket }) {
  return (
    <details className="rounded-md border border-border/60 px-2 py-1.5 text-xs">
      <summary className="cursor-pointer select-none">
        Context packet {props.packet.packetId} · {props.packet.sources.length} pointers · through #
        {props.packet.throughSequence}
      </summary>
      <p className="mt-1 text-muted-foreground">
        {props.packet.estimatedTokens} estimated tokens · {props.packet.excludedSources.length}{" "}
        excluded
      </p>
      <ul
        aria-label={`Pointers in context packet ${props.packet.packetId}`}
        className="mt-1 space-y-1"
      >
        {props.packet.sources.slice(0, SHARED_OPERATOR_CHAT_VISIBLE_POINTER_LIMIT).map((source) => (
          <li className="font-mono text-[10px] text-muted-foreground" key={source.messageId}>
            #{source.projectSequence} · {source.kind} · {source.authorUserId} · {source.messageId} ·{" "}
            {source.bodySha256.slice(0, 12)}…
          </li>
        ))}
      </ul>
      {props.packet.sources.length > SHARED_OPERATOR_CHAT_VISIBLE_POINTER_LIMIT ? (
        <p className="mt-1 text-muted-foreground">
          +{props.packet.sources.length - SHARED_OPERATOR_CHAT_VISIBLE_POINTER_LIMIT} more pointers
        </p>
      ) : null}
    </details>
  );
}

export interface SharedOperatorChatPanelProps {
  readonly projectId: SharedProjectId;
  readonly currentUserId: UserId;
  readonly participants: readonly CollaborationProjectMember[];
  readonly client?: SharedOperatorChatClient | null;
  readonly connectionState?: SharedOperatorChatConnectionState;
  readonly contextPackets?: readonly CollaborationContextPacket[];
  readonly className?: string;
  readonly idFactory?: SharedOperatorChatIdFactory;
  readonly now?: () => number;
}

export function SharedOperatorChatPanel({
  projectId,
  currentUserId,
  participants,
  client = null,
  connectionState = "online",
  contextPackets = EMPTY_CONTEXT_PACKETS,
  className,
  idFactory = defaultIdFactory,
  now = Date.now,
}: SharedOperatorChatPanelProps) {
  const participantsValid = collaborationParticipantsAreValid(participants);
  const authorNames = useMemo(
    () => new Map(participants.map((participant) => [participant.userId, participant.displayName])),
    [participants],
  );
  const packetSummaries = useMemo(
    () => visibleSharedOperatorContextPackets(contextPackets, projectId),
    [contextPackets, projectId],
  );
  const [timeline, setTimeline] = useState<SharedOperatorTimelineState>(
    EMPTY_SHARED_OPERATOR_TIMELINE,
  );
  const timelineRef = useRef(timeline);
  const [pageState, setPageState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [draft, setDraft] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const [sendState, setSendState] = useState<"idle" | SendState>("idle");
  const [pendingSends, setPendingSends] = useState<readonly PendingSend[]>([]);
  const pendingSendsRef = useRef(pendingSends);
  const generationRef = useRef(0);
  const generationAbortRef = useRef<AbortController | null>(null);
  const pageAbortRef = useRef<AbortController | null>(null);
  const pageInFlightRef = useRef(false);
  const sendAbortsRef = useRef(new Map<string, AbortController>());

  const updateTimeline = useCallback((next: SharedOperatorTimelineState) => {
    timelineRef.current = next;
    setTimeline(next);
  }, []);
  const updatePendingSends = useCallback(
    (update: (current: readonly PendingSend[]) => readonly PendingSend[]) => {
      setPendingSends((current) => {
        const next = update(current);
        pendingSendsRef.current = next;
        return next;
      });
    },
    [],
  );

  const requestPage = useCallback(
    (expectedGeneration: number) => {
      if (
        client === null ||
        connectionState !== "online" ||
        !participantsValid ||
        pageInFlightRef.current ||
        generationRef.current !== expectedGeneration
      ) {
        return;
      }
      const requestedAfterSequence = timelineRef.current.nextCursor;
      const abort = new AbortController();
      const generationSignal = generationAbortRef.current?.signal;
      if (generationSignal === undefined || generationSignal.aborted) return;
      generationSignal.addEventListener("abort", () => abort.abort(), { once: true });
      pageAbortRef.current = abort;
      pageInFlightRef.current = true;
      setPageState("loading");
      void client
        .readAuthoredMessages({
          sharedProjectId: projectId,
          afterSequence: requestedAfterSequence,
          limit: SHARED_OPERATOR_CHAT_PAGE_LIMIT,
          kinds: [...MESSAGE_KINDS],
          signal: abort.signal,
        })
        .then((page) => {
          if (abort.signal.aborted || generationRef.current !== expectedGeneration) return;
          const current = timelineRef.current;
          const next = mergeSharedOperatorMessagePage({
            state: current,
            page,
            projectId,
            requestedAfterSequence,
          });
          if (next === current) {
            setPageState("error");
            return;
          }
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
    [client, connectionState, participantsValid, projectId, updateTimeline],
  );

  const performSend = useCallback(
    (pending: PendingSend, retrying: boolean) => {
      const messageKey = String(pending.request.messageId);
      if (client === null || sendAbortsRef.current.has(messageKey)) return;
      if (connectionState !== "online") {
        updatePendingSends((current) =>
          current.map((entry) =>
            entry.request.messageId === pending.request.messageId
              ? { ...entry, state: "retry", safeCode: "Offline" }
              : entry,
          ),
        );
        setSendNotice("Waiting for connection. Retry will reuse the same request.");
        setSendState("retry");
        return;
      }

      const generation = generationRef.current;
      const abort = new AbortController();
      sendAbortsRef.current.set(messageKey, abort);
      updatePendingSends((current) =>
        current.map((entry) =>
          entry.request.messageId === pending.request.messageId
            ? { ...entry, state: retrying ? "retrying" : "pending", safeCode: null }
            : entry,
        ),
      );
      setSendNotice(retrying ? "Retrying the same idempotent request…" : "Sending…");
      setSendState(retrying ? "retrying" : "pending");

      void client
        .appendAuthoredMessage({ ...pending.request, signal: abort.signal })
        .then((result) => {
          if (abort.signal.aborted || generationRef.current !== generation) return;
          if (result.disposition === "conflict") {
            updatePendingSends((current) =>
              current.map((entry) =>
                entry.request.messageId === pending.request.messageId
                  ? {
                      ...entry,
                      state: "conflict",
                      safeCode: safeCollaborationFailureCode(result.safeCode),
                    }
                  : entry,
              ),
            );
            setSendNotice("The project rejected this request as a conflict.");
            setSendState("conflict");
            return;
          }
          const next = appendConfirmedSharedOperatorMessage({
            state: timelineRef.current,
            message: result.message,
            expectedMessageId: pending.request.messageId,
            projectId,
          });
          if (next === null) {
            updatePendingSends((current) =>
              current.map((entry) =>
                entry.request.messageId === pending.request.messageId
                  ? { ...entry, state: "conflict", safeCode: "AcknowledgementMismatch" }
                  : entry,
              ),
            );
            setSendNotice("The acknowledgement did not match this project request.");
            setSendState("conflict");
            return;
          }
          updateTimeline(next);
          updatePendingSends((current) =>
            current.filter((entry) => entry.request.messageId !== pending.request.messageId),
          );
          setSendNotice(
            result.disposition === "already-accepted" ? "Already accepted." : "Accepted.",
          );
          setSendState("accepted");
        })
        .catch((error: unknown) => {
          if (abort.signal.aborted || generationRef.current !== generation) return;
          updatePendingSends((current) =>
            current.map((entry) =>
              entry.request.messageId === pending.request.messageId
                ? { ...entry, state: "retry", safeCode: safeCollaborationFailureCode(error) }
                : entry,
            ),
          );
          setSendNotice("Delivery is unconfirmed. Retry will reuse the same request.");
          setSendState("retry");
        })
        .finally(() => {
          if (sendAbortsRef.current.get(messageKey) === abort) {
            sendAbortsRef.current.delete(messageKey);
          }
        });
    },
    [client, connectionState, projectId, updatePendingSends, updateTimeline],
  );

  useEffect(() => {
    const sendAborts = sendAbortsRef.current;
    generationAbortRef.current?.abort();
    const generationAbort = new AbortController();
    generationAbortRef.current = generationAbort;
    generationRef.current += 1;
    pageAbortRef.current?.abort();
    pageAbortRef.current = null;
    pageInFlightRef.current = false;
    for (const abort of sendAborts.values()) abort.abort();
    sendAborts.clear();
    updateTimeline(EMPTY_SHARED_OPERATOR_TIMELINE);
    updatePendingSends(() => []);
    setDraft("");
    setComposerError(null);
    setSendNotice(null);
    setSendState("idle");
    setPageState("idle");
    return () => {
      generationAbort.abort();
      for (const abort of sendAborts.values()) abort.abort();
      sendAborts.clear();
    };
  }, [client, participantsValid, projectId, updatePendingSends, updateTimeline]);

  useEffect(() => {
    if (connectionState !== "online") {
      for (const abort of sendAbortsRef.current.values()) abort.abort();
      sendAbortsRef.current.clear();
      updatePendingSends((current) =>
        current.map((pending) =>
          pending.state === "pending" || pending.state === "retrying"
            ? { ...pending, state: "retry", safeCode: "Offline" }
            : pending,
        ),
      );
      if (pendingSendsRef.current.length > 0) {
        setSendNotice("Waiting for connection. Retry will reuse the same request.");
        setSendState("retry");
      }
      return;
    }
    if (client === null || !participantsValid) return;
    const generation = generationRef.current;
    queueMicrotask(() => {
      if (generationRef.current !== generation) return;
      if (timelineRef.current.messages.length === 0 && !pageInFlightRef.current) {
        requestPage(generation);
      }
      for (const pending of pendingSendsRef.current) {
        if (pending.state === "retry") performSend(pending, true);
      }
    });
  }, [client, connectionState, participantsValid, performSend, requestPage, updatePendingSends]);

  if (client === null) return null;

  if (!participantsValid) {
    return (
      <section
        aria-label="Shared operator chat unavailable"
        className={cn("rounded-lg border border-destructive/50 p-3", className)}
      >
        Shared operator chat is unavailable because the project roster exceeds{" "}
        {COLLABORATION_PROJECT_MEMBER_LIMIT} unique participants.
      </section>
    );
  }

  const submitDraft = (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    const encodedBytes = new TextEncoder().encode(body).byteLength;
    if (body.length === 0) {
      setComposerError("Enter a message for the project operators.");
      return;
    }
    if (
      body.length > COLLABORATION_AUTHORED_MESSAGE_MAX_CHARS ||
      encodedBytes > COLLABORATION_AUTHORED_MESSAGE_MAX_UTF8_BYTES ||
      /[\uD800-\uDFFF]/u.test(body)
    ) {
      setComposerError("This message exceeds the safe shared-message limit.");
      return;
    }
    if (pendingSendsRef.current.length >= SHARED_OPERATOR_CHAT_PENDING_SEND_LIMIT) {
      setComposerError("Resolve pending shared messages before sending another.");
      return;
    }
    const pending: PendingSend = {
      request: {
        commandId: idFactory.commandId(),
        sharedProjectId: projectId,
        messageId: idFactory.messageId(),
        kind: "operator-chat",
        body,
        contextInclusion: "eligible",
        occurredAt: DateTime.makeUnsafe(new Date(now()).toISOString()),
      },
      state: connectionState === "online" ? "pending" : "retry",
      safeCode: connectionState === "online" ? null : "Offline",
    };
    updatePendingSends((current) => [...current, pending]);
    setDraft("");
    setComposerError(null);
    queueMicrotask(() => performSend(pending, false));
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submitDraft();
    }
  };

  return (
    <section
      aria-label="Shared operator chat and prompt transcript"
      className={cn(
        "flex h-[36rem] min-h-0 w-full max-w-3xl flex-col rounded-xl border border-border/70 bg-background",
        className,
      )}
      data-shared-project-id={projectId}
    >
      <header className="border-b border-border/60 p-3">
        <div className="flex items-center gap-2">
          <MessageCircleIcon className="size-4" />
          <h2 className="font-semibold">Shared operator lane</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {participants.length}/{COLLABORATION_PROJECT_MEMBER_LIMIT} participants
          </span>
        </div>
        <p
          className="mt-1 truncate text-xs text-muted-foreground"
          title={participants.map((participant) => participant.displayName).join(", ")}
        >
          {participants
            .slice(0, SHARED_OPERATOR_CHAT_VISIBLE_PARTICIPANT_LIMIT)
            .map((participant) => participant.displayName)
            .join(", ")}
          {participants.length > SHARED_OPERATOR_CHAT_VISIBLE_PARTICIPANT_LIMIT
            ? `, +${participants.length - SHARED_OPERATOR_CHAT_VISIBLE_PARTICIPANT_LIMIT} more`
            : ""}
        </p>
        <p aria-live="polite" className="mt-1 text-xs text-muted-foreground">
          {connectionState === "online"
            ? "Connected"
            : connectionState === "offline"
              ? "Offline · sends wait safely"
              : "Reconnecting · sends wait safely"}
        </p>
      </header>

      {packetSummaries.length > 0 ? (
        <div
          aria-label="Pointer-only context packet summaries"
          className="space-y-1 border-b border-border/60 p-2"
        >
          {packetSummaries.map((packet) => (
            <ContextPacketSummary key={packet.packetId} packet={packet} />
          ))}
        </div>
      ) : null}

      <div
        className="flex min-h-0 flex-1 flex-col"
        role="log"
        aria-label="Project-visible operator-authored messages and prompts"
      >
        <div className="flex items-center justify-center border-b border-border/40 p-1.5">
          <Button
            aria-label="Load more shared operator messages"
            disabled={pageState === "loading" || !timeline.hasMore || connectionState !== "online"}
            onClick={() => requestPage(generationRef.current)}
            size="xs"
            variant="ghost"
          >
            <RefreshCwIcon className={cn(pageState === "loading" && "animate-spin")} />
            {timeline.saturated && timeline.hasMore
              ? "Load newer bounded history window"
              : timeline.saturated
                ? "Newest bounded history window loaded"
                : timeline.hasMore
                  ? "Load more project messages"
                  : "Project history is current"}
          </Button>
        </div>
        {timeline.messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
            {pageState === "error"
              ? "Shared history is temporarily unavailable."
              : "No project-visible operator messages loaded."}
          </div>
        ) : (
          <LegendList<CollaborationAuthoredMessage>
            className="min-h-0 flex-1 overflow-x-hidden"
            data={timeline.messages}
            estimatedItemSize={96}
            keyExtractor={(message) => String(message.messageId)}
            renderItem={({ item }) => (
              <SharedOperatorMessageRow
                authorName={authorNames.get(item.authorUserId) ?? "Former project operator"}
                isCurrentOperator={item.authorUserId === currentUserId}
                message={item}
              />
            )}
          />
        )}
      </div>

      <form className="border-t border-border/60 p-3" onSubmit={submitDraft}>
        <label className="text-xs font-medium" htmlFor={`shared-operator-composer-${projectId}`}>
          Message project operators
        </label>
        <div className="mt-1 flex items-end gap-2">
          <Textarea
            aria-describedby={`shared-operator-status-${projectId}`}
            id={`shared-operator-composer-${projectId}`}
            maxLength={COLLABORATION_AUTHORED_MESSAGE_MAX_CHARS}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={onComposerKeyDown}
            placeholder="Visible to everyone in this shared project"
            value={draft}
          />
          <Button
            aria-label="Send shared operator message"
            disabled={draft.trim().length === 0}
            type="submit"
          >
            <SendIcon /> Send
          </Button>
        </div>
        <div
          aria-live="polite"
          className="mt-1 min-h-4 text-xs"
          data-send-state={sendState}
          id={`shared-operator-status-${projectId}`}
        >
          {composerError ?? sendNotice ?? "Only operator-authored project chat is sent here."}
        </div>
        {pendingSends.length > 0 ? (
          <ul aria-label="Pending shared operator messages" className="mt-2 space-y-1">
            {pendingSends.map((pending) => (
              <li
                className="flex items-center gap-2 rounded border border-border/60 p-1.5 text-xs"
                key={pending.request.messageId}
              >
                {pending.state === "pending" || pending.state === "retrying" ? (
                  <RefreshCwIcon className="size-3 animate-spin" />
                ) : pending.state === "accepted" ? (
                  <CheckIcon className="size-3" />
                ) : (
                  <AlertTriangleIcon className="size-3" />
                )}
                <span className="min-w-0 flex-1 truncate">{pending.request.body}</span>
                <span className="text-muted-foreground">{pending.state}</span>
                {pending.state === "retry" || pending.state === "conflict" ? (
                  <Button
                    onClick={() => performSend(pending, true)}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    Retry same request
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </form>
    </section>
  );
}
