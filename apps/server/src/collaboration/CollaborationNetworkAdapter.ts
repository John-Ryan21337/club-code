// @effect-diagnostics nodeBuiltinImport:off
import { NodeWS } from "@effect/platform-node/NodeSocket";
import {
  COLLABORATION_NETWORK_HEARTBEAT_INTERVAL_MS,
  COLLABORATION_NETWORK_INBOUND_FRAME_MAX_UTF8_BYTES,
  COLLABORATION_NETWORK_LIVENESS_TIMEOUT_MS,
  COLLABORATION_NETWORK_MAX_CONNECTIONS,
  COLLABORATION_NETWORK_MAX_OUTBOUND_QUEUE_MESSAGES,
  COLLABORATION_NETWORK_MAX_OUTBOUND_QUEUE_UTF8_BYTES,
  COLLABORATION_NETWORK_MAX_SUBSCRIPTIONS_PER_CONNECTION,
  COLLABORATION_NETWORK_OUTBOUND_FRAME_MAX_UTF8_BYTES,
  COLLABORATION_NETWORK_PROTOCOL_VERSION,
  COLLABORATION_NETWORK_REQUESTS_PER_MINUTE,
  COLLABORATION_NETWORK_SHUTDOWN_GRACE_MS,
  CollaborationNetworkClientFrame,
  type CollaborationNetworkDeviceProof,
  type CollaborationNetworkPublicErrorCode,
  type CollaborationNetworkRequestFrame,
  type CollaborationNetworkRequestId,
  type CollaborationNetworkServerFrame,
} from "@cafecode/contracts";
import { createHash, createHmac, randomBytes } from "node:crypto";
import * as Http from "node:http";
import * as Https from "node:https";
import type * as Tls from "node:tls";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { isLoopbackHost } from "../startupAccess.ts";
import {
  type CollaborationTransportFacadeShape,
  CollaborationTransportError,
} from "./CollaborationTransportFacade.ts";

export const COLLABORATION_NETWORK_HTTP_PATH = "/api/collaboration/v1/command";
export const COLLABORATION_NETWORK_WEBSOCKET_PATH = "/api/collaboration/v1/socket";

const DEFAULT_REPLAYS_PER_MINUTE = 12;
const DEFAULT_MAX_IN_FLIGHT_REQUESTS = 8;
const DEFAULT_NONCE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_NONCES = 16_384;
const MAX_AUTHORIZATION_CHARS = 4_096;

/**
 * Opaque authentication evidence assembled exclusively from the authenticated
 * network boundary. It deliberately has no principal/user/project fields: the
 * facade's server-owned resolver is the only component allowed to resolve one.
 */
export interface CollaborationNetworkAuthentication {
  readonly sessionToken: string;
  readonly deviceProof: CollaborationNetworkDeviceProof;
  readonly origin: string;
  readonly bodySha256: string;
  readonly transport: "http" | "websocket";
}

export interface CollaborationNetworkTlsOptions {
  readonly key: Tls.SecureContextOptions["key"];
  readonly cert: Tls.SecureContextOptions["cert"];
  readonly ca?: Tls.SecureContextOptions["ca"];
}

export interface CollaborationNetworkAdapterConfig {
  /** The adapter is inert unless this is explicitly true. */
  readonly enabled?: boolean;
  readonly host?: string;
  readonly port: number;
  readonly allowNonLoopback?: boolean;
  readonly tls?: CollaborationNetworkTlsOptions;
  /** Exact, lower-cased hostnames accepted from the HTTP Host header. */
  readonly allowedHosts: ReadonlyArray<string>;
  /** Exact serialized origins accepted from HTTP and WebSocket clients. */
  readonly allowedOrigins: ReadonlyArray<string>;
  readonly maxConnections?: number;
  /** Caps unauthenticated upgrade occupancy from one network source. */
  readonly maxConnectionsPerSource?: number;
  readonly maxSubscriptionsPerConnection?: number;
  readonly maxInFlightRequestsPerConnection?: number;
  readonly requestsPerMinute?: number;
  readonly replaysPerMinute?: number;
  readonly maxInboundFrameBytes?: number;
  readonly maxOutboundFrameBytes?: number;
  readonly maxOutboundQueueMessages?: number;
  readonly maxOutboundQueueBytes?: number;
  readonly heartbeatIntervalMs?: number;
  readonly livenessTimeoutMs?: number;
  readonly shutdownGraceMs?: number;
  readonly nonceTtlMs?: number;
  readonly maxRememberedNonces?: number;
}

