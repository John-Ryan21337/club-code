import {
  COLLABORATION_NETWORK_INBOUND_FRAME_MAX_UTF8_BYTES,
  COLLABORATION_NETWORK_MAX_OUTBOUND_QUEUE_MESSAGES,
  COLLABORATION_NETWORK_MAX_OUTBOUND_QUEUE_UTF8_BYTES,
  COLLABORATION_NETWORK_MAX_SUBSCRIPTIONS_PER_CONNECTION,
  COLLABORATION_NETWORK_OUTBOUND_FRAME_MAX_UTF8_BYTES,
  COLLABORATION_NETWORK_PROTOCOL_VERSION,
  COLLABORATION_TRANSPORT_PROJECT_MAX_CONCURRENCY,
  COLLABORATION_TRANSPORT_REQUEST_MAX_UTF8_BYTES,
  COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES,
  CollaborationNetworkDeviceProof,
  CollaborationNetworkRequestId,
  CollaborationNetworkServerFrame,
  CollaborationTransportAppendRequest,
  CollaborationTransportAppendResponse,
  CollaborationTransportCreateContextRequest,
  CollaborationTransportCreateContextResponse,
  CollaborationTransportPage,
  CollaborationTransportPageRequest,
  CollaborationTransportReplayRequest,
  CollaborationTransportReplayResult,
  CollaborationTransportTombstoneRequest,
  CollaborationTransportTombstoneResponse,
  type CollaborationNetworkClientFrame,
  type CollaborationNetworkDeviceProof as DeviceProof,
  type CollaborationNetworkPublicErrorCode,
  type CollaborationNetworkRequestFrame,
  type CollaborationNetworkRequestId as RequestId,
  type CollaborationAppendAuthoredMessageRequest as AppendRequest,
  type CollaborationAuthoredMessage as AppendResponse,
  type CollaborationContextPacket as CreateContextResponse,
  type CollaborationCreateContextPacketRequest as CreateContextRequest,
  type CollaborationTransportPage as TransportPage,
  type CollaborationTransportPageRequest as PageRequest,
  type CollaborationTransportReplayRequest as ReplayRequest,
  type CollaborationTransportReplayResult as ReplayResult,
  type CollaborationTombstoneAuthoredMessageRequest as TombstoneRequest,
  type CollaborationAuthoredMessage as TombstoneResponse,
} from "@cafecode/contracts";
import * as Schema from "effect/Schema";

export const COLLABORATION_NETWORK_COMMAND_PATH = "/api/collaboration/v1/command";
export const COLLABORATION_NETWORK_SOCKET_PATH = "/api/collaboration/v1/socket";

const MAX_AUTHORIZATION_CHARS = 4_096;
const textEncoder = new TextEncoder();
const decodeRequestId = Schema.decodeUnknownSync(CollaborationNetworkRequestId);
const decodeDeviceProof = Schema.decodeUnknownSync(CollaborationNetworkDeviceProof);

type ClientState = "disconnected" | "connecting" | "connected";
type CommandOperation = "message.append" | "message.tombstone" | "message.page" | "context.create";

interface CommandShape {
  readonly "message.append": { readonly request: AppendRequest; readonly response: AppendResponse };
  readonly "message.tombstone": {
    readonly request: TombstoneRequest;
    readonly response: TombstoneResponse;
  };
  readonly "message.page": { readonly request: PageRequest; readonly response: TransportPage };
  readonly "context.create": {
    readonly request: CreateContextRequest;
    readonly response: CreateContextResponse;
  };
}

export interface CollaborationNetworkHttpRequest {
  readonly url: string;
  readonly headers: Readonly<Record<"Authorization" | "Content-Type" | "Origin", string>>;
  readonly body: string;
  readonly signal: AbortSignal;
}

export interface CollaborationNetworkHttpResponse {
  readonly status: number;
  readonly body: string;
}

export type CollaborationNetworkHttpRequester = (
  request: CollaborationNetworkHttpRequest,
) => Promise<CollaborationNetworkHttpResponse>;

export interface CollaborationNetworkSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface CollaborationNetworkSocketOpenInput {
  readonly url: string;
  readonly headers: Readonly<Record<"Authorization" | "Origin", string>>;
  readonly onOpen: () => void;
  readonly onMessage: (data: unknown) => void;
  readonly onClose: () => void;
  readonly onError: () => void;
}

