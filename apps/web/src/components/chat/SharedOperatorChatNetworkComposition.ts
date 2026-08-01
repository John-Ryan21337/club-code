import {
  CollaborationNetworkClientError,
  type CollaborationNetworkClient,
} from "@cafecode/client-runtime";
import {
  COLLABORATION_AUTHORED_MESSAGE_PAGE_DEFAULT_LIMIT,
  COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT,
  COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES,
  CollaborationAppendAuthoredMessageRequest,
  CollaborationAuthoredMessage,
  CollaborationAuthoredMessagePage,
  CollaborationAuthoredMessagePageRequest,
  CollaborationTransportPage,
  SharedProjectId,
  type CollaborationTransportCursor,
} from "@cafecode/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import type {
  SharedOperatorChatClient,
  SharedOperatorChatConnectionState,
} from "./SharedOperatorChatPanel.model.ts";

export const SHARED_OPERATOR_CHAT_NETWORK_CURSOR_LIMIT = 64;

const CONTRACT_VALUE_MAX_NODES = 4_096;
const CONTRACT_OBJECT_MAX_PROPERTIES = 24;
const DATE_TIME_PROTOTYPE = Object.getPrototypeOf(DateTime.makeUnsafe("2000-01-01T00:00:00.000Z"));
const UNSAFE_CONTRACT_VALUE = Symbol("unsafe-contract-value");

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
const authoredPageDecoder = Schema.decodeUnknownSync(
  Schema.toType(CollaborationAuthoredMessagePage),
);
const projectIdDecoder = Schema.decodeUnknownSync(SharedProjectId);
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

function protocolError(): SharedOperatorChatNetworkCompositionError {
  return new SharedOperatorChatNetworkCompositionError("protocol-error");
}

function inspectOwnDataObject(input: unknown): Record<string, PropertyDescriptor> {
  try {
    if (input === null || typeof input !== "object") throw protocolError();
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw protocolError();
    const keys = Reflect.ownKeys(input);
    if (keys.some((key) => typeof key !== "string")) throw protocolError();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (
        descriptor === undefined ||
        !("value" in descriptor) ||
        !descriptor.enumerable ||
        descriptor.get !== undefined ||
        descriptor.set !== undefined
      ) {
        throw protocolError();
      }
    }
    return descriptors;
  } catch (cause) {
    if (cause instanceof SharedOperatorChatNetworkCompositionError) throw cause;
    throw protocolError();
  }
}

function inspectNetworkClient(
  input: unknown,
): Pick<CollaborationNetworkClient, "command" | "connect" | "disconnect" | "state"> {
  const descriptors = inspectOwnDataObject(input);
  const receiver = input as object;
  const callable = <Name extends "command" | "connect" | "disconnect" | "state">(
    name: Name,
  ): CollaborationNetworkClient[Name] => {
    const value = descriptors[name]?.value;
    if (typeof value !== "function") throw protocolError();
    return value as CollaborationNetworkClient[Name];
  };
  const state = callable("state");
  const connect = callable("connect");
  const disconnect = callable("disconnect");
  const command = callable("command");
  return {
    state: () =>
      Reflect.apply(state, receiver, []) as ReturnType<CollaborationNetworkClient["state"]>,
    connect: () => Reflect.apply(connect, receiver, []) as Promise<void>,
    disconnect: () => {
      Reflect.apply(disconnect, receiver, []);
    },
    command: ((operation, request, options) =>
      Reflect.apply(command, receiver, [
        operation,
        request,
        options,
      ])) as CollaborationNetworkClient["command"],
  };
}

function decodeRequestWithSignal<A>(
  supplied: unknown,
  decode: (input: unknown) => A,
): { readonly request: A; readonly signal: AbortSignal } {
  const descriptors = inspectOwnDataObject(supplied);
  const signal = descriptors.signal?.value;
  if (!(signal instanceof AbortSignal)) throw protocolError();
  const requestInput = Object.create(null) as Record<string, unknown>;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key !== "signal") requestInput[key] = descriptor.value;
  }
  return { request: safeDecode(decode, requestInput), signal };
}

/**
 * The production network client already returns schema-decoded values, but this composition is an
 * injection boundary too. Clone from data descriptors before schema decoding so validation never
 * reads the original properties after inspection, and one huge scalar cannot allocate an
 * unbounded JSON buffer. Proxies can trap reflection itself, so every reflective operation remains
 * inside the fixed protocol-error boundary.
 */