export interface CollaborationNetworkDiagnostic {
  readonly event:
    | "listener-started"
    | "listener-stopped"
    | "request-rejected"
    | "connection-opened"
    | "connection-closed";
  readonly transport?: "http" | "websocket";
  readonly code?: CollaborationNetworkPublicErrorCode;
}

export interface CollaborationNetworkListenerFactoryInput {
  readonly tls: CollaborationNetworkTlsOptions | undefined;
  readonly maxPayloadBytes: number;
}

export interface CollaborationNetworkListenerFactoryResult {
  readonly server: Http.Server | Https.Server;
  readonly webSocketServer: NodeWS.WebSocketServer;
}

export type CollaborationNetworkListenerFactory = (
  input: CollaborationNetworkListenerFactoryInput,
) => CollaborationNetworkListenerFactoryResult;

export interface CollaborationNetworkAdapterOptions {
  readonly config: CollaborationNetworkAdapterConfig;
  readonly facade: CollaborationTransportFacadeShape;
  readonly listenerFactory?: CollaborationNetworkListenerFactory;
  readonly now?: () => number;
  /** Metadata-only hook. Authentication, bodies, paths, and identifiers are not representable. */
  readonly onDiagnostic?: (diagnostic: CollaborationNetworkDiagnostic) => void;
}

export interface CollaborationNetworkAdapterHandle {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number | null;
  readonly secure: boolean;
  readonly stop: () => Promise<void>;
}

interface ValidatedConfig {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly tls: CollaborationNetworkTlsOptions | undefined;
  readonly allowedHosts: ReadonlySet<string>;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly maxConnections: number;
  readonly maxConnectionsPerSource: number;
  readonly maxSubscriptions: number;
  readonly maxInFlight: number;
  readonly requestsPerMinute: number;
  readonly replaysPerMinute: number;
  readonly maxInboundFrameBytes: number;
  readonly maxOutboundFrameBytes: number;
  readonly maxOutboundQueueMessages: number;
  readonly maxOutboundQueueBytes: number;
  readonly heartbeatIntervalMs: number;
  readonly livenessTimeoutMs: number;
  readonly shutdownGraceMs: number;
  readonly nonceTtlMs: number;
  readonly maxRememberedNonces: number;
}

const decodeClientFrame = Schema.decodeUnknownSync(CollaborationNetworkClientFrame);

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be positive`);
  return value;
}

function normalizeAllowedHost(value: string): string {
  if (value.length === 0 || value.length > 253 || value.includes(",")) {
    throw new Error("collaboration network allowed host is invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(`http://${value}`);
  } catch {
    throw new Error("collaboration network allowed host is invalid");
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.port
  ) {
    throw new Error("collaboration network allowed host must be a hostname without a port");
  }
  return parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
}

function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("collaboration network allowed origin is invalid");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.origin !== value
  ) {
    throw new Error("collaboration network allowed origin must be an exact HTTP(S) origin");
  }
  return parsed.origin;
}

