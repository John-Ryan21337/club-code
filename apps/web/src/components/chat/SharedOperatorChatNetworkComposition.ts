import {
  CollaborationNetworkClientError,
  type CollaborationNetworkClient,
} from "@cafecode/client-runtime";
import {
  COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT,
  COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES,
  CollaborationAppendAuthoredMessageRequest,
  CollaborationAuthoredMessage,
  CollaborationAuthoredMessagePageRequest,
  CollaborationTransportPage,
  type CollaborationAuthoredMessagePage,
  type CollaborationTransportCursor,
  type SharedProjectId,
} from "@cafecode/contracts";
import * as Schema from "effect/Schema";

import type {
  SharedOperatorChatClient,
  SharedOperatorChatConnectionState,
} from "./SharedOperatorChatPanel.model.ts";

export const SHARED_OPERATOR_CHAT_NETWORK_CURSOR_LIMIT = 64;

export class SharedOperatorChatNetworkCompositionError extends Error {
  readonly code: "cancelled" | "cursor-unavailable" | "protocol-error" | "unavailable";

  constructor(code: SharedOperatorChatNetworkCompositionError["code"]) {
    super(`Shared operator chat request failed (${code}).`);
    this.name = "SharedOperatorChatNetworkCompositionError";
    this.code = code;
  }
}

export interface SharedOperatorChatNetworkComposition {
  readonly projectId: SharedProjectId;
  readonly client: SharedOperatorChatClient;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => void;
  /** Reconciles the observable snapshot with the injected client's current state. Performs no I/O. */
  readonly refreshState: () => SharedOperatorChatConnectionState;
  readonly getSnapshot: () => SharedOperatorChatConnectionState;
  readonly subscribe: (listener: () => void) => () => void;
}

// The renderer and network client exchange already-decoded contract values (not their wire
// encodings), so validate the Type side. This is significant for DateTime fields.
const pageRequestDecoder = Schema.decodeUnknownSync(
  Schema.toType(CollaborationAuthoredMessagePageRequest),
);
const appendRequestDecoder = Schema.decodeUnknownSync(
  Schema.toType(CollaborationAppendAuthoredMessageRequest),
);
const transportPageDecoder = Schema.decodeUnknownSync(Schema.toType(CollaborationTransportPage));
const messageDecoder = Schema.decodeUnknownSync(Schema.toType(CollaborationAuthoredMessage));
const decodePageRequest = (input: unknown) =>
  pageRequestDecoder(input, { onExcessProperty: "error" });
const decodeAppendRequest = (input: unknown) =>
  appendRequestDecoder(input, { onExcessProperty: "error" });
const decodeTransportPage = (input: unknown) =>
  transportPageDecoder(input, { onExcessProperty: "error" });
const decodeMessage = (input: unknown) => messageDecoder(input, { onExcessProperty: "error" });
const textEncoder = new TextEncoder();

function safeDecode<A>(decode: (input: unknown) => A, input: unknown): A {
  try {
    return decode(input);
  } catch {
    throw new SharedOperatorChatNetworkCompositionError("protocol-error");
  }
}

function encodedSizeIsBounded(value: unknown): boolean {
  try {
    return (
      textEncoder.encode(JSON.stringify(value)).byteLength <=
      COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES
    );
  } catch {
    return false;
  }
}

function connectionStateOf(
  networkClient: Pick<CollaborationNetworkClient, "state">,
): SharedOperatorChatConnectionState {
  switch (networkClient.state()) {
    case "connected":
      return "online";
    case "connecting":
      return "reconnecting";
    case "disconnected":
      return "offline";
    default:
      return "offline";
  }
}

function responsePageIsCorrelated(input: {
  readonly page: typeof CollaborationTransportPage.Type;
  readonly projectId: SharedProjectId;
  readonly afterSequence: number;
  readonly requestedLimit: number;
}): boolean {
  const { page, projectId, afterSequence, requestedLimit } = input;
  if (
    page.sharedProjectId !== projectId ||
    page.messages.length > requestedLimit ||
    page.messages.length !== page.mergedOrder.length ||
    page.messages.length !== page.lanePositions.length ||
    (page.hasMore && page.messages.length === 0) ||
    !encodedSizeIsBounded(page)
  ) {
    return false;
  }

  const byId = new Map(page.messages.map((message) => [message.messageId, message]));
  const sequences = new Set(page.messages.map((message) => message.projectSequence));
  if (
    byId.size !== page.messages.length ||
    sequences.size !== page.messages.length ||
    page.messages.some(
      (message) =>
        message.sharedProjectId !== projectId || message.projectSequence <= afterSequence,
    ) ||
    new Set(page.mergedOrder).size !== page.mergedOrder.length ||
    page.mergedOrder.some((messageId) => !byId.has(messageId))
  ) {
    return false;
  }

  const laneIds = new Set<string>();
  for (const lane of page.lanePositions) {
    const message = byId.get(lane.messageId);
    if (
      message === undefined ||
      laneIds.has(lane.messageId) ||
      lane.userId !== message.authorUserId ||
      lane.projectSequence !== message.projectSequence ||
      lane.operatorSequence !== message.operatorSequence
    ) {
      return false;
    }
    laneIds.add(lane.messageId);
  }
  return laneIds.size === byId.size;
}

