import { NodeWS } from "@effect/platform-node/NodeSocket";
import type {
  CollaborationNetworkRequestFrame,
  CollaborationNetworkServerFrame,
  CollaborationTransportPage,
} from "@cafecode/contracts";
import * as Effect from "effect/Effect";
import * as Http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type CollaborationNetworkAuthentication,
  COLLABORATION_NETWORK_HTTP_PATH,
  COLLABORATION_NETWORK_WEBSOCKET_PATH,
  startCollaborationNetworkAdapter,
  type CollaborationNetworkAdapterHandle,
  type CollaborationNetworkAdapterOptions,
} from "./CollaborationNetworkAdapter.ts";
import {
  type CollaborationTransportFacadeShape,
  CollaborationTransportError,
} from "./CollaborationTransportFacade.ts";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");
const ORIGIN = "https://cowork-client.example";
const TOKEN = "session.payload.signature";
let nonceCounter = 0;

function frame(
  operation: CollaborationNetworkRequestFrame["operation"] = "message.append",
  request: unknown = { sharedProjectId: "shared-project-network-1" },
): CollaborationNetworkRequestFrame {
  nonceCounter += 1;
  return {
    version: 1,
    type: "request",
    requestId: `request-${nonceCounter}` as never,
    operation,
    proof: {
      deviceId: "device-1",
      deviceKeyId: "device-key-1",
      issuedAtMs: NOW,
      nonce: `nonce-${nonceCounter}`,
      signature: `signature-${nonceCounter}`,
    },
    request,
  };
}

function replayPage(sequence = 1): CollaborationTransportPage {
  return {
    sharedProjectId: "shared-project-network-1",
    messages: [],
    mergedOrder: [],
    lanePositions: [],
    nextCursor: `cursor-${sequence}`,
    hasMore: false,
  } as never;
}

const succeedFacadeRequest = (input: {
  readonly authentication: unknown;
  readonly request: unknown;
}) => Effect.succeed({ authentication: input.authentication, request: input.request } as never);

function makeFacade(
  overrides: Partial<CollaborationTransportFacadeShape> = {},
): CollaborationTransportFacadeShape {
  return {
    append: succeedFacadeRequest,
    tombstone: succeedFacadeRequest,
    page: succeedFacadeRequest,
    createContextPacket: succeedFacadeRequest,
    replaySubscription: (input) =>
      Effect.sync(() => {
        input.consumer.offer(replayPage());
        return {
          sharedProjectId: "shared-project-network-1",
          deliveredBatches: 1,
          deliveredMessages: 0,
          nextCursor: "cursor-1",
          caughtUp: true,
        } as never;
      }),
    ...overrides,
  };
}

function options(
  facade: CollaborationTransportFacadeShape = makeFacade(),
  config: Partial<CollaborationNetworkAdapterOptions["config"]> = {},
): CollaborationNetworkAdapterOptions {
  return {
    facade,
    now: () => NOW,
    config: {
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      allowedHosts: ["127.0.0.1"],
      allowedOrigins: [ORIGIN],
      heartbeatIntervalMs: 50,
      livenessTimeoutMs: 500,
      shutdownGraceMs: 500,
      ...config,
    },
  };
}

function requestJson(
  port: number,
  body: unknown,
  input: {
    readonly path?: string;
    readonly host?: string;
    readonly origin?: string;
    readonly authorization?: string;
  } = {},
): Promise<{ status: number; body: CollaborationNetworkServerFrame }> {
  return new Promise((resolve, reject) => {
    const encoded = JSON.stringify(body);
    const request = Http.request(
      {
        host: "127.0.0.1",
        port,
        path: input.path ?? COLLABORATION_NETWORK_HTTP_PATH,
        method: "POST",
        headers: {
          Host: input.host ?? `127.0.0.1:${port}`,
          Origin: input.origin ?? ORIGIN,
          Authorization: input.authorization ?? `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(encoded),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve({
              status: response.statusCode ?? 0,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          } catch (cause) {
            reject(cause);
          }
        });
      },
    );
    request.on("error", reject);
    request.end(encoded);
  });
}

function openWebSocket(port: number): Promise<NodeWS.WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new NodeWS.WebSocket(
      `ws://127.0.0.1:${port}${COLLABORATION_NETWORK_WEBSOCKET_PATH}`,
      [],
      {
        headers: {
          Origin: ORIGIN,
          Authorization: `Bearer ${TOKEN}`,
        },
      },
    );
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function messageCollector(socket: NodeWS.WebSocket) {
  const buffered: CollaborationNetworkServerFrame[] = [];
  const waiters: Array<(frame: CollaborationNetworkServerFrame) => void> = [];
  socket.on("message", (data) => {
    const decoded = JSON.parse(data.toString()) as CollaborationNetworkServerFrame;
    const waiter = waiters.shift();
    if (waiter) waiter(decoded);
    else buffered.push(decoded);
  });
  return {
    next: () => {
      const value = buffered.shift();
      return value
        ? Promise.resolve(value)
        : new Promise<CollaborationNetworkServerFrame>((resolve) => waiters.push(resolve));
    },
  };
}

function socketClose(socket: NodeWS.WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString("utf8") }));
  });
}