export type CollaborationNetworkSocketFactory = (
  input: CollaborationNetworkSocketOpenInput,
) => CollaborationNetworkSocket;

export interface CollaborationNetworkProofInput {
  readonly requestId: RequestId;
  readonly operation: CommandOperation | "message.subscribe-replay";
  readonly request: unknown;
}

export interface CollaborationNetworkClientConfig {
  /** Exact server origin. Paths, query strings, fragments, and URL credentials are rejected. */
  readonly serverOrigin: string;
  /** Exact client Origin value accepted by the collaboration listener. */
  readonly clientOrigin: string;
  /** Opaque bearer evidence. It is retained privately and is never placed in a URL or error. */
  readonly sessionEvidence: string;
  readonly createRequestId: () => unknown;
  /** A fresh proof must be supplied for every request frame. */
  readonly createDeviceProof: (
    input: CollaborationNetworkProofInput,
  ) => DeviceProof | Promise<DeviceProof>;
  readonly requestHttp: CollaborationNetworkHttpRequester;
  readonly openSocket: CollaborationNetworkSocketFactory;
}

export type CollaborationNetworkClientErrorCode =
  | CollaborationNetworkPublicErrorCode
  | "not-connected"
  | "protocol-error";

export class CollaborationNetworkClientError extends Error {
  readonly code: CollaborationNetworkClientErrorCode;

  constructor(code: CollaborationNetworkClientErrorCode) {
    super(`Collaboration client request failed (${code}).`);
    this.name = "CollaborationNetworkClientError";
    this.code = code;
  }
}

export interface CollaborationReplaySubscriptionOptions {
  readonly signal?: AbortSignal;
  readonly onPage: (page: TransportPage) => void;
}

export interface CollaborationNetworkClient {
  readonly state: () => ClientState;
  readonly connect: () => Promise<void>;
  readonly disconnect: () => void;
  readonly command: <Operation extends CommandOperation>(
    operation: Operation,
    request: CommandShape[Operation]["request"],
    options?: { readonly signal?: AbortSignal },
  ) => Promise<CommandShape[Operation]["response"]>;
  readonly subscribeReplay: (
    request: ReplayRequest,
    options: CollaborationReplaySubscriptionOptions,
  ) => Promise<ReplayResult>;
}

interface PendingSubscription {
  readonly requestId: RequestId;
  readonly onPage: (page: TransportPage) => void;
  readonly resolve: (result: ReplayResult) => void;
  readonly reject: (cause: CollaborationNetworkClientError) => void;
  readonly removeAbortListener: () => void;
  cancelSent: boolean;
}

function fail(code: CollaborationNetworkClientErrorCode): CollaborationNetworkClientError {
  return new CollaborationNetworkClientError(code);
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (normalized === "localhost" || normalized === "::1") return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalized);
  return match !== null && match.slice(1).every((part) => Number(part) <= 255);
}

function exactOrigin(value: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an exact HTTP(S) origin`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    parsed.origin !== value
  ) {
    throw new Error(`${label} must be an exact HTTP(S) origin`);
  }
  if (!isLoopbackHost(parsed.hostname) && parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS outside loopback`);
  }
  return parsed;
}

function strictDecode<S extends Schema.Decoder<unknown>>(
  schema: S,
  input: unknown,
  code: "invalid-request" | "protocol-error" = "protocol-error",
): S["Type"] {
  try {
    return Schema.decodeUnknownSync(schema)(input, { onExcessProperty: "error" });
  } catch {
    throw fail(code);
  }
}

function encodeJson(value: unknown, maximum: number): string {
  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw fail("invalid-request");
  }
  if (textEncoder.encode(encoded).byteLength > maximum) throw fail("resource-exhausted");
  return encoded;
}

function parseFrame(body: string): typeof CollaborationNetworkServerFrame.Type {
  if (
    textEncoder.encode(body).byteLength >
    Math.min(
      COLLABORATION_NETWORK_OUTBOUND_FRAME_MAX_UTF8_BYTES,
      COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES,
    )
  ) {
    throw fail("resource-exhausted");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw fail("protocol-error");
  }
  return strictDecode(CollaborationNetworkServerFrame, parsed);
}

function requestSchema(operation: CommandOperation | "message.subscribe-replay") {
  switch (operation) {
    case "message.append":
      return CollaborationTransportAppendRequest;
    case "message.tombstone":
      return CollaborationTransportTombstoneRequest;
    case "message.page":
      return CollaborationTransportPageRequest;
    case "context.create":
      return CollaborationTransportCreateContextRequest;
    case "message.subscribe-replay":
      return CollaborationTransportReplayRequest;
  }
}