function cloneBoundedContractValue(root: unknown): unknown | typeof UNSAFE_CONTRACT_VALUE {
  const pending: Array<{ readonly assign: (value: unknown) => void; readonly value: unknown }> = [];
  const visitedObjects = new WeakSet<object>();
  let clonedRoot: unknown;
  pending.push({
    value: root,
    assign: (value) => {
      clonedRoot = value;
    },
  });
  let visited = 0;
  let approximateBytes = 0;
  const addString = (value: string) => {
    if (value.length > COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES) return false;
    approximateBytes += textEncoder.encode(value).byteLength;
    return approximateBytes <= COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES;
  };
  try {
    while (pending.length > 0) {
      if (++visited > CONTRACT_VALUE_MAX_NODES) return UNSAFE_CONTRACT_VALUE;
      const entry = pending.pop()!;
      const value = entry.value;
      if (typeof value === "string") {
        if (!addString(value)) return UNSAFE_CONTRACT_VALUE;
        entry.assign(value);
        continue;
      }
      if (
        value === null ||
        typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value))
      ) {
        approximateBytes += 16;
        if (approximateBytes > COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES)
          return UNSAFE_CONTRACT_VALUE;
        entry.assign(value);
        continue;
      }
      if (typeof value !== "object") return UNSAFE_CONTRACT_VALUE;
      if (visitedObjects.has(value)) return UNSAFE_CONTRACT_VALUE;
      visitedObjects.add(value);

      const prototype = Object.getPrototypeOf(value);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      if (prototype === DATE_TIME_PROTOTYPE) {
        const epoch = descriptors.epochMilliseconds;
        if (
          epoch === undefined ||
          !("value" in epoch) ||
          typeof epoch.value !== "number" ||
          !Number.isFinite(epoch.value) ||
          Reflect.ownKeys(descriptors).some(
            (key) => key !== "epochMilliseconds" && key !== "partsUtc",
          )
        ) {
          return UNSAFE_CONTRACT_VALUE;
        }
        approximateBytes += 32;
        entry.assign(DateTime.makeUnsafe(epoch.value));
        continue;
      }
      if (Array.isArray(value)) {
        const lengthDescriptor = descriptors.length;
        const length = lengthDescriptor?.value;
        if (!Number.isSafeInteger(length) || length < 0 || length > 256)
          return UNSAFE_CONTRACT_VALUE;
        const keys = Reflect.ownKeys(descriptors);
        if (keys.length !== length + 1 || !keys.includes("length")) return UNSAFE_CONTRACT_VALUE;
        const clone = Array.from<unknown>({ length });
        entry.assign(clone);
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (
            descriptor === undefined ||
            !("value" in descriptor) ||
            !descriptor.enumerable ||
            descriptor.get !== undefined ||
            descriptor.set !== undefined
          ) {
            return UNSAFE_CONTRACT_VALUE;
          }
          pending.push({
            value: descriptor.value,
            assign: (child) => {
              clone[index] = child;
            },
          });
        }
        approximateBytes += length * 2 + 2;
        continue;
      }
      if (prototype !== Object.prototype && prototype !== null) return UNSAFE_CONTRACT_VALUE;
      const keys = Reflect.ownKeys(descriptors);
      if (
        keys.length > CONTRACT_OBJECT_MAX_PROPERTIES ||
        keys.some((key) => typeof key !== "string")
      ) {
        return UNSAFE_CONTRACT_VALUE;
      }
      const clone: Record<string, unknown> = {};
      entry.assign(clone);
      for (const key of keys as string[]) {
        const descriptor = descriptors[key];
        if (
          descriptor === undefined ||
          !("value" in descriptor) ||
          !descriptor.enumerable ||
          descriptor.get !== undefined ||
          descriptor.set !== undefined ||
          !addString(key)
        ) {
          return UNSAFE_CONTRACT_VALUE;
        }
        pending.push({
          value: descriptor.value,
          assign: (child) => {
            Object.defineProperty(clone, key, {
              value: child,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          },
        });
      }
      approximateBytes += keys.length * 4 + 2;
    }
    return clonedRoot;
  } catch {
    return UNSAFE_CONTRACT_VALUE;
  }
}

function connectionStateOf(
  readState: Pick<CollaborationNetworkClient, "state">["state"],
): SharedOperatorChatConnectionState {
  try {
    switch (readState()) {
      case "connected":
        return "online";
      case "connecting":
        return "reconnecting";
      case "disconnected":
        return "offline";
      default:
        return "offline";
    }
  } catch {
    return "offline";
  }
}