function safeNetworkFailure(cause: unknown, signal: AbortSignal): never {
  if (signal.aborted) throw new SharedOperatorChatNetworkCompositionError("cancelled");
  if (cause instanceof CollaborationNetworkClientError) throw cause;
  throw new SharedOperatorChatNetworkCompositionError("unavailable");
}

export function createSharedOperatorChatNetworkComposition(input: {
  readonly projectId: SharedProjectId;
  readonly networkClient: CollaborationNetworkClient;
}): SharedOperatorChatNetworkComposition {
  const { projectId, networkClient } = input;
  const listeners = new Set<() => void>();
  const cursors = new Map<number, CollaborationTransportCursor | null>([[0, null]]);
  let snapshot = connectionStateOf(networkClient);

  const publish = (next: SharedOperatorChatConnectionState) => {
    if (snapshot === next) return;
    snapshot = next;
    const listenersSnapshot = Array.from(listeners);
    for (const listener of listenersSnapshot) {
      try {
        listener();
      } catch {
        // One renderer subscriber cannot prevent other state observers from updating.
      }
    }
  };

  const refreshState = () => {
    const next = connectionStateOf(networkClient);
    publish(next);
    return next;
  };

  const rememberCursor = (sequence: number, cursor: CollaborationTransportCursor) => {
    cursors.delete(sequence);
    cursors.set(sequence, cursor);
    while (cursors.size > SHARED_OPERATOR_CHAT_NETWORK_CURSOR_LIMIT) {
      const oldest = cursors.keys().next().value;
      if (oldest === undefined) break;
      cursors.delete(oldest);
    }
  };

  const readAuthoredMessages: SharedOperatorChatClient["readAuthoredMessages"] = async (
    supplied,
  ) => {
    const { signal, ...requestInput } = supplied;
    const request = safeDecode(decodePageRequest, requestInput);
    if (request.sharedProjectId !== projectId) {
      throw new SharedOperatorChatNetworkCompositionError("protocol-error");
    }
    const cursor = cursors.get(request.afterSequence);
    if (cursor === undefined) {
      throw new SharedOperatorChatNetworkCompositionError("cursor-unavailable");
    }
    const requestedLimit = Math.min(
      request.limit ?? COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT,
      COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT,
    );
    try {
      const response = await networkClient.command(
        "message.page",
        {
          sharedProjectId: projectId,
          cursor,
          limit: requestedLimit,
          kinds: request.kinds,
        },
        { signal },
      );
      const page = safeDecode(decodeTransportPage, response);
      if (
        !responsePageIsCorrelated({
          page,
          projectId,
          afterSequence: request.afterSequence,
          requestedLimit,
        })
      ) {
        throw new SharedOperatorChatNetworkCompositionError("protocol-error");
      }
      const nextCursor = page.messages.reduce(
        (maximum, message) => Math.max(maximum, message.projectSequence),
        request.afterSequence,
      );
      rememberCursor(nextCursor, page.nextCursor);
      refreshState();
      return {
        sharedProjectId: projectId,
        messages: page.messages,
        mergedOrder: page.mergedOrder,
        lanePositions: page.lanePositions,
        nextCursor,
        hasMore: page.hasMore,
      } satisfies CollaborationAuthoredMessagePage;
    } catch (cause) {
      refreshState();
      if (cause instanceof SharedOperatorChatNetworkCompositionError) throw cause;
      return safeNetworkFailure(cause, signal);
    }
  };

  const appendAuthoredMessage: SharedOperatorChatClient["appendAuthoredMessage"] = async (
    supplied,
  ) => {
    const { signal, ...requestInput } = supplied;
    const request = safeDecode(decodeAppendRequest, requestInput);
    if (request.sharedProjectId !== projectId) {
      throw new SharedOperatorChatNetworkCompositionError("protocol-error");
    }
    try {
      const response = await networkClient.command("message.append", request, { signal });
      const message = safeDecode(decodeMessage, response);
      if (message.sharedProjectId !== projectId || message.messageId !== request.messageId) {
        throw new SharedOperatorChatNetworkCompositionError("protocol-error");
      }
      refreshState();
      return { disposition: "accepted", message };
    } catch (cause) {
      refreshState();
      if (cause instanceof SharedOperatorChatNetworkCompositionError) throw cause;
      if (cause instanceof CollaborationNetworkClientError && cause.code === "conflict") {
        return { disposition: "conflict", safeCode: "conflict" };
      }
      return safeNetworkFailure(cause, signal);
    }
  };

  const connect = async () => {
    if (refreshState() === "online") {
      return;
    }
    publish("reconnecting");
    try {
      await networkClient.connect();
    } catch (cause) {
      if (cause instanceof CollaborationNetworkClientError) throw cause;
      throw new SharedOperatorChatNetworkCompositionError("unavailable");
    } finally {
      refreshState();
    }
  };

  const disconnect = () => {
    networkClient.disconnect();
    cursors.clear();
    cursors.set(0, null);
    refreshState();
  };

  return {
    projectId,
    client: { readAuthoredMessages, appendAuthoredMessage },
    connect,
    disconnect,
    refreshState,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