function validateConfig(input: CollaborationNetworkAdapterConfig): ValidatedConfig {
  const enabled = input.enabled === true;
  const host = input.host ?? "127.0.0.1";
  if (host.length === 0 || host.length > 253)
    throw new Error("collaboration network host is invalid");
  if (!Number.isSafeInteger(input.port) || input.port < 0 || input.port > 65_535) {
    throw new Error("collaboration network port is invalid");
  }
  const loopback = isLoopbackHost(host);
  if (!loopback && input.allowNonLoopback !== true) {
    throw new Error("collaboration network non-loopback binding requires explicit opt-in");
  }
  if (!loopback && input.tls === undefined) {
    throw new Error("collaboration network TLS is required for non-loopback binding");
  }
  if (input.allowedHosts.length === 0 || input.allowedOrigins.length === 0) {
    throw new Error("collaboration network Host and Origin allowlists are required");
  }
  const allowedHosts = new Set(input.allowedHosts.map(normalizeAllowedHost));
  const allowedOrigins = new Set(input.allowedOrigins.map(normalizeOrigin));
  if (!loopback && [...allowedOrigins].some((origin) => !origin.startsWith("https://"))) {
    throw new Error("collaboration network non-loopback origins must use HTTPS");
  }
  return {
    enabled,
    host,
    port: input.port,
    tls: input.tls,
    allowedHosts,
    allowedOrigins,
    maxConnections: positiveInteger(
      input.maxConnections ?? COLLABORATION_NETWORK_MAX_CONNECTIONS,
      "collaboration network connection limit",
    ),
    maxConnectionsPerSource: positiveInteger(
      input.maxConnectionsPerSource ??
        Math.min(4, input.maxConnections ?? COLLABORATION_NETWORK_MAX_CONNECTIONS),
      "collaboration network per-source connection limit",
    ),
    maxSubscriptions: positiveInteger(
      input.maxSubscriptionsPerConnection ?? COLLABORATION_NETWORK_MAX_SUBSCRIPTIONS_PER_CONNECTION,
      "collaboration network subscription limit",
    ),
    maxInFlight: positiveInteger(
      input.maxInFlightRequestsPerConnection ?? DEFAULT_MAX_IN_FLIGHT_REQUESTS,
      "collaboration network in-flight limit",
    ),
    requestsPerMinute: positiveInteger(
      input.requestsPerMinute ?? COLLABORATION_NETWORK_REQUESTS_PER_MINUTE,
      "collaboration network request rate",
    ),
    replaysPerMinute: positiveInteger(
      input.replaysPerMinute ?? DEFAULT_REPLAYS_PER_MINUTE,
      "collaboration network replay rate",
    ),
    maxInboundFrameBytes: positiveInteger(
      input.maxInboundFrameBytes ?? COLLABORATION_NETWORK_INBOUND_FRAME_MAX_UTF8_BYTES,
      "collaboration network inbound frame limit",
    ),
    maxOutboundFrameBytes: positiveInteger(
      input.maxOutboundFrameBytes ?? COLLABORATION_NETWORK_OUTBOUND_FRAME_MAX_UTF8_BYTES,
      "collaboration network outbound frame limit",
    ),
    maxOutboundQueueMessages: positiveInteger(
      input.maxOutboundQueueMessages ?? COLLABORATION_NETWORK_MAX_OUTBOUND_QUEUE_MESSAGES,
      "collaboration network outbound queue message limit",
    ),
    maxOutboundQueueBytes: positiveInteger(
      input.maxOutboundQueueBytes ?? COLLABORATION_NETWORK_MAX_OUTBOUND_QUEUE_UTF8_BYTES,
      "collaboration network outbound queue byte limit",
    ),
    heartbeatIntervalMs: positiveInteger(
      input.heartbeatIntervalMs ?? COLLABORATION_NETWORK_HEARTBEAT_INTERVAL_MS,
      "collaboration network heartbeat interval",
    ),
    livenessTimeoutMs: positiveInteger(
      input.livenessTimeoutMs ?? COLLABORATION_NETWORK_LIVENESS_TIMEOUT_MS,
      "collaboration network liveness timeout",
    ),
    shutdownGraceMs: positiveInteger(
      input.shutdownGraceMs ?? COLLABORATION_NETWORK_SHUTDOWN_GRACE_MS,
      "collaboration network shutdown grace",
    ),
    nonceTtlMs: positiveInteger(
      input.nonceTtlMs ?? DEFAULT_NONCE_TTL_MS,
      "collaboration network nonce lifetime",
    ),
    maxRememberedNonces: positiveInteger(
      input.maxRememberedNonces ?? DEFAULT_MAX_NONCES,
      "collaboration network nonce capacity",
    ),
  };
}

function requestUrl(request: Http.IncomingMessage): URL | null {
  const target = request.url;
  // This listener is an origin server, not a forwarding proxy. Accept only a
  // normal origin-form target so an absolute-form or network-path target
  // cannot smuggle a second authority past the separately validated Host.
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.includes("\\")) {
    return null;
  }
  try {
    return new URL(target, "http://collaboration.invalid");
  } catch {
    return null;
  }
}