function responsePageIsCorrelated(input: {
  readonly page: typeof CollaborationTransportPage.Type;
  readonly projectId: SharedProjectId;
  readonly afterSequence: number;
  readonly requestedLimit: number;
  readonly requestedKinds: ReadonlySet<string>;
}): boolean {
  const { page, projectId, afterSequence, requestedLimit, requestedKinds } = input;
  if (
    page.sharedProjectId !== projectId ||
    page.messages.length > requestedLimit ||
    page.messages.length !== page.mergedOrder.length ||
    page.messages.length !== page.lanePositions.length ||
    (page.hasMore && page.messages.length === 0)
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
        message.sharedProjectId !== projectId ||
        message.projectSequence <= afterSequence ||
        !requestedKinds.has(message.kind),
    ) ||
    page.messages.some(
      (message, index) =>
        index > 0 && page.messages[index - 1]!.projectSequence >= message.projectSequence,
    ) ||
    new Set(page.mergedOrder).size !== page.mergedOrder.length ||
    page.mergedOrder.some((messageId, index) => messageId !== page.messages[index]?.messageId)
  ) {
    return false;
  }

  const laneIds = new Set<string>();
  for (const [index, lane] of page.lanePositions.entries()) {
    const message = byId.get(lane.messageId);
    if (
      message === undefined ||
      page.messages[index]?.messageId !== lane.messageId ||
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
  const inputDescriptors = inspectOwnDataObject(input);
  const projectId = safeDecode(projectIdDecoder, inputDescriptors.projectId?.value);
  const networkClient = inspectNetworkClient(inputDescriptors.networkClient?.value);
  const listeners = new Set<() => void>();
  const cursors = new Map<number, CollaborationTransportCursor | null>([[0, null]]);
  let snapshot = connectionStateOf(networkClient.state);
  let authorityGeneration = 0;
  let readingState = false;
  let disconnecting = false;
  let connectInFlight: Promise<void> | null = null;

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
    if (readingState) return snapshot;
    const operationGeneration = authorityGeneration;
    readingState = true;
    const next = connectionStateOf(networkClient.state);
    readingState = false;
    if (operationGeneration !== authorityGeneration) return snapshot;
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
    const decoded = decodeRequestWithSignal(supplied, decodePageRequest);
    const { signal } = decoded;
    const request = Object.freeze({
      ...decoded.request,
      kinds: Object.freeze([...decoded.request.kinds]),
    });
    if (request.sharedProjectId !== projectId) {
      throw protocolError();
    }
    if (signal.aborted) throw new SharedOperatorChatNetworkCompositionError("cancelled");
    const cursor = cursors.get(request.afterSequence);
    if (cursor === undefined) {
      throw new SharedOperatorChatNetworkCompositionError("cursor-unavailable");
    }
    const requestedLimit = Math.min(
      request.limit ?? COLLABORATION_AUTHORED_MESSAGE_PAGE_DEFAULT_LIMIT,
      COLLABORATION_AUTHORED_MESSAGE_PAGE_MAX_LIMIT,
    );
    const requestedKinds = new Set(request.kinds);
    const operationGeneration = authorityGeneration;
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
      if (signal.aborted || operationGeneration !== authorityGeneration) {
        throw new SharedOperatorChatNetworkCompositionError("cancelled");
      }
      const responseClone = cloneBoundedContractValue(response);
      if (responseClone === UNSAFE_CONTRACT_VALUE) throw protocolError();
      const page = safeDecode(decodeTransportPage, responseClone);
      if (
        !responsePageIsCorrelated({
          page,
          projectId,
          afterSequence: request.afterSequence,
          requestedLimit,
          requestedKinds,
        })
      ) {
        throw protocolError();
      }
      const nextCursor = page.messages.reduce(
        (maximum, message) => Math.max(maximum, message.projectSequence),
        request.afterSequence,
      );
      const admittedPage = safeDecode(authoredPageDecoder, {
        sharedProjectId: projectId,
        messages: page.messages,
        mergedOrder: page.mergedOrder,
        lanePositions: page.lanePositions,
        nextCursor,
        hasMore: page.hasMore,
      });
      if (signal.aborted || operationGeneration !== authorityGeneration) {
        throw new SharedOperatorChatNetworkCompositionError("cancelled");
      }
      rememberCursor(admittedPage.nextCursor, page.nextCursor);
      refreshState();
      if (signal.aborted || operationGeneration !== authorityGeneration) {
        throw new SharedOperatorChatNetworkCompositionError("cancelled");
      }
      return admittedPage;
    } catch (cause) {
      if (operationGeneration === authorityGeneration) refreshState();
      if (signal.aborted || operationGeneration !== authorityGeneration) {
        throw new SharedOperatorChatNetworkCompositionError("cancelled");
      }
      if (cause instanceof SharedOperatorChatNetworkCompositionError) throw cause;
      return safeNetworkFailure(cause, signal);
    }
  };

  const appendAuthoredMessage: SharedOperatorChatClient["appendAuthoredMessage"] = async (
    supplied,
  ) => {
    const decoded = decodeRequestWithSignal(supplied, decodeAppendRequest);
    const { signal } = decoded;
    const request = Object.freeze({
      ...decoded.request,
      occurredAt: DateTime.makeUnsafe(DateTime.formatIso(decoded.request.occurredAt)),
    });
    if (request.sharedProjectId !== projectId) {
      throw protocolError();
    }
    if (signal.aborted) throw new SharedOperatorChatNetworkCompositionError("cancelled");
    const operationGeneration = authorityGeneration;
    try {
      const response = await networkClient.command("message.append", request, { signal });
      if (signal.aborted || operationGeneration !== authorityGeneration) {
        throw new SharedOperatorChatNetworkCompositionError("cancelled");
      }
      const responseClone = cloneBoundedContractValue(response);
      if (responseClone === UNSAFE_CONTRACT_VALUE) throw protocolError();
      const message = safeDecode(decodeMessage, responseClone);
      if (
        message.sharedProjectId !== projectId ||
        message.messageId !== request.messageId ||
        message.kind !== request.kind ||
        message.body !== request.body ||
        message.contextInclusion !== request.contextInclusion ||
        DateTime.toEpochMillis(message.occurredAt) !== DateTime.toEpochMillis(request.occurredAt)
      ) {
        throw protocolError();
      }
      refreshState();
      if (signal.aborted || operationGeneration !== authorityGeneration) {
        throw new SharedOperatorChatNetworkCompositionError("cancelled");
      }
      return { disposition: "accepted", message };
    } catch (cause) {
      if (operationGeneration === authorityGeneration) refreshState();
      if (signal.aborted || operationGeneration !== authorityGeneration) {
        throw new SharedOperatorChatNetworkCompositionError("cancelled");
      }
      if (cause instanceof SharedOperatorChatNetworkCompositionError) throw cause;
      if (cause instanceof CollaborationNetworkClientError && cause.code === "conflict") {
        return { disposition: "conflict", safeCode: "conflict" };
      }
      return safeNetworkFailure(cause, signal);
    }
  };

  const connect = () => {
    if (disconnecting) {
      return Promise.reject(new SharedOperatorChatNetworkCompositionError("cancelled"));
    }
    if (connectInFlight !== null) return connectInFlight;
    if (refreshState() === "online") {
      return Promise.resolve();
    }
    const operationGeneration = authorityGeneration;
    let operation: Promise<void>;
    operation = Promise.resolve()
      .then(() => {
        if (operationGeneration !== authorityGeneration) {
          throw new SharedOperatorChatNetworkCompositionError("cancelled");
        }
        return networkClient.connect();
      })
      .then(() => {
        if (operationGeneration !== authorityGeneration) {
          throw new SharedOperatorChatNetworkCompositionError("cancelled");
        }
      })
      .catch((cause: unknown) => {
        if (cause instanceof SharedOperatorChatNetworkCompositionError) throw cause;
        if (operationGeneration !== authorityGeneration) {
          throw new SharedOperatorChatNetworkCompositionError("cancelled");
        }
        if (cause instanceof CollaborationNetworkClientError) throw cause;
        throw new SharedOperatorChatNetworkCompositionError("unavailable");
      })
      .finally(() => {
        if (connectInFlight === operation) connectInFlight = null;
        if (operationGeneration === authorityGeneration) refreshState();
      });
    connectInFlight = operation;
    publish("reconnecting");
    return operation;
  };

  const disconnect = () => {
    if (disconnecting) return;
    disconnecting = true;
    authorityGeneration += 1;
    connectInFlight = null;
    cursors.clear();
    cursors.set(0, null);
    try {
      networkClient.disconnect();
    } catch {
      // A hostile adapter cannot expose its exception or prevent local authority invalidation.
    } finally {
      refreshState();
      disconnecting = false;
    }
  };

  return {
    projectId,
    client: { readAuthoredMessages, appendAuthoredMessage },
    connect,
    disconnect,
    refreshState,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (typeof listener !== "function") return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