function responseSchema(operation: CommandOperation | "message.subscribe-replay") {
  switch (operation) {
    case "message.append":
      return CollaborationTransportAppendResponse;
    case "message.tombstone":
      return CollaborationTransportTombstoneResponse;
    case "message.page":
      return CollaborationTransportPage;
    case "context.create":
      return CollaborationTransportCreateContextResponse;
    case "message.subscribe-replay":
      return CollaborationTransportReplayResult;
  }
}

export function createCollaborationNetworkClient(
  config: CollaborationNetworkClientConfig,
): CollaborationNetworkClient {
  const server = exactOrigin(config.serverOrigin, "collaboration server origin");
  exactOrigin(config.clientOrigin, "collaboration client origin");
  if (
    config.sessionEvidence.length === 0 ||
    `Bearer ${config.sessionEvidence}`.length > MAX_AUTHORIZATION_CHARS ||
    !/^[A-Za-z0-9._~-]+$/.test(config.sessionEvidence)
  ) {
    throw new Error("collaboration session evidence is invalid");
  }
  const authorization = `Bearer ${config.sessionEvidence}`;
  const commandUrl = `${server.origin}${COLLABORATION_NETWORK_COMMAND_PATH}`;
  const socketProtocol = server.protocol === "https:" ? "wss:" : "ws:";
  const socketUrl = `${socketProtocol}//${server.host}${COLLABORATION_NETWORK_SOCKET_PATH}`;
  let currentState: ClientState = "disconnected";
  let socket: CollaborationNetworkSocket | null = null;
  let connectPromise: Promise<void> | null = null;
  let settleConnect: {
    readonly resolve: () => void;
    readonly reject: (cause: Error) => void;
  } | null = null;
  const activeIds = new Set<string>();
  const commandControllers = new Map<string, AbortController>();
  const subscriptions = new Map<string, PendingSubscription>();
  let subscriptionReservations = 0;
  const outbound: Array<{ readonly encoded: string; readonly bytes: number }> = [];
  let outboundBytes = 0;
  let flushing = false;
  const state = (): ClientState => currentState;

  const rejectSubscriptions = (code: CollaborationNetworkClientErrorCode) => {
    for (const pending of subscriptions.values()) {
      pending.removeAbortListener();
      activeIds.delete(pending.requestId);
      pending.reject(fail(code));
    }
    subscriptions.clear();
    outbound.length = 0;
    outboundBytes = 0;
  };

  const abortCommands = () => {
    for (const controller of commandControllers.values()) controller.abort();
    commandControllers.clear();
  };

  const transitionDisconnected = () => {
    const wasConnecting = currentState === "connecting";
    currentState = "disconnected";
    socket = null;
    abortCommands();
    rejectSubscriptions("unavailable");
    if (wasConnecting) settleConnect?.reject(fail("unavailable"));
    settleConnect = null;
    connectPromise = null;
  };

  const flush = () => {
    if (flushing || currentState !== "connected" || socket === null || socket.readyState !== 1)
      return;
    flushing = true;
    try {
      while (outbound.length > 0) {
        const next = outbound.shift();
        if (!next) break;
        outboundBytes -= next.bytes;
        socket.send(next.encoded);
      }
    } catch {
      try {
        socket.close(1008, "transport unavailable");
      } catch {
        // The peer is already unavailable.
      }
      transitionDisconnected();
    } finally {
      flushing = false;
    }
  };

  const offer = (frame: CollaborationNetworkClientFrame) => {
    const encoded = encodeJson(frame, COLLABORATION_NETWORK_INBOUND_FRAME_MAX_UTF8_BYTES);
    const bytes = textEncoder.encode(encoded).byteLength;
    const buffered = socket?.bufferedAmount ?? 0;
    if (
      outbound.length >= COLLABORATION_NETWORK_MAX_OUTBOUND_QUEUE_MESSAGES ||
      outboundBytes + bytes > COLLABORATION_NETWORK_MAX_OUTBOUND_QUEUE_UTF8_BYTES ||
      buffered + outboundBytes + bytes > COLLABORATION_NETWORK_MAX_OUTBOUND_QUEUE_UTF8_BYTES
    ) {
      throw fail("resource-exhausted");
    }
    outbound.push({ encoded, bytes });
    outboundBytes += bytes;
    flush();
  };

  const receive = (data: unknown) => {
    if (typeof data !== "string") {
      socket?.close(1008, "invalid response");
      transitionDisconnected();
      return;
    }
    let frame: typeof CollaborationNetworkServerFrame.Type;
    try {
      frame = parseFrame(data);
    } catch {
      socket?.close(1008, "invalid response");
      transitionDisconnected();
      return;
    }
    if (frame.requestId === null) {
      socket?.close(1008, "invalid response");
      transitionDisconnected();
      return;
    }
    const pending = subscriptions.get(frame.requestId);
    if (!pending) return;
    if (frame.type === "replay-page") {
      try {
        pending.onPage(frame.page);
      } catch {
        cancelSubscription(pending, "cancelled");
      }
      return;
    }
    subscriptions.delete(frame.requestId);
    activeIds.delete(frame.requestId);
    pending.removeAbortListener();
    if (frame.type === "error") {
      pending.reject(fail(frame.code));
      return;
    }
    if (frame.operation !== "message.subscribe-replay") {
      pending.reject(fail("protocol-error"));
      return;
    }
    try {
      pending.resolve(strictDecode(CollaborationTransportReplayResult, frame.payload));
    } catch {
      pending.reject(fail("protocol-error"));
    }
  };

  const cancelSubscription = (
    pending: PendingSubscription,
    localCode: CollaborationNetworkClientErrorCode,
  ) => {
    if (!subscriptions.delete(pending.requestId)) return;
    activeIds.delete(pending.requestId);
    pending.removeAbortListener();
    if (!pending.cancelSent && currentState === "connected") {
      pending.cancelSent = true;
      try {
        offer({
          version: COLLABORATION_NETWORK_PROTOCOL_VERSION,
          type: "cancel",
          requestId: pending.requestId,
        });
      } catch {
        // Local cancellation remains exact even if a failed peer cannot accept the frame.
      }
    }
    pending.reject(fail(localCode));
  };

  const allocateFrame = async (
    operation: CommandOperation | "message.subscribe-replay",
    request: unknown,
  ): Promise<CollaborationNetworkRequestFrame> => {
    const validRequest = strictDecode(requestSchema(operation), request, "invalid-request");
    if (
      textEncoder.encode(encodeJson(validRequest, COLLABORATION_TRANSPORT_REQUEST_MAX_UTF8_BYTES))
        .byteLength > COLLABORATION_TRANSPORT_REQUEST_MAX_UTF8_BYTES
    ) {
      throw fail("resource-exhausted");
    }
    let requestId: RequestId;
    try {
      requestId = decodeRequestId(config.createRequestId(), { onExcessProperty: "error" });
    } catch {
      throw fail("invalid-request");
    }
    if (activeIds.has(requestId)) throw fail("resource-exhausted");
    activeIds.add(requestId);
    let proof: DeviceProof;
    try {
      const supplied = await config.createDeviceProof({
        requestId,
        operation,
        request: validRequest,
      });
      proof = decodeDeviceProof(supplied, {
        onExcessProperty: "error",
      });
    } catch {
      activeIds.delete(requestId);
      throw fail("invalid-request");
    }
    return {
      version: COLLABORATION_NETWORK_PROTOCOL_VERSION,
      type: "request",
      requestId,
      operation,
      proof,
      request: validRequest,
    };
  };

  const connect = (): Promise<void> => {
    if (currentState === "connected") return Promise.resolve();
    if (connectPromise) return connectPromise;
    currentState = "connecting";
    let resolveConnect!: () => void;
    let rejectConnect!: (cause: Error) => void;
    const pendingConnect = new Promise<void>((resolve, reject) => {
      resolveConnect = resolve;
      rejectConnect = reject;
    });
    connectPromise = pendingConnect;
    settleConnect = { resolve: resolveConnect, reject: rejectConnect };
    try {
      const openedSocket = config.openSocket({
        url: socketUrl,
        headers: { Authorization: authorization, Origin: config.clientOrigin },
        onOpen: () => {
          if (currentState !== "connecting") return;
          currentState = "connected";
          settleConnect?.resolve();
          settleConnect = null;
          flush();
        },
        onMessage: receive,
        onClose: transitionDisconnected,
        onError: transitionDisconnected,
      });
      if (state() === "disconnected") openedSocket.close(1000, "connection cancelled");
      else socket = openedSocket;
    } catch {
      transitionDisconnected();
    }
    return pendingConnect;
  };

  const disconnect = () => {
    if (currentState === "disconnected") return;
    for (const pending of subscriptions.values()) cancelSubscription(pending, "cancelled");
    abortCommands();
    currentState = "disconnected";
    try {
      socket?.close(1000, "client disconnect");
    } catch {
      // Closing is best effort after local state has been made inert.
    }
    socket = null;
    settleConnect?.reject(fail("cancelled"));
    settleConnect = null;
    connectPromise = null;
  };

  const command = async <Operation extends CommandOperation>(
    operation: Operation,
    request: CommandShape[Operation]["request"],
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<CommandShape[Operation]["response"]> => {
    if (currentState !== "connected") throw fail("not-connected");
    if (activeIds.size >= COLLABORATION_TRANSPORT_PROJECT_MAX_CONCURRENCY)
      throw fail("resource-exhausted");
    if (options.signal?.aborted) throw fail("cancelled");
    const frame = await allocateFrame(operation, request);
    if (currentState !== "connected" || options.signal?.aborted) {
      activeIds.delete(frame.requestId);
      throw fail(options.signal?.aborted ? "cancelled" : "not-connected");
    }
    const abort = new AbortController();
    commandControllers.set(frame.requestId, abort);
    const onAbort = () => abort.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const encoded = encodeJson(frame, COLLABORATION_NETWORK_INBOUND_FRAME_MAX_UTF8_BYTES);
      const response = await config.requestHttp({
        url: commandUrl,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          Origin: config.clientOrigin,
        },
        body: encoded,
        signal: abort.signal,
      });
      if (!Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599)
        throw fail("protocol-error");
      const serverFrame = parseFrame(response.body);
      if (serverFrame.requestId !== frame.requestId) throw fail("protocol-error");
      if (serverFrame.type === "error") throw fail(serverFrame.code);
      if (serverFrame.type !== "result" || serverFrame.operation !== operation)
        throw fail("protocol-error");
      const bytes = textEncoder.encode(response.body).byteLength;
      if (bytes > COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES) throw fail("resource-exhausted");
      return strictDecode(
        responseSchema(operation),
        serverFrame.payload,
      ) as CommandShape[Operation]["response"];
    } catch (cause) {
      if (abort.signal.aborted) throw fail("cancelled");
      if (cause instanceof CollaborationNetworkClientError) throw cause;
      throw fail("unavailable");
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      commandControllers.delete(frame.requestId);
      activeIds.delete(frame.requestId);
    }
  };

  const subscribeReplay = async (
    request: ReplayRequest,
    options: CollaborationReplaySubscriptionOptions,
  ): Promise<ReplayResult> => {
    if (currentState !== "connected") throw fail("not-connected");
    if (
      activeIds.size >= COLLABORATION_TRANSPORT_PROJECT_MAX_CONCURRENCY ||
      subscriptions.size + subscriptionReservations >=
        COLLABORATION_NETWORK_MAX_SUBSCRIPTIONS_PER_CONNECTION
    ) {
      throw fail("resource-exhausted");
    }
    if (options.signal?.aborted) throw fail("cancelled");
    subscriptionReservations += 1;
    let frame: CollaborationNetworkRequestFrame;
    try {
      frame = await allocateFrame("message.subscribe-replay", request);
    } finally {
      subscriptionReservations -= 1;
    }
    if (currentState !== "connected" || options.signal?.aborted) {
      activeIds.delete(frame.requestId);
      throw fail(options.signal?.aborted ? "cancelled" : "not-connected");
    }
    return new Promise<ReplayResult>((resolve, reject) => {
      const onAbort = () => {
        const pending = subscriptions.get(frame.requestId);
        if (pending) cancelSubscription(pending, "cancelled");
      };
      const pending: PendingSubscription = {
        requestId: frame.requestId,
        onPage: options.onPage,
        resolve,
        reject,
        removeAbortListener: () => options.signal?.removeEventListener("abort", onAbort),
        cancelSent: false,
      };
      subscriptions.set(frame.requestId, pending);
      options.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        offer(frame);
      } catch (cause) {
        subscriptions.delete(frame.requestId);
        activeIds.delete(frame.requestId);
        pending.removeAbortListener();
        reject(cause instanceof CollaborationNetworkClientError ? cause : fail("unavailable"));
      }
    });
  };

  return { state, connect, disconnect, command, subscribeReplay };
}