describe("CollaborationNetworkAdapter", () => {
  const handles: CollaborationNetworkAdapterHandle[] = [];
  const sockets: NodeWS.WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets) socket.terminate();
    sockets.length = 0;
    await Promise.all(handles.splice(0).map((handle) => handle.stop()));
    nonceCounter = 0;
  });

  it("is inert unless enabled and rejects unsafe non-loopback configuration", async () => {
    const listenerFactory = vi.fn(() => {
      throw new Error("must not bind");
    });
    const disabled = await startCollaborationNetworkAdapter({
      ...options(),
      listenerFactory,
      config: { ...options().config, enabled: false },
    });
    expect(disabled).toMatchObject({ enabled: false, port: null });
    expect(listenerFactory).not.toHaveBeenCalled();

    await expect(
      startCollaborationNetworkAdapter(
        options(makeFacade(), { host: "0.0.0.0", allowNonLoopback: false }),
      ),
    ).rejects.toThrow("explicit opt-in");
    await expect(
      startCollaborationNetworkAdapter(
        options(makeFacade(), { host: "0.0.0.0", allowNonLoopback: true }),
      ),
    ).rejects.toThrow("TLS is required");
    await expect(
      startCollaborationNetworkAdapter(
        options(makeFacade(), {
          host: "0.0.0.0",
          allowNonLoopback: true,
          tls: { key: "not-used", cert: "not-used" },
          allowedOrigins: ["http://cowork-client.example"],
        }),
      ),
    ).rejects.toThrow("must use HTTPS");
  });

  it("accepts strict HTTP requests and passes only header-derived opaque authentication", async () => {
    let authentication: CollaborationNetworkAuthentication | null = null;
    const handle = await startCollaborationNetworkAdapter(
      options(
        makeFacade({
          append: (input) => {
            authentication = input.authentication as CollaborationNetworkAuthentication;
            return Effect.succeed({ accepted: true } as never);
          },
        }),
      ),
    );
    handles.push(handle);

    const result = await requestJson(handle.port!, frame());
    expect(result).toMatchObject({
      status: 200,
      body: { type: "result", operation: "message.append", payload: { accepted: true } },
    });
    expect(authentication).toMatchObject({
      sessionToken: TOKEN,
      origin: ORIGIN,
      transport: "http",
      deviceProof: { deviceId: "device-1", deviceKeyId: "device-key-1" },
    });
    expect(authentication).not.toHaveProperty("principal");
    expect((authentication as CollaborationNetworkAuthentication | null)?.bodySha256).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });

  it("rejects Host, Origin, target-form, query-string, and authorization mismatches generically", async () => {
    const append = vi.fn(() => Effect.succeed({} as never));
    const handle = await startCollaborationNetworkAdapter(options(makeFacade({ append })));
    handles.push(handle);

    const badHost = await requestJson(handle.port!, frame(), { host: "attacker.example" });
    const badOrigin = await requestJson(handle.port!, frame(), {
      origin: "https://attacker.example",
    });
    const query = await requestJson(handle.port!, frame(), {
      path: `${COLLABORATION_NETWORK_HTTP_PATH}?token=must-not-be-accepted`,
    });
    const absoluteTarget = await requestJson(handle.port!, frame(), {
      path: `http://attacker.example${COLLABORATION_NETWORK_HTTP_PATH}`,
    });
    const credentialedHost = await requestJson(handle.port!, frame(), {
      host: `attacker@127.0.0.1:${handle.port!}`,
    });
    const badAuthorization = await requestJson(handle.port!, frame(), {
      authorization: "Bearer token with spaces",
    });

    for (const result of [
      badHost,
      badOrigin,
      query,
      absoluteTarget,
      credentialedHost,
      badAuthorization,
    ]) {
      expect(result.status).toBe(404);
      expect(result.body).toEqual({
        version: 1,
        type: "error",
        requestId: null,
        code: "not-found",
      });
    }
    expect(append).not.toHaveBeenCalled();
  });

  it("rejects oversized frames before the facade and replays of a device nonce", async () => {
    const append = vi.fn(() => Effect.succeed({} as never));
    const handle = await startCollaborationNetworkAdapter(
      options(makeFacade({ append }), { maxInboundFrameBytes: 512 }),
    );
    handles.push(handle);

    const oversized = await requestJson(handle.port!, {
      ...frame(),
      request: { body: "x".repeat(1_024) },
    });
    expect(oversized).toMatchObject({ status: 429, body: { code: "resource-exhausted" } });

    const replayed = frame();
    expect((await requestJson(handle.port!, replayed)).status).toBe(200);
    const replayResult = await requestJson(handle.port!, replayed);
    expect(replayResult).toMatchObject({ status: 404, body: { code: "not-found" } });
    expect(append).toHaveBeenCalledTimes(1);
  });

  it("rate-limits by source even when bearer credentials rotate", async () => {
    const append = vi.fn(() => Effect.succeed({} as never));
    const handle = await startCollaborationNetworkAdapter(
      options(makeFacade({ append }), { requestsPerMinute: 1 }),
    );
    handles.push(handle);

    expect((await requestJson(handle.port!, frame())).status).toBe(200);
    const limited = await requestJson(handle.port!, frame(), {
      authorization: "Bearer another.session.token",
    });
    expect(limited).toMatchObject({ status: 429, body: { code: "rate-limited" } });
    expect(append).toHaveBeenCalledTimes(1);
  });

  it("stops a replay immediately when authority is revoked mid-stream", async () => {
    const facade = makeFacade({
      replaySubscription: (input) =>
        Effect.gen(function* () {
          if (!input.consumer.offer(replayPage())) {
            return yield* new CollaborationTransportError({
              operation: "message.subscribe-replay",
              code: "slow-consumer",
            });
          }
          return yield* new CollaborationTransportError({
            operation: "message.subscribe-replay",
            code: "not-found",
          });
        }),
    });
    const handle = await startCollaborationNetworkAdapter(options(facade));
    handles.push(handle);
    const socket = await openWebSocket(handle.port!);
    sockets.push(socket);
    const messages = messageCollector(socket);

    const revoked = frame("message.subscribe-replay");
    socket.send(JSON.stringify(revoked));
    expect(await messages.next()).toMatchObject({
      type: "replay-page",
      requestId: revoked.requestId,
    });
    expect(await messages.next()).toEqual({
      version: 1,
      type: "error",
      requestId: revoked.requestId,
      code: "not-found",
    });
  });

  it("closes a replay peer when bounded outbound delivery reports a slow consumer", async () => {
    let rejectedOffer = false;
    const facade = makeFacade({
      replaySubscription: (input) =>
        Effect.gen(function* () {
          rejectedOffer = !input.consumer.offer({
            ...replayPage(),
            nextCursor: "x".repeat(1_024),
          } as never);
          if (rejectedOffer) {
            return yield* new CollaborationTransportError({
              operation: "message.subscribe-replay",
              code: "slow-consumer",
            });
          }
          return {} as never;
        }),
    });
    const handle = await startCollaborationNetworkAdapter(
      options(facade, { maxOutboundFrameBytes: 256 }),
    );
    handles.push(handle);
    const socket = await openWebSocket(handle.port!);
    sockets.push(socket);
    const messages = messageCollector(socket);
    const closed = socketClose(socket);

    const replay = frame("message.subscribe-replay");
    socket.send(JSON.stringify(replay));
    expect(await messages.next()).toMatchObject({
      type: "error",
      requestId: replay.requestId,
      code: "slow-consumer",
    });
    await expect(closed).resolves.toEqual({ code: 1008, reason: "slow consumer" });
    expect(rejectedOffer).toBe(true);
  });

  it("closes malformed WebSocket peers and releases their admission slot", async () => {
    const handle = await startCollaborationNetworkAdapter(
      options(makeFacade(), { maxConnections: 1 }),
    );
    handles.push(handle);
    const malformed = await openWebSocket(handle.port!);
    sockets.push(malformed);
    const messages = messageCollector(malformed);
    const closed = socketClose(malformed);

    malformed.send("{");
    expect(await messages.next()).toEqual({
      version: 1,
      type: "error",
      requestId: null,
      code: "invalid-request",
    });
    await expect(closed).resolves.toEqual({ code: 1008, reason: "invalid request" });

    const replacement = await openWebSocket(handle.port!);
    sockets.push(replacement);
  });

  it("releases a connection admission when the WebSocket upgrade throws", async () => {
    let failUpgrade = true;
    const handle = await startCollaborationNetworkAdapter({
      ...options(makeFacade(), { maxConnections: 1 }),
      listenerFactory: ({ maxPayloadBytes }) => {
        const server = Http.createServer();
        const webSocketServer = new NodeWS.WebSocketServer({
          noServer: true,
          maxPayload: maxPayloadBytes,
          perMessageDeflate: false,
        });
        const handleUpgrade = webSocketServer.handleUpgrade.bind(webSocketServer);
        vi.spyOn(webSocketServer, "handleUpgrade").mockImplementation(
          (request, socket, head, callback) => {
            if (failUpgrade) {
              failUpgrade = false;
              throw new Error("injected upgrade failure");
            }
            return handleUpgrade(request, socket, head, callback);
          },
        );
        return { server, webSocketServer };
      },
    });
    handles.push(handle);

    await expect(openWebSocket(handle.port!)).rejects.toThrow();
    const replacement = await openWebSocket(handle.port!);
    sockets.push(replacement);
  });

  it("terminates a WebSocket peer that stops proving heartbeat liveness", async () => {
    let clock = NOW;
    let acceptedSocket: NodeWS.WebSocket | null = null;
    const handle = await startCollaborationNetworkAdapter({
      ...options(makeFacade(), { heartbeatIntervalMs: 10, livenessTimeoutMs: 20 }),
      now: () => clock,
      listenerFactory: ({ maxPayloadBytes }) => {
        const server = Http.createServer();
        const webSocketServer = new NodeWS.WebSocketServer({
          noServer: true,
          maxPayload: maxPayloadBytes,
          perMessageDeflate: false,
        });
        webSocketServer.on("connection", (socket) => {
          acceptedSocket = socket;
        });
        return { server, webSocketServer };
      },
    });
    handles.push(handle);
    const socket = await openWebSocket(handle.port!);
    sockets.push(socket);
    expect(acceptedSocket).not.toBeNull();
    (acceptedSocket as NodeWS.WebSocket | null)?.removeAllListeners("pong");
    const closed = socketClose(socket);

    clock += 100;
    await expect(closed).resolves.toEqual({ code: 1006, reason: "" });
  });

  it("cancels in-flight WebSocket work and drains safely on stop", async () => {
    let cancelled = false;
    const facade = makeFacade({
      append: (input) =>
        Effect.callback((resume) => {
          const signal = input.signal!;
          const onAbort = () => {
            cancelled = true;
            resume(
              Effect.fail(
                new CollaborationTransportError({
                  operation: "message.append",
                  code: "cancelled",
                }),
              ),
            );
          };
          signal.addEventListener("abort", onAbort, { once: true });
          return Effect.sync(() => signal.removeEventListener("abort", onAbort));
        }),
    });
    const handle = await startCollaborationNetworkAdapter(options(facade));
    handles.push(handle);
    const socket = await openWebSocket(handle.port!);
    sockets.push(socket);
    const messages = messageCollector(socket);
    const pending = frame();
    socket.send(JSON.stringify(pending));
    socket.send(JSON.stringify({ version: 1, type: "cancel", requestId: pending.requestId }));

    expect(await messages.next()).toMatchObject({
      type: "error",
      requestId: pending.requestId,
      code: "cancelled",
    });
    expect(cancelled).toBe(true);

    await handle.stop();
    await expect(requestJson(handle.port!, frame())).rejects.toThrow();
  });
});