function requestHost(request: Http.IncomingMessage): string | null {
  const host = request.headers.host;
  if (typeof host !== "string" || host.includes(",") || host.length > 300) return null;
  try {
    const parsed = new URL(`http://${host}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  } catch {
    return null;
  }
}

function bearerToken(request: Http.IncomingMessage): string | null {
  const authorization = request.headers.authorization;
  if (
    typeof authorization !== "string" ||
    authorization.length > MAX_AUTHORIZATION_CHARS ||
    !authorization.startsWith("Bearer ")
  ) {
    return null;
  }
  const token = authorization.slice("Bearer ".length);
  return /^[A-Za-z0-9._~-]+$/.test(token) ? token : null;
}

function origin(request: Http.IncomingMessage, allowed: ReadonlySet<string>): string | null {
  const value = request.headers.origin;
  return typeof value === "string" && !value.includes(",") && allowed.has(value) ? value : null;
}

function writeJson(response: Http.ServerResponse, status: number, body: unknown): void {
  const encoded = `${JSON.stringify(body)}\n`;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(encoded);
}

function publicError(
  requestId: CollaborationNetworkRequestId | null,
  code: CollaborationNetworkPublicErrorCode,
): CollaborationNetworkServerFrame {
  return {
    version: COLLABORATION_NETWORK_PROTOCOL_VERSION,
    type: "error",
    requestId,
    code,
  };
}

function statusFor(code: CollaborationNetworkPublicErrorCode): number {
  switch (code) {
    case "not-found":
      return 404;
    case "conflict":
      return 409;
    case "rate-limited":
    case "resource-exhausted":
    case "slow-consumer":
      return 429;
    case "cancelled":
      return 408;
    case "unavailable":
      return 503;
    case "invalid-request":
      return 400;
  }
}

class FixedWindowRateGate {
  readonly #entries = new Map<string, { start: number; count: number }>();
  readonly limit: number;
  readonly maximumKeys: number;
  constructor(limit: number, maximumKeys: number) {
    this.limit = limit;
    this.maximumKeys = maximumKeys;
  }

  admit(key: string, now: number): boolean {
    const current = this.#entries.get(key);
    if (!current || now - current.start >= 60_000) {
      if (!current && this.#entries.size >= this.maximumKeys) this.prune(now);
      if (!current && this.#entries.size >= this.maximumKeys) return false;
      this.#entries.set(key, { start: now, count: 1 });
      return true;
    }
    if (current.count >= this.limit) return false;
    current.count += 1;
    return true;
  }

  private prune(now: number): void {
    for (const [key, value] of this.#entries) {
      if (now - value.start >= 60_000) this.#entries.delete(key);
    }
  }
}

class NonceReplayGuard {
  readonly #entries = new Map<string, number>();
  readonly ttlMs: number;
  readonly maximum: number;
  constructor(ttlMs: number, maximum: number) {
    this.ttlMs = ttlMs;
    this.maximum = maximum;
  }

  admit(key: string, issuedAtMs: number, now: number): boolean {
    if (Math.abs(now - issuedAtMs) > this.ttlMs) return false;
    this.prune(now);
    if (this.#entries.has(key) || this.#entries.size >= this.maximum) return false;
    this.#entries.set(key, now + this.ttlMs);
    return true;
  }

  private prune(now: number): void {
    for (const [key, expiresAt] of this.#entries) {
      if (expiresAt <= now) this.#entries.delete(key);
    }
  }
}

class ConnectionAdmission {
  #active = 0;
  readonly #bySource = new Map<string, number>();
  readonly maximum: number;
  readonly maximumPerSource: number;
  constructor(maximum: number, maximumPerSource: number) {
    this.maximum = maximum;
    this.maximumPerSource = maximumPerSource;
  }
  acquire(source: string): (() => void) | null {
    const sourceActive = this.#bySource.get(source) ?? 0;
    if (this.#active >= this.maximum || sourceActive >= this.maximumPerSource) return null;
    this.#active += 1;
    this.#bySource.set(source, sourceActive + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active -= 1;
      const current = this.#bySource.get(source) ?? 1;
      if (current <= 1) this.#bySource.delete(source);
      else this.#bySource.set(source, current - 1);
    };
  }
}

class OutboundQueue {
  readonly #pending: Array<{ encoded: string; bytes: number }> = [];
  #pendingBytes = 0;
  #sending = false;

  readonly socket: NodeWS.WebSocket;
  readonly maximumMessages: number;
  readonly maximumBytes: number;
  readonly maximumFrameBytes: number;
  constructor(
    socket: NodeWS.WebSocket,
    maximumMessages: number,
    maximumBytes: number,
    maximumFrameBytes: number,
  ) {
    this.socket = socket;
    this.maximumMessages = maximumMessages;
    this.maximumBytes = maximumBytes;
    this.maximumFrameBytes = maximumFrameBytes;
  }

  offer(frame: CollaborationNetworkServerFrame): boolean {
    let encoded: string;
    try {
      encoded = JSON.stringify(frame);
    } catch {
      return false;
    }
    const bytes = Buffer.byteLength(encoded, "utf8");
    if (
      bytes > this.maximumFrameBytes ||
      this.#pending.length >= this.maximumMessages ||
      this.#pendingBytes + bytes > this.maximumBytes ||
      this.socket.bufferedAmount + this.#pendingBytes + bytes > this.maximumBytes
    ) {
      return false;
    }
    this.#pending.push({ encoded, bytes });
    this.#pendingBytes += bytes;
    this.pump();
    return true;
  }

  private pump(): void {
    if (this.#sending || this.socket.readyState !== NodeWS.WebSocket.OPEN) return;
    const next = this.#pending[0];
    if (!next) return;
    this.#sending = true;
    try {
      this.socket.send(next.encoded, (cause) => {
        this.#pending.shift();
        this.#pendingBytes -= next.bytes;
        this.#sending = false;
        if (cause) this.socket.terminate();
        else this.pump();
      });
    } catch {
      // `ws` can throw synchronously during a close race. Do not leave the
      // queue permanently marked as sending or let a failed peer retain a
      // connection admission.
      this.#pending.shift();
      this.#pendingBytes -= next.bytes;
      this.#sending = false;
      this.socket.terminate();
    }
  }
}

function defaultListenerFactory(
  input: CollaborationNetworkListenerFactoryInput,
): CollaborationNetworkListenerFactoryResult {
  const server = input.tls ? Https.createServer(input.tls) : Http.createServer();
  return {
    server,
    webSocketServer: new NodeWS.WebSocketServer({
      noServer: true,
      maxPayload: input.maxPayloadBytes,
      perMessageDeflate: false,
    }),
  };
}

function closeServer(server: Http.Server | Https.Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
}

function listen(server: Http.Server | Https.Server, port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (cause: Error) => reject(cause);
    server.once("error", onError);
    server.listen({ host, port }, () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("collaboration network listener did not bind a TCP address"));
        return;
      }
      resolve(address.port);
    });
  });
}

function readBody(request: Http.IncomingMessage, maximum: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    let settled = false;
    const chunks: Buffer[] = [];
    const fail = () => {
      if (settled) return;
      settled = true;
      reject(new Error("invalid request"));
    };
    request.on("aborted", fail);
    request.on("error", fail);
    request.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maximum && !settled) {
        settled = true;
        reject(new Error("resource exhausted"));
        return;
      }
      if (!settled) chunks.push(chunk);
    });
    request.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

function decodeFrame(raw: Buffer | string, maximum: number): CollaborationNetworkRequestFrame {
  const bytes = typeof raw === "string" ? Buffer.byteLength(raw, "utf8") : raw.byteLength;
  if (bytes > maximum) throw new Error("resource exhausted");
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  const decoded = decodeClientFrame(JSON.parse(text), { onExcessProperty: "error" });
  if (decoded.type !== "request") throw new Error("invalid request");
  return decoded;
}

function hashBody(frame: CollaborationNetworkRequestFrame): string {
  return createHash("sha256").update(JSON.stringify(frame.request)).digest("hex");
}

function facadeErrorCode(cause: unknown): CollaborationNetworkPublicErrorCode {
  return cause instanceof CollaborationTransportError ? cause.code : "unavailable";
}

async function executeFacade(
  facade: CollaborationTransportFacadeShape,
  frame: CollaborationNetworkRequestFrame,
  authentication: CollaborationNetworkAuthentication,
  signal: AbortSignal,
  offerReplayPage:
    | ((
        page: Parameters<Parameters<typeof facade.replaySubscription>[0]["consumer"]["offer"]>[0],
      ) => boolean)
    | null,
): Promise<unknown> {
  const input = { authentication, request: frame.request, signal };
  switch (frame.operation) {
    case "message.append":
      return Effect.runPromise(facade.append(input));
    case "message.tombstone":
      return Effect.runPromise(facade.tombstone(input));
    case "message.page":
      return Effect.runPromise(facade.page(input));
    case "context.create":
      return Effect.runPromise(facade.createContextPacket(input));
    case "device-key.status":
      return Effect.runPromise(facade.getCurrentDeviceKeyStatus(input));
    case "device-key.revoke":
      return Effect.runPromise(facade.revokeCurrentDeviceKey(input));
    case "message.subscribe-replay":
      if (!offerReplayPage)
        throw new CollaborationTransportError({
          operation: frame.operation,
          code: "invalid-request",
        });
      return Effect.runPromise(
        facade.replaySubscription({ ...input, consumer: { offer: offerReplayPage } }),
      );
  }
}

export async function startCollaborationNetworkAdapter(
  options: CollaborationNetworkAdapterOptions,
): Promise<CollaborationNetworkAdapterHandle> {
  const config = validateConfig(options.config);
  if (!config.enabled) {
    return {
      enabled: false,
      host: config.host,
      port: null,
      secure: config.tls !== undefined,
      stop: async () => undefined,
    };
  }

  const diagnostic = (value: CollaborationNetworkDiagnostic) => {
    try {
      options.onDiagnostic?.(value);
    } catch {
      // A metadata observer must never break the security boundary.
    }
  };
  const now = options.now ?? Date.now;
  const rateSecret = randomBytes(32);
  const stableKey = (...parts: ReadonlyArray<string>) => {
    const hash = createHmac("sha256", rateSecret);
    for (const part of parts) hash.update(part).update("\0");
    return hash.digest("base64url");
  };
  const requestRates = new FixedWindowRateGate(
    config.requestsPerMinute,
    config.maxConnections * 16,
  );
  const replayRates = new FixedWindowRateGate(config.replaysPerMinute, config.maxConnections * 16);
  const nonces = new NonceReplayGuard(config.nonceTtlMs, config.maxRememberedNonces);
  const connections = new ConnectionAdmission(
    config.maxConnections,
    config.maxConnectionsPerSource,
  );
  const activeControllers = new Set<AbortController>();
  const sockets = new Set<NodeWS.WebSocket>();
  let draining = false;

  const listener = (options.listenerFactory ?? defaultListenerFactory)({
    tls: config.tls,
    maxPayloadBytes: config.maxInboundFrameBytes,
  });
  const { server, webSocketServer } = listener;
  server.maxConnections = config.maxConnections;
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;

  const boundary = (request: Http.IncomingMessage) => {
    const url = requestUrl(request);
    const host = requestHost(request);
    const acceptedOrigin = origin(request, config.allowedOrigins);
    const token = bearerToken(request);
    if (
      draining ||
      !url ||
      url.search.length > 0 ||
      !host ||
      !config.allowedHosts.has(host) ||
      !acceptedOrigin ||
      !token
    ) {
      return null;
    }
    return { url, origin: acceptedOrigin, token };
  };

  const authenticationFor = (
    frame: CollaborationNetworkRequestFrame,
    token: string,
    acceptedOrigin: string,
    transport: "http" | "websocket",
  ): CollaborationNetworkAuthentication | null => {
    const timestamp = frame.proof.issuedAtMs;
    const nonceKey = stableKey(token, frame.proof.deviceKeyId, frame.proof.nonce);
    if (!nonces.admit(nonceKey, timestamp, now())) return null;
    return {
      sessionToken: token,
      deviceProof: frame.proof,
      origin: acceptedOrigin,
      bodySha256: hashBody(frame),
      transport,
    };
  };

  const admitsRate = (gate: FixedWindowRateGate, request: Http.IncomingMessage, token: string) => {
    // Check source and credential independently. Binding both into one key
    // would let an unauthenticated peer evade the source rate by rotating fake
    // bearer strings, while credential-only limiting would allow source fanout.
    const sourceAccepted = gate.admit(
      stableKey("source", request.socket.remoteAddress ?? "unknown"),
      now(),
    );
    const credentialAccepted = gate.admit(stableKey("credential", token), now());
    return sourceAccepted && credentialAccepted;
  };

  server.on("request", async (request, response) => {
    const accepted = boundary(request);
    const release = connections.acquire(
      stableKey("source", request.socket.remoteAddress ?? "unknown"),
    );
    if (
      !accepted ||
      !release ||
      request.method !== "POST" ||
      accepted.url.pathname !== COLLABORATION_NETWORK_HTTP_PATH ||
      request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
    ) {
      release?.();
      writeJson(
        response,
        release ? 404 : 429,
        publicError(null, release ? "not-found" : "resource-exhausted"),
      );
      return;
    }
    const abort = new AbortController();
    activeControllers.add(abort);
    request.on("aborted", () => abort.abort());
    response.on("close", () => {
      if (!response.writableEnded) abort.abort();
    });
    try {
      const body = await readBody(request, config.maxInboundFrameBytes);
      const frame = decodeFrame(body, config.maxInboundFrameBytes);
      if (frame.operation === "message.subscribe-replay") {
        writeJson(response, 400, publicError(frame.requestId, "invalid-request"));
        return;
      }
      if (!admitsRate(requestRates, request, accepted.token)) {
        diagnostic({ event: "request-rejected", transport: "http", code: "rate-limited" });
        writeJson(response, 429, publicError(frame.requestId, "rate-limited"));
        return;
      }
      const authentication = authenticationFor(frame, accepted.token, accepted.origin, "http");
      if (!authentication) {
        writeJson(response, 404, publicError(frame.requestId, "not-found"));
        return;
      }
      try {
        const payload = await executeFacade(
          options.facade,
          frame,
          authentication,
          abort.signal,
          null,
        );
        const result: CollaborationNetworkServerFrame = {
          version: COLLABORATION_NETWORK_PROTOCOL_VERSION,
          type: "result",
          requestId: frame.requestId,
          operation: frame.operation,
          payload,
        };
        const bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
        if (bytes > config.maxOutboundFrameBytes) {
          writeJson(response, 429, publicError(frame.requestId, "resource-exhausted"));
        } else {
          writeJson(response, 200, result);
        }
      } catch (cause) {
        const code = facadeErrorCode(cause);
        diagnostic({ event: "request-rejected", transport: "http", code });
        writeJson(response, statusFor(code), publicError(frame.requestId, code));
      }
    } catch (cause) {
      const code =
        cause instanceof Error && cause.message === "resource exhausted"
          ? "resource-exhausted"
          : "invalid-request";
      writeJson(response, statusFor(code), publicError(null, code));
    } finally {
      activeControllers.delete(abort);
      release();
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const accepted = boundary(request);
    const release = connections.acquire(
      stableKey("source", request.socket.remoteAddress ?? "unknown"),
    );
    if (
      !accepted ||
      !release ||
      request.method !== "GET" ||
      accepted.url.pathname !== COLLABORATION_NETWORK_WEBSOCKET_PATH ||
      head.byteLength > config.maxInboundFrameBytes
    ) {
      release?.();
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    try {
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        webSocketServer.emit("connection", webSocket, request, {
          token: accepted.token,
          origin: accepted.origin,
          release,
        });
      });
    } catch {
      // A failed upgrade has no WebSocket close callback to release the
      // admission slot. It must be released here before destroying the raw
      // socket, otherwise repeated malformed/upstream-failed upgrades can
      // exhaust the global connection budget indefinitely.
      release();
      try {
        socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      } finally {
        socket.destroy();
      }
    }
  });

  webSocketServer.on(
    "connection",
    (
      socket: NodeWS.WebSocket,
      request: Http.IncomingMessage,
      context: { token: string; origin: string; release: () => void },
    ) => {
      sockets.add(socket);
      diagnostic({ event: "connection-opened", transport: "websocket" });
      const queue = new OutboundQueue(
        socket,
        config.maxOutboundQueueMessages,
        config.maxOutboundQueueBytes,
        config.maxOutboundFrameBytes,
      );
      const requests = new Map<string, { abort: AbortController; replay: boolean }>();
      let lastPong = now();
      let closed = false;
      const heartbeat = setInterval(() => {
        if (now() - lastPong > config.livenessTimeoutMs) {
          socket.terminate();
          return;
        }
        if (socket.readyState === NodeWS.WebSocket.OPEN) socket.ping();
      }, config.heartbeatIntervalMs);
      heartbeat.unref();
      socket.on("pong", () => {
        lastPong = now();
      });
      socket.on("message", (data, isBinary) => {
        if (draining || isBinary) {
          socket.close(1008, "invalid request");
          return;
        }
        let decoded: typeof CollaborationNetworkClientFrame.Type;
        try {
          const raw = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
          if (raw.byteLength > config.maxInboundFrameBytes) throw new Error("resource exhausted");
          decoded = decodeClientFrame(JSON.parse(raw.toString("utf8")), {
            onExcessProperty: "error",
          });
        } catch {
          // Invalid WebSocket frames are not rate-admitted because they have
          // no safely decoded request identity. End the peer after one public
          // error so it cannot turn parse failures into unbounded CPU work.
          if (!queue.offer(publicError(null, "invalid-request"))) socket.terminate();
          else socket.close(1008, "invalid request");
          return;
        }
        if (decoded.type === "cancel") {
          requests.get(decoded.requestId)?.abort.abort();
          return;
        }
        const frame = decoded;
        if (requests.has(frame.requestId) || requests.size >= config.maxInFlight) {
          if (!queue.offer(publicError(frame.requestId, "resource-exhausted"))) socket.terminate();
          return;
        }
        const replayCount = [...requests.values()].filter(({ replay }) => replay).length;
        if (
          frame.operation === "message.subscribe-replay" &&
          replayCount >= config.maxSubscriptions
        ) {
          if (!queue.offer(publicError(frame.requestId, "resource-exhausted"))) socket.terminate();
          return;
        }
        const gate = frame.operation === "message.subscribe-replay" ? replayRates : requestRates;
        if (!admitsRate(gate, request, context.token)) {
          diagnostic({ event: "request-rejected", transport: "websocket", code: "rate-limited" });
          if (!queue.offer(publicError(frame.requestId, "rate-limited"))) socket.terminate();
          return;
        }
        const authentication = authenticationFor(frame, context.token, context.origin, "websocket");
        if (!authentication) {
          if (!queue.offer(publicError(frame.requestId, "not-found"))) socket.terminate();
          return;
        }
        const abort = new AbortController();
        const replay = frame.operation === "message.subscribe-replay";
        requests.set(frame.requestId, { abort, replay });
        activeControllers.add(abort);
        const offerReplayPage = replay
          ? (
              page: Parameters<
                Parameters<typeof options.facade.replaySubscription>[0]["consumer"]["offer"]
              >[0],
            ) =>
              queue.offer({
                version: COLLABORATION_NETWORK_PROTOCOL_VERSION,
                type: "replay-page",
                requestId: frame.requestId,
                page,
              })
          : null;
        void executeFacade(options.facade, frame, authentication, abort.signal, offerReplayPage)
          .then((payload) => {
            if (
              !queue.offer({
                version: COLLABORATION_NETWORK_PROTOCOL_VERSION,
                type: "result",
                requestId: frame.requestId,
                operation: frame.operation,
                payload,
              })
            ) {
              socket.close(1008, "slow consumer");
            }
          })
          .catch((cause) => {
            const code = facadeErrorCode(cause);
            diagnostic({ event: "request-rejected", transport: "websocket", code });
            const offered = queue.offer(publicError(frame.requestId, code));
            if (code === "slow-consumer" || !offered) socket.close(1008, "slow consumer");
          })
          .finally(() => {
            requests.delete(frame.requestId);
            activeControllers.delete(abort);
          });
      });
      socket.once("close", () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        for (const { abort } of requests.values()) abort.abort();
        requests.clear();
        sockets.delete(socket);
        context.release();
        diagnostic({ event: "connection-closed", transport: "websocket" });
      });
      socket.once("error", () => socket.terminate());
    },
  );

  let boundPort: number;
  try {
    boundPort = await listen(server, config.port, config.host);
  } catch (cause) {
    try {
      webSocketServer.close();
    } finally {
      await closeServer(server);
    }
    throw cause;
  }
  diagnostic({ event: "listener-started" });
  let stopped: Promise<void> | null = null;
  const stop = () => {
    if (stopped) return stopped;
    stopped = (async () => {
      draining = true;
      const closing = closeServer(server);
      for (const controller of activeControllers) controller.abort();
      for (const socket of sockets) socket.close(1012, "server shutdown");
      // Shutdown must advance even when tests inject a fixed authentication
      // clock or the system clock is corrected backwards.
      const deadline = Date.now() + config.shutdownGraceMs;
      while ((activeControllers.size > 0 || sockets.size > 0) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      for (const socket of sockets) socket.terminate();
      await closing;
      await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
      diagnostic({ event: "listener-stopped" });
    })();
    return stopped;
  };
  return {
    enabled: true,
    host: config.host,
    port: boundPort,
    secure: config.tls !== undefined,
    stop,
  };
}
