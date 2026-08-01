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
  CollaborationTransportDeviceKeyRevokeRequest,
  CollaborationTransportDeviceKeyRevokeResponse,
  CollaborationTransportDeviceKeyStatusRequest,
  CollaborationTransportDeviceKeyStatusResponse,
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
  type CollaborationCurrentDeviceKeyStatus as DeviceKeyStatusResponse,
  type CollaborationCurrentDeviceKeyStatusRequest as DeviceKeyStatusRequest,
  type CollaborationDeviceKeyMutationResult as DeviceKeyRevokeResponse,
  type CollaborationRevokeDeviceKeyRequest as DeviceKeyRevokeRequest,
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
type CommandOperation =
  | "message.append"
  | "message.tombstone"
  | "message.page"
  | "context.create"
  | "device-key.status"
  | "device-key.revoke";

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
  readonly "device-key.status": {
    readonly request: DeviceKeyStatusRequest;
    readonly response: DeviceKeyStatusResponse;
  };
  readonly "device-key.revoke": {
    readonly request: DeviceKeyRevokeRequest;
    readonly response: DeviceKeyRevokeResponse;
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
  readonly getCurrentDeviceKeyStatus: (
    request: Readonly<DeviceKeyStatusRequest>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<DeviceKeyStatusResponse>;
  readonly revokeCurrentDeviceKey: (
    request: Readonly<DeviceKeyRevokeRequest>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<DeviceKeyRevokeResponse>;
}

interface PendingSubscription {
  readonly requestId: RequestId;
  readonly reservation: symbol;
  readonly sharedProjectId: string;
  readonly onPage: (page: TransportPage) => void;
  readonly resolve: (result: ReplayResult) => void;
  readonly reject: (cause: CollaborationNetworkClientError) => void;
  readonly removeAbortListener: () => void;
  cancelSent: boolean;
}

interface AllocatedFrame {
  readonly frame: CollaborationNetworkRequestFrame;
  readonly reservation: symbol;
  readonly sharedProjectId: string;
}

interface PendingCommandAbort {
  readonly controller: AbortController;
  code: CollaborationNetworkClientErrorCode;
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
  if (typeof value !== "string") throw new Error(`${label} must be an exact HTTP(S) origin`);
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

function statusForError(code: CollaborationNetworkPublicErrorCode): number {
  switch (code) {
    case "invalid-request":
      return 400;
    case "not-found":
      return 404;
    case "conflict":
      return 409;
    case "cancelled":
      return 408;
    case "rate-limited":
    case "resource-exhausted":
    case "slow-consumer":
      return 429;
    case "unavailable":
      return 503;
  }
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
    case "device-key.status":
      return CollaborationTransportDeviceKeyStatusRequest;
    case "device-key.revoke":
      return CollaborationTransportDeviceKeyRevokeRequest;
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
    case "device-key.status":
      return CollaborationTransportDeviceKeyStatusResponse;
    case "device-key.revoke":
      return CollaborationTransportDeviceKeyRevokeResponse;
    case "message.subscribe-replay":
      return CollaborationTransportReplayResult;
  }
}

function responseProjectId(operation: CommandOperation, response: unknown): unknown {
  if (operation === "device-key.revoke") {
    return (response as { readonly key: { readonly sharedProjectId: unknown } }).key
      .sharedProjectId;
  }
  return (response as { readonly sharedProjectId: unknown }).sharedProjectId;
}

export function createCollaborationNetworkClient(
  config: CollaborationNetworkClientConfig,
): CollaborationNetworkClient {
  const server = exactOrigin(config.serverOrigin, "collaboration server origin");
  const clientOrigin = exactOrigin(config.clientOrigin, "collaboration client origin").origin;
  const sessionEvidence = config.sessionEvidence;
  if (
    typeof sessionEvidence !== "string" ||
    sessionEvidence.length === 0 ||
    `Bearer ${sessionEvidence}`.length > MAX_AUTHORIZATION_CHARS ||
    !/^[A-Za-z0-9._~-]+$/.test(sessionEvidence)
  ) {
    throw new Error("collaboration session evidence is invalid");
  }
  if (
    typeof config.createRequestId !== "function" ||
    typeof config.createDeviceProof !== "function" ||
    typeof config.requestHttp !== "function" ||
    typeof config.openSocket !== "function"
  ) {
    throw new Error("collaboration network client adapters are invalid");
  }
  const createRequestId = config.createRequestId;
  const createDeviceProof = config.createDeviceProof;
  const requestHttp = config.requestHttp;
  const openSocket = config.openSocket;
  const authorization = `Bearer ${sessionEvidence}`;
  const commandUrl = `${server.origin}${COLLABORATION_NETWORK_COMMAND_PATH}`;
  const socketProtocol = server.protocol === "https:" ? "wss:" : "ws:";
  const socketUrl = `${socketProtocol}//${server.host}${COLLABORATION_NETWORK_SOCKET_PATH}`;
  let currentState: ClientState = "disconnected";
  let connectionGeneration = 0;
  let socket: CollaborationNetworkSocket | null = null;
  let connectPromise: Promise<void> | null = null;
  let settleConnect: {
    readonly resolve: () => void;
    readonly reject: (cause: Error) => void;
  } | null = null;
  const activeIds = new Map<string, symbol>();
  const commandControllers = new Map<string, PendingCommandAbort>();
  const subscriptions = new Map<string, PendingSubscription>();
  const completedSocketIds = new Set<string>();
  const subscriptionReservations = new Set<symbol>();
  const outbound: Array<{ readonly encoded: string; readonly bytes: number }> = [];
  let outboundBytes = 0;
  let flushing = false;
  const state = (): ClientState => currentState;

  const releaseRequestId = (requestId: RequestId, reservation: symbol) => {
    if (activeIds.get(requestId) === reservation) activeIds.delete(requestId);
  };

  const rememberCompletedSocketId = (requestId: RequestId) => {
    if (completedSocketIds.size >= COLLABORATION_NETWORK_MAX_OUTBOUND_QUEUE_MESSAGES) {
      const oldest = completedSocketIds.values().next().value;
      if (oldest !== undefined) completedSocketIds.delete(oldest);
    }
    completedSocketIds.add(requestId);
  };

  const rejectSubscriptions = (code: CollaborationNetworkClientErrorCode) => {
    for (const pending of subscriptions.values()) {
      pending.removeAbortListener();
      releaseRequestId(pending.requestId, pending.reservation);
      pending.reject(fail(code));
    }
    subscriptions.clear();
    outbound.length = 0;
    outboundBytes = 0;
  };

  const abortCommand = (
    pending: PendingCommandAbort,
    code: CollaborationNetworkClientErrorCode,
  ) => {
    if (pending.controller.signal.aborted) return;
    pending.code = code;
    pending.controller.abort();
  };

  const abortCommands = (code: CollaborationNetworkClientErrorCode) => {
    for (const pending of commandControllers.values()) abortCommand(pending, code);
  };

  const transitionDisconnected = (generation: number) => {
    if (generation !== connectionGeneration) return;
    const wasConnecting = currentState === "connecting";
    connectionGeneration += 1;
    currentState = "disconnected";
    socket = null;
    abortCommands("unavailable");
    rejectSubscriptions("unavailable");
    activeIds.clear();
    subscriptionReservations.clear();
    completedSocketIds.clear();
    if (wasConnecting) settleConnect?.reject(fail("unavailable"));
    settleConnect = null;
    connectPromise = null;
  };

  const flush = () => {
    if (flushing || currentState !== "connected" || socket === null || socket.readyState !== 1)
      return;
    const generation = connectionGeneration;
    const activeSocket = socket;
    flushing = true;
    try {
      while (outbound.length > 0) {
        const next = outbound.shift();
        if (!next) break;
        outboundBytes -= next.bytes;
        activeSocket.send(next.encoded);
      }
    } catch {
      try {
        activeSocket.close(1008, "transport unavailable");
      } catch {
        // The peer is already unavailable.
      }
      transitionDisconnected(generation);
    } finally {
      flushing = false;
    }
  };

  const offer = (frame: CollaborationNetworkClientFrame) => {
    const encoded = encodeJson(frame, COLLABORATION_NETWORK_INBOUND_FRAME_MAX_UTF8_BYTES);
    const bytes = textEncoder.encode(encoded).byteLength;
    const buffered = socket?.bufferedAmount ?? 0;
    if (
      !Number.isSafeInteger(buffered) ||
      buffered < 0 ||
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

  const receive = (generation: number, data: unknown) => {
    if (generation !== connectionGeneration) return;
    if (typeof data !== "string") {
      socket?.close(1008, "invalid response");
      transitionDisconnected(generation);
      return;
    }
    let frame: typeof CollaborationNetworkServerFrame.Type;
    try {
      frame = parseFrame(data);
    } catch {
      socket?.close(1008, "invalid response");
      transitionDisconnected(generation);
      return;
    }
    if (frame.requestId === null) {
      socket?.close(1008, "invalid response");
      transitionDisconnected(generation);
      return;
    }
    const pending = subscriptions.get(frame.requestId);
    if (!pending) {
      if (completedSocketIds.has(frame.requestId)) return;
      socket?.close(1008, "invalid response");
      transitionDisconnected(generation);
      return;
    }
    if (frame.type === "replay-page") {
      if (frame.page.sharedProjectId !== pending.sharedProjectId) {
        socket?.close(1008, "invalid response");
        transitionDisconnected(generation);
        return;
      }
      try {
        const outcome = pending.onPage(frame.page) as unknown;
        if (
          outcome !== null &&
          (typeof outcome === "object" || typeof outcome === "function") &&
          typeof (outcome as { readonly then?: unknown }).then === "function"
        ) {
          void Promise.resolve(outcome).catch(() => cancelSubscription(pending, "cancelled"));
        }
      } catch {
        cancelSubscription(pending, "cancelled");
      }
      return;
    }
    if (frame.type === "result") {
      try {
        if (frame.operation !== "message.subscribe-replay") throw fail("protocol-error");
        const result = strictDecode(CollaborationTransportReplayResult, frame.payload);
        if (result.sharedProjectId !== pending.sharedProjectId) throw fail("protocol-error");
      } catch {
        socket?.close(1008, "invalid response");
        transitionDisconnected(generation);
        return;
      }
    }
    subscriptions.delete(frame.requestId);
    rememberCompletedSocketId(frame.requestId);
    releaseRequestId(frame.requestId, pending.reservation);
    pending.removeAbortListener();
    if (frame.type === "error") {
      pending.reject(fail(frame.code));
      return;
    }
    pending.resolve(strictDecode(CollaborationTransportReplayResult, frame.payload));
  };

  const cancelSubscription = (
    pending: PendingSubscription,
    localCode: CollaborationNetworkClientErrorCode,
  ) => {
    if (!subscriptions.delete(pending.requestId)) return;
    rememberCompletedSocketId(pending.requestId);
    releaseRequestId(pending.requestId, pending.reservation);
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
  ): Promise<AllocatedFrame> => {
    const validRequest = strictDecode(requestSchema(operation), request, "invalid-request");
    if (
      textEncoder.encode(encodeJson(validRequest, COLLABORATION_TRANSPORT_REQUEST_MAX_UTF8_BYTES))
        .byteLength > COLLABORATION_TRANSPORT_REQUEST_MAX_UTF8_BYTES
    ) {
      throw fail("resource-exhausted");
    }
    let requestId: RequestId;
    try {
      requestId = decodeRequestId(createRequestId(), { onExcessProperty: "error" });
    } catch {
      throw fail("invalid-request");
    }
    if (
      activeIds.has(requestId) ||
      (operation === "message.subscribe-replay" && completedSocketIds.has(requestId))
    ) {
      throw fail("resource-exhausted");
    }
    const reservation = Symbol(requestId);
    activeIds.set(requestId, reservation);
    let proof: DeviceProof;
    try {
      const supplied = await createDeviceProof({
        requestId,
        operation,
        request: validRequest,
      });
      proof = decodeDeviceProof(supplied, {
        onExcessProperty: "error",
      });
    } catch {
      releaseRequestId(requestId, reservation);
      throw fail("invalid-request");
    }
    return {
      frame: {
        version: COLLABORATION_NETWORK_PROTOCOL_VERSION,
        type: "request",
        requestId,
        operation,
        proof,
        request: validRequest,
      },
      reservation,
      sharedProjectId: (validRequest as { readonly sharedProjectId: string }).sharedProjectId,
    };
  };

  const connect = (): Promise<void> => {
    if (currentState === "connected") return Promise.resolve();
    if (connectPromise) return connectPromise;
    currentState = "connecting";
    const generation = ++connectionGeneration;
    let resolveConnect!: () => void;
    let rejectConnect!: (cause: Error) => void;
    const pendingConnect = new Promise<void>((resolve, reject) => {
      resolveConnect = resolve;
      rejectConnect = reject;
    });
    connectPromise = pendingConnect;
    settleConnect = { resolve: resolveConnect, reject: rejectConnect };
    let factoryReturned = false;
    let openSignalled = false;
    const finishOpen = () => {
      if (
        !factoryReturned ||
        !openSignalled ||
        generation !== connectionGeneration ||
        currentState !== "connecting" ||
        socket === null
      ) {
        return;
      }
      currentState = "connected";
      settleConnect?.resolve();
      settleConnect = null;
      flush();
    };
    try {
      const openedSocket = openSocket({
        url: socketUrl,
        headers: { Authorization: authorization, Origin: clientOrigin },
        onOpen: () => {
          openSignalled = true;
          finishOpen();
        },
        onMessage: (data) => receive(generation, data),
        onClose: () => transitionDisconnected(generation),
        onError: () => transitionDisconnected(generation),
      });
      if (
        openedSocket === null ||
        typeof openedSocket !== "object" ||
        typeof openedSocket.send !== "function" ||
        typeof openedSocket.close !== "function"
      ) {
        throw new Error("invalid collaboration socket adapter");
      }
      factoryReturned = true;
      if (generation !== connectionGeneration || state() === "disconnected") {
        openedSocket.close(1000, "connection cancelled");
      } else {
        socket = openedSocket;
        finishOpen();
      }
    } catch {
      transitionDisconnected(generation);
    }
    return pendingConnect;
  };

  const disconnect = () => {
    if (currentState === "disconnected") return;
    const cancelledSubscriptions = [...subscriptions.values()];
    for (const pending of cancelledSubscriptions) {
      if (!subscriptions.delete(pending.requestId)) continue;
      releaseRequestId(pending.requestId, pending.reservation);
      pending.removeAbortListener();
      pending.reject(fail("cancelled"));
    }
    for (const pending of cancelledSubscriptions) {
      if (pending.cancelSent || currentState !== "connected") continue;
      pending.cancelSent = true;
      try {
        offer({
          version: COLLABORATION_NETWORK_PROTOCOL_VERSION,
          type: "cancel",
          requestId: pending.requestId,
        });
      } catch {
        // All local waiters are already cancelled; the peer is best effort.
      }
    }
    abortCommands("cancelled");
    connectionGeneration += 1;
    currentState = "disconnected";
    try {
      socket?.close(1000, "client disconnect");
    } catch {
      // Closing is best effort after local state has been made inert.
    }
    socket = null;
    outbound.length = 0;
    outboundBytes = 0;
    activeIds.clear();
    subscriptionReservations.clear();
    completedSocketIds.clear();
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
    const operationGeneration = connectionGeneration;
    const allocated = await allocateFrame(operation, request);
    const { frame, reservation, sharedProjectId } = allocated;
    if (
      operationGeneration !== connectionGeneration ||
      currentState !== "connected" ||
      options.signal?.aborted
    ) {
      releaseRequestId(frame.requestId, reservation);
      throw fail(options.signal?.aborted ? "cancelled" : "not-connected");
    }
    const pendingAbort: PendingCommandAbort = {
      controller: new AbortController(),
      code: "cancelled",
    };
    commandControllers.set(frame.requestId, pendingAbort);
    const onAbort = () => abortCommand(pendingAbort, "cancelled");
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const encoded = encodeJson(frame, COLLABORATION_NETWORK_INBOUND_FRAME_MAX_UTF8_BYTES);
      const response = await requestHttp({
        url: commandUrl,
        headers: {
          Authorization: authorization,
          "Content-Type": "application/json",
          Origin: clientOrigin,
        },
        body: encoded,
        signal: pendingAbort.controller.signal,
      });
      if (
        response === null ||
        typeof response !== "object" ||
        !Number.isSafeInteger(response.status) ||
        response.status < 100 ||
        response.status > 599 ||
        typeof response.body !== "string"
      ) {
        throw fail("protocol-error");
      }
      const serverFrame = parseFrame(response.body);
      if (serverFrame.requestId !== frame.requestId) throw fail("protocol-error");
      if (serverFrame.type === "error") {
        if (response.status !== statusForError(serverFrame.code)) throw fail("protocol-error");
        throw fail(serverFrame.code);
      }
      if (serverFrame.type !== "result" || serverFrame.operation !== operation)
        throw fail("protocol-error");
      if (response.status !== 200) throw fail("protocol-error");
      const bytes = textEncoder.encode(response.body).byteLength;
      if (bytes > COLLABORATION_TRANSPORT_RESPONSE_MAX_UTF8_BYTES) throw fail("resource-exhausted");
      const decoded = strictDecode(
        responseSchema(operation),
        serverFrame.payload,
      ) as CommandShape[Operation]["response"];
      if (responseProjectId(operation, decoded) !== sharedProjectId) throw fail("protocol-error");
      return decoded;
    } catch (cause) {
      if (pendingAbort.controller.signal.aborted) throw fail(pendingAbort.code);
      if (cause instanceof CollaborationNetworkClientError) throw cause;
      throw fail("unavailable");
    } finally {
      options.signal?.removeEventListener("abort", onAbort);
      commandControllers.delete(frame.requestId);
      releaseRequestId(frame.requestId, reservation);
    }
  };

  const subscribeReplay = async (
    request: ReplayRequest,
    options: CollaborationReplaySubscriptionOptions,
  ): Promise<ReplayResult> => {
    if (currentState !== "connected") throw fail("not-connected");
    if (
      activeIds.size >= COLLABORATION_TRANSPORT_PROJECT_MAX_CONCURRENCY ||
      subscriptions.size + subscriptionReservations.size >=
        COLLABORATION_NETWORK_MAX_SUBSCRIPTIONS_PER_CONNECTION
    ) {
      throw fail("resource-exhausted");
    }
    if (typeof options?.onPage !== "function") throw fail("invalid-request");
    if (options.signal?.aborted) throw fail("cancelled");
    const operationGeneration = connectionGeneration;
    const subscriptionReservation = Symbol("subscription");
    subscriptionReservations.add(subscriptionReservation);
    let allocated: AllocatedFrame;
    try {
      allocated = await allocateFrame("message.subscribe-replay", request);
    } finally {
      subscriptionReservations.delete(subscriptionReservation);
    }
    const { frame, reservation, sharedProjectId } = allocated;
    if (
      operationGeneration !== connectionGeneration ||
      currentState !== "connected" ||
      options.signal?.aborted
    ) {
      releaseRequestId(frame.requestId, reservation);
      throw fail(options.signal?.aborted ? "cancelled" : "not-connected");
    }
    return new Promise<ReplayResult>((resolve, reject) => {
      const onAbort = () => {
        const pending = subscriptions.get(frame.requestId);
        if (pending) cancelSubscription(pending, "cancelled");
      };
      const pending: PendingSubscription = {
        requestId: frame.requestId,
        reservation,
        sharedProjectId,
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
        releaseRequestId(frame.requestId, reservation);
        pending.removeAbortListener();
        reject(cause instanceof CollaborationNetworkClientError ? cause : fail("unavailable"));
      }
    });
  };

  const getCurrentDeviceKeyStatus: CollaborationNetworkClient["getCurrentDeviceKeyStatus"] = (
    request,
    options,
  ) => command("device-key.status", request, options);
  const revokeCurrentDeviceKey: CollaborationNetworkClient["revokeCurrentDeviceKey"] = (
    request,
    options,
  ) => command("device-key.revoke", request, options);

  return {
    state,
    connect,
    disconnect,
    command,
    subscribeReplay,
    getCurrentDeviceKeyStatus,
    revokeCurrentDeviceKey,
  };
}
